import { db } from '../db'
import { activeSave } from '../core/save'
import { recentNews } from '../core/news'
import { getSeasonStatus } from '../core/season'
import { leagueStandingFor } from '../core/finance'
import {
  SACK_STREAK,
  SACK_THRESHOLD,
  WARNING_THRESHOLD,
  describeExpectation,
} from '../core/board'

/**
 * The board's view of the manager, and the feed explaining it.
 *
 * `board.ts` has always written both — two confidence meters and a news row for
 * every movement, on the stated principle that pressure must be *explainable*.
 * Nothing read either. `recentNews()` existed with no caller, so a manager could
 * be dismissed having never seen a single warning, and the sacking itself was
 * announced only into a table with no reader.
 *
 * This is that missing read: one call serving the dashboard's confidence meters
 * and the dismissal screen's verdict.
 */
export default defineEventHandler(async () => {
  const gameState = await activeSave()
  if (!gameState)
    return null

  const status = await getSeasonStatus()
  const standing = await leagueStandingFor(
    gameState.playerTeamId,
    gameState.season,
    status?.round ?? 0,
  )

  const club = standing?.club ?? await db.query.teams.findFirst({
    where: (teams, { eq }) => eq(teams.id, gameState.playerTeamId),
  })

  const leagueSize = standing?.leagueSize ?? 20

  return {
    season: gameState.season,
    clubName: club?.name ?? null,

    boardConfidence: gameState.boardConfidence,
    fanConfidence: gameState.fanConfidence,
    confidenceStreak: gameState.confidenceStreak,

    expectation: gameState.boardExpectation,
    expectationText: describeExpectation(gameState.boardExpectation, leagueSize),
    position: standing?.position ?? null,
    leagueSize,

    sackingEnabled: gameState.sackingEnabled === 1,
    dismissed: gameState.dismissedAtSeason !== null,
    dismissedAtSeason: gameState.dismissedAtSeason,

    /** Surfaced so the UI never has to hardcode the numbers it warns against. */
    warningThreshold: WARNING_THRESHOLD,
    sackThreshold: SACK_THRESHOLD,
    sackStreak: SACK_STREAK,

    news: await recentNews(30),
  }
})
