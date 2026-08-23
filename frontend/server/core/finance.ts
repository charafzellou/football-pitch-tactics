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
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../db'
import { financeLedger, game, players, sponsorshipDeals, teams } from '../db/schema'
import {
  attendanceFor,
  commercialPoolFor,
  facilityUpkeepFor,
  formRatingFrom,
  gateReceiptsFor,
  hospitalityIncomeFor,
  matchdayOperatingCostFor,
  merchandisingFor,
  perimeterIncomeFor,
  perimeterTier,
  prizeMoneyFor,
  seasonTicketHolders,
  seatsLostToBoxes,
  sponsorshipFor,
  starPowerOf,
} from './economy'
import type { LedgerType } from './economy'
import { activeLoans, settleDebtForRound } from './loans'
import { recentForm } from './results-server'
import type { GameRow } from './save'

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
  /**
   * The manager's club, whose money is itemised rather than blended.
   *
   * Every other club takes one `sponsorship` credit exactly as before. Giving
   * all forty clubs deal rows, hoardings and a club shop would mean renewing a
   * hundred and sixty contracts every rollover to produce a number the game
   * then sums straight back into one. The manager's itemised streams are
   * calibrated to net what that single credit nets — see `COMMERCIAL_UPLIFT` in
   * `economy.ts` — so the asymmetry is presentational, never an advantage.
   */
  playerTeamId: number | null
  /** Supporter confidence, which the club shop reads. */
  fanConfidence: number
}

/** What the club shop assumes when there is no save to read confidence from. */
const DEFAULT_FAN_CONFIDENCE = 65

export interface MatchFinanceResult {
  attendance: number
  gate: number
  entries: LedgerEntry[]
}

/** What a home club needs to know about the fixture it is hosting. */
interface HomeContext {
  fill: number
  opponentReputation: number
}

/**
 * One club's entries for one matchday.
 *
 * The manager's club gets a line per stream so the finance page can show a real
 * profit and loss; every other club gets the single blended credit it always
 * had. Both paths run through the same wage bill and the same `postLedger`.
 */
async function clubEntries(
  tx: Tx,
  club: typeof teams.$inferSelect,
  context: MatchdayContext,
  home: HomeContext | null,
): Promise<LedgerEntry[]> {
  const { season, round, leagueSize, positionByTeam, playerTeamId, fanConfidence } = context
  const position = positionByTeam.get(club.id) ?? Math.ceil(leagueSize / 2)
  const base = { teamId: club.id, season, round }
  const entries: LedgerEntry[] = []

  const squad = await tx.query.players.findMany({
    where: eq(players.teamId, club.id),
    columns: { wage: true, retired: true, freeAgent: true, skillLevel: true },
  })

  // A released player still carries their old club's `team_id` — it is what
  // the market shows as "released by" — so the wage bill has to exclude them
  // explicitly as well as the retired.
  const contracted = squad.filter(player => !player.retired && !player.freeAgent)
  const wageBill = contracted.reduce((total, player) => total + (player.wage ?? 0), 0)

  if (wageBill > 0)
    entries.push({ ...base, type: 'wages', amount: -wageBill, description: 'Player wages' })

  if (club.id !== playerTeamId) {
    entries.push({
      ...base,
      type: 'sponsorship',
      amount: sponsorshipFor(club.reputation, position, leagueSize),
      description: 'Commercial income',
    })
    return entries
  }

  const pool = commercialPoolFor(club.reputation, position, leagueSize)

  /**
   * Partners pay what they signed for, not what the slot is worth.
   *
   * An empty slot earns nothing — which is the whole consequence of letting a
   * deal lapse, and the reason the offers on the commercial page are worth
   * answering. A save's opening deals are signed at the market rate by
   * `createSave()`, so a club that simply renews on time earns what the blended
   * credit used to pay it.
   */
  const deals = (await tx.query.sponsorshipDeals.findMany({
    where: and(eq(sponsorshipDeals.teamId, club.id), eq(sponsorshipDeals.status, 'active')),
  })).filter(deal => deal.signedSeason <= season && deal.untilSeason >= season)

  const partnerFees = deals.reduce((total, deal) => total + deal.baseFee, 0)

  if (partnerFees > 0) {
    entries.push({
      ...base,
      type: 'sponsorship',
      amount: partnerFees,
      description: deals.map(deal => deal.sponsorName).join(', '),
    })
  }

  entries.push({
    ...base,
    type: 'merchandising',
    amount: merchandisingFor(pool, fanConfidence, starPowerOf(contracted)),
    description: 'Club shop and licensing',
  })

  const upkeep = facilityUpkeepFor(pool, club.academyLevel, club.trainingLevel)
  if (upkeep > 0)
    entries.push({ ...base, type: 'facilities', amount: -upkeep, description: 'Academy and training ground' })

  /**
   * Debt service, charged against the balance the club started the matchday
   * with — so the overdraft is priced on the hole that existed when the money
   * was owed, not on the one this matchday's wages are about to dig.
   */
  entries.push(...await settleDebtForRound(tx, {
    teamId: club.id,
    season,
    round,
    balance: club.bankBalance,
  }))

  if (!home)
    return entries

  entries.push({
    ...base,
    type: 'perimeter',
    amount: perimeterIncomeFor(pool, club.perimeterLevel, home.fill, position, leagueSize),
    description: `${perimeterTier(club.perimeterLevel).name} — matchday advertising`,
  })

  const hospitality = hospitalityIncomeFor(club.hospitalityBoxes, club.reputation, home.opponentReputation)
  if (hospitality > 0) {
    entries.push({
      ...base,
      type: 'hospitality',
      amount: hospitality,
      description: `Executive boxes — ${club.hospitalityBoxes} sold`,
    })
  }

  entries.push({
    ...base,
    type: 'operating',
    amount: -matchdayOperatingCostFor(pool, home.fill),
    description: 'Stewarding, policing and matchday operations',
  })

  return entries
}

