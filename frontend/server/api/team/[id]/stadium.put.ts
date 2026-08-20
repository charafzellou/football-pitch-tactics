import { eq } from 'drizzle-orm'
import { db } from '../../../db'
import { teams } from '../../../db/schema'
import {
  EXPANSION_STEP,
  MAX_STADIUM_CAPACITY,
  MAX_TICKET_PRICE,
  MIN_TICKET_PRICE,
  expansionCost,
} from '../../../core/economy'
import { postLedger } from '../../../core/finance'
import { requireActiveManager } from '../../../core/save'

/**
 * Ticket price and stadium expansion.
 *
 * Both are the player's levers on income. Expansion is paid for immediately and
 * takes effect immediately — there is no construction timeline, because the
 * game has no calendar granularity finer than a matchday to hang one on.
 */
export default defineEventHandler(async (event) => {
  const teamId = Number(getRouterParam(event, 'id'))
  const body = await readBody<{ ticketPrice?: number; expand?: boolean }>(event)

  if (!teamId) {
    throw createError({ statusCode: 400, statusMessage: 'Team id is required' })
  }

  const gameState = await requireActiveManager()
  if (gameState.playerTeamId !== teamId) {
    throw createError({ statusCode: 403, statusMessage: 'You do not manage that club' })
  }

  const club = await db.query.teams.findFirst({ where: eq(teams.id, teamId) })
  if (!club) {
    throw createError({ statusCode: 404, statusMessage: 'Club not found' })
  }

  if (body?.ticketPrice !== undefined) {
    const price = Math.round(Number(body.ticketPrice))
    if (!Number.isFinite(price) || price < MIN_TICKET_PRICE || price > MAX_TICKET_PRICE) {
      throw createError({
        statusCode: 400,
        statusMessage: `Ticket price must be between €${MIN_TICKET_PRICE} and €${MAX_TICKET_PRICE}`,
      })
    }

    await db.update(teams).set({ ticketPrice: price }).where(eq(teams.id, teamId))
  }

  if (body?.expand) {
    if (club.stadiumCapacity >= MAX_STADIUM_CAPACITY) {
      throw createError({ statusCode: 400, statusMessage: 'The stadium is already at maximum capacity' })
    }

    const cost = expansionCost(EXPANSION_STEP)
    if (club.bankBalance < cost) {
      throw createError({ statusCode: 400, statusMessage: 'Your club cannot afford this expansion' })
    }

    const capacity = Math.min(MAX_STADIUM_CAPACITY, club.stadiumCapacity + EXPANSION_STEP)

    await db.transaction(async (tx) => {
      await tx.update(teams).set({ stadiumCapacity: capacity }).where(eq(teams.id, teamId))

      // Through the ledger, like every other movement, so the balance stays
      // explainable.
      await postLedger(tx, [{
        teamId,
        season: gameState.season,
        round: 0,
        type: 'stadium',
        amount: -cost,
        description: `Stadium expansion to ${capacity.toLocaleString('en-IE')}`,
      }])
    })
  }

  const updated = await db.query.teams.findFirst({ where: eq(teams.id, teamId) })
  return {
    success: true,
    ticketPrice: updated?.ticketPrice,
    stadiumCapacity: updated?.stadiumCapacity,
    balance: updated?.bankBalance,
  }
})
