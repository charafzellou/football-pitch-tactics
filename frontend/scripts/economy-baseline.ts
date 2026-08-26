/**
 * Records what the economy currently produces, so a change to it can be proven
 * neutral rather than merely believed to be.
 *
 * Seeds a fresh world, starts a save, plays a full season headlessly and writes
 * per-club season totals to `scripts/baseline.json`. `verify-economy.ts` reads
 * that file back and fails if the median club's net has moved.
 */
import { writeFileSync } from 'fs'
import { join } from 'path'
import { eq, and, inArray } from 'drizzle-orm'
import { db } from '../server/db'
import { financeLedger, game, season, teams } from '../server/db/schema'
import { playSeason } from './sim-season'
import { rollOverSeason } from '../server/core/season'

export interface ClubBaseline {
  teamId: number
  name: string
  reputation: number
  capacity: number
  income: number
  expenses: number
  net: number
  wages: number
  wageRatio: number | null
}

export interface Baseline {
  capturedAt: string
  season: number
  clubs: ClubBaseline[]
  medianNet: number
  medianWageRatio: number
}

export function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/**
 * Season totals per club, straight from the ledger, for one save.
 *
 * `gameId` scoping matters here in a way it doesn't everywhere else: neither
 * `teams.id` nor `financeLedger.season` is globally unique on its own once
 * more than one save exists — a bare `eq(financeLedger.season, forSeason)`
 * would fold every save's season-N ledger rows onto whichever save's `teams`
 * happened to share those ids, corrupting the medians this whole script
 * exists to measure.
 */
export async function clubTotals(forSeason: number, gameId: number): Promise<ClubBaseline[]> {
  const clubs = await db.query.teams.findMany({ where: eq(teams.gameId, gameId) })
  const rows = clubs.length
    ? await db.query.financeLedger.findMany({
        where: and(eq(financeLedger.season, forSeason), inArray(financeLedger.teamId, clubs.map(club => club.id))),
      })
    : []

  const byTeam = new Map<number, { income: number; expenses: number; wages: number }>()
  for (const row of rows) {
    const bucket = byTeam.get(row.teamId) ?? { income: 0, expenses: 0, wages: 0 }
    if (row.amount >= 0) bucket.income += row.amount
    else bucket.expenses += -row.amount
    if (row.type === 'wages') bucket.wages += -row.amount
    byTeam.set(row.teamId, bucket)
  }

  return clubs.map((club) => {
    const bucket = byTeam.get(club.id) ?? { income: 0, expenses: 0, wages: 0 }
    return {
      teamId: club.id,
      name: club.name,
      reputation: club.reputation,
      capacity: club.stadiumCapacity,
      income: bucket.income,
      expenses: bucket.expenses,
      net: bucket.income - bucket.expenses,
      wages: bucket.wages,
      wageRatio: bucket.income > 0 ? Math.round((bucket.wages / bucket.income) * 100) : null,
    }
  })
}

if (import.meta.main) {
  const gameState = await db.query.game.findFirst({ orderBy: (row, { desc }) => [desc(row.id)] })
  if (!gameState) throw new Error('No save — run `bun run db:seed` then start a game first.')

  console.log(`Playing season ${gameState.season} headlessly…`)
  await playSeason(gameState)

  // Prize money is the largest single credit a club takes and it only lands at
  // the rollover, so totals stopped at round 38 read a wage ratio ~20 points
  // above the truth. Roll over before measuring.
  const played = gameState.season
  await rollOverSeason(gameState)

  const clubs = await clubTotals(played, gameState.id)
  const baseline: Baseline = {
    capturedAt: new Date().toISOString(),
    season: played,
    clubs,
    medianNet: median(clubs.map(c => c.net)),
    medianWageRatio: median(clubs.map(c => c.wageRatio ?? 0)),
  }

  writeFileSync(join(import.meta.dir, 'baseline.json'), JSON.stringify(baseline, null, 2))
  console.log(`\nCaptured ${clubs.length} clubs.`)
  console.log(`  median net        ${Math.round(baseline.medianNet).toLocaleString('en-IE')}`)
  console.log(`  median wage ratio ${baseline.medianWageRatio}%`)
}
