/**
 * Headless season driver, used to verify the economy end to end.
 *
 * Plays every fixture including the manager's own — `resolveFixturesUpTo`
 * deliberately skips theirs, so this stands in for the matchday screen.
 *
 * Takes the save to play as a parameter throughout, the same way every route
 * handler now does, rather than resolving `db.query.game.findFirst()` itself —
 * `verify-economy.ts` creates several saves in one run (the main season, then
 * a fresh one each for the debt and insolvency checks), and "whichever game
 * row happens to be first" would silently drive the wrong one the moment more
 * than one existed at once.
 */
import { and, eq, or } from 'drizzle-orm'
import { db } from '../server/db'
import { game, matches, teams } from '../server/db/schema'
import type { GameRow } from '../server/core/save'
import { buildTeam, insertEvents } from '../server/core/match-session'
import { kickOff, simulateSegment } from '../server/core/match-engine'
import { resolveFixturesUpTo, settleMatchFitness } from '../server/core/matchday-ai'
import { buildMatchdayContext, settleMatchFinances } from '../server/core/finance'
import { settleAftermath } from '../server/core/matchday'
import { MATCH_MINUTES } from '../shared/match-state'

export async function playPlayerFixture(fixtureId: number, gameState: GameRow) {
  const fixture = await db.query.matches.findFirst({
    where: and(eq(matches.id, fixtureId), eq(matches.gameId, gameState.id)),
  })
  if (!fixture) return

  const homeRow = await db.query.teams.findFirst({ where: eq(teams.id, fixture.homeTeamId) })
  const awayRow = await db.query.teams.findFirst({ where: eq(teams.id, fixture.awayTeamId) })
  if (!homeRow || !awayRow) return

  const home = await buildTeam(fixture.homeTeamId, homeRow.tactics, gameState.playerTeamId, null)
  const away = await buildTeam(fixture.awayTeamId, awayRow.tactics, gameState.playerTeamId, null)

  const { state, events } = simulateSegment(home, away, kickOff(home, away), MATCH_MINUTES)
  await insertEvents(fixture.id, events)

  const context = await buildMatchdayContext(homeRow.leagueId, fixture.season, fixture.round, gameState.id)

  await db.transaction(async (tx) => {
    await tx.update(matches).set({
      homeScore: state.home.score,
      awayScore: state.away.score,
      played: 1,
      state: null,
    }).where(eq(matches.id, fixture.id))

    await settleMatchFitness(tx, state)
    await settleMatchFinances(tx, fixture.homeTeamId, fixture.awayTeamId, context)

    await tx.update(game)
      .set({ currentDate: new Date(new Date(fixture.matchDate as any).getTime() + 1000) })
      .where(eq(game.id, gameState.id))
  })
}

/** Plays one full season, matchday by matchday, exactly as the app would. */
export async function playSeason(gameState: GameRow, log = false) {
  for (;;) {
    const current = await db.query.game.findFirst({ where: eq(game.id, gameState.id) })
    if (!current) throw new Error('no save')

    const next = await db.query.matches.findFirst({
      where: and(
        eq(matches.gameId, current.id),
        eq(matches.season, current.season),
        eq(matches.played, 0),
        or(eq(matches.homeTeamId, current.playerTeamId), eq(matches.awayTeamId, current.playerTeamId)),
      ),
      orderBy: (row, { asc }) => [asc(row.matchDate)],
    })

    if (!next) break

    // Everything scheduled before the manager's fixture happens first.
    await resolveFixturesUpTo(new Date(new Date(next.matchDate as any).getTime() - 1000), current.playerTeamId, current.id)
    await playPlayerFixture(next.id, current)

    // The same aftermath the matchday screen triggers, so a headless season
    // exercises the world the manager would actually be handed.
    const after = await db.query.game.findFirst({ where: eq(game.id, current.id) })
    const { board } = await settleAftermath(after?.currentDate ?? null, after ?? current)
    if (log && board) console.log(`  R${next.round} board ${board.boardConfidence} fans ${board.fanConfidence} streak ${board.confidenceStreak}${board.dismissed ? ' DISMISSED' : ''}`)
    if (board?.dismissed) return { dismissed: true }
  }

  // Any AI fixture dated after the manager's last one.
  const finalState = await db.query.game.findFirst({ where: eq(game.id, gameState.id) })
  if (finalState) await resolveFixturesUpTo(new Date(8640000000000), finalState.playerTeamId, finalState.id)

  return { dismissed: false }
}
