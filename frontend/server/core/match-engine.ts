// This is a placeholder for the match simulation engine.
// A real implementation would be much more complex.

import type { Formation, LineupSlot } from '#shared/lineup'
import { LINEUP_SIZE, normalizePosition, resolveLineup } from '#shared/lineup'
import type { MatchEvent, MatchSideState, MatchState } from '#shared/match-state'
import {
  HALF_TIME_MINUTE,
  MAX_SUBSTITUTIONS,
  STAMINA_DRAIN_BY_SLOT,
  STAMINA_DRAIN_JITTER,
  advanceMinute,
  effectiveSkill,
} from '#shared/match-state'

export type { MatchEvent } from '#shared/match-state'
import { pitchInjuryScaleFor, pitchPenaltyFor } from './economy'

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
  /** Matches remaining out injured. Anything above 0 makes them unselectable. */
  injuredMatches?: number
}

export interface Team {
  id: number
  name: string
  squad: Player[]
  tactic: Tactic
  /** The XI saved for this team. Omitted for CPU clubs — one is auto-selected. */
  lineupIds?: number[] | null
  /** CPU-controlled clubs manage their own substitutions during the match. */
  autoManaged?: boolean
  /**
   * Pitch quality 0–100 at this club's ground.
   *
   * Only ever applied to the **home** side, in `simulateSegment`. It is their
   * ground and their decision: a club that sold three concert dates took the
   * money, so it takes the goalmouth too. The visitors are simply playing on
   * what they are given.
   */
  pitchCondition?: number
}

const MATCH_MINUTES = 90

/**
 * Real-world average occurrences per match, both teams combined — sourced from
 * published match studies. Summing these directly (~63.5) puts an event in
 * ~70% of the 90 minutes, which reads as constant rather than as football: a
 * live text feed isn't the same medium as a full statistical match report, so
 * matching the literal per-90 count is the wrong target for it.
 *
 * `EVENT_RATES` below scales every one of these down by the same factor
 * (`EVENT_FREQUENCY_SCALE`) rather than trimming individual types, so goals
 * stay exactly as likely relative to shots, cards relative to fouls, etc. —
 * only the overall pace changes.
 *
 * `shotAttempt` covers every shot (13.1); it then resolves into exactly one of
 * `goal` / `shot_on_target` / `shot` so a single attempt never emits more than
 * one event. See SHOT_OUTCOME below — its proportions are shares of
 * `shotAttempt` itself, so they're unaffected by the scale factor.
 */
const REAL_WORLD_EVENT_RATES = {
  cross: 19.5,
  foul: 13.5,
  shotAttempt: 11.1,
  corner: 4.7,
  /**
   * Slightly above the 4.42 target: roughly 0.09 of these draws land on a
   * player already booked, which `book` turns into a sending-off rather than a
   * second yellow, so they leave the yellow tally.
   */
  yellow: 3.51,
  offside: 1.7,
  injury: 0.3,
  /**
   * Straight reds only. At full frequency, second bookable offences (see
   * `book`) add ~0.09 on top, landing total reds on the 0.25 target. That
   * carryover shrinks faster than linearly as EVENT_FREQUENCY_SCALE comes
   * down — fewer yellow draws means fewer already-booked players to draw a
   * second time — so this is above the naive 0.16 to compensate.
   */
  straightRed: 0.2,
} as const

/**
 * Brings the ~64 real-world total down to ~45 events per match (midpoint of
 * a 35–55 target), so the feed reads as sporadic rather than nonstop. Tune
 * this single constant to redial the overall pace without touching the mix.
 */
const EVENT_FREQUENCY_SCALE = 45 / 64

type EventKind = keyof typeof REAL_WORLD_EVENT_RATES

const EVENT_RATES = Object.fromEntries(
  (Object.entries(REAL_WORLD_EVENT_RATES) as [EventKind, number][])
    .map(([kind, rate]) => [kind, rate * EVENT_FREQUENCY_SCALE]),
) as Record<EventKind, number>

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

/**
 * Minutes at which a CPU-managed side reviews its bench. Mirrors the moments
 * a human manager is naturally prompted to think about changes: the
 * half-time break, then a couple of common real-world substitution windows.
 */
const AI_REVIEW_MINUTES = [HALF_TIME_MINUTE, 60, 70, 80]

/** Minimum effective-skill gain required for the CPU to make a swap. */
const AI_UPGRADE_MARGIN = 2

