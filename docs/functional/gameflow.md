# Game Flow

This document describes the end-to-end lifecycle of a game session from first boot to season completion.

---

## State Machine Overview

```
[ No save ]
     │  POST /api/game/start
     ▼
[ Active Save — Season 1 ]
     │
     ├──▶ Dashboard (/game)
     │       └── Build lineup → "Go to Matchday"
     │
     ├──▶ Matchday (/matchday)
     │       └── Simulate match → match result written → back to Dashboard
     │
     ├──▶ Schedule, Standings, Team, Transfers (at any time)
     │
     ├──▶ [ All matches played ] → /game/season-end → rollover → Season N+1
     │
     └──▶ [ Board confidence exhausted ] → /game/dismissed  ── terminal
                                                │
                                                └── POST /api/game/start (new save)
```

---

## 1. First Visit — No Active Save

When the app is opened for the first time (or after the DB is reset):

1. The browser loads any route.
2. The **global middleware** `require-active-game.global.ts` runs.
3. It calls `GET /api/game/state`.
4. The response is `null` / `undefined` (no row in the `game` table).
5. Middleware redirects to `/new-game`.
6. The home page `/` is accessible without a save — it always shows a "Start New Game" CTA.

---

## 2. Starting a New Game (`/new-game`)

The wizard collects three selections:

| Step | API | What changes |
|---|---|---|
| 1. Country | `GET /api/countries` | `selectedCountry` ref |
| 2. League | `GET /api/leagues?countryId` | `selectedLeague` ref |
| 3. Club | `GET /api/teams?leagueId` | `selectedTeam` ref |

On **Start Game**:
```
POST /api/game/start  { teamId: selectedTeam }
```

Server actions, all in one transaction:
1. Deletes any existing `game` row (only one save at a time), plus club news and transfer offers.
2. Clears the results the old save produced — `match_events`, `matches`, `season_summary`, `finance_ledger` — marks every season unfinished, and drops saved lineups.
3. Regenerates season 1's fixtures for every league.
4. Inserts a new row: `playerTeamId = teamId`, `season = 1`, `currentDate` = one second before the season's first kickoff.
5. Returns the new game row.

Client then navigates to `/game`.

> **The calendar starts from the fixture list, not the clock.** `currentDate` used to be `new Date()` while fixtures are dated from a fixed season start (10 August 2024 for season 1). Once that date passed in the real world, every fixture in a brand-new save was already behind the calendar — the dashboard drew Club Status with nothing beside it, no Next Match card and no route to Matchday. `rollOverSeason` had always seeded the cursor from the fixture list; game start now matches it.

> **Squads survive a restart.** Steps 2–3 rebuild the *save*, not the world: player rows are left alone because `match_events` and transfer history reference them. A new save on a database that has already run seasons keeps their ageing and retirements. `bun run db:setup` is the full reset.

> **One-save limitation:** only one save exists at a time, and starting a new game **permanently destroys** the previous one. When a save already exists the Start button opens an `AppConfirmModal` that requires the phrase **"new game"** to be typed. Multi-save is not implemented.

---

## 3. The Dashboard (`/game`)

The hub page shows:

### Club Status
- **League position** — derived from `GET /api/standings?leagueId`.
- **Bank balance** — from `GET /api/team/:playerTeamId`.

### Next Match
- The first entry from `GET /api/schedule` (upcoming, unplayed).
- Shows opponent name and match date.
- The **Go to Matchday** button is the primary call-to-action.

### Lineup Builder
The player must select 11 players matching their chosen formation before they can go to matchday.

1. Pick a formation from the dropdown (calls `GET /api/tactics`).
2. Click players in the squad table to add/remove them.
3. The pitch visualisation updates in real-time.
4. The **Go to Matchday** button is the gated action — it calls `PUT /api/team/:id/tactics` to save the formation, then navigates to `/matchday`.

> **Lineup legality:** The lineup is valid only when exactly 11 players are selected AND all position slot counts match the formation exactly. Attempting to proceed with an invalid lineup shows a toast and aborts navigation.

> **When the squad cannot meet that bar.** Every formation needs exactly one goalkeeper, so a club whose keepers are all injured could otherwise never name a legal XI — and since **Go to Matchday** is gated on exactly that, no change of formation would re-enable it. Two escape hatches now prevent that dead end:
>
> 1. An injured player becomes **selectable** once no fit player is left for their line in the current formation. They still raise the injured warning; they simply stop being blocked when they are the only option.
> 2. If no formation can be filled from the squad *at all* — the club is short of bodies in a slot outright — a **Field an emergency XI** button appears and hands the teamsheet to `autoSelectLineup()`, the same fallback every CPU club uses.

---

## 4. Between Matches — Exploration

The player can freely navigate to:

