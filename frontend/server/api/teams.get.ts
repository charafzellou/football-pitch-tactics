import { db } from '../db'
import { teams } from '../db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const leagueId = Number(query.leagueId)

  if (!leagueId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'League ID is required',
    })
  }

  return await db.select().from(teams).where(eq(teams.leagueId, leagueId))
})
