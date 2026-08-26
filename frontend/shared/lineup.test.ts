import { describe, expect, it } from 'vitest'
import {
  autoSelectLineup,
  groupSquadBySlot,
  isAvailable,
  normalizePosition,
  parseLineup,
  resolveLineup,
  sortByLineupOrder,
  toFormation,
} from './lineup'
import type { SelectablePlayer } from './lineup'

function player(id: number, position: string, skillLevel: number, injuredMatches = 0): SelectablePlayer {
  return { id, position, skillLevel, injuredMatches }
}

describe('normalizePosition', () => {
  it('recognises abbreviations', () => {
    expect(normalizePosition('GK')).toBe('GK')
    expect(normalizePosition('DEF')).toBe('DF')
    expect(normalizePosition('MID')).toBe('MF')
    expect(normalizePosition('ATT')).toBe('FW')
  })

  it('recognises full English names, case-insensitively', () => {
    expect(normalizePosition('goalkeeper')).toBe('GK')
    expect(normalizePosition('Defender')).toBe('DF')
    expect(normalizePosition('MIDFIELDER')).toBe('MF')
    expect(normalizePosition('Forward')).toBe('FW')
    expect(normalizePosition('Attacker')).toBe('FW')
  })

  it('returns null for an unrecognised position', () => {
    expect(normalizePosition('Wing-back')).toBeNull()
    expect(normalizePosition(null)).toBeNull()
    expect(normalizePosition(undefined)).toBeNull()
  })
})

describe('isAvailable', () => {
  it('is available with no injury', () => {
    expect(isAvailable(player(1, 'GK', 70))).toBe(true)
  })

  it('is unavailable with any injury count above zero', () => {
    expect(isAvailable(player(1, 'GK', 70, 1))).toBe(false)
  })
})

describe('toFormation', () => {
  it('fills in every missing slot from the default formation', () => {
    expect(toFormation(null)).toEqual({ GK: 1, DF: 4, MF: 4, FW: 2 })
  })

  it('keeps whatever slots are explicitly given', () => {
    expect(toFormation({ DF: 3 })).toEqual({ GK: 1, DF: 3, MF: 4, FW: 2 })
  })
})

describe('sortByLineupOrder', () => {
  it('orders GK, DF, MF, FW, best first within each slot', () => {
    const squad = [
      player(1, 'FW', 60), player(2, 'GK', 70), player(3, 'MF', 80), player(4, 'DF', 90),
      player(5, 'GK', 90),
    ]
    const sorted = sortByLineupOrder(squad)
    expect(sorted.map(p => p.id)).toEqual([5, 2, 4, 3, 1])
  })
})

describe('groupSquadBySlot', () => {
  it('buckets players by normalized slot, sorted best first', () => {
    const squad = [player(1, 'DF', 60), player(2, 'DF', 80)]
    const pools = groupSquadBySlot(squad)
    expect(pools.DF.map(p => p.id)).toEqual([2, 1])
    expect(pools.GK).toEqual([])
  })

  it('drops players with an unrecognised position', () => {
    const squad = [player(1, 'Wing-back', 60)]
    const pools = groupSquadBySlot(squad)
    expect(pools.GK).toEqual([])
    expect(pools.DF).toEqual([])
    expect(pools.MF).toEqual([])
    expect(pools.FW).toEqual([])
  })
})

function fullSquad(): SelectablePlayer[] {
  const squad: SelectablePlayer[] = []
  let id = 1
  for (let i = 0; i < 3; i++) squad.push(player(id++, 'GK', 60 + i))
  for (let i = 0; i < 7; i++) squad.push(player(id++, 'DF', 60 + i))
  for (let i = 0; i < 7; i++) squad.push(player(id++, 'MF', 60 + i))
  for (let i = 0; i < 5; i++) squad.push(player(id++, 'FW', 60 + i))
  return squad
}

