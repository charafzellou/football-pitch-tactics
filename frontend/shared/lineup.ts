/**
 * Shared lineup rules.
 *
 * This lives in `shared/` so the match engine (server) and the lineup builders
 * (client) resolve a starting XI through the exact same code. That guarantees
 * the XI rendered on Matchday is the XI the simulation actually played with.
 */

/** The four slots every formation is built from. */
export type LineupSlot = 'GK' | 'DF' | 'MF' | 'FW'

/** How many players each slot holds. A valid formation sums to LINEUP_SIZE. */
export type Formation = Record<LineupSlot, number>

/** Minimal player shape the lineup rules need. */
export interface SelectablePlayer {
  id: number
  position: string
  skillLevel: number
  /** Matches remaining out injured. Anything above 0 makes them unselectable. */
  injuredMatches?: number
}

/**
 * Injury is the only thing that blocks selection. Low stamina deliberately
 * does not — an exhausted player is pickable and simply bad, so a squad can
 * never be locked out of naming eleven.
 */
export function isAvailable(player: SelectablePlayer): boolean {
  return !(player.injuredMatches ?? 0)
}

export interface ResolvedLineup<T extends SelectablePlayer> {
  starters: T[]
  bench: T[]
  /** True when no valid saved XI existed and the XI was picked automatically. */
  autoSelected: boolean
}

export const LINEUP_SIZE = 11

export const LINEUP_SLOT_ORDER: LineupSlot[] = ['GK', 'DF', 'MF', 'FW']

/** Fallback for teams that never picked a tactic — every CPU club, today. */
export const DEFAULT_TACTIC_NAME = '4-4-2'
export const DEFAULT_FORMATION: Formation = { GK: 1, DF: 4, MF: 4, FW: 2 }

/**
 * Seed data mixes full position names ("Goalkeeper") with abbreviations
 * ("GK"), so every consumer has to normalise before comparing.
 */
const POSITION_ALIASES: Record<LineupSlot, string[]> = {
  GK: ['GOALKEEPER', 'GK'],
  DF: ['DEFENDER', 'DEF', 'DF'],
  MF: ['MIDFIELDER', 'MID', 'MF'],
  FW: ['FORWARD', 'ATTACKER', 'ATT', 'FW'],
}

export function normalizePosition(position: string | null | undefined): LineupSlot | null {
  const normalized = String(position ?? '').toUpperCase().trim()

  return LINEUP_SLOT_ORDER.find(slot => POSITION_ALIASES[slot].includes(normalized)) ?? null
}

/** Fills in any missing slot so a partial/absent tactic still yields 11 places. */
export function toFormation(formation?: Partial<Formation> | null): Formation {
  return {
    GK: formation?.GK ?? DEFAULT_FORMATION.GK,
    DF: formation?.DF ?? DEFAULT_FORMATION.DF,
    MF: formation?.MF ?? DEFAULT_FORMATION.MF,
    FW: formation?.FW ?? DEFAULT_FORMATION.FW,
  }
}

/** Best first: highest skill, then lowest id so the pick is deterministic. */
function byRating(left: SelectablePlayer, right: SelectablePlayer) {
  return right.skillLevel - left.skillLevel || left.id - right.id
}

/** Display order: GK, DF, MF, FW — best first within each slot. */
export function sortByLineupOrder<T extends SelectablePlayer>(players: T[]): T[] {
  return [...players].sort((left, right) => {
    const leftSlot = LINEUP_SLOT_ORDER.indexOf(normalizePosition(left.position) ?? 'FW')
    const rightSlot = LINEUP_SLOT_ORDER.indexOf(normalizePosition(right.position) ?? 'FW')

    return leftSlot - rightSlot || byRating(left, right)
  })
}

