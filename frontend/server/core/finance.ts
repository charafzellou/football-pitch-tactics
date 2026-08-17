/**
 * Moving money.
 *
 * Every credit and debit goes through here and lands in `finance_ledger`, so a
 * club's balance is always explainable rather than merely asserted — and a
 * verification pass can prove balance equals starting balance plus the sum of
 * its entries, which is what catches money being quietly created or destroyed.
 *
 * Charged for **every** club, not just the player's. If AI clubs paid no wages
 * the human would be competing against sides with no costs at all.
 */
import { eq, inArray } from 'drizzle-orm'
import { db } from '../db'
import { financeLedger, players, teams } from '../db/schema'
import {
  attendanceFor,
  formRatingFrom,
  gateReceiptsFor,
  prizeMoneyFor,
  sponsorshipFor,
} from './economy'
import type { LedgerType } from './economy'
import { recentForm } from './results-server'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export interface LedgerEntry {
  teamId: number
  season: number
  round: number
  type: LedgerType
  amount: number
  description: string
}

/**
 * Applies entries to balances and records them.
 *
 * Balance movement and ledger row are written together, deliberately — they are
 * the same fact, and letting them diverge would make the ledger a lie.
 */
export async function postLedger(tx: Tx, entries: LedgerEntry[]): Promise<void> {
  if (!entries.length) return

  const now = new Date()

  await tx.insert(financeLedger).values(entries.map(entry => ({
    teamId: entry.teamId,
    season: entry.season,
    round: entry.round,
    type: entry.type,
    amount: entry.amount,
    description: entry.description,
    createdAt: now,
  })))

  // Net per club so a club with several entries takes one write.
  const netByTeam = new Map<number, number>()
  for (const entry of entries)
    netByTeam.set(entry.teamId, (netByTeam.get(entry.teamId) ?? 0) + entry.amount)

  const affected = await tx.query.teams.findMany({ where: inArray(teams.id, [...netByTeam.keys()]) })
  for (const team of affected) {
    const delta = netByTeam.get(team.id) ?? 0
    if (!delta) continue

    await tx.update(teams)
      .set({ bankBalance: team.bankBalance + delta })
      .where(eq(teams.id, team.id))
  }
}

export interface MatchdayContext {
  season: number
  round: number
  leagueSize: number
  /** Team id → current league position. */
  positionByTeam: Map<number, number>
  /** Team id → recent W/D/L, newest last. */
  formByTeam: Map<number, ('W' | 'D' | 'L')[]>
}

export interface MatchFinanceResult {
  attendance: number
  gate: number
  entries: LedgerEntry[]
}

/**
 * One match's money: wages for both clubs, gate receipts for the home club,
 * commercial income for both.
 *
 * Wages are charged per match rather than per calendar week because a matchday
 * is the only cadence the game's clock actually has.
 */
export async function settleMatchFinances(
  tx: Tx,
  homeTeamId: number,
  awayTeamId: number,
  context: MatchdayContext,
): Promise<MatchFinanceResult> {
  const [home, away] = await Promise.all([
    tx.query.teams.findFirst({ where: eq(teams.id, homeTeamId) }),
    tx.query.teams.findFirst({ where: eq(teams.id, awayTeamId) }),
  ])

  if (!home || !away)
    return { attendance: 0, gate: 0, entries: [] }

  const entries: LedgerEntry[] = []
  const { season, round, leagueSize, positionByTeam, formByTeam } = context

  for (const club of [home, away]) {
    const squad = await tx.query.players.findMany({
      where: eq(players.teamId, club.id),
      columns: { wage: true, retired: true, freeAgent: true },
    })

    // A released player still carries their old club's `team_id` — it is what
    // the market shows as "released by" — so the wage bill has to exclude them
    // explicitly as well as the retired.
    const wageBill = squad
      .filter(player => !player.retired && !player.freeAgent)
      .reduce((total, player) => total + (player.wage ?? 0), 0)

    if (wageBill > 0) {
      entries.push({
        teamId: club.id,
        season,
        round,
        type: 'wages',
        amount: -wageBill,
        description: 'Player wages',
      })
    }

    const position = positionByTeam.get(club.id) ?? Math.ceil(leagueSize / 2)
    entries.push({
      teamId: club.id,
      season,
      round,
      type: 'sponsorship',
      amount: sponsorshipFor(club.reputation, position, leagueSize),
      description: 'Commercial income',
    })
  }

  // Only the home club takes gate receipts.
  const attendance = attendanceFor({
    capacity: home.stadiumCapacity,
    reputation: home.reputation,
    ticketPrice: home.ticketPrice,
    opponentReputation: away.reputation,
    formRating: formRatingFrom(formByTeam.get(home.id) ?? []),
    position: positionByTeam.get(home.id) ?? Math.ceil(leagueSize / 2),
    leagueSize,
  })

  const gate = gateReceiptsFor(attendance, home.ticketPrice)

  entries.push({
    teamId: home.id,
    season,
    round,
    type: 'gate',
    amount: gate,
    description: `Gate receipts — ${attendance.toLocaleString('en-IE')} at €${home.ticketPrice}`,
  })

  await postLedger(tx, entries)

  return { attendance, gate, entries }
}

/** Season-end prize money for every club in a league, by final position. */
export async function payPrizeMoney(
  tx: Tx,
  season: number,
  table: { teamId: number; teamName: string }[],
): Promise<void> {
  if (!table.length) return

  const clubs = await tx.query.teams.findMany({ where: inArray(teams.id, table.map(row => row.teamId)) })
  const reputationById = new Map(clubs.map(club => [club.id, club.reputation]))

  await postLedger(tx, table.map((row, index) => ({
    teamId: row.teamId,
    season,
    round: 0,
    type: 'prize' as const,
    amount: prizeMoneyFor(reputationById.get(row.teamId) ?? 50, index + 1, table.length),
    description: `Prize money — finished ${index + 1}${ordinal(index + 1)}`,
  })))
}

function ordinal(position: number): string {
  return position === 1 ? 'st' : position === 2 ? 'nd' : position === 3 ? 'rd' : 'th'
}

/**
 * Builds the league context a matchday's finances need — positions and form —
 * once, rather than per fixture.
 */
export async function buildMatchdayContext(
  leagueId: number,
  season: number,
  round: number,
): Promise<MatchdayContext> {
  const { computeStandings } = await import('./standings')
  const table = await computeStandings(leagueId, season)

  const positionByTeam = new Map<number, number>()
  table.forEach((row, index) => positionByTeam.set(row.teamId, index + 1))

  const formByTeam = await recentForm(leagueId, season, table.map(row => row.teamId))

  return { season, round, leagueSize: table.length, positionByTeam, formByTeam }
}

/**
 * A club's row plus where it currently sits in its division.
 *
 * Contracts, transfer negotiation and the board all price the same way — what
 * a club is, and how it is doing — so they read that pair from one place.
 */
export async function leagueStandingFor(teamId: number, season: number, round = 0) {
  const club = await db.query.teams.findFirst({ where: eq(teams.id, teamId) })
  if (!club)
    return null

  const context = await buildMatchdayContext(club.leagueId, season, round)

  return {
    club,
    position: context.positionByTeam.get(club.id) ?? Math.ceil(context.leagueSize / 2),
    leagueSize: context.leagueSize,
    formRating: formRatingFrom(context.formByTeam.get(club.id) ?? []),
  }
}

export { recentForm }
