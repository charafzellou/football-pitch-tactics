import { db } from '../../../server/db'
import { players } from '../../../server/db/schema'
import { like } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const query = getQuery(event).query as string

  const searchResults = await db.query.players.findMany({
    where: query ? like(players.name, `%${query}%`) : undefined,
  })

  return searchResults
})
