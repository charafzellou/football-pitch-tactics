import { db } from '../db'
import { leagues } from '../db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const countryId = Number(query.countryId)

  if (!countryId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Country ID is required',
    })
  }

  return await db.select().from(leagues).where(eq(leagues.countryId, countryId))
})
