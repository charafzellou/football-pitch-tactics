import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { teams } from '../../db/schema'
import {
  MAX_FACILITY_LEVEL,
  commercialPoolFor,
  facilityUpgradeCost,
} from '../../core/economy'
import { facilityTier } from '#shared/finance'
import { leagueStandingFor, postLedger } from '../../core/finance'
import { postNews } from '../../core/news'
import { requireActiveManager } from '../../core/save'
import { getSeasonStatus } from '../../core/season'

interface Body {
  facility?: 'academy' | 'training'
}

/**
 * Buying a level of academy or training ground.
 *
 * Refused only when the club genuinely cannot pay — no recommended budget is
 * consulted, because the entire argument for these two purchases is one a budget
 * built on the current season cannot make.
 */
export default defineEventHandler(async (event) => {
  const gameState = await requireActiveManager(event)
  const body = await readBody<Body>(event)

  const facility = body?.facility
  if (facility !== 'academy' && facility !== 'training')
    throw createError({ statusCode: 400, statusMessage: 'Choose a facility to upgrade' })

  const club = await db.query.teams.findFirst({ where: eq(teams.id, gameState.playerTeamId) })
  if (!club)
    throw createError({ statusCode: 404, statusMessage: 'Club not found' })

  const level = facility === 'academy' ? club.academyLevel : club.trainingLevel
  if (level >= MAX_FACILITY_LEVEL)
    throw createError({ statusCode: 400, statusMessage: 'That facility is already at its best' })

  const status = await getSeasonStatus(gameState)
  const round = status?.round ?? 0
  const standing = await leagueStandingFor(club.id, gameState.season, round)
  const pool = commercialPoolFor(
    club.reputation,
    standing?.position ?? 10,
    standing?.leagueSize ?? 20,
  )

  const cost = facilityUpgradeCost(pool, level)
  if (club.bankBalance < cost)
    throw createError({ statusCode: 400, statusMessage: 'You cannot afford this' })

  const next = level + 1
  const name = facility === 'academy' ? 'Academy' : 'Training ground'

  await db.transaction(async (tx) => {
    await tx.update(teams)
      .set(facility === 'academy' ? { academyLevel: next } : { trainingLevel: next })
      .where(eq(teams.id, club.id))

    await postLedger(tx, [{
      teamId: club.id,
      season: gameState.season,
      round,
      type: 'stadium',
      amount: -cost,
      description: `${name} rebuilt — ${facilityTier(next)}`,
    }])

    await postNews(tx, gameState.id, [{
      season: gameState.season,
      round,
      category: 'finance',
      tone: 'positive',
      headline: `${name} upgraded to ${facilityTier(next)}`,
      body: facility === 'academy'
        ? 'Nothing changes this season. The first graduates good enough to notice arrive next summer.'
        : 'Players will recover faster from now on; the development it buys will take seasons to show.',
    }])
  })

  return { success: true, facility, level: next, cost, tier: facilityTier(next) }
})
