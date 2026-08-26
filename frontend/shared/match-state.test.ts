import { describe, expect, it } from 'vitest'
import {
  FATIGUE_FLOOR,
  HALF_TIME_MINUTE,
  MATCH_MINUTES,
  MAX_SUBSTITUTIONS,
  STAMINA_RECOVERY_PER_MATCH,
  advanceMinute,
  applyEvents,
  applyMidMatchChanges,
  effectiveSkill,
  nextBreakAfter,
  parseMatchState,
  recoveredStamina,
  sideFor,
  substitutionError,
} from './match-state'
import type { MatchEvent, MatchSideState, MatchState } from './match-state'

function side(overrides: Partial<MatchSideState> = {}): MatchSideState {
  return {
    teamId: 1,
    tacticName: '4-4-2',
    startingXi: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    onPitch: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    bench: [12, 13, 14, 15, 16, 17, 18],
    usedPlayers: [],
    booked: [],
    sentOff: [],
    subsUsed: 0,
    stamina: Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, 100])),
    drainRates: Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, 1])),
    injured: [],
    score: 0,
    ...overrides,
  }
}

function state(overrides: Partial<MatchState> = {}): MatchState {
  return {
    minute: 0,
    home: side({ teamId: 1 }),
    away: side({ teamId: 2 }),
    ...overrides,
  }
}

describe('effectiveSkill', () => {
  it('is full skill at 100 stamina', () => {
    expect(effectiveSkill(80, 100)).toBe(80)
  })

  it('is floored at FATIGUE_FLOOR of skill at 0 stamina', () => {
    expect(effectiveSkill(80, 0)).toBeCloseTo(80 * FATIGUE_FLOOR)
  })

  it('clamps stamina outside 0-100', () => {
    expect(effectiveSkill(80, 150)).toBe(effectiveSkill(80, 100))
    expect(effectiveSkill(80, -20)).toBe(effectiveSkill(80, 0))
  })
})

describe('recoveredStamina', () => {
  it('adds the flat recovery amount', () => {
    expect(recoveredStamina(50)).toBe(50 + STAMINA_RECOVERY_PER_MATCH)
  })

  it('never exceeds 100', () => {
    expect(recoveredStamina(95)).toBe(100)
  })
})

describe('nextBreakAfter', () => {
  it('returns half time before it has passed', () => {
    expect(nextBreakAfter(10)).toBe(HALF_TIME_MINUTE)
  })

  it('returns full time once past half time', () => {
    expect(nextBreakAfter(60)).toBe(MATCH_MINUTES)
  })
})

