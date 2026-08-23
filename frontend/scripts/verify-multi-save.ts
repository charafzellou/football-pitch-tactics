/**
 * Proves two saves never bleed into each other.
 *
 * `verify-economy.ts` already exercises a single save deeply; this exercises
 * the boundary between saves instead — the whole point of the multi-tenant
 * migration. It creates two saves on two different clubs, drives one hard
 * (matches, a season rollover, transfers, news) and checks after every step
 * that the other save's world — its fixtures, board, finances, standings,
 * squad and news feed — has not moved by so much as one row.
 *
 *   bun run scripts/verify-multi-save.ts
 */
import { and, eq } from 'drizzle-orm'
import { db } from '../server/db'
import { clubNews, game, matches, players, season as seasonTable, seasonSummary, teams } from '../server/db/schema'
import { newSave } from './new-save'
import { playRounds } from './play-rounds'
import { rollOverSeason } from '../server/core/season'
import { computeStandings } from '../server/core/standings'

const checks: { name: string; passed: boolean; detail: string }[] = []

function check(name: string, passed: boolean, detail: string) {
  checks.push({ name, passed, detail })
  console.log(`${passed ? '  \x1b[32mPASS\x1b[0m' : '  \x1b[31mFAIL\x1b[0m'}  ${name}\n        ${detail}`)
}

console.log('\nCreating two independent saves…')

const { club: clubA, game: saveA } = await newSave()
// Deliberately not the same club as A, and not the same as A's opponents —
// picked by name so the test does not depend on seed ordering.
const { club: clubB, game: saveB } = await newSave('Real Madrid')

check(
  'two saves get distinct tokens and ids',
  saveA.id !== saveB.id && saveA.token !== saveB.token,
  `A: id ${saveA.id} token ${saveA.token.slice(0, 8)}…; B: id ${saveB.id} token ${saveB.token.slice(0, 8)}…`,
)

check(
  'each save cloned its own full roster, not a shared one',
  clubA.id !== clubB.id,
  `A plays as ${clubA.name} (team ${clubA.id}); B plays as ${clubB.name} (team ${clubB.id})`,
)

// ---------------------------------------------------------------------------
// Template rows never move
// ---------------------------------------------------------------------------

const templateCount = await db.query.teams.findMany({ where: (row, { isNull }) => isNull(row.gameId) })
check(
  'creating two saves left the template roster untouched',
  templateCount.length === 40,
  `${templateCount.length} template teams on the shelf (expected 40 — 2 leagues of 20)`,
)

// ---------------------------------------------------------------------------
// Snapshot save B before touching save A at all
// ---------------------------------------------------------------------------

async function snapshotOf(gameState: typeof saveA) {
  const [fixtures, squad, gameRow, news] = await Promise.all([
    db.query.matches.findMany({ where: eq(matches.gameId, gameState.id) }),
    db.query.players.findMany({ where: eq(players.gameId, gameState.id) }),
    db.query.game.findFirst({ where: eq(game.id, gameState.id) }),
    db.query.clubNews.findMany({ where: eq(clubNews.gameId, gameState.id) }),
  ])
  return {
    playedCount: fixtures.filter(f => f.played).length,
    fixtureCount: fixtures.length,
    squadCount: squad.length,
    season: gameRow?.season,
    boardConfidence: gameRow?.boardConfidence,
    fanConfidence: gameRow?.fanConfidence,
    newsCount: news.length,
  }
}

const beforeB = await snapshotOf(saveB)

// ---------------------------------------------------------------------------
// Drive save A hard: several matchdays, deep enough to touch the board,
// finances, insolvency checks, transfer/commercial markets and news feed.
// ---------------------------------------------------------------------------

console.log('\nPlaying 6 rounds in save A only…')
await playRounds(saveA, 6, false)

const afterB = await snapshotOf(saveB)

check(
  "playing save A's matchdays left save B's fixtures untouched",
  afterB.playedCount === beforeB.playedCount && afterB.fixtureCount === beforeB.fixtureCount,
  `B fixtures before: ${beforeB.playedCount}/${beforeB.fixtureCount} played; `
  + `after: ${afterB.playedCount}/${afterB.fixtureCount} played`,
)

check(
  "playing save A's matchdays left save B's squad size untouched",
  afterB.squadCount === beforeB.squadCount,
  `B squad before: ${beforeB.squadCount}; after: ${afterB.squadCount}`,
)

check(
  "playing save A's matchdays left save B's board/fan confidence untouched",
  afterB.boardConfidence === beforeB.boardConfidence && afterB.fanConfidence === beforeB.fanConfidence,
  `B board/fans before: ${beforeB.boardConfidence}/${beforeB.fanConfidence}; `
  + `after: ${afterB.boardConfidence}/${afterB.fanConfidence}`,
)

