import { db } from '../../../../server/db'
import { teams } from '../../../../server/db/schema'
import { requireActiveManager } from '../../../../server/core/save'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const teamId = Number(event.context.params?.id)
  const { tactics } = await readBody(event)

  await requireActiveManager()

  if (!teamId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Team ID is required',
    })
  }

  await db.update(teams).set({ tactics }).where(eq(teams.id, teamId))

  return { success: true }
})
