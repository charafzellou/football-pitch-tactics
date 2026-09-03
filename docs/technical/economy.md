# The Economy

Money, and the decisions a manager makes with it. This is the document `season.md` promises when it says the rollover drives modules "documented alongside the economy rather than here".

Eight modules, five of which are pure functions of a club's numbers and can be checked without a database:

| Module | Responsibility | Pure |
|---|---|---|
| `server/core/economy.ts` | Every formula: reputation, attendance, the commercial pool and its parts, running costs, capital prices | ✅ |
| `server/core/projection.ts` | The four-season forecast, and the budget advice derived from it | ✅ |
| `server/core/loans.ts` (formulas) | Interest rate, borrowing limit, repayment schedule, overdraft | ✅ |
| `server/core/progression.ts` | What the training ground and the academy change | ✅ |
| `shared/finance.ts` | Stream names, groupings, health stages — shared by server and client | ✅ |
| `server/core/finance.ts` | `postLedger()` and the matchday money funnel | ❌ |
| `server/core/sponsors.ts` | The commercial market: offers, deals, bonuses, naming rights | ❌ |
| `server/core/stadium.ts` | The diary: promoter approaches, event settlement, pitch condition | ❌ |
| `server/core/insolvency.ts` | Escalating consequences of an overdrawn account | ❌ |

---

## Two invariants

Everything below is built on two rules, and both are enforced by `scripts/verify-economy.ts` rather than by good intentions.

### 1. `postLedger()` is the only writer of `bank_balance`

Outside `server/db/seed.ts` and the save reset in `createSave()`, no code moves a club's balance except `postLedger()` — and it writes the balance movement and the `finance_ledger` row in the same call, deliberately, because they are the same fact. Letting them diverge would make the ledger a lie.

The property this buys is provable: **for every club, `startingBalanceFor(...) + Σ ledger == bank_balance`.** Without it, a balance that looks wrong has no explanation and no way to find one.

### 2. The commercial streams are a decomposition, not an addition

The economy was already calibrated before any of this existed: the table in `economy.ts` targets a 45–75% wage-to-income ratio across four club tiers, and `WAGE_DIVISOR` was swept against the real seeded squads to land it there.

Adding six income streams on top of that would have doubled every club's income and destroyed the ratio the whole game is balanced on. So the streams **split `sponsorshipFor()` up** rather than adding to it:

> At default settings — market-rate sponsors, no naming-rights deal, level-0 billboards, no boxes, no events, no season tickets, no loans — a club's per-matchday **net** equals what it netted before, within 5%.

Every venture past that point is opt-in upside bought with capital, fan goodwill, pitch condition, or debt.

---

## The commercial pool

`sponsorshipFor(reputation, position, leagueSize)` still exists and still returns the single blended figure. What changed is that the manager's club now sees inside it.

```
commercialPoolFor(rep, position, size) = sponsorshipFor(rep, position, size) × COMMERCIAL_UPLIFT
```

`COMMERCIAL_UPLIFT` is **solved, not tuned**. The new cost lines take a share `c` of the pool, so income net of them is `P − P·c`; setting that equal to the old figure `S` gives `P = S / (1 − c)`:

```ts
const DEFAULT_COST_SHARE
  = (OPERATING_BASE + OPERATING_VARIABLE * REFERENCE_FILL) / 2   // half — only home matches
    + FACILITY_UPKEEP_SHARE * DEFAULT_FACILITY_LEVEL * 2         // academy + training ground

export const COMMERCIAL_UPLIFT = 1 / (1 - DEFAULT_COST_SHARE)    // ≈ 1.200
```

A guessed constant would have needed re-guessing every time a cost changed. This one follows.

### Shares of the pool

`COMMERCIAL_SHARES` sums to exactly 1 — that is the point of it.

| Stream | Share | Cadence | Driven by |
|---|---|---|---|
| Shirt sponsor | 38% | every matchday | reputation, position, fan confidence at signing |
| Kit manufacturer | 22% | every matchday | reputation, position |
| Sleeve sponsor | 9% | every matchday | reputation |
| Perimeter advertising | 13% (×2, home only) | home matches | tier, crowd, league position |
| Merchandising | 18% | every matchday | fan confidence, **star power** |

