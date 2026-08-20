/**
 * What the next four seasons look like from here.
 *
 * Pure functions of a club's numbers, like `economy.ts` and `progression.ts`, so
 * the forecast can be checked without a database — and so the budget advice and
 * the chart can never disagree, because they are the same calculation read twice.
 *
 * ## Why not `balance + perRound × roundsLeft`
 *
 * That is what the finance page used to show, and it is wrong in the only way
 * that matters: it is a straight line through a series that does not move in a
 * straight line. Half a squad coming out of contract, a shirt deal expiring, a
 * loan maturing and a summer of youth wages are all step changes, and every one
 * of them lands at a rollover the linear estimate cannot see. A manager who
 * plans against the straight line signs a striker in March and discovers in
 * August that he could not afford the renewals.
 */
import {
  DEFAULT_SEASON_TICKET_DISCOUNT,
  attendanceFor,
  commercialPoolFor,
  facilityUpkeepFor,
  fairTicketPrice,
  gateReceiptsFor,
  hospitalityIncomeFor,
  matchdayOperatingCostFor,
  merchandisingFor,
  perimeterIncomeFor,
  prizeMoneyFor,
  seatsLostToBoxes,
  slotValueFor,
  starPowerOf,
} from './economy'
import { requiredWage } from './contracts'
import { SQUAD_TARGET_SIZE, retirementChance } from './progression'

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface ProjectedPlayer {
  id: number
  age: number
  wage: number
  marketValue: number
  skillLevel: number
  contractUntilSeason: number
}

export interface ProjectedDeal {
  slot: string
  /** Per matchday. */
  fee: number
  /** Last season the deal covers. */
  untilSeason: number
}

export interface ProjectedLoan {
  outstanding: number
  ratePerSeason: number
  /** Last season a repayment is due. */
  untilSeason: number
  /** Principal repaid per matchday. */
  repaymentPerRound: number
}

