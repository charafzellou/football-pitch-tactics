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

**Current state:** There is no automatic season-end detection. The game continues indefinitely even after all fixtures have been played. The schedule just becomes empty and the dashboard shows no "Next Match" card.

**Intended flow (not yet implemented):**
1. When all fixtures for `season = 1` are played, detect the season end.
2. Determine the champion (team with most points).
3. Show a trophy screen.
4. Advance to the next season (increment `game.season`, generate a new fixture list for season 2).
5. Reset `matches.homeScore` / `awayScore` to NULL for the new season, or insert fresh rows.

See `TASKS.md` task #7 for the full implementation spec.

---

## 7. The Virtual Calendar (`game.currentDate`)

`currentDate` is a timestamp stored in the `game` table. It acts as the game's in-game "today".

- **Purpose:** The schedule API filters upcoming matches using `matchDate >= currentDate`.
- **Advance mechanism:** After each match simulation, `currentDate` is set to `matchDate + 1 second`. This is the only way it advances; the `POST /api/game/next-day` endpoint (which adds 24h) is implemented but has no UI trigger.
- **Side effect:** Since fixture dates are randomly generated by faker in the seed, matches may not be in a realistic chronological order.

---

## 8. Reset / New Save

The player can only restart by visiting `/new-game` and clicking **Start Game**. This:
- Deletes the current `game` row.
- Does **not** reset match results, transfers, or standings — those persist in the DB.
- The only way to fully reset is to run `bun run db:setup` which re-seeds everything.
