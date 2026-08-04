// This is a placeholder for the match simulation engine.
// A real implementation would be much more complex.

import type { Formation, LineupSlot } from '#shared/lineup'
import { normalizePosition, resolveLineup } from '#shared/lineup'

// Types for tactics and players
export interface Tactic {
  name: string
  formation: Formation
  modifiers: { attack: number; defence: number }
}

export interface Player {
  id: number
  name: string
  age: number
  position: string
  skillLevel: number
  stamina: number
  marketValue: number
  teamId: number
}

export interface Team {
  id: number
  name: string
  squad: Player[]
  tactic: Tactic
  /** The XI saved for this team. Omitted for CPU clubs — one is auto-selected. */
  lineupIds?: number[] | null
}

export interface MatchEvent {
  minute: number
  eventType: string
  teamId: number
  playerId?: number
}

/** Who is on the pitch and what has happened to them, for one team. */
interface MatchSide {
  team: Team
  lineup: Player[]
  onPitch: Player[]
  booked: Set<number>
  stats: { attack: number; defence: number }
  score: number
}

const MATCH_MINUTES = 90

/**
 * Target average occurrences per match, both teams combined, calibrated to
 * real-world match data.
 *
 * These double as the per-minute probabilities: a type's chance of being drawn
 * in any given minute is `rate / MATCH_MINUTES`. The rates sum to ~63.5, well
 * under `MATCH_MINUTES`, so the leftover probability mass is the chance of a
 * quiet minute — which is what lets one draw per minute reproduce every target
 * average exactly while guaranteeing at most one event per minute.
 *
 * `shotAttempt` covers every shot (13.1); it then resolves into exactly one of
 * `goal` / `shot_on_target` / `shot` so a single attempt never emits more than
 * one event. See SHOT_OUTCOME below.
 */
const EVENT_RATES = {
  cross: 21.5,
  foul: 15.5,
  shotAttempt: 13.1,
  corner: 5.7,
  /**
   * Slightly above the 4.42 target: roughly 0.09 of these draws land on a
   * player already booked, which `book` turns into a sending-off rather than a
   * second yellow, so they leave the yellow tally.
   */
  yellow: 4.51,
  offside: 2.7,
  injury: 0.3,
  /**
   * Straight reds only. Those second bookable offences add ~0.09 on top,
   * landing total reds on the 0.25 target.
   */
  straightRed: 0.16,
} as const

type EventKind = keyof typeof EVENT_RATES

const EVENT_DRAW = Object.entries(EVENT_RATES) as [EventKind, number][]

/**
 * How a shot attempt resolves. Derived from the per-match targets:
 * goals 2.71 and shots on target 4.6, out of 13.1 total shots. Anything that
 * is neither a goal nor an on-target save is an off-target/blocked `shot`.
 */
const SHOT_OUTCOME = {
  /**
   * Naively 2.71 / 13.1, trimmed by the factor below. The side with the skill
   * edge both takes a larger share of the shots and converts more of them, and
   * those two effects correlate — leaving the base untrimmed measures ~4% over
   * the 2.71 target across a large sample.
   */
  goal: (2.71 / 13.1) * 0.964,
  /** On target but saved — on-target total minus the ones that went in. */
  saved: (4.6 - 2.71) / 13.1,
}

/**
 * Cap on a team's skill advantage. Both the share of chances created and the
 * odds of converting scale with it, so an uncapped gap multiplies into absurd
 * scorelines.
 */
const MAX_EDGE = 12

/**
 * A booked player's weight when picking who commits the next bookable offence.
 * Referees are markedly more lenient with a player on a yellow, and the player
 * themselves plays safer — without this, second yellows alone would overshoot
 * the 0.25 red cards per match target.
 */
const BOOKED_CARD_WEIGHT = 0.12

/** Relative likelihood of being the player involved, by position. */
const SHOOTING_WEIGHTS: Record<LineupSlot, number> = { GK: 0, DF: 1, MF: 3, FW: 6 }
const CROSSING_WEIGHTS: Record<LineupSlot, number> = { GK: 0, DF: 3, MF: 5, FW: 2 }
const CORNER_WEIGHTS: Record<LineupSlot, number> = { GK: 0, DF: 1, MF: 5, FW: 3 }
const OFFSIDE_WEIGHTS: Record<LineupSlot, number> = { GK: 0, DF: 1, MF: 2, FW: 7 }
const DISCIPLINE_WEIGHTS: Record<LineupSlot, number> = { GK: 1, DF: 4, MF: 4, FW: 2 }
const INJURY_WEIGHTS: Record<LineupSlot, number> = { GK: 1, DF: 3, MF: 3, FW: 3 }

function calculateTeamStats(lineup: Player[], tactic: Tactic) {
  // Simple: average skill + tactic modifiers
  if (!lineup.length)
    return { attack: 0, defence: 0 }

  const avgSkill = lineup.reduce((acc, p) => acc + p.skillLevel, 0) / lineup.length
  return {
    attack: avgSkill + tactic.modifiers.attack,
    defence: avgSkill + tactic.modifiers.defence,
  }
}

/**
 * Picks a random player, biased by position. Every event that names a player
 * goes through here so an event can never end up without a `playerId`.
 *
 * `booked`, when given, damps players already carrying a yellow card.
 */
function pickPlayer(
  candidates: Player[],
  weights: Record<LineupSlot, number>,
  booked?: Set<number>,
): Player | undefined {
  if (!candidates.length)
    return undefined

  const weightOf = (player: Player) => {
    const base = weights[normalizePosition(player.position) ?? 'MF'] ?? 1

    return booked?.has(player.id) ? base * BOOKED_CARD_WEIGHT : base
  }

  const total = candidates.reduce((acc, player) => acc + weightOf(player), 0)

  // Every candidate weighs nothing (e.g. only the keeper is left) — pick evenly.
  if (total <= 0)
    return candidates[Math.floor(Math.random() * candidates.length)]

  let ticket = Math.random() * total
  for (const player of candidates) {
    ticket -= weightOf(player)
    if (ticket <= 0)
      return player
  }

  return candidates[candidates.length - 1]
}

