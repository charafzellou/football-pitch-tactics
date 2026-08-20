/**
 * Club finances: reputation, stadiums, wages, attendance and income.
 *
 * Pure functions of a club's numbers, like `progression.ts`, so the whole
 * economy can be checked without a database.
 *
 * ## Calibration
 *
 * These figures are sized against the game's *existing* money scale, not
 * against real football. `marketValueFor()` was already deliberately tuned so
 * a 95-rated player tops out near €25M against club balances of €1–50M;
 * pricing income and wages realistically on top of that would bankrupt
 * everyone within a season.
 *
 * The whole economy hangs off one input — `reputation`, derived from squad
 * strength — so stadium size, sponsorship, prize money and the board's
 * expectations all move together and a big club is coherently big.
 *
 * Target shape per season (38 matchdays):
 *
 * | Tier  | Reputation | Capacity | Income  | Wage bill |
 * |-------|-----------|----------|---------|-----------|
 * | Elite | 85+       | 60–80k   | ~€65M   | 55–65%    |
 * | Big   | 70–85     | 40–60k   | ~€35M   |           |
 * | Mid   | 50–70     | 25–40k   | ~€18M   |           |
 * | Small | <50       | 12–25k   | ~€12M   |           |
 */
import { roundsFor } from './calendar'

/**
 * Matchdays in a standard 20-club season, from the calendar's own maths rather
 * than a duplicated literal — money moves once per matchday, so this is the
 * denominator for every "per season" figure below.
 */
const MATCHDAYS_PER_SEASON = roundsFor(20)

export const LEDGER_TYPES = [
  'wages',
  'gate',
  'sponsorship',
  'prize',
  'transfer_in',
  'transfer_out',
  'stadium',
  'merchandising',
  'perimeter',
  'hospitality',
  'operating',
  'facilities',
  'event_hire',
  'season_tickets',
  'loan_in',
  'loan_repayment',
  'interest',
  'bonus',
] as const

/** Entry types that credit a club. Everything else debits it. */
export const INCOME_LEDGER_TYPES = [
  'gate',
  'sponsorship',
  'prize',
  'transfer_out',
  'merchandising',
  'perimeter',
  'hospitality',
  'event_hire',
  'season_tickets',
  'loan_in',
  'bonus',
] as const

/**
 * Running costs — the money it takes to be the club, as opposed to wages,
 * transfer fees and capital works.
 *
 * Named because the wage ratio the board judges has to be measured against
 * income *after* them. Without that subtraction the manager's club, which is
 * the only one carrying itemised running costs, would report a ratio six points
 * kinder than every CPU club's for no reason the manager did anything to earn.
 */
export const RUNNING_COST_TYPES = ['operating', 'facilities', 'interest', 'loan_repayment'] as const

export type LedgerType = (typeof LEDGER_TYPES)[number]

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

// ---------------------------------------------------------------------------
// Reputation
// ---------------------------------------------------------------------------

/** Average skill of a squad's best eleven — depth shouldn't drag a club down. */
export function squadStrength(squad: { skillLevel: number }[]): number {
  if (!squad.length) return 0

  const best = [...squad].sort((a, b) => b.skillLevel - a.skillLevel).slice(0, 11)
  return best.reduce((total, player) => total + player.skillLevel, 0) / best.length
}

/**
 * Club standing, 0–100.
 *
 * Blends **relative standing within the league** with absolute squad strength,
 * weighted toward the former.
 *
 * A purely absolute mapping does not work on this data. Only 5 of 40 clubs have
 * real squads; the other 35 are generated from a uniform 50–79 skill range, so
 * best-eleven averages come out bimodal — 35 clubs bunched at 67–76 and five at
 * 85–89. Any absolute threshold therefore dumps almost everyone into one tier.
 *
 * League rank spreads them properly by construction, and is arguably the truer
 * reading anyway: a club is big relative to its division, not to an abstract
 * scale. The absolute term is kept so that genuinely stronger squads still rate
 * higher than their rank alone would suggest.
 */
