// This is a placeholder for the match simulation engine.
// A real implementation would be much more complex.

interface Team {
  id: number
  name: string
  skillLevel: number
}

interface MatchEvent {
  minute: number
  eventType: string
  teamId: number
}

export function simulateMatch(homeTeam: Team, awayTeam: Team) {
  const events: MatchEvent[] = []
  let homeScore = 0
  let awayScore = 0

  for (let minute = 1; minute <= 90; minute++) {
    const homeTeamChance = Math.random() * homeTeam.skillLevel
    const awayTeamChance = Math.random() * awayTeam.skillLevel

    if (homeTeamChance > 95) {
      homeScore++
      events.push({ minute, eventType: 'goal', teamId: homeTeam.id })
    }

    if (awayTeamChance > 95) {
      awayScore++
      events.push({ minute, eventType: 'goal', teamId: awayTeam.id })
    }
  }

  return {
    homeScore,
    awayScore,
    events,
  }
}
