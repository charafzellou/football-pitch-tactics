import { db } from '../../../../server/db'
import { players, teams } from '../../../../server/db/schema'
import { requireActiveManager } from '../../../../server/core/save'
import { LINEUP_SIZE, parseLineup } from '#shared/lineup'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const teamId = Number(event.context.params?.id)
  const body = await readBody<{ lineup?: unknown }>(event)

  await requireActiveManager()

  if (!teamId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Team ID is required',
    })
  }

  const requested = parseLineup(body?.lineup)

  // Clearing the lineup hands the team back to the engine's auto-selection.
  if (!requested) {
    await db.update(teams).set({ lineup: null }).where(eq(teams.id, teamId))

    return { success: true, lineup: null }
  }

  const squad = await db.query.players.findMany({ where: and(eq(players.teamId, teamId), eq(players.retired, 0)) })
  const squadIds = new Set(squad.map(player => player.id))
  const lineup = [...new Set(requested)].filter(id => squadIds.has(id))

  if (lineup.length !== LINEUP_SIZE) {
    throw createError({
      statusCode: 400,
      statusMessage: `A lineup must contain ${LINEUP_SIZE} players from this squad`,
    })
  }

  await db.update(teams).set({ lineup: JSON.stringify(lineup) }).where(eq(teams.id, teamId))

  return { success: true, lineup }
})