export function reputationFor(
  squad: { skillLevel: number }[],
  leagueRank?: number,
  leagueSize?: number,
): number {
  if (!squad.length) return 25

  const strength = squadStrength(squad)
  // 60 → 20, 95 → 100.
  const absolute = clamp((strength - 60) * (80 / 35) + 20, 10, 100)

  if (!leagueRank || !leagueSize || leagueSize < 2)
    return Math.round(absolute)

  // Rank 1 → 100, last → 20.
  const percentile = 1 - (leagueRank - 1) / (leagueSize - 1)
  const relative = 20 + percentile * 80

  // 45/55 toward absolute strength. Weighting rank higher gave mid-table
  // generated clubs large stadiums on top of cheap squads, so they banked a
  // fortune every season; leaning on absolute strength keeps a club's ground
  // roughly proportionate to the squad it has to pay for.
  return Math.round(clamp(relative * 0.45 + absolute * 0.55, 10, 100))
}

export type ClubTier = 'elite' | 'big' | 'mid' | 'small'

export function tierFor(reputation: number): ClubTier {
  if (reputation >= 85) return 'elite'
  if (reputation >= 70) return 'big'
  if (reputation >= 50) return 'mid'
  return 'small'
}

// ---------------------------------------------------------------------------
// Stadium
// ---------------------------------------------------------------------------

const CAPACITY_BY_TIER: Record<ClubTier, [number, number]> = {
  elite: [60_000, 80_000],
  big: [40_000, 60_000],
  mid: [25_000, 40_000],
  small: [12_000, 25_000],
}

/** Capacity for a club of this standing, rounded to the nearest 500. */
export function stadiumCapacityFor(reputation: number): number {
  const [min, max] = CAPACITY_BY_TIER[tierFor(reputation)]
  const span = (reputation - tierFloor(reputation)) / tierRange(reputation)
  const capacity = min + span * (max - min)

  return Math.round(capacity / 500) * 500
}

function tierFloor(reputation: number): number {
  const tier = tierFor(reputation)
  return tier === 'elite' ? 85 : tier === 'big' ? 70 : tier === 'mid' ? 50 : 10
}

function tierRange(reputation: number): number {
  const tier = tierFor(reputation)
  return tier === 'elite' ? 15 : tier === 'big' ? 15 : tier === 'mid' ? 20 : 40
}

const STADIUM_SUFFIXES = ['Stadium', 'Arena', 'Park', 'Ground']

export function stadiumNameFor(clubName: string): string {
  const suffix = STADIUM_SUFFIXES[Math.floor(Math.random() * STADIUM_SUFFIXES.length)]!
  return `${clubName} ${suffix}`
}

/** Cost of adding seats. Expansion completes at the next rollover. */
export function expansionCost(additionalSeats: number): number {
  return Math.round(additionalSeats * 1_200)
}

export const MAX_STADIUM_CAPACITY = 90_000
export const EXPANSION_STEP = 5_000

// ---------------------------------------------------------------------------
// Wages
// ---------------------------------------------------------------------------

/**
 * The divisor turning a market value into a per-matchday wage.
 *
 * Tune this one number to move the whole wage economy. Chosen by sweeping it
 * against the real seeded squads alongside the reputation blend and the
 * commercial curve: at 100 the league lands with a median wage bill of 54% of
 * income, 28 of 40 clubs inside the 45–75% target band, and nobody structurally
 * loss-making.
 */
const WAGE_DIVISOR = 100

/**
 * Wage per matchday.
 *
 * Scales with the club as well as the player. The same footballer earns
 * markedly more at a giant than at a struggling side, which is true to life and
 * also load-bearing here: without it, small clubs carried wage bills of 78–95%
 * of income (a slow, unavoidable bankruptcy) while giants sat at 34%. Tying
 * pay to the payer compresses that spread to roughly 46–65% across the league.
 */
