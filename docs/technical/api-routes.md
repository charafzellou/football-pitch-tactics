# API Routes

All routes are Nitro server handlers under `frontend/server/api/`. They are auto-registered by Nuxt based on filename and HTTP method suffix.

Base URL (dev): `http://localhost:8080/api`

---

## Reference Endpoints (static lookup data)

### `GET /api/countries`
Returns all countries.

**Response:** `Array<{ id: number; name: string }>`

```json
[
  { "id": 1, "name": "England" },
  { "id": 2, "name": "Spain" }
]
```

---

### `GET /api/leagues?countryId=<number>`
Returns leagues for a given country.

**Query params:**
- `countryId` (required) — numeric country ID

**Response:** `Array<{ id: number; name: string; countryId: number }>`

**Errors:** `400` if `countryId` is missing or non-numeric.

---

### `GET /api/teams?leagueId=<number>`
Returns all teams in a league.

**Query params:**
- `leagueId` (required) — numeric league ID

**Response:** `Array<{ id: number; name: string; leagueId: number; bankBalance: number; tactics: string | null }>`

**Errors:** `400` if `leagueId` is missing.

---

### `GET /api/tactics`
Returns the full list of available tactics.

**Response:**
```json
[
  {
    "name": "4-4-2",
    "formation": { "GK": 1, "DF": 4, "MF": 4, "FW": 2 },
    "modifiers": { "attack": 0, "defence": 0 }
  },
  ...
]
```

All four tactics: `4-4-2`, `4-5-1`, `4-3-3`, `3-5-2`. See [tactics.md](../functional/tactics.md) for the full modifier table.

---

## Team Endpoints

