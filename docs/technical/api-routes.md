# API Routes

All routes are Nitro server handlers under `frontend/server/api/`. They are auto-registered by Nuxt based on filename and HTTP method suffix.

Base URL (dev): `http://localhost:8080/api`

---

## A dismissed save is read-only

Once the board has sacked the manager (`game.dismissed_at_season` is set), every
route that would advance or mutate the world responds `403` with
`"You were dismissed. This save is closed."` — match start/advance/changes,
transfers, transfer offers, lineup, tactics, contracts, stadium, season rollover
and next-day. Reads are unaffected, because the dismissal screen is built from
them.

The guard is `requireActiveManager()` in `server/core/save.ts`. Note the one
deliberate exception: **`POST /api/match/finish` is not guarded.** It only
commits a match already in flight, and dismissal is decided by
`settleBoardForMatchday()` at the end of that same call — guarding it would make
the client's retry-on-failure path 403 on a result the server had in fact
already saved. Blocking `start`, `advance` and `changes` is what actually
prevents a new result being produced.

Starting a new game clears the flag.

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
      "teamId": 3,
      "injuredMatches": 0
    },
    ...
  ],
  "formation": { "GK": 1, "DF": 4, "MF": 3, "FW": 3 },
  "startingXi": [42, 51, ...],
  "bench": [77, 88, ...],
  "lineupAutoSelected": false
}
```

`startingXi`/`bench` are already resolved with injured players excluded — see [tactics.md § Lineup Resolution and Auto-Select](../functional/tactics.md#lineup-resolution-and-auto-select) — so a client never needs to filter `squad` by `injuredMatches` itself for lineup purposes; it's only exposed for display (e.g. the Dashboard's "Injured · {n}" badge).

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

### `GET /api/team/:id/contract?playerId=<number>`
What this player wants to sign for.

Serves two people: the club's own contracted players (a renewal) and **any free agent** (a signing). The demand curve is priced identically for both — what differs is only whether a fee is involved, which is the caller's business — so one panel, `ContractModal`, covers both.

**Response:**
```json
{
  "player": { "id": 42, "name": "…", "age": 29, "position": "MID", "skillLevel": 81,
              "marketValue": 14000000, "wage": 12000, "contractUntilSeason": 3 },
  "season": 3,
  "freeAgent": false,
  "seasonsRemaining": 0,
  "expiring": true,
  "baseDemand": 15400,
  "maxSeasons": 4,
  "options": [{ "seasons": 1, "wage": 17900 }, { "seasons": 2, "wage": 16200 }]
}
```

The **whole demand curve** is returned, not one figure, so the renewal screen can show the wage against every contract length at once — the trade-off between paying more for a short deal and committing long is the decision, and it should be visible rather than discovered by trial offers.

**Errors:** `400` if `id` or `playerId` is missing; `403` unless `:id` is the club the player manages; `404` if the player is neither in that squad nor a free agent, or has retired.

---

### `PUT /api/team/:id/contract`
Offers a player new terms.

**Request body:**
```json
{ "playerId": 42, "wage": 18000, "seasons": 3 }
```

**Response:** `{ "accepted": true, "wage", "seasons", "contractUntilSeason", "maxSeasons", "reason" }`.

**A refusal is a `200`, not an error** — `{ "accepted": false, "required", "maxSeasons", "reason" }`. Turning down an offer is a normal outcome of negotiating, and the response carries what they actually wanted so the manager can meet it rather than guess again.

The new deal runs `seasons` full campaigns from the *current* one (`max(existing, season + seasons − 1)`), so renewing mid-season never shortens cover already in place. An accepted renewal also posts a `contract` news item.

**Errors:** `400` on a missing/negative field; `403` if `:id` is not the manager's club, the save is dismissed, **or the club is under a transfer embargo and the offer is above the player's current wage**; `404` if the player is not in that squad (including retired and free agents).

An embargoed club may still renew, but not improve. Blocking renewals outright would let the embargo cost the manager players for free — the point is to stop them adding to a wage bill they cannot pay, not to strip the squad while they are already broke.

---

### `PUT /api/team/:id/stadium`
Ticket price and stadium expansion — the player's two levers on income.

**Request body:** `{ "ticketPrice": 42 }` and/or `{ "expand": true }`.

**Response:** `{ "success": true, "ticketPrice", "stadiumCapacity", "balance" }`.

Expansion adds `EXPANSION_STEP` (5,000) seats up to `MAX_STADIUM_CAPACITY` (90,000), is paid for immediately, and is posted through the ledger as a `stadium` entry so the balance stays explainable. There is no construction timeline — the game has no calendar granularity finer than a matchday to hang one on.

**Errors:** `400` if the ticket price is outside €5–€120, the stadium is already at maximum, or the club cannot afford the expansion; `403` if `:id` is not the manager's club or the save is dismissed.

---

## Season Endpoints

### `GET /api/season/status`
Where the season has got to. Drives the dashboard's round counter and the end-of-season prompt.

**Response:** `null` if no save, otherwise `{ season, round, totalRounds, fixturesRemaining, playerFixturesRemaining, complete, leader, playerPosition, playerPoints, pointsBehindLeader }`.

`round` is the highest round with any played fixture; `complete` is true when no fixture in the season is unplayed — across *every* league, not just the player's.

---

### `POST /api/season/rollover`
Ends the season and starts the next one. Resolves any outstanding AI fixtures first (the player can finish their own 38 before another club's final-round fixture comes round on the calendar, and the season cannot close with results missing), then runs `rollOverSeason()` in one transaction.

**Response:** a `RolloverSummary` — champions per league, the player's finish and prize money, retirement / youth / release / free-agent-signing counts, the player's own retirements, youth and departures, and the biggest risers and fallers.

**Errors:** `400` if fixtures remain; `403` on a dismissed save. See [season.md § Rollover](season.md#rollover).

---

### `GET /api/season/history`
Past champions and the player's finishing positions, from `season_summary`. Backs `/game/history`.

---

## Finance Endpoints

Six routes, backing the five pages under `/game/finance`. Everything they report is derived from `finance_ledger` rather than recomputed, so a page can never show a total the account did not actually move.

> **None of these blocks on a budget.** The only financial condition that refuses anything anywhere in the API is `game.insolvency_stage >= 2`, and it fires on the bank balance, never on a recommendation. See [economy.md § Insolvency](economy.md#insolvency).

### `GET /api/finance/summary`
Everything the overview needs: where the money is, where it came from, and where it is heading.

**Response:** `null` if no save, otherwise:

| Field | Contents |
|---|---|
| `club` | name, `balance`, `reputation`, stadium name, `stadiumCapacity` and `generalCapacity` (capacity less seats given over to boxes), `hospitalityBoxes`, `ticketPrice` and the `fairTicketPrice` for that reputation |
| `season`, `round`, `totalRounds` | Where the season has got to |
| `wageBill`, `wageBillPerSeason` | Per matchday, and × total rounds |
| `expiringContracts` | Deals running out this summer — wages you keep paying, or players you lose |
| `income`, `expenses`, `net`, `byType` | This season's ledger, totalled |
| `streams` | One row per ledger type: `{ type, label, group, icon, kind, amount, perMatchday, share }`. Labels and groupings come from `STREAM_META` in `shared/finance.ts`, shared with the client so "Commercial" cannot mean two things |
| `turnover`, `runningCosts` | Income net of `RUNNING_COST_TYPES` — the base every wage ratio is taken against |
| `projectedBalance` | Balance at season end at the current per-round rate. `GET /api/finance/projection` is the one that models step changes |
| `wageRatio` | Share of **turnover** going on wages. `null` before any income lands |
| `health` | `{ stage, insolventRounds }` from the `game` row |
| `debt` | `{ count, outstanding, principal, servicePerRound, overdraftPerRound, loans[] }` |
| `preview` | What the current ticket price is doing: `attendance`, `fillPercent`, `gatePerMatch` |
| `expansion` | `step` (5,000), `cost`, `maxCapacity`, `canAfford`, `atMax` |
| `ledger` | This season's rows, newest first, capped at 60 — `{ round, type, amount, description }` |

Only `retired = 0 AND free_agent = 0` players count toward the wage bill.

---

### `GET /api/finance/projection`
The four-season forecast and the budgets derived from it.

**Response:** `null` if no save, otherwise `{ season, round, totalRounds, expectedPosition, leagueSize, projection[], wageBudget, transferBudget }`.

Each entry in `projection` carries `{ season, rounds, partial, income, costs, totalIncome, totalCosts, turnover, net, openingBalance, closingBalance, bestClosing, worstClosing, wageBill, wageRatio, squadSize, flags }`. The first entry covers only the matchdays still to play, because money already spent is in the balance rather than in the forecast.

`wageBudget` is `{ current, healthy, ceiling, headroom, ratio }`; `transferBudget` is `{ safeSpend, buffer, roundsRemaining, projectedClosing }`.

Assembly lives in `forecastForSave()` in `server/core/finance.ts`, not in the handler, so `scripts/verify-economy.ts` measures the same forecast the manager is shown. A projection nobody checks against the season it predicted is decoration, and it can only be checked if the harness and the page compute it identically.

---

### `GET /api/finance/commercial`
The four sponsorship slots, what each is worth at the market rate, the deals currently running, and the offers on the table.

**Response:** slot valuations from `slotValueFor()`, active deals with their fee / term / bonuses, pending offers grouped by slot, the perimeter tier ladder with the next upgrade's price, and the fan-confidence cost of selling naming rights for the first time.

---

### `POST /api/finance/commercial`
Accepting an offer, declining one, or upgrading the advertising boards.

**Request body:** `{ "action": "accept" | "decline", "offerId": 12 }` or `{ "action": "upgrade-perimeter" }`.

Accepting marks the offer `active`, expires every competing offer for that slot, and — for naming rights — renames the ground and applies `NAMING_RIGHTS_FAN_COST` (−9). A perimeter upgrade is paid immediately and posted as a `stadium` ledger entry.

**Errors:** `400` if the offer has lapsed, the slot is already sold, the boards are at maximum, or the club cannot afford the upgrade; `403` on a dismissed save; `404` if the offer no longer exists.

---

### `GET /api/finance/stadium`
The ground: capacity and how much of it the boxes have taken, the typical crowd and what it pays, season-ticket terms with a live preview, box economics, pitch condition and its match penalty, expansion terms, and the diary of offers, bookings and events already held.

---

### `POST /api/finance/stadium`
Every decision about the ground except the ticket price, which stays on `PUT /api/team/:id/stadium`.

**Request body:** one of
```json
{ "action": "season-tickets", "share": 25, "discount": 20 }
{ "action": "build-boxes", "boxes": 4 }
{ "action": "book-event", "eventId": 7 }
{ "action": "cancel-event", "eventId": 7 }
```

Booking an event expires every other offer for that week — the ground cannot host two things in the same one. Boxes cost `HOSPITALITY_BOX_COST` (€300,000) each and are posted as a `stadium` entry.

**Errors:** `400` if the share exceeds 45%, the discount exceeds 35%, the ground is at `MAX_HOSPITALITY_BOXES` (60), the club cannot afford the boxes, the week has already passed, or the booking is not in a state that can be taken or cancelled; `403` on a dismissed save; `404` if the booking no longer exists.

---

### `GET /api/finance/loans`
What the club owes and what more would cost.

**Response:** `{ balance, reputation, season, annualIncome, outstanding, servicePerRound, overdraftPerRound, overdraftRate, rate, limit, minLoan, step, maxShare, terms[], loans[], health }`.

`limit` is `60% of annualIncome − outstanding`, and `annualIncome` is taken from the first **whole** season in the four-season forecast — a partial season would shrink a club's borrowing power the deeper into a season it got, for no reason connected to the club.

---

### `POST /api/finance/loans`
Drawing one down, or paying one off early.

**Request body:** `{ "amount": 8000000, "seasons": 3 }` to borrow, or `{ "action": "repay", "loanId": 3, "amount": 4000000 }` to repay.

A drawdown posts `loan_in`, writes the row with `rate_per_season` from `loanRateFor(reputation, balance)` and a straight-line `repayment_per_round`, and files a `finance` news item. An early repayment posts `loan_repayment` and settles the row when it reaches zero.

**Errors:** `400` below `MIN_LOAN` (€500,000), off the `LOAN_STEP` (€500,000) grid, on a term outside 1–5 seasons, above the borrowing limit, or when the balance will not cover a repayment; `403` on a dismissed save; `404` if the loan is already settled.

---

### `GET /api/finance/facilities`
The academy and the training ground, described by **what they do** rather than by a level number — the whole difficulty of this decision is that neither pays anything back this season, and a page showing only "Academy: 2" would be asking the manager to spend eight figures on a noun.

**Response:** `{ balance, season, maxLevel, upkeepPerRound, upkeepPerSeason, academy, training, health }`, where each facility carries `{ level, tier, nextTier, atMax, cost, canAfford, upkeepPerRound, upkeepAfterUpgrade, current, next }` and `current` / `next` are the concrete effects at that level.

---

### `POST /api/finance/facilities`
**Request body:** `{ "facility": "academy" | "training" }`.

Buys one level, paid immediately and posted as a `stadium` ledger entry, with a `finance` news item that says plainly when the benefit will arrive.

**Errors:** `400` if the facility is already at `MAX_FACILITY_LEVEL` (3) or the club cannot afford it; `403` on a dismissed save.

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

Starting a game rebuilds the world the save runs on, in one transaction: the
`game` row, club news and transfer offers are deleted, then results
(`match_events`, `matches`), `season_summary` and `finance_ledger` are cleared,
every season is marked unfinished, saved lineups are dropped, and season 1's
fixtures are regenerated for every league. Only the `game` row used to be
replaced, so a second save on the same database inherited the first one's played
fixtures — a brand-new game could open on a season that was already over, and
rolling it over would insert a *second* full set of fixtures for a season that
already had them.

Squads are deliberately **not** rebuilt — `match_events` and transfer history
reference those rows — so a new save on a database that has already run several
seasons keeps the ageing, retirements and development those seasons produced.
Run `bun run db:setup` for a completely fresh world.

`currentDate` is set to one second before the season's first kickoff, derived
from the fixture list rather than from the wall clock. See the `GET /api/schedule`
notes for what the old `new Date()` broke.

---

### `GET /api/board`
The board's view of the manager, and the feed explaining it. Backs the
dashboard's confidence meters and the `/game/dismissed` verdict screen.

**Response:** `null` when no save exists, otherwise:
```json
{
  "season": 3,
  "clubName": "Sheffield United",
  "boardConfidence": 25,
  "fanConfidence": 36,
  "confidenceStreak": 5,
  "expectation": 4,
  "expectationText": "finish in the top 4",
  "position": 13,
  "leagueSize": 20,
  "sackingEnabled": true,
  "dismissed": true,
  "dismissedAtSeason": 3,
  "warningThreshold": 40,
  "sackThreshold": 25,
  "sackStreak": 5,
  "news": [{ "id": 91, "season": 3, "round": 12, "category": "board", "tone": "negative", "headline": "…", "body": "…" }]
}
```

The thresholds are returned rather than hardcoded client-side, so the warning
copy can never drift from the rule that actually fires.

**Notes:** `board.ts` had always written both meters and a news row for every
movement in them, and nothing read either — `recentNews()` existed with no
caller. A manager could be dismissed having never once been told they were in
trouble. This is that missing read.

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
homeScore IS NULL
AND played = 0
AND (homeTeamId = playerTeamId OR awayTeamId = playerTeamId)
```

