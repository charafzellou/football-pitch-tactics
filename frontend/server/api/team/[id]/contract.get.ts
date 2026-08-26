import { eq } from 'drizzle-orm'
import { db } from '../../../db'
import { players } from '../../../db/schema'
import {
  MAX_CONTRACT_SEASONS,
  MIN_CONTRACT_SEASONS,
  contractDemand,
  maxSeasonsFor,
  requiredWage,
} from '../../../core/contracts'
import { leagueStandingFor } from '../../../core/finance'
import { getSeasonStatus } from '../../../core/season'
import { activeSave } from '../../../core/save'

/**
 * What this player wants to re-sign.
 *
 * The whole demand curve is returned, not just one figure, so the renewal
 * screen can show the wage against every contract length at once — the
 * trade-off between paying more for a short deal and committing long is the
 * decision, and it should be visible rather than discovered by trial offers.
 */
export default defineEventHandler(async (event) => {
  const teamId = Number(getRouterParam(event, 'id'))
  const playerId = Number(getQuery(event).playerId)

  if (!teamId || !playerId) {
    throw createError({ statusCode: 400, statusMessage: 'Team id and playerId are required' })
  }

  const gameState = await activeSave(event)
  if (!gameState || gameState.playerTeamId !== teamId) {
    throw createError({ statusCode: 403, statusMessage: 'You do not manage that club' })
  }

  const player = await db.query.players.findFirst({ where: eq(players.id, playerId) })

  // Two people you can talk terms with: your own contracted players, and any
  // free agent. The demand curve is priced identically for both — what changes
  // is only whether a fee is involved, which is the caller's business.
  const isOwnPlayer = Boolean(player) && player!.teamId === teamId && !player!.freeAgent
  const isFreeAgent = Boolean(player) && Boolean(player!.freeAgent)

  if (!player || player.retired || (!isOwnPlayer && !isFreeAgent)) {
    throw createError({ statusCode: 404, statusMessage: 'That player is not available to negotiate with' })
  }

  const status = await getSeasonStatus(gameState)
  const standing = await leagueStandingFor(teamId, gameState.season, status?.round ?? 0)
  if (!standing) {
    throw createError({ statusCode: 404, statusMessage: 'Club not found' })
  }

  const context = {
    playerId: player.id,
    marketValue: player.marketValue,
    age: player.age,
    skillLevel: player.skillLevel,
    clubReputation: standing.club.reputation,
    position: standing.position,
    leagueSize: standing.leagueSize,
  }

  const maxSeasons = maxSeasonsFor(player.age)

  return {
    player: {
      id: player.id,
      name: player.name,
      age: player.age,
      position: player.position,
      skillLevel: player.skillLevel,
      marketValue: player.marketValue,
      wage: player.wage,
      contractUntilSeason: player.contractUntilSeason,
    },
    season: gameState.season,
    /** True when he is unattached — signing him costs a wage and nothing else. */
    freeAgent: isFreeAgent,
    /** Seasons of cover left, 0 once the deal runs out this summer. */
    seasonsRemaining: Math.max(0, player.contractUntilSeason - gameState.season),
    expiring: player.contractUntilSeason <= gameState.season,
    baseDemand: contractDemand(context),
    maxSeasons,
    options: Array.from(
      { length: maxSeasons - MIN_CONTRACT_SEASONS + 1 },
      (_, index) => {
        const seasons = MIN_CONTRACT_SEASONS + index
        return { seasons, wage: requiredWage(context, seasons) }
      },
    ).slice(0, MAX_CONTRACT_SEASONS),
  }
})
