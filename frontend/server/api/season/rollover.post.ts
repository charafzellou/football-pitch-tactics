import { rollOverSeason } from '../../core/season'
import { resolveFixturesUpTo } from '../../core/matchday-ai'
import { requireActiveManager } from '../../core/save'

/**
 * Ends the season and starts the next one.
 *
 * Any AI fixtures still outstanding are played out first. The player can
 * finish their own 38 games before some other club's final-round fixture has
 * come round on the calendar, and the season cannot be closed with results
 * missing.
 */
export default defineEventHandler(async (event) => {
  const gameState = await requireActiveManager(event)

  // Far-future date: resolve everything left, regardless of when it was
  // scheduled.
  await resolveFixturesUpTo(new Date(8640000000000), gameState.playerTeamId, gameState.id)

  return rollOverSeason(gameState)
})
