
import { db } from '../../../server/db'
import { matches, players, teams, matchEvents, eventType, game } from '../../../server/db/schema'
import { simulateMatch, Tactic } from '../../../server/core/match-engine'
import { eq, and, isNull } from 'drizzle-orm'

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
  played: 1,
    })
    .where(eq(matches.id, nextMatchToPlay.id))

  // Insert match events
  // Ensure event types exist and build a mapping from name -> id
  const existingTypes = await db.query.eventType.findMany()
  const typeMap: Record<string, number> = {}
  for (const t of existingTypes) {
    // @ts-ignore
    typeMap[String(t.name)] = t.id
  }

  // If result.events contains new types, insert them
  const uniqueTypes = Array.from(new Set(result.events.map((e: any) => String(e.eventType))))
  for (const typeName of uniqueTypes) {
    if (!typeMap[typeName]) {
      const inserted = await db.insert(eventType).values({ name: typeName }).returning()
      typeMap[typeName] = inserted[0].id
    }
  }

  for (const event of result.events) {
    const eventTypeId = typeof event.eventType === 'string' ? typeMap[String(event.eventType)] : event.eventType
    await db.insert(matchEvents).values({
      matchId: nextMatchToPlay.id,
      minute: event.minute,
      eventType: eventTypeId,
      playerId: event.playerId ?? null,
      teamId: typeof event.teamId === 'string' ? parseInt(event.teamId, 10) : event.teamId,
    })
  }
  // Advance game currentDate to after this match so schedule moves forward
  const gameState = await db.query.game.findFirst()
  if (gameState) {
    // matchDate may be a number, string, or Date; normalize to Date
    let matchDateObj = new Date(nextMatchToPlay.matchDate as any)
    if (isNaN(matchDateObj.getTime())) {
      // fallback: try numeric parse
      const n = Number(nextMatchToPlay.matchDate)
      if (!isNaN(n)) matchDateObj = new Date(n)
    }
    if (isNaN(matchDateObj.getTime())) {
      // final fallback to now
      matchDateObj = new Date()
    }
    const newCurrent = new Date(matchDateObj.getTime() + 1000)
    await db.update(game).set({ currentDate: newCurrent }).where(eq(game.id, gameState.id))
  }

  // Read back the updated match from DB and its events separately to avoid relational builder issues
  const updatedMatchRow = await db.query.matches.findFirst({ where: eq(matches.id, nextMatchToPlay.id) })
  const updatedMatchEvents = await db.query.matchEvents.findMany({ where: eq(matchEvents.matchId, nextMatchToPlay.id) })

  const updatedMatch = {
    ...updatedMatchRow,
    matchEvents: updatedMatchEvents,
  }

  // Debug log
  console.log('Simulate result saved, updatedMatch:', updatedMatch)

  return { updatedMatch, simulated: result }
})
