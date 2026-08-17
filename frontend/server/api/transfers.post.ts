import { db } from '../../server/db'
import { players, teams } from '../../server/db/schema'
import { and, eq, gt, inArray, ne } from 'drizzle-orm'

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

export default defineEventHandler(async (event) => {
  const { playerId, action } = await readBody(event)
  if (action !== 'sell' && action !== 'buy') {
    throw createError({ statusCode: 400, statusMessage: 'Invalid action' })
  }

  // Get player
  const player = await db.query.players.findFirst({ where: eq(players.id, playerId) })
  if (!player) throw createError({ statusCode: 404, statusMessage: 'Player not found' })
  const gameState = await db.query.game.findFirst()
  if (!gameState?.playerTeamId) {
    throw createError({ statusCode: 400, statusMessage: 'No active player team found' })
  }

  if (action === 'buy') {
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

    await db.transaction(async (tx) => {
      await tx.update(players).set({ teamId: buyerTeam.id }).where(eq(players.id, playerId))
      await tx.update(teams).set({ bankBalance: buyerTeam.bankBalance - purchasePrice }).where(eq(teams.id, buyerTeam.id))
      await tx.update(teams).set({ bankBalance: sellerTeam.bankBalance + purchasePrice }).where(eq(teams.id, sellerTeam.id))
    })

    return {
      success: true,
      buyerTeam: buyerTeam.name,
      sellerTeam: sellerTeam.name,
      purchasePrice,
    }
  }

  // Get seller team
  const sellerTeam = await db.query.teams.findFirst({ where: eq(teams.id, player.teamId) })
  if (!sellerTeam) throw createError({ statusCode: 404, statusMessage: 'Seller team not found' })

  const excludedTeamIds = new Set([sellerTeam.id])
  excludedTeamIds.add(gameState.playerTeamId)

  // Find buyer teams that are not controlled by the player and can afford at least the current value.
  const possibleBuyers = await db.query.teams.findMany({
    where: and(
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

  // Transfer player and update funds
  await db.transaction(async (tx) => {
    await tx.update(players).set({ teamId: buyerTeam.id, marketValue: buyerTeam.transferValue }).where(eq(players.id, playerId))
    await tx.update(teams).set({ bankBalance: sellerTeam.bankBalance + buyerTeam.transferValue }).where(eq(teams.id, sellerTeam.id))
    await tx.update(teams).set({ bankBalance: buyerTeam.bankBalance - buyerTeam.transferValue }).where(eq(teams.id, buyerTeam.id))
  })
  return {
    success: true,
    buyerTeam: buyerTeam.name,
    salePrice: buyerTeam.transferValue,
  }
})
