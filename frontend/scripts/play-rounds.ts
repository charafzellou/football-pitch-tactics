/**
 * Plays N matchdays headlessly, so a change can be looked at against a season
 * in progress rather than an empty ledger.
 *
 *   bun run scripts/play-rounds.ts 6
 */
import { db } from '../server/db'
import { resolveFixturesUpTo } from '../server/core/matchday-ai'
import { settleAftermath } from '../server/core/matchday'
import { playPlayerFixture } from './sim-season'

export async function playRounds(count: number, log = true) {
  for (let played = 0; played < count; played++) {
    const state = await db.query.game.findFirst()
    if (!state || state.dismissedAtSeason !== null) break

    const next = await db.query.matches.findFirst({
      where: (m, { and, eq, or }) => and(
        eq(m.season, state.season),
        eq(m.played, 0),
        or(eq(m.homeTeamId, state.playerTeamId), eq(m.awayTeamId, state.playerTeamId)),
      ),
      orderBy: (m, { asc }) => [asc(m.matchDate)],
    })
    if (!next) break

    await resolveFixturesUpTo(new Date(new Date(next.matchDate as any).getTime() - 1000), state.playerTeamId)
    await playPlayerFixture(next.id)

    // Exactly what `POST /api/match/finish` does after full time, by calling
    // the same function rather than a copy of it.
    const after = await db.query.game.findFirst()
    const { board } = await settleAftermath(after?.currentDate ?? null)

    if (log) console.log(`  R${next.round} board ${board?.boardConfidence} fans ${board?.fanConfidence}`)
  }
}

if (import.meta.main) {
  await playRounds(Number(process.argv[2] ?? 5))
  process.exit(0)
}
