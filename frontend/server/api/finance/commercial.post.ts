import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { sponsorshipDeals, teams } from '../../db/schema'
import { MAX_PERIMETER_LEVEL, SLOT_LABELS, perimeterTier, perimeterUpgradeCost } from '../../core/economy'
import { poolFor } from '../../core/sponsors'
import type { CommercialSlot } from '../../core/economy'
import { postLedger } from '../../core/finance'
import { NAMING_RIGHTS_FAN_COST } from '../../core/sponsors'
import { nudgeFans } from '../../core/board'
import { postNews } from '../../core/news'
import { requireActiveManager } from '../../core/save'
import { getSeasonStatus } from '../../core/season'

interface Body {
  action?: 'accept' | 'decline' | 'upgrade-perimeter'
  offerId?: number
}

/**
 * The chairman's commercial decisions.
 *
 * Signing a partner is free — it is income, not a purchase — so the only thing
 * that can fail is the perimeter upgrade, which is capital and is refused when
 * the club cannot pay for it. Nothing here consults a *budget*: a recommended
 * figure never blocks anything in this game.
 */
export default defineEventHandler(async (event) => {
  const gameState = await requireActiveManager(event)
  const body = await readBody<Body>(event)

  const club = await db.query.teams.findFirst({ where: eq(teams.id, gameState.playerTeamId) })
  if (!club)
    throw createError({ statusCode: 404, statusMessage: 'Club not found' })

  const status = await getSeasonStatus(gameState)
  const round = status?.round ?? 0

  if (body?.action === 'upgrade-perimeter') {
    if (club.perimeterLevel >= MAX_PERIMETER_LEVEL)
      throw createError({ statusCode: 400, statusMessage: 'The hoardings are already the best available' })

    const nextLevel = club.perimeterLevel + 1
    const tier = perimeterTier(nextLevel)
    const pool = await poolFor(club.id, gameState.season, round)
    const cost = perimeterUpgradeCost(pool, club.perimeterLevel)

    if (club.bankBalance < cost)
      throw createError({ statusCode: 400, statusMessage: 'You cannot afford this' })

    await db.transaction(async (tx) => {
      await tx.update(teams).set({ perimeterLevel: nextLevel }).where(eq(teams.id, club.id))
      await postLedger(tx, [{
        teamId: club.id,
        season: gameState.season,
        round,
        type: 'stadium',
        amount: -cost,
        description: `Advertising boards — ${tier.name}`,
      }])
    })

    return { success: true, perimeterLevel: nextLevel, tierName: tier.name }
  }

  const offerId = Number(body?.offerId)
  if (!offerId)
    throw createError({ statusCode: 400, statusMessage: 'An offer is required' })

  const offer = await db.query.sponsorshipDeals.findFirst({
    where: and(eq(sponsorshipDeals.id, offerId), eq(sponsorshipDeals.teamId, club.id)),
  })

  if (!offer || offer.status !== 'offered')
    throw createError({ statusCode: 404, statusMessage: 'That offer is no longer on the table' })

  if (body?.action === 'decline') {
    await db.update(sponsorshipDeals).set({ status: 'declined' }).where(eq(sponsorshipDeals.id, offer.id))
    return { success: true, declined: true }
  }

  const slotLabel = SLOT_LABELS[offer.slot as CommercialSlot] ?? offer.slot

  let fanReaction = 0
  await db.transaction(async (tx) => {
    // Signing one offer takes the slot, so the rest of that table comes down.
    const competing = await tx.query.sponsorshipDeals.findMany({
      where: and(
        eq(sponsorshipDeals.teamId, club.id),
        eq(sponsorshipDeals.slot, offer.slot),
        eq(sponsorshipDeals.status, 'offered'),
      ),
    })

    for (const row of competing) {
      await tx.update(sponsorshipDeals)
        .set({ status: row.id === offer.id ? 'active' : 'declined' })
        .where(eq(sponsorshipDeals.id, row.id))
    }

    // A deal signed in a slot's final season replaces the one running out.
    const running = await tx.query.sponsorshipDeals.findMany({
      where: and(
        eq(sponsorshipDeals.teamId, club.id),
        eq(sponsorshipDeals.slot, offer.slot),
        eq(sponsorshipDeals.status, 'active'),
      ),
    })

    for (const row of running) {
      if (row.id !== offer.id)
        await tx.update(sponsorshipDeals).set({ status: 'expired' }).where(eq(sponsorshipDeals.id, row.id))
    }

    /**
     * Selling the ground's name is the one deal supporters can see from the
     * street, so it is the one that costs something other than money.
     */
    if (offer.slot === 'naming_rights') {
      await tx.update(teams)
        .set({ stadiumName: `${offer.sponsorName} ${club.stadiumBaseName?.split(' ').pop() ?? 'Stadium'}` })
        .where(eq(teams.id, club.id))

      fanReaction = NAMING_RIGHTS_FAN_COST
      await nudgeFans(tx, gameState.id, gameState.fanConfidence, fanReaction)
    }

    await postNews(tx, gameState.id, [{
      season: gameState.season,
      round,
      category: 'finance',
      tone: offer.slot === 'naming_rights' ? 'neutral' : 'positive',
      headline: `${offer.sponsorName} become the club's ${slotLabel.toLowerCase()}`,
      body: `${offer.baseFee.toLocaleString('en-IE')} a matchday until the end of season ${offer.untilSeason}.`
        + (offer.slot === 'naming_rights' ? ' Supporters are not happy about the name.' : ''),
    }])
  })

  return {
    success: true,
    slot: offer.slot,
    slotLabel,
    sponsorName: offer.sponsorName,
    baseFee: offer.baseFee,
    untilSeason: offer.untilSeason,
    fanReaction,
  }
})