export function wageFor(marketValue: number, age: number, clubReputation = 55): number {
  // Young players are cheap relative to their fee (potential is priced into
  // the fee, not the wage); veterans are the reverse.
  const ageFactor = age <= 21 ? 0.6 : age <= 24 ? 0.85 : age >= 33 ? 1.15 : 1
  const clubFactor = 0.62 + (clamp(clubReputation, 0, 100) / 100) * 0.78

  return Math.max(1_000, Math.round((marketValue / WAGE_DIVISOR) * ageFactor * clubFactor))
}

/**
 * What a player demands to sign or re-sign.
 *
 * Slightly above what the club would naturally pay, and softened by prestige:
 * a player will take less to join a big club and wants more to drop down.
 */
export function wageExpectation(marketValue: number, age: number, clubReputation: number): number {
  const base = wageFor(marketValue, age, clubReputation)
  const prestige = clamp(1.2 - (clubReputation / 100) * 0.25, 0.95, 1.2)

  return Math.round(base * prestige)
}

// ---------------------------------------------------------------------------
// Attendance and gate receipts
// ---------------------------------------------------------------------------

/**
 * The price fans consider reasonable for a club of this standing. Charging
 * above it empties seats; below it fills them but leaves money on the table.
 */
export function fairTicketPrice(reputation: number): number {
  return Math.round(12 + (reputation / 100) * 38)
}

export const MIN_TICKET_PRICE = 5
export const MAX_TICKET_PRICE = 120

export interface AttendanceInputs {
  capacity: number
  reputation: number
  ticketPrice: number
  /** Opponent standing — a big visitor draws a crowd. */
  opponentReputation: number
  /** Recent form as a 0–1 share of available points. */
  formRating: number
  /** League position, 1-based. */
  position: number
  leagueSize: number
}

/**
 * How many turn up.
 *
 * Price is the dominant lever and is deliberately non-linear: doubling the
 * fair price roughly halves the crowd, so overcharging costs *revenue* rather
 * than just goodwill. That is what makes the ticket-price decision a real
 * trade-off instead of a free money button.
 */
export function attendanceFor(inputs: AttendanceInputs): number {
  const { capacity, reputation, ticketPrice, opponentReputation, formRating, position, leagueSize } = inputs

  const fair = fairTicketPrice(reputation)
  // 1 at the fair price, falling away steeply above it, with a modest lift below.
  const priceFactor = ticketPrice <= fair
    ? 1 + ((fair - ticketPrice) / fair) * 0.12
    : clamp(1 - ((ticketPrice - fair) / fair) * 0.55, 0.15, 1)

  const formFactor = 0.86 + formRating * 0.24
  const positionFactor = 0.9 + (1 - (position - 1) / Math.max(1, leagueSize - 1)) * 0.2
  const opponentFactor = 0.94 + (opponentReputation / 100) * 0.12

  // Base fill at the fair price for a mid-table side. 0.62 left grounds looking
  // deserted even for a well-supported club in form; 0.78 lets a strong side
  // near the top of the table approach a full house without ever guaranteeing one.
  const fill = clamp(0.78 * priceFactor * formFactor * positionFactor * opponentFactor, 0.08, 1)

  return Math.round(capacity * fill)
}

export function gateReceiptsFor(attendance: number, ticketPrice: number): number {
  return Math.round(attendance * ticketPrice)
}

// ---------------------------------------------------------------------------
// Sponsorship and prize money
// ---------------------------------------------------------------------------

/**
 * Commercial income per matchday. Scales steeply with standing and rewards a
 * high league position.
 *
 * Deliberately the dominant income stream for the biggest clubs, as it is in
 * reality. It also has to be: only five clubs in this dataset have real squads,
 * so their genuine star ratings give them squad values — and therefore wage
 * bills — far beyond what any stadium of a plausible size could cover. Without
 * a commercial tier that scales faster than matchday income, every elite club
 * runs at a structural loss.
 */
