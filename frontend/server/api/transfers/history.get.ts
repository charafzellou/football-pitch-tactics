import { and, desc, eq, inArray } from 'drizzle-orm'
import { db } from '../../db'
import { financeLedger } from '../../db/schema'
import { activeSave } from '../../core/save'

/**
 * The manager's completed transfer business.
 *
 * This was a stub returning `[]` with the note "in a real application you would
 * create a transfers table". No such table is needed: every transfer now posts
 * `transfer_in` / `transfer_out` rows through the ledger, which already records
 * the fee, the matchday and a description naming the other club. Reading them
 * back is the whole feature.
 */
export default defineEventHandler(async (event) => {
  const gameState = await activeSave(event)
  if (!gameState)
    return []

  const entries = await db.query.financeLedger.findMany({
    where: and(
      eq(financeLedger.teamId, gameState.playerTeamId),
      inArray(financeLedger.type, ['transfer_in', 'transfer_out']),
    ),
    orderBy: [desc(financeLedger.season), desc(financeLedger.round), desc(financeLedger.id)],
  })

  return entries.map(entry => ({
    id: entry.id,
    season: entry.season,
    round: entry.round,
    /** `in` = a player joined, `out` = a player left. */
    direction: entry.type === 'transfer_in' ? 'in' : 'out',
    /** Always positive — `direction` carries the sign. */
    fee: Math.abs(entry.amount),
    description: entry.description,
    createdAt: entry.createdAt,
  }))
})
