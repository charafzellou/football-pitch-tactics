import { and, eq, gt, inArray, ne } from 'drizzle-orm'
import { db } from '../../server/db'
import { players, teams } from '../../server/db/schema'
import { requireActiveManager } from '../../server/core/save'
import { assertNotEmbargoed } from '../../server/core/insolvency'
import { settleTransfer } from '../../server/core/market'
import { evaluateOffer } from '../../server/core/contracts'
import { leagueStandingFor } from '../../server/core/finance'
import { getSeasonStatus } from '../../server/core/season'

const MAX_SKILL_GAP = 8
const CLOSEST_FALLBACK_SIZE = 5

function averageSkill(teamPlayers: Array<{ skillLevel: number }>) {
  if (!teamPlayers.length)
    return 0

  return teamPlayers.reduce((total, teamPlayer) => total + teamPlayer.skillLevel, 0) / teamPlayers.length
}

function getTransferPremium(strengthDelta: number) {
  if (strengthDelta > 2)
    return 0.30 + Math.random() * 0.20

  if (strengthDelta < -2)
    return 0.05 + Math.random() * 0.10

  return 0.15 + Math.random() * 0.15
}

/**
 * Buying, selling, and signing a free agent.
 *
 * All three settle through `settleTransfer()`, which is what finally puts
 * transfers in the ledger. This route used to move `teams.bank_balance`
 * directly, so the `transfer_in`/`transfer_out` ledger types were declared and
 * never written — a balance rebuilt from the ledger disagreed with the stored
 * one for any club that had traded. It also means a notable arrival or
 * departure now actually moves fan confidence.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{
    playerId?: number
    action?: string
    wage?: number
    seasons?: number
  }>(event)

  const { action } = body
  if (action !== 'sell' && action !== 'buy' && action !== 'sign') {
    throw createError({ statusCode: 400, statusMessage: 'Invalid action' })
  }

  const playerId = Number(body.playerId)
  if (!playerId) {
    throw createError({ statusCode: 400, statusMessage: 'playerId is required' })
  }

  const gameState = await requireActiveManager(event)
  if (!gameState.playerTeamId) {
    throw createError({ statusCode: 400, statusMessage: 'No active player team found' })
  }

  const player = await db.query.players.findFirst({
    where: and(eq(players.id, playerId), eq(players.gameId, gameState.id)),
  })
  if (!player) throw createError({ statusCode: 404, statusMessage: 'Player not found' })

  if (player.retired) {
    throw createError({ statusCode: 400, statusMessage: 'That player has retired' })
  }

  const status = await getSeasonStatus(gameState)
  const round = status?.round ?? 0
  const season = gameState.season

  /**
   * The embargo, and the only place a financial condition refuses anything.
   *
   * Selling is always allowed — it is how a club under embargo gets out of one.
   * Only bringing a player in is blocked, and only because the balance is
   * actually negative, never because a recommended budget says so.
   */
  if (action !== 'sell')
    assertNotEmbargoed(gameState.insolvencyStage)

  // -------------------------------------------------------------------------
  // Signing a free agent — no fee, just terms
  // -------------------------------------------------------------------------
  if (action === 'sign') {
    if (!player.freeAgent) {
      throw createError({ statusCode: 400, statusMessage: 'That player is under contract — make an offer to his club instead' })
    }

    const wage = Math.round(Number(body?.wage))
    const seasons = Math.round(Number(body?.seasons))

    if (!Number.isFinite(wage) || !Number.isFinite(seasons) || wage < 0) {
      throw createError({ statusCode: 400, statusMessage: 'wage and seasons are required' })
    }

    const standing = await leagueStandingFor(gameState.playerTeamId, season, round)
    if (!standing) {
      throw createError({ statusCode: 404, statusMessage: 'Club not found' })
    }

    const outcome = evaluateOffer(
      {
        playerId: player.id,
        marketValue: player.marketValue,
        age: player.age,
        skillLevel: player.skillLevel,
        clubReputation: standing.club.reputation,
        position: standing.position,
        leagueSize: standing.leagueSize,
      },
      { wage, seasons },
    )

    // A refusal is a normal outcome of negotiating, not an error — the response
    // carries what he actually wanted so the manager can meet it.
    if (!outcome.accepted) {
      return {
        success: false,
        accepted: false,
        required: outcome.required,
        maxSeasons: outcome.maxSeasons,
        reason: outcome.reason,
      }
    }

    const result = await db.transaction(async (tx) => {
      const settled = await settleTransfer(tx, {
        playerId: player.id,
        fromTeamId: player.teamId,
        toTeamId: gameState.playerTeamId,
        fee: 0,
        season,
        round,
      })

      await tx.update(players)
        .set({ wage, contractUntilSeason: season + seasons - 1 })
        .where(eq(players.id, player.id))

      return settled
    })

    return {
      success: true,
      accepted: true,
      freeTransfer: true,
      buyerTeam: result.toTeamName,
      previousTeam: result.fromTeamName,
      wage,
      seasons,
      contractUntilSeason: season + seasons - 1,
      fanConfidence: result.fanConfidence,
    }
  }

  // -------------------------------------------------------------------------
  // Buying a contracted player at his valuation
  // -------------------------------------------------------------------------
  if (action === 'buy') {
    if (player.freeAgent) {
      throw createError({ statusCode: 400, statusMessage: 'That player is a free agent — sign him on terms instead' })
    }

    const buyerTeam = await db.query.teams.findFirst({ where: eq(teams.id, gameState.playerTeamId) })
    if (!buyerTeam) {
      throw createError({ statusCode: 404, statusMessage: 'Buyer team not found' })
    }

    if (player.teamId === buyerTeam.id) {
      throw createError({ statusCode: 400, statusMessage: 'Player already belongs to your team' })
    }

    const sellerTeam = await db.query.teams.findFirst({ where: eq(teams.id, player.teamId) })
    if (!sellerTeam) {
      throw createError({ statusCode: 404, statusMessage: 'Seller team not found' })
    }

    const purchasePrice = player.marketValue
    if (buyerTeam.bankBalance < purchasePrice) {
      throw createError({ statusCode: 400, statusMessage: 'Your club cannot afford this player' })
    }

    const result = await db.transaction(tx => settleTransfer(tx, {
      playerId: player.id,
      fromTeamId: sellerTeam.id,
      toTeamId: buyerTeam.id,
      fee: purchasePrice,
      season,
      round,
    }))

    return {
      success: true,
      buyerTeam: result.toTeamName,
      sellerTeam: result.fromTeamName,
      purchasePrice,
      fanConfidence: result.fanConfidence,
    }
  }

  // -------------------------------------------------------------------------
  // Selling to the best-fitting AI buyer
  // -------------------------------------------------------------------------
  const sellerTeam = await db.query.teams.findFirst({ where: eq(teams.id, player.teamId) })
  if (!sellerTeam) throw createError({ statusCode: 404, statusMessage: 'Seller team not found' })

  const excludedTeamIds = new Set([sellerTeam.id])
  excludedTeamIds.add(gameState.playerTeamId)

  // Find buyer teams that are not controlled by the player and can afford at least the current value.
  // Scoped to this save's own clones — without `gameId` this would consider
  // every other save's teams as potential buyers.
  const possibleBuyers = await db.query.teams.findMany({
    where: and(
      eq(teams.gameId, gameState.id),
      ...Array.from(excludedTeamIds).map(teamId => ne(teams.id, teamId)),
      gt(teams.bankBalance, player.marketValue),
    ),
  })
  if (!possibleBuyers.length) throw createError({ statusCode: 400, statusMessage: 'No team can afford this player.' })

  const buyerTeamIds = possibleBuyers.map(team => team.id)
  const teamPlayers = await db.query.players.findMany({
    where: and(
      inArray(players.teamId, [sellerTeam.id, ...buyerTeamIds]),
      // Retired and released players would otherwise drag every squad average
      // down — neither is in the squad any more.
      eq(players.retired, 0),
      eq(players.freeAgent, 0),
    ),
  })

  const playersByTeam = new Map<number, typeof teamPlayers>()
  for (const teamPlayer of teamPlayers) {
    const existing = playersByTeam.get(teamPlayer.teamId) ?? []
    existing.push(teamPlayer)
    playersByTeam.set(teamPlayer.teamId, existing)
  }

  const sellerSquad = playersByTeam.get(sellerTeam.id) ?? []
  const sellerAverageSkill = averageSkill(sellerSquad)

  const eligibleBuyers = possibleBuyers
    .map((buyerTeam) => {
      const buyerSquad = playersByTeam.get(buyerTeam.id) ?? []
      if (!buyerSquad.length)
        return null

      const samePositionPlayers = buyerSquad.filter(teamPlayer => teamPlayer.position === player.position)
      const comparisonGroup = samePositionPlayers.length ? samePositionPlayers : buyerSquad
      const comparisonSkill = averageSkill(comparisonGroup)
      const buyerAverageSkill = averageSkill(buyerSquad)
      const transferPremium = getTransferPremium(buyerAverageSkill - sellerAverageSkill)
      const transferValue = Math.round(player.marketValue * (1 + transferPremium))

      return {
        ...buyerTeam,
        buyerAverageSkill,
        comparisonSkill,
        skillGap: Math.abs(comparisonSkill - player.skillLevel),
        transferValue,
      }
    })
    .filter((buyerTeam): buyerTeam is NonNullable<typeof buyerTeam> => Boolean(buyerTeam))
    .filter(buyerTeam => buyerTeam.bankBalance >= buyerTeam.transferValue)

  const preferredBuyers = eligibleBuyers.filter(buyerTeam => buyerTeam.skillGap <= MAX_SKILL_GAP)
  const buyerPool = (preferredBuyers.length ? preferredBuyers : [...eligibleBuyers]
    .sort((left, right) => left.skillGap - right.skillGap)
    .slice(0, CLOSEST_FALLBACK_SIZE))

  const buyerTeam = buyerPool[Math.floor(Math.random() * buyerPool.length)]
  if (!buyerTeam) {
    throw createError({ statusCode: 400, statusMessage: 'No team can afford this player.' })
  }

  const result = await db.transaction(tx => settleTransfer(tx, {
    playerId: player.id,
    fromTeamId: sellerTeam.id,
    toTeamId: buyerTeam.id,
    fee: buyerTeam.transferValue,
    season,
    round,
    // Sold at a premium, so he is worth more to the next club that asks.
    newMarketValue: buyerTeam.transferValue,
  }))

  return {
    success: true,
    buyerTeam: result.toTeamName,
    salePrice: buyerTeam.transferValue,
    fanConfidence: result.fanConfidence,
  }
})
