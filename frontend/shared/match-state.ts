/**
 * Shared match-state rules.
 *
 * Lives in `shared/` for the same reason `shared/lineup.ts` does: the match
 * engine (server) and the Matchday UI (client) must fold a stream of match
 * events into a state snapshot in *exactly* the same way. The engine calls
 * `advanceMinute` inside its own per-minute loop; the client calls
 * `applyEvents` to derive what the pitch/bench panels show at the minute the
 * clock has reached; the API calls `applyEvents` again to rewind a match to
 * the minute a pause happened. One implementation, so none of the three can
 * ever disagree about who is on the pitch.
 */

export const MATCH_MINUTES = 90
export const HALF_TIME_MINUTE = 45
export const MAX_SUBSTITUTIONS = 5

/**
 * Stamina drains while a player is on the pitch and recovers a little over
 * the half-time interval. `FATIGUE_FLOOR` bounds how much a fully-drained
 * player is worth relative to fresh: at 0 stamina they still play at 80% of
 * their skill, not 0 — fatigue should make the bench worth using, not turn
 * tired legs into a broken player.
 *
 * The base rate is deliberately gentle. A single match should barely
 * register (a full 90 costs a midfielder ~22, worth about 2.5% of their
 * skill once the +10 between matches is added back); it's naming the *same*
 * eleven week after week that grinds a squad down.
 */
export const STAMINA_DRAIN_PER_MINUTE = 0.25
export const HALF_TIME_RECOVERY = 2
export const FATIGUE_FLOOR = 0.8

/**
 * How hard each position works. A goalkeeper covers a fraction of the ground
 * a midfielder does and is effectively never the reason you need a
 * substitution; defenders sit in between.
 */
export const STAMINA_DRAIN_BY_SLOT: Record<'GK' | 'DF' | 'MF' | 'FW', number> = {
  GK: 0.2,
  DF: 0.75,
  MF: 1,
  FW: 1,
}

/** Per-player variation around their position's rate, ± this fraction. */
export const STAMINA_DRAIN_JITTER = 0.15

/**
 * Flat stamina every player regains before the next match, capped at 100 —
 * including those who didn't play, and those sitting out injured.
 *
 * Flat rather than a fraction of the deficit, deliberately: a proportional
 * recovery hands most of a hard match straight back, so repeatedly fielding
 * the same XI never compounds. At +10 against a ~22 drain, an ever-present
 * midfielder reaches 0 after about eight matches and stays pinned there
 * (playing at `FATIGUE_FLOOR`) until they're rested — which is the whole
 * point. This is the single dial for how hard rotation is forced.
 */
export const STAMINA_RECOVERY_PER_MATCH = 10

/** Matches a player sits out after picking up an injury. */
export const INJURY_MATCHES_MIN = 2
export const INJURY_MATCHES_MAX = 4

/** A player's skill for match purposes, damped by how tired they are. */
export function effectiveSkill(skillLevel: number, stamina: number): number {
  const clamped = Math.max(0, Math.min(100, stamina))
  return skillLevel * (FATIGUE_FLOOR + (1 - FATIGUE_FLOOR) * (clamped / 100))
}

/** Stamina a player carries into the next match, applied at full time. */
export function recoveredStamina(endOfMatchStamina: number): number {
  const clamped = Math.max(0, Math.min(100, endOfMatchStamina))
  return Math.min(100, clamped + STAMINA_RECOVERY_PER_MATCH)
}

export interface MatchEvent {
  minute: number
  eventType: string
  teamId: number
  playerId?: number
  /** The player going off, for `substitution` events. `playerId` is the one coming on. */
  relatedPlayerId?: number
}

/** Who is on the pitch and what has happened to them, for one team. */
export interface MatchSideState {
  teamId: number
  tacticName: string
  /** Fixed at kickoff — never changes over the match. */
  startingXi: number[]
  onPitch: number[]
  /** Still available to come on. */
  bench: number[]
  /** Subbed off — cannot return to the pitch. */
  usedPlayers: number[]
  booked: number[]
  sentOff: number[]
  subsUsed: number
  /** Player id → stamina, 0-100. Covers every squad member, not just onPitch. */
  stamina: Record<number, number>
  /**
   * Player id → stamina drain multiplier (position factor × a per-player
   * jitter), fixed for the whole match.
   *
   * This lives in state rather than being rolled inside `drainSide` for one
   * reason: `applyEvents` has to reproduce the engine's state exactly, on
   * the client and on rewind. A `Math.random()` in the per-minute drain
   * would diverge on every single minute. The roll happens once, in
   * `kickOff` (server-side only), and everything downstream stays a pure
   * function of state.
   */
  drainRates: Record<number, number>
  /** Injured this match — off the pitch, cannot return, cannot be replaced twice. */
  injured: number[]
  score: number
}

