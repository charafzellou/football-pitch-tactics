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
] as const

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