describe('advanceMinute', () => {
  it('drains stamina for players on the pitch', () => {
    const s = state()
    const next = advanceMinute(s, 1, [])
    expect(next.home.stamina[1]).toBeLessThan(100)
  })

  it('does not drain stamina for players on the bench', () => {
    const s = state()
    const next = advanceMinute(s, 1, [])
    expect(next.home.stamina[12]).toBe(100)
  })

  it('recovers a little stamina when a single call crosses the half-time minute', () => {
    // The cross check is `state.minute < 45 && minute > 45` — a genuine skip
    // over 45 in one call, which is what a resume-from-pause does. Stepping
    // one minute at a time (44->45, then 45->46) never satisfies it, since
    // 45 is not < 45 on the second call — that's the case below.
    const s = state({ minute: 44, home: side({ teamId: 1, stamina: { 1: 50, ...Object.fromEntries(Array.from({ length: 17 }, (_, i) => [i + 2, 100])) } }) })
    const next = advanceMinute(s, 46, [])
    expect(next.home.stamina[1]).toBeGreaterThan(50 - 0.25 * 2)
  })

  it('does not recover crossing 45 one minute at a time (the recovery only fires on a genuine skip)', () => {
    const atHalfTime = advanceMinute(state({ minute: 44 }), 45, [])
    const afterHalfTime = advanceMinute(atHalfTime, 46, [])
    // Two plain drains, no +2 recovery bump — documents the current
    // per-minute-stepping behaviour rather than asserting it's ideal.
    expect(afterHalfTime.home.stamina[1]).toBeCloseTo(100 - 0.25 * 2)
  })

  it('a goal event increments the scoring side only', () => {
    const s = state()
    const event: MatchEvent = { minute: 1, eventType: 'goal', teamId: 1, playerId: 1 }
    const next = advanceMinute(s, 1, [event])
    expect(next.home.score).toBe(1)
    expect(next.away.score).toBe(0)
  })

  it('a yellow card books the named player', () => {
    const s = state()
    const event: MatchEvent = { minute: 1, eventType: 'yellow', teamId: 1, playerId: 3 }
    const next = advanceMinute(s, 1, [event])
    expect(next.home.booked).toContain(3)
  })

  it('a red card sends the player off and removes them from the pitch', () => {
    const s = state()
    const event: MatchEvent = { minute: 1, eventType: 'red', teamId: 1, playerId: 3 }
    const next = advanceMinute(s, 1, [event])
    expect(next.home.sentOff).toContain(3)
    expect(next.home.onPitch).not.toContain(3)
  })

  it('an injury takes the player off and zeroes their stamina', () => {
    const s = state()
    const event: MatchEvent = { minute: 1, eventType: 'injury', teamId: 1, playerId: 5 }
    const next = advanceMinute(s, 1, [event])
    expect(next.home.injured).toContain(5)
    expect(next.home.onPitch).not.toContain(5)
    expect(next.home.stamina[5]).toBe(0)
  })

  it('a substitution swaps the players and increments subsUsed', () => {
    const s = state()
    const event: MatchEvent = { minute: 1, eventType: 'substitution', teamId: 1, playerId: 12, relatedPlayerId: 1 }
    const next = advanceMinute(s, 1, [event])
    expect(next.home.onPitch).toContain(12)
    expect(next.home.onPitch).not.toContain(1)
    expect(next.home.bench).not.toContain(12)
    expect(next.home.usedPlayers).toContain(1)
    expect(next.home.subsUsed).toBe(1)
  })

  it('routes an event to the correct side by teamId', () => {
    const s = state()
    const event: MatchEvent = { minute: 1, eventType: 'goal', teamId: 2, playerId: 21 }
    const next = advanceMinute(s, 1, [event])
    expect(next.away.score).toBe(1)
    expect(next.home.score).toBe(0)
  })
})

describe('applyEvents', () => {
  it('folds multiple minutes of events forward in order', () => {
    const s = state()
    const events: MatchEvent[] = [
      { minute: 10, eventType: 'goal', teamId: 1, playerId: 9 },
      { minute: 20, eventType: 'goal', teamId: 1, playerId: 9 },
    ]
    const after = applyEvents(s, events, 30)
    expect(after.minute).toBe(30)
    expect(after.home.score).toBe(2)
  })

  it('ignores events at or before the current minute (no double-apply)', () => {
    const s = state({ minute: 15 })
    const events: MatchEvent[] = [{ minute: 10, eventType: 'goal', teamId: 1, playerId: 9 }]
    const after = applyEvents(s, events, 20)
    expect(after.home.score).toBe(0)
  })

  it('ignores events beyond the target minute', () => {
    const s = state()
    const events: MatchEvent[] = [{ minute: 50, eventType: 'goal', teamId: 1, playerId: 9 }]
    const after = applyEvents(s, events, 20)
    expect(after.home.score).toBe(0)
    expect(after.minute).toBe(20)
  })

  it('is a no-op when toMinute is not after the current minute', () => {
    const s = state({ minute: 30 })
    const after = applyEvents(s, [{ minute: 20, eventType: 'goal', teamId: 1, playerId: 9 }], 20)
    expect(after).toBe(s)
  })
})

