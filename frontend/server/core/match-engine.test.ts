import { describe, expect, it } from 'vitest'
import type { Player, Team } from './match-engine'
import { kickOff, simulateSegment } from './match-engine'
import { TACTICS } from './tactics'

/** A full 22-player squad: enough of every position to field an XI plus bench. */
function buildSquad(teamId: number, offset = 0): Player[] {
  const players: Player[] = []
  let id = offset

  const add = (count: number, position: string, skillBase: number) => {
    for (let i = 0; i < count; i++) {
      id += 1
      players.push({
        id,
        name: `Player ${id}`,
        age: 26,
        position,
        skillLevel: skillBase + (i % 5),
        stamina: 100,
        marketValue: 1_000_000,
        teamId,
      })
    }
  }

  add(4, 'GK', 65)
  add(8, 'DF', 65)
  add(7, 'MF', 65)
  add(5, 'FW', 65)

  return players
}

function buildTeam(id: number, overrides: Partial<Team> = {}): Team {
  return {
    id,
    name: `Team ${id}`,
    squad: buildSquad(id, id * 100),
    tactic: TACTICS[0]!,
    ...overrides,
  }
}

describe('kickOff', () => {
  it('starts at minute 0 with a fresh scoreline', () => {
    const state = kickOff(buildTeam(1), buildTeam(2))
    expect(state.minute).toBe(0)
    expect(state.home.score).toBe(0)
    expect(state.away.score).toBe(0)
  })

  it('fields exactly eleven starters per side', () => {
    const state = kickOff(buildTeam(1), buildTeam(2))
    expect(state.home.startingXi).toHaveLength(11)
    expect(state.away.startingXi).toHaveLength(11)
  })

  it('starters and bench never overlap', () => {
    const state = kickOff(buildTeam(1), buildTeam(2))
    const overlap = state.home.startingXi.filter(id => state.home.bench.includes(id))
    expect(overlap).toHaveLength(0)
  })

  it('carries each player\'s existing stamina into the match', () => {
    const team = buildTeam(1)
    team.squad[0]!.stamina = 40
    const state = kickOff(team, buildTeam(2))
    // Whichever slot that low-stamina player landed in (starter or bench),
    // their stamina in state should reflect what they came in with.
    expect(state.home.stamina[team.squad[0]!.id]).toBe(40)
  })
})

describe('simulateSegment', () => {
  it('advances state.minute to exactly the requested minute', () => {
    const home = buildTeam(1)
    const away = buildTeam(2)
    const state = kickOff(home, away)
    const { state: after } = simulateSegment(home, away, state, 45)
    expect(after.minute).toBe(45)
  })

  it('drains stamina for players on the pitch over 90 minutes', () => {
    const home = buildTeam(1)
    const away = buildTeam(2)
    const state = kickOff(home, away)
    const { state: after } = simulateSegment(home, away, state, 90)

    const starterId = after.home.startingXi[0]!
    expect(after.home.stamina[starterId]).toBeLessThan(100)
  })

  it('is resumable: simulating to 90 in one call matches two calls to 45 then 90', () => {
    // Not a bit-exact replay test (Math.random() means the actual events
    // differ), but the *shape* of the state must not depend on how the
    // 90 minutes were chunked: same minute reached, same starters counted.
    const home = buildTeam(1)
    const away = buildTeam(2)

    const oneShot = simulateSegment(home, away, kickOff(home, away), 90)
    const twoShots = (() => {
      const first = simulateSegment(home, away, kickOff(home, away), 45)
      return simulateSegment(home, away, first.state, 90)
    })()

    expect(oneShot.state.minute).toBe(twoShots.state.minute)
    expect(oneShot.state.home.startingXi).toEqual(twoShots.state.home.startingXi)
  })

  it('never produces a score for a team with no players fielded generating a goal event for the other side', () => {
    const home = buildTeam(1)
    const away = buildTeam(2)
    const state = kickOff(home, away)
    const { events } = simulateSegment(home, away, state, 90)

    for (const event of events)
      expect([home.id, away.id]).toContain(event.teamId)
  })

  it('a heavily favoured side scores more than an evenly weak one, on average', () => {
    // Not calibration-grade (that's scripts/calibrate-match-engine.ts's job),
    // just a sanity check that skill matters at all: a squad drawn at 95
    // should heavily outscore one drawn at 40 over enough matches.
    const strongHome = buildTeam(1, { squad: buildSquad(1).map(p => ({ ...p, skillLevel: 95 })) })
    const weakAway = buildTeam(2, { squad: buildSquad(2, 100).map(p => ({ ...p, skillLevel: 40 })) })

    let strongGoals = 0
    let weakGoals = 0
    const MATCHES = 15

    for (let i = 0; i < MATCHES; i++) {
      const state = kickOff(strongHome, weakAway)
      const { state: final } = simulateSegment(strongHome, weakAway, state, 90)
      strongGoals += final.home.score
      weakGoals += final.away.score
    }

    expect(strongGoals).toBeGreaterThan(weakGoals)
  })

  it('a worn pitch, applied only to the home side, still produces a legal 90-minute state', () => {
    const home = buildTeam(1, { pitchCondition: 25 })
    const away = buildTeam(2)
    const state = kickOff(home, away)
    const { state: after } = simulateSegment(home, away, state, 90)

    expect(after.minute).toBe(90)
    expect(after.home.onPitch.length).toBeGreaterThan(0)
  })
})
