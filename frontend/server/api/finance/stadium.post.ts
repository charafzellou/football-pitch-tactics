import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { stadiumEvents, teams } from '../../db/schema'
import {
  EVENT_PROFILES,
  HOSPITALITY_BOX_COST,
  HOSPITALITY_BOX_SEATS,
  MAX_HOSPITALITY_BOXES,
  MAX_SEASON_TICKET_DISCOUNT,
  MAX_SEASON_TICKET_SHARE,
} from '../../core/economy'
import type { StadiumEventKind } from '../../core/economy'
import { postLedger } from '../../core/finance'
import { requireActiveManager } from '../../core/save'
import { getSeasonStatus } from '../../core/season'

interface Body {
  action?: 'book-event' | 'cancel-event' | 'build-boxes' | 'season-tickets'
  eventId?: number
  boxes?: number
  share?: number
  discount?: number
}

/**
 * The chairman's decisions about the ground.
 *
 * Boxes cost capital and are refused when the club cannot pay. Everything else
 * here is a choice about terms rather than a purchase, so nothing else can fail
 * on money — and no budget recommendation blocks anything, ever.
 */
export default defineEventHandler(async (event) => {
  const gameState = await requireActiveManager()
  const body = await readBody<Body>(event)

  const club = await db.query.teams.findFirst({ where: eq(teams.id, gameState.playerTeamId) })
  if (!club)
    throw createError({ statusCode: 404, statusMessage: 'Club not found' })

  const status = await getSeasonStatus()
  const round = status?.round ?? 0

  if (body?.action === 'season-tickets') {
    const share = Math.round(Number(body.share ?? club.seasonTicketShare))
    const discount = Math.round(Number(body.discount ?? club.seasonTicketDiscount))

    if (!Number.isFinite(share) || share < 0 || share > MAX_SEASON_TICKET_SHARE)
      throw createError({ statusCode: 400, statusMessage: `Share must be between 0 and ${MAX_SEASON_TICKET_SHARE}` })

    if (!Number.isFinite(discount) || discount < 0 || discount > MAX_SEASON_TICKET_DISCOUNT)
      throw createError({ statusCode: 400, statusMessage: `Discount must be between 0 and ${MAX_SEASON_TICKET_DISCOUNT}` })

    await db.update(teams)
      .set({ seasonTicketShare: share, seasonTicketDiscount: discount })
      .where(eq(teams.id, club.id))

    return { success: true, share, discount }
  }

  if (body?.action === 'build-boxes') {
    const boxes = Math.max(1, Math.round(Number(body.boxes ?? 1)))

    if (club.hospitalityBoxes + boxes > MAX_HOSPITALITY_BOXES)
      throw createError({ statusCode: 400, statusMessage: `The ground holds at most ${MAX_HOSPITALITY_BOXES} boxes` })

    const cost = HOSPITALITY_BOX_COST * boxes
    if (club.bankBalance < cost)
      throw createError({ statusCode: 400, statusMessage: 'You cannot afford this' })

    await db.transaction(async (tx) => {
      await tx.update(teams)
        .set({ hospitalityBoxes: club.hospitalityBoxes + boxes })
        .where(eq(teams.id, club.id))

      await postLedger(tx, [{
        teamId: club.id,
        season: gameState.season,
        round,
        type: 'stadium',
        amount: -cost,
        description: `${boxes} executive ${boxes === 1 ? 'box' : 'boxes'} `
          + `— ${boxes * HOSPITALITY_BOX_SEATS} general seats converted`,
      }])
    })

    return { success: true, boxes: club.hospitalityBoxes + boxes, cost }
  }

  const eventId = Number(body?.eventId)
  if (!eventId)
    throw createError({ statusCode: 400, statusMessage: 'A booking is required' })

  const booking = await db.query.stadiumEvents.findFirst({
    where: and(eq(stadiumEvents.id, eventId), eq(stadiumEvents.teamId, club.id)),
  })

  if (!booking)
    throw createError({ statusCode: 404, statusMessage: 'That booking no longer exists' })

  if (body?.action === 'cancel-event') {
    if (booking.status !== 'booked')
      throw createError({ statusCode: 400, statusMessage: 'That booking cannot be cancelled' })

    await db.update(stadiumEvents).set({ status: 'cancelled' }).where(eq(stadiumEvents.id, booking.id))
    return { success: true, cancelled: true }
  }

  if (booking.status !== 'offered')
    throw createError({ statusCode: 400, statusMessage: 'That week is no longer on offer' })

  if (booking.round <= round)
    throw createError({ statusCode: 400, statusMessage: 'That week has already passed' })

  await db.transaction(async (tx) => {
    // The ground cannot host two things in the same week.
    const clashes = await tx.query.stadiumEvents.findMany({
      where: and(
        eq(stadiumEvents.teamId, club.id),
        eq(stadiumEvents.season, booking.season),
        eq(stadiumEvents.round, booking.round),
        eq(stadiumEvents.status, 'offered'),
      ),
    })

    for (const row of clashes) {
      await tx.update(stadiumEvents)
        .set({ status: row.id === booking.id ? 'booked' : 'expired' })
        .where(eq(stadiumEvents.id, row.id))
    }
  })

  const profile = EVENT_PROFILES[booking.kind as StadiumEventKind]

  return {
    success: true,
    round: booking.round,
    label: profile?.label ?? booking.kind,
    fee: booking.fee,
    pitchWear: booking.pitchWear,
  }
})
