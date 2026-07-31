import { db } from '../../../server/db'
import { players } from '../../../server/db/schema'
import { and, like, ne } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const query = getQuery(event).query as string
  const gameState = await db.query.game.findFirst()

  const filters = []

  if (gameState)
    filters.push(ne(players.teamId, gameState.playerTeamId))

  if (query)
    filters.push(like(players.name, `%${query}%`))

  const searchResults = await db.query.players.findMany({
    where: filters.length > 1 ? and(...filters) : filters[0],
  })

  return searchResults
})
