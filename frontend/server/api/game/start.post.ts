import { eq } from 'drizzle-orm'
import { db } from '../../../server/db'
import { clubNews, game, teams, transferOffers } from '../../../server/db/schema'
import { expectationFor } from '../../../server/core/board'
import { computeStandings } from '../../../server/core/standings'

/**
 * Creates a save.
 *
 * This is the only place `sacking_enabled` is ever written. There is
 * deliberately no endpoint that can change it afterwards — a difficulty you can
 * switch off the moment it bites is not a difficulty — so the new-game screen
 * states the choice is permanent before the save is created.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ teamId?: number; sackingEnabled?: boolean }>(event)
  const teamId = Number(body?.teamId)

  if (!teamId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Team ID is required',
    })
  }

  const club = await db.query.teams.findFirst({ where: eq(teams.id, teamId) })
  if (!club) {
    throw createError({ statusCode: 404, statusMessage: 'Club not found' })
  }

  // The board's opening target comes from the club's standing. Season 1 has no
  // previous finish to temper it with, so reputation alone sets the bar.
  const table = await computeStandings(club.leagueId, 1)
  const boardExpectation = expectationFor(club.reputation, null, table.length || 20)

  await db.delete(game)
  // Board reactions and bids belong to the manager who received them.
  await db.delete(clubNews)
  await db.delete(transferOffers)

  const newGame = await db
    .insert(game)
    .values({
      playerTeamId: teamId,
      season: 1,
      currentDate: new Date(),
      sackingEnabled: body?.sackingEnabled ? 1 : 0,
      boardExpectation,
    })
    .returning()

  return newGame[0]
})
