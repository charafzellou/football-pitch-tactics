import { describe, expect, it } from 'vitest'
import { RESULT_COLOR, RESULT_LABEL, recentForm, resultFor } from './results'

function fixture(overrides: Partial<Parameters<typeof resultFor>[0]>) {
  return {
    homeTeamId: 1,
    awayTeamId: 2,
    homeScore: null,
    awayScore: null,
    matchDate: '2025-01-01T15:00:00Z',
    ...overrides,
  }
}

describe('resultFor', () => {
  it('returns null when the match has no score yet', () => {
    expect(resultFor(fixture({}), 1)).toBeNull()
  })

  it('is a win for the home team when they scored more', () => {
    const f = fixture({ homeScore: 2, awayScore: 1 })
    expect(resultFor(f, 1)).toBe('W')
    expect(resultFor(f, 2)).toBe('L')
  })

  it('is a draw for both teams on an equal score', () => {
    const f = fixture({ homeScore: 1, awayScore: 1 })
    expect(resultFor(f, 1)).toBe('D')
    expect(resultFor(f, 2)).toBe('D')
  })

  it('is a loss for the away team when the home team scored more', () => {
    const f = fixture({ homeScore: 3, awayScore: 0 })
    expect(resultFor(f, 2)).toBe('L')
  })
})

describe('recentForm', () => {
  it('excludes fixtures the team was not involved in', () => {
    const fixtures = [fixture({ homeTeamId: 3, awayTeamId: 4, homeScore: 1, awayScore: 0 })]
    expect(recentForm(fixtures, 1)).toEqual([])
  })

  it('excludes unplayed fixtures', () => {
    const fixtures = [fixture({ homeScore: null, awayScore: null })]
    expect(recentForm(fixtures, 1)).toEqual([])
  })

  it('orders oldest first', () => {
    const fixtures = [
      fixture({ matchDate: '2025-01-08T15:00:00Z', homeScore: 1, awayScore: 0 }),
      fixture({ matchDate: '2025-01-01T15:00:00Z', homeScore: 0, awayScore: 1 }),
    ]
    expect(recentForm(fixtures, 1)).toEqual(['L', 'W'])
  })

  it('caps at the requested limit, keeping the most recent', () => {
    const fixtures = Array.from({ length: 8 }, (_, i) => fixture({
      matchDate: `2025-01-0${i + 1}T15:00:00Z`,
      homeScore: 1,
      awayScore: 0,
    }))
    const form = recentForm(fixtures, 1, 5)
    expect(form).toHaveLength(5)
  })
})

describe('RESULT_COLOR and RESULT_LABEL', () => {
  it('has an entry for every result', () => {
    for (const result of ['W', 'D', 'L'] as const) {
      expect(RESULT_COLOR[result]).toBeTruthy()
      expect(RESULT_LABEL[result]).toBeTruthy()
    }
  })
})
