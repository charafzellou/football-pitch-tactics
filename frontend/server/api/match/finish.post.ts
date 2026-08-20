import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { game, matches, teams } from '../../db/schema'
import { syncToMinute } from '../../core/match-session'
import { settleMatchFitness } from '../../core/matchday-ai'
import { buildMatchdayContext, settleMatchFinances } from '../../core/finance'
import { settleAftermath } from '../../core/matchday'
import type { MatchState } from '#shared/match-state'
import { MATCH_MINUTES } from '#shared/match-state'

/**
 * Full time — commits the result, settles fitness, and advances the world.
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
      othersResolved: 0,
    }
  }

  const state = await syncToMinute(matchId, MATCH_MINUTES)

  // League context for gate receipts and commercial income. Built before the
  // transaction because it reads the standings, which the transaction is about
  // to change.
  const homeClub = await db.query.teams.findFirst({ where: eq(teams.id, match.homeTeamId) })
  const financeContext = homeClub
    ? await buildMatchdayContext(homeClub.leagueId, match.season, match.round)
    : null

  const advancedTo = await finalizeMatch(matchId, match, state, financeContext)

  /**
   * The rest of the matchday.
   *
   * Only the player's own fixtures used to be simulated, which left the
   * league table meaningless — every other club sat on nil. Now that the
   * calendar has moved past this round, every other fixture dated at or
   * before it is played out headlessly, so the standings the manager returns
   * to are real.
   */
  const { othersResolved, board, transfers, commercial } = await settleAftermath(advancedTo)

  return {
    finished: true,
    alreadyFinished: false,
    homeScore: state.home.score,
    awayScore: state.away.score,
    othersResolved,
    offersReceived: transfers.created,
    offersExpired: transfers.expired,
    sponsorOffersReceived: commercial.created,
    board: board
      ? {
          boardConfidence: board.boardConfidence,
          fanConfidence: board.fanConfidence,
          confidenceStreak: board.confidenceStreak,
          dismissed: board.dismissed,
        }
      : null,
  }
})

/**
 * Commits the score, clears live state, settles fitness, advances the calendar.
 * Returns the date the calendar was moved to.
 */
async function finalizeMatch(
  matchId: number,
  match: { matchDate: unknown; homeTeamId: number; awayTeamId: number },
  state: MatchState,
  financeContext: Awaited<ReturnType<typeof buildMatchdayContext>> | null,
): Promise<Date | null> {
  let advancedTo: Date | null = null

  await db.transaction(async (tx) => {
    await tx.update(matches).set({
      homeScore: state.home.score,
      awayScore: state.away.score,
      played: 1,
      state: null,
    }).where(eq(matches.id, matchId))

    // Shared with AI fixtures so both settle identically — otherwise only the
    // human's squad would ever tire, or only the human would pay wages.
    await settleMatchFitness(tx, state)

    if (financeContext)
      await settleMatchFinances(tx, match.homeTeamId, match.awayTeamId, financeContext)

    const gameState = await tx.query.game.findFirst()
    if (gameState) {
      let matchDateObj = new Date(match.matchDate as any)
      if (Number.isNaN(matchDateObj.getTime())) {
        const n = Number(match.matchDate)
        matchDateObj = Number.isNaN(n) ? new Date() : new Date(n)
      }

      advancedTo = new Date(matchDateObj.getTime() + 1000)
      await tx.update(game).set({ currentDate: advancedTo }).where(eq(game.id, gameState.id))
    }
  })

  return advancedTo
}
