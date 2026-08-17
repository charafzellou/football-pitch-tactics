import { db } from '../../db'
import { getSeasonStatus } from '../../core/season'
import { computeStandings } from '../../core/standings'

/**
 * Where the season has got to, and who is winning it.
 *
 * Drives the dashboard's round counter and the end-of-season prompt.
 */
export default defineEventHandler(async () => {
  const status = await getSeasonStatus()
  if (!status)
    return null

  const gameState = await db.query.game.findFirst()
  const playerTeam = gameState
    ? await db.query.teams.findFirst({ where: (teams, { eq }) => eq(teams.id, gameState.playerTeamId) })
    : null

  const table = playerTeam ? await computeStandings(playerTeam.leagueId, status.season) : []
  const leader = table[0] ?? null
  const playerIndex = playerTeam ? table.findIndex(row => row.teamId === playerTeam.id) : -1

  return {
    ...status,
    leader: leader ? { teamName: leader.teamName, points: leader.points } : null,
    playerPosition: playerIndex >= 0 ? playerIndex + 1 : null,
    playerPoints: playerIndex >= 0 ? table[playerIndex]!.points : null,
    pointsBehindLeader: playerIndex >= 0 && leader ? leader.points - table[playerIndex]!.points : null,
  }
})
