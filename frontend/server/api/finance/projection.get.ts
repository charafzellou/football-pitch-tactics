import { forecastForSave } from '../../core/finance'
import { activeSave } from '../../core/save'

/**
 * The next four seasons, and what they say the club can afford.
 *
 * Separate from `GET /api/finance/summary` because it answers a genuinely
 * different question — that one reports what happened, this one models what has
 * not. The work itself is `forecastForSave()` so the verification harness can
 * measure the very forecast the manager is shown.
 */
export default defineEventHandler(async (event) => {
  const gameState = await activeSave(event)
  if (!gameState) return null

  return forecastForSave(gameState)
})