export interface ProjectionInput {
  season: number
  /** Matchdays already played this season. */
  roundsPlayed: number
  totalRounds: number
  balance: number
  reputation: number
  leagueSize: number
  /** Where the club is expected to finish. Drives prize money and standing. */
  expectedPosition: number
  /** The plausible range around it, which becomes the band on the chart. */
  bestPosition: number
  worstPosition: number
  stadiumCapacity: number
  ticketPrice: number
  hospitalityBoxes: number
  perimeterLevel: number
  academyLevel: number
  trainingLevel: number
  seasonTicketShare: number
  seasonTicketDiscount: number
  fanConfidence: number
  squad: ProjectedPlayer[]
  deals: ProjectedDeal[]
  loans: ProjectedLoan[]
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export type RiskFlagKind
  = 'contracts-expiring'
    | 'deal-expiring'
    | 'loan-maturing'
    | 'wage-ratio-high'
    | 'projected-insolvent'

export interface RiskFlag {
  kind: RiskFlagKind
  severity: 'warning' | 'danger'
  message: string
}

export interface SeasonProjection {
  season: number
  /** Matchdays this projection covers. The first season is usually a partial. */
  rounds: number
  partial: boolean
  income: Record<string, number>
  costs: Record<string, number>
  totalIncome: number
  totalCosts: number
  /** Income less what it costs to run the club — the wage-ratio base. */
  turnover: number
  net: number
  openingBalance: number
  closingBalance: number
  /** Closing balance if the club finishes at the top / bottom of its range. */
  bestClosing: number
  worstClosing: number
  wageBill: number
  wageRatio: number
  squadSize: number
  flags: RiskFlag[]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

// ---------------------------------------------------------------------------
// One season
// ---------------------------------------------------------------------------

interface SeasonState {
  season: number
  squad: ProjectedPlayer[]
  deals: ProjectedDeal[]
  loans: ProjectedLoan[]
}

/** Income and costs for a whole season at a given finishing position. */
function seasonMoney(input: ProjectionInput, state: SeasonState, rounds: number, position: number) {
  const { reputation, leagueSize } = input
  const homeMatches = rounds / 2

  const pool = commercialPoolFor(reputation, position, leagueSize)
  const generalCapacity = Math.max(0, input.stadiumCapacity - seatsLostToBoxes(input.hospitalityBoxes))

  // A neutral opponent and average form: this is a forecast, not a fixture list.
  const attendance = attendanceFor({
    capacity: generalCapacity,
    reputation,
    ticketPrice: input.ticketPrice,
    opponentReputation: 55,
    formRating: 0.5,
    position,
    leagueSize,
  })
  const fill = generalCapacity > 0 ? attendance / generalCapacity : 0

  // Season-ticket holders paid up front, so only walk-up trade pays at the gate.
  const holders = Math.round(generalCapacity * clamp(input.seasonTicketShare, 0, 100) / 100)
  const walkUp = Math.max(0, attendance - holders)

  /**
   * Partners pay what they signed for, and a slot nobody has bought earns
   * nothing — the same rule `settleMatchFinances()` applies.
   *
   * Deals that run out inside the horizon are assumed **re-signed at the market
   * rate**, because a club does re-sell its shirt: forecasting the slot as dead
   * would show every manager a cliff in season three that never actually
   * arrives, and they would plan around a hole that was never there.
   */
  const running = state.deals.filter(deal => deal.untilSeason >= state.season)
  const sold = new Set(running.map(deal => deal.slot))
  const marketRate: Record<string, number> = {
    shirt: slotValueFor(pool, 'shirt'),
    kit_maker: slotValueFor(pool, 'kit_maker'),
    sleeve: slotValueFor(pool, 'sleeve'),
  }

  const partners = running.reduce((total, deal) => total + deal.fee, 0)
    + Object.entries(marketRate)
      .filter(([slot]) => !sold.has(slot))
      .reduce((total, [, rate]) => total + rate, 0)

  const wageBill = state.squad.reduce((total, player) => total + player.wage, 0)

  const income: Record<string, number> = {
    gate: gateReceiptsFor(walkUp, input.ticketPrice) * homeMatches,
    sponsorship: partners * rounds,
    merchandising: merchandisingFor(pool, input.fanConfidence, starPowerOf(state.squad)) * rounds,
    perimeter: perimeterIncomeFor(pool, input.perimeterLevel, fill, position, leagueSize) * homeMatches,
    hospitality: hospitalityIncomeFor(input.hospitalityBoxes, reputation, 55) * homeMatches,
    prize: prizeMoneyFor(reputation, position, leagueSize),
  }

  if (holders > 0 && rounds === input.totalRounds) {
    const discounted = Math.round(input.ticketPrice * (1 - clamp(input.seasonTicketDiscount, 0, 100) / 100))
    income.season_tickets = holders * discounted * (input.totalRounds / 2)
  }

  /**
   * Debt service is the one cost that does not care how the season goes, which
   * is exactly why it belongs in a forecast: a good year cannot repay it faster
   * and a bad one cannot defer it. Both legs are pro-rated to the matchdays
   * actually being projected, so a half-played season carries half a season of
   * interest rather than a full one.
   */
  const debt = state.loans.filter(loan => loan.untilSeason >= state.season)
  const share = input.totalRounds > 0 ? rounds / input.totalRounds : 0
  const costs: Record<string, number> = {
    wages: wageBill * rounds,
    operating: matchdayOperatingCostFor(pool, fill) * homeMatches,
    facilities: facilityUpkeepFor(pool, input.academyLevel, input.trainingLevel) * rounds,
    loan_repayment: debt.reduce(
      (total, loan) => total + Math.min(loan.outstanding, loan.repaymentPerRound * rounds),
      0,
    ),
    interest: debt.reduce((total, loan) => total + loan.outstanding * loan.ratePerSeason / 100, 0) * share,
  }

  for (const key of Object.keys(income)) if (!income[key]) delete income[key]
  for (const key of Object.keys(costs)) if (!costs[key]) delete costs[key]

  const totalIncome = Object.values(income).reduce((total, value) => total + value, 0)
  const totalCosts = Object.values(costs).reduce((total, value) => total + value, 0)
  const runningCosts = (costs.operating ?? 0) + (costs.facilities ?? 0)
    + (costs.loan_repayment ?? 0) + (costs.interest ?? 0)

  return {
    income,
    costs,
    totalIncome: Math.round(totalIncome),
    totalCosts: Math.round(totalCosts),
    turnover: Math.round(totalIncome - runningCosts),
    wageBill,
  }
}

// ---------------------------------------------------------------------------
// The rollover, as the projection sees it
// ---------------------------------------------------------------------------

/**
 * Ages the squad into the next season.
 *
 * Retirement is applied as an *expectation* rather than a coin toss — a
 * 35-year-old with a 40% chance of hanging up his boots carries 60% of his wage
 * into the forecast. A projection that rolled the dice would give a different
 * answer every time the page was opened, which is worse than being slightly
 * wrong in a stable direction.
 */
function ageSquad(input: ProjectionInput, state: SeasonState): SeasonState {
  const nextSeason = state.season + 1
  const skills = state.squad.map(player => player.skillLevel).sort((a, b) => a - b)
  const medianSkill = skills[Math.floor(skills.length / 2)] ?? 60

  const survivors: ProjectedPlayer[] = []

  for (const player of state.squad) {
    const age = player.age + 1
    const staying = 1 - retirementChance(age, player.skillLevel)
    if (staying <= 0.02) continue

    const expiring = player.contractUntilSeason < nextSeason

    // A club renews the players it would miss and lets the rest go, which is
    // the same rule `aiRenews()` applies at an actual rollover.
    if (expiring && player.skillLevel < medianSkill) continue

    const wage = expiring
      ? requiredWage({
          playerId: player.id,
          marketValue: player.marketValue,
          age,
          skillLevel: player.skillLevel,
          clubReputation: input.reputation,
          position: input.expectedPosition,
          leagueSize: input.leagueSize,
        }, 3)
      : player.wage

    survivors.push({
      ...player,
      age,
      wage: Math.round(wage * staying),
      contractUntilSeason: expiring ? nextSeason + 2 : player.contractUntilSeason,
    })
  }

  // The summer intake fills the squad back up, and it is not free.
  const shortfall = Math.max(0, SQUAD_TARGET_SIZE - survivors.length)
  for (let index = 0; index < shortfall; index++) {
    const marketValue = 250_000
    survivors.push({
      id: -index - 1,
      age: 18,
      skillLevel: Math.max(40, medianSkill - 12),
      marketValue,
      contractUntilSeason: nextSeason + 2,
      wage: requiredWage({
        playerId: index,
        marketValue,
        age: 18,
        skillLevel: Math.max(40, medianSkill - 12),
        clubReputation: input.reputation,
        position: input.expectedPosition,
        leagueSize: input.leagueSize,
      }, 3),
    })
  }

  return {
    season: nextSeason,
    squad: survivors,
    deals: state.deals.filter(deal => deal.untilSeason >= nextSeason),
    loans: state.loans
      .map(loan => ({
        ...loan,
        outstanding: Math.max(0, loan.outstanding - loan.repaymentPerRound * input.totalRounds),
      }))
      .filter(loan => loan.untilSeason >= nextSeason && loan.outstanding > 0),
  }
}

// ---------------------------------------------------------------------------
// The horizon
// ---------------------------------------------------------------------------

export const PROJECTION_SEASONS = 4

/**
 * The current season and the three after it.
 *
 * The first entry covers only the matchdays still to play, because the money
 * already spent is in the balance rather than in the forecast.
 */
export function projectHorizon(input: ProjectionInput, seasons = PROJECTION_SEASONS): SeasonProjection[] {
  const projections: SeasonProjection[] = []

  let state: SeasonState = {
    season: input.season,
    squad: input.squad,
    deals: input.deals,
    loans: input.loans,
  }
  let balance = input.balance
  // The band compounds: three good seasons are further from three bad ones
  // than one is, and a forecast that resets the spread every summer hides
  // exactly the risk a four-season view exists to show.
  let bestBalance = input.balance
  let worstBalance = input.balance

  for (let index = 0; index < seasons; index++) {
    const partial = index === 0
    const rounds = partial
      ? Math.max(0, input.totalRounds - input.roundsPlayed)
      : input.totalRounds

    const central = seasonMoney(input, state, rounds, input.expectedPosition)
    const best = seasonMoney(input, state, rounds, input.bestPosition)
    const worst = seasonMoney(input, state, rounds, input.worstPosition)

    const net = central.totalIncome - central.totalCosts
    const closingBalance = Math.round(balance + net)

    const wageRatio = central.turnover > 0
      ? Math.round(((central.costs.wages ?? 0) / central.turnover) * 100)
      : 0

    projections.push({
      season: state.season,
      rounds,
      partial,
      income: central.income,
      costs: central.costs,
      totalIncome: central.totalIncome,
      totalCosts: central.totalCosts,
      turnover: central.turnover,
      net: Math.round(net),
      openingBalance: Math.round(balance),
      closingBalance,
      bestClosing: Math.round(bestBalance + best.totalIncome - best.totalCosts),
      worstClosing: Math.round(worstBalance + worst.totalIncome - worst.totalCosts),
      wageBill: central.wageBill,
      wageRatio,
      squadSize: state.squad.length,
      flags: flagsFor(input, state, wageRatio, closingBalance),
    })

    balance = closingBalance
    bestBalance = Math.round(bestBalance + best.totalIncome - best.totalCosts)
    worstBalance = Math.round(worstBalance + worst.totalIncome - worst.totalCosts)
    state = ageSquad(input, state)
  }

  return projections
}

function flagsFor(
  input: ProjectionInput,
  state: SeasonState,
  wageRatio: number,
  closingBalance: number,
): RiskFlag[] {
  const flags: RiskFlag[] = []

  const expiring = state.squad.filter(player => player.contractUntilSeason <= state.season).length
  if (expiring > 0) {
    flags.push({
      kind: 'contracts-expiring',
      severity: expiring >= 6 ? 'danger' : 'warning',
      message: `${expiring} ${expiring === 1 ? 'contract runs' : 'contracts run'} out at the end of this season`,
    })
  }

  for (const deal of state.deals.filter(row => row.untilSeason === state.season)) {
    flags.push({
      kind: 'deal-expiring',
      severity: 'warning',
      message: `The ${deal.slot.replace('_', ' ')} deal expires this summer`,
    })
  }

  for (const loan of state.loans.filter(row => row.untilSeason === state.season)) {
    flags.push({
      kind: 'loan-maturing',
      severity: 'warning',
      message: `A loan matures this season — ${Math.round(loan.outstanding).toLocaleString('en-IE')} still outstanding`,
    })
  }

  if (wageRatio > 85) {
    flags.push({
      kind: 'wage-ratio-high',
      severity: 'danger',
      message: `Wages reach ${wageRatio}% of turnover — the board starts objecting above 85%`,
    })
  }
  else if (wageRatio > 75) {
    flags.push({
      kind: 'wage-ratio-high',
      severity: 'warning',
      message: `Wages reach ${wageRatio}% of turnover`,
    })
  }

  if (closingBalance < 0) {
    flags.push({
      kind: 'projected-insolvent',
      severity: 'danger',
      message: `The club is projected to be ${Math.abs(closingBalance).toLocaleString('en-IE')} overdrawn`,
    })
  }

  return flags
}

// ---------------------------------------------------------------------------
// Budget advice
// ---------------------------------------------------------------------------

/**
 * The share of turnover a wage bill can sit at and still be called healthy.
 *
 * Anchored to the 85% at which `boardConfidenceTarget()` starts docking
 * confidence, with the usual margin: advice that only warns you once the board
 * is already unhappy is not advice.
 */
export const HEALTHY_WAGE_SHARE = 0.60
export const CEILING_WAGE_SHARE = 0.75

export interface WageBudget {
  /** Per matchday. */
  current: number
  healthy: number
  ceiling: number
  headroom: number
  ratio: number
}

export function wageBudget(projection: SeasonProjection[]): WageBudget {
  const season = projection[0]
  if (!season || season.rounds === 0) {
    return { current: 0, healthy: 0, ceiling: 0, headroom: 0, ratio: 0 }
  }

  const turnoverPerRound = season.turnover / season.rounds
  const healthy = Math.round(turnoverPerRound * HEALTHY_WAGE_SHARE)
  const ceiling = Math.round(turnoverPerRound * CEILING_WAGE_SHARE)

  return {
    current: season.wageBill,
    healthy,
    ceiling,
    headroom: healthy - season.wageBill,
    ratio: season.wageRatio,
  }
}

export interface TransferBudget {
  /** What can be spent on fees and still end the season above the buffer. */
  safeSpend: number
  /** The cushion held back — a few matchdays of wages. */
  buffer: number
  /** Matchdays a signing made now would draw wages for. */
  roundsRemaining: number
  projectedClosing: number
}

/** How many matchdays of wages a club should never dip below. */
const BUFFER_MATCHDAYS = 3

export function transferBudget(projection: SeasonProjection[]): TransferBudget {
  const season = projection[0]
  if (!season) {
    return { safeSpend: 0, buffer: 0, roundsRemaining: 0, projectedClosing: 0 }
  }

  const buffer = season.wageBill * BUFFER_MATCHDAYS

  return {
    safeSpend: Math.max(0, Math.round(season.closingBalance - buffer)),
    buffer,
    roundsRemaining: season.rounds,
    projectedClosing: season.closingBalance,
  }
}
