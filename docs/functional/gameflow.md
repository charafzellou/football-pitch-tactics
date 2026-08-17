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
     └── [ All matches played — season end, currently not auto-detected ]
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

Server actions:
1. Deletes any existing `game` row (only one save at a time).
2. Inserts a new row: `playerTeamId = teamId`, `season = 1`, `currentDate = now`.
3. Returns the new game row.

Client then navigates to `/game`.

> **One-save limitation:** Starting a new game **permanently destroys** the previous save. There is no confirmation dialog. See `TASKS.md` task #11 for multi-save support.

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

---

## 4. Between Matches — Exploration

The player can freely navigate to:

| Page | Purpose |
|---|---|
| `/game/team` | View squad, sell players |
| `/game/schedule` | See all past and upcoming fixtures |
| `/game/standings` | Check league table |
| `/game/transfers` | Search and buy players |

These are non-destructive browsing pages. Transfers are the only action that permanently changes state between matches.

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

- **Purpose:** The schedule API filters upcoming matches using `matchDate >= currentDate`, and AI fixture resolution uses `matchDate <= currentDate`.
- **Advance mechanism:** After each match, `currentDate` is set to `matchDate + 1 second`. This is the only way it advances; `POST /api/game/next-day` exists but has no UI trigger.
- **Fixtures are scheduled by round.** Every fixture in a round shares one kickoff date, and rounds are spaced 7 days apart from a fixed season start (`server/core/calendar.ts`). This is what makes "resolve everything up to today" mean exactly one matchday.

  Fixture dates were previously an independent `faker.date.future()` per match, so rounds were not chronological and a club could draw two fixtures on the same day — which left AI resolution with no well-defined window to work in.

---

## 8. Reset / New Save

The player can only restart by visiting `/new-game` and clicking **Start Game**. This:
- Deletes the current `game` row.
- Does **not** reset match results, transfers, or standings — those persist in the DB.
- The only way to fully reset is to run `bun run db:setup` which re-seeds everything.