export function sponsorshipFor(reputation: number, position: number, leagueSize: number): number {
  const base = 25_000 + Math.pow(reputation / 100, 3.2) * 1_300_000
  const standing = 0.85 + (1 - (position - 1) / Math.max(1, leagueSize - 1)) * 0.3

  return Math.round(base * standing)
}

/**
 * Paid once, at the rollover. Position dominates, but a bigger club's share is
 * larger too — which is what keeps elite clubs elite without making the table
 * meaningless.
 */
export function prizeMoneyFor(reputation: number, position: number, leagueSize: number): number {
  const share = 1 - (position - 1) / Math.max(1, leagueSize - 1)
  const pool = 4_000_000 + (reputation / 100) * 10_000_000

  return Math.round(pool * (0.35 + share * 1.3))
}

// ---------------------------------------------------------------------------
// The commercial pool
// ---------------------------------------------------------------------------

/**
 * Commercial income stops being one number and becomes a portfolio.
 *
 * `sponsorshipFor()` above is a single opaque credit with no decision attached
 * to it. Everything below splits that figure into named streams the chairman
 * can actually move — and pays for the running costs the club never used to
 * have — **without reflating the league**.
 *
 * ## The invariant
 *
 * At default settings (market-rate partners, no naming-rights deal, level-0
 * hoardings, no boxes, no events, no season tickets, no debt) a club's
 * per-matchday **net** must equal what it nets today. Every venture below is
 * opt-in upside bought with capital, fan goodwill or pitch condition.
 *
 * That is why the pool is `sponsorshipFor() * COMMERCIAL_UPLIFT` rather than
 * `sponsorshipFor()`: the uplift funds the new cost lines exactly, and is
 * *derived* from them rather than picked. `scripts/verify-economy.ts` fails if
 * the median club's net moves more than 5%.
 *
 * Simply adding six income streams on top was the obvious first attempt and is
 * the thing to never do here: club income would roughly double, the 45–75%
 * wage ratio this whole economy is tuned around would collapse to the low
 * thirties, and every transfer fee and contract demand — all priced against
 * balances — would become meaningless within a season.
 */

/** Share of a full ground the average home match actually draws. Measured. */
const REFERENCE_FILL = 0.76

/**
 * The gap between a typical squad's best player and its median one, measured
 * across the seeded league. Merchandising is priced against this so an ordinary
 * squad scores neutral and only a genuine marquee name moves the shop.
 */
const REFERENCE_STAR_GAP = 14

/** Shares of the pool. These sum to exactly 1 — that is the point of them. */
export const COMMERCIAL_SHARES = {
  shirt: 0.38,
  kitMaker: 0.22,
  sleeve: 0.09,
  perimeter: 0.13,
  merchandising: 0.18,
} as const

/**
 * Naming rights sit *outside* the 100%: a club that has never sold its ground's
 * name earns nothing here, which is what makes selling it a real gain rather
 * than a rearrangement.
 */
export const NAMING_RIGHTS_SHARE = 0.12

/** Matchday running costs, as a share of the pool. */
const OPERATING_BASE = 0.10
const OPERATING_VARIABLE = 0.16

/** Upkeep per facility level per matchday, as a share of the pool. */
export const FACILITY_UPKEEP_SHARE = 0.028

export const MAX_FACILITY_LEVEL = 3
export const DEFAULT_FACILITY_LEVEL = 1

/** Opening terms for season tickets, before the chairman touches them. */
export const DEFAULT_SEASON_TICKET_DISCOUNT = 20
export const MAX_SEASON_TICKET_SHARE = 45
export const MAX_SEASON_TICKET_DISCOUNT = 35

