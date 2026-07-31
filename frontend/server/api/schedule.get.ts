import { db } from '../../server/db'
import { game, matches } from '../../server/db/schema'
import { or, eq, and, gte, isNull } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const gameState = await db.query.game.findFirst()
  if (!gameState) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Game not found',
    })
  }

  const query = getQuery(event)
  const includePlayed = String(query.includePlayed ?? 'false') === 'true'

  const teamFilter = or(
    eq(matches.homeTeamId, gameState.playerTeamId),
    eq(matches.awayTeamId, gameState.playerTeamId),
  )

  const schedule = await db.query.matches.findMany({
    where: includePlayed
      ? teamFilter
      : and(
          teamFilter,
          gte(matches.matchDate, gameState.currentDate),
          isNull(matches.homeScore),
          eq(matches.played, 0),
        ),
    orderBy: (matches, { asc }) => [asc(matches.matchDate)],
  })

  return schedule
})
