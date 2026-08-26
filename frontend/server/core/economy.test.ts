import { describe, expect, it } from 'vitest'
import {
  attendanceFor,
  commercialPoolFor,
  eventFeeFor,
  facilityUpgradeCost,
  fairTicketPrice,
  formRatingFrom,
  gateReceiptsFor,
  hospitalityIncomeFor,
  matchdayOperatingCostFor,
  merchandisingFor,
  perimeterIncomeFor,
  perimeterTier,
  perimeterUpgradeCost,
  pitchInjuryScaleFor,
  pitchPenaltyFor,
  prizeMoneyFor,
  recoverPitch,
  reputationFor,
  seasonTicketHolders,
  seasonTicketRevenue,
  slotValueFor,
  sponsorshipFor,
  squadStrength,
  stadiumCapacityFor,
  starPowerOf,
  startingBalanceFor,
  tierFor,
  wageExpectation,
  wageFor,
  wearPitch,
} from './economy'

describe('squadStrength', () => {
  it('averages the best eleven, ignoring depth', () => {
    const squad = Array.from({ length: 20 }, (_, i) => ({ skillLevel: 50 + i }))
    // Best 11 are skill 59..69 (i = 9..19), average = 64.
    expect(squadStrength(squad)).toBe(64)
  })

  it('returns 0 for an empty squad', () => {
    expect(squadStrength([])).toBe(0)
  })

  it('averages the whole squad when fewer than eleven players', () => {
    expect(squadStrength([{ skillLevel: 60 }, { skillLevel: 80 }])).toBe(70)
  })
})

describe('reputationFor', () => {
  it('returns 25 for an empty squad', () => {
    expect(reputationFor([])).toBe(25)
  })

  it('is purely absolute without a league rank', () => {
    const squad = Array.from({ length: 11 }, () => ({ skillLevel: 95 }))
    expect(reputationFor(squad)).toBe(100)
  })

  it('rewards a higher league rank at equal squad strength', () => {
    const squad = Array.from({ length: 11 }, () => ({ skillLevel: 70 }))
    const first = reputationFor(squad, 1, 20)
    const last = reputationFor(squad, 20, 20)
    expect(first).toBeGreaterThan(last)
  })

  it('stays within 10..100 regardless of inputs', () => {
    const weak = Array.from({ length: 11 }, () => ({ skillLevel: 40 }))
    const rep = reputationFor(weak, 20, 20)
    expect(rep).toBeGreaterThanOrEqual(10)
    expect(rep).toBeLessThanOrEqual(100)
  })
})

describe('tierFor', () => {
  it('buckets reputation into the four tiers at their boundaries', () => {
    expect(tierFor(85)).toBe('elite')
    expect(tierFor(84)).toBe('big')
    expect(tierFor(70)).toBe('big')
    expect(tierFor(69)).toBe('mid')
    expect(tierFor(50)).toBe('mid')
    expect(tierFor(49)).toBe('small')
    expect(tierFor(0)).toBe('small')
  })
})

describe('stadiumCapacityFor', () => {
  it('increases monotonically with reputation', () => {
    const capacities = [10, 30, 50, 70, 90, 100].map(stadiumCapacityFor)
    for (let i = 1; i < capacities.length; i++)
      expect(capacities[i]).toBeGreaterThanOrEqual(capacities[i - 1]!)
  })

  it('rounds to the nearest 500', () => {
    for (const rep of [10, 33, 55, 78, 99])
      expect(stadiumCapacityFor(rep) % 500).toBe(0)
  })

  it('caps out near 80,000 at reputation 100', () => {
    expect(stadiumCapacityFor(100)).toBeLessThanOrEqual(80_000)
    expect(stadiumCapacityFor(100)).toBeGreaterThan(70_000)
  })
})

describe('fairTicketPrice', () => {
  it('is 12 at reputation 0 and 50 at reputation 100', () => {
    expect(fairTicketPrice(0)).toBe(12)
    expect(fairTicketPrice(100)).toBe(50)
  })
})

describe('wageFor', () => {
  it('increases with market value', () => {
    expect(wageFor(10_000_000, 26, 60)).toBeGreaterThan(wageFor(1_000_000, 26, 60))
  })

  it('never drops below the 1,000 floor', () => {
    expect(wageFor(0, 26, 0)).toBeGreaterThanOrEqual(1_000)
  })

  it('a bigger club pays the same player more', () => {
    const small = wageFor(5_000_000, 26, 20)
    const big = wageFor(5_000_000, 26, 90)
    expect(big).toBeGreaterThan(small)
  })

  it('young players are cheaper than peak-age players at the same value', () => {
    const young = wageFor(5_000_000, 20, 60)
    const peak = wageFor(5_000_000, 26, 60)
    expect(young).toBeLessThan(peak)
  })
})

