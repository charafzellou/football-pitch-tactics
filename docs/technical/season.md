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

`developSkill(skillLevel, potential, age)` — `age` is the age being *reached*. Growth is a fraction of remaining headroom, so a player near their ceiling improves slowly and one already at it plateaus. Decline is absolute and steepens.

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

Names come from a small built-in pool rather than faker — faker is a devDependency and this runs inside the Nitro server.

### Market value

`marketValueFor(skillLevel, age, potential?)` — exponential in skill so the gap between good and great is meaningful, multiplied by an age curve peaking at 22–27. Under 23, potential is half-priced in, so a promising teenager costs more than their current level suggests.

Deliberately calibrated to the **existing** economy (a 95 tops out near €25M against club balances of €1–50M). There is no wage or income system yet, so realistic valuations would simply make everyone unaffordable.

Values were previously set once at seed and never recomputed.

---

## Rollover

`rollOverSeason()` refuses to run while any fixture is unplayed, then performs one transaction:

1. **Snapshot standings first** into `season_summary`. The next season's fixtures are inserted at the end and would otherwise pollute the table the champion is read from.
2. Mark the old season ended.
3. Age, develop and reprice every survivor, and **restore stamina to 100**.
4. Flag retirements.
5. Youth intake.
6. Clear `teams.lineup` — a saved XI may name a retired player.
7. Insert next season's fixtures.
8. Increment `game.season`, move the calendar to the new opening round.

### Pre-season stamina

Stamina drains faster than the flat `+10` recovered per match, so a starter finishes 38 games near empty (Courtois ended a test season on 13%). Without a summer reset, every season after the first would begin with an exhausted squad and rotation would stop meaning anything. **Injuries deliberately carry over** — a knock picked up in the final round costs the player the start of the next season.

---

## API

| Route | Purpose |
|---|---|
| `GET /api/season/status` | Season, round, totals, whether complete, leader and the player's position |
| `POST /api/season/rollover` | Resolves any outstanding AI fixtures, then rolls over. Returns champions, the player's finish, retirement and intake counts, own-club changes, and the biggest risers and fallers |
| `GET /api/season/history` | Past champions from `season_summary` |

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
| AI clubs never transfer | Squads only change through retirement and youth intake, so the world's talent slowly regenerates but never moves between clubs |
| AI clubs never rotate | `autoSelectLineup` always picks the strongest XI, so their starters end a season heavily fatigued |
| No cup competitions | `MATCH_MINUTES` is fixed at 90, so extra time and penalties are a prerequisite for any knockout format |
| Career stats aren't accumulated | Goals and appearances are recoverable from `match_events` but never aggregated, so there is no top-scorer table yet |
