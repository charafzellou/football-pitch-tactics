import { and, desc, eq } from 'drizzle-orm'
import { db } from '../../db'
import { financeLedger, players, teams } from '../../db/schema'
import { fairTicketPrice, attendanceFor, gateReceiptsFor, EXPANSION_STEP, MAX_STADIUM_CAPACITY, expansionCost } from '../../core/economy'
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

  const [squad, entries, status] = await Promise.all([
    db.query.players.findMany({
      where: and(eq(players.teamId, club.id), eq(players.retired, 0), eq(players.freeAgent, 0)),
      columns: { wage: true, contractUntilSeason: true },
    }),
    db.query.financeLedger.findMany({
      where: and(eq(financeLedger.teamId, club.id), eq(financeLedger.season, gameState.season)),
      orderBy: [desc(financeLedger.round), desc(financeLedger.id)],
    }),
    getSeasonStatus(),
  ])

  const wageBill = squad.reduce((total, player) => total + (player.wage ?? 0), 0)

  const byType: Record<string, number> = {}
  for (const entry of entries)
    byType[entry.type] = (byType[entry.type] ?? 0) + entry.amount

  const income = entries.filter(e => e.amount > 0).reduce((t, e) => t + e.amount, 0)
  const expenses = entries.filter(e => e.amount < 0).reduce((t, e) => t + e.amount, 0)

  // Projection: what the rest of the season looks like at the current rate.
  const roundsPlayed = Math.max(1, status?.round ?? 1)
  const roundsLeft = Math.max(0, (status?.totalRounds ?? 38) - roundsPlayed)
  const perRound = (income + expenses) / roundsPlayed
  const projectedBalance = Math.round(club.bankBalance + perRound * roundsLeft)

  // Live preview of what the current ticket price is doing.
  const context = await buildMatchdayContext(club.leagueId, gameState.season, status?.round ?? 1)
  const position = context.positionByTeam.get(club.id) ?? 10
  const previewAttendance = attendanceFor({
    capacity: club.stadiumCapacity,
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
    projectedBalance,
    /** Share of income going on wages — the number that should worry a manager. */
    wageRatio: income > 0 ? Math.round((Math.abs(byType.wages ?? 0) / income) * 100) : null,
    preview: {
      attendance: previewAttendance,
      fillPercent: Math.round((previewAttendance / club.stadiumCapacity) * 100),
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