export function groupSquadBySlot<T extends SelectablePlayer>(squad: T[]): Record<LineupSlot, T[]> {
  const pools: Record<LineupSlot, T[]> = { GK: [], DF: [], MF: [], FW: [] }

  for (const player of squad) {
    const slot = normalizePosition(player.position)
    if (slot)
      pools[slot].push(player)
  }

  for (const slot of LINEUP_SLOT_ORDER)
    pools[slot].sort(byRating)

  return pools
}

/**
 * Picks the highest rated players that fit `formation`.
 *
 * Reusable anywhere a team needs an XI without a human choosing one: the match
 * engine uses it for CPU clubs, and it backs an "Auto-select" button for the
 * player's own team.
 */
export function autoSelectLineup<T extends SelectablePlayer>(
  squad: T[],
  formation?: Partial<Formation> | null,
): T[] {
  const slots = toFormation(formation)
  const fit = squad.filter(isAvailable)
  const pools = groupSquadBySlot(fit)
  const lineup: T[] = []
  const picked = new Set<number>()

  for (const slot of LINEUP_SLOT_ORDER) {
    for (const player of pools[slot].slice(0, slots[slot])) {
      lineup.push(player)
      picked.add(player.id)
    }
  }

  // Squads are not guaranteed to cover every slot (generated squads draw
  // positions at random), so top up with the best players left over rather
  // than fielding fewer than eleven. A spare keeper is the last resort —
  // any outfielder is a better fit for an unfilled outfield place.
  //
  // Fit players are exhausted before injured ones are considered at all:
  // fielding someone carrying a knock is bad, fielding nine is worse.
  if (lineup.length < LINEUP_SIZE) {
    const isSpareKeeper = (player: T) => (normalizePosition(player.position) === 'GK' ? 1 : 0)
    const leftovers = squad
      .filter(player => !picked.has(player.id))
      .sort((left, right) =>
        Number(isAvailable(right)) - Number(isAvailable(left))
        || isSpareKeeper(left) - isSpareKeeper(right)
        || byRating(left, right))

    lineup.push(...leftovers.slice(0, LINEUP_SIZE - lineup.length))
  }

  return sortByLineupOrder(lineup)
}

/** Reads a lineup persisted as a JSON array of player ids. */
export function parseLineup(raw: unknown): number[] | null {
  let value = raw

  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    }
    catch {
      return null
    }
  }

  if (!Array.isArray(value))
    return null

  const ids = value.map(Number).filter(id => Number.isInteger(id))

  return ids.length ? ids : null
}

/** A saved XI only counts if it still resolves to eleven players in the squad. */
function readSavedLineup<T extends SelectablePlayer>(squad: T[], savedIds?: number[] | null): T[] | null {
  if (!savedIds?.length)
    return null

  const squadById = new Map(squad.map(player => [player.id, player]))
  const picked: T[] = []
  const seen = new Set<number>()

  for (const id of savedIds) {
    const player = squadById.get(id)
    // Skip anything sold, duplicated, or injured since the lineup was saved.
    // Dropping below eleven invalidates the whole saved XI and hands the
    // team to auto-selection — the same way a sold player already did.
    if (!player || seen.has(id) || !isAvailable(player))
      continue

    seen.add(id)
    picked.push(player)
  }

  return picked.length === LINEUP_SIZE ? sortByLineupOrder(picked) : null
}

/**
 * Resolves the XI a team will field: the saved lineup when it is still valid,
 * otherwise an auto-selected one. Everything not starting becomes the bench.
 */
export function resolveLineup<T extends SelectablePlayer>(
  squad: T[],
  formation?: Partial<Formation> | null,
  savedIds?: number[] | null,
): ResolvedLineup<T> {
  const saved = readSavedLineup(squad, savedIds)
  const starters = saved ?? autoSelectLineup(squad, formation)
  const starterIds = new Set(starters.map(player => player.id))

  return {
    starters,
    bench: sortByLineupOrder(squad.filter(player => !starterIds.has(player.id))),
    autoSelected: !saved,
  }
}
