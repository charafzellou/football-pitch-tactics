import { db } from '../../../server/db'
import { matches } from '../../../server/db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const matchId = Number(event.context.params?.id)
  if (!matchId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Match ID is required',
    })
  }

  const match = await db.query.matches.findFirst({
    where: eq(matches.id, matchId),
    with: {
      matchEvents: true,
    },
  })

  return match
})