/**
 * What a default club spends running itself each matchday, as a share of its
 * pool: half a matchday's operating cost (only home games incur one) plus
 * upkeep on an academy and a training ground at their opening level.
 */
const DEFAULT_COST_SHARE
  = (OPERATING_BASE + OPERATING_VARIABLE * REFERENCE_FILL) / 2
    + FACILITY_UPKEEP_SHARE * DEFAULT_FACILITY_LEVEL * 2

/**
 * Gross the pool up so that pool − costs lands back on `sponsorshipFor()`.
 *
 * Solved, not tuned: income `P` net of costs `P·c` must equal the old figure
 * `S`, so `P = S / (1 − c)`.
 */
export const COMMERCIAL_UPLIFT = 1 / (1 - DEFAULT_COST_SHARE)

/**
 * The club's total commercial earning power for one matchday, before it is
 * divided between partners, hoardings and the club shop.
 */
export function commercialPoolFor(reputation: number, position: number, leagueSize: number): number {
  return Math.round(sponsorshipFor(reputation, position, leagueSize) * COMMERCIAL_UPLIFT)
}

/** What a partner pays per matchday for each slot, at the market rate. */
export function slotValueFor(pool: number, slot: CommercialSlot): number {
  switch (slot) {
    case 'shirt': return Math.round(pool * COMMERCIAL_SHARES.shirt)
    case 'kit_maker': return Math.round(pool * COMMERCIAL_SHARES.kitMaker)
    case 'sleeve': return Math.round(pool * COMMERCIAL_SHARES.sleeve)
    case 'naming_rights': return Math.round(pool * NAMING_RIGHTS_SHARE)
  }
}

export const COMMERCIAL_SLOTS = ['shirt', 'kit_maker', 'sleeve', 'naming_rights'] as const
export type CommercialSlot = (typeof COMMERCIAL_SLOTS)[number]

export const SLOT_LABELS: Record<CommercialSlot, string> = {
  shirt: 'Shirt sponsor',
  kit_maker: 'Kit manufacturer',
  sleeve: 'Sleeve sponsor',
  naming_rights: 'Stadium naming rights',
}

// ---------------------------------------------------------------------------
// Perimeter advertising
// ---------------------------------------------------------------------------

/**
 * Charged on home matchdays only — the boards are at your ground — so the share
 * is doubled to leave the season total identical to an every-matchday stream.
 */
const PERIMETER_HOME_MULTIPLIER = 2

export interface PerimeterTier {
  level: number
  name: string
  multiplier: number
}

/** Advertising boards as a capital ladder. */
export const PERIMETER_TIERS: PerimeterTier[] = [
  { level: 0, name: 'Static hoardings', multiplier: 1 },
  { level: 1, name: 'LED boards', multiplier: 1.45 },
  { level: 2, name: 'Premium LED', multiplier: 1.9 },
  { level: 3, name: 'Full-wrap digital', multiplier: 2.4 },
]

/**
 * Seasons a capital upgrade should take to earn back what it cost.
 *
 * Long enough that it competes with a signing for the same money, short enough
 * that a chairman can see the point. Flat upgrade prices were tried first and
 * are the trap here: because commercial income scales with reputation to the
 * power of 3.2, one price bought a giant a nine-month payback and a small club
 * a five-year one — the same button being a free lunch at one end of the table
 * and a mistake at the other.
 */
export const CAPITAL_PAYBACK_SEASONS = 2.2

export const MAX_PERIMETER_LEVEL = PERIMETER_TIERS.length - 1

export function perimeterTier(level: number): PerimeterTier {
  return PERIMETER_TIERS[clamp(Math.round(level), 0, MAX_PERIMETER_LEVEL)]!
}

/**
 * Capital cost of the next tier of boards, priced off what that tier adds.
 *
 * Solved from the payback target rather than picked, so every club faces the
 * same decision on the same terms.
 */