| Page | Purpose |
|---|---|
| `/game/team` | View squad, sell players |
| `/game/schedule` | See all past and upcoming fixtures |
| `/game/standings` | Check league table |
| `/game/transfers` | Search and buy players |
| `/game/finance` | Profit and loss, wage pressure, debt |
| `/game/finance/projection` | The four-season forecast and the budgets it recommends |
| `/game/finance/commercial` | Sponsorship offers, deals and the advertising ladder |
| `/game/finance/stadium` | Ticket price, season tickets, boxes, expansion, non-matchday bookings |
| `/game/finance/facilities` | The academy and the training ground |

Browsing is non-destructive. Transfers, and the commercial and stadium decisions, are what permanently change state between matches — see [finances.md](finances.md).

---

## 5. Playing a Match — Full Flow

See [matchday.md](matchday.md) for the full breakdown. Summary:

1. Player confirms lineup and tactic → navigates to `/matchday`.
2. Player clicks **Start Match** → `POST /api/match/simulate { matchId }`.
3. Pre-computed events are replayed minute-by-minute on a 1-second interval.
4. When minute 90 is reached the clock stops and **End Match** appears.
5. Player clicks **End Match** → navigates back to `/game`.

After the match:
- `game.currentDate` is advanced past the match date.
- The next call to `GET /api/schedule` shows the following fixture.
- Standings update automatically (they are computed on the fly from `matches`).

---

## 6. Season Progression

A season runs 38 rounds (20 clubs, double round-robin) and ends when every fixture in it has been played.

### Resolving the rest of the world

Only fixtures involving the player's club are played on the matchday screen. **Every other fixture is resolved headlessly** by `resolveFixturesUpTo()` (`server/core/matchday-ai.ts`), triggered from `POST /api/match/finish` once the calendar has advanced past the round.

This closed a significant hole: previously *only* the player's matches were ever simulated — 2 of 760 in a fresh save — so the league table showed every other club on nil and a season could never complete. Playing one match now resolves the whole round (20 fixtures), and AI squads settle their fitness through the same `settleMatchFitness()` the player's match uses.

### Ending a season

`GET /api/season/status` reports the round, the total, and whether the season is complete. Once it is, the dashboard's "Go to Matchday" card is replaced by **End of season**, linking to `/game/season-end`.

`POST /api/season/rollover` performs the transition in one transaction:

