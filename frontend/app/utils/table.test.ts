import { describe, expect, it } from 'vitest'
import { positionSortingFn } from './table'

function fakeRow(value: string) {
  return { getValue: (_columnId: string) => value } as any
}

describe('positionSortingFn', () => {
  it('orders GK before DF before MF before FW', () => {
    expect(positionSortingFn(fakeRow('GK'), fakeRow('FW'), 'position')).toBeLessThan(0)
    expect(positionSortingFn(fakeRow('DF'), fakeRow('MF'), 'position')).toBeLessThan(0)
  })

  it('is symmetric', () => {
    const a = positionSortingFn(fakeRow('GK'), fakeRow('FW'), 'position')
    const b = positionSortingFn(fakeRow('FW'), fakeRow('GK'), 'position')
    expect(Math.sign(a)).toBe(-Math.sign(b))
  })

  it('is zero for two players in the same slot', () => {
    expect(positionSortingFn(fakeRow('DF'), fakeRow('Defender'), 'position')).toBe(0)
  })

  it('sorts an unrecognised position after every recognised one', () => {
    expect(positionSortingFn(fakeRow('GK'), fakeRow('Wing-back'), 'position')).toBeLessThan(0)
    expect(positionSortingFn(fakeRow('Wing-back'), fakeRow('GK'), 'position')).toBeGreaterThan(0)
  })

  it('falls back to alphabetical when both are unrecognised', () => {
    expect(positionSortingFn(fakeRow('Alpha'), fakeRow('Zebra'), 'position')).toBeLessThan(0)
  })
})
