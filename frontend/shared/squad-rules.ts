import type { LineupSlot } from './lineup'
import { normalizePosition } from './lineup'

/** Minimum active squad size permitted after a manager-initiated sale. */
export const MIN_SQUAD_SIZE_TO_SELL = 16

/** Minimum active players required in each normalized position group. */
export const MINIMUM_SQUAD_BY_SLOT: Record<LineupSlot, number> = {
  GK: 2,
  DF: 5,
  MF: 5,
  FW: 2,
}

export interface SquadRulePlayer {
  id: number
  position: string
}

export interface SquadCounts {
  total: number
  GK: number
  DF: number
  MF: number
  FW: number
}

const POSITION_LABELS: Record<LineupSlot, { singular: string; plural: string }> = {
  GK: { singular: 'goalkeeper', plural: 'goalkeepers' },
  DF: { singular: 'defender', plural: 'defenders' },
  MF: { singular: 'midfielder', plural: 'midfielders' },
  FW: { singular: 'forward', plural: 'forwards' },
}

/** Counts an active squad using the same position aliases as lineup selection. */
export function squadCounts(squad: readonly SquadRulePlayer[]): SquadCounts {
  const counts: SquadCounts = { total: squad.length, GK: 0, DF: 0, MF: 0, FW: 0 }

  for (const player of squad) {
    const slot = normalizePosition(player.position)
    if (slot)
      counts[slot]++
  }

  return counts
}

function minimumSummary(): string {
  return 'at least 2 goalkeepers, 5 defenders, 5 midfielders, 2 forwards and 16 players'
}

/**
 * Returns the reason a sale is blocked, or null when the post-sale squad is
 * within every minimum. The caller must provide active players only: retired
 * and free-agent rows are not squad members.
 */
export function saleBlockedReason(
  squad: readonly SquadRulePlayer[],
  playerId: number,
): string | null {
  const player = squad.find(candidate => candidate.id === playerId)
  if (!player)
    return 'That player is not part of the active squad'

  const slot = normalizePosition(player.position)
  if (!slot)
    return 'That player has an unrecognised position and cannot be sold safely'

  const afterSale = squad.filter(candidate => candidate.id !== playerId)
  const counts = squadCounts(afterSale)

  if (counts.total < MIN_SQUAD_SIZE_TO_SELL)
    return `You must keep ${minimumSummary()}. Selling this player would leave ${counts.total} players.`

  const minimum = MINIMUM_SQUAD_BY_SLOT[slot]
  if (counts[slot] < minimum) {
    const label = counts[slot] === 1 ? POSITION_LABELS[slot].singular : POSITION_LABELS[slot].plural
    return `You must keep ${minimumSummary()}. Selling this player would leave ${counts[slot]} ${label}; the minimum is ${minimum}.`
  }

  return null
}
