import { db } from '../../server/db'
import { matches } from '../../server/db/schema'
import { or, eq, and, isNull } from 'drizzle-orm'
import { activeSave } from '../../server/core/save'

/**
 * The player's fixture list.
 *
 * "Upcoming" deliberately means *unplayed*, not *dated in the future*. It used
 * to carry `matchDate >= game.currentDate` as well, which coupled the one list
 * the dashboard and Matchday steer by to the virtual calendar — and any drift
 * between the two silently emptied it. A new save set `currentDate` to the real
 * wall clock while season 1 is dated from a fixed 2024 start, so every fixture
 * read as already past: the dashboard rendered Club Status with nothing beside
 * it (no Next Match card, no Go to Matchday) and the save was unplayable from
 * the first minute.
 *
 * `played` is the only thing that decides whether a fixture still has to be
 * played, so it is the only thing filtered on. The calendar keeps its own job —
 * deciding which *other* clubs' fixtures are due for headless resolution.
 */
export default defineEventHandler(async (event) => {
  const gameState = await activeSave(event)
  if (!gameState) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Game not found',
    })
  }

  const query = getQuery(event)
  const includePlayed = String(query.includePlayed ?? 'false') === 'true'

  const teamFilter = and(
    eq(matches.gameId, gameState.id),
    or(
      eq(matches.homeTeamId, gameState.playerTeamId),
      eq(matches.awayTeamId, gameState.playerTeamId),
    ),
  )

  const schedule = await db.query.matches.findMany({
    where: includePlayed
      ? teamFilter
      : and(
          teamFilter,
          isNull(matches.homeScore),
          eq(matches.played, 0),
        ),
    orderBy: (matches, { asc }) => [asc(matches.matchDate)],
  })

  return schedule
})
