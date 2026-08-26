# Transfers

The transfer system lets the player buy players from AI clubs or sell players from their own squad.

---

## Transfer Market Overview

| Action | Where | Endpoint |
|---|---|---|
| Sell a player | `/game/team` (Squad page) | `POST /api/transfers { playerId, action: 'sell' }` |
| Buy a player | `/game/transfers` (Transfer market) | `POST /api/transfers { playerId, action: 'buy' }` |
| Sign a free agent | `/game/transfers` → contract talks | `POST /api/transfers { playerId, action: 'sign', wage, seasons }` |
| Answer a bid for your player | `/game/transfers` (Offers inbox) | `POST /api/transfers/offers { offerId, action }` |
| View history | `GET /api/transfers/history` | Derived from the ledger |

All three write actions settle through one function, `settleTransfer()` in `server/core/market.ts`, so the money, the ledger, the fan reaction and the news item cannot drift apart between a purchase, a sale and an accepted bid.

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

`settleTransfer()` moves the player and posts a **matched pair of ledger entries** — see [Transfers and the ledger](#transfers-and-the-ledger) — then applies the fan reaction and the news item, all inside one transaction.

Market value is **updated upward** on sell — the player becomes more expensive in future transfers.

### 4. Response
```json
{ "success": true, "buyerTeam": "Chelsea", "salePrice": 21500000, "fanConfidence": 61 }
```
`fanConfidence` is the meter's new value when the move was notable enough to move it, `null` otherwise.

---

## Buying a Player

### 1. Trigger
The player searches for a player on `/game/transfers` and clicks **Buy**.

### 2. Confirmation
An `AppConfirmModal` showing the fee and the balance after. (This replaced a native `confirm()` box.)

### 3. Validation (`action: 'buy'`)
- Player must not already belong to the player's team.
- `playerTeam.bankBalance >= player.marketValue`.

### 4. Transaction (DB)

The same `settleTransfer()` path as a sale, with the ledger pair mirrored — the manager's club takes the `transfer_in` debit, the selling club the `transfer_out` credit.

**Buy price = current `marketValue` with no premium.** The buyer pays face value. A bought player carries his existing wage and contract across; there is no renegotiation on arrival.

### 5. Response
```json
{ "success": true, "buyerTeam": "Arsenal", "sellerTeam": "Manchester City", "purchasePrice": 18000000, "fanConfidence": 73 }
```

After a successful buy the search results and budget refresh, and the bought player no longer appears on the market.

---

## Signing a Free Agent

A free agent (`players.free_agent = 1`) is unattached: released at a rollover, still carrying his old `team_id` so the market can show who let him go. He costs **no fee** — only a wage — so signing him is a negotiation rather than a purchase.

The transfer market lists him with a **Free agent** badge, `fee: 0`, and a **Talk terms** button that opens the same `ContractModal` the Team page uses for renewals, in `mode="sign"`. `GET /api/team/:id/contract` serves the demand curve for any free agent as well as for the club's own players, so both sides of the panel are priced by one function.

```
POST /api/transfers { playerId, action: 'sign', wage, seasons }
```

- **A refusal is a `200`, not an error**: `{ success: false, accepted: false, required, maxSeasons, reason }`. The response carries what he actually wanted, so the manager can meet it rather than guess.
- On acceptance the player joins for nothing, `free_agent` clears, and the agreed `wage` / `contract_until_season` are written. No ledger entry, because no cash moved — the wage flows through matchday settlement like any other.

> **This was half-built.** `GET /api/players/search` already returned `freeAgent` and `fee: 0`, and the page ignored both — a free agent was listed at a fee of zero and then charged full `marketValue` by the buy path, which also failed to clear his `free_agent` flag.

---

## Market Value Rules

| Situation | Effect on market value |
|---|---|
| Player sold to AI | `marketValue` increases to `transferValue` (includes premium) |
| Player bought by player | `marketValue` unchanged |
| Between seasons | **Recomputed** for every survivor at the rollover by `marketValueFor(skillLevel, age, potential)` — ageing and development move it every year. See [season.md § Market value](../technical/season.md#market-value) |

---

## Transfer Market Search

`GET /api/players/search?query=`

- Server-side `LIKE %query%` on `players.name`.
- **Always excludes retired players** (`retired = 0`) — they must never appear on the market.
- Excludes the player's own squad, **except free agents**: a released player keeps his old `team_id`, so a plain "not at your club" filter would make re-signing someone you released impossible.
- Returns everyone matching when the query is empty.

Each result is enriched with `teamName`, `teamReputation`, `freeAgent` (boolean) and `fee` — `0` for a free agent, `marketValue` otherwise. The page reads all four: a free agent carries a badge, shows "No fee — wages only" in place of a price and budget bar, and opens contract talks instead of a purchase confirmation.

The search input is debounced (350 ms) client-side. No minimum character threshold — an empty string returns everyone.

---

## Budget Display

Available budget is shown at the top of the Transfers page. It is fetched via `useAsyncData` watching `playerTeamId`, which prevents the balance from going stale (the common bug where it showed `€0` was caused by a plain `useFetch` that wasn't re-evaluated after the game store initialised).

---

## Sell Limitations

| Constraint | Enforced by |
|---|---|
| No AI buyer found | Server returns `400 "No team can afford this player"` |
| Player doesn't belong to the player's team | Server returns `400 "You can only sell players in your active squad"` |
| Minimum goalkeepers | Sale blocked if the post-sale squad would have fewer than 2 goalkeepers |
| Minimum defenders | Sale blocked if the post-sale squad would have fewer than 5 defenders |
| Minimum midfielders | Sale blocked if the post-sale squad would have fewer than 5 midfielders |
| Minimum forwards | Sale blocked if the post-sale squad would have fewer than 2 forwards |
| Minimum total squad | Sale blocked if the post-sale active squad would have fewer than 16 players |
| Accepted AI bid | Uses the same squad-floor guard as a manual sale |
| Manager has been dismissed | `requireActiveManager()` returns `403 "You were dismissed. This save is closed."` |

The position floors are checked against the **post-sale** squad, using the
normalized position aliases shared with lineup selection. Injured players still
count as squad members until they are retired or released. The complete policy
lives in `frontend/shared/squad-rules.ts` and is checked inside the transfer
transaction, so a stale browser or two simultaneous sale requests cannot bypass
the limits. A blocked sale returns HTTP 400 and the Team page shows a `Sale
blocked` toast explaining the applicable minimum and projected remaining count.

The same rule applies when accepting an AI bid. New AI offers are not generated
for players whose departure would violate the floor, and an older pending offer
is rechecked when accepted.

---

## Offers for Your Players

AI clubs bid for the manager's squad. Bids live in `transfer_offers` and are driven by `server/core/market.ts`.

### When they arrive

`runTransferMarket(season, round)` runs at the end of every matchday, from `POST /api/match/finish`, **after** the board has settled — so a bid always lands against a table that already reflects the round just played. It does two things: lapse bids older than `OFFER_LIFETIME_ROUNDS` (3), then possibly create one new bid.

Generation is deliberately restrained — a club fielding four bids a week would be running an auction house rather than a season:

| Rule | Value |
|---|---|
| Chance of any interest per matchday | 45% |
| New bids per matchday | At most 1 |
| Pending bids at once | At most 4 |
| Squad floor below which nobody bids | 16 players |
| Who is targeted | A random pick from the better half of the squad, never someone already bid for |
| Who bids | Any club that can afford the fee and whose best player is no more than 4 skill above the target — a club does not bid for someone who would not get into its side |
| Fee | `marketValue × (1 + premium)`, premium `0.08 + reputation × 0.30 + random(0, 0.12)` |

Bids are announced in the news feed, and are also cancelled implicitly: accepting one expires every other pending bid for the same player.

### Answering

```
POST /api/transfers/offers { offerId, action: 'accept' | 'reject' }
```

`GET /api/transfers/offers` lists what is on the table — the player, the bidding club, the fee, how far above his valuation it sits, and how many matchdays remain to decide. The transfers page renders it as an inbox above the market, with Accept / Reject per bid. A bid whose player has since retired or moved on is filtered out rather than shown as answerable.

Accepting settles through the same `settleTransfer()` as a manual sale, so the ledger pair, the fan reaction and the news item are identical however the player left. The fee also becomes the player's new `market_value` — a club that just paid it has repriced him.

> **`transfer_offers` used to be dead schema.** It was declared, and cleared by `seed.ts` and `POST /api/game/start`, but nothing ever inserted or read a row — no AI club took any interest in the manager's squad.

---

## Transfer History

```
GET /api/transfers/history
```

The manager's completed business, newest first: `{ season, round, direction, fee, description, createdAt }`, where `direction` is `in` (a player joined) or `out` (a player left) and `fee` is always positive.

**Derived from `finance_ledger`,** not from a transfers table. Every transfer posts `transfer_in` / `transfer_out` rows that already record the fee, the matchday and a description naming the other club, so reading them back is the whole feature. This was previously a stub returning `[]` with a note that "in a real application you would create a transfers table" — the ledger made one unnecessary.

---

## Transfers and the ledger

Every money movement in the game — wages, gate receipts, sponsorship, prize money, stadium expansion and now transfers — is posted through `finance_ledger`, so the finance page can explain the balance rather than merely assert it.

Ledger semantics for a transfer are by **player direction**, mirrored across the two clubs:

| Type | Meaning | Sign |
|---|---|---|
| `transfer_in` | A player joining | Negative (cash out) |
| `transfer_out` | A player leaving | Positive (cash in) |

So one move writes exactly two rows — a `transfer_out` credit to the seller and a `transfer_in` debit to the buyer — which **net to zero across the world**. That is the property that makes the ledger auditable, and it is verified: after a buy and a sale, the sum of every transfer row in the database is 0.

A free-agent signing writes no rows at all, because no cash moves.

> **Transfers used to bypass the ledger entirely.** `POST /api/transfers` updated `teams.bank_balance` directly, so `transfer_in` and `transfer_out` were declared in `LEDGER_TYPES` and never written — a balance rebuilt from the ledger disagreed with the stored one for any club that had traded, which defeats the point of keeping a ledger.

---

## Fan reaction

Selling or signing a notable player moves fan confidence immediately, through `transferReaction()` and `nudgeFans()` in `server/core/board.ts`.

The reaction scales by how good the player was **relative to the best player at the club**: below roughly 90% of that standard nobody much minds, and the effect grows sharply above it. Selling is weighted harder than buying (`−12` against `+8` per unit of standing), because supporters notice a departure more than an arrival.

It is applied directly rather than through a target, since it is a reaction to an *event* rather than to a state — the matchday easing then pulls the meter back toward whatever the league table says, so a shock fades if results hold up. Only the manager's own business counts; AI-to-AI moves move nothing.

> **Both functions previously had no callers.** Selling the best player at the club moved nothing at all.
