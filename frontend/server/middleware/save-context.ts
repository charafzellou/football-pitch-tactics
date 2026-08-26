/**
 * Resolves "which save is this request for" once per request, from the
 * `fpt_save` cookie, and stores it on `event.context` for every downstream
 * handler.
 *
 * This alone fixes nothing — it just makes the answer available. The actual
 * scoping happens in `server/core/save.ts`'s `activeSave`/`requireSave`/
 * `requireActiveManager`, which read `event.context.gameId` instead of
 * `db.query.game.findFirst()` grabbing whichever row happens to be first.
 *
 * No cookie present (a first-time visitor, or a save that was never
 * created) leaves `gameId` null, which is exactly what "no save exists yet"
 * already meant everywhere in this codebase before saves were multi-tenant.
 */
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { game } from '../db/schema'

export const SAVE_COOKIE_NAME = 'fpt_save'

declare module 'h3' {
  interface H3EventContext {
    /** The `fpt_save` cookie's raw value, or null if absent. */
    saveToken: string | null
    /** The `game.id` that token resolves to, or null if absent/unknown. */
    gameId: number | null
  }
}

export default defineEventHandler(async (event) => {
  const token = getCookie(event, SAVE_COOKIE_NAME)
  event.context.saveToken = token ?? null
  event.context.gameId = null

  if (!token)
    return

  const row = await db.query.game.findFirst({ where: eq(game.token, token), columns: { id: true } })
  event.context.gameId = row?.id ?? null
})
