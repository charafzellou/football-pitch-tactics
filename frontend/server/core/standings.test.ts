import { describe, expect, it } from 'vitest'
import { byLeaguePosition } from './standings'
import type { StandingRow } from './standings'

function row(overrides: Partial<StandingRow>): StandingRow {
  return {
    teamId: 1,
    teamName: 'Team',
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
    ...overrides,
  }
}

describe('byLeaguePosition', () => {
  it('sorts by points first', () => {
    const a = row({ teamName: 'A', points: 30 })
    const b = row({ teamName: 'B', points: 45 })
    expect([a, b].sort(byLeaguePosition)).toEqual([b, a])
  })

  it('breaks a points tie on goal difference', () => {
    const a = row({ teamName: 'A', points: 30, goalDifference: 2 })
    const b = row({ teamName: 'B', points: 30, goalDifference: 10 })
    expect([a, b].sort(byLeaguePosition)).toEqual([b, a])
  })

  it('breaks a goal-difference tie on goals scored', () => {
    const a = row({ teamName: 'A', points: 30, goalDifference: 5, goalsFor: 40 })
    const b = row({ teamName: 'B', points: 30, goalDifference: 5, goalsFor: 55 })
    expect([a, b].sort(byLeaguePosition)).toEqual([b, a])
  })

  it('falls back to alphabetical name as the final tiebreak', () => {
    const a = row({ teamName: 'Zebra', points: 30, goalDifference: 5, goalsFor: 40 })
    const b = row({ teamName: 'Alpha', points: 30, goalDifference: 5, goalsFor: 40 })
    expect([a, b].sort(byLeaguePosition)).toEqual([b, a])
  })
})
