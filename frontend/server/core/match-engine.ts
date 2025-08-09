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

  for (let minute = 1; minute <= 90; minute += 5) {
    // Attack chance: attack stat + random, defence reduces chance
    const homeChance = homeStats.attack + Math.random() * 10 - awayStats.defence
    const awayChance = awayStats.attack + Math.random() * 10 - homeStats.defence

    if (homeChance > 80 && Math.random() > 0.7) {
      homeScore++
      // Pick random attacker
      const scorer = homeLineup.filter(p => p.position === 'Forward' || p.position === 'Attacker')[Math.floor(Math.random() * homeTeam.tactic.formation.FW)]
      events.push({ minute, eventType: 'goal', teamId: homeTeam.id, playerId: scorer?.id })
    }
    if (awayChance > 80 && Math.random() > 0.7) {
      awayScore++
      const scorer = awayLineup.filter(p => p.position === 'Forward' || p.position === 'Attacker')[Math.floor(Math.random() * awayTeam.tactic.formation.FW)]
      events.push({ minute, eventType: 'goal', teamId: awayTeam.id, playerId: scorer?.id })
    }
    // Add more event types (yellow/red cards, etc.) as needed
  }

  return {
    homeScore,
    awayScore,
    events,
    homeLineup,
    awayLineup,
  }
}
