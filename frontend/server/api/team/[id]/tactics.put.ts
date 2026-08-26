import { db } from '../../../../server/db'
import { teams } from '../../../../server/db/schema'
import { requireActiveManager } from '../../../../server/core/save'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const teamId = Number(event.context.params?.id)
  const { tactics } = await readBody(event)

  const gameState = await requireActiveManager(event)

  if (!teamId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Team ID is required',
    })
  }

  if (gameState.playerTeamId !== teamId) {
    throw createError({ statusCode: 403, statusMessage: 'You do not manage that club' })
  }

  await db.update(teams).set({ tactics }).where(eq(teams.id, teamId))

  return { success: true }
})