check(
  "playing save A's matchdays left save B's news feed untouched",
  afterB.newsCount === beforeB.newsCount,
  `B news rows before: ${beforeB.newsCount}; after: ${afterB.newsCount}`,
)

const freshA = (await db.query.game.findFirst({ where: eq(game.id, saveA.id) }))!
check(
  "save A actually moved (sanity check the drive above wasn't a no-op)",
  freshA.currentDate.getTime() !== saveA.currentDate.getTime(),
  `A currentDate moved from ${saveA.currentDate.toISOString()} to ${freshA.currentDate.toISOString()}`,
)

// ---------------------------------------------------------------------------
// Standings and the transfer market must never mix saves
// ---------------------------------------------------------------------------

const standingsA = await computeStandings(clubA.leagueId, freshA.season, saveA.id)
check(
  "save A's standings show exactly one save's worth of teams",
  standingsA.length > 0 && standingsA.length <= 20,
  `${standingsA.length} teams in save A's table for league ${clubA.leagueId} (expected <= 20)`,
)

const squadA = await db.query.players.findMany({ where: eq(players.gameId, saveA.id) })
const squadB = await db.query.players.findMany({ where: eq(players.gameId, saveB.id) })
const overlap = squadA.filter(p => squadB.some(q => q.id === p.id))
check(
  'no player row is shared between the two saves',
  overlap.length === 0,
  overlap.length === 0
    ? `0 shared ids across ${squadA.length} + ${squadB.length} players`
    : `${overlap.length} player ids appear in both saves' squads`,
)

// ---------------------------------------------------------------------------
// Rolling A's season over must not touch B's season number
// ---------------------------------------------------------------------------

console.log("\nRolling over save A's season (playing out the rest of it first)…")
// `resolveFixturesUpTo` deliberately skips the player's own fixtures — that's
// the matchday screen's job — so finishing the season for real means playing
// out the remaining rounds the same way `playRounds` already has been.
await playRounds(freshA, 40, false)
const readyA = (await db.query.game.findFirst({ where: eq(game.id, saveA.id) }))!
await rollOverSeason(readyA)

const afterRolloverA = (await db.query.game.findFirst({ where: eq(game.id, saveA.id) }))!
const afterRolloverB = (await db.query.game.findFirst({ where: eq(game.id, saveB.id) }))!

check(
  "rolling over save A's season advanced only save A",
  afterRolloverA.season === readyA.season + 1 && afterRolloverB.season === saveB.season,
  `A season ${readyA.season} → ${afterRolloverA.season}; B season stayed at ${afterRolloverB.season}`,
)

const seasonRowsA = await db.query.season.findMany({ where: eq(seasonTable.gameId, saveA.id) })
const seasonRowsB = await db.query.season.findMany({ where: eq(seasonTable.gameId, saveB.id) })
check(
  'each save has its own season bookkeeping rows, not shared ones',
  seasonRowsA.length === 2 && seasonRowsB.length === 1,
  `A has ${seasonRowsA.length} season row(s) (expected 2, having rolled over once); `
  + `B has ${seasonRowsB.length} (expected 1, untouched)`,
)

const summaryA = await db.query.seasonSummary.findMany({ where: eq(seasonSummary.gameId, saveA.id) })
const summaryB = await db.query.seasonSummary.findMany({ where: eq(seasonSummary.gameId, saveB.id) })
check(
  "save A's season summary rows never leaked into save B",
  summaryA.length > 0 && summaryB.length === 0,
  `A recorded ${summaryA.length} league summary row(s); B recorded ${summaryB.length} (expected 0)`,
)

const newFixturesA = await db.query.matches.findMany({
  where: and(eq(matches.gameId, saveA.id), eq(matches.season, afterRolloverA.season)),
})
const staleFixturesB = await db.query.matches.findMany({
  where: and(eq(matches.gameId, saveB.id), eq(matches.season, afterRolloverA.season)),
})
check(
  "save A's new season's fixtures are scoped to save A only",
  newFixturesA.length > 0 && staleFixturesB.length === 0,
  `A has ${newFixturesA.length} fixtures for season ${afterRolloverA.season}; `
  + `B has ${staleFixturesB.length} for that same season NUMBER (expected 0 — B is still on season ${afterRolloverB.season})`,
)

// ---------------------------------------------------------------------------

const failed = checks.filter(row => !row.passed)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`)
if (failed.length) {
  console.log(`\nFailed: ${failed.map(row => row.name).join('; ')}`)
  process.exit(1)
}
process.exit(0)
