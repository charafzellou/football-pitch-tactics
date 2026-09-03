import { db } from '../../server/db'
import { recentForm } from '../../server/core/results-server'
import { computeStandings } from '../../server/core/standings'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const leagueId = Number(query.leagueId)

  if (!leagueId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'League ID is required',
    })
  }

  // The season used to be hardcoded to 1, which would have kept showing the
  // first season's table forever once a rollover happened.
  const gameState = await db.query.game.findFirst()
  const season = Number(query.season) || gameState?.season || 1

  const table = await computeStandings(leagueId, season)
  const formByTeam = await recentForm(leagueId, season, table.map(row => row.teamId))

  return table.map(row => ({
    ...row,
    form: formByTeam.get(row.teamId) ?? [],
  }))
})
