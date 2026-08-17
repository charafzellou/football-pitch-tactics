import { desc } from 'drizzle-orm'
import { db } from '../../db'
import { seasonSummary } from '../../db/schema'

/** Past champions and the player's finishing positions. */
export default defineEventHandler(async () => {
  const rows = await db.query.seasonSummary.findMany({
    orderBy: [desc(seasonSummary.season)],
  })

  if (!rows.length)
    return []

  const [leagues, teams] = await Promise.all([
    db.query.leagues.findMany(),
    db.query.teams.findMany(),
  ])

  const leagueName = new Map(leagues.map(league => [league.id, league.name]))
  const teamName = new Map(teams.map(team => [team.id, team.name]))

  return rows.map(row => ({
    season: row.season,
    leagueName: leagueName.get(row.leagueId) ?? '—',
    champion: teamName.get(row.championTeamId) ?? '—',
    championPoints: row.championPoints,
    playerPosition: row.playerPosition,
    playerPoints: row.playerPoints,
    isPlayerLeague: row.playerTeamId !== null,
    wonByPlayer: row.playerTeamId !== null && row.playerPosition === 1,
  }))
})
