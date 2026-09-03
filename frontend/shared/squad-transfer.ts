import type { LineupSlot } from './lineup'
import { LINEUP_SLOT_ORDER, normalizePosition } from './lineup'

/** The smallest active squad a club may retain after selling a player. */
export const MIN_TRANSFER_SQUAD_SIZE = 16

/** Positional depth every club must retain after selling a player. */
export const MIN_TRANSFER_SQUAD_BY_SLOT: Record<LineupSlot, number> = {
  GK: 2,
  DF: 5,
  MF: 5,
  FW: 3,
}

export interface TransferSquadMember {
  id: number
  position: string
}

export type SquadFloorViolation =
  | {
      kind: 'squadSize'
      minimum: number
      remaining: number
    }
  | {
      kind: 'position'
      slot: LineupSlot
      minimum: number
      remaining: number
    }

export interface TransferEligibility {
  allowed: boolean
  violations: SquadFloorViolation[]
  /** Ready for API errors, disabled-control titles, and inline explanations. */
  reason: string | null
}

const SLOT_LABELS: Record<LineupSlot, string> = {
  GK: 'goalkeepers',
  DF: 'defenders',
  MF: 'midfielders',
  FW: 'attackers',
}

function joinRequirements(requirements: string[]): string {
  if (requirements.length <= 1)
    return requirements[0] ?? ''

  if (requirements.length === 2)
    return `${requirements[0]} and ${requirements[1]}`

  return `${requirements.slice(0, -1).join(', ')}, and ${requirements.at(-1)}`
}

/** Turns structured violations into one consistent user-facing explanation. */
export function squadFloorReason(violations: SquadFloorViolation[]): string | null {
  if (!violations.length)
    return null

  const requirements = violations.map((violation) => {
    if (violation.kind === 'squadSize')
      return `${violation.minimum} active players (${violation.remaining} would remain)`

    return `${violation.minimum} ${SLOT_LABELS[violation.slot]} (${violation.remaining} would remain)`
  })

  return `Cannot complete this transfer: the squad must keep at least ${joinRequirements(requirements)}.`
}

/**
 * Checks the squad that would remain after one active player leaves.
 *
 * Callers provide active, contracted players only. Injuries deliberately do
 * not enter this calculation: an injured player remains a member of the squad.
 */
export function evaluateTransferDeparture(
  squad: TransferSquadMember[],
  departingPlayerId: number,
): TransferEligibility {
  const remaining = squad.filter(player => player.id !== departingPlayerId)
  const violations: SquadFloorViolation[] = []

  if (remaining.length < MIN_TRANSFER_SQUAD_SIZE) {
    violations.push({
      kind: 'squadSize',
      minimum: MIN_TRANSFER_SQUAD_SIZE,
      remaining: remaining.length,
    })
  }

  const counts: Record<LineupSlot, number> = { GK: 0, DF: 0, MF: 0, FW: 0 }
  for (const player of remaining) {
    const slot = normalizePosition(player.position)
    if (slot)
      counts[slot]++
  }

  for (const slot of LINEUP_SLOT_ORDER) {
    if (counts[slot] < MIN_TRANSFER_SQUAD_BY_SLOT[slot]) {
      violations.push({
        kind: 'position',
        slot,
        minimum: MIN_TRANSFER_SQUAD_BY_SLOT[slot],
        remaining: counts[slot],
      })
    }
  }

  return {
    allowed: violations.length === 0,
    violations,
    reason: squadFloorReason(violations),
  }
}
