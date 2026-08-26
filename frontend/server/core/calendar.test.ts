import { describe, expect, it } from 'vitest'
import { buildSeasonFixtures, dateForRound, roundsFor, seasonStartDate } from './calendar'

describe('roundsFor', () => {
  it('is 0 for fewer than 2 teams', () => {
    expect(roundsFor(0)).toBe(0)
    expect(roundsFor(1)).toBe(0)
  })

  it('is 38 for a 20-club double round-robin', () => {
    expect(roundsFor(20)).toBe(38)
  })

  it('pads an odd team count with a bye slot', () => {
    // 19 teams padded to 20 -> same round count as an even 20.
    expect(roundsFor(19)).toBe(roundsFor(20))
  })
})

describe('seasonStartDate', () => {
  it('season 1 starts in the base year', () => {
    const date = seasonStartDate(1, 2024)
    expect(date.getUTCFullYear()).toBe(2024)
  })

  it('each season starts a year later', () => {
    const s1 = seasonStartDate(1, 2024)
    const s2 = seasonStartDate(2, 2024)
    expect(s2.getUTCFullYear()).toBe(s1.getUTCFullYear() + 1)
  })
})

describe('dateForRound', () => {
  it('round 1 is exactly the start date', () => {
    const start = new Date(Date.UTC(2024, 7, 10, 15, 0, 0))
    expect(dateForRound(1, start).getTime()).toBe(start.getTime())
  })

  it('each round is 7 days after the previous one', () => {
    const start = new Date(Date.UTC(2024, 7, 10, 15, 0, 0))
    const round2 = dateForRound(2, start)
    const diffDays = (round2.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)
    expect(diffDays).toBe(7)
  })
})

describe('buildSeasonFixtures', () => {
  it('returns nothing for fewer than 2 teams', () => {
    expect(buildSeasonFixtures([1], 1)).toEqual([])
  })

  it('every club plays every other club home and away exactly once', () => {
    const teamIds = [1, 2, 3, 4]
    const fixtures = buildSeasonFixtures(teamIds, 1)

    // 4 teams -> 3 rounds each way -> 6 rounds -> 12 fixtures total.
    expect(fixtures).toHaveLength(12)

    for (const home of teamIds) {
      for (const away of teamIds) {
        if (home === away) continue
        const count = fixtures.filter(f => f.homeTeamId === home && f.awayTeamId === away).length
        expect(count).toBe(1)
      }
    }
  })

  it('every club appears exactly once per round', () => {
    const teamIds = [1, 2, 3, 4, 5, 6]
    const fixtures = buildSeasonFixtures(teamIds, 1)
    const byRound = new Map<number, number[]>()

    for (const fixture of fixtures) {
      const teams = byRound.get(fixture.round) ?? []
      teams.push(fixture.homeTeamId, fixture.awayTeamId)
      byRound.set(fixture.round, teams)
    }

    for (const [, teams] of byRound) {
      expect(new Set(teams).size).toBe(teams.length)
      expect(teams).toHaveLength(teamIds.length)
    }
  })

  it('handles an odd team count via a bye, with one fewer fixture per round', () => {
    const teamIds = [1, 2, 3, 4, 5]
    const fixtures = buildSeasonFixtures(teamIds, 1)

    // roundsFor(5) treats it as 6 -> 5 rounds each way -> 10 rounds total,
    // each round missing exactly one team (the bye).
    const rounds = new Set(fixtures.map(f => f.round))
    expect(rounds.size).toBe(roundsFor(5))

    for (const round of rounds) {
      const inRound = fixtures.filter(f => f.round === round)
      expect(inRound.length).toBe(2)
    }
  })

  it('stamps every fixture with the season number passed in', () => {
    const fixtures = buildSeasonFixtures([1, 2, 3, 4], 7)
    expect(fixtures.every(f => f.season === 7)).toBe(true)
  })

  it('every fixture in a round shares the same match date', () => {
    const fixtures = buildSeasonFixtures([1, 2, 3, 4, 5, 6], 1)
    const byRound = new Map<number, Set<number>>()

    for (const fixture of fixtures) {
      const dates = byRound.get(fixture.round) ?? new Set<number>()
      dates.add(fixture.matchDate.getTime())
      byRound.set(fixture.round, dates)
    }

    for (const [, dates] of byRound)
      expect(dates.size).toBe(1)
  })
})
