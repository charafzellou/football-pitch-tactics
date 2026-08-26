import { eq } from 'drizzle-orm'
import { db } from '../../../db'
import { players } from '../../../db/schema'
import { evaluateOffer, maxSeasonsFor } from '../../../core/contracts'
import { leagueStandingFor } from '../../../core/finance'
import { getSeasonStatus } from '../../../core/season'
import { postNews } from '../../../core/news'
import { requireActiveManager } from '../../../core/save'
import { assertNotEmbargoed } from '../../../core/insolvency'

/**
 * Offers a player new terms.
 *
 * A refusal is a 200 with `accepted: false`, not an error — it is a normal
 * outcome of negotiating, and the response carries what they actually wanted so
 * the manager can meet it rather than guess again.
 */
export default defineEventHandler(async (event) => {
  const teamId = Number(getRouterParam(event, 'id'))
  const body = await readBody<{ playerId?: number; wage?: number; seasons?: number }>(event)

  const playerId = Number(body?.playerId)
  const wage = Math.round(Number(body?.wage))
  const seasons = Math.round(Number(body?.seasons))

  if (!teamId || !playerId || !Number.isFinite(wage) || !Number.isFinite(seasons)) {
    throw createError({ statusCode: 400, statusMessage: 'playerId, wage and seasons are required' })
  }

  if (wage < 0) {
    throw createError({ statusCode: 400, statusMessage: 'A wage cannot be negative' })
  }

  const gameState = await requireActiveManager(event)
  if (gameState.playerTeamId !== teamId) {
    throw createError({ statusCode: 403, statusMessage: 'You do not manage that club' })
  }

  const player = await db.query.players.findFirst({ where: eq(players.id, playerId) })
  if (!player || player.teamId !== teamId || player.retired || player.freeAgent) {
    throw createError({ statusCode: 404, statusMessage: 'That player is not in your squad' })
  }

  /**
   * An embargoed club may still renew, but not improve.
   *
   * Blocking renewals outright would let the embargo cost the manager players
   * for free — the point is to stop them adding to a wage bill they cannot pay,
   * not to strip the squad while they are already broke.
   */
  if (wage > player.wage)
    assertNotEmbargoed(gameState.insolvencyStage)

  const status = await getSeasonStatus(gameState)
  const standing = await leagueStandingFor(teamId, gameState.season, status?.round ?? 0)
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

  if (!outcome.accepted) {
    return {
      accepted: false,
      required: outcome.required,
      maxSeasons: outcome.maxSeasons,
      reason: outcome.reason,
    }
  }

  // The new deal runs `seasons` full campaigns from the *current* one, so
  // renewing mid-season never shortens the cover already in place.
  const contractUntilSeason = Math.max(player.contractUntilSeason, gameState.season + seasons - 1)

  await db.transaction(async (tx) => {
    await tx.update(players)
      .set({ wage, contractUntilSeason })
      .where(eq(players.id, player.id))

    await postNews(tx, gameState.id, [{
      season: gameState.season,
      round: status?.round ?? 0,
      category: 'contract',
      tone: 'positive',
      headline: `${player.name} signs a new contract`,
      body: `Committed until the end of season ${contractUntilSeason} on €${wage.toLocaleString('en-IE')} per matchday.`,
    }])
  })

  return {
    accepted: true,
    wage,
    seasons,
    contractUntilSeason,
    maxSeasons: maxSeasonsFor(player.age),
    reason: outcome.reason,
  }
})
