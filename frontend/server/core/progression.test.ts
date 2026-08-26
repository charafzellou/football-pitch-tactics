import { describe, expect, it, vi } from 'vitest'
import {
  MAX_SKILL,
  MIN_SKILL,
  academyGrade,
  academyIntakeBonus,
  developSkill,
  initialPotential,
  injuryRecoveryChance,
  marketValueFor,
  positionsToFill,
  retirementChance,
  shouldRetire,
  trainingDecayFactor,
  trainingDevelopmentFactor,
  trainingRecoveryBonus,
} from './progression'

describe('initialPotential', () => {
  it('never sets a ceiling below the current skill', () => {
    for (const age of [17, 20, 23, 26, 29]) {
      const potential = initialPotential(70, age)
      expect(potential).toBeGreaterThanOrEqual(70)
    }
  })

  it('never exceeds the max skill', () => {
    expect(initialPotential(95, 17)).toBeLessThanOrEqual(MAX_SKILL)
  })

  it('gives a teenager more average headroom than a player in their late twenties', () => {
    // Headroom is randomised, so sample many draws and compare averages
    // rather than asserting a single draw — a flaky single-sample assertion
    // would fail ~occasionally even though the *distribution* is correct.
    const sample = (age: number) => {
      const draws = Array.from({ length: 200 }, () => initialPotential(60, age) - 60)
      return draws.reduce((a, b) => a + b, 0) / draws.length
    }

    expect(sample(17)).toBeGreaterThan(sample(28))
  })
})

describe('trainingDevelopmentFactor and trainingDecayFactor', () => {
  it('is neutral (1x) at the default training level', () => {
    expect(trainingDevelopmentFactor(1)).toBe(1)
    expect(trainingDecayFactor(1)).toBe(1)
  })

  it('a better facility accelerates development and slows decay', () => {
    expect(trainingDevelopmentFactor(3)).toBeGreaterThan(1)
    expect(trainingDecayFactor(3)).toBeLessThan(1)
  })

  it('a worse facility does the opposite', () => {
    expect(trainingDevelopmentFactor(0)).toBeLessThan(1)
    expect(trainingDecayFactor(0)).toBeGreaterThan(1)
  })
})

describe('academyGrade', () => {
  it('is neutral at the default academy level', () => {
    expect(academyGrade(1)).toEqual({ skill: 0, potential: 0 })
  })

  it('a higher academy level grades graduates up', () => {
    const grade = academyGrade(3)
    expect(grade.skill).toBeGreaterThan(0)
    expect(grade.potential).toBeGreaterThan(0)
  })
})

describe('developSkill', () => {
  it('never exceeds the player\'s potential ceiling', () => {
    for (let i = 0; i < 50; i++)
      expect(developSkill(65, 70, 19)).toBeLessThanOrEqual(70)
  })

  it('never drops below the minimum skill floor', () => {
    for (let i = 0; i < 50; i++)
      expect(developSkill(41, 41, 38)).toBeGreaterThanOrEqual(MIN_SKILL)
  })

  it('plateaus once skill has already reached potential', () => {
    // No headroom left -> growth term is 0, so the only movement possible is
    // decline once age crosses 30 — a 19-year-old with no headroom left sits
    // still.
    expect(developSkill(70, 70, 19)).toBe(70)
  })

  it('a young player with headroom tends to improve, on average', () => {
    const draws = Array.from({ length: 100 }, () => developSkill(60, 90, 19))
    const average = draws.reduce((a, b) => a + b, 0) / draws.length
    expect(average).toBeGreaterThan(60)
  })

  it('an ageing player past their peak tends to decline, on average', () => {
    const draws = Array.from({ length: 100 }, () => developSkill(75, 75, 34))
    const average = draws.reduce((a, b) => a + b, 0) / draws.length
    expect(average).toBeLessThan(75)
  })

  it('a better training ground softens decline for an ageing player', () => {
    const withoutTraining = Array.from({ length: 200 }, () => developSkill(75, 75, 34, 0))
    const withTraining = Array.from({ length: 200 }, () => developSkill(75, 75, 34, 3))
    const avgWithout = withoutTraining.reduce((a, b) => a + b, 0) / withoutTraining.length
    const avgWith = withTraining.reduce((a, b) => a + b, 0) / withTraining.length
    expect(avgWith).toBeGreaterThan(avgWithout)
  })
})

