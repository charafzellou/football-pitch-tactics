import { db } from '../../../server/db'
import { players, teams } from '../../../server/db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const teamId = Number(event.context.params?.id)
  if (!teamId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Team ID is required',
    })
  }

  const team = await db.query.teams.findFirst({
    where: eq(teams.id, teamId),
  })

  const squad = await db.query.players.findMany({
    where: eq(players.teamId, teamId),
  })

  return {
    ...team,
    squad,
  }
})