### `GET /api/team/:id`
Returns a team, its full squad, and its resolved lineup (saved XI if still valid, otherwise auto-selected — see [tactics.md](../functional/tactics.md#lineup-resolution-and-auto-select)).

**URL params:**
- `id` (required) — numeric team ID

**Response:**
```json
{
  "id": 3,
  "name": "Arsenal",
  "leagueId": 1,
  "bankBalance": 24500000,
  "tactics": "4-3-3",
  "lineup": [42, 51, ...],
  "squad": [
    {
      "id": 42,
      "name": "Bukayo Saka",
      "age": 22,
      "position": "ATT",
      "skillLevel": 85,
      "stamina": 100,
      "marketValue": 18000000,
      "teamId": 3
    },
    ...
  ],
  "formation": { "GK": 1, "DF": 4, "MF": 3, "FW": 3 },
  "startingXi": [42, 51, ...],
  "bench": [77, 88, ...],
  "lineupAutoSelected": false
}
```

- `lineup` — the raw saved lineup from `teams.lineup` (parsed JSON array of player ids), or `null` if none was ever saved.
- `formation` — the slot counts for the team's current tactic (or the default 4-4-2 if no tactic is set).
- `startingXi` / `bench` — the *resolved* XI and remaining squad, as player id arrays, in `GK → DF → MF → FW` order (best first within each slot). This is what the Matchday lineup panels render directly.
- `lineupAutoSelected` — `true` when `lineup` was missing/invalid and `startingXi` was auto-selected instead of coming from the saved lineup.

**Errors:** `400` if `id` is missing or zero. `404` if no team exists with that id.

---

### `PUT /api/team/:id/tactics`
Updates the selected tactic for a team.

**URL params:**
- `id` (required) — numeric team ID

**Request body:**
```json
{ "tactics": "4-3-3" }
```

**Response:** `{ "success": true }`

**Errors:** `400` if `id` is missing.

**Notes:** Called immediately before navigating to `/matchday` so the simulation uses the player's latest formation choice. Called together with `PUT /api/team/:id/lineup` — see below.

---

### `PUT /api/team/:id/lineup`
Saves (or clears) the starting XI for a team.

**URL params:**
- `id` (required) — numeric team ID

**Request body:**
```json
{ "lineup": [42, 51, 77, 88, 12, 34, 56, 78, 90, 21, 65] }
```

Must resolve to **exactly 11 distinct player ids** that belong to the team's current squad.

**Response:**
```json
{ "success": true, "lineup": [42, 51, 77, 88, 12, 34, 56, 78, 90, 21, 65] }
```

**Clearing a lineup:** an empty, missing, or unparseable `lineup` is treated as "clear" rather than an error — the team's `lineup` column is set back to `NULL` (falling back to auto-selection), and the response is `{ "success": true, "lineup": null }`.

**Errors:** `400` if `id` is missing, or if the (non-empty) payload does not resolve to exactly 11 valid, distinct player ids from the team's squad (e.g. wrong count, a player from another team, duplicates that collapse below 11 after de-duplication).

**Notes:** Called immediately after `PUT /api/team/:id/tactics` when the player clicks "Go to Matchday". This is what makes the Dashboard's lineup builder selection actually affect the match simulation — previously the engine always picked its own best XI regardless of what the player chose. See [tactics.md](../functional/tactics.md#saving-tactics-and-lineup).

---

## Game State Endpoints

### `GET /api/game/state`
Returns the current save state.

**Response:**
```json
{
  "id": 1,
  "playerTeamId": 3,
  "season": 1,
  "currentDate": "2025-09-14T12:00:00.000Z"
}
```

Returns `null` / `undefined` if no save exists (handled by the global middleware to redirect to `/new-game`).

---

### `POST /api/game/start`
Creates a new save, deleting any existing one.

**Request body:**
```json
{ "teamId": 3 }
```

**Response:** The newly created game row.

**Errors:** `400` if `teamId` is missing.

**Notes:** This is a **destructive** operation — all prior game state is erased. There is currently no confirmation prompt; the new-game page calls this directly.

---

### `POST /api/game/next-day`
Advances `game.currentDate` by exactly one calendar day.

**Request body:** (none)

**Response:** Updated game state object.

**Errors:** `404` if no active save exists.

**Notes:** This route exists but is not wired to any UI button currently. It could be used for a "skip day" feature.

---

## Match Endpoints

### `GET /api/schedule`
Returns fixtures for the player's team.

**Query params:**
- `includePlayed` (optional, default `'false'`) — if `'true'`, returns all fixtures (played + upcoming); otherwise only returns unplayed upcoming fixtures.

**Response:** `Array<Match>` sorted ascending by `matchDate`.

Each match object:
```json
{
  "id": 77,
  "homeTeamId": 3,
  "awayTeamId": 7,
  "homeScore": null,
  "awayScore": null,
  "played": 0,
  "season": 1,
  "matchDate": "2025-11-02T14:00:00.000Z"
}
```

**Filter logic (upcoming-only mode):**
```
matchDate >= game.currentDate
AND homeScore IS NULL
AND played = 0
AND (homeTeamId = playerTeamId OR awayTeamId = playerTeamId)
```

**Errors:** `404` if no active save.

---

### `GET /api/match/:id`
Returns a single match with its events.

**URL params:**
- `id` (required) — numeric match ID

**Response:**
```json
{
  "id": 77,
  "homeTeamId": 3,
  "awayTeamId": 7,
  "homeScore": 2,
  "awayScore": 1,
  "played": 1,
  "matchEvents": [
    { "id": 201, "matchId": 77, "minute": 23, "eventType": 1, "playerId": 42, "teamId": 3 },
    ...
  ]
}
```

**Errors:** `400` if `id` is missing.

---

### `POST /api/match/simulate`
Simulates a match and persists the result.

**Request body:**
```json
{ "matchId": 77 }
```

If `matchId` is omitted, the earliest unplayed fixture is simulated instead.

**What it does:**
1. Looks up the match row (must have `homeScore IS NULL`).
2. Fetches both squads from the DB.
3. Reads each team's `tactics` setting (falls back to the default 4-4-2 if `NULL`) and its saved `lineup` (via the shared `parseLineup()`).
4. Calls `simulateMatch()` from `server/core/match-engine.ts`, passing each team's saved lineup ids (if any) — see [match-engine.md](match-engine.md).
5. Writes `homeScore`, `awayScore`, `played = 1` to the `matches` row.
6. Persists all generated events to `match_events`, each with a `playerId` — see [match-engine.md](match-engine.md#player-selection-by-position).
7. Advances `game.currentDate` to `matchDate + 1 second`.

**Response:**
```json
{
  "matchId": 77,
  "homeScore": 2,
  "awayScore": 1,
  "events": [
    { "minute": 23, "eventType": "goal", "teamId": 3, "playerId": 42 },
    ...
  ],
  "homeLineup": [42, 51, 77, ...],
  "awayLineup": [12, 34, 56, ...],
  "simulated": { ... full simulation result ... },
  "updatedMatch": { ... match row with events ... }
}
```

`homeLineup`/`awayLineup` are the player ids the engine actually started with (resolved the same way `GET /api/team/:id` resolves `startingXi`). The Matchday page adopts these after simulation so its lineup panels match exactly what was simulated.

**Errors:** Returns `{ "message": "No matches to simulate" }` (200) if the requested match is already played.

---

## Standings Endpoint

### `GET /api/standings?leagueId=<number>`
Computes current league standings from played matches.

**Query params:**
- `leagueId` (required) — numeric league ID

**Calculation:** For every team in the league, counts all played matches in `season = 1` and aggregates W/D/L/GF/GA/GD/Pts.

**Response:** Array sorted by `points DESC`, then `goalDifference DESC`.
```json
[
  { "teamName": "Arsenal", "played": 12, "wins": 9, "draws": 2, "losses": 1, "goalsFor": 27, "goalsAgainst": 9, "goalDifference": 18, "points": 29 },
  ...
]
```

**Errors:** `400` if `leagueId` missing.

---

## Player Endpoints

### `GET /api/players/search?query=<string>`
Searches players by name, excluding the player's own squad.

**Query params:**
- `query` (optional) — substring search against `players.name` using SQL `LIKE %query%`

**Filter applied:** Always excludes players whose `teamId = game.playerTeamId`. This ensures the transfer market never shows your own players.

**Response:** `Array<Player>` — same shape as the `players` DB row.

**Notes:** Returns all non-player-team players when `query` is empty. This is the data source for the Transfers page.

---

## Transfer Endpoints

### `POST /api/transfers`
Executes a buy or sell transfer.

**Request body:**
```json
{ "playerId": 42, "action": "sell" }
```
or
```json
{ "playerId": 99, "action": "buy" }
```

#### Sell flow
1. Finds eligible AI buyer teams: not the seller's team, not the player's team, `bankBalance > marketValue`.
2. Scores each candidate by `skillGap` (|team position avg skill − player skillLevel|).
3. Prefers buyers with `skillGap ≤ 8`; falls back to the 5 closest-fit teams.
4. Picks a random buyer from the pool.
5. Computes `transferValue = marketValue × (1 + premium)` where premium is 5–50% based on the buyer's relative strength.
6. Executes a DB transaction: move player, update both balances, update `marketValue`.

**Sell response:**
```json
{ "success": true, "buyerTeam": "Chelsea", "salePrice": 21500000 }
```

#### Buy flow
1. Verifies the player is not already on the player's team.
2. Checks `buyerTeam.bankBalance >= player.marketValue`.
3. Moves player to player's team at current `marketValue` (no premium on buys).
4. DB transaction: move player, deduct from buyer, credit seller.

**Buy response:**
```json
{ "success": true, "buyerTeam": "Arsenal", "sellerTeam": "Manchester City", "purchasePrice": 18000000 }
```

**Errors:**
- `400` — invalid action, player already on your team, insufficient funds
- `404` — player or team not found

---

### `GET /api/transfers/history`
**Stub — returns `[]`.** No transfer history table exists yet. See `TASKS.md` task #3.

---

## Error Format

All errors follow Nuxt's `createError` format:
```json
{
  "statusCode": 400,
  "statusMessage": "Human-readable error description"
}
```