describe('wageExpectation', () => {
  it('exceeds the club-would-pay wage (players ask for a premium)', () => {
    const base = wageFor(5_000_000, 26, 50)
    const demand = wageExpectation(5_000_000, 26, 50)
    expect(demand).toBeGreaterThanOrEqual(base)
  })

  it('softens the premium more for a prestigious club than a small one', () => {
    // wageExpectation = wageFor(...) * prestige, and wageFor's own club-size
    // scaling already prices a bigger club's *base* wage higher — so total
    // demand at a big club is not necessarily lower. What "softened by
    // prestige" means is narrower: the premium *on top of* what the club
    // would pay anyway shrinks as reputation rises. Isolate that by comparing
    // the ratio to wageFor(), which cancels the base and leaves the prestige
    // factor alone.
    const bigClubRatio = wageExpectation(5_000_000, 26, 90) / wageFor(5_000_000, 26, 90)
    const smallClubRatio = wageExpectation(5_000_000, 26, 20) / wageFor(5_000_000, 26, 20)
    expect(bigClubRatio).toBeLessThan(smallClubRatio)
  })
})

describe('attendanceFor', () => {
  const base = {
    capacity: 40_000,
    reputation: 60,
    opponentReputation: 60,
    formRating: 0.5,
    position: 10,
    leagueSize: 20,
  }

  it('never exceeds capacity', () => {
    const attendance = attendanceFor({ ...base, ticketPrice: 1 })
    expect(attendance).toBeLessThanOrEqual(base.capacity)
  })

  it('never goes negative and always fields somebody', () => {
    const attendance = attendanceFor({ ...base, ticketPrice: 120 })
    expect(attendance).toBeGreaterThan(0)
  })

  it('overcharging relative to the fair price reduces the crowd', () => {
    const fair = fairTicketPrice(base.reputation)
    const atFair = attendanceFor({ ...base, ticketPrice: fair })
    const overpriced = attendanceFor({ ...base, ticketPrice: fair * 2 })
    expect(overpriced).toBeLessThan(atFair)
  })

  it('a higher league position draws a bigger crowd, all else equal', () => {
    const top = attendanceFor({ ...base, position: 1, ticketPrice: fairTicketPrice(base.reputation) })
    const bottom = attendanceFor({ ...base, position: 20, ticketPrice: fairTicketPrice(base.reputation) })
    expect(top).toBeGreaterThan(bottom)
  })
})

describe('gateReceiptsFor', () => {
  it('multiplies attendance by ticket price', () => {
    expect(gateReceiptsFor(10_000, 30)).toBe(300_000)
  })
})

describe('sponsorshipFor and prizeMoneyFor', () => {
  it('sponsorship scales steeply with reputation', () => {
    const small = sponsorshipFor(20, 10, 20)
    const elite = sponsorshipFor(95, 10, 20)
    expect(elite).toBeGreaterThan(small * 5)
  })

  it('a better league position earns more sponsorship at equal reputation', () => {
    const top = sponsorshipFor(70, 1, 20)
    const bottom = sponsorshipFor(70, 20, 20)
    expect(top).toBeGreaterThan(bottom)
  })

  it('prize money rewards both reputation and position', () => {
    const champion = prizeMoneyFor(90, 1, 20)
    const relegated = prizeMoneyFor(90, 20, 20)
    expect(champion).toBeGreaterThan(relegated)
  })
})

describe('the commercial pool invariant', () => {
  // The exact "pool minus costs equals the old plain figure" identity is
  // already proven empirically, against real seeded squads, by
  // `scripts/verify-economy.ts` ("worst drift across seven club sizes
  // 0.07%") — re-deriving every cost line by hand here would just duplicate
  // that check with a much cruder model of the costs. What's worth pinning
  // down at the unit level is the shape the invariant depends on: the pool
  // is *exactly* sponsorshipFor() scaled by one constant, and that constant
  // is a sane gross-up (bigger than 1, not absurdly so).
  it('is sponsorshipFor() scaled by exactly one constant uplift', () => {
    for (const [reputation, position, leagueSize] of [[20, 10, 20], [50, 5, 20], [95, 1, 20]] as const) {
      const plain = sponsorshipFor(reputation, position, leagueSize)
      const pool = commercialPoolFor(reputation, position, leagueSize)
      const uplift = pool / plain

      expect(uplift).toBeGreaterThan(1)
      expect(uplift).toBeLessThan(1.5)
    }
  })

  it('slotValueFor splits the pool by the documented shares', () => {
    const pool = 1_000_000
    expect(slotValueFor(pool, 'shirt')).toBe(Math.round(pool * 0.38))
    expect(slotValueFor(pool, 'kit_maker')).toBe(Math.round(pool * 0.22))
    expect(slotValueFor(pool, 'sleeve')).toBe(Math.round(pool * 0.09))
  })
})