export function perimeterUpgradeCost(pool: number, level: number): number {
  const current = perimeterTier(level).multiplier
  const next = perimeterTier(level + 1).multiplier
  const step = next - current
  if (step <= 0) return 0

  const gainPerSeason = pool * COMMERCIAL_SHARES.perimeter * PERIMETER_HOME_MULTIPLIER
    * step * (MATCHDAYS_PER_SEASON / 2)

  return Math.round(gainPerSeason * CAPITAL_PAYBACK_SEASONS / 50_000) * 50_000
}

/**
 * Advertisers pay for eyeballs, so a full ground and a high league position are
 * both worth more. Neutral at the reference fill and mid-table.
 */
export function perimeterIncomeFor(
  pool: number,
  level: number,
  fillRate: number,
  position: number,
  leagueSize: number,
): number {
  const audience = 0.72 + clamp(fillRate / REFERENCE_FILL, 0, 1.4) * 0.28
  const standing = 0.9 + (1 - (position - 1) / Math.max(1, leagueSize - 1)) * 0.2

  return Math.round(
    pool * COMMERCIAL_SHARES.perimeter * PERIMETER_HOME_MULTIPLIER
    * perimeterTier(level).multiplier * audience * standing,
  )
}

// ---------------------------------------------------------------------------
// Merchandising
// ---------------------------------------------------------------------------

/**
 * The club shop. Driven by how the support feels and by whether there is anyone
 * in the squad worth putting on the back of a shirt.
 *
 * The star term is the interesting one: a marquee signing measurably pays part
 * of his own fee back, and does it visibly, from the matchday after he arrives.
 */
export function merchandisingFor(pool: number, fanConfidence: number, starPower: number): number {
  // 1.0 at the default 65 confidence.
  const support = 0.72 + clamp(fanConfidence, 0, 100) / 100 * 0.43
  // 1.0 for a squad whose best player leads it by the league-typical margin.
  const star = 1 + clamp(starPower, -8, 14) / 14 * 0.30

  return Math.round(pool * COMMERCIAL_SHARES.merchandising * support * star)
}

/**
 * How far a squad's best player stands above its median, relative to what an
 * ordinary squad manages. Zero is typical; positive is a genuine star.
 */
export function starPowerOf(squad: { skillLevel: number }[]): number {
  if (squad.length < 5) return 0

  const skills = squad.map(player => player.skillLevel).sort((a, b) => a - b)
  const median = skills[Math.floor(skills.length / 2)]!

  return skills[skills.length - 1]! - median - REFERENCE_STAR_GAP
}

// ---------------------------------------------------------------------------
// Corporate hospitality
// ---------------------------------------------------------------------------

export const HOSPITALITY_BOX_SEATS = 12
export const HOSPITALITY_BOX_COST = 300_000
export const MAX_HOSPITALITY_BOXES = 60

/** What a box seat is worth against an ordinary one, catering included. */
const HOSPITALITY_SEAT_MULTIPLIER = 14

/**
 * Boxes are the one seat in the ground that does not care what the ticket price
 * is, so they are how a chairman de-risks gate income — bought with capital and
 * with the general-admission seats they replace.
 */
export function hospitalityIncomeFor(
  boxes: number,
  reputation: number,
  opponentReputation: number,
): number {
  if (boxes <= 0) return 0

  const draw = 0.9 + (clamp(opponentReputation, 0, 100) / 100) * 0.2

  return Math.round(
    boxes * HOSPITALITY_BOX_SEATS * fairTicketPrice(reputation) * HOSPITALITY_SEAT_MULTIPLIER * draw,
  )
}

/** Seats a box takes out of general admission. */
export function seatsLostToBoxes(boxes: number): number {
  return Math.max(0, Math.round(boxes)) * HOSPITALITY_BOX_SEATS
}

// ---------------------------------------------------------------------------
// Non-matchday events
// ---------------------------------------------------------------------------

