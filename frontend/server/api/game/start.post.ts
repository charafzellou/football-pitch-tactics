import { SAVE_COOKIE_NAME } from '../../middleware/save-context'
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
 *
 * The response also sets the `fpt_save` cookie to this save's token — an
 * anonymous UUID, no login involved — which is how every future request from
 * this browser resolves back to this exact save rather than someone else's.
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

  const created = await createSave({ teamId, sackingEnabled: body?.sackingEnabled })

  setCookie(event, SAVE_COOKIE_NAME, created.token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    // 180 days — long enough that an occasional player doesn't lose their
    // save between sessions, short enough that an abandoned save doesn't
    // linger forever with no cleanup story.
    maxAge: 60 * 60 * 24 * 180,
  })

  return created
})
