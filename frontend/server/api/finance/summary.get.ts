import { and, desc, eq } from 'drizzle-orm'
import { db } from '../../db'
import { financeLedger, players, teams } from '../../db/schema'
import {
  EXPANSION_STEP,
  MAX_STADIUM_CAPACITY,
  RUNNING_COST_TYPES,
  attendanceFor,
  expansionCost,
  fairTicketPrice,
  gateReceiptsFor,
  seatsLostToBoxes,
} from '../../core/economy'
import { streamMeta } from '#shared/finance'
import { activeLoans, interestPerRoundFor, overdraftInterestFor } from '../../core/loans'
import { buildMatchdayContext } from '../../core/finance'
import { getSeasonStatus } from '../../core/season'

/**
 * Everything the finance page needs: where the money is, where it came from,
 * and where it is heading.
 */
export default defineEventHandler(async () => {
  const gameState = await db.query.game.findFirst()
  if (!gameState) return null

  const club = await db.query.teams.findFirst({ where: eq(teams.id, gameState.playerTeamId) })
  if (!club) return null

  const [squad, entries, status, book] = await Promise.all([
    db.query.players.findMany({
      where: and(eq(players.teamId, club.id), eq(players.retired, 0), eq(players.freeAgent, 0)),
      columns: { wage: true, contractUntilSeason: true },
    }),
    db.query.financeLedger.findMany({
      where: and(eq(financeLedger.teamId, club.id), eq(financeLedger.season, gameState.season)),
      orderBy: [desc(financeLedger.round), desc(financeLedger.id)],
    }),
    getSeasonStatus(),
    activeLoans(db, club.id),
  ])

  const wageBill = squad.reduce((total, player) => total + (player.wage ?? 0), 0)

  const byType: Record<string, number> = {}
  for (const entry of entries)
    byType[entry.type] = (byType[entry.type] ?? 0) + entry.amount

  const income = entries.filter(e => e.amount > 0).reduce((t, e) => t + e.amount, 0)
  const expenses = entries.filter(e => e.amount < 0).reduce((t, e) => t + e.amount, 0)

  const roundsSoFar = Math.max(1, status?.round ?? 1)

  /**
   * The profit and loss, one row per stream.
   *
   * Built from the ledger rather than recomputed, so the page can never show a
   * total the account did not actually move — the same reason the ledger exists
   * at all.
   */
  const streams = Object.entries(byType)
    .map(([type, amount]) => {
      const meta = streamMeta(type)
      return {
        type,
        label: meta.label,
        group: meta.group,
        icon: meta.icon,
        kind: amount >= 0 ? ('income' as const) : ('cost' as const),
        amount: Math.abs(amount),
        perMatchday: Math.round(Math.abs(amount) / roundsSoFar),
        share: 0,
      }
    })
    .sort((a, b) => b.amount - a.amount)

  const streamIncome = streams.filter(row => row.kind === 'income').reduce((t, r) => t + r.amount, 0)
  const streamCost = streams.filter(row => row.kind === 'cost').reduce((t, r) => t + r.amount, 0)
  for (const row of streams) {
    const denominator = row.kind === 'income' ? streamIncome : streamCost
    row.share = denominator > 0 ? Math.round((row.amount / denominator) * 100) : 0
  }

  /**
   * Turnover is income net of what it costs to run the club — the base the wage
   * ratio is taken against, and the same one `settleBoardForMatchday()` uses, so
   * the number the page shows is the number the board is judging.
   */
  const runningCosts = (RUNNING_COST_TYPES as readonly string[])
    .reduce((total, type) => total + Math.abs(byType[type] ?? 0), 0)
  const turnover = income - runningCosts

  // Projection: what the rest of the season looks like at the current rate.
  // `GET /api/finance/projection` is the one that models step changes.
  const roundsPlayed = roundsSoFar
  const roundsLeft = Math.max(0, (status?.totalRounds ?? 38) - roundsPlayed)
  const perRound = (income + expenses) / roundsPlayed
  const projectedBalance = Math.round(club.bankBalance + perRound * roundsLeft)

  // Live preview of what the current ticket price is doing.
  const context = await buildMatchdayContext(club.leagueId, gameState.season, status?.round ?? 1)
  const position = context.positionByTeam.get(club.id) ?? 10
  const generalCapacity = Math.max(0, club.stadiumCapacity - seatsLostToBoxes(club.hospitalityBoxes))
  const previewAttendance = attendanceFor({
    capacity: generalCapacity,
    reputation: club.reputation,
    ticketPrice: club.ticketPrice,
    opponentReputation: 55,
    formRating: 0.5,
    position,
    leagueSize: context.leagueSize,
  })

  return {
    club: {
      name: club.name,
      balance: club.bankBalance,
      reputation: club.reputation,
      stadiumName: club.stadiumName,
      stadiumCapacity: club.stadiumCapacity,
      generalCapacity,
      hospitalityBoxes: club.hospitalityBoxes,
      ticketPrice: club.ticketPrice,
      fairTicketPrice: fairTicketPrice(club.reputation),
    },
    season: gameState.season,
    round: status?.round ?? 0,
    totalRounds: status?.totalRounds ?? 38,
    wageBill,
    wageBillPerSeason: wageBill * (status?.totalRounds ?? 38),
    /** Deals running out this summer — wages you keep paying, or players you lose. */
    expiringContracts: squad.filter(player => player.contractUntilSeason <= gameState.season).length,
    income,
    expenses,
    net: income + expenses,
    byType,
    streams,
    turnover,
    runningCosts,
    projectedBalance,
    /** Share of turnover going on wages — the number that should worry a manager. */
    wageRatio: turnover > 0 ? Math.round((Math.abs(byType.wages ?? 0) / turnover) * 100) : null,
    health: {
      stage: gameState.insolvencyStage,
      insolventRounds: gameState.insolventRounds,
    },
    /**
     * What the club owes, and what carrying it costs every matchday.
     *
     * Shown on the overview rather than only on a borrowing page because debt
     * service is the one cost a manager cannot change their mind about — it
     * belongs next to the balance it is draining, not behind another click.
     */
    debt: {
      count: book.length,
      outstanding: book.reduce((total, loan) => total + loan.outstanding, 0),
      principal: book.reduce((total, loan) => total + loan.principal, 0),
      servicePerRound: book.reduce(
        (total, loan) => total + loan.repaymentPerRound + interestPerRoundFor(loan.outstanding, loan.ratePerSeason),
        0,
      ),
      overdraftPerRound: overdraftInterestFor(club.bankBalance),
      loans: book.map(loan => ({
        id: loan.id,
        principal: loan.principal,
        outstanding: loan.outstanding,
        ratePerSeason: loan.ratePerSeason,
        untilSeason: loan.untilSeason,
        repaymentPerRound: loan.repaymentPerRound,
        interestPerRound: interestPerRoundFor(loan.outstanding, loan.ratePerSeason),
        repaidPercent: loan.principal > 0
          ? Math.round(((loan.principal - loan.outstanding) / loan.principal) * 100)
          : 100,
      })),
    },
    preview: {
      attendance: previewAttendance,
      fillPercent: generalCapacity > 0 ? Math.round((previewAttendance / generalCapacity) * 100) : 0,
      gatePerMatch: gateReceiptsFor(previewAttendance, club.ticketPrice),
    },
    expansion: {
      step: EXPANSION_STEP,
      cost: expansionCost(EXPANSION_STEP),
      maxCapacity: MAX_STADIUM_CAPACITY,
      canAfford: club.bankBalance >= expansionCost(EXPANSION_STEP),
      atMax: club.stadiumCapacity >= MAX_STADIUM_CAPACITY,
    },
    ledger: entries.slice(0, 60).map(entry => ({
      round: entry.round,
      type: entry.type,
      amount: entry.amount,
      description: entry.description,
    })),
  }
})