describe('substitutionError', () => {
  it('allows a legal substitution', () => {
    const s = side()
    expect(substitutionError(s, { playerOutId: 1, playerInId: 12 })).toBeNull()
  })

  it('blocks once all five substitutions are used', () => {
    const s = side({ subsUsed: MAX_SUBSTITUTIONS })
    expect(substitutionError(s, { playerOutId: 1, playerInId: 12 })).toMatch(/No substitutions/)
  })

  it('blocks substituting a player for themselves', () => {
    const s = side()
    expect(substitutionError(s, { playerOutId: 1, playerInId: 1 })).toMatch(/themselves/)
  })

  it('blocks bringing off a player who is not on the pitch nor a pending injury replacement', () => {
    const s = side()
    expect(substitutionError(s, { playerOutId: 12, playerInId: 13 })).toMatch(/not on the pitch/)
  })

  it('allows replacing an already-injured player even though they are off the pitch', () => {
    const s = side({ onPitch: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11], injured: [1] })
    expect(substitutionError(s, { playerOutId: 1, playerInId: 12 })).toBeNull()
  })

  it('blocks replacing an injured player who has already been substituted off', () => {
    // Once actually substituted off, a player leaves onPitch for good (see
    // `foldEvent`'s substitution case) — this is the state after that has
    // already happened, not merely "injured".
    const s = side({ onPitch: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13], injured: [1], usedPlayers: [1] })
    expect(substitutionError(s, { playerOutId: 1, playerInId: 12 })).toMatch(/not on the pitch/)
  })

  it('blocks bringing on a sent-off player\'s replacement twice', () => {
    const s = side({ sentOff: [1] })
    expect(substitutionError(s, { playerOutId: 1, playerInId: 12 })).toMatch(/sent-off/)
  })

  it('blocks bringing on someone not on the bench', () => {
    const s = side()
    expect(substitutionError(s, { playerOutId: 1, playerInId: 999 })).toMatch(/not available on the bench/)
  })

  it('blocks bringing on someone already substituted', () => {
    const s = side({ usedPlayers: [12] })
    expect(substitutionError(s, { playerOutId: 1, playerInId: 12 })).toMatch(/already been substituted/)
  })

  it('blocks bringing on an injured bench player', () => {
    const s = side({ injured: [12] })
    expect(substitutionError(s, { playerOutId: 1, playerInId: 12 })).toMatch(/injured/)
  })
})

describe('applyMidMatchChanges', () => {
  it('applies a legal substitution to the correct side only', () => {
    const s = state()
    const next = applyMidMatchChanges(s, 1, [{ playerOutId: 1, playerInId: 12 }])
    expect(next.home.onPitch).toContain(12)
    expect(next.away).toBe(s.away)
  })

  it('does not advance the clock', () => {
    const s = state({ minute: 30 })
    const next = applyMidMatchChanges(s, 1, [])
    expect(next.minute).toBe(30)
  })

  it('throws on an illegal substitution', () => {
    const s = state()
    expect(() => applyMidMatchChanges(s, 1, [{ playerOutId: 1, playerInId: 1 }])).toThrow()
  })

  it('updates the tactic name when one is given', () => {
    const s = state()
    const next = applyMidMatchChanges(s, 1, [], '4-3-3')
    expect(next.home.tacticName).toBe('4-3-3')
  })
})

describe('sideFor', () => {
  it('resolves home and away correctly', () => {
    const s = state()
    expect(sideFor(s, 1)).toBe('home')
    expect(sideFor(s, 2)).toBe('away')
  })
})

describe('parseMatchState', () => {
  it('parses a JSON string', () => {
    const s = state()
    const parsed = parseMatchState(JSON.stringify(s))
    expect(parsed?.minute).toBe(s.minute)
  })

  it('parses an already-object value', () => {
    const s = state()
    const parsed = parseMatchState(s)
    expect(parsed?.minute).toBe(s.minute)
  })

  it('returns null for an empty string', () => {
    expect(parseMatchState('')).toBeNull()
  })

  it('returns null for malformed JSON', () => {
    expect(parseMatchState('{not json')).toBeNull()
  })

  it('returns null when required fields are missing', () => {
    expect(parseMatchState({ minute: 5 })).toBeNull()
    expect(parseMatchState({ home: {}, away: {} })).toBeNull()
  })

  it('defaults missing drainRates/injured for a match saved before those fields existed', () => {
    const legacy = {
      minute: 10,
      home: { ...side({ teamId: 1 }), drainRates: undefined, injured: undefined },
      away: side({ teamId: 2 }),
    }
    const parsed = parseMatchState(legacy)
    expect(parsed?.home.drainRates).toEqual({})
    expect(parsed?.home.injured).toEqual([])
  })
})
