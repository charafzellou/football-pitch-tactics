import { db } from '../../../server/db'
import { game } from '../../../server/db/schema'
import { requireActiveManager } from '../../../server/core/save'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const gameState = await requireActiveManager(event)

  const newDate = new Date(gameState.currentDate)
  newDate.setDate(newDate.getDate() + 1)

  await db
    .update(game)
    .set({ currentDate: newDate })
    .where(eq(game.id, gameState.id))

  return { ...gameState, currentDate: newDate }
})
