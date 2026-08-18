# Season Lifecycle

How the world moves forward: the fixture calendar, resolution of matches the player isn't in, and what a season rollover does to every player in the game.

Four modules, all built on the existing match engine rather than replacing any of it:

| Module | Responsibility |
|---|---|
| `server/core/calendar.ts` | Round-robin pairings and round-based dates |
| `server/core/matchday-ai.ts` | Headless resolution of AI-vs-AI fixtures, shared fitness settlement |
| `server/core/progression.ts` | Ageing, development, retirement, youth intake, valuation |
| `server/core/season.ts` | Completion detection and the rollover transaction |
| `server/core/standings.ts` | League table computation, shared by the API and the rollover |

The rollover also drives five modules documented in [economy.md](economy.md) rather than here:

| Module | Part it plays at the rollover |
|---|---|
| `server/core/contracts.ts` | Whether a CPU club renews an expiring deal, and on what terms |
| `server/core/finance.ts` | Prize money paid into the ledger for the finished season |
| `server/core/sponsors.ts` | Sponsorship bonuses paid, and deals that have run their term retired |
| `server/core/board.ts` | The board's verdict on the season and next season's target |
| `server/core/news.ts` | Headlines for champions, the player's finish and departures |

`server/core/market.ts` runs on the same cadence but within a season rather than at its boundary — see [transfers.md](../functional/transfers.md#offers-for-your-players).

---

## Fixture calendar

`buildSeasonFixtures(teamIds, season, startDate)` produces a full double round-robin using the circle method — the first club is fixed, the rest rotate one step per round.

**Every fixture in a round shares one kickoff date**, and rounds are spaced `DAYS_BETWEEN_ROUNDS` (7) apart from `seasonStartDate(season)`. Seasons start a year apart, so the in-game calendar keeps moving.

This matters more than it looks. Fixture dates used to be an independent `faker.date.future()` per match, which meant rounds were not chronological and one club could draw two fixtures on the same day. "Resolve every fixture up to today" had no coherent meaning, and that expression is what the entire season loop is built on.

Verified properties for a 20-club league:

| Property | Value |
|---|---|
| Fixtures | 380 |
| Rounds | 38, 10 fixtures each |
| Club appearances per round | Exactly 1 |
| Each ordered pair | Exactly once (so each pairing home *and* away) |
| Home games per club | 19 — perfectly balanced |
| Gap between rounds | 7 days, uniformly |

Odd club counts are padded with a bye, and the club drawn against it has no fixture that round.

---

## Resolving AI fixtures

```ts
resolveFixturesUpTo(date: Date, playerTeamId: number): Promise<{ resolved, skipped }>
```

Finds every fixture with `played = 0 AND matchDate <= date` where **neither side is the player's club** — theirs are played manually on the matchday screen — and simulates each to full time.

No new simulation code was needed. A complete headless match is:

```ts
const home = await buildTeam(homeId, tactic, playerTeamId)
const away = await buildTeam(awayId, tactic, playerTeamId)
const { state, events } = simulateSegment(home, away, kickOff(home, away), MATCH_MINUTES)
```

`buildTeam()` already flags every non-player club `autoManaged: true`, so CPU substitutions and injury reactions work unchanged.

**Why this exists:** before it, only the player's own fixtures were ever simulated — 2 of 760 in a fresh save. Every other club sat on nil, so the league table was fiction and a season could never complete. Playing one match now resolves the full round of 20 (~700ms).

### Shared fitness settlement

`settleMatchFitness(tx, state)` was extracted out of `POST /api/match/finish` so the player's match and every AI match settle through the identical path. If they diverged, only the human's squad would tire.

It also batches: the original issued one `SELECT` per player inside the transaction, which at 19 AI matches a round would be ~570 round-trips.

---

## Progression

Applied once per rollover. Every function is pure, so the curves can be checked without a database.

### Potential

`players.potential` is a skill ceiling seeded as `skillLevel + headroom`, where headroom is generous for teenagers and near zero at peak age. Development moves skill toward it and **never past it**.

### Development curve

`developSkill(skillLevel, potential, age, trainingLevel)` — `age` is the age being *reached*. Growth is a fraction of remaining headroom, so a player near their ceiling improves slowly and one already at it plateaus. Decline is absolute and steepens.

| Age | Effect |
|---|---|
| ≤21 | +18–38% of remaining headroom |
| 22–24 | +10–24% |
| 25–27 | +3–12% |
| 28–29 | +0–5% |
| 30–32 | −0.5 to −2 |
| 33–35 | −1.5 to −3.5 |
| 36+ | −2.5 to −5.5 |

Clamped to `[40, min(potential, 99)]`.

`developmentTrend()` — the ▲/▬/▼ badge on the squad list — lives in `shared/progression.ts` so the client can import it without pulling server code into its bundle, and so the badge can never contradict what the rollover will actually do.

### Retirement

Nobody retires before 34; everybody retires at 40. In between, the decisive factor is how far a player's level has fallen, which keeps an excellent veteran playing while a faded one steps away.

```
base       = 8% (34–36), 30% (37–38), 60% (39)
penalty    = max(0, 70 − skillLevel) × 1.5%
```

**Retired players are flagged, never deleted.** `match_events.player_id` references them; deleting would destroy the match history they appear in. Every squad query filters on `retired = 0` — `buildTeam`, `GET /api/team/:id`, the transfer search, lineup validation and the AI buyer scoring.

### Youth intake

Each club is topped back up to `SQUAD_TARGET_SIZE` (22) with 16–19 year olds of modest ability and real headroom. `positionsToFill()` fills whichever positions the squad is shortest of relative to `SQUAD_SHAPE` (3 GK / 7 DEF / 7 MID / 5 ATT).

This also repaired a seeding flaw: the fallback squad generator picked positions uniformly at random, so a club could be handed eight goalkeepers and no forwards.

**The academy shapes both.** `generateYouthPlayer(teamId, position, academyLevel)` moves a graduate's ability a little and his **ceiling** a lot — +5 potential per level — because no academy produces a finished footballer, and what a good one produces is a teenager worth being patient with. At level 3, `academyIntakeBonus()` adds one graduate beyond the squad's actual shortfall, and those bonus places are always youth rather than free agents: a slot filled by somebody else's castoff would make the investment indistinguishable from not having made it. Without the bonus the whole upgrade would be silent for any club that had not happened to lose players that summer — exactly the club most likely to have afforded it.

Names come from a small built-in pool rather than faker — faker is a devDependency and this runs inside the Nitro server.

### Market value

`marketValueFor(skillLevel, age, potential?)` — exponential in skill so the gap between good and great is meaningful, multiplied by an age curve peaking at 22–27. Under 23, potential is half-priced in, so a promising teenager costs more than their current level suggests.

Deliberately calibrated to keep transfers affordable against the club balances the economy produces (a 95 tops out near €25M).

Values were previously set once at seed and never recomputed; every survivor is now repriced at each rollover.

---

## Rollover

`rollOverSeason()` refuses to run while any fixture is unplayed, then performs one transaction:

1. **Snapshot standings first** into `season_summary`. The next season's fixtures are inserted at the end and would otherwise pollute the table the champion is read from.
2. Mark the old season ended.
3. Age, develop and reprice every survivor, and **restore stamina to 100**.
4. Flag retirements.
5. **Contracts.** Every deal expiring this season is decided: CPU clubs renew or release via `aiRenews()`; the manager's own club **never** auto-renews, so letting a contract lapse is always their decision, and anyone they didn't renew leaves on a free.
6. **Free agents, then youth.** Clubs short of `SQUAD_TARGET_SIZE` shop the released pool first — capped at 3 signings each, only for players better than their squad median and only within budget — then fill whatever is still missing from the youth intake.
7. Insert next season's fixtures.
8. **Prize money** for the finished season, paid through the ledger — and beside it the manager's **sponsorship bonuses**, because they are the same kind of thing: a verdict on the season that has ended rather than income from the one about to start. A deal in its final season is paid its bonus *before* it is retired, which is what makes a short deal's larger bonus worth taking. Deals past their `until_season` then lapse, restoring the ground's original name if naming rights were among them.
   Next season's **season tickets** are sold and banked here too, as a `season_tickets` entry — the whole point of them is that the money arrives before the football does.
9. Clear `teams.lineup` — a saved XI may name a player who has just retired or left.
10. Increment `game.season`, move the calendar to one second before the new opening round.
11. **The board's verdict** (`settleSeasonEnd`) — which can dismiss the manager in the summer even after a calm run-in — and the season's headlines, then prune news from earlier seasons.

The free-agent bar in step 6 matters: without "must beat the squad median", every released player was re-signed within the same summer and the free-agent market effectively did not exist — the manager could never sign one.

### The training ground

`developSkill()` takes the club's `training_level` and applies two factors: growth toward potential is scaled by `trainingDevelopmentFactor()` (+18% a level) and decline after 30 by `trainingDecayFactor()` (−11% a level). Levels are read once per rollover into a map rather than per player — development runs over every squad in the world in one pass, and forty lookups inside that loop would be forty thousand queries.

`settleMatchFitness()` reads the same column for in-season recovery: `trainingRecoveryBonus()` adds 3 stamina a level on top of the standard recovery, and `injuryRecoveryChance()` gives an 18%-per-level chance of knocking an extra match off an *existing* absence — never a new one, so the worst case is still that a player misses a match.

Both are deliberately modest. A level-3 ground is worth a couple of points a player over four seasons and is completely invisible over one; that invisibility is the point, and it is why the four-season projection had to exist before facilities did.

---

### Pre-season: stamina and the pitch

Stamina drains faster than the flat `+10` recovered per match, so a starter finishes 38 games near empty (Courtois ended a test season on 13%). Without a summer reset, every season after the first would begin with an exhausted squad and rotation would stop meaning anything. **Injuries deliberately carry over** — a knock picked up in the final round costs the player the start of the next season.

**Every pitch is relaid**, for the same reason: a surface left at 40 in May is not still at 40 in August, and without the reset a manager who took one lucrative concert too many in April would carry the penalty into a season the decision had nothing to do with. Bookings from the finished season that were never held are expired at the same time — `settleStadiumForRound()` filters by season, so a `booked` row for a round that has passed would otherwise sit in the table for ever, un-settleable and still drawn on the diary.

---

## API

| Route | Purpose |
|---|---|
| `GET /api/season/status` | Season, round, totals, whether complete, leader, the player's position and points behind |
| `POST /api/season/rollover` | Resolves any outstanding AI fixtures, then rolls over. Returns champions, the player's finish and prize money, retirement / intake / release / free-agent-signing counts, own-club changes and departures, and the biggest risers and fallers. `403` on a dismissed save |
| `GET /api/season/history` | Past champions from `season_summary` |
| `GET /api/board` | Confidence meters, the board's target, the thresholds, and the news feed |

`GET /api/standings` now takes the season from the active save instead of hardcoding `season = 1`, which would otherwise have kept showing the first season's table forever.

---

## Verified behaviour

From an end-to-end run of three full seasons:

| Check | Result |
|---|---|
| One player match resolves the round | 760 → 740 outstanding, not 759 |
| Standings integrity | Every club on equal games; points reconcile to W×3+D; goal differences sum to zero |
| Ageing | 859 survivors, all incremented by exactly 1 |
| Ceiling respected | 0 players above `potential`, 0 below the floor |
| Squad sizes | All exactly 22 after intake |
| Goalkeepers | 0 clubs left without one |
| Match history | 31,647 events preserved; 868 reference retired players; 0 orphaned |
| Pre-season | All players restored to 100 |

---

## Known limitations

| Issue | Notes |
|---|---|
| No promotion or relegation | One division per country; the same 20 clubs repeat each season |
| AI clubs never trade with each other | They bid for the *manager's* players and sign free agents at the rollover, but no CPU-to-CPU transfer for a fee happens in or between seasons |
| AI clubs never rotate | `autoSelectLineup` always picks the strongest XI, so their starters end a season heavily fatigued |
| No cup competitions | `MATCH_MINUTES` is fixed at 90, so extra time and penalties are a prerequisite for any knockout format |
| Career stats aren't accumulated | Goals and appearances are recoverable from `match_events` but never aggregated, so there is no top-scorer table yet |
