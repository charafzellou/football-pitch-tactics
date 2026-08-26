import { and, desc, eq, inArray } from 'drizzle-orm'
import { db } from '../../db'
import { players, teams, transferOffers } from '../../db/schema'
import { activeSave } from '../../core/save'
import { OFFER_LIFETIME_ROUNDS } from '../../core/market'
import { getSeasonStatus } from '../../core/season'

/**
 * Bids currently on the table for the manager's players.
 *
 * `transfer_offers` was declared and cleared on a new save, but nothing ever
 * wrote or read a row — AI clubs took no interest in the manager's squad at
 * all. Offers are now generated on matchdays by `runTransferMarket()`; this is
 * where they surface.
 */
export default defineEventHandler(async (event) => {
  const gameState = await activeSave(event)
  if (!gameState)
    return []

  const offers = await db.query.transferOffers.findMany({
    where: and(
      eq(transferOffers.status, 'pending'),
      eq(transferOffers.toTeamId, gameState.playerTeamId),
      eq(transferOffers.season, gameState.season),
    ),
    orderBy: [desc(transferOffers.id)],
  })

  if (!offers.length)
    return []

  const [squad, clubs, status] = await Promise.all([
    db.query.players.findMany({ where: inArray(players.id, offers.map(offer => offer.playerId)) }),
    db.query.teams.findMany({ where: inArray(teams.id, offers.map(offer => offer.fromTeamId)) }),
    getSeasonStatus(gameState),
  ])

  const playerById = new Map(squad.map(player => [player.id, player]))
  const clubById = new Map(clubs.map(club => [club.id, club]))
  const currentRound = status?.round ?? 0

  return offers.flatMap((offer) => {
    const player = playerById.get(offer.playerId)
    const club = clubById.get(offer.fromTeamId)

    // A player who has since retired or moved on is no longer sellable.
    if (!player || !club || player.teamId !== gameState.playerTeamId || player.retired)
      return []

    return [{
      id: offer.id,
      amount: offer.amount,
      round: offer.round,
      /** Matchdays left before it lapses. Clamped at 0 for a bid due to expire. */
      roundsRemaining: Math.max(0, offer.round + OFFER_LIFETIME_ROUNDS - currentRound),
      fromTeamName: club.name,
      fromTeamReputation: club.reputation,
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
      /** How far above (or below) his valuation the bid sits, as a percentage. */
      premiumPercent: player.marketValue
        ? Math.round(((offer.amount - player.marketValue) / player.marketValue) * 100)
        : 0,
    }]
  })
})
