import { db } from '../../server/db'
import { game, matches } from '../../server/db/schema'
import { or, eq, and, gte } from 'drizzle-orm'

export default defineEventHandler(async () => {
  const gameState = await db.query.game.findFirst()
  if (!gameState) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Game not found',
    })
  }

  const schedule = await db.query.matches.findMany({
    where: and(
      or(
        eq(matches.homeTeamId, gameState.playerTeamId),
        eq(matches.awayTeamId, gameState.playerTeamId),
      ),
      gte(matches.matchDate, gameState.currentDate),
    ),
    orderBy: (matches, { asc }) => [asc(matches.matchDate)],
  })

  return schedule
})
