import { describe, expect, it } from 'vitest'
import { stageFor } from './insolvency'

describe('stageFor', () => {
  it('a positive balance steps the stage down by one', () => {
    expect(stageFor(1000, 0, 2)).toBe(1)
  })

  it('a positive balance never goes below stage 0', () => {
    expect(stageFor(1000, 0, 0)).toBe(0)
  })

  it('a first negative matchday reaches stage 1', () => {
    expect(stageFor(-500, 1, 0)).toBe(1)
  })

  it('reaches stage 2 (embargo) after EMBARGO_ROUNDS consecutive overdrawn matchdays', () => {
    expect(stageFor(-500, 3, 1)).toBe(2)
    expect(stageFor(-500, 2, 1)).toBe(1)
  })

  it('reaches stage 3 (intervention) after INTERVENTION_ROUNDS consecutive overdrawn matchdays', () => {
    expect(stageFor(-500, 8, 2)).toBe(3)
    expect(stageFor(-500, 7, 2)).toBe(2)
  })

  it('a deep enough overdraft is stage 3 regardless of how new it is', () => {
    expect(stageFor(-15_000_001, 1, 0)).toBe(3)
  })

  it('a deep overdraft one below the threshold does not force stage 3 on its own', () => {
    expect(stageFor(-14_999_999, 1, 0)).toBe(1)
  })
})
