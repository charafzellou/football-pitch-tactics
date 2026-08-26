import { db } from '../db'
import { teams } from '../db/schema'
import { and, eq, isNull } from 'drizzle-orm'

/**
 * Teams available to start a new save with.
 *
 * Scoped to template rows (`game_id IS NULL`) only — the reference roster
 * every save is cloned from. Without that filter this would also return
 * every existing save's live clones the moment more than one save exists,
 * and the new-game wizard would offer to "start as Arsenal" using another
 * player's already-in-progress Arsenal.
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const leagueId = Number(query.leagueId)

  if (!leagueId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'League ID is required',
    })
  }

  return await db.select().from(teams).where(and(eq(teams.leagueId, leagueId), isNull(teams.gameId)))
})