**Naming rights sit outside the 100%**, at `NAMING_RIGHTS_SHARE = 0.12`. A club that has never sold its ground's name earns nothing there, which is what makes selling it a real gain rather than a rearrangement — and what gives the decision something to lose.

### Star power

`starPowerOf(squad)` is the best player's skill, less the squad median, less `REFERENCE_STAR_GAP` (14 — the margin a typical seeded squad manages). Zero is ordinary; positive is a genuine marquee name.

`merchandisingFor()` reads it, so **a marquee signing measurably pays part of his own fee back through the club shop**, visibly, from the matchday after he arrives — and the projection shows it the moment he is signed.

---

## Where the money moves

`settleMatchFinances(tx, homeId, awayId, context)` is the single matchday money path, and it runs identically for the player's club and for the thirty-nine others. `clubEntries()` inside it is the only place they diverge:

- **Every CPU club** takes one `sponsorship` credit, exactly as before.
- **The manager's club** takes a line per stream.

This asymmetry is deliberate and is presentational only. Giving all forty clubs deal rows, hoardings and a club shop would mean renewing a hundred and sixty sponsorship contracts every rollover to produce a number the game then sums straight back into one. The itemised streams are calibrated to net what the single credit nets, so **the human is never structurally ahead of or behind the league for free** — which is check 1 in the verification script.

### The matchday, in order

