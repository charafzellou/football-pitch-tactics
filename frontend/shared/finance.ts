/**
 * Names and grouping for the money a club moves.
 *
 * Shared rather than duplicated: the server totals ledger streams and the
 * finance pages label them, and two copies of this map is exactly how
 * "Commercial" comes to mean one thing on the overview and another on the
 * projection.
 */

export type LedgerKind = 'income' | 'cost'

export interface StreamMeta {
  label: string
  /** Which half of the profit and loss it belongs to. */
  kind: LedgerKind
  /** The heading it sits under. */
  group: string
  icon: string
}

export const STREAM_META: Record<string, StreamMeta> = {
  // Income
  gate: { label: 'Gate receipts', kind: 'income', group: 'Matchday', icon: 'i-lucide-ticket' },
  hospitality: { label: 'Hospitality', kind: 'income', group: 'Matchday', icon: 'i-lucide-wine' },
  season_tickets: { label: 'Season tickets', kind: 'income', group: 'Matchday', icon: 'i-lucide-tickets' },
  event_hire: { label: 'Stadium hire', kind: 'income', group: 'Matchday', icon: 'i-lucide-music' },
  sponsorship: { label: 'Partners', kind: 'income', group: 'Commercial', icon: 'i-lucide-handshake' },
  merchandising: { label: 'Club shop', kind: 'income', group: 'Commercial', icon: 'i-lucide-shopping-bag' },
  perimeter: { label: 'Advertising', kind: 'income', group: 'Commercial', icon: 'i-lucide-tv-minimal' },
  bonus: { label: 'Sponsor bonuses', kind: 'income', group: 'Commercial', icon: 'i-lucide-gift' },
  prize: { label: 'Prize money', kind: 'income', group: 'Football', icon: 'i-lucide-trophy' },
  transfer_out: { label: 'Player sales', kind: 'income', group: 'Football', icon: 'i-lucide-arrow-up-right' },
  loan_in: { label: 'Loan drawn', kind: 'income', group: 'Financing', icon: 'i-lucide-landmark' },

  // Costs
  wages: { label: 'Player wages', kind: 'cost', group: 'Squad', icon: 'i-lucide-users' },
  transfer_in: { label: 'Transfer fees', kind: 'cost', group: 'Squad', icon: 'i-lucide-arrow-down-left' },
  operating: { label: 'Matchday operations', kind: 'cost', group: 'Running the club', icon: 'i-lucide-shield' },
  facilities: { label: 'Facilities upkeep', kind: 'cost', group: 'Running the club', icon: 'i-lucide-dumbbell' },
  stadium: { label: 'Stadium works', kind: 'cost', group: 'Capital', icon: 'i-lucide-hammer' },
  loan_repayment: { label: 'Loan repayment', kind: 'cost', group: 'Financing', icon: 'i-lucide-landmark' },
  interest: { label: 'Interest', kind: 'cost', group: 'Financing', icon: 'i-lucide-percent' },
}

/** Order the profit and loss reads in, top to bottom. */
export const INCOME_GROUPS = ['Matchday', 'Commercial', 'Football', 'Financing'] as const
export const COST_GROUPS = ['Squad', 'Running the club', 'Capital', 'Financing'] as const

export function streamMeta(type: string): StreamMeta {
  return STREAM_META[type] ?? { label: type, kind: 'income', group: 'Other', icon: 'i-lucide-circle' }
}

/** Where the club's finances currently stand. Stage 0 is solvent. */
export const HEALTH_STAGES = [
  { stage: 0, label: 'Stable', tone: 'success' },
  { stage: 1, label: 'Overdrawn', tone: 'warning' },
  { stage: 2, label: 'Transfer embargo', tone: 'danger' },
  { stage: 3, label: 'Board intervention', tone: 'danger' },
] as const

export function healthStage(stage: number) {
  return HEALTH_STAGES[Math.max(0, Math.min(HEALTH_STAGES.length - 1, stage))]!
}

/**
 * What can be spent on a fee once the signing's own wages are allowed for.
 *
 * A signing costs a fee today *and* a wage every matchday until the season ends,
 * so a headline transfer budget overstates what is actually affordable by
 * exactly that second amount. Shared so the transfer market, the contract modal
 * and the projection page all answer the question identically.
 */
export function affordableFee(safeSpend: number, roundsRemaining: number, wagePerMatchday: number): number {
  return Math.max(0, Math.round(safeSpend - wagePerMatchday * roundsRemaining))
}

// ---------------------------------------------------------------------------
// Facilities
// ---------------------------------------------------------------------------

/**
 * What each facility level is called.
 *
 * Shared because the same four words label the academy and the training ground
 * on the facilities page, in the projection's flags and in the news feed — and a
 * level called "Modern" in one place and "Level 2" in another reads as two
 * different systems.
 */
export const FACILITY_TIERS = ['Neglected', 'Standard', 'Modern', 'Elite'] as const

export function facilityTier(level: number): string {
  return FACILITY_TIERS[Math.max(0, Math.min(FACILITY_TIERS.length - 1, Math.round(level)))]!
}
