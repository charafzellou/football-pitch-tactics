import { and, eq, like, ne, or } from 'drizzle-orm'
import { db } from '../../../server/db'
import { players, teams } from '../../../server/db/schema'

/**
 * The transfer market.
 *
 * Free agents belong here as much as contracted players — they are the whole
 * point of letting a contract lapse — and they keep their old `team_id`, so
 * excluding "players at your own club" has to spare them or a player you
 * released could never be re-signed.
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event).query as string
  const gameState = await db.query.game.findFirst()

  // A retired player must never appear on the transfer market.
  const filters = [eq(players.retired, 0)]

  if (gameState) {
    filters.push(or(
      ne(players.teamId, gameState.playerTeamId),
      eq(players.freeAgent, 1),
    )!)
  }

  if (query)
    filters.push(like(players.name, `%${query}%`))

  const [searchResults, allTeams] = await Promise.all([
    db.query.players.findMany({ where: and(...filters) }),
    db.query.teams.findMany({ columns: { id: true, name: true, reputation: true } }),
  ])

  const teamById = new Map(allTeams.map(team => [team.id, team]))

  return searchResults.map(player => ({
    ...player,
    freeAgent: player.freeAgent === 1,
    /** What it would cost to sign them. A free agent costs nothing but wages. */
    fee: player.freeAgent === 1 ? 0 : player.marketValue,
    /** For a free agent this reads as the club that released them. */
    teamName: teamById.get(player.teamId)?.name ?? 'Unknown',
    teamReputation: teamById.get(player.teamId)?.reputation ?? 50,
  }))
})
