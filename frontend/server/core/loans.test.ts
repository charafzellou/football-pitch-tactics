import { describe, expect, it } from 'vitest'
import {
  borrowingLimitFor,
  interestPerRoundFor,
  loanRateFor,
  overdraftInterestFor,
  repaymentPerRoundFor,
  totalInterestFor,
} from './loans'

describe('loanRateFor', () => {
  it('a stronger club borrows more cheaply', () => {
    expect(loanRateFor(90, 1_000_000)).toBeLessThan(loanRateFor(20, 1_000_000))
  })

  it('an overdrawn balance adds a distress premium', () => {
    const inCredit = loanRateFor(50, 1_000_000)
    const overdrawn = loanRateFor(50, -1_000)
    expect(overdrawn).toBe(inCredit + 4)
  })

  it('sits at the documented extremes', () => {
    expect(loanRateFor(100, 1)).toBe(4)
    expect(loanRateFor(30, -1)).toBe(12.2)
  })
})

describe('borrowingLimitFor', () => {
  it('is zero once already borrowed to the 60% ceiling', () => {
    const income = 10_000_000
    const ceiling = income * 0.60
    expect(borrowingLimitFor(income, ceiling)).toBe(0)
  })

  it('never goes negative when already over the ceiling', () => {
    expect(borrowingLimitFor(10_000_000, 100_000_000)).toBe(0)
  })

  it('rounds down to the nearest loan step', () => {
    const headroom = borrowingLimitFor(10_000_000, 0)
    expect(headroom % 500_000).toBe(0)
  })
})

describe('repaymentPerRoundFor', () => {
  it('a longer term means a smaller per-round repayment', () => {
    const oneSeason = repaymentPerRoundFor(1_000_000, 1)
    const fiveSeasons = repaymentPerRoundFor(1_000_000, 5)
    expect(fiveSeasons).toBeLessThan(oneSeason)
  })

  it('fully repays the principal across the term (rounded up)', () => {
    const principal = 1_000_000
    const termSeasons = 2
    const perRound = repaymentPerRoundFor(principal, termSeasons)
    const rounds = termSeasons * 38
    // Straight-line and ceil'd, so the total repaid is >= principal, and
    // within one round's worth of it.
    expect(perRound * rounds).toBeGreaterThanOrEqual(principal)
    expect(perRound * rounds - principal).toBeLessThan(perRound)
  })
})

describe('interestPerRoundFor', () => {
  it('is zero on a non-positive balance', () => {
    expect(interestPerRoundFor(0, 10)).toBe(0)
    expect(interestPerRoundFor(-100, 10)).toBe(0)
  })

  it('divides the annual charge across the 38-round season', () => {
    const outstanding = 1_000_000
    const rate = 7.6
    const annual = outstanding * rate / 100
    expect(interestPerRoundFor(outstanding, rate)).toBe(Math.round(annual / 38))
  })
})

describe('overdraftInterestFor', () => {
  it('is zero when the balance is non-negative', () => {
    expect(overdraftInterestFor(0)).toBe(0)
    expect(overdraftInterestFor(500)).toBe(0)
  })

  it('charges the overdraft rate on the deficit', () => {
    const charge = overdraftInterestFor(-1_000_000)
    expect(charge).toBe(Math.round((1_000_000 * 12 / 100) / 38))
  })
})

describe('totalInterestFor', () => {
  it('approximates against half the principal over the term', () => {
    const principal = 1_000_000
    const rate = 10
    const term = 2
    expect(totalInterestFor(principal, rate, term)).toBe(Math.round(principal / 2 * (rate / 100) * term))
  })

  it('a longer term costs more total interest at the same rate', () => {
    const shortTerm = totalInterestFor(1_000_000, 10, 1)
    const longTerm = totalInterestFor(1_000_000, 10, 5)
    expect(longTerm).toBeGreaterThan(shortTerm)
  })
})
