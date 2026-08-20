/**
 * What happens to the rest of the world once the manager's match is over.
 *
 * Full time is not just a result: every other fixture in the round is played,
 * the board and the support pass judgement on where that left the club, and both
 * markets — players and partners — take their turn. The order matters and is
 * the reason this is one function rather than four calls at each call site.
 *
 * It exists because it was four calls at each call site. `POST /api/match/finish`
 * had them and `scripts/play-rounds.ts` had a copy that had already fallen a
 * step behind — it never ran the commercial market, so a headless run produced a
 * club nobody ever offered a sponsorship to, and the feature looked broken when
 * it was the harness that was.
 */
import { db } from '../db'
import { settleBoardForMatchday } from './board'
import { settleInsolvency } from './insolvency'
import { runTransferMarket } from './market'
import { runCommercialMarket } from './sponsors'
import { runStadiumDiary } from './stadium'
import { resolveFixturesUpTo } from './matchday-ai'
import { getSeasonStatus } from './season'
import type { BoardState } from './board'
import type { InsolvencyState } from './insolvency'

export interface Aftermath {
  othersResolved: number
  board: BoardState | null
  transfers: { expired: number; created: number }
  commercial: { expired: number; created: number }
  stadium: { held: number; expired: number; offered: number }
  insolvency: InsolvencyState | null
}

export async function settleAftermath(advancedTo: Date | null): Promise<Aftermath> {
  const result: Aftermath = {
    othersResolved: 0,
    board: null,
    transfers: { expired: 0, created: 0 },
    commercial: { expired: 0, created: 0 },
    stadium: { held: 0, expired: 0, offered: 0 },
    insolvency: null,
  }

  /**
   * Every other fixture dated at or before the new cursor, first.
   *
   * Without this the manager's result was the round's only result and the table
   * was meaningless — every other club sat on nil.
   */
  const gameState = await db.query.game.findFirst()
  if (gameState && advancedTo)
    result.othersResolved = (await resolveFixturesUpTo(advancedTo, gameState.playerTeamId)).resolved

  // The board and the support judge the manager on where the round left them,
  // which is only knowable once every other result is in.
  result.board = await settleBoardForMatchday()

  if (!gameState || result.board?.dismissed)
    return result

  const status = await getSeasonStatus()
  const round = status?.round ?? 0

  /**
   * Solvency, before either market opens.
   *
   * The embargo has to be in place before offers are generated, or the manager
   * spends a matchday looking at bids the club is not allowed to accept.
   */
  result.insolvency = await settleInsolvency({ season: gameState.season, round })

  result.transfers = await runTransferMarket(gameState.season, round)

  // Partners come forward for slots that are unsold or in their final season,
  // priced off the confidence figure the board settlement has just written.
  result.commercial = await runCommercialMarket({
    teamId: gameState.playerTeamId,
    season: gameState.season,
    round,
    fanConfidence: result.board?.fanConfidence ?? gameState.fanConfidence,
  })

  // The ground's own week: anything booked for this round happens, the pitch
  // recovers a little, and a promoter may call about a week still free.
  result.stadium = await runStadiumDiary({
    gameId: gameState.id,
    teamId: gameState.playerTeamId,
    season: gameState.season,
    round,
    totalRounds: status?.totalRounds ?? 38,
    fanConfidence: result.board?.fanConfidence ?? gameState.fanConfidence,
  })

  return result
}