describe('autoSelectLineup', () => {
  it('picks exactly eleven players for the default formation', () => {
    const lineup = autoSelectLineup(fullSquad())
    expect(lineup).toHaveLength(11)
  })

  it('fills each slot with the requested count', () => {
    const lineup = autoSelectLineup(fullSquad(), { GK: 1, DF: 4, MF: 4, FW: 2 })
    const byPos = groupSquadBySlot(lineup)
    expect(byPos.GK).toHaveLength(1)
    expect(byPos.DF).toHaveLength(4)
    expect(byPos.MF).toHaveLength(4)
    expect(byPos.FW).toHaveLength(2)
  })

  it('picks the highest-skilled players within each slot', () => {
    const lineup = autoSelectLineup(fullSquad())
    const gks = lineup.filter(p => normalizePosition(p.position) === 'GK')
    expect(gks[0]!.skillLevel).toBe(62) // best of the three seeded GKs (60,61,62)
  })

  it('never selects an injured player when fit alternatives exist', () => {
    const squad = fullSquad()
    squad[3]!.injuredMatches = 1 // a DF
    const lineup = autoSelectLineup(squad)
    expect(lineup.some(p => p.id === squad[3]!.id)).toBe(false)
  })

  it('tops up with the best leftovers when a squad has no goalkeeper at all', () => {
    const squad = fullSquad().filter(p => normalizePosition(p.position) !== 'GK')
    const lineup = autoSelectLineup(squad)
    expect(lineup).toHaveLength(11)
  })

  it('fields an injured player only as an absolute last resort', () => {
    // Ten fit outfield players plus one injured one — the injured player
    // must still be fielded to reach eleven, but only after every fit
    // player has already been used.
    const squad: SelectablePlayer[] = []
    for (let i = 0; i < 10; i++) squad.push(player(i + 1, 'MF', 60))
    squad.push(player(99, 'MF', 99, 2))

    const lineup = autoSelectLineup(squad, { GK: 0, DF: 0, MF: 11, FW: 0 })
    expect(lineup).toHaveLength(11)
    expect(lineup.some(p => p.id === 99)).toBe(true)
  })
})

describe('parseLineup', () => {
  it('parses a JSON string of ids', () => {
    expect(parseLineup('[1,2,3]')).toEqual([1, 2, 3])
  })

  it('parses an already-array value', () => {
    expect(parseLineup([1, 2, 3])).toEqual([1, 2, 3])
  })

  it('returns null for malformed JSON', () => {
    expect(parseLineup('not json')).toBeNull()
  })

  it('returns null for a non-array value', () => {
    expect(parseLineup('{"a":1}')).toBeNull()
  })

  it('drops non-integer entries', () => {
    expect(parseLineup([1, 'x', 2.5, 3])).toEqual([1, 3])
  })

  it('returns null rather than an empty array', () => {
    expect(parseLineup([])).toBeNull()
    expect(parseLineup(['x'])).toBeNull()
  })
})

describe('resolveLineup', () => {
  it('uses the saved XI when it is still valid', () => {
    const squad = fullSquad()
    const savedIds = squad.slice(0, 11).map(p => p.id)
    const { starters, autoSelected } = resolveLineup(squad, undefined, savedIds)

    expect(autoSelected).toBe(false)
    expect(starters.map(p => p.id).sort()).toEqual([...savedIds].sort())
  })

  it('falls back to auto-selection when the saved XI is missing a player (e.g. sold)', () => {
    const squad = fullSquad()
    const savedIds = [...squad.slice(0, 10).map(p => p.id), 999_999]
    const { autoSelected } = resolveLineup(squad, undefined, savedIds)
    expect(autoSelected).toBe(true)
  })

  it('falls back to auto-selection when a saved starter is now injured', () => {
    const squad = fullSquad()
    squad[0]!.injuredMatches = 2
    const savedIds = squad.slice(0, 11).map(p => p.id)
    const { autoSelected } = resolveLineup(squad, undefined, savedIds)
    expect(autoSelected).toBe(true)
  })

  it('the bench is everyone not starting', () => {
    const squad = fullSquad()
    const { starters, bench } = resolveLineup(squad)
    expect(starters).toHaveLength(11)
    expect(bench).toHaveLength(squad.length - 11)
    const starterIds = new Set(starters.map(p => p.id))
    expect(bench.every(p => !starterIds.has(p.id))).toBe(true)
  })
})
