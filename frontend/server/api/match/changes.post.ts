import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { matches } from '../../db/schema'
import { insertEvents, syncToMinute } from '../../core/match-session'
import { requireActiveManager } from '../../core/save'
import { TACTICS } from '../../core/tactics'
import type { SubstitutionRequest } from '#shared/match-state'
import { applyMidMatchChanges } from '#shared/match-state'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    matchId?: number | string
    atMinute?: number
    substitutions?: SubstitutionRequest[]
    tactic?: string
  }>(event)

  const matchId = Number(body?.matchId)
  const atMinute = Number(body?.atMinute ?? 0)
  const substitutions = body?.substitutions ?? []

  if (!matchId) {
    throw createError({ statusCode: 400, statusMessage: 'matchId is required' })
  }

  const gameState = await requireActiveManager(event)

  const match = await db.query.matches.findFirst({
    where: and(eq(matches.id, matchId), eq(matches.gameId, gameState.id)),
  })
  if (!match) {
    throw createError({ statusCode: 404, statusMessage: 'Match not found' })
  }

  // Only the player's own team can be managed mid-match — the CPU side
  // manages itself inside the engine.
  const playerTeamId = gameState.playerTeamId
  if (match.homeTeamId !== playerTeamId && match.awayTeamId !== playerTeamId) {
    throw createError({ statusCode: 403, statusMessage: 'You do not manage either team in this match' })
  }

  if (body?.tactic && !TACTICS.some(t => t.name === body.tactic)) {
    throw createError({ statusCode: 400, statusMessage: `Unknown tactic: ${body.tactic}` })
  }

  const state = await syncToMinute(matchId, atMinute)

  // Validation lives inside `applyMidMatchChanges`, which folds each swap in
  // before checking the next one. Pre-validating the whole batch against a
  // single frozen snapshot here (as this used to) rejects legitimate chained
  // substitutions — bringing a player on and then taking them off again
  // reads as "that player is not on the pitch" — and conversely lets a batch
  // exceed MAX_SUBSTITUTIONS, since `subsUsed` never advanced between checks.
  let updated
  try {
    updated = applyMidMatchChanges(state, playerTeamId, substitutions, body?.tactic)
  }
  catch (error) {
    throw createError({ statusCode: 400, statusMessage: error instanceof Error ? error.message : 'Invalid substitution' })
  }

  await db.update(matches).set({ state: JSON.stringify(updated) }).where(eq(matches.id, matchId))

  // Record each substitution as a real event so it shows up in the live feed
  // and in match history, not just as a change to the state snapshot.
  const events = substitutions.map(request => ({
    minute: atMinute,
    eventType: 'substitution',
    teamId: playerTeamId,
    playerId: request.playerInId,
    relatedPlayerId: request.playerOutId,
  }))
  await insertEvents(matchId, events)

  return { state: updated, events }
})
