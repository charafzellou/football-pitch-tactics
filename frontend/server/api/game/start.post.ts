import { createSave } from '../../../server/core/save'

/**
 * Creates a save.
 *
 * This is the only place `sacking_enabled` is ever written. There is
 * deliberately no endpoint that can change it afterwards — a difficulty you can
 * switch off the moment it bites is not a difficulty — so the new-game screen
 * states the choice is permanent before the save is created.
 *
 * The work itself lives in `createSave()` so the headless drivers under
 * `scripts/` start from exactly the state this endpoint produces. When they did
 * their own, smaller reset, `verify-economy.ts` failed its ledger check against
 * rows its own previous run had left behind.
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

  return createSave({ teamId, sackingEnabled: body?.sackingEnabled })
})
