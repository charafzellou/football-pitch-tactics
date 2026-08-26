import { describe, expect, it } from 'vitest'
import {
  aiContractLength,
  aiRenews,
  canCarryWage,
  contractDemand,
  evaluateOffer,
  isExpiring,
  lengthDiscount,
  maxSeasonsFor,
  requiredWage,
} from './contracts'

const baseContext = {
  playerId: 1,
  marketValue: 5_000_000,
  age: 26,
  skillLevel: 75,
  clubReputation: 60,
  position: 10,
  leagueSize: 20,
}

describe('maxSeasonsFor', () => {
  it('shortens with age at the documented breakpoints', () => {
    expect(maxSeasonsFor(29)).toBe(5)
    expect(maxSeasonsFor(30)).toBe(3)
    expect(maxSeasonsFor(32)).toBe(3)
    expect(maxSeasonsFor(33)).toBe(2)
    expect(maxSeasonsFor(34)).toBe(2)
    expect(maxSeasonsFor(35)).toBe(1)
    expect(maxSeasonsFor(40)).toBe(1)
  })
})

describe('contractDemand', () => {
  it('is deterministic for the same player id', () => {
    const first = contractDemand(baseContext)
    const second = contractDemand(baseContext)
    expect(first).toBe(second)
  })

  it('differs between two different player ids with the same numbers', () => {
    const a = contractDemand({ ...baseContext, playerId: 1 })
    const b = contractDemand({ ...baseContext, playerId: 2 })
    // Not guaranteed to differ for every possible pair, but true often enough
    // (character factor is continuous over id) that a fixed pair is a safe
    // regression check on the seeded formula.
    expect(a).not.toBe(b)
  })

  it('a club near the top of the table pays a discount versus one near the foot', () => {
    const top = contractDemand({ ...baseContext, position: 1 })
    const bottom = contractDemand({ ...baseContext, position: 20 })
    expect(top).toBeLessThan(bottom)
  })

  it('never drops below the 1,000 floor', () => {
    expect(contractDemand({ ...baseContext, marketValue: 0, clubReputation: 0 })).toBeGreaterThanOrEqual(1_000)
  })
})

describe('lengthDiscount', () => {
  it('is 1 for a single season', () => {
    expect(lengthDiscount(1)).toBe(1)
  })

  it('shaves 3% per extra season', () => {
    expect(lengthDiscount(3)).toBeCloseTo(1 - 2 * 0.03)
  })

  it('clamps below the minimum and above the maximum contract length', () => {
    expect(lengthDiscount(0)).toBe(lengthDiscount(1))
    expect(lengthDiscount(10)).toBe(lengthDiscount(5))
  })
})

describe('requiredWage', () => {
  it('a longer deal costs less per matchday than a short one', () => {
    const short = requiredWage(baseContext, 1)
    const long = requiredWage(baseContext, 5)
    expect(long).toBeLessThan(short)
  })
})

describe('evaluateOffer', () => {
  it('rejects a season count outside the legal 1-5 range', () => {
    const outcome = evaluateOffer(baseContext, { wage: 1_000_000, seasons: 6 })
    expect(outcome.accepted).toBe(false)
    expect(outcome.reason).toMatch(/between 1 and 5/)
  })

  it('rejects a deal longer than the player will commit to at their age', () => {
    const veteran = { ...baseContext, age: 34 }
    const outcome = evaluateOffer(veteran, { wage: 10_000_000, seasons: 5 })
    expect(outcome.accepted).toBe(false)
    expect(outcome.maxSeasons).toBe(2)
  })

  it('rejects an offer below the required wage', () => {
    const required = requiredWage(baseContext, 2)
    const outcome = evaluateOffer(baseContext, { wage: required - 1, seasons: 2 })
    expect(outcome.accepted).toBe(false)
    expect(outcome.required).toBe(required)
  })

  it('accepts an offer at or above the required wage for a legal length', () => {
    const required = requiredWage(baseContext, 2)
    const outcome = evaluateOffer(baseContext, { wage: required, seasons: 2 })
    expect(outcome.accepted).toBe(true)
  })
})

describe('isExpiring', () => {
  it('is true when the contract ends this season or earlier', () => {
    expect(isExpiring(3, 3)).toBe(true)
    expect(isExpiring(2, 3)).toBe(true)
  })

  it('is false when the contract runs beyond this season', () => {
    expect(isExpiring(4, 3)).toBe(false)
  })
})

describe('aiRenews', () => {
  const thin = { age: 27, skillLevel: 70, squadMedianSkill: 70, squadSize: 18, targetSquadSize: 22 }

  it('always renews when the squad is critically thin', () => {
    expect(aiRenews(thin)).toBe(true)
  })

  it('releases a fading veteran below the squad median', () => {
    const veteran = { age: 34, skillLevel: 60, squadMedianSkill: 70, squadSize: 22, targetSquadSize: 22 }
    expect(aiRenews(veteran)).toBe(false)
  })
})

describe('aiContractLength', () => {
  it('offers longer deals to younger players, capped by age', () => {
    expect(aiContractLength(21)).toBe(4)
    expect(aiContractLength(26)).toBe(3)
    expect(aiContractLength(30)).toBe(2)
  })

  it('never exceeds what the player would sign at their age', () => {
    expect(aiContractLength(34)).toBeLessThanOrEqual(maxSeasonsFor(34))
  })
})

describe('canCarryWage', () => {
  it('requires roughly 60 matchdays of wage in the bank', () => {
    expect(canCarryWage(60_000, 1_000)).toBe(false)
    expect(canCarryWage(60_001, 1_000)).toBe(true)
  })
})