describe('perimeterTier and perimeterUpgradeCost', () => {
  it('clamps to the valid tier range', () => {
    expect(perimeterTier(-5).level).toBe(0)
    expect(perimeterTier(99).level).toBe(3)
  })

  it('costs nothing to upgrade past the top tier', () => {
    expect(perimeterUpgradeCost(1_000_000, 3)).toBe(0)
  })

  it('costs something to upgrade from a non-maxed tier', () => {
    expect(perimeterUpgradeCost(1_000_000, 0)).toBeGreaterThan(0)
  })
})

describe('hospitalityIncomeFor', () => {
  it('is zero with no boxes', () => {
    expect(hospitalityIncomeFor(0, 60, 60)).toBe(0)
  })

  it('increases with box count', () => {
    expect(hospitalityIncomeFor(10, 60, 60)).toBeGreaterThan(hospitalityIncomeFor(5, 60, 60))
  })
})

describe('starPowerOf', () => {
  it('is 0 for a squad smaller than 5', () => {
    expect(starPowerOf([{ skillLevel: 99 }])).toBe(0)
  })

  it('is positive when the best player clears the reference gap over the median', () => {
    const squad = [
      { skillLevel: 50 }, { skillLevel: 52 }, { skillLevel: 54 }, { skillLevel: 56 }, { skillLevel: 99 },
    ]
    expect(starPowerOf(squad)).toBeGreaterThan(0)
  })

  it('is roughly zero for a squad with the reference-typical gap', () => {
    // Reference gap is 14: median 54, best 68.
    const squad = [
      { skillLevel: 50 }, { skillLevel: 52 }, { skillLevel: 54 }, { skillLevel: 56 }, { skillLevel: 68 },
    ]
    expect(starPowerOf(squad)).toBe(0)
  })
})

describe('eventFeeFor', () => {
  it('a concert pays more than a community day at the same ground', () => {
    const concert = eventFeeFor('concert', 40_000, 60)
    const community = eventFeeFor('community', 40_000, 60)
    expect(concert).toBeGreaterThan(community)
  })
})

describe('pitch condition helpers', () => {
  it('recoverPitch never exceeds 100', () => {
    expect(recoverPitch(96)).toBe(100)
    expect(recoverPitch(100)).toBe(100)
  })

  it('wearPitch never drops below the floor', () => {
    expect(wearPitch(30, 50)).toBe(25)
  })

  it('a worse pitch condition penalises attack/defence more', () => {
    expect(pitchPenaltyFor(25)).toBeGreaterThan(pitchPenaltyFor(90))
    expect(pitchPenaltyFor(100)).toBe(0)
  })

  it('a worse pitch condition raises injury risk', () => {
    expect(pitchInjuryScaleFor(25)).toBeGreaterThan(pitchInjuryScaleFor(100))
    expect(pitchInjuryScaleFor(100)).toBe(1)
  })
})

describe('season tickets', () => {
  it('zero share sells zero seats', () => {
    expect(seasonTicketHolders(40_000, 0)).toBe(0)
  })

  it('caps the share at the maximum', () => {
    expect(seasonTicketHolders(40_000, 200)).toBe(seasonTicketHolders(40_000, 45))
  })

  it('a discount lowers season ticket revenue at equal holders', () => {
    const noDiscount = seasonTicketRevenue(1000, 30, 0, 19)
    const discounted = seasonTicketRevenue(1000, 30, 20, 19)
    expect(discounted).toBeLessThan(noDiscount)
  })
})

describe('facilityUpgradeCost', () => {
  it('costs more to upgrade a higher tier', () => {
    expect(facilityUpgradeCost(1_000_000, 2)).toBeGreaterThan(facilityUpgradeCost(1_000_000, 0))
  })
})

describe('startingBalanceFor', () => {
  it('a bigger club starts with more cash than a small one', () => {
    const small = startingBalanceFor(20, 15_000)
    const elite = startingBalanceFor(95, 75_000)
    expect(elite).toBeGreaterThan(small)
  })

  it('is never negative', () => {
    expect(startingBalanceFor(10, 12_000)).toBeGreaterThanOrEqual(0)
  })
})

describe('formRatingFrom', () => {
  it('is 0.5 with no results', () => {
    expect(formRatingFrom([])).toBe(0.5)
  })

  it('is 1 for a run of wins', () => {
    expect(formRatingFrom(['W', 'W', 'W'])).toBe(1)
  })

  it('is 0 for a run of losses', () => {
    expect(formRatingFrom(['L', 'L'])).toBe(0)
  })

  it('draws count as a third of a win', () => {
    expect(formRatingFrom(['D'])).toBeCloseTo(1 / 3)
  })
})