"Upcoming" means **unplayed**, not future-dated. The filter also carried
`matchDate >= game.currentDate`, which tied this list — the one the dashboard
and Matchday steer by — to the virtual calendar, so any drift between the two
silently emptied it. A new save set `currentDate` to the real wall clock while
season 1 is dated from a fixed 2024 start, so from August 2024 onward every
fixture read as already past and a fresh save had no next match at all.

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

A match is no longer resolved with one call. Three routes cooperate — `start`, `advance`, `changes` — sharing the rewind logic in `server/core/match-session.ts`. See [match-engine.md](match-engine.md#persistence-handled-by-the-api-not-the-engine) for the full mechanics.

### `POST /api/match/start`
Kicks off a fresh match, or resumes one already in progress.

**Request body:**
```json
{ "matchId": 77 }
```
If `matchId` is omitted, prefers a fixture already in progress (`matches.state IS NOT NULL`) over the earliest unplayed one by date.

**What it does:**
- **Fresh match:** resolves both XIs (via `resolveLineup`), builds `Team` objects flagging every non-player-controlled club `autoManaged: true`, calls `kickOff()`, and persists the resulting `MatchState` (minute 0) as `matches.state`.
- **Resuming:** returns the persisted `state` plus every `match_events` row for the match (event type ids resolved back to names).

**Response:**
```json
{ "matchId": 77, "state": { "minute": 0, "home": { ... }, "away": { ... } }, "events": [], "resumed": false }
```

**Errors:** Returns `{ "message": "No matches to simulate" }` (200) if there's nothing to start or resume.

---

### `POST /api/match/advance`
Simulates from the given minute to the next break (45 or 90).

**Request body:**
```json
{ "matchId": 77, "fromMinute": 46 }
```

**What it does:**
1. `syncToMinute(matchId, fromMinute)` — rewinds/fast-forwards the persisted state to `fromMinute` by replaying `match_events` since the last snapshot, then **discards** any events past `fromMinute`. This is what lets a pause-and-substitute change the outcome: anything speculatively simulated past the pause point is thrown away.
2. Rebuilds both `Team`s from the synced state's `tacticName` (so a mid-match formation change takes effect).
3. Calls `simulateSegment(..., nextBreakAfter(fromMinute))` and batch-inserts the new events.

Deliberately persists **nothing** about the segment it just simulated — not its end state, and not the result even when the segment runs to minute 90. Only `syncToMinute` writes `matches.state`, and only from events that actually happened. See the note in [match-engine.md](match-engine.md#persistence-handled-by-the-api-not-the-engine).

> **Why finalisation is not here.** The second-half segment is simulated the instant the manager leaves half time — roughly 45 real seconds before the clock reaches 90, and a pause anywhere in that stretch rewinds and re-simulates the rest. Committing the result at simulation time nulled `matches.state` for the whole second half, so every mid-second-half pause failed with `400 Match has not started`. [`POST /api/match/finish`](#post-apimatchfinish) does it once the clock genuinely arrives.

**Response:**
```json
{
  "events": [
    { "minute": 46, "eventType": "cross", "teamId": 3, "playerId": 42 },
    ...
  ],
  "state": { "minute": 90, "home": { ... }, "away": { ... } },
  "toMinute": 90
}
```

---

### `POST /api/match/finish`
Full time — commits the result and settles fitness. Called by the client when its clock actually reaches minute 90.

**Request body:**
```json
{ "matchId": 77 }
```

**What it does:**
1. If the match is already finalised (`played = 1` and `state` null) it returns immediately — this is **idempotent**, so a refresh at 90' that resumes into a finished match doesn't error.
2. Otherwise `syncToMinute(matchId, 90)`, then in one transaction: commits `homeScore`/`awayScore`/`played = 1`, nulls `matches.state`, advances `game.currentDate`, and settles fitness for every player in either squad:
   - `players.stamina` is set to `recoveredStamina(endOfMatchStamina)` — the flat `+10` recovery applied on top of wherever the match left them, capped at 100. See [match-engine.md § Fatigue and Stamina](match-engine.md#fatigue-and-stamina).
   - `players.injured_matches` is decremented by 1 (floor 0) for anyone already carrying one; anyone who went into this match's `injured` set gets it set fresh to a random 2–4. See [match-engine.md § Injuries](match-engine.md#injuries).

**Response:**
```json
{ "finished": true, "alreadyFinished": false, "homeScore": 2, "awayScore": 1 }
```

**Errors:** `400` if `matchId` is missing, `404` if the match doesn't exist.

---

### `POST /api/match/changes`
Applies the player's substitutions and/or a formation change at a pause.

**Request body:**
```json
{
  "matchId": 77,
  "atMinute": 63,
  "substitutions": [{ "playerOutId": 42, "playerInId": 51 }],
  "tactic": "4-3-3"
}
```

**What it does:**
1. Confirms the caller manages one of the two teams (`game.playerTeamId`).
2. `syncToMinute(matchId, atMinute)`.
3. Applies the changes via `applyMidMatchChanges()`, which validates each swap with `substitutionError()` **after folding in the ones before it**, and persists the result. A failure throws before anything is written, so it's a `400`, never a partial application.
4. Records one `substitution` event per swap (`playerId` = coming on, `relatedPlayerId` = going off) at `atMinute`.

> **Validation has to fold as it goes.** An earlier version pre-checked the whole batch against a single frozen snapshot of the side. That rejected legitimate chained substitutions — bringing a player on and then taking them off again in the same batch reads as "that player is not on the pitch" — and conversely let a batch exceed `MAX_SUBSTITUTIONS`, because `subsUsed` never advanced between checks. `applyMidMatchChanges()` is now the single validation path.

**Response:**
```json
{ "state": { ... }, "events": [{ "minute": 63, "eventType": "substitution", "teamId": 3, "playerId": 51, "relatedPlayerId": 42 }] }
```

**Errors:** `400` for an illegal substitution or an unknown tactic name; `403` if the caller doesn't manage either team in the match.

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
The transfer market.

**Query params:**
- `query` (optional) — substring search against `players.name` using SQL `LIKE %query%`

**Filters applied:**
- `retired = 0` — a retired player must never appear on the market.
- Not at the player's own club, **unless they are a free agent**. A released player keeps his old `team_id`, so a plain "not at your club" filter would make re-signing someone you released impossible — which is the whole point of letting a contract lapse.

**Response:** `Array<Player & { freeAgent: boolean; fee: number; teamName: string; teamReputation: number }>`. `fee` is `0` for a free agent and `marketValue` otherwise; for a free agent `teamName` reads as the club that released them.

**Notes:** returns everyone matching when `query` is empty. This is the data source for the Transfers page — which does not yet read `freeAgent`/`fee`, so a free agent is listed at a fee of 0 but still charged `marketValue` by `POST /api/transfers`. See [transfers.md](../functional/transfers.md#transfer-market-search).

---

## Transfer Endpoints

### `POST /api/transfers`
Executes a sale, a purchase, or a free-agent signing.

**Request body:**
```json
{ "playerId": 42, "action": "sell" }
{ "playerId": 99, "action": "buy" }
{ "playerId": 77, "action": "sign", "wage": 85831, "seasons": 3 }
```

All three settle through `settleTransfer()` in `server/core/market.ts`, which moves the player, posts the ledger pair, applies the fan reaction and writes the news item in one transaction. Every response carries `fanConfidence` — the meter's new value when the move was notable enough to move it, `null` otherwise.

#### Sell flow
1. Finds eligible AI buyer teams: not the seller's team, not the player's team, `bankBalance > marketValue`.
2. Scores each candidate by `skillGap` (|team position avg skill − player skillLevel|).
3. Prefers buyers with `skillGap ≤ 8`; falls back to the 5 closest-fit teams.
4. Picks a random buyer from the pool.
5. Computes `transferValue = marketValue × (1 + premium)` where premium is 5–50% based on the buyer's relative strength.
6. Settles: move player, ledger pair, `marketValue` raised to the fee, fan reaction, news.

**Sell response:**
```json
{ "success": true, "buyerTeam": "Chelsea", "salePrice": 21500000, "fanConfidence": 61 }
```

#### Buy flow
1. Verifies the player is not already on the player's team, and is not a free agent (`400` — sign him on terms instead).
2. Checks `buyerTeam.bankBalance >= player.marketValue`.
3. Settles at current `marketValue` (no premium on buys). The player keeps his existing wage and contract.

**Buy response:**
```json
{ "success": true, "buyerTeam": "Arsenal", "sellerTeam": "Manchester City", "purchasePrice": 18000000, "fanConfidence": 73 }
```

#### Sign flow (free agents only)
Requires `wage` and `seasons`, judged by `evaluateOffer()` — the same demand curve `GET /api/team/:id/contract` publishes for that player.

**A refusal is a `200`, not an error:**
```json
{ "success": false, "accepted": false, "required": 85831, "maxSeasons": 5, "reason": "He wants at least €85,831 per matchday over 3 seasons." }
```

**Acceptance:**
```json
{ "success": true, "accepted": true, "freeTransfer": true, "buyerTeam": "Arsenal",
  "previousTeam": "Manchester City", "wage": 85831, "seasons": 3, "contractUntilSeason": 3, "fanConfidence": 65 }
```

No fee changes hands and no ledger row is written; `free_agent` clears and the agreed terms are stored.

**Errors:**
- `400` — invalid action, player already on your team, insufficient funds, retired player, or a free/contracted mismatch for the action used
- `403` — the save is dismissed, or **the club is under a transfer embargo** (`game.insolvency_stage >= 2`) and the action is `buy` or `sign`
- `404` — player or team not found

**Selling is never blocked**, embargo or not. It is how a club gets out of one.

---

### `GET /api/transfers/offers`
Bids currently on the table for the manager's players.

**Response:** `Array<{ id, amount, round, roundsRemaining, fromTeamName, fromTeamReputation, premiumPercent, player }>`, newest first. `roundsRemaining` counts down to the bid lapsing; `premiumPercent` is how far the fee sits above (or below) the player's valuation. Bids whose player has since retired or moved on are filtered out.

Returns `[]` when there is no save.

---

### `POST /api/transfers/offers`
Accepts or rejects a bid.

**Request body:**
```json
{ "offerId": 12, "action": "accept" }
```

**Response:** `{ "success": true, "accepted": false }` on a rejection, or on acceptance `{ "success": true, "accepted": true, "playerName", "buyerTeam", "fee", "fanConfidence" }`.

Accepting settles through the same `settleTransfer()` a manual sale uses, sets the player's `market_value` to the fee, and expires every other pending bid for him.

**Errors:** `400` on a missing `offerId` or invalid action; `403` on a dismissed save; `404` if the bid is no longer pending — which is also what a second answer to the same bid gets.

See [transfers.md § Offers for Your Players](../functional/transfers.md#offers-for-your-players) for how bids are generated.

---

### `GET /api/transfers/history`
The manager's completed transfer business, newest first.

**Response:**
```json
[{ "id": 8, "season": 1, "round": 7, "direction": "out", "fee": 10065959,
   "description": "David Raya sold to Everton", "createdAt": "…" }]
```

`direction` is `in` (a player joined) or `out` (a player left); `fee` is always positive. **Derived from `finance_ledger`** rather than a transfers table — every transfer posts `transfer_in`/`transfer_out` rows carrying the fee, matchday and counterparty already. This was previously a stub returning `[]`.

---

## Error Format

All errors follow Nuxt's `createError` format:
```json
{
  "statusCode": 400,
  "statusMessage": "Human-readable error description"
}
```