function createSide(team: Team): MatchSide {
  const { starters } = resolveLineup(team.squad, team.tactic.formation, team.lineupIds)

  return {
    team,
    lineup: starters,
    onPitch: [...starters],
    booked: new Set<number>(),
    stats: calculateTeamStats(starters, team.tactic),
    score: 0,
  }
}

export function simulateMatch(
  homeTeam: Team,
  awayTeam: Team
): { homeScore: number; awayScore: number; events: MatchEvent[]; homeLineup: Player[]; awayLineup: Player[] } {
  const home = createSide(homeTeam)
  const away = createSide(awayTeam)

  const events: MatchEvent[] = []

  /** How far a side's attack out-rates the opponent's defence, damped. */
  function edgeOver(side: MatchSide, opponent: MatchSide) {
    return Math.max(-MAX_EDGE, Math.min(MAX_EDGE, side.stats.attack - opponent.stats.defence))
  }

  // The better side sees more of the ball, so it takes a larger share of the
  // attacking events. Bounded to 25/75 by MAX_EDGE.
  const homeAttackShare = 0.5 + (edgeOver(home, away) - edgeOver(away, home)) / 96

  // The side under pressure does more of the fouling — damped by half, since
  // possession is only one of the reasons fouls happen.
  const homeFoulShare = 0.5 + (0.5 - homeAttackShare) * 0.5

  const attackingSide = () => (Math.random() < homeAttackShare ? home : away)
  const foulingSide = () => (Math.random() < homeFoulShare ? home : away)

  function record(minute: number, side: MatchSide, eventType: string, player: Player) {
    events.push({ minute, eventType, teamId: side.team.id, playerId: player.id })
  }

  /** One shot, resolving into exactly one of goal / on target / off target. */
  function shotAttempt(minute: number) {
    const side = attackingSide()
    const opponent = side === home ? away : home
    const shooter = pickPlayer(side.onPitch, SHOOTING_WEIGHTS)
    if (!shooter)
      return

    // A stronger attack converts more of what it creates.
    const goalProb = SHOT_OUTCOME.goal * (1 + edgeOver(side, opponent) / 40)
    const roll = Math.random()

    if (roll < goalProb) {
      side.score++
      record(minute, side, 'goal', shooter)
    }
    else if (roll < goalProb + SHOT_OUTCOME.saved) {
      record(minute, side, 'shot_on_target', shooter)
    }
    else {
      record(minute, side, 'shot', shooter)
    }
  }

  function attackingEvent(minute: number, eventType: string, weights: Record<LineupSlot, number>) {
    const side = attackingSide()
    const player = pickPlayer(side.onPitch, weights)
    if (player)
      record(minute, side, eventType, player)
  }

  function defensiveEvent(minute: number, eventType: string, weights: Record<LineupSlot, number>) {
    const side = foulingSide()
    const player = pickPlayer(side.onPitch, weights)
    if (player)
      record(minute, side, eventType, player)
  }

  /**
   * A bookable offence. If the player is already carrying a yellow this is a
   * second bookable offence, which is a sending-off — emitted as a single `red`
   * so the minute still holds exactly one event.
   */
  function book(minute: number) {
    const side = foulingSide()
    const player = pickPlayer(side.onPitch, DISCIPLINE_WEIGHTS, side.booked)
    if (!player)
      return

    if (side.booked.has(player.id)) {
      record(minute, side, 'red', player)
      side.onPitch = side.onPitch.filter(p => p.id !== player.id)
      return
    }

    side.booked.add(player.id)
    record(minute, side, 'yellow', player)
  }

  /** A straight red — violent conduct, denying a clear goalscoring chance. */
  function sendOff(minute: number) {
    const side = foulingSide()
    const player = pickPlayer(side.onPitch, DISCIPLINE_WEIGHTS)
    if (!player)
      return

    record(minute, side, 'red', player)
    side.onPitch = side.onPitch.filter(p => p.id !== player.id)
  }

  function emit(kind: EventKind, minute: number) {
    switch (kind) {
      case 'shotAttempt': return shotAttempt(minute)
      case 'cross': return attackingEvent(minute, 'cross', CROSSING_WEIGHTS)
      case 'corner': return attackingEvent(minute, 'corner', CORNER_WEIGHTS)
      case 'offside': return attackingEvent(minute, 'offside', OFFSIDE_WEIGHTS)
      case 'foul': return defensiveEvent(minute, 'foul', DISCIPLINE_WEIGHTS)
      case 'injury': return defensiveEvent(minute, 'injury', INJURY_WEIGHTS)
      case 'yellow': return book(minute)
      case 'straightRed': return sendOff(minute)
    }
  }

  for (let minute = 1; minute <= MATCH_MINUTES; minute++) {
    // A single categorical draw decides this minute: the first type whose rate
    // the ticket falls within wins, and a ticket past every rate means a quiet
    // minute. At most one event per minute, by construction.
    let ticket = Math.random() * MATCH_MINUTES

    for (const [kind, rate] of EVENT_DRAW) {
      ticket -= rate

      if (ticket < 0) {
        emit(kind, minute)
        break
      }
    }
  }

  return {
    homeScore: home.score,
    awayScore: away.score,
    events,
    homeLineup: home.lineup,
    awayLineup: away.lineup,
  }
}
