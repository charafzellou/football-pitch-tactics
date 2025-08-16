// This is a placeholder for the match simulation engine.
// A real implementation would be much more complex.

// Types for tactics and players
export interface Tactic {
  name: string
  formation: { GK: number; DF: number; MF: number; FW: number }
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
}

export interface MatchEvent {
  minute: number
  eventType: string
  teamId: number
  playerId?: number
}

function selectLineup(squad: Player[], tactic: Tactic): Player[] {
  // Selects 1 GK, N DF, N MF, N FW with highest skillLevel
  const positions = {
    GK: squad.filter(p => p.position === 'Goalkeeper').sort((a, b) => b.skillLevel - a.skillLevel),
    DF: squad.filter(p => p.position === 'Defender').sort((a, b) => b.skillLevel - a.skillLevel),
    MF: squad.filter(p => p.position === 'Midfielder').sort((a, b) => b.skillLevel - a.skillLevel),
    FW: squad.filter(p => p.position === 'Forward' || p.position === 'Attacker').sort((a, b) => b.skillLevel - a.skillLevel),
  }
  const lineup: Player[] = []
  lineup.push(...positions.GK.slice(0, tactic.formation.GK))
  lineup.push(...positions.DF.slice(0, tactic.formation.DF))
  lineup.push(...positions.MF.slice(0, tactic.formation.MF))
  lineup.push(...positions.FW.slice(0, tactic.formation.FW))
  return lineup
}

function calculateTeamStats(lineup: Player[], tactic: Tactic) {
  // Simple: average skill + tactic modifiers
  const avgSkill = lineup.reduce((acc, p) => acc + p.skillLevel, 0) / lineup.length
  return {
    attack: avgSkill + tactic.modifiers.attack,
    defence: avgSkill + tactic.modifiers.defence,
  }
}

export function simulateMatch(
  homeTeam: Team,
  awayTeam: Team
): { homeScore: number; awayScore: number; events: MatchEvent[]; homeLineup: Player[]; awayLineup: Player[] } {
  const homeLineup = selectLineup(homeTeam.squad, homeTeam.tactic)
  const awayLineup = selectLineup(awayTeam.squad, awayTeam.tactic)
  const homeStats = calculateTeamStats(homeLineup, homeTeam.tactic)
  const awayStats = calculateTeamStats(awayLineup, awayTeam.tactic)

  const events: MatchEvent[] = []
  let homeScore = 0
  let awayScore = 0

  for (let minute = 1; minute <= 90; minute++) {
    // Attack chance: attack stat + random, defence reduces chance
    const homeChance = homeStats.attack + Math.random() * 10 - awayStats.defence
    const awayChance = awayStats.attack + Math.random() * 10 - homeStats.defence

    // Generate shots and possible goals
    if (homeChance > 70 && Math.random() > 0.6) {
      // home had a shot
      const attackerPool = homeLineup.filter(p => ['Forward', 'Attacker', 'Forward'].includes(p.position) || p.position === 'Attacker')
      const shooter = attackerPool[Math.floor(Math.random() * Math.max(1, attackerPool.length))]
      // chance to score based on attack minus defence
      const scoreProb = Math.min(0.9, Math.max(0.05, (homeStats.attack - awayStats.defence) / 100 + Math.random() * 0.2))
      if (Math.random() < scoreProb) {
        homeScore++
        events.push({ minute, eventType: 'goal', teamId: homeTeam.id, playerId: shooter?.id })
      } else {
        events.push({ minute, eventType: 'shot', teamId: homeTeam.id, playerId: shooter?.id })
        // maybe a miss
        if (Math.random() > 0.8) events.push({ minute, eventType: 'miss', teamId: homeTeam.id, playerId: shooter?.id })
      }
    }

    if (awayChance > 70 && Math.random() > 0.6) {
      const attackerPool = awayLineup.filter(p => ['Forward', 'Attacker', 'Forward'].includes(p.position) || p.position === 'Attacker')
      const shooter = attackerPool[Math.floor(Math.random() * Math.max(1, attackerPool.length))]
      const scoreProb = Math.min(0.9, Math.max(0.05, (awayStats.attack - homeStats.defence) / 100 + Math.random() * 0.2))
      if (Math.random() < scoreProb) {
        awayScore++
        events.push({ minute, eventType: 'goal', teamId: awayTeam.id, playerId: shooter?.id })
      } else {
        events.push({ minute, eventType: 'shot', teamId: awayTeam.id, playerId: shooter?.id })
        if (Math.random() > 0.8) events.push({ minute, eventType: 'miss', teamId: awayTeam.id, playerId: shooter?.id })
      }
    }

    // Fouls / cards / injuries
    if (Math.random() > 0.995) {
      // red card rare
      const team = Math.random() > 0.5 ? homeTeam : awayTeam
      const lineup = team === homeTeam ? homeLineup : awayLineup
      const player = lineup[Math.floor(Math.random() * lineup.length)]
      events.push({ minute, eventType: 'red', teamId: team.id, playerId: player?.id })
    } else if (Math.random() > 0.98) {
      // yellow card
      const team = Math.random() > 0.5 ? homeTeam : awayTeam
      const lineup = team === homeTeam ? homeLineup : awayLineup
      const player = lineup[Math.floor(Math.random() * lineup.length)]
      events.push({ minute, eventType: 'yellow', teamId: team.id, playerId: player?.id })
    } else if (Math.random() > 0.997) {
      // injury
      const team = Math.random() > 0.5 ? homeTeam : awayTeam
      const lineup = team === homeTeam ? homeLineup : awayLineup
      const player = lineup[Math.floor(Math.random() * lineup.length)]
      events.push({ minute, eventType: 'injury', teamId: team.id, playerId: player?.id })
    } else if (Math.random() > 0.99) {
      // foul
      const team = Math.random() > 0.5 ? homeTeam : awayTeam
      const lineup = team === homeTeam ? homeLineup : awayLineup
      const player = lineup[Math.floor(Math.random() * lineup.length)]
      events.push({ minute, eventType: 'foul', teamId: team.id, playerId: player?.id })
    }
  }

  return {
    homeScore,
    awayScore,
    events,
    homeLineup,
    awayLineup,
  }
}
