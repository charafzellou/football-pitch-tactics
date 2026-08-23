import { db } from '../../server/db'
import { computeStandings } from '../../server/core/standings'
import { activeSave } from '../../server/core/save'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const leagueId = Number(query.leagueId)

  if (!leagueId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'League ID is required',
    })
  }

  const gameState = await activeSave(event)
  if (!gameState)
    return []

  // The season used to be hardcoded to 1, which would have kept showing the
  // first season's table forever once a rollover happened.
  const season = Number(query.season) || gameState.season

  return computeStandings(leagueId, season, gameState.id)
})