| Step | Applies to | Notes |
|---|---|---|
| Wages | both clubs | Contracted players only — a released player still carries his old club's `team_id` |
| Partners | manager | Sum of `active` `sponsorship_deals`. An empty slot earns **nothing** |
| Merchandising | manager | Pool share × support × star |
| Facility upkeep | manager | Academy + training-ground levels |
| Debt service | manager | Principal, interest, and overdraft interest — see [Debt](#debt) |
| Perimeter advertising | home | Tier multiplier × crowd × standing |
| Hospitality | home | Boxes × 12 seats × 14× a normal seat, scaled by opponent draw |
| Matchday operating | home | Stewarding, policing, utilities |
| Gate receipts | home | Walk-up trade only; season-ticket holders already paid |

Wages are charged per match rather than per calendar week because **a matchday is the only cadence this game's clock has**. Everything is per matchday, and 38 matchdays is a season.

### Why operating costs are priced off the pool

`matchdayOperatingCostFor(pool, fillRate)` charges a share of the *commercial pool*, not of attendance — which is the unrealistic choice, and it is the right one.

Attendance-proportional was tried first. Gate income is large relative to commercial income at a small club and small at a giant, so an attendance-proportional cost moved the bottom of the table's net by **−15%** while leaving the top **+4%**, and made several clubs structurally loss-making. Pricing it off the pool keeps the deduction uniform across the league — and uniformity is exactly what lets one uplift constant restore every club's net at once. The fill term keeps the realism that mattered: a full house costs more to run.

---

## The commercial market

`server/core/sponsors.ts`. Offers and signed deals live in one table with a `status`, mirroring how `transfer_offers` and settled transfers relate.

**Offers persist rather than regenerate per page load**, for the reason `schema.ts` already gives for bids: an offer that rerolls on refresh is noise, not a decision. They lapse after `OFFER_LIFETIME_ROUNDS` (4) matchdays.

Each open slot draws three competing offers built from `OFFER_SHAPES`, so the trade-off is visible rather than discovered by accepting one:

| Shape | Term | Fee | Champion bonus | Top four | Survival |
|---|---|---|---|---|---|
| Long term | 5 seasons | ×0.936 | ×6 the matchday fee | ×2.5 | ×1.5 |
| Standard | 3 seasons | ×1.000 | ×10 | ×4 | ×2 |
| Short and rich | 1 season | ×1.064 | ×16 | ×7 | ×3 |

A short deal is worth more per matchday *and* carries the largest bonuses; a long one buys certainty at a discount. `marketAppetite(fanConfidence)` scales every offer between ×0.88 and ×1.16, which quietly ties the commercial department to results and to the ticket price without another dial.

**The fee factors are not their own numbers.** `feeFactorFor(seasons)` is `lengthDiscount(seasons)` from `contracts.ts` — the same 3%-a-year curve a player accepts for committing longer — so "security is worth something" means the same thing to a sponsor as it does to a centre-half, and tuning it moves both. It is normalised against the three-season term rather than used raw: `lengthDiscount()` is anchored at one season, and the unnormalised curve would price every ordinary renewal 6% under the market rate that `COMMERCIAL_UPLIFT` is derived from — quietly breaking the calibration invariant through the back door.

Bonuses settle at the rollover next to prize money, because they are the same kind of thing — a verdict on the season that has ended. **A deal in its final season is paid its bonus before it is retired**, which is what makes the short deal's larger bonus worth taking.

### Naming rights

Signing renames `teams.stadium_name`; `stadium_base_name` preserves the original and the name reverts at expiry. Supporters take `NAMING_RIGHTS_FAN_COST` (−9 confidence) the first time the ground's name is sold.

### Perimeter advertising

A capital ladder rather than a negotiation:

| Level | Tier | Multiplier |
|---|---|---|
| 0 | Static hoardings | ×1 |
| 1 | LED boards | ×1.45 |
| 2 | Premium LED | ×1.9 |
| 3 | Full-wrap digital | ×2.4 |

`perimeterUpgradeCost(pool, level)` is **solved from `CAPITAL_PAYBACK_SEASONS` (2.2)**, not picked. Flat prices were tried and are the trap: because commercial income scales with reputation to the power of 3.2, a single price bought a giant a nine-month payback and a small club a five-year one — the same button being a free lunch at one end of the table and a mistake at the other.

---

## The stadium

`server/core/stadium.ts`.

### Non-matchday events

Events attach to a **round**, not a date, and settle in that round's `settleMatchFinances`. The repo's own precedent applies verbatim: there is no calendar granularity finer than a matchday to hang a timeline on, and the stadium is not going to be the exception. An event booked "before round 12" is settled when round 12 is played.

| Kind | Fee | Pitch | Supporters |
|---|---|---|---|
| Stadium concert | ×1.6 a full gate | −22 | indifferent |
| International fixture | ×1.1 | −14 | +2 |
| Rugby match | ×0.85 | −18 | −1 |
| Corporate conference | ×0.25 | untouched | indifferent |
| Community day | ×0.1 | untouched | +4 |

The money and the damage move together on purpose. If the lucrative options were also harmless there would be no decision to make, only a button to press every week.

A promoter approaches with probability `APPROACH_CHANCE_PER_ROUND` (0.55), at most three offers pending, at least `LEAD_ROUNDS` (2) ahead, and only for a week the ground is not already booked.

### Pitch condition

`teams.pitch_condition` runs 0–100, recovers `PITCH_RECOVERY_PER_ROUND` (9) each matchday, and floors at `MIN_PITCH_CONDITION` (25). It has two effects, and they are charged to different people:

| Effect | Who pays | Size |
|---|---|---|
| `pitchPenaltyFor()` — attack and defence | The **home side alone** | Up to `MAX_PITCH_PENALTY` (2.5) |
| `pitchInjuryScaleFor()` — the engine's injury draw | **Both sides** | Up to `MAX_PITCH_INJURY_UPLIFT` (+50%) |

The rating penalty is the home club's alone because it is their ground and their decision: the money from the concert is theirs, so the rutted goalmouth is too. Bounded at a level comparable to a formation choice — enough to feel, never enough to decide a match on its own.

The injury uplift is not, because a cut-up goalmouth does not know who booked the concert and both sides spend ninety minutes on it. It inflates only the injury bucket of `drawKind()`, and the extra probability comes out of the empty remainder of the ticket — the minutes in which nothing happens — so no other event type becomes less likely and none of the match engine's calibration is disturbed. At the floor condition it moves injuries from 0.21 to 0.29 a match: about one extra every nine games, felt over a run of concerts and invisible in any single fixture.

**The pitch is relaid every summer.** `rollOverSeason()` resets every club to 100 and expires any booking that was never held. A surface left at 40 in May is not still at 40 in August, and without the reset a manager who took one concert too many in April would carry the penalty into a season the decision had nothing to do with — the same argument as the pre-season stamina reset.

### Season tickets

`seasonTicketHolders(generalCapacity, share)` is a **floor under the crowd and a hole in the gate at the same time**: holders turn up whatever happens and paid in the summer, so only walk-up trade pays today.

```ts
const attendance = Math.max(naturalAttendance, holders)
const walkUp = Math.max(0, attendance - holders)
const gate = gateReceiptsFor(walkUp, home.ticketPrice)
```

The lump posts at the rollover as `season_tickets`. Capped at `MAX_SEASON_TICKET_SHARE` (45%) and `MAX_SEASON_TICKET_DISCOUNT` (35%). **Arithmetically neutral at a zero share**, which is where every club starts, so existing calibration is untouched by construction.

### Hospitality boxes

`HOSPITALITY_BOX_COST` (€300,000) each, converting `HOSPITALITY_BOX_SEATS` (12) general seats and earning `HOSPITALITY_SEAT_MULTIPLIER` (14) times what those seats would have made, catering included. Up to `MAX_HOSPITALITY_BOXES` (60).

Boxes are the one seat in the ground that does not care what the ticket price is, so they are how a chairman de-risks gate income — bought with capital and with the seats they replace.

---

## Debt

`server/core/loans.ts`. Player's club only, like deals and events; CPU clubs do not borrow because nothing would read the row back.

```
rate      = 4% + (1 − reputation/100) × 6% + (balance < 0 ? 4% : 0)
limit     = 60% of a full season's projected income − outstanding debt
repayment = principal / (termSeasons × 38), straight line
overdraft = |balance| × 12% / 38, per matchday
```

A flat rate would make borrowing strictly good for a big club and strictly bad for a small one, with nothing in between. Pricing it off reputation *and* off whether the account is already overdrawn produces the behaviour that matters: **money is cheapest to the clubs that least need it, and a club borrowing its way out of trouble pays four points more for the privilege** — which is how a cash-flow problem becomes a solvency problem if it is not fixed.

The limit is read from the first *whole* season in the four-season forecast, not from the current one — using a partial season would shrink a club's borrowing power the deeper into a season it got, for no reason connected to the club.

Repayment is straight-line because the term is a promise about when the debt ends. A back-loaded schedule would let a manager take a five-season loan and feel none of it until the season they had already planned around.

`settleDebtForRound()` is the only place `loans.outstanding` falls. It returns entries rather than posting them, so a matchday's whole ledger goes through `postLedger()` in one write.

---

## Insolvency

`server/core/insolvency.ts`. This is the **only place in the financial layer with teeth**.

Every budget in this game advises. None of them can refuse anything, on purpose: a recommendation that blocks is a rule wearing a suggestion's clothes, and a manager who cannot overspend cannot make the mistake the advice exists to warn them about.

The consequences here key on a fact instead — `teams.bank_balance` is below zero.

| Stage | Reached when | What it costs |
|---|---|---|
| 1 | the balance goes negative | overdraft interest every matchday, `finance` news |
| 2 | three consecutive matchdays overdrawn | **transfer embargo**, −5 fan confidence |
| 3 | eight matchdays, or worse than −€15M | the board sells the most valuable saleable player at 80% of his value, −8 fan confidence |

Recovery steps the stage **down by one per solvent matchday** rather than clearing it, so climbing out of a board intervention takes three matchdays in the black — long enough that a one-off windfall cannot cancel a crisis half a season in the making.

A forced sale uses the same universal transfer floors as every other departure: the club must retain at least 16 active players, including 2 goalkeepers, 5 defenders, 5 midfielders, and 3 attackers. The board chooses the most valuable eligible player; if nobody can leave safely, it complains instead. That is a real outcome — **a club can be too broke to be saved by selling.**

The existing negative-balance term in `boardConfidenceTarget()` sits underneath all of this untouched, so sustained insolvency already feeds the confidence streak and the dismissal path with no extra code.

### The only hard blocks in the game

`assertNotEmbargoed(stage)` throws `403` from exactly two places:

| Route | Blocked | Still allowed |
|---|---|---|
| `POST /api/transfers` | `buy`, `sign` | `sell` — it is how a club gets out of an embargo |
| `PUT /api/team/:id/contract` | offers **above** the player's current wage | renewals at or below it |

Renewals are not blocked outright because the point of the embargo is to stop the manager adding to a wage bill they cannot pay, not to strip the squad while they are already broke.

---

## The forecast

`server/core/projection.ts`, DB-free so it can be checked without a database — and so the budget advice and the chart can never disagree, because they are the same calculation read twice.

```ts
projectHorizon(input, seasons = 4) → SeasonProjection[]
```

### Why not `balance + perRound × roundsLeft`

That is what the finance page used to show, and it is wrong in the only way that matters: it is a straight line through a series that does not move in a straight line. **Half a squad coming out of contract, a shirt deal expiring, a loan maturing and a summer of youth wages are all step changes, and every one of them lands at a rollover the linear estimate cannot see.** A manager who plans against the straight line signs a striker in March and discovers in August that he could not afford the renewals.

Each projected season models:

| Step change | Source |
|---|---|
| Contracts expiring and renewing | `requiredWage()` from `contracts.ts` |
| Youth intake filling the squad back to 22 | `SQUAD_TARGET_SIZE` |
| Retirement | `retirementChance()`, as an **expectation** not a coin toss |
| Sponsorship deals expiring | `sponsorship_deals.until_season` |
| Loan maturity and debt service falling away | `loans.until_season` |
| Prize money at the expected finish | `prizeMoneyFor()` |

Two decisions worth naming:

**Retirement is applied as an expectation.** A 35-year-old with a 40% chance of hanging up his boots carries 60% of his wage into the forecast. A projection that rolled the dice would give a different answer every time the page was opened, which is worse than being slightly wrong in a stable direction.

**Lapsed sponsorship slots are re-signed at the market rate.** A club does re-sell its shirt. Forecasting the slot as dead would show every manager a cliff in season three that never actually arrives, and they would plan around a hole that was never there.

The best/worst band comes from a ±4-place finishing range and **compounds across seasons** — three good seasons are further from three bad ones than one is, and a forecast that reset the spread every summer would hide exactly the risk a four-season view exists to show.

### Risk flags

`contracts-expiring`, `deal-expiring`, `loan-maturing`, `wage-ratio-high`, `projected-insolvent`.

### Budget advice

Same module, so the advice and the projection can never disagree.

```ts
wageBudget(projection)     → { current, healthy, ceiling, headroom, ratio }
transferBudget(projection) → { safeSpend, buffer, roundsRemaining, projectedClosing }
```

| Figure | Value | Why |
|---|---|---|
| `healthy` | 60% of turnover ÷ 38 | Advice that only warns once the board is already unhappy is not advice |
| `ceiling` | 75% of turnover ÷ 38 | Below the 85% at which `boardConfidenceTarget()` starts docking confidence |
| `safeSpend` | projected closing balance − buffer | |
| `buffer` | 3 matchdays of wages | |

`affordableFee(safeSpend, roundsRemaining, wagePerMatchday)` in `shared/finance.ts` is the one that answers the actual question. **A signing costs a fee today and a wage every matchday until the season ends**, so a headline transfer budget overstates what is affordable by exactly that second amount: *"€18.4M available — or €12.1M if he earns €40k a matchday"*. Shared so the transfer market, the contract modal and the projection page answer it identically.

**Turnover, not income**, is the base for every wage ratio — including the board's. The manager's club is the only one carrying itemised running costs, and its commercial income is grossed up to fund them. Measuring wages against that gross figure would report a ratio around six points kinder than every CPU club's for nothing the manager did, and six points is most of the distance to the 85% the board punishes at.

---

## Facilities

Two levels of long bet, 0–3 each, with per-matchday upkeep charged through `facilities`.

**Academy** (`academyGrade`, `academyIntakeBonus`) moves a graduate's ability a little and his **ceiling** a lot — +5 potential per level. No academy produces a finished footballer; what a good one produces is a teenager worth being patient with. At level 3 it also yields one graduate beyond the squad's actual shortfall, without which the whole investment would be silent for any club that had not happened to lose players that summer — which is exactly the club most likely to have afforded it.

**Training ground** (`trainingDevelopmentFactor`, `trainingDecayFactor`, `trainingRecoveryBonus`, `injuryRecoveryChance`):

| Effect | Per level |
|---|---|
| Development toward potential | +18% |
| Decline after 30 | −11% |
| Stamina recovered per match | +3 |
| Chance of an early return from injury | +18% |

Deliberately the one investment whose payoff is invisible in-season and only legible in the four-season projection — which is precisely why the projection had to exist before this did.

---

## Ledger types

`finance_ledger.type` is free text, so adding one needs no migration. The complete list lives in `LEDGER_TYPES`; `INCOME_LEDGER_TYPES` says which credit.

| Group | Types |
|---|---|
| Matchday | `gate`, `hospitality`, `season_tickets`, `event_hire` |
| Commercial | `sponsorship`, `merchandising`, `perimeter`, `bonus` |
| Football | `prize`, `transfer_out`, `transfer_in`, `wages` |
| Running the club | `operating`, `facilities` |
| Capital | `stadium` |
| Financing | `loan_in`, `loan_repayment`, `interest` |

`RUNNING_COST_TYPES` — `operating`, `facilities`, `interest`, `loan_repayment` — is the set subtracted from income to get turnover.

---

## Verified behaviour

`bun run scripts/verify-economy.ts` plays a headless season through the real code paths and asserts ten properties. Measured on a fresh `bun run db:setup`:

| Check | Result | Tolerance |
|---|---|---|
| The default portfolio nets what the blended credit nets | 0.07% drift | 5% |
| Every balance equals opening balance plus its ledger | 40 / 40 clubs reconcile exactly | exact |
| Realised commercial income tracks the blended credit | +7.07% | 15% |
| A season-one forecast lands near the season it forecast | 7.0% out | 15% |
| Median wage ratio stays in the target band | 62.5%, 31 / 40 clubs in band | 45–75% |
| The league is not structurally loss-making | 1 / 40 behind, worst margin −11.2% | ≤2 clubs, ≥−15% |
| Capital upgrades pay back on comparable terms | 2.0–4.0 seasons | 1.5–5 |
| Debt service follows the schedule it was written on | outstanding, principal and interest all exact | exact |
| Insolvency escalates in order, and the board actually sells | stages `[1,1,2,2,2,2,2,3,2]`, embargo at matchday 3, intervention at 8, squad 22 → 21 | order + triggers |
| A club driven into a crisis still reconciles to its ledger | exact | exact |

Squads are regenerated by every reseed, so the middle figures move a few points between runs; the tolerances are what is being asserted, not the numbers.

The last three checks exist because **everything above them runs a club at default settings** — which is the point, since the calibration invariant is about defaults, but it means the borrowing and insolvency paths would never execute. An unexercised code path that writes to the ledger is precisely what the integrity check exists to catch, so those two are driven deliberately on a fresh save at the end of the run: a loan is taken and serviced for four matchdays, then the club is spent into the red through `postLedger()` and left there. The stage sequence's final `2` is the recovery step-down after the forced sale put the account back in credit.

Two of these deserve their tolerances explained.

**Realised commercial income is checked at 15%, not 5%.** The structural check above it stays tight, and it is the one that proves the decomposition. But a signed deal is a *fixed* fee for a *fixed* term, and the market it was signed against keeps moving — `marketAppetite()` alone spans ×0.85 to ×1.15. Fixed-term deals are meant to decouple from a moving market; that is what a contract is. Holding realised income to 5% would be asserting that sponsorship deals do not work.

**"The league is not structurally loss-making" is a league-level check, not a club-level one.** A per-club assertion fails on the seed lottery: the bottom of the table already ran at 87–91% wage ratios *before* any of this landed, and an unlucky seed can leave a club marginal from day one. That is `WAGE_DIVISOR` calibration territory and a pre-existing condition, not a regression from this work.

---

## Known limitations

| Issue | Notes |
|---|---|
| The bottom of the table is under-funded | 87–107% wage ratios at the foot of the league, outside the documented 45–75% band. Pre-existing; a `WAGE_DIVISOR` sweep against the seeded squads is the fix |
| CPU clubs have no ventures | No deals, events, boxes or debt. The blended credit is calibrated to match, but a CPU club can never overreach financially and can never be caught doing it |
| Nothing happens between matchdays | Events, upgrades and drawdowns all settle on a round, because that is the only clock the game has |
| Sponsorship offers only ever come to the manager | `runCommercialMarket()` is scoped to the player's club |
| The projection assumes the squad you have | It ages and renews, but never models a signing you have not made |
