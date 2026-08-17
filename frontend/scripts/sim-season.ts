/**
 * Headless season driver, used to verify the economy end to end.
 *
 * Plays every fixture including the manager's own — `resolveFixturesUpTo`
 * deliberately skips theirs, so this stands in for the matchday screen.
 */
import { and, eq, lte, ne, or } from 'drizzle-orm'
import { db } from '../server/db'
import { game, matches, teams } from '../server/db/schema'
import { buildTeam, insertEvents } from '../server/core/match-session'
import { kickOff, simulateSegment } from '../server/core/match-engine'
import { resolveFixturesUpTo, settleMatchFitness } from '../server/core/matchday-ai'
import { buildMatchdayContext, settleMatchFinances } from '../server/core/finance'
import { settleBoardForMatchday } from '../server/core/board'
import { MATCH_MINUTES } from '../shared/match-state'

export async function playPlayerFixture(fixtureId: number) {
  const fixture = await db.query.matches.findFirst({ where: eq(matches.id, fixtureId) })
  if (!fixture) return

  const gameState = await db.query.game.findFirst()
  if (!gameState) return

  const homeRow = await db.query.teams.findFirst({ where: eq(teams.id, fixture.homeTeamId) })
  const awayRow = await db.query.teams.findFirst({ where: eq(teams.id, fixture.awayTeamId) })
  if (!homeRow || !awayRow) return

  const home = await buildTeam(fixture.homeTeamId, homeRow.tactics, gameState.playerTeamId, null)
  const away = await buildTeam(fixture.awayTeamId, awayRow.tactics, gameState.playerTeamId, null)

  const { state, events } = simulateSegment(home, away, kickOff(home, away), MATCH_MINUTES)
  await insertEvents(fixture.id, events)

  const context = await buildMatchdayContext(homeRow.leagueId, fixture.season, fixture.round)

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
export async function playSeason(log = false) {
  for (;;) {
    const gameState = await db.query.game.findFirst()
    if (!gameState) throw new Error('no save')

    const next = await db.query.matches.findFirst({
      where: and(
        eq(matches.season, gameState.season),
        eq(matches.played, 0),
        or(eq(matches.homeTeamId, gameState.playerTeamId), eq(matches.awayTeamId, gameState.playerTeamId)),
      ),
      orderBy: (row, { asc }) => [asc(row.matchDate)],
    })

    if (!next) break

    // Everything scheduled before the manager's fixture happens first.
    await resolveFixturesUpTo(new Date(new Date(next.matchDate as any).getTime() - 1000), gameState.playerTeamId)
    await playPlayerFixture(next.id)

    const after = await db.query.game.findFirst()
    if (after) await resolveFixturesUpTo(after.currentDate, after.playerTeamId)

    const board = await settleBoardForMatchday()
    if (log && board) console.log(`  R${next.round} board ${board.boardConfidence} fans ${board.fanConfidence} streak ${board.confidenceStreak}${board.dismissed ? ' DISMISSED' : ''}`)
    if (board?.dismissed) return { dismissed: true }
  }

  // Any AI fixture dated after the manager's last one.
  const gameState = await db.query.game.findFirst()
  if (gameState) await resolveFixturesUpTo(new Date(8640000000000), gameState.playerTeamId)

  return { dismissed: false }
}