describe('trainingRecoveryBonus and injuryRecoveryChance', () => {
  it('are zero at or below the default training level', () => {
    expect(trainingRecoveryBonus(1)).toBe(0)
    expect(trainingRecoveryBonus(0)).toBe(0)
    expect(injuryRecoveryChance(1)).toBe(0)
  })

  it('improve with a better training ground', () => {
    expect(trainingRecoveryBonus(3)).toBeGreaterThan(0)
    expect(injuryRecoveryChance(3)).toBeGreaterThan(0)
  })
})

describe('retirementChance', () => {
  it('is 0 below the retirement floor age', () => {
    expect(retirementChance(33, 40)).toBe(0)
  })

  it('is 1 at the forced retirement age regardless of skill', () => {
    expect(retirementChance(40, 99)).toBe(1)
  })

  it('a declining player is more likely to retire than one still excellent', () => {
    expect(retirementChance(36, 50)).toBeGreaterThan(retirementChance(36, 90))
  })

  it('increases with age within the retirement window', () => {
    expect(retirementChance(38, 70)).toBeGreaterThan(retirementChance(35, 70))
  })
})

describe('shouldRetire', () => {
  it('never retires a player below the floor age', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(shouldRetire(30, 40)).toBe(false)
    spy.mockRestore()
  })

  it('always retires a player at the forced retirement age', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.999)
    expect(shouldRetire(40, 99)).toBe(true)
    spy.mockRestore()
  })
})

describe('marketValueFor', () => {
  it('increases exponentially with skill', () => {
    const low = marketValueFor(50, 26)
    const high = marketValueFor(90, 26)
    expect(high).toBeGreaterThan(low * 5)
  })

  it('never drops below the 50,000 floor', () => {
    expect(marketValueFor(1, 40)).toBeGreaterThanOrEqual(50_000)
  })

  it('prices in potential for a promising player under 23', () => {
    const noPotential = marketValueFor(60, 20)
    const highPotential = marketValueFor(60, 20, 90)
    expect(highPotential).toBeGreaterThan(noPotential)
  })

  it('does not price in potential for a player 23 or older', () => {
    // Same skill/potential gap, but the age is outside the discount window.
    const veteranJitterless = Array.from({ length: 50 }, () => marketValueFor(60, 28, 90))
    const veteranNoPotential = Array.from({ length: 50 }, () => marketValueFor(60, 28))
    const avgWith = veteranJitterless.reduce((a, b) => a + b, 0) / veteranJitterless.length
    const avgWithout = veteranNoPotential.reduce((a, b) => a + b, 0) / veteranNoPotential.length
    // Within jitter noise (±12%) of each other, since potential shouldn't move it.
    expect(Math.abs(avgWith - avgWithout) / avgWithout).toBeLessThan(0.15)
  })

  it('peaks around the mid-twenties and falls away for older players', () => {
    const peak = marketValueFor(75, 26)
    const veteran = marketValueFor(75, 36)
    expect(veteran).toBeLessThan(peak)
  })
})

describe('positionsToFill', () => {
  it('fills the biggest shortfall first', () => {
    // SQUAD_SHAPE is GK:3 DEF:7 MID:7 ATT:5 -- starting from nothing, the
    // first slot requested should be whichever position is neediest first
    // (DEF and MID tie at 7; the implementation picks DEF as it iterates
    // GK/DEF/MID/ATT and DEF appears first in that order at an equal deficit).
    const wanted = positionsToFill({ GK: 0, DEF: 0, MID: 0, ATT: 0 }, 1)
    expect(wanted).toEqual(['DEF'])
  })

  it('returns exactly as many positions as slots requested', () => {
    const wanted = positionsToFill({ GK: 3, DEF: 7, MID: 7, ATT: 5 }, 4)
    expect(wanted).toHaveLength(4)
  })

  it('never requests more of a position than the shape wants once caught up', () => {
    // Starting balanced, the four picks it makes should spread across
    // distinct positions rather than piling into one.
    const wanted = positionsToFill({ GK: 3, DEF: 7, MID: 7, ATT: 5 }, 4)
    expect(new Set(wanted).size).toBe(4)
  })
})

describe('academyIntakeBonus', () => {
  it('is 0 below the top academy level', () => {
    expect(academyIntakeBonus(0)).toBe(0)
    expect(academyIntakeBonus(2)).toBe(0)
  })

  it('is 1 at the top academy level', () => {
    expect(academyIntakeBonus(3)).toBe(1)
  })
})