1. Snapshot the final standings per league into `season_summary` (champion, points, the player's finishing position). This happens *first* — the next season's fixtures are inserted at the end and would otherwise pollute the table the champion is read from.
2. Mark the old season `ended = 'true'`.
3. Every surviving player: `age + 1`, development applied, market value recomputed, **stamina restored to 100** (a pre-season — a starter finishes 38 games near empty, so without this every season after the first would begin exhausted). Injuries deliberately carry over.
4. Retirements flagged. **Rows are never deleted** — `match_events.player_id` references them, so removing them would destroy the match history they appear in.
5. Youth intake refills every squad to 22, filling whichever positions the club is shortest of.
6. `teams.lineup` cleared — a saved XI may name a player who has just retired.
7. Next season's fixtures generated by `buildSeasonFixtures()`.
8. `game.season` incremented and the calendar moved to the new season's opening round.

See [technical/season.md](../technical/season.md) for the progression curves.

**Not implemented:** promotion and relegation, and second-tier leagues. Each country still has exactly one division.

---

## 7. The Virtual Calendar (`game.currentDate`)

`currentDate` is a timestamp stored in the `game` table. It acts as the game's in-game "today".

- **Purpose:** AI fixture resolution uses `matchDate <= currentDate` — deciding which *other* clubs' fixtures are due is the calendar's whole job.

  It deliberately does **not** filter the player's own schedule. `GET /api/schedule` once required `matchDate >= currentDate` as well, which coupled the list the dashboard and Matchday steer by to the calendar cursor: any drift between the two emptied it permanently, and a fixture that fell behind the cursor could never be played or reached again. `played = 0` is the only thing that decides whether a fixture is still to come.
- **Advance mechanism:** After each match, `currentDate` is set to `matchDate + 1 second`. This is the only way it advances; `POST /api/game/next-day` exists but has no UI trigger.
- **Fixtures are scheduled by round.** Every fixture in a round shares one kickoff date, and rounds are spaced 7 days apart from a fixed season start (`server/core/calendar.ts`). This is what makes "resolve everything up to today" mean exactly one matchday.

  Fixture dates were previously an independent `faker.date.future()` per match, so rounds were not chronological and a club could draw two fixtures on the same day — which left AI resolution with no well-defined window to work in.

---

## 8. The Board — Pressure and Dismissal

Two 0–100 meters, both always present, both recomputed each matchday from the club's actual situation by `server/core/board.ts`: **board confidence** (position against the target they set, plus form and finances) and **fan confidence** (form, the table, and the ticket price). Every movement also writes a `club_news` row saying what caused it.

### Where it surfaces

| Surface | What it shows |
|---|---|
| Dashboard Club Status | Both meters, the board's target for the season, and a warning line once confidence drops to `WARNING_THRESHOLD` (40) or below |
| `GET /api/board` | The meters, the target, the thresholds, and the news feed |
| `/game/dismissed` | The verdict, the boardroom trail that led to it, and the manager's record |

> **This was all invisible.** The meters and the news rows were written from the first matchday and read by nothing — `recentNews()` had no caller — so the one system that pushes back on the manager could not be seen until it ended their save. `board.ts` states its design goal as pressure that is always *explainable*; that requires it to be visible first.

### Dismissal

Two paths, both writing `game.dismissed_at_season`:

1. **In season** — `settleMatchday()`. Confidence at or below `SACK_THRESHOLD` (25) for `SACK_STREAK` (5) consecutive matchdays. The streak is reported in the news feed at each step (`Your position is under review (3/5)`).
2. **At season end** — `settleSeasonEnd()`. The summer verdict weighs the finish against the target and can dismiss even after a calm run-in.

Both only fire when `game.sacking_enabled = 1`, chosen once on the new-game screen and never changeable afterwards. With it off the meters, warnings and streak behave identically — the flag governs only whether the streak ends the save.

### What dismissal does

The save becomes **read-only and terminal**:

- `server/core/save.ts`'s `requireActiveManager()` rejects every route that would advance or mutate the world with a `403` — match start/advance/changes, transfers, lineup, tactics, contracts, stadium, season rollover, next-day.
- `POST /api/match/finish` is deliberately **not** guarded. It only commits a match already in flight, and dismissal is decided at the end of that very call; guarding it would make the client's retry path fail on a result the server had already saved.
- The global route middleware redirects every `/game*` and `/matchday` route to `/game/dismissed`, which hides the topbar — it is an ending, not a section of the app.
- The only way forward is **Start a new game**, which clears the flag along with the rest of the save.

> **Previously this flag did nothing at all.** It was written by both paths and read by none: the dashboard still offered Matchday, the market still took bids, and a sacked manager carried on managing indefinitely. `POST /api/match/finish` even returned `board.dismissed` in its response, which the Matchday page ignored.

---

## 9. Financial Pressure

The board is not the only thing that pushes back. The bank balance does too, and it does it on a different axis: the board judges results, the balance judges decisions.

> **Budgets advise; only the balance bites.** No route in the game refuses a signing, a contract or an upgrade for exceeding a recommended budget. The wage recommendation and the transfer budget are numbers on a page, and a manager is free to blow past both. What has consequences is `teams.bank_balance` going below zero — a fact, not an opinion — and those consequences escalate the longer it lasts.

### The escalation

Recomputed every matchday by `settleInsolvency()`, immediately after the board has judged the round and before either market opens.

| Stage | Reached when | What happens |
|---|---|---|
| 1 — Overdrawn | The balance goes below zero | 12%-a-year overdraft interest, charged every matchday, and a `finance` news item |
| 2 — Transfer embargo | Three consecutive matchdays overdrawn | No buying, no free-agent signings, no contract offer above a player's current wage. −5 fan confidence |
| 3 — Board intervention | Eight matchdays overdrawn, or worse than −€15M | The board sells the most valuable saleable player at 80% of his valuation, without consulting the manager, and does it again every matchday until the club is solvent. −8 fan confidence |

**Selling is never blocked.** It is how a club gets out of an embargo, and blocking it would make stage 2 a trap rather than a punishment.

**Recovery is not instant.** Each solvent matchday steps the stage down by one, so climbing out of a board intervention takes three matchdays in the black — long enough that a one-off windfall cannot cancel a crisis half a season in the making.

**The board will not sell into a squad that cannot be fielded.** Below sixteen contracted players it stops and complains instead. That is the worst outcome in the game: a club too broke to be saved by selling.

> **This layers under the board rather than beside it.** `boardConfidenceTarget()` has always docked confidence for a negative balance, so sustained insolvency already feeds `confidenceStreak` and the dismissal path in section 8 — with no extra code. Going broke does not have its own ending; it routes into the one that already existed.

See [finances.md](finances.md) for the decisions that get a club here, and [technical/economy.md](../technical/economy.md#insolvency) for the implementation.

---

## 10. Reset / New Save

The player can only restart by visiting `/new-game` and clicking **Start Game**. This:
- Deletes the current `game` row, its news feed and any outstanding transfer offers.
- Resets match results, standings, the finance ledger and the season snapshots, and redraws season 1's fixtures — so the new save opens on an unplayed season rather than inheriting the last one's.
- **Resets every club's finances**, not just its results: bank balances come back from `startingBalanceFor()`, ticket prices from `fairTicketPrice()`, and every venture — sold ground name, advertising boards, boxes, facilities, season tickets, pitch, deals, bookings and loans — returns to its opening state. Only the `game` row and the fixtures used to be replaced, so a second save inherited the first one's balances: a brand-new game could open with a club that had already spent two seasons going broke, and every projection built on that balance was fiction.
- Re-signs the club's three opening sponsorship deals at the market rate, staggered so they do not all lapse in the same summer, and leaves naming rights unsold.
- Does **not** reset players: ages, development, retirements and transfers already made persist, because `match_events` references those rows.
- The only way to fully reset is to run `bun run db:setup` which re-seeds everything.
