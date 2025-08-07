import { db } from '../../../server/db'

export default defineEventHandler(async () => {
  const gameState = await db.query.game.findFirst()
  return gameState
})
