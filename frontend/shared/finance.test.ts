import { describe, expect, it } from 'vitest'
import { affordableFee, facilityTier, healthStage, streamMeta } from './finance'

describe('streamMeta', () => {
  it('returns the catalogued metadata for a known type', () => {
    expect(streamMeta('wages')).toEqual({
      label: 'Player wages',
      kind: 'cost',
      group: 'Squad',
      icon: 'i-lucide-users',
    })
  })

  it('falls back to a generic "Other" entry for an unrecognised type', () => {
    const meta = streamMeta('some_future_stream')
    expect(meta.group).toBe('Other')
    expect(meta.label).toBe('some_future_stream')
  })
})

describe('healthStage', () => {
  it('maps stage 0 to Stable', () => {
    expect(healthStage(0).label).toBe('Stable')
  })

  it('maps stage 3 to Board intervention', () => {
    expect(healthStage(3).label).toBe('Board intervention')
  })

  it('clamps an out-of-range stage to the nearest valid one', () => {
    expect(healthStage(-1)).toEqual(healthStage(0))
    expect(healthStage(99)).toEqual(healthStage(3))
  })
})

describe('affordableFee', () => {
  it('subtracts the remaining season\'s wage commitment from safe spend', () => {
    expect(affordableFee(10_000_000, 20, 100_000)).toBe(10_000_000 - 20 * 100_000)
  })

  it('never goes negative', () => {
    expect(affordableFee(1_000_000, 38, 100_000)).toBe(0)
  })
})

describe('facilityTier', () => {
  it('labels the four levels', () => {
    expect(facilityTier(0)).toBe('Neglected')
    expect(facilityTier(1)).toBe('Standard')
    expect(facilityTier(2)).toBe('Modern')
    expect(facilityTier(3)).toBe('Elite')
  })

  it('clamps out-of-range levels', () => {
    expect(facilityTier(-1)).toBe('Neglected')
    expect(facilityTier(10)).toBe('Elite')
  })
})
