
import { db } from '../../../server/db'
import { matches, players, teams, matchEvents } from '../../../server/db/schema'
import { simulateMatch, Tactic } from '../../../server/core/match-engine'
import { eq, and, isNull } from 'drizzle-orm'

type bodyEvent = {
  teamId: number,
  opponentId: number,
  tactic: Tactic,
  lineup: number[],
}

export default defineEventHandler(async (event) => {
  const nextMatchToPlay = await db.query.matches.findFirst({
    where: and(isNull(matches.homeScore)),
    orderBy: (matches, { asc }) => [asc(matches.matchDate)],
  })

  if (!nextMatchToPlay) {
    return { message: 'No matches to simulate' }
  }

  // Fetch squads
  const homeSquad = await db.query.players.findMany({ where: eq(players.teamId, nextMatchToPlay.homeTeamId) })
  const awaySquad = await db.query.players.findMany({ where: eq(players.teamId, nextMatchToPlay.awayTeamId) })

  // Fetch tactics
  const tacticsList: Tactic[] = await $fetch('/api/tactics')
  const homeTeamData = await db.query.teams.findFirst({ where: eq(teams.id, nextMatchToPlay.homeTeamId) })
  const awayTeamData = await db.query.teams.findFirst({ where: eq(teams.id, nextMatchToPlay.awayTeamId) })
  if (!homeTeamData || !awayTeamData) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Team not found for match',
    })
  }
  const homeTactic = tacticsList.find(t => t.name === homeTeamData.tactics) || tacticsList[0]
  const awayTactic = tacticsList.find(t => t.name === awayTeamData.tactics) || tacticsList[0]

  const result = simulateMatch(
    { id: homeTeamData.id, name: homeTeamData.name, squad: homeSquad, tactic: homeTactic },
    { id: awayTeamData.id, name: awayTeamData.name, squad: awaySquad, tactic: awayTactic },
  )

  await db
    .update(matches)
    .set({
      homeScore: result.homeScore,
      awayScore: result.awayScore,
    })
    .where(eq(matches.id, nextMatchToPlay.id))

  // Insert match events
  for (const event of result.events) {
    await db.insert(matchEvents).values({
      matchId: nextMatchToPlay.id,
      minute: event.minute,
      eventType: typeof event.eventType === 'string' ? parseInt(event.eventType, 10) : event.eventType,
      playerId: event.playerId ?? null,
      teamId: typeof event.teamId === 'string' ? parseInt(event.teamId, 10) : event.teamId,
    })
  }

  return { ...nextMatchToPlay, ...result }
})
