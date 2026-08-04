import { db } from '../../../server/db'
import { players, teams } from '../../../server/db/schema'
import { TACTICS } from '../../../server/core/tactics'
import { DEFAULT_TACTIC_NAME, parseLineup, resolveLineup } from '#shared/lineup'
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

  if (!team) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Team not found',
    })
  }

  const squad = await db.query.players.findMany({
    where: eq(players.teamId, teamId),
  })

  // CPU clubs never pick a tactic, so fall back to the default formation.
  const tactic = TACTICS.find(t => t.name === team.tactics)
    ?? TACTICS.find(t => t.name === DEFAULT_TACTIC_NAME)
    ?? TACTICS[0]

  const savedLineup = parseLineup(team.lineup)
  const { starters, bench, autoSelected } = resolveLineup(squad, tactic?.formation, savedLineup)

  return {
    ...team,
    squad,
    formation: tactic?.formation ?? null,
    /** The XI persisted for this team, or null when none was ever saved. */
    lineup: savedLineup,
    /** The XI that will actually take the field — resolved the same way the engine does. */
    startingXi: starters.map(player => player.id),
    bench: bench.map(player => player.id),
    lineupAutoSelected: autoSelected,
  }
})