export const EVENT_KINDS = ['concert', 'international', 'rugby', 'conference', 'community'] as const
export type StadiumEventKind = (typeof EVENT_KINDS)[number]

export interface EventProfile {
  kind: StadiumEventKind
  label: string
  /** Multiple of one full-price gate. */
  feeMultiple: number
  /** Points of pitch condition the event costs. */
  wear: number
  /** How supporters feel about it. */
  fanReaction: number
  description: string
}

/**
 * What a promoter can be sold a free week for.
 *
 * The money and the damage move together on purpose. A concert is the best
 * cheque anyone will write for the ground and it leaves the pitch in a state;
 * a conference pays little and touches nothing but the concourse. If the
 * lucrative options were also harmless there would be no decision to make, only
 * a button to press every week.
 */
export const EVENT_PROFILES: Record<StadiumEventKind, EventProfile> = {
  concert: {
    kind: 'concert',
    label: 'Stadium concert',
    feeMultiple: 1.6,
    wear: 22,
    fanReaction: 0,
    description: 'A weekend of staging on the centre circle.',
  },
  international: {
    kind: 'international',
    label: 'International fixture',
    feeMultiple: 1.1,
    wear: 14,
    fanReaction: 2,
    description: 'The national side borrows the ground.',
  },
  rugby: {
    kind: 'rugby',
    label: 'Rugby match',
    feeMultiple: 0.85,
    wear: 18,
    fanReaction: -1,
    description: 'Eighty minutes of scrums where your goalmouth is.',
  },
  conference: {
    kind: 'conference',
    label: 'Corporate conference',
    feeMultiple: 0.25,
    wear: 0,
    fanReaction: 0,
    description: 'Concourse and boxes only. The pitch never sees them.',
  },
  community: {
    kind: 'community',
    label: 'Community day',
    feeMultiple: 0.1,
    wear: 0,
    fanReaction: 4,
    description: 'Open doors, little money, and goodwill that lasts.',
  },
}

/** What a promoter pays, sized against what a full house is worth. */
export function eventFeeFor(kind: StadiumEventKind, capacity: number, reputation: number): number {
  const fullHouse = capacity * fairTicketPrice(reputation) * 0.75
  return Math.round(fullHouse * EVENT_PROFILES[kind].feeMultiple)
}

/** Pitch condition recovered between matchdays. */
export const PITCH_RECOVERY_PER_ROUND = 9
export const MIN_PITCH_CONDITION = 25
export const MAX_PITCH_PENALTY = 2.5

/**
 * What a worn pitch costs the home side, in the same units as a tactic modifier.
 *
 * Charged to the home club alone. It is their ground and their decision: the
 * money from the concert is theirs, so the rutted goalmouth is too. Bounded at
 * `MAX_PITCH_PENALTY` — comparable to a formation choice, never enough to
 * decide a match on its own.
 */
export function pitchPenaltyFor(condition: number): number {
  return ((100 - clamp(condition, 0, 100)) / 100) * MAX_PITCH_PENALTY
}

/**
 * How much more likely an injury is on a surface in that state, as a multiplier
 * on the engine's injury draw.
 *
 * Applied to **both** sides, unlike the attack and defence penalty. A rutted
 * goalmouth does not know which club hired the ground out — the money is the
 * home club's problem and the ankles are everybody's. At the floor condition of
 * 25 this is a 37% uplift on a base rate of 0.3 injuries a match, which is about
 * one extra injury every nine matches: felt over a run of concerts, invisible in
 * any single fixture.
 */
export const MAX_PITCH_INJURY_UPLIFT = 0.5

export function pitchInjuryScaleFor(condition: number): number {
  return 1 + ((100 - clamp(condition, 0, 100)) / 100) * MAX_PITCH_INJURY_UPLIFT
}

export function recoverPitch(condition: number): number {
  return Math.min(100, condition + PITCH_RECOVERY_PER_ROUND)
}

