import { describe, expect, it } from 'vitest'
import { TACTICS } from './tactics'

describe('TACTICS', () => {
  it('every formation sums to 11 players', () => {
    for (const tactic of TACTICS) {
      const total = tactic.formation.GK + tactic.formation.DF + tactic.formation.MF + tactic.formation.FW
      expect(total).toBe(11)
    }
  })

  it('every formation fields exactly one goalkeeper', () => {
    for (const tactic of TACTICS)
      expect(tactic.formation.GK).toBe(1)
  })

  it('has unique names', () => {
    const names = TACTICS.map(t => t.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('includes the default 4-4-2 fallback', () => {
    expect(TACTICS.some(t => t.name === '4-4-2')).toBe(true)
  })
})
