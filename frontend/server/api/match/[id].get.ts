import { db } from '../../../server/db'
import { matches } from '../../../server/db/schema'
import { activeSave } from '../../../server/core/save'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const matchId = Number(event.context.params?.id)
  if (!matchId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Match ID is required',
    })
  }

  const gameState = await activeSave(event)
  if (!gameState) {
    throw createError({ statusCode: 404, statusMessage: 'Game not found' })
  }

  const match = await db.query.matches.findFirst({
    where: and(eq(matches.id, matchId), eq(matches.gameId, gameState.id)),
    with: {
      matchEvents: true,
    },
  })

  return match
})
