/**
 * Plays N matchdays headlessly, so a change can be looked at against a season
 * in progress rather than an empty ledger.
 *
 *   bun run scripts/play-rounds.ts 6
 *
 * Takes the save to play as a parameter, the same reason `sim-season.ts` does
 * — verification runs create more than one save in a single process.
 */
import { eq } from 'drizzle-orm'
import { db } from '../server/db'
import { game } from '../server/db/schema'
import type { GameRow } from '../server/core/save'
import { resolveFixturesUpTo } from '../server/core/matchday-ai'
import { settleAftermath } from '../server/core/matchday'
import { playPlayerFixture } from './sim-season'

export async function playRounds(gameState: GameRow, count: number, log = true) {
  for (let played = 0; played < count; played++) {
    const state = await db.query.game.findFirst({ where: eq(game.id, gameState.id) })
    if (!state || state.dismissedAtSeason !== null) break

    const next = await db.query.matches.findFirst({
      where: (m, { and, eq: is, or }) => and(
        is(m.gameId, state.id),
        is(m.season, state.season),
        is(m.played, 0),
        or(is(m.homeTeamId, state.playerTeamId), is(m.awayTeamId, state.playerTeamId)),
      ),
      orderBy: (m, { asc }) => [asc(m.matchDate)],
    })
    if (!next) break

    await resolveFixturesUpTo(new Date(new Date(next.matchDate as any).getTime() - 1000), state.playerTeamId, state.id)
    await playPlayerFixture(next.id, state)

    // Exactly what `POST /api/match/finish` does after full time, by calling
    // the same function rather than a copy of it.
    const after = await db.query.game.findFirst({ where: eq(game.id, state.id) })
    const { board } = await settleAftermath(after?.currentDate ?? null, after ?? state)

    if (log) console.log(`  R${next.round} board ${board?.boardConfidence} fans ${board?.fanConfidence}`)
  }
}

if (import.meta.main) {
  // CLI usage acts on the most recently created save — the one a prior
  // `bun run scripts/new-save.ts` just made — not a fresh one, so this can
  // be run against a season already in progress.
  const latest = await db.query.game.findFirst({ orderBy: (row, { desc }) => [desc(row.id)] })
  if (!latest) throw new Error('No save exists — run scripts/new-save.ts first')

  await playRounds(latest, Number(process.argv[2] ?? 5))
  process.exit(0)
}
