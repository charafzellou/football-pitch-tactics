import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { game, matches, players } from '../../db/schema'
import { syncToMinute } from '../../core/match-session'
import type { MatchState } from '#shared/match-state'
import {
  INJURY_MATCHES_MAX,
  INJURY_MATCHES_MIN,
  MATCH_MINUTES,
  recoveredStamina,
} from '#shared/match-state'

/**
 * Full time — commits the result and settles fitness.
 *
 * This is deliberately its own route rather than something `advance` does
 * when its segment happens to reach minute 90. The second-half segment is
 * simulated the moment the manager leaves half time, roughly 45 real
 * seconds before the clock actually gets there, and until it does the
 * manager can still pause and substitute — which rewinds and re-simulates
 * the rest. Finalising at simulation time would null `matches.state` for
 * that whole stretch, so every mid-second-half pause failed with
 * "Match has not started".
 *
 * Same rule as `advance`'s refusal to persist its own segment state: nothing
 * about a match becomes official until the clock the player is watching has
 * actually reached it.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ matchId?: number | string }>(event)
  const matchId = Number(body?.matchId)

  if (!matchId) {
    throw createError({ statusCode: 400, statusMessage: 'matchId is required' })
  }

  const match = await db.query.matches.findFirst({ where: eq(matches.id, matchId) })
  if (!match) {
    throw createError({ statusCode: 404, statusMessage: 'Match not found' })
  }

  // Idempotent: a refresh at 90' resumes into an already-finalised match and
  // will call this again. That's a no-op, not an error.
  if (match.played === 1 && !match.state) {
    return {
      finished: true,
      alreadyFinished: true,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
    }
  }

  const state = await syncToMinute(matchId, MATCH_MINUTES)
  await finalizeMatch(matchId, match, state)

  return {
    finished: true,
    alreadyFinished: false,
    homeScore: state.home.score,
    awayScore: state.away.score,
  }
})

/** Commits the score, clears live state, settles fitness, advances the calendar. */
async function finalizeMatch(matchId: number, match: { matchDate: unknown }, state: MatchState) {
  await db.transaction(async (tx) => {
    await tx.update(matches).set({
      homeScore: state.home.score,
      awayScore: state.away.score,
      played: 1,
      state: null,
    }).where(eq(matches.id, matchId))

    for (const side of [state.home, state.away]) {
      const newlyInjured = new Set(side.injured)

      for (const [rawId, stamina] of Object.entries(side.stamina)) {
        const playerId = Number(rawId)
        const current = await tx.query.players.findFirst({ where: eq(players.id, playerId) })
        if (!current)
          continue

        // A player already sitting out counts this match against their
        // absence; a fresh injury starts a new one.
        const injuredMatches = newlyInjured.has(playerId)
          ? INJURY_MATCHES_MIN + Math.floor(Math.random() * (INJURY_MATCHES_MAX - INJURY_MATCHES_MIN + 1))
          : Math.max(0, (current.injuredMatches ?? 0) - 1)

        // `players.stamina` is written as the value the player will *start*
        // their next match with, so the lineup builder shows the truth
        // rather than a pre-recovery number the engine would silently
        // improve at kickoff. Players out injured recover too.
        await tx.update(players)
          .set({ stamina: Math.round(recoveredStamina(stamina)), injuredMatches })
          .where(eq(players.id, playerId))
      }
    }

    const gameState = await tx.query.game.findFirst()
    if (gameState) {
      let matchDateObj = new Date(match.matchDate as any)
      if (Number.isNaN(matchDateObj.getTime())) {
        const n = Number(match.matchDate)
        matchDateObj = Number.isNaN(n) ? new Date() : new Date(n)
      }
      await tx.update(game).set({ currentDate: new Date(matchDateObj.getTime() + 1000) }).where(eq(game.id, gameState.id))
    }
  })
}
