# Database Schema

The database is SQLite, managed by Drizzle ORM. The schema is declared in `frontend/server/db/schema.ts`. Migrations live in `frontend/server/db/migrations/`.

---

## Entity-Relationship Overview

```
countries ──< leagues ──< teams ──< players
                                └── matches (home/away FK to teams)
                                      └── match_events (FK to matches, players, teams, event_type)
                           teams ─── game (playerTeamId FK)
                           teams ──< finance_ledger
                           teams ──< season_summary (champion / player FK)
                           teams ──< transfer_offers (from/to FK)
                           teams ──< sponsorship_deals   (player's club only)
                           teams ──< stadium_events      (player's club only)
                           teams ──< loans               (player's club only)
                        players ──< transfer_offers
season ──< matches
season ──< game
season ──< season_summary
club_news                          (standalone — no foreign keys)
```

---

## Tables

### `countries`

Stores the real-world countries available in the game.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | Auto-increment surrogate key |
| `name` | TEXT | NOT NULL, UNIQUE | Country name (e.g. "England") |

**Seed data:** England, Spain.

---

### `leagues`

Each league belongs to one country.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | Auto-increment surrogate key |
| `name` | TEXT | NOT NULL | League display name (e.g. "Premier League") |
| `country_id` | INTEGER | NOT NULL, FK → countries.id | Parent country |

**Seed data:** Premier League (England), La Liga (Spain).

---

### `teams`

Clubs that compete in a league. Both player-controlled and AI-controlled teams share this table.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | Surrogate key |
| `name` | TEXT | NOT NULL | Club name |
| `league_id` | INTEGER | NOT NULL, FK → leagues.id | Which league the team competes in |
| `bank_balance` | INTEGER | NOT NULL, DEFAULT 1000000 | Current cash balance, in euros |
| `tactics` | TEXT | nullable | Name of the selected tactic (e.g. "4-4-2") |
| `lineup` | TEXT | nullable | Selected starting XI, stored as a JSON array of `players.id` (e.g. `"[12,45,...]"`) |
| `reputation` | INTEGER | NOT NULL, default `50` | Club standing 0–100, derived at seed from squad strength and league rank |
| `stadium_name` | TEXT | nullable | Ground name, generated at seed from the club name |
| `stadium_capacity` | INTEGER | NOT NULL, default `20000` | Seats. Sized from reputation at seed; expandable in `EXPANSION_STEP` (5,000) blocks up to `MAX_STADIUM_CAPACITY` (90,000) |
| `ticket_price` | INTEGER | NOT NULL, default `30` | Price per ticket, €5–€120. The player's main revenue lever |
| `stadium_base_name` | TEXT | nullable | The ground's original name, preserved while naming rights are sold so it can be restored at expiry |
| `perimeter_level` | INTEGER | NOT NULL, default `0` | Advertising boards, 0–3: static → LED → premium LED → full-wrap |
| `hospitality_boxes` | INTEGER | NOT NULL, default `0` | Executive boxes built, up to `MAX_HOSPITALITY_BOXES` (60). Each converts 12 general seats |
| `academy_level` | INTEGER | NOT NULL, default `1` | Youth academy, 0–3. Drives graduate quality and, at level 3, an extra graduate a summer |
| `training_level` | INTEGER | NOT NULL, default `1` | Training ground, 0–3. Drives development, decline, stamina recovery and injury recovery |
| `season_ticket_share` | INTEGER | NOT NULL, default `0` | Share of general capacity sold in advance, 0–45% |
| `season_ticket_discount` | INTEGER | NOT NULL, default `20` | Discount on those seats, 0–35% |
| `pitch_condition` | INTEGER | NOT NULL, default `100` | 0–100. Worn by non-matchday events, recovers 9 a matchday, floors at 25 |

**`reputation` is the single input the whole economy hangs off.** It sizes the stadium, sponsorship and prize money, sets the fair ticket price and the starting balance, and seeds the board's expectations — so a big club earns more and is expected to achieve more. See `server/core/economy.ts`.

