import { db } from '../../../server/db'
import { game } from '../../../server/db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const gameState = await db.query.game.findFirst()

  if (!gameState) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Game not found',
    })
  }

  const newDate = new Date(gameState.currentDate)
  newDate.setDate(newDate.getDate() + 1)

  await db
    .update(game)
    .set({ currentDate: newDate })
    .where(eq(game.id, gameState.id))

  return { ...gameState, currentDate: newDate }
})