export function wearPitch(condition: number, wear: number): number {
  return Math.max(MIN_PITCH_CONDITION, condition - wear)
}

// ---------------------------------------------------------------------------
// Season tickets
// ---------------------------------------------------------------------------

/**
 * Sold before a ball is kicked: cash now, and a floor under the crowd, in
 * exchange for the upside of a season that goes well.
 *
 * Neutral at a zero share, which is where every club starts — so attendance and
 * gate receipts are untouched until a chairman decides otherwise.
 */
export function seasonTicketHolders(generalCapacity: number, sharePercent: number): number {
  return Math.round(generalCapacity * clamp(sharePercent, 0, MAX_SEASON_TICKET_SHARE) / 100)
}

/** The lump that arrives in the summer, covering every home match at once. */
export function seasonTicketRevenue(
  holders: number,
  ticketPrice: number,
  discountPercent: number,
  homeMatches: number,
): number {
  const perSeat = ticketPrice * (1 - clamp(discountPercent, 0, MAX_SEASON_TICKET_DISCOUNT) / 100)
  return Math.round(holders * perSeat * homeMatches)
}

// ---------------------------------------------------------------------------
// Running costs
// ---------------------------------------------------------------------------

/**
 * Stewarding, policing, pitch and utilities for one home match.
 *
 * Priced off the commercial pool rather than off attendance, which is the
 * realistic model and was tried first. Because gate income is large relative to
 * commercial income at a small club and small at a giant, an attendance-
 * proportional cost moved the bottom of the table's net by −15% while leaving
 * the top +4%, which made several clubs structurally loss-making. Pricing it
 * off the pool keeps the deduction uniform across the league, and uniformity is
 * exactly what lets one uplift constant restore every club's net at once. The
 * fill term keeps the realism that mattered: a full house costs more to run.
 */
export function matchdayOperatingCostFor(pool: number, fillRate: number): number {
  return Math.round(pool * (OPERATING_BASE + OPERATING_VARIABLE * clamp(fillRate, 0, 1.2)))
}

/** Academy and training-ground upkeep, charged every matchday. */
export function facilityUpkeepFor(pool: number, academyLevel: number, trainingLevel: number): number {
  const levels = clamp(academyLevel, 0, MAX_FACILITY_LEVEL) + clamp(trainingLevel, 0, MAX_FACILITY_LEVEL)
  return Math.round(pool * FACILITY_UPKEEP_SHARE * levels)
}

/**
 * Capital cost of taking a facility from `level` to `level + 1`, in seasons of
 * commercial income — so an upgrade costs a big club more and is worth more.
 */
export function facilityUpgradeCost(pool: number, level: number): number {
  return Math.round(pool * MATCHDAYS_PER_SEASON * (0.25 + clamp(level, 0, MAX_FACILITY_LEVEL) * 0.2))
}

// ---------------------------------------------------------------------------
// Starting balance
// ---------------------------------------------------------------------------

/**
 * Roughly half a season's income, so a club's cash reflects its size.
 *
 * Replaces a flat random €1–50M, which gave small clubs elite transfer power
 * and made the market incoherent.
 */
export function startingBalanceFor(reputation: number, capacity: number): number {
  const fair = fairTicketPrice(reputation)
  const seasonGate = capacity * 0.75 * fair * (MATCHDAYS_PER_SEASON / 2)
  const seasonSponsorship = sponsorshipFor(reputation, 10, 20) * MATCHDAYS_PER_SEASON

  return Math.round((seasonGate + seasonSponsorship) * randomBetween(0.4, 0.6))
}

/** Recent form as a 0–1 share of available points, for attendance. */
export function formRatingFrom(results: ('W' | 'D' | 'L')[]): number {
  if (!results.length) return 0.5

  const points = results.reduce((total, result) => total + (result === 'W' ? 3 : result === 'D' ? 1 : 0), 0)
  return points / (results.length * 3)
}
