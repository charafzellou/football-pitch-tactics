import { db } from '../../../server/db'
import { players, teams } from '../../../server/db/schema'
import { TACTICS } from '../../../server/core/tactics'
import { activeSave } from '../../../server/core/save'
import { DEFAULT_TACTIC_NAME, parseLineup, resolveLineup } from '#shared/lineup'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const teamId = Number(event.context.params?.id)
  if (!teamId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Team ID is required',
    })
  }

  const gameState = await activeSave(event)
  if (!gameState) {
    throw createError({ statusCode: 404, statusMessage: 'Game not found' })
  }

  // Scouting other clubs in your own save is allowed (it's how the manager
  // reads an opponent's squad before a match); another save's club is not —
  // team ids are a single global sequence, so an unscoped lookup here would
  // let one save's browser read straight into another save's world.
  const team = await db.query.teams.findFirst({
    where: and(eq(teams.id, teamId), eq(teams.gameId, gameState.id)),
  })

  if (!team) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Team not found',
    })
  }

  // Retired players are kept so `match_events` keeps resolving, and released
  // players keep pointing at the club that let them go, but neither is part of
  // the squad any more.
  const squad = await db.query.players.findMany({
    where: and(eq(players.teamId, teamId), eq(players.retired, 0), eq(players.freeAgent, 0)),
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
