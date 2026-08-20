/**
 * The club's finances, fetched once and shared.
 *
 * Every finance page reads the same summary, and `useAsyncData` dedupes on the
 * key — so the overview, the stadium page and the topbar all ride one request
 * and refresh together after a change.
 */
import type { LedgerKind } from '#shared/finance'

export interface FinanceStream {
  type: string
  label: string
  group: string
  icon: string
  kind: LedgerKind
  amount: number
  perMatchday: number
  /** Share of this side of the profit and loss, 0–100. */
  share: number
}

export interface LedgerRow {
  round: number
  type: string
  amount: number
  description: string
}

export interface LoanRow {
  id: number
  principal: number
  outstanding: number
  ratePerSeason: number
  untilSeason: number
  repaymentPerRound: number
  interestPerRound: number
  /** Share of the principal already back, 0–100. */
  repaidPercent: number
}

export interface FinanceSummary {
  club: {
    name: string
    balance: number
    reputation: number
    stadiumName: string | null
    stadiumCapacity: number
    generalCapacity: number
    hospitalityBoxes: number
    ticketPrice: number
    fairTicketPrice: number
  }
  season: number
  round: number
  totalRounds: number
  wageBill: number
  wageBillPerSeason: number
  expiringContracts: number
  income: number
  expenses: number
  net: number
  byType: Record<string, number>
  streams: FinanceStream[]
  turnover: number
  runningCosts: number
  projectedBalance: number
  wageRatio: number | null
  health: { stage: number; insolventRounds: number }
  debt: {
    count: number
    outstanding: number
    principal: number
    servicePerRound: number
    overdraftPerRound: number
    loans: LoanRow[]
  }
  preview: { attendance: number; fillPercent: number; gatePerMatch: number }
  expansion: { step: number; cost: number; maxCapacity: number; canAfford: boolean; atMax: boolean }
  ledger: LedgerRow[]
}

export function useFinanceSummary() {
  const { data: finance, refresh, status } = useAsyncData(
    'finance-summary',
    () => $fetch<FinanceSummary | null>('/api/finance/summary'),
  )

  return { finance, refresh, status }
}

// ---------------------------------------------------------------------------
// The forecast
// ---------------------------------------------------------------------------

export interface RiskFlag {
  kind: string
  severity: 'warning' | 'danger'
  message: string
}

export interface SeasonProjection {
  season: number
  rounds: number
  partial: boolean
  income: Record<string, number>
  costs: Record<string, number>
  totalIncome: number
  totalCosts: number
  turnover: number
  net: number
  openingBalance: number
  closingBalance: number
  bestClosing: number
  worstClosing: number
  wageBill: number
  wageRatio: number
  squadSize: number
  flags: RiskFlag[]
}

export interface ProjectionPayload {
  season: number
  round: number
  totalRounds: number
  expectedPosition: number
  leagueSize: number
  projection: SeasonProjection[]
  wageBudget: { current: number; healthy: number; ceiling: number; headroom: number; ratio: number }
  transferBudget: { safeSpend: number; buffer: number; roundsRemaining: number; projectedClosing: number }
}

/**
 * The four-season forecast and the budgets derived from it.
 *
 * Shares a key with the projection page so the transfer market and the contract
 * modal show the same numbers the forecast does, rather than a second estimate
 * that can drift from it.
 */
export function useFinanceProjection() {
  const { data: projection, refresh, status } = useAsyncData(
    'finance-projection',
    () => $fetch<ProjectionPayload | null>('/api/finance/projection'),
  )

  return { projection, refresh, status }
}

// ---------------------------------------------------------------------------
// Borrowing
// ---------------------------------------------------------------------------

export interface LoansPayload {
  balance: number
  reputation: number
  season: number
  annualIncome: number
  outstanding: number
  servicePerRound: number
  overdraftPerRound: number
  overdraftRate: number
  rate: number
  limit: number
  minLoan: number
  step: number
  maxShare: number
  terms: { seasons: number; repaymentPerRoundPerMillion: number; interestPerMillion: number }[]
  loans: LoanRow[]
  health: { stage: number; insolventRounds: number }
}

/**
 * What the club owes and what more would cost.
 *
 * Keyed separately from the summary because the borrowing terms depend on the
 * four-season forecast, which is the expensive half of the finance section — the
 * overview should not pay for it.
 */
export function useFinanceLoans() {
  const { data: debt, refresh, status } = useAsyncData(
    'finance-loans',
    () => $fetch<LoansPayload | null>('/api/finance/loans'),
  )

  return { debt, refresh, status }
}

// ---------------------------------------------------------------------------
// Facilities
// ---------------------------------------------------------------------------

export interface AcademyEffect {
  skillBonus: number
  potentialBonus: number
  bonusGraduates: number
}

export interface TrainingEffect {
  developmentPercent: number
  declinePercent: number
  staminaPerMatch: number
  injuryRecoveryPercent: number
}

export interface FacilityState<Effect> {
  level: number
  tier: string
  nextTier: string | null
  atMax: boolean
  cost: number
  canAfford: boolean
  upkeepPerRound: number
  upkeepAfterUpgrade: number | null
  current: Effect
  next: Effect | null
}

export interface FacilitiesPayload {
  balance: number
  season: number
  maxLevel: number
  upkeepPerRound: number
  upkeepPerSeason: number
  academy: FacilityState<AcademyEffect>
  training: FacilityState<TrainingEffect>
  health: { stage: number }
}

export function useFinanceFacilities() {
  const { data: facilities, refresh, status } = useAsyncData(
    'finance-facilities',
    () => $fetch<FacilitiesPayload | null>('/api/finance/facilities'),
  )

  return { facilities, refresh, status }
}