export interface MatchState {
  /** The minute this state reflects. Events at or before this minute are already folded in. */
  minute: number
  home: MatchSideState
  away: MatchSideState
}

function sideFor(state: MatchState, teamId: number): 'home' | 'away' {
  return state.home.teamId === teamId ? 'home' : 'away'
}

function withoutId(ids: number[], id: number): number[] {
  return ids.filter(existing => existing !== id)
}

/** Drains stamina for everyone currently on the pitch by one minute. */
function drainSide(side: MatchSideState): MatchSideState {
  const stamina = { ...side.stamina }
  for (const playerId of side.onPitch) {
    const rate = side.drainRates?.[playerId] ?? 1
    stamina[playerId] = Math.max(0, (stamina[playerId] ?? 100) - STAMINA_DRAIN_PER_MINUTE * rate)
  }

  return { ...side, stamina }
}

/**
 * Small recovery bump for the whole squad, applied once crossing 45 → 46.
 * Injured players are skipped — the interval doesn't undo a knock, and
 * letting it lift them off 0 would quietly un-injure them.
 */
function recoverSide(side: MatchSideState): MatchSideState {
  const stamina: Record<number, number> = {}
  for (const [id, value] of Object.entries(side.stamina)) {
    const playerId = Number(id)
    stamina[playerId] = side.injured.includes(playerId)
      ? value
      : Math.min(100, value + HALF_TIME_RECOVERY)
  }

  return { ...side, stamina }
}

/** Folds one event into the side it belongs to. */
function foldEvent(side: MatchSideState, event: MatchEvent): MatchSideState {
  switch (event.eventType) {
    case 'goal':
      return { ...side, score: side.score + 1 }

    case 'yellow':
      return event.playerId
        ? { ...side, booked: [...side.booked, event.playerId] }
        : side

    case 'red':
      return event.playerId
        ? {
            ...side,
            sentOff: [...side.sentOff, event.playerId],
            onPitch: withoutId(side.onPitch, event.playerId),
          }
        : side

    /**
     * An injury takes the player off immediately. Their side plays short
     * until the manager spends a substitution — see `calculateTeamStats`,
     * which divides by a nominal eleven, so being a man down genuinely
     * costs the team.
     */
    case 'injury':
      return event.playerId
        ? {
            ...side,
            injured: [...side.injured, event.playerId],
            onPitch: withoutId(side.onPitch, event.playerId),
            stamina: { ...side.stamina, [event.playerId]: 0 },
          }
        : side

    case 'substitution': {
      if (!event.playerId || !event.relatedPlayerId)
        return side

      // `withoutId` on onPitch is a no-op when replacing an injured player —
      // they were already taken off when the injury was folded in.
      return {
        ...side,
        onPitch: [...withoutId(side.onPitch, event.relatedPlayerId), event.playerId],
        bench: withoutId(side.bench, event.playerId),
        usedPlayers: [...side.usedPlayers, event.relatedPlayerId],
        subsUsed: side.subsUsed + 1,
      }
    }

    default:
      return side
  }
}

/**
 * The single state transition: advances `state` by exactly one minute,
 * folding in whatever events occurred during it. `minute` must be
 * `state.minute + 1`.
 */
export function advanceMinute(state: MatchState, minute: number, eventsThisMinute: MatchEvent[]): MatchState {
  let home = drainSide(state.home)
  let away = drainSide(state.away)

  // Crossing into the second half recovers a little of what was spent.
  if (state.minute < HALF_TIME_MINUTE && minute > HALF_TIME_MINUTE) {
    home = recoverSide(home)
    away = recoverSide(away)
  }

  for (const event of eventsThisMinute) {
    if (event.teamId === home.teamId)
      home = foldEvent(home, event)
    else if (event.teamId === away.teamId)
      away = foldEvent(away, event)
  }

  return { minute, home, away }
}