/**
 * One match's money: wages and commercial income for both clubs, and everything
 * that only happens where the match is played — gate, advertising, hospitality
 * and the cost of opening the ground — for the home club.
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

  const { season, round, leagueSize, positionByTeam, formByTeam } = context

  // Executive boxes are built out of the ground, so those seats cannot also be
  // sold at the turnstile.
  const generalCapacity = Math.max(0, home.stadiumCapacity - seatsLostToBoxes(home.hospitalityBoxes))

  const naturalAttendance = attendanceFor({
    capacity: generalCapacity,
    reputation: home.reputation,
    ticketPrice: home.ticketPrice,
    opponentReputation: away.reputation,
    formRating: formRatingFrom(formByTeam.get(home.id) ?? []),
    position: positionByTeam.get(home.id) ?? Math.ceil(leagueSize / 2),
    leagueSize,
  })

  /**
   * Season-ticket holders turn up whatever happens, and paid in the summer.
   *
   * So they are a floor under the crowd and a hole in the gate at the same
   * time: the club banked their money before a ball was kicked, and cannot
   * charge them again. Only walk-up trade pays today. At the default zero
   * share this is arithmetically identical to charging everybody.
   */
  const holders = seasonTicketHolders(generalCapacity, home.seasonTicketShare)
  const attendance = Math.max(naturalAttendance, holders)
  const walkUp = Math.max(0, attendance - holders)

  const fill = generalCapacity > 0 ? attendance / generalCapacity : 0
  const gate = gateReceiptsFor(walkUp, home.ticketPrice)

  const entries: LedgerEntry[] = [
    ...await clubEntries(tx, home, context, { fill, opponentReputation: away.reputation }),
    ...await clubEntries(tx, away, context, null),
  ]

  entries.push({
    teamId: home.id,
    season,
    round,
    type: 'gate',
    amount: gate,
    description: holders > 0
      ? `Gate receipts — ${walkUp.toLocaleString('en-IE')} paying at €${home.ticketPrice}, `
        + `${holders.toLocaleString('en-IE')} season tickets`
      : `Gate receipts — ${attendance.toLocaleString('en-IE')} at €${home.ticketPrice}`,
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
 * once, rather than per fixture. Scoped to one save's `gameId` throughout:
 * `leagueId` alone is shared identity across every save's clone of a league,
 * so every query here needs the save pinned down explicitly.
 */
export async function buildMatchdayContext(
  leagueId: number,
  season: number,
  round: number,
  gameId: number,
): Promise<MatchdayContext> {
  const { computeStandings } = await import('./standings')
  const [table, save] = await Promise.all([
    computeStandings(leagueId, season, gameId),
    db.query.game.findFirst({ where: eq(game.id, gameId) }),
  ])

  const positionByTeam = new Map<number, number>()
  table.forEach((row, index) => positionByTeam.set(row.teamId, index + 1))

  const formByTeam = await recentForm(leagueId, season, table.map(row => row.teamId), gameId)

  return {
    season,
    round,
    leagueSize: table.length,
    positionByTeam,
    formByTeam,
    playerTeamId: save?.playerTeamId ?? null,
    fanConfidence: save?.fanConfidence ?? DEFAULT_FAN_CONFIDENCE,
  }
}

/**
 * A club's row plus where it currently sits in its division.
 *
 * Contracts, transfer negotiation and the board all price the same way — what
 * a club is, and how it is doing — so they read that pair from one place.
 * Only `teamId` is needed from the caller: the club row itself carries its
 * own `gameId` once teams are per-save clones, so there is nothing extra to
 * thread through every call site.
 */
export async function leagueStandingFor(teamId: number, season: number, round = 0) {
  const club = await db.query.teams.findFirst({ where: eq(teams.id, teamId) })
  if (!club || club.gameId === null)
    return null

  const context = await buildMatchdayContext(club.leagueId, season, round, club.gameId)

  return {
    club,
    position: context.positionByTeam.get(club.id) ?? Math.ceil(context.leagueSize / 2),
    leagueSize: context.leagueSize,
    formRating: formRatingFrom(context.formByTeam.get(club.id) ?? []),
  }
}

export { recentForm }

// ---------------------------------------------------------------------------
// The forecast
// ---------------------------------------------------------------------------

/**
 * Assembles what `projectHorizon()` needs and runs it.
 *
 * Lives here rather than in the endpoint so `verify-economy.ts` can measure the
 * same forecast the manager is shown. A projection nobody checks against the
 * season it predicted is decoration, and it can only be checked if the harness
 * and the page compute it identically.
 */
export async function forecastForSave(gameState: GameRow) {
  const { projectHorizon, transferBudget, wageBudget } = await import('./projection')
  const { getSeasonStatus } = await import('./season')

  const club = await db.query.teams.findFirst({ where: eq(teams.id, gameState.playerTeamId) })
  if (!club) return null

  const [squad, status, deals, book] = await Promise.all([
    db.query.players.findMany({
      where: and(eq(players.teamId, club.id), eq(players.retired, 0), eq(players.freeAgent, 0)),
      columns: {
        id: true, age: true, wage: true, marketValue: true, skillLevel: true, contractUntilSeason: true,
      },
    }),
    getSeasonStatus(gameState),
    db.query.sponsorshipDeals.findMany({
      where: and(eq(sponsorshipDeals.teamId, club.id), eq(sponsorshipDeals.status, 'active')),
    }),
    activeLoans(db, club.id),
  ])

  const roundsPlayed = status?.round ?? 0
  const totalRounds = status?.totalRounds ?? 38
  const standing = await leagueStandingFor(club.id, gameState.season, roundsPlayed)
  const leagueSize = standing?.leagueSize ?? 20

  /**
   * Where the club is heading.
   *
   * Early in a season the table is five matchdays of noise, so the board's own
   * target is the better estimate until enough has been played to beat it.
   * After that the table is the evidence.
   */
  const expectedPosition = roundsPlayed >= 5
    ? (standing?.position ?? gameState.boardExpectation)
    : gameState.boardExpectation

  const spread = 4

  const projection = projectHorizon({
    season: gameState.season,
    roundsPlayed,
    totalRounds,
    balance: club.bankBalance,
    reputation: club.reputation,
    leagueSize,
    expectedPosition,
    bestPosition: Math.max(1, expectedPosition - spread),
    worstPosition: Math.min(leagueSize, expectedPosition + spread),
    stadiumCapacity: club.stadiumCapacity,
    ticketPrice: club.ticketPrice,
    hospitalityBoxes: club.hospitalityBoxes,
    perimeterLevel: club.perimeterLevel,
    academyLevel: club.academyLevel,
    trainingLevel: club.trainingLevel,
    seasonTicketShare: club.seasonTicketShare,
    seasonTicketDiscount: club.seasonTicketDiscount,
    fanConfidence: gameState.fanConfidence,
    squad,
    deals: deals.map(deal => ({
      slot: deal.slot,
      fee: deal.baseFee,
      untilSeason: deal.untilSeason,
    })),
    loans: book.map(loan => ({
      outstanding: loan.outstanding,
      ratePerSeason: loan.ratePerSeason,
      untilSeason: loan.untilSeason,
      repaymentPerRound: loan.repaymentPerRound,
    })),
  })

  return {
    season: gameState.season,
    round: roundsPlayed,
    totalRounds,
    expectedPosition,
    leagueSize,
    projection,
    wageBudget: wageBudget(projection),
    transferBudget: transferBudget(projection),
  }
}
