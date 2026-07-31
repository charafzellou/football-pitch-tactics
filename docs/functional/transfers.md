# Transfers

The transfer system lets the player buy players from AI clubs or sell players from their own squad.

---

## Transfer Market Overview

| Action | Where | Endpoint |
|---|---|---|
| Sell a player | `/game/team` (Squad page) | `POST /api/transfers { playerId, action: 'sell' }` |
| Buy a player | `/game/transfers` (Transfer market) | `POST /api/transfers { playerId, action: 'buy' }` |
| View history | (not implemented) | `GET /api/transfers/history` (stub) |

---

## Selling a Player

### 1. Trigger
The player clicks **Sell** on any player in their squad table (`/game/team`).

### 2. AI Buyer Selection (`action: 'sell'`)

The server finds the best AI buyer through a multi-step filter:

**Step 1 — Candidate pool:**
All teams where:
- `teamId ≠ sellerTeam.id`
- `teamId ≠ game.playerTeamId` (cannot sell to yourself)
- `bankBalance > player.marketValue`

**Step 2 — Skill gap scoring:**
For each candidate, compute:
```
comparisonGroup = players at same position in buyer's squad (or all squad if none)
skillGap = |averageSkill(comparisonGroup) − player.skillLevel|
```
Lower `skillGap` = better fit.

**Step 3 — Preferred buyers:**
Teams with `skillGap ≤ 8` are "preferred buyers". If none exist, the 5 teams with smallest `skillGap` are used as fallback.

**Step 4 — Transfer premium:**
```
premium = f(buyerAverageSkill − sellerAverageSkill)
  if delta > +2:  premium = 30–50%  (buyer is stronger → higher demand → player fetches more)
  if delta < −2:  premium = 5–15%   (buyer is weaker → player may be overkill)
  else:           premium = 15–30%  (roughly equal teams)
```

**Step 5 — Affordability check:**
```
transferValue = round(player.marketValue × (1 + premium))
buyerTeam.bankBalance >= transferValue
```
Teams that cannot afford `transferValue` are excluded.

**Step 6 — Final selection:**
A random buyer is chosen from the filtered pool.

### 3. Transaction (DB)
```sql
BEGIN TRANSACTION;
  UPDATE players SET team_id = buyerTeam.id, market_value = transferValue WHERE id = player.id;
  UPDATE teams SET bank_balance = sellerTeam.bankBalance + transferValue WHERE id = sellerTeam.id;
  UPDATE teams SET bank_balance = buyerTeam.bankBalance - transferValue WHERE id = buyerTeam.id;
COMMIT;
```

Market value is **updated upward** on sell — the player becomes more expensive in future transfers.

### 4. Response
```json
{ "success": true, "buyerTeam": "Chelsea", "salePrice": 21500000 }
```
A toast notification displays: `"Player Sold: {name} ({position}) sold for {price} to {team}"`.

---

## Buying a Player

### 1. Trigger
The player searches for a player on `/game/transfers` and clicks **Buy**.

### 2. Confirmation
A browser `confirm()` dialog shows: `"Buy {name} for {price}?"`.

### 3. Validation (`action: 'buy'`)
- Player must not already belong to the player's team.
- `playerTeam.bankBalance >= player.marketValue`.

### 4. Transaction (DB)
```sql
BEGIN TRANSACTION;
  UPDATE players SET team_id = playerTeam.id WHERE id = player.id;
  UPDATE teams SET bank_balance = playerTeam.bankBalance - player.marketValue WHERE id = playerTeam.id;
  UPDATE teams SET bank_balance = sellerTeam.bankBalance + player.marketValue WHERE id = sellerTeam.id;
COMMIT;
```

**Buy price = current `marketValue` with no premium.** The buyer pays face value.

### 5. Response
```json
{ "success": true, "buyerTeam": "Arsenal", "sellerTeam": "Manchester City", "purchasePrice": 18000000 }
```
A toast notification displays: `"Player Bought: {name} signed from {team} for {price}"`.

After a successful buy:
- The search results refresh (the bought player no longer appears).
- The displayed budget updates.

---

## Market Value Rules

| Situation | Effect on market value |
|---|---|
| Player sold to AI | `marketValue` increases to `transferValue` (includes premium) |
| Player bought by player | `marketValue` unchanged |
| Between seasons / over time | Market value **never changes** automatically (no ageing/development system) |

---

## Transfer Market Search

`GET /api/players/search?query=`

- Server-side `LIKE %query%` on `players.name`.
- Always excludes the player's own squad (`ne(players.teamId, game.playerTeamId)`).
- Returns all non-player-team players when query is empty.

The search input is debounced client-side via a `computed` on `searchQuery.value.trim()` that feeds the reactive fetch URL. No minimum character threshold — an empty string returns everyone.

---

## Budget Display

Available budget is shown at the top of the Transfers page. It is fetched via `useAsyncData` watching `playerTeamId`, which prevents the balance from going stale (the common bug where it showed `€0` was caused by a plain `useFetch` that wasn't re-evaluated after the game store initialised).

---

## Sell Limitations

| Constraint | Enforced by |
|---|---|
| No AI buyer found | Server returns `400 "No team can afford this player"` |
| Player doesn't belong to player team | Not enforced on sell — server sells from player's team by looking up `player.teamId` |
| Selling down to 0 players | Not prevented — the player can sell their entire squad |

---

## Transfer History

`GET /api/transfers/history` is a stub that always returns `[]`. No transfers table exists. See `TASKS.md` task #3 for the implementation spec.
