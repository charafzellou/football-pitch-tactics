import { requireActiveManager } from '../../core/save'
import { resolveOffer } from '../../core/market'
import { getSeasonStatus } from '../../core/season'

/**
 * Accepts or rejects a bid for one of the manager's players.
 *
 * Accepting settles through the same `settleTransfer()` a manual sale uses, so
 * the ledger entries, the fan reaction and the news item are identical however
 * the player left.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ offerId?: number; action?: string }>(event)
  const offerId = Number(body?.offerId)
  const action = body?.action

  if (!offerId || (action !== 'accept' && action !== 'reject')) {
    throw createError({ statusCode: 400, statusMessage: 'offerId and a valid action are required' })
  }

  const gameState = await requireActiveManager()
  const status = await getSeasonStatus()

  const outcome = await resolveOffer({
    offerId,
    teamId: gameState.playerTeamId,
    accept: action === 'accept',
    season: gameState.season,
    round: status?.round ?? 0,
  })

  if (!outcome)
    return { success: true, accepted: false }

  return {
    success: true,
    accepted: true,
    playerName: outcome.playerName,
    buyerTeam: outcome.toTeamName,
    fee: outcome.fee,
    fanConfidence: outcome.fanConfidence,
  }
})
