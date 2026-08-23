import { and, eq, isNotNull } from 'drizzle-orm'
import { db } from '../../db'
import { matchEvents, matches, teams } from '../../db/schema'
import { kickOff } from '../../core/match-engine'
import { buildTeam, eventTypeNamesById } from '../../core/match-session'
import { requireActiveManager } from '../../core/save'
import { parseLineup } from '#shared/lineup'
import { parseMatchState } from '#shared/match-state'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ matchId?: number | string }>(event)
  const requestedMatchId = Number(body?.matchId)

  const gameState = await requireActiveManager(event)

  // Resuming a specific fixture only makes sense if it hasn't been played
  // yet. Falling back to "the next one" prefers a match already paused
  // mid-way over starting a fresh one out of order.
  const target = requestedMatchId
    ? await db.query.matches.findFirst({
        where: and(eq(matches.id, requestedMatchId), eq(matches.gameId, gameState.id), eq(matches.played, 0)),
      })
    : await db.query.matches.findFirst({
        where: and(isNotNull(matches.state), eq(matches.gameId, gameState.id), eq(matches.played, 0)),
      })
      ?? await db.query.matches.findFirst({
        where: and(eq(matches.gameId, gameState.id), eq(matches.played, 0)),
        orderBy: (matchesTable, { asc }) => [asc(matchesTable.matchDate)],
      })

  if (!target) {
    return { message: 'No matches to simulate' }
  }

  const existingState = parseMatchState(target.state)
  if (existingState) {
    const [rows, typeNames] = await Promise.all([
      db.query.matchEvents.findMany({
        where: eq(matchEvents.matchId, target.id),
        orderBy: (matchEventsTable, { asc }) => [asc(matchEventsTable.minute)],
      }),
      eventTypeNamesById(),
    ])

    const events = rows.map(row => ({
      minute: row.minute,
      eventType: typeNames[row.eventType] ?? String(row.eventType),
      teamId: row.teamId,
      playerId: row.playerId ?? undefined,
      relatedPlayerId: row.relatedPlayerId ?? undefined,
    }))

    return { matchId: target.id, state: existingState, events, resumed: true }
  }

  const [homeTeamRow, awayTeamRow] = await Promise.all([
    db.query.teams.findFirst({ where: eq(teams.id, target.homeTeamId) }),
    db.query.teams.findFirst({ where: eq(teams.id, target.awayTeamId) }),
  ])

  if (!homeTeamRow || !awayTeamRow) {
    throw createError({ statusCode: 404, statusMessage: 'Team not found for match' })
  }

  const [homeTeam, awayTeam] = await Promise.all([
    buildTeam(target.homeTeamId, homeTeamRow.tactics, gameState.playerTeamId, parseLineup(homeTeamRow.lineup)),
    buildTeam(target.awayTeamId, awayTeamRow.tactics, gameState.playerTeamId, parseLineup(awayTeamRow.lineup)),
  ])

  const state = kickOff(homeTeam, awayTeam)

  await db.update(matches).set({ state: JSON.stringify(state) }).where(eq(matches.id, target.id))

  return { matchId: target.id, state, events: [], resumed: false }
})