/**
 * Divides by a nominal eleven rather than by however many are actually on
 * the pitch. With a true average, losing a below-average player *raises*
 * the side's rating — so a red card or an unreplaced injury could make a
 * team stronger. Against a fixed eleven, every missing player costs the
 * side roughly a eleventh of its rating (~7-8 points, against MAX_EDGE 12),
 * which is what being a man down should feel like. A full XI is unchanged.
 */
function calculateTeamStats(
  onPitch: Player[],
  stamina: Record<number, number>,
  tactic: Tactic,
  pitchPenalty = 0,
) {
  if (!onPitch.length)
    return { attack: 0, defence: 0 }

  const avgSkill = onPitch.reduce((acc, p) => acc + effectiveSkill(p.skillLevel, stamina[p.id] ?? 100), 0) / LINEUP_SIZE
  return {
    attack: avgSkill + tactic.modifiers.attack - pitchPenalty,
    defence: avgSkill + tactic.modifiers.defence - pitchPenalty,
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

function squadMapFor(team: Team): Map<number, Player> {
  return new Map(team.squad.map(player => [player.id, player]))
}

function createSideState(team: Team): MatchSideState {
  const { starters, bench } = resolveLineup(team.squad, team.tactic.formation, team.lineupIds)
  const stamina: Record<number, number> = {}
  const drainRates: Record<number, number> = {}

  for (const player of team.squad) {
    // `players.stamina` already holds the post-recovery value written at the
    // end of the previous match, so it's used as-is.
    stamina[player.id] = player.stamina

    // Rolled once, here, rather than per minute — see the note on
    // `MatchSideState.drainRates`. This is the only randomness in the
    // stamina model, and it's the reason `advanceMinute` stays replayable.
    const slot = normalizePosition(player.position) ?? 'MF'
    const jitter = 1 + (Math.random() * 2 - 1) * STAMINA_DRAIN_JITTER
    drainRates[player.id] = STAMINA_DRAIN_BY_SLOT[slot] * jitter
  }

  return {
    teamId: team.id,
    tacticName: team.tactic.name,
    startingXi: starters.map(p => p.id),
    onPitch: starters.map(p => p.id),
    // A player carrying an injury is never offered as a substitute.
    bench: bench.filter(p => !(p.injuredMatches ?? 0)).map(p => p.id),
    usedPlayers: [],
    booked: [],
    sentOff: [],
    subsUsed: 0,
    stamina,
    drainRates,
    injured: [],
    score: 0,
  }
}

/** Kicks off a fresh match: resolves both XIs and seeds match state at minute 0. */
export function kickOff(homeTeam: Team, awayTeam: Team): MatchState {
  return {
    minute: 0,
    home: createSideState(homeTeam),
    away: createSideState(awayTeam),
  }
}

/**
 * Simulates from `state.minute + 1` up to and including `toMinute`, honouring
 * whatever substitutions/formation already happened before this call (baked
 * into `state` and `homeTeam.tactic` / `awayTeam.tactic`). Stats are
 * recomputed every minute from the current pitch and stamina, so a
 * substitution or a tired legs takes effect immediately.
 */
export function simulateSegment(
  homeTeam: Team,
  awayTeam: Team,
  state: MatchState,
  toMinute: number,
): { state: MatchState; events: MatchEvent[] } {
  const homeSquad = squadMapFor(homeTeam)
  const awaySquad = squadMapFor(awayTeam)
  const events: MatchEvent[] = []

  /**
   * A worn pitch costs the home side rating, and costs everybody ankles.
   *
   * The rating penalty is the home club's alone — it is their ground, their
   * decision to hire it out, and their money from doing so. The injury uplift is
   * not: a cut-up goalmouth does not know who booked the concert, and both sides
   * spend ninety minutes on it.
   */
  const pitchCondition = homeTeam.pitchCondition ?? 100
  const homePitchPenalty = pitchPenaltyFor(pitchCondition)
  const pitchInjuryScale = pitchInjuryScaleFor(pitchCondition)

  let current = state

  const onPitchPlayers = (side: MatchSideState, squad: Map<number, Player>) =>
    side.onPitch.map(id => squad.get(id)).filter((p): p is Player => Boolean(p))

  for (let minute = current.minute + 1; minute <= toMinute; minute++) {
    const minuteEvents: MatchEvent[] = []

    // CPU-managed sides review their bench at fixed minutes — and react to
    // an injury the moment it happens, rather than leaving themselves a man
    // down until the next scheduled review.
    for (const [team, squad, other] of [
      [homeTeam, homeSquad, 'home'],
      [awayTeam, awaySquad, 'away'],
    ] as [Team, Map<number, Player>, 'home' | 'away'][]) {
      if (!team.autoManaged)
        continue

      const side = current[other]
      const unreplacedInjury = side.injured.find(id => !side.usedPlayers.includes(id))
      const autoSub = unreplacedInjury !== undefined
        ? pickInjuryReplacement(side, squad, unreplacedInjury)
        : AI_REVIEW_MINUTES.includes(minute) ? pickAutoSub(side, squad) : null

      if (autoSub)
        minuteEvents.push({ minute, eventType: 'substitution', teamId: side.teamId, playerId: autoSub.playerInId, relatedPlayerId: autoSub.playerOutId })
    }

    // Fold any AI substitutions in directly (not via advanceMinute, which
    // would also drain stamina for `minute` a second time below) so the
    // swap affects the stats computed for this same minute.
    let working = current
    for (const event of minuteEvents) {
      const sideKey = event.teamId === working.home.teamId ? 'home' : 'away'
      working = { ...working, [sideKey]: foldSubstitution(working[sideKey], event) }
    }

    const homeOnPitch = onPitchPlayers(working.home, homeSquad)
    const awayOnPitch = onPitchPlayers(working.away, awaySquad)
    const homeStats = calculateTeamStats(homeOnPitch, working.home.stamina, homeTeam.tactic, homePitchPenalty)
    const awayStats = calculateTeamStats(awayOnPitch, working.away.stamina, awayTeam.tactic)

    /** How far a side's attack out-rates the opponent's defence, damped. */
    const edgeOver = (attack: number, defence: number) =>
      Math.max(-MAX_EDGE, Math.min(MAX_EDGE, attack - defence))

    const homeEdge = edgeOver(homeStats.attack, awayStats.defence)
    const awayEdge = edgeOver(awayStats.attack, homeStats.defence)

    // The better side sees more of the ball, so it takes a larger share of
    // the attacking events. Bounded to 25/75 by MAX_EDGE.
    const homeAttackShare = 0.5 + (homeEdge - awayEdge) / 96
    // The side under pressure does more of the fouling — damped by half,
    // since possession is only one of the reasons fouls happen.
    const homeFoulShare = 0.5 + (0.5 - homeAttackShare) * 0.5

    const isHome = Math.random() < homeAttackShare
    const foulIsHome = Math.random() < homeFoulShare

    const attackSide = isHome ? working.home : working.away
    const attackOnPitch = isHome ? homeOnPitch : awayOnPitch
    const attackEdge = isHome ? homeEdge : awayEdge

    const foulSide = foulIsHome ? working.home : working.away
    const foulOnPitch = foulIsHome ? homeOnPitch : awayOnPitch
    const foulBooked = new Set(foulSide.booked)

    function record(eventType: string, player: Player, side: MatchSideState) {
      minuteEvents.push({ minute, eventType, teamId: side.teamId, playerId: player.id })
    }

    switch (drawKind(pitchInjuryScale)) {
      case 'shotAttempt': {
        const shooter = pickPlayer(attackOnPitch, SHOOTING_WEIGHTS)
        if (shooter) {
          const goalProb = SHOT_OUTCOME.goal * (1 + attackEdge / 40)
          const roll = Math.random()
          if (roll < goalProb)
            record('goal', shooter, attackSide)
          else if (roll < goalProb + SHOT_OUTCOME.saved)
            record('shot_on_target', shooter, attackSide)
          else
            record('shot', shooter, attackSide)
        }
        break
      }
      case 'cross': {
        const player = pickPlayer(attackOnPitch, CROSSING_WEIGHTS)
        if (player) record('cross', player, attackSide)
        break
      }
      case 'corner': {
        const player = pickPlayer(attackOnPitch, CORNER_WEIGHTS)
        if (player) record('corner', player, attackSide)
        break
      }
      case 'offside': {
        const player = pickPlayer(attackOnPitch, OFFSIDE_WEIGHTS)
        if (player) record('offside', player, attackSide)
        break
      }
      case 'foul': {
        const player = pickPlayer(foulOnPitch, DISCIPLINE_WEIGHTS)
        if (player) record('foul', player, foulSide)
        break
      }
      case 'injury': {
        const player = pickPlayer(foulOnPitch, INJURY_WEIGHTS)
        if (player) record('injury', player, foulSide)
        break
      }
      case 'yellow': {
        const player = pickPlayer(foulOnPitch, DISCIPLINE_WEIGHTS, foulBooked)
        if (player) {
          if (foulBooked.has(player.id))
            record('red', player, foulSide)
          else
            record('yellow', player, foulSide)
        }
        break
      }
      case 'straightRed': {
        const player = pickPlayer(foulOnPitch, DISCIPLINE_WEIGHTS)
        if (player) record('red', player, foulSide)
        break
      }
      case null:
        break
    }

    current = advanceMinute(working, minute, minuteEvents)
    events.push(...minuteEvents)
  }

  return { state: current, events }
}

/**
 * A single categorical draw: the first type whose rate the ticket falls within
 * wins.
 *
 * `injuryScale` inflates the injury bucket alone. The extra probability comes
 * out of the empty remainder of the ticket — the minutes in which nothing
 * happens — so no other event type becomes less likely and none of the
 * calibration above is disturbed. At the worst pitch this moves the injury rate
 * from 0.21 to 0.29 a match against a total of ~45 events, which is why it is
 * safe to do here rather than by rebuilding the draw table.
 */
function drawKind(injuryScale = 1): EventKind | null {
  let ticket = Math.random() * MATCH_MINUTES

  for (const [kind, rate] of EVENT_DRAW) {
    ticket -= kind === 'injury' ? rate * injuryScale : rate
    if (ticket < 0)
      return kind
  }

  return null
}

/** Applies a substitution event directly to a side, without draining stamina again. */
function foldSubstitution(side: MatchSideState, event: MatchEvent): MatchSideState {
  if (!event.playerId || !event.relatedPlayerId)
    return side

  return {
    ...side,
    onPitch: [...side.onPitch.filter(id => id !== event.relatedPlayerId), event.playerId],
    bench: side.bench.filter(id => id !== event.playerId),
    usedPlayers: [...side.usedPlayers, event.relatedPlayerId],
    subsUsed: side.subsUsed + 1,
  }
}

/** Picks a CPU substitution — weakest outfielder off, best same-slot bench player on — if it's a clear upgrade. */
function pickAutoSub(side: MatchSideState, squad: Map<number, Player>): { playerOutId: number; playerInId: number } | null {
  if (side.subsUsed >= MAX_SUBSTITUTIONS)
    return null

  const onPitch = side.onPitch.map(id => squad.get(id)).filter((p): p is Player => Boolean(p))
  const bench = side.bench.map(id => squad.get(id)).filter((p): p is Player => Boolean(p))
  if (!bench.length)
    return null

  const outfield = onPitch.filter(p => normalizePosition(p.position) !== 'GK')
  if (!outfield.length)
    return null

  const weakest = outfield.reduce((worst, p) =>
    effectiveSkill(p.skillLevel, side.stamina[p.id] ?? 100) < effectiveSkill(worst.skillLevel, side.stamina[worst.id] ?? 100) ? p : worst)

  const weakestSlot = normalizePosition(weakest.position)
  const candidates = bench.filter(p => normalizePosition(p.position) === weakestSlot)
  if (!candidates.length)
    return null

  const best = candidates.reduce((top, p) =>
    effectiveSkill(p.skillLevel, side.stamina[p.id] ?? 100) > effectiveSkill(top.skillLevel, side.stamina[top.id] ?? 100) ? p : top)

  const gain = effectiveSkill(best.skillLevel, side.stamina[best.id] ?? 100) - effectiveSkill(weakest.skillLevel, side.stamina[weakest.id] ?? 100)
  if (gain < AI_UPGRADE_MARGIN)
    return null

  return { playerOutId: weakest.id, playerInId: best.id }
}

/**
 * Replaces an injured CPU player. Unlike `pickAutoSub` there's no upgrade
 * margin to clear — the side is already a man down, so any available body
 * beats playing short. Prefers the same position, then falls back to the
 * best outfielder left on the bench.
 */
function pickInjuryReplacement(
  side: MatchSideState,
  squad: Map<number, Player>,
  injuredId: number,
): { playerOutId: number; playerInId: number } | null {
  if (side.subsUsed >= MAX_SUBSTITUTIONS)
    return null

  const bench = side.bench.map(id => squad.get(id)).filter((p): p is Player => Boolean(p))
  if (!bench.length)
    return null

  const injuredSlot = normalizePosition(squad.get(injuredId)?.position ?? '')
  const sameSlot = bench.filter(p => normalizePosition(p.position) === injuredSlot)
  const pool = sameSlot.length ? sameSlot : bench

  const best = pool.reduce((top, p) =>
    effectiveSkill(p.skillLevel, side.stamina[p.id] ?? 100) > effectiveSkill(top.skillLevel, side.stamina[top.id] ?? 100) ? p : top)

  return { playerOutId: injuredId, playerInId: best.id }
}
