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

/**
 * Spread of the per-minute attacking roll, and the bar it has to clear.
 * Tuned for ~12 attempts and ~1 goal per team per match between even squads.
 */
const CHANCE_ROLL = 60
const CHANCE_THRESHOLD = 40

/**
 * Cap on a team's skill advantage. Both the number of attempts and the odds of
 * converting scale with it, so an uncapped gap multiplies into 13-0 scorelines.
 */
const MAX_EDGE = 12

/** Relative likelihood of taking a shot, by slot. Keepers never shoot. */
const SHOOTING_WEIGHTS: Record<LineupSlot, number> = { GK: 0, DF: 1, MF: 3, FW: 6 }

/** Relative likelihood of conceding a foul or being booked, by slot. */
const DISCIPLINE_WEIGHTS: Record<LineupSlot, number> = { GK: 1, DF: 4, MF: 4, FW: 2 }

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
 * Picks a random player, biased by slot. Every event that names a player goes
 * through here so an event can never end up without a `playerId`.
 */
function pickPlayer(candidates: Player[], weights: Record<LineupSlot, number>): Player | undefined {
  if (!candidates.length)
    return undefined

  const weightOf = (player: Player) => weights[normalizePosition(player.position) ?? 'MF'] ?? 1
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

  function attack(minute: number, side: MatchSide, opponent: MatchSide) {
    const shooter = pickPlayer(side.onPitch, SHOOTING_WEIGHTS)
    if (!shooter)
      return

    // chance to score based on attack minus defence
    const scoreProb = Math.min(0.9, Math.max(0.05, edgeOver(side, opponent) / 200 + Math.random() * 0.18))
    if (Math.random() < scoreProb) {
      side.score++
      events.push({ minute, eventType: 'goal', teamId: side.team.id, playerId: shooter.id })
    } else {
      events.push({ minute, eventType: 'shot', teamId: side.team.id, playerId: shooter.id })
      // maybe a miss
      if (Math.random() > 0.8) events.push({ minute, eventType: 'miss', teamId: side.team.id, playerId: shooter.id })
    }
  }

  /** Books a player. A second yellow becomes a red and the player goes off. */
  function book(minute: number, side: MatchSide, card: 'yellow' | 'red') {
    const player = pickPlayer(side.onPitch, DISCIPLINE_WEIGHTS)
    if (!player)
      return

    events.push({ minute, eventType: card, teamId: side.team.id, playerId: player.id })

    if (card === 'yellow' && !side.booked.has(player.id)) {
      side.booked.add(player.id)
      return
    }

    if (card === 'yellow')
      events.push({ minute, eventType: 'red', teamId: side.team.id, playerId: player.id })

    side.onPitch = side.onPitch.filter(p => p.id !== player.id)
  }

  function incident(minute: number, side: MatchSide, eventType: 'foul' | 'injury') {
    const player = pickPlayer(side.onPitch, DISCIPLINE_WEIGHTS)
    if (!player)
      return

    events.push({ minute, eventType, teamId: side.team.id, playerId: player.id })
  }

  for (let minute = 1; minute <= 90; minute++) {
    // Attack chance: skill advantage over the opponent plus a random roll.
    // The roll window is wide enough that the weaker side still creates chances.
    const homeChance = edgeOver(home, away) + Math.random() * CHANCE_ROLL
    const awayChance = edgeOver(away, home) + Math.random() * CHANCE_ROLL

    // Generate shots and possible goals
    if (homeChance > CHANCE_THRESHOLD && Math.random() > 0.6)
      attack(minute, home, away)

    if (awayChance > CHANCE_THRESHOLD && Math.random() > 0.6)
      attack(minute, away, home)

    // Fouls / cards / injuries
    const side = Math.random() > 0.5 ? home : away
    if (Math.random() > 0.995) {
      // red card rare
      book(minute, side, 'red')
    } else if (Math.random() > 0.98) {
      // yellow card
      book(minute, side, 'yellow')
    } else if (Math.random() > 0.997) {
      // injury
      incident(minute, side, 'injury')
    } else if (Math.random() > 0.99) {
      // foul
      incident(minute, side, 'foul')
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