**Notes:**
- `bank_balance` is seeded twice: an initial random 1,000,000–50,000,000 at insert, then **overwritten** by the economy pass with `startingBalanceFor(reputation, capacity)` once every squad exists (reputation is partly a club's rank within its league, so it cannot be known until then).
- `tactics` is `NULL` until the player (or simulation) sets one; the match engine falls back to `DEFAULT_TACTIC_NAME` (4-4-2) when `NULL`. A saved value persists between matchdays.
- The seven venture columns (`perimeter_level` through `pitch_condition`) exist on **every** club but are only ever read for the manager's. CPU clubs take a single blended `sponsorship` credit instead of itemised streams, and that credit is calibrated to net the same — see [economy.md](economy.md#the-commercial-pool).
- `stadium_base_name` is populated at seed from `stadiumNameFor()` and is what `expireDeals()` restores `stadium_name` to when a naming-rights deal runs out.
- `lineup` is `NULL` until the player saves an XI via `PUT /api/team/:id/lineup`. AI-controlled teams never set it, so they are always auto-selected. A saved lineup persists between matchdays and is only honoured if it still resolves to exactly 11 valid squad members at read time (e.g. a sold or newly injured player invalidates it) — see [match-engine.md](match-engine.md) for the resolution logic shared between the client and the engine.
- In-match substitutions and tactic changes update `matches.state`, not these two columns. Finishing a match clears the live state without overwriting the saved pre-match combination. A season rollover clears `lineup` because retirements and departures can invalidate player ids; it does not reset a valid saved tactic.

---

### `positions`

Lookup table for positional abbreviations.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | Surrogate key |
| `name` | TEXT | NOT NULL, UNIQUE | Abbreviation: `GK`, `DEF`, `MID`, `ATT` |

**Note:** This table exists but is not currently referenced by foreign key from `players`. The `players.position` column stores the string directly.

---

### `players`

Individual footballers. Each player belongs to exactly one team.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | Surrogate key |
| `name` | TEXT | NOT NULL | Full name |
| `age` | INTEGER | NOT NULL | Age in years |
| `position` | TEXT | NOT NULL | One of: `GK`, `DEF`, `MID`, `ATT` (seed data) or `Goalkeeper`/`Defender`/`Midfielder`/`Forward`/`Attacker` (match-engine internal labels) |
| `skill_level` | INTEGER | NOT NULL | Overall rating. Real seed players carry their dataset value; generated squads draw 50–79. Development clamps to `[40, min(potential, 99)]` |
| `stamina` | INTEGER | NOT NULL | 0–100, initialised to 100 for all players. Written at the end of every match this player took part in — see below |
| `market_value` | INTEGER | NOT NULL | Transfer value, in euros |
| `team_id` | INTEGER | NOT NULL, FK → teams.id | Current club. Kept even for retired and released players — for a free agent it reads as "released by" |
| `injured_matches` | INTEGER | NOT NULL, default `0` | Matches remaining before this player is selectable again. `0` = fit |
| `potential` | INTEGER | NOT NULL, default `0` | Skill ceiling. Development moves `skill_level` toward it and never past it. See [season.md](season.md#progression) |
| `retired` | INTEGER | NOT NULL, default `0` | `1` once retired at a rollover. **Rows are kept, never deleted** — `match_events.player_id` references them |
| `wage` | INTEGER | NOT NULL, default `0` | Wage **per matchday**, not per week. A season is 38 matchdays, the only cadence money moves on, so every financial figure stays in one unit. Zeroed on retirement and release |
| `contract_until_season` | INTEGER | NOT NULL, default `1` | Last season this contract covers. Equal to the current season = final year; at the rollover past it the player leaves on a free unless renewed |
| `free_agent` | INTEGER | NOT NULL, default `0` | `1` while unattached and signable for wages alone. Modelled exactly like `retired` — the row keeps its `team_id` and every squad query excludes the flag instead |

**Squad queries filter on three flags, not one.** `retired = 0 AND free_agent = 0` is what "in this club's squad" means — `buildTeam`, `GET /api/team/:id` and the finance wage bill all apply both. The transfer search deliberately does *not* exclude free agents, since re-signing a player you released is the point of letting a contract lapse.

**Position string handling:** The seed file stores abbreviated positions (`GK`, `DEF`, `MID`, `ATT`); some code paths historically expected full English names (`Goalkeeper`, `Defender`, `Midfielder`, `Forward`/`Attacker`). Both forms are now normalised to the canonical `GK | DF | MF | FW` slots by a single shared function, `normalizePosition()` in `frontend/shared/lineup.ts`, used by the match engine, the team/lineup API routes, and the Dashboard/Matchday pages. See [match-engine.md](match-engine.md) for details.

**`stamina` means "what this player starts their next match with".** It's written once, at full time, after that match's drain and the flat between-match recovery are both already applied (see [match-engine.md § Fatigue and Stamina](match-engine.md#fatigue-and-stamina)) — not adjusted again at the next kickoff. The lineup builder and squad pages read this column directly, so what they show is what the engine will actually use.

**`injured_matches` is a separate concept from low stamina, deliberately.** Every player — including one sitting out — recovers `+10` stamina at every full time, so a stamina-based definition of "injured" would clear itself the instant it was applied. `injured_matches` counts down independently: decremented at every full time, and reset to a fresh random 2–4 when an `injury` event lands on that player during a match (see [match-engine.md § Injuries](match-engine.md#injuries)). It's the only thing that blocks lineup selection — low stamina never does, so a squad can never be locked out of naming eleven players.

**Market value calculation.** One function, `marketValueFor(skillLevel, age, potential?)` in `server/core/progression.ts`, used at seed *and* recomputed for every survivor at each rollover — values are no longer set once and frozen:

```
priced  = age < 23 && potential > skillLevel
            ? skillLevel + (potential − skillLevel) × 0.5   // half-price the upside
            : skillLevel
base    = 4036 × e^(0.0919 × priced)                        // exponential in skill
value   = max(50_000, round(base × ageMultiplier(age) × random(0.88, 1.12)))
```

`ageMultiplier` peaks through the mid-twenties and falls away sharply: `≤18 → 0.8`, `≤21 → 0.95`, `≤27 → 1`, `≤30 → 0.85`, `≤33 → 0.6`, `≤36 → 0.35`, `37+ → 0.15`.

---

### `season`

One row per available game season.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | Surrogate key |
| `year` | TEXT | NOT NULL | Calendar year as string (e.g. "2024") |
| `ended` | TEXT | NOT NULL, DEFAULT 'false' | Whether the season is finished. Stored as string `'true'`/`'false'` |

**Seed data:** Years 2024–2030 (7 seasons), all `ended = 'false'`.

---

### `event_type`

Lookup table for match event categories.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | Surrogate key |
| `name` | TEXT | NOT NULL | Event label |

**Seed data:** `goal`, `shot`, `shot_on_target`, `yellow`, `red`, `foul`, `injury`, `corner`, `cross`, `offside`, `substitution`.

Kept in sync with the event types the match engine generates — see `EVENT_RATES` in [match-engine.md](match-engine.md#event-rates). `miss` was removed in migration `0006` (an off-target attempt is already a `shot`); existing `miss` rows were reassigned to `shot` rather than deleted, so no match history was lost. `substitution` was added explicitly in migration `0007_add_match_state.sql` (not generated by the engine, so it needed an explicit row) rather than relying purely on lazy upsert, so its id is stable across a fresh seed and an existing database alike.

Ids are not semantically meaningful — `resolveEventTypeIds()` (`server/core/match-session.ts`, used by all three `/api/match/*` routes) resolves types by **name** and inserts any it doesn't find, so a fresh seed and a migrated database can assign different ids to the same type without affecting behaviour.

---

### `game`

Represents the active save state. Only one row is kept at a time — `POST /api/game/start` deletes all existing rows before inserting a new one.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | Surrogate key |
| `player_team_id` | INTEGER | NOT NULL, FK → teams.id | The club the human player manages |
| `season` | INTEGER | NOT NULL, FK → season.id | Current season. Starts at `1` and is incremented by every rollover |
| `current_date` | INTEGER (timestamp) | NOT NULL | Virtual in-game calendar date |
| `sacking_enabled` | INTEGER | NOT NULL, default `0` | **Write-once.** Chosen on the new-game screen; no endpoint can change it afterwards. Governs only whether the confidence streak ends the save |
| `board_confidence` | INTEGER | NOT NULL, default `65` | 0–100. How secure the manager's position is |
| `fan_confidence` | INTEGER | NOT NULL, default `65` | 0–100. Driven by results, ticket price and notable transfers |
| `board_expectation` | INTEGER | NOT NULL, default `10` | League position the board expects this season |
| `confidence_streak` | INTEGER | NOT NULL, default `0` | Consecutive matchdays spent at or below the sack threshold |
| `dismissed_at_season` | INTEGER | nullable | Set when the manager has been sacked. The save is then read-only and terminal |
| `insolvency_stage` | INTEGER | NOT NULL, default `0` | 0 solvent, 1 overdrawn, 2 transfer embargo, 3 board intervention |
| `insolvent_rounds` | INTEGER | NOT NULL, default `0` | Consecutive matchdays finished with a negative balance |

**`current_date` usage:** the calendar decides which **other** clubs' fixtures are due for headless resolution (`matchDate <= current_date`). After each match it advances to `matchDate + 1 second`; `POST /api/game/start` seeds it to one second before the season's first kickoff, derived from the fixture list.

It deliberately does **not** filter the player's own schedule. `GET /api/schedule` once also required `matchDate >= current_date`, which tied the list the dashboard and Matchday steer by to the calendar cursor — any drift between the two emptied it permanently. `played = 0` is the only thing that decides whether a fixture is still to come.

**`insolvency_stage` is the only financial condition that blocks anything.** Recomputed every matchday by `settleInsolvency()` from `teams.bank_balance` — never from a recommended budget. At stage 2 or above, `assertNotEmbargoed()` rejects incoming transfers and above-current-wage contract offers with a `403`; selling is always allowed, because it is how a club gets out of an embargo. Recovery steps the stage down by one per solvent matchday. See [economy.md § Insolvency](economy.md#insolvency).

**`dismissed_at_season` is enforced, not advisory.** `requireActiveManager()` (`server/core/save.ts`) rejects every world-mutating route with a `403` while it is set, and the route middleware redirects all `/game*` and `/matchday` routes to `/game/dismissed`. See [gameflow.md § The Board](../functional/gameflow.md).

---

### `matches`

One row per fixture in the season schedule.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | Surrogate key |
| `home_team_id` | INTEGER | NOT NULL, FK → teams.id | Home club |
| `away_team_id` | INTEGER | NOT NULL, FK → teams.id | Away club |
| `home_score` | INTEGER | nullable | Goals scored by home team; `NULL` = not yet played |
| `away_score` | INTEGER | nullable | Goals scored by away team; `NULL` = not yet played |
| `played` | INTEGER | NOT NULL, DEFAULT 0 | `1` once the match has been simulated |
| `season` | INTEGER | NOT NULL, FK → season.id | Which season this fixture belongs to |
| `round` | INTEGER | NOT NULL, default `0` | Matchday number within the season, 1-based. Every fixture in a round shares a `match_date` |
| `match_date` | INTEGER (timestamp) | NOT NULL | Scheduled kick-off datetime. Rounds are 7 days apart from a fixed season start |
| `state` | TEXT | nullable | Live `MatchState` JSON (see `shared/match-state.ts`) while the match is paused mid-way. `NULL` when not started or already finished — same convention as `teams.lineup`'s "nothing saved" |

**Determining result:** A match with `home_score IS NOT NULL` (equivalently `played = 1`) is considered fully played. **A match with `state IS NOT NULL` and `played = 0` is in progress** — paused between `POST /api/match/start` and full time. `POST /api/match/start`'s fallback (no `matchId` given) prefers an in-progress match over the next unplayed one by date, so a paused game isn't skipped past.

Current standings and recent form are both derived from these played rows. The standings endpoint reads every club's fixtures in the requested league and season, including headless AI results; recent form is the last five results in round order, returned oldest first. There is no standings-form column or separate persistence table.

---

### `season_summary`

One row per league per completed season, written by the rollover.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | Surrogate key |
| `season` | INTEGER | NOT NULL, FK → season.id | The season that finished |
| `league_id` | INTEGER | NOT NULL, FK → leagues.id | Which league |
| `champion_team_id` | INTEGER | NOT NULL, FK → teams.id | Winner |
| `champion_points` | INTEGER | NOT NULL | Winning points total |
| `player_team_id` | INTEGER | nullable, FK → teams.id | `NULL` when the player's club isn't in this league |
| `player_position` | INTEGER | nullable | Their finishing position |
| `player_points` | INTEGER | nullable | Their points total |
| `completed_at` | INTEGER (timestamp) | NOT NULL | When the rollover ran |

Standings are otherwise computed on the fly from `matches`, which is fine while a season is live but loses everything the moment the next season's fixtures are inserted. This is what survives a rollover.

**Delete order:** this table references `season`, `leagues` and `teams`, so `seed.ts` must clear it before any of them.

---

### `match_events`

Individual events that occurred during a simulated match.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | Surrogate key |
| `match_id` | INTEGER | NOT NULL, FK → matches.id | Parent fixture |
| `minute` | INTEGER | NOT NULL | Game minute (1–90) |
| `event_type` | INTEGER | NOT NULL, FK → event_type.id | Category of event |
| `player_id` | INTEGER | nullable, FK → players.id | Player involved. For `substitution`, the player coming **on** |
| `related_player_id` | INTEGER | nullable, FK → players.id | `substitution` only — the player going **off**. `NULL` for every other event type |
| `team_id` | INTEGER | NOT NULL, FK → teams.id | Team responsible for the event |

**`player_id` is nullable at the schema level, but the match engine always sets it.** Every event the engine generates picks a specific player from the side's on-pitch lineup, weighted by position (e.g. forwards shoot far more often than defenders; defenders and midfielders draw most cards). This matters for card events in particular: a yellow or red now always names *who* was booked, so the client can highlight that player rather than only the team. See [match-engine.md](match-engine.md#which-side-and-which-player).

**`minute` is *no longer* unique within a match.** Before substitutions, the engine's single categorical draw per minute guaranteed no two events shared a `minute`. A manager (or the CPU's own bench review) can now substitute at any minute, including one that already has a drawn event, so two rows can legitimately share a `minute` value. This was never enforced by a database constraint, so no migration was needed — only this note.

---

### `finance_ledger`

Every credit and debit against a club's balance.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | Surrogate key |
| `team_id` | INTEGER | NOT NULL, FK → teams.id | Whose account moved |
| `season` | INTEGER | NOT NULL | Season the entry belongs to |
| `round` | INTEGER | NOT NULL, default `0` | Matchday. `0` for season-boundary items like prize money |
| `type` | TEXT | NOT NULL | Free text; the catalogue is `LEDGER_TYPES` in `server/core/economy.ts` — see below |
| `amount` | INTEGER | NOT NULL | Positive credits the club, negative debits it |
| `description` | TEXT | NOT NULL | Human-readable reason, shown on the finance page |
| `created_at` | INTEGER (timestamp) | NOT NULL | When the entry was written |

The balance could have been a single running number, but then it could only be asserted, never explained. With a ledger the finance page can show *why* money moved.

Every type is written by something. **The column is free text, so adding a stream needs no migration** — only an entry in `LEDGER_TYPES`, and one in `STREAM_META` (`shared/finance.ts`) to give it a label and a grouping.

| Type | Sign | Written by |
|---|---|---|
| `wages` | − | `settleMatchFinances`, every club, every matchday |
| `gate` | + | `settleMatchFinances`, home club — **walk-up trade only** once season tickets are sold |
| `sponsorship` | + | CPU clubs: the blended credit. Manager: the sum of active `sponsorship_deals` |
| `merchandising` | + | `settleMatchFinances`, manager only — club shop, driven by fan confidence and star power |
| `perimeter` | + | `settleMatchFinances`, manager at home — advertising boards |
| `hospitality` | + | `settleMatchFinances`, manager at home — executive boxes |
| `operating` | − | `settleMatchFinances`, manager at home — stewarding, policing, utilities |
| `facilities` | − | `settleMatchFinances`, manager — academy and training-ground upkeep |
| `event_hire` | + | `settleStadiumForRound`, when a booked event is held |
| `season_tickets` | + | `rollOverSeason`, the summer lump |
| `bonus` | + | `paySponsorshipBonuses` at the rollover — champion, top four or survival |
| `prize` | + | `payPrizeMoney` at the rollover |
| `stadium` | − | Expansion, boxes, perimeter upgrades and facility upgrades — all capital |
| `loan_in` | + | `POST /api/finance/loans`, drawdown |
| `loan_repayment` | − | `settleDebtForRound` each matchday, plus any early settlement |
| `interest` | − | `settleDebtForRound` — loan interest, and overdraft interest while the balance is negative |
| `transfer_in` / `transfer_out` | − / + | `settleTransfer`, as a mirrored pair |

`RUNNING_COST_TYPES` — `operating`, `facilities`, `interest`, `loan_repayment` — is the subset netted off income to give **turnover**, which is the base every wage ratio in the game is taken against, including the board's.

Transfers previously bypassed the ledger entirely, leaving those two types declared and unused — see [transfers.md](../functional/transfers.md#transfers-and-the-ledger) for the direction convention and the netting property it buys.

---

### `club_news`

The club's news feed — board and fan reactions, transfers, contracts. Standalone: no foreign keys.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | Surrogate key |
| `season` | INTEGER | NOT NULL | Season the item belongs to |
| `round` | INTEGER | NOT NULL, default `0` | Matchday, `0` for season-boundary items |
| `category` | TEXT | NOT NULL | `board` \| `fans` \| `transfer` \| `contract` \| `result` |
| `tone` | TEXT | NOT NULL, default `'neutral'` | `positive` \| `negative` \| `neutral` |
| `headline` | TEXT | NOT NULL | One-line summary |
| `body` | TEXT | nullable | Detail |
| `created_at` | INTEGER (timestamp) | NOT NULL | Write time |

Board confidence is a number, and a number alone never explains itself. These rows are what turn "confidence fell 6" into "the board expected top four and you are 11th".

Written by `postNews()`, read by `GET /api/board`, and pruned at each rollover — `pruneNews(season)` drops everything from earlier seasons, since the feed is running commentary and `season_summary` is what preserves history.

---

### `transfer_offers`

Bids an AI club has made for one of the manager's players.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | Surrogate key |
| `player_id` | INTEGER | NOT NULL, FK → players.id | Who is wanted |
| `from_team_id` | INTEGER | NOT NULL, FK → teams.id | The club bidding |
| `to_team_id` | INTEGER | NOT NULL, FK → teams.id | The club being bid to |
| `amount` | INTEGER | NOT NULL | Fee offered |
| `season` | INTEGER | NOT NULL | Season the offer was made in |
| `round` | INTEGER | NOT NULL, default `0` | Matchday the offer was made on |
| `status` | TEXT | NOT NULL, default `'pending'` | `pending` \| `accepted` \| `rejected` \| `expired` \| `improved` |
| `created_at` | INTEGER (timestamp) | NOT NULL | Write time |

Written by `runTransferMarket()` at the end of each matchday and read by `GET /api/transfers/offers`. A bid lapses to `expired` after `OFFER_LIFETIME_ROUNDS` (3) matchdays; accepting one also expires every other pending bid for the same player. `improved` is declared but unused — there is no counter-offer flow.

Rows persist across matchdays deliberately: an offer the manager can think about between rounds is a decision, whereas one regenerated on every page load is noise they can reroll until they like it. See [transfers.md](../functional/transfers.md#offers-for-your-players).

---

---

### `sponsorship_deals`

Commercial offers and signed deals, in one table with a `status` — mirroring how `transfer_offers` and settled transfers relate.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | Surrogate key |
| `team_id` | INTEGER | NOT NULL, FK → teams.id | Always the manager's club |
| `slot` | TEXT | NOT NULL | `shirt`, `kit_maker`, `sleeve` or `naming_rights` |
| `sponsor_name` | TEXT | NOT NULL | Fictional partner, drawn per slot from `SPONSOR_POOLS` |
| `base_fee` | INTEGER | NOT NULL | **Per matchday**, like every other figure in this game's money |
| `seasons` | INTEGER | NOT NULL, default `3` | Length of the deal as offered |
| `signed_season` | INTEGER | NOT NULL | Season the deal starts |
| `until_season` | INTEGER | NOT NULL | Last season the deal covers; paid through the rollover past it |
| `bonus_champion` | INTEGER | NOT NULL, default `0` | Paid once at the rollover if the club won the league |
| `bonus_top_four` | INTEGER | NOT NULL, default `0` | Paid once at the rollover for a top-four finish |
| `bonus_survival` | INTEGER | NOT NULL, default `0` | Paid once at the rollover for staying up |
| `status` | TEXT | NOT NULL, default `'offered'` | `offered`, `active`, `expired` or `declined` |
| `round` | INTEGER | NOT NULL, default `0` | Matchday the offer was made, so a stale one can lapse after 4 |
| `created_at` | INTEGER (timestamp) | NOT NULL | |

**Offers persist rather than regenerate per page load**, for the reason `transfer_offers` already documents: an offer that rerolls on refresh is noise, not a decision.

`base_fee` is the slot's market rate scaled by the term (`feeFactorFor()`, which is `contracts.ts`'s `lengthDiscount()` normalised to the standard three-season deal), by `marketAppetite(fanConfidence)`, and by a little per-offer character. The bonus columns are multiples of `base_fee`, so a bigger deal carries proportionally bigger bonuses.

**Rows exist only for the manager's club.** Giving all forty clubs deal rows would mean renewing a hundred and sixty contracts every rollover to produce a number the game sums straight back into one. `createSave()` inserts three opening deals at the market rate — shirt, kit and sleeve, staggered over 3, 4 and 2 seasons — and leaves naming rights unsold, because that one is the actual decision.

---

### `stadium_events`

Non-matchday bookings — the ground earning its keep between fixtures.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | Surrogate key |
| `team_id` | INTEGER | NOT NULL, FK → teams.id | Always the manager's club |
| `season` | INTEGER | NOT NULL | |
| `round` | INTEGER | NOT NULL | The matchday this booking settles against |
| `kind` | TEXT | NOT NULL | `concert`, `international`, `rugby`, `conference` or `community` |
| `promoter_name` | TEXT | NOT NULL | |
| `fee` | INTEGER | NOT NULL | Sized against what a full house is worth (`eventFeeFor`) |
| `pitch_wear` | INTEGER | NOT NULL, default `0` | Points of `teams.pitch_condition` the booking costs |
| `fan_reaction` | INTEGER | NOT NULL, default `0` | Confidence nudge when it is held |
| `status` | TEXT | NOT NULL, default `'offered'` | `offered`, `booked`, `held`, `cancelled` or `expired` |
| `created_at` | INTEGER (timestamp) | NOT NULL | |

**Bookings attach to a round, not a date.** Nothing in this game happens on a day that is not a fixture date, and the stadium is not the exception: as `PUT /api/team/:id/stadium` already puts it, there is no calendar granularity finer than a matchday to hang a timeline on. An event booked "before round 12" settles when round 12 is played.

---

### `loans`

Borrowing. Player's club only, like deals and events — CPU clubs do not borrow, because nothing would read the row back.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | Surrogate key |
| `team_id` | INTEGER | NOT NULL, FK → teams.id | Always the manager's club |
| `principal` | INTEGER | NOT NULL | What was drawn down |
| `outstanding` | INTEGER | NOT NULL | What is still owed. Falls by `repayment_per_round` every matchday |
| `rate_per_season` | REAL | NOT NULL | Annual rate as a percentage — `7.5` means 7.5% |
| `taken_season` | INTEGER | NOT NULL | |
| `term_seasons` | INTEGER | NOT NULL | 1–5 |
| `until_season` | INTEGER | NOT NULL | Last season a repayment falls due |
| `repayment_per_round` | INTEGER | NOT NULL | Straight-line principal, fixed at drawdown |
| `status` | TEXT | NOT NULL, default `'active'` | `active` or `settled` |
| `created_at` | INTEGER (timestamp) | NOT NULL | |

`settleDebtForRound()` is the **only** place `outstanding` falls during a season. It returns ledger entries rather than posting them, so a matchday's whole ledger goes through `postLedger()` in one write — debt service cannot move a balance without appearing in the account it moved.


## Migrations

Drizzle generates incremental SQL migration files in `server/db/migrations/`. `meta/_journal.json` is the authority on which are actually applied — several files on disk are **not** in the journal and are never run.

**Applied, in journal order:**

| idx | Tag |
|---|---|
| 0 | `0000_steady_patriot` |
| 1 | `0001_natural_owl` |
| 2 | `0002_groovy_luke_cage` |
| 3 | `0003_watery_golden_guardian` |
| 4 | `0004_late_quasar` |
| 5 | `0005_stale_human_cannonball` |
| 6 | `0007_add_match_state` |
| 7 | `0008_add_player_injuries` |
| 8 | `0008_public_exiles` |
| 9 | `0009_stale_starbolt` |
| 10 | `0010_last_kate_bishop` |
| 11 | `0011_wonderful_marvel_zombies` |
| 12 | `0012_curved_blizzard` |
| 13 | `0013_amused_vermin` |
| 14 | `0014_wandering_debt` |

**On disk but not in the journal** (superseded by the generated migrations above, kept for history): `0004_add_played_to_matches.sql`, `0005_add_lineup_to_teams.sql`, `0006_rework_event_types.sql`, `0010_contracts_board_market.sql`.

Summary of what the later ones carry:

| File | Summary |
|---|---|
| `0000_steady_patriot.sql` | Initial schema: all core tables |
| `0001_natural_owl.sql` | Follow-up adjustments |
| `0002_groovy_luke_cage.sql` | Further schema changes |
| `0003_watery_golden_guardian.sql` | Additional columns |
| `0004_late_quasar.sql` | Parallel branch migration (same version number as the unapplied `0004_add_played_to_matches.sql`, different content) |
| `0005_stale_human_cannonball.sql` | Adds `teams.lineup` |
| `0007_add_match_state.sql` | Adds `matches.state` and `match_events.related_player_id`; seeds the `substitution` event type |
| `0008_add_player_injuries.sql` | Adds `players.injured_matches`, default `0` |
| `0008_public_exiles.sql` | Adds `players.potential` and `players.retired`, `matches.round`, and the `season_summary` table. Backfills `potential` with age-appropriate headroom so existing saves keep developing |
| `0009_stale_starbolt.sql` | The economy and the board: creates `finance_ledger`; adds `teams.reputation` / `stadium_name` / `stadium_capacity` / `ticket_price`, `players.wage` / `contract_until_season`, and all six `game` board columns (`sacking_enabled`, `board_confidence`, `fan_confidence`, `board_expectation`, `confidence_streak`, `dismissed_at_season`) |
| `0010_last_kate_bishop.sql` | Creates `club_news` and `transfer_offers`; adds `players.free_agent` |
| `0011_wonderful_marvel_zombies.sql` | The commercial layer: adds the seven venture columns to `teams` (`stadium_base_name`, `perimeter_level`, `hospitality_boxes`, `academy_level`, `training_level`, `season_ticket_share`, `season_ticket_discount`, `pitch_condition`) and the two insolvency columns to `game` |
| `0012_curved_blizzard.sql` | Creates `sponsorship_deals` |
| `0013_amused_vermin.sql` | Creates `stadium_events` |
| `0014_wandering_debt.sql` | Creates `loans` |

**Warning:** several files share a version prefix (`0004_`, `0005_`, `0008_`, `0010_`), which indicates migration branch conflicts. `meta/_journal.json` — not the filenames — determines what is applied; see the applied list above. Run `bun run db:push` to bring a database up to date.
