import { db } from '../../../server/db'
import { game } from '../../../server/db/schema'

export default defineEventHandler(async (event) => {
  const { teamId } = await readBody(event)

  if (!teamId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Team ID is required',
    })
  }

  await db.delete(game)

  const newGame = await db
    .insert(game)
    .values({
      playerTeamId: teamId,
      season: 1,
      currentDate: new Date(),
    })
    .returning()

  return newGame[0]
})