/**
 * Rolls `state` forward to `toMinute` by replaying `events`. Events at or
 * before `state.minute` are ignored — already-applied history is never
 * folded twice. Used to derive UI state at the visible clock minute, and to
 * rewind a match on the server when a pause lands mid-segment.
 */
export function applyEvents(state: MatchState, events: MatchEvent[], toMinute: number): MatchState {
  if (toMinute <= state.minute)
    return state

  const byMinute = new Map<number, MatchEvent[]>()
  for (const event of events) {
    if (event.minute <= state.minute || event.minute > toMinute)
      continue

    const bucket = byMinute.get(event.minute)
    if (bucket)
      bucket.push(event)
    else
      byMinute.set(event.minute, [event])
  }

  let current = state
  for (let minute = state.minute + 1; minute <= toMinute; minute++)
    current = advanceMinute(current, minute, byMinute.get(minute) ?? [])

  return current
}

/** `45` before half-time, otherwise full time. */
export function nextBreakAfter(minute: number): number {
  return minute < HALF_TIME_MINUTE ? HALF_TIME_MINUTE : MATCH_MINUTES
}

export interface SubstitutionRequest {
  playerOutId: number
  playerInId: number
}

/**
 * Validates a proposed swap against the current state of the side making it.
 * Returns a human-readable reason it's blocked, or `null` if it's legal.
 */
export function substitutionError(side: MatchSideState, request: SubstitutionRequest): string | null {
  if (side.subsUsed >= MAX_SUBSTITUTIONS)
    return 'No substitutions remaining'

  if (request.playerOutId === request.playerInId)
    return 'Cannot substitute a player for themselves'

  // An injured player is already off the pitch, but replacing them is
  // exactly what the injury pause asks the manager to do — so they're a
  // legal outgoing player right up until someone has come on for them.
  const isInjuredReplacement = side.injured.includes(request.playerOutId)
    && !side.usedPlayers.includes(request.playerOutId)

  if (!isInjuredReplacement && !side.onPitch.includes(request.playerOutId))
    return 'That player is not on the pitch'

  if (side.sentOff.includes(request.playerOutId))
    return 'A sent-off player cannot be replaced'

  if (!side.bench.includes(request.playerInId))
    return 'That player is not available on the bench'

  if (side.usedPlayers.includes(request.playerInId))
    return 'That player has already been substituted'

  if (side.injured.includes(request.playerInId))
    return 'That player is injured'

  return null
}

/**
 * Applies a manager's pause-time decisions — substitutions and/or a
 * formation change — to one side of `state`. Unlike `advanceMinute`, this
 * does not advance the clock or drain stamina: it's administrative, not
 * gameplay. Throws if a substitution fails `substitutionError` — callers
 * should validate with that first to turn it into a 400 instead.
 */
export function applyMidMatchChanges(
  state: MatchState,
  teamId: number,
  substitutions: SubstitutionRequest[],
  tacticName?: string,
): MatchState {
  const key = sideFor(state, teamId)
  let side = state[key]

  for (const request of substitutions) {
    const error = substitutionError(side, request)
    if (error)
      throw new Error(error)

    side = foldEvent(side, {
      minute: state.minute,
      eventType: 'substitution',
      teamId: side.teamId,
      playerId: request.playerInId,
      relatedPlayerId: request.playerOutId,
    })
  }

  if (tacticName)
    side = { ...side, tacticName }

  return { ...state, [key]: side }
}

/** Reads a match state persisted as JSON. Tolerates a malformed column. */
export function parseMatchState(raw: unknown): MatchState | null {
  let value = raw

  if (typeof value === 'string') {
    if (!value.trim())
      return null

    try {
      value = JSON.parse(value)
    }
    catch {
      return null
    }
  }

  if (!value || typeof value !== 'object')
    return null

  const state = value as Partial<MatchState>
  if (typeof state.minute !== 'number' || !state.home || !state.away)
    return null

  // A match already in flight when `drainRates`/`injured` were introduced
  // has neither field. Default them rather than throwing away the match:
  // a missing drain rate reads as 1 (the old uniform behaviour).
  return {
    minute: state.minute,
    home: withStateDefaults(state.home),
    away: withStateDefaults(state.away),
  }
}

function withStateDefaults(side: MatchSideState): MatchSideState {
  return { ...side, drainRates: side.drainRates ?? {}, injured: side.injured ?? [] }
}

export { sideFor }
