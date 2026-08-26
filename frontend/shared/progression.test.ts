import { describe, expect, it } from 'vitest'
import { DECLINE_AGE, GROWTH_AGE_LIMIT, developmentTrend } from './progression'

describe('developmentTrend', () => {
  it('is declining at or beyond the decline age, regardless of potential', () => {
    expect(developmentTrend(DECLINE_AGE, 70, 90)).toBe('declining')
    expect(developmentTrend(DECLINE_AGE + 5, 70, 70)).toBe('declining')
  })

  it('is rising for a young player with headroom left', () => {
    expect(developmentTrend(GROWTH_AGE_LIMIT, 60, 80)).toBe('rising')
  })

  it('is peak for a young player already at their ceiling', () => {
    expect(developmentTrend(GROWTH_AGE_LIMIT, 80, 80)).toBe('peak')
  })

  it('is peak for a player between the growth window and the decline age', () => {
    expect(developmentTrend(GROWTH_AGE_LIMIT + 1, 70, 90)).toBe('peak')
  })
})
