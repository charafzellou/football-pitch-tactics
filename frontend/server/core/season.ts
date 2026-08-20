/**
 * Season completion and rollover.
 *
 * A season ends when every fixture in it has been played. Rolling over ages
 * the whole world by a year: players develop or decline, the oldest retire,
 * contracts run out, youth come through, values are repriced, prize money is
 * paid, and a fresh fixture list is drawn.
 *
 * Everything happens in one transaction. A half-applied rollover — ageing
 * done, fixtures not generated — would leave a save with no way forward.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../db'
import { game, matches, players, season as seasonTable, seasonSummary, stadiumEvents, teams } from '../db/schema'
import { buildSeasonFixtures, roundsFor, seasonStartDate } from './calendar'
import { computeStandings } from './standings'
import type { StandingRow } from './standings'
import {
  SQUAD_TARGET_SIZE,
  academyIntakeBonus,
  developSkill,
  generateYouthPlayer,
  marketValueFor,
  positionsToFill,
  shouldRetire,
} from './progression'
import type { PositionCode } from './progression'
import { aiContractLength, aiRenews, canCarryWage, requiredWage } from './contracts'
import { payPrizeMoney, postLedger } from './finance'
import { expireDeals, paySponsorshipBonuses } from './sponsors'
import {
  prizeMoneyFor,
  seasonTicketHolders,
  seasonTicketRevenue,
  seatsLostToBoxes,
} from './economy'
import { settleSeasonEnd } from './board'
import { postNews, pruneNews } from './news'
import type { NewsItem } from './news'
import { normalizePosition } from '#shared/lineup'

export interface SeasonStatus {
  season: number
  round: number
  totalRounds: number
  fixturesRemaining: number
  playerFixturesRemaining: number
  complete: boolean
}

/** Where the current season has got to. */
export async function getSeasonStatus(): Promise<SeasonStatus | null> {
  const gameState = await db.query.game.findFirst()
  if (!gameState)
    return null

  const all = await db.query.matches.findMany({
    where: eq(matches.season, gameState.season),
    columns: { id: true, played: true, round: true, homeTeamId: true, awayTeamId: true },
  })

  const unplayed = all.filter(match => !match.played)
  const playerUnplayed = unplayed.filter(match =>
    match.homeTeamId === gameState.playerTeamId || match.awayTeamId === gameState.playerTeamId)

  const totalRounds = all.reduce((max, match) => Math.max(max, match.round), 0)
  const playedRounds = all.filter(match => match.played).map(match => match.round)
  const round = playedRounds.length ? Math.max(...playedRounds) : 0

  return {
    season: gameState.season,
    round,
    totalRounds,
    fixturesRemaining: unplayed.length,
    playerFixturesRemaining: playerUnplayed.length,
    complete: unplayed.length === 0,
  }
}

export interface SquadChange {
  playerId: number
  name: string
  teamId: number
  teamName: string
  position: string
  age: number
  skillBefore: number
  skillAfter: number
}

export interface ContractDeparture {
  playerId: number
  name: string
  teamId: number
  teamName: string
  position: string
  age: number
  skillLevel: number
  marketValue: number
}

export interface RolloverSummary {
  previousSeason: number
  newSeason: number
  champions: { leagueName: string; teamName: string; points: number }[]
  playerFinish: { leagueName: string; position: number; points: number } | null
  /** Prize money credited to the manager's club for where they finished. */
  playerPrizeMoney: number | null
  /**
   * Totals across the whole world. The lists below are capped for display, so
   * reporting their length would understate what actually happened — a season
   * retires ~30 players but only the most notable are listed.
   */
  retirementCount: number
  youthCount: number
  releasedCount: number
  freeAgentSigningCount: number
  /** Retirements and arrivals at the player's own club, which they care about most. */
  ownRetirements: SquadChange[]
  ownYouth: YouthArrival[]
  /** Players the manager let run out of contract — gone, on a free. */
  ownDepartures: ContractDeparture[]
  retirements: SquadChange[]
  youthIntake: YouthArrival[]
  risers: SquadChange[]
  fallers: SquadChange[]
}

export interface YouthArrival {
  name: string
  teamName: string
  teamId: number
  position: string
  age: number
  skillLevel: number
  potential: number
}

/** Storage codes ('DEF') from the canonical lineup slots ('DF'). */
const CODE_BY_SLOT: Record<'GK' | 'DF' | 'MF' | 'FW', PositionCode> = {
  GK: 'GK', DF: 'DEF', MF: 'MID', FW: 'ATT',
}

function positionCodeOf(position: string): PositionCode | null {
  const slot = normalizePosition(position)
  return slot ? CODE_BY_SLOT[slot] : null
}

function medianOf(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)

  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

/**
 * Advances the world by one season.
 *
 * Order matters: standings are snapshotted *before* anything else changes,
 * because the next season's fixtures are inserted at the end and would
 * otherwise pollute the table the champion is read from.
 */
export async function rollOverSeason(): Promise<RolloverSummary> {
  const gameState = await db.query.game.findFirst()
  if (!gameState) {
    throw createError({ statusCode: 400, statusMessage: 'No active save' })
  }

  const outstanding = await db.query.matches.findMany({
    where: and(eq(matches.season, gameState.season), eq(matches.played, 0)),
    columns: { id: true },
  })

  if (outstanding.length) {
    throw createError({
      statusCode: 400,
      statusMessage: `Season is not finished — ${outstanding.length} fixtures remain`,
    })
  }

  const previousSeason = gameState.season
  const newSeason = previousSeason + 1

  const leagues = await db.query.leagues.findMany()
  const allTeams = await db.query.teams.findMany()
  const teamNameById = new Map(allTeams.map(team => [team.id, team.name]))
  const teamById = new Map(allTeams.map(team => [team.id, team]))

  // ---- 1. Snapshot the finished season -------------------------------------
  const champions: RolloverSummary['champions'] = []
  let playerFinish: RolloverSummary['playerFinish'] = null
  let playerPrizeMoney: number | null = null
  const summaryRows: (typeof seasonSummary.$inferInsert)[] = []
  const finalTables: StandingRow[][] = []
  const positionByTeam = new Map<number, number>()
  const leagueSizeByTeam = new Map<number, number>()
  const news: NewsItem[] = []

  for (const league of leagues) {
    const table = await computeStandings(league.id, previousSeason)
    const champion = table[0]
    if (!champion)
      continue

    finalTables.push(table)
    table.forEach((row, index) => {
      positionByTeam.set(row.teamId, index + 1)
      leagueSizeByTeam.set(row.teamId, table.length)
    })

    champions.push({ leagueName: league.name, teamName: champion.teamName, points: champion.points })

    const playerIndex = table.findIndex(row => row.teamId === gameState.playerTeamId)
    const playerRow: StandingRow | undefined = playerIndex >= 0 ? table[playerIndex] : undefined

    if (playerRow) {
      playerFinish = { leagueName: league.name, position: playerIndex + 1, points: playerRow.points }
      playerPrizeMoney = prizeMoneyFor(
        teamById.get(gameState.playerTeamId)?.reputation ?? 50,
        playerIndex + 1,
        table.length,
      )
    }

    summaryRows.push({
      season: previousSeason,
      leagueId: league.id,
      championTeamId: champion.teamId,
      championPoints: champion.points,
      playerTeamId: playerRow ? gameState.playerTeamId : null,
      playerPosition: playerRow ? playerIndex + 1 : null,
      playerPoints: playerRow ? playerRow.points : null,
      completedAt: new Date(),
    })
  }

  // ---- 2. Age, develop, retire ---------------------------------------------
  const squad = await db.query.players.findMany({ where: eq(players.retired, 0) })

  const retirements: SquadChange[] = []
  const developments: { id: number; age: number; skillLevel: number; marketValue: number }[] = []
  const changes: SquadChange[] = []
  /** Post-development numbers, which is what contracts are priced against. */
  const developedById = new Map<number, { age: number; skillLevel: number; marketValue: number }>()

  /**
   * Whose training ground each player develops on.
   *
   * Read once, here, rather than per player — development is applied to every
   * squad in the world in one pass and forty lookups inside that loop would be
   * forty thousand queries a rollover.
   */
  const trainingByTeam = new Map(allTeams.map(team => [team.id, team.trainingLevel]))

  for (const player of squad) {
    const age = player.age + 1
    const potential = Math.max(player.potential, player.skillLevel)

    if (shouldRetire(age, player.skillLevel)) {
      retirements.push({
        playerId: player.id,
        name: player.name,
        teamId: player.teamId,
        teamName: teamNameById.get(player.teamId) ?? '—',
        position: player.position,
        age,
        skillBefore: player.skillLevel,
        skillAfter: player.skillLevel,
      })
      continue
    }

    const skillLevel = developSkill(
      player.skillLevel, potential, age, trainingByTeam.get(player.teamId) ?? 1,
    )
    const marketValue = marketValueFor(skillLevel, age, potential)

    developments.push({ id: player.id, age, skillLevel, marketValue })
    developedById.set(player.id, { age, skillLevel, marketValue })

    if (skillLevel !== player.skillLevel) {
      changes.push({
        playerId: player.id,
        name: player.name,
        teamId: player.teamId,
        teamName: teamNameById.get(player.teamId) ?? '—',
        position: player.position,
        age,
        skillBefore: player.skillLevel,
        skillAfter: skillLevel,
      })
    }
  }

  // ---- 3. Contracts ---------------------------------------------------------
  const retiredIds = new Set(retirements.map(entry => entry.playerId))
  const survivorsByTeam = new Map<number, typeof squad>()

  for (const player of squad) {
    // Free agents are nobody's squad member — they must not count toward a
    // club's size, nor be released a second time.
    if (retiredIds.has(player.id) || player.freeAgent)
      continue

    const list = survivorsByTeam.get(player.teamId) ?? []
    list.push(player)
    survivorsByTeam.set(player.teamId, list)
  }

  /** Renewals CPU clubs agreed, applied in the commit below. */
  const renewals: { id: number; wage: number; contractUntilSeason: number }[] = []
  const releasedIds = new Set<number>()
  const ownDepartures: ContractDeparture[] = []

  for (const team of allTeams) {
    const survivors = survivorsByTeam.get(team.id) ?? []
    const isPlayerClub = team.id === gameState.playerTeamId
    const position = positionByTeam.get(team.id) ?? 10
    const leagueSize = leagueSizeByTeam.get(team.id) ?? 20
    const medianSkill = medianOf(survivors.map(p => developedById.get(p.id)?.skillLevel ?? p.skillLevel))

    let size = survivors.length

    for (const player of survivors) {
      if (player.contractUntilSeason > previousSeason)
        continue

      const developed = developedById.get(player.id)
      const age = developed?.age ?? player.age + 1
      const skillLevel = developed?.skillLevel ?? player.skillLevel
      const marketValue = developed?.marketValue ?? player.marketValue

      // The manager's own club never auto-renews. Letting a contract lapse has
      // to be a decision they made, not one the engine quietly made for them.
      const keep = isPlayerClub
        ? false
        : aiRenews({
            age,
            skillLevel,
            squadMedianSkill: medianSkill,
            squadSize: size,
            targetSquadSize: SQUAD_TARGET_SIZE,
          })

      if (keep) {
        const seasons = aiContractLength(age)
        renewals.push({
          id: player.id,
          wage: requiredWage(
            { playerId: player.id, marketValue, age, skillLevel, clubReputation: team.reputation, position, leagueSize },
            seasons,
          ),
          contractUntilSeason: newSeason + seasons - 1,
        })
        continue
      }

      releasedIds.add(player.id)
      size--

      if (isPlayerClub) {
        ownDepartures.push({
          playerId: player.id,
          name: player.name,
          teamId: player.teamId,
          teamName: team.name,
          position: player.position,
          age,
          skillLevel,
          marketValue,
        })
      }
    }
  }

  // ---- 4. Free agents, then youth, fill what is left ------------------------
  /**
   * The pool CPU clubs shop in: everyone already unattached plus everyone
   * released a moment ago. Sorted best-first so the strongest are taken first
   * and by clubs with the money to carry them, rather than by whoever happens
   * to be short of bodies.
   */
  const freeAgentPool = squad
    .filter(player => !retiredIds.has(player.id) && (player.freeAgent === 1 || releasedIds.has(player.id)))
    .map(player => ({
      ...player,
      ...(developedById.get(player.id) ?? { age: player.age + 1, skillLevel: player.skillLevel, marketValue: player.marketValue }),
    }))
    .sort((a, b) => b.skillLevel - a.skillLevel)

  const takenFreeAgents = new Set<number>()
  const signings: { id: number; teamId: number; wage: number; contractUntilSeason: number }[] = []

  const youthIntake: YouthArrival[] = []
  const youthRows: (typeof players.$inferInsert)[] = []

  /** Cap per club, so a squad is never rebuilt wholesale from castoffs. */
  const MAX_FREE_AGENT_SIGNINGS = 3

  for (const team of allTeams) {
    const survivors = (survivorsByTeam.get(team.id) ?? []).filter(player => !releasedIds.has(player.id))

    /**
     * Places to fill, and how many of them the academy claims.
     *
     * A top academy adds a graduate the squad did not strictly need, and those
     * last places are *always* youth — a bonus slot filled by somebody else's
     * castoff would make the investment indistinguishable from not having made
     * it.
     */
    const bonus = academyIntakeBonus(team.academyLevel)
    const shortfall = Math.max(0, SQUAD_TARGET_SIZE - survivors.length) + bonus
    if (!shortfall)
      continue

    const counts = { GK: 0, DEF: 0, MID: 0, ATT: 0 } as Record<PositionCode, number>
    for (const player of survivors) {
      const code = positionCodeOf(player.position)
      if (code) counts[code]++
    }

    const isPlayerClub = team.id === gameState.playerTeamId
    const position = positionByTeam.get(team.id) ?? 10
    const leagueSize = leagueSizeByTeam.get(team.id) ?? 20
    // The standard a free agent has to beat to be worth a contract.
    const squadMedian = medianOf(survivors.map(p => developedById.get(p.id)?.skillLevel ?? p.skillLevel))
    let budget = team.bankBalance
    let signed = 0

    const wanted = positionsToFill(counts, shortfall)

    for (const [slot, needed] of wanted.entries()) {
      const academySlot = slot >= wanted.length - bonus

      // The manager fills their own gaps in the transfer market; the engine
      // signing on their behalf would spend their money without asking.
      const candidate = isPlayerClub || academySlot || signed >= MAX_FREE_AGENT_SIGNINGS
        ? undefined
        : freeAgentPool.find((player) => {
            if (takenFreeAgents.has(player.id) || positionCodeOf(player.position) !== needed)
              return false

            // A club fills a gap with a castoff only if he is actually better
            // than what it already has; otherwise it promotes from the youth
            // team. Without this bar every release was signed again within the
            // same summer and the free-agent market never existed — the
            // manager could not have signed one even once.
            if (player.skillLevel < squadMedian)
              return false

            const wage = requiredWage(
              { playerId: player.id, marketValue: player.marketValue, age: player.age, skillLevel: player.skillLevel, clubReputation: team.reputation, position, leagueSize },
              aiContractLength(player.age),
            )
            return canCarryWage(budget, wage)
          })

      if (candidate) {
        const seasons = aiContractLength(candidate.age)
        const wage = requiredWage(
          { playerId: candidate.id, marketValue: candidate.marketValue, age: candidate.age, skillLevel: candidate.skillLevel, clubReputation: team.reputation, position, leagueSize },
          seasons,
        )

        takenFreeAgents.add(candidate.id)
        signings.push({ id: candidate.id, teamId: team.id, wage, contractUntilSeason: newSeason + seasons - 1 })
        // A signing commits future wages; hold the rest of the shopping to
        // what is left, so one club cannot sign three players it can only
        // afford one of.
        budget -= wage * 60
        signed++
        continue
      }

      const youth = generateYouthPlayer(team.id, needed, team.academyLevel)
      youthRows.push({
        ...youth,
        // Youth arrive on modest terms, long enough that they are not back on
        // the market before they have developed.
        wage: requiredWage(
          { playerId: 0, marketValue: youth.marketValue, age: youth.age, skillLevel: youth.skillLevel, clubReputation: team.reputation, position, leagueSize },
          3,
        ),
        contractUntilSeason: newSeason + 2,
      })
      youthIntake.push({
        name: youth.name,
        teamName: team.name,
        teamId: team.id,
        position: youth.position,
        age: youth.age,
        skillLevel: youth.skillLevel,
        potential: youth.potential,
      })
    }
  }

  // ---- 5. Next season's fixtures -------------------------------------------
  const startDate = seasonStartDate(newSeason)
  const nextFixtures: (typeof matches.$inferInsert)[] = []

  for (const league of leagues) {
    const leagueTeams = allTeams.filter(team => team.leagueId === league.id)
    if (leagueTeams.length < 2)
      continue

    nextFixtures.push(...buildSeasonFixtures(leagueTeams.map(team => team.id), newSeason, startDate))
  }

  // Seasons are seeded ahead of time; make sure a row exists to reference.
  const seasonRow = await db.query.season.findFirst({ where: eq(seasonTable.id, newSeason) })

  // ---- 6. Headlines ---------------------------------------------------------
  for (const champion of champions)
    news.push({ season: newSeason, category: 'result', tone: 'neutral', headline: `${champion.teamName} win the ${champion.leagueName}`, body: `${champion.points} points.` })

  if (playerFinish && playerPrizeMoney !== null) {
    news.push({
      season: newSeason,
      category: 'board',
      tone: playerFinish.position <= 4 ? 'positive' : playerFinish.position >= 15 ? 'negative' : 'neutral',
      headline: `Season ${previousSeason} finished ${playerFinish.position}${ordinal(playerFinish.position)}`,
      body: `${playerFinish.points} points. Prize money of €${playerPrizeMoney.toLocaleString('en-IE')} credited.`,
    })
  }

  for (const departure of ownDepartures) {
    news.push({
      season: newSeason,
      category: 'contract',
      tone: 'negative',
      headline: `${departure.name} leaves on a free transfer`,
      body: `His contract expired and was not renewed. Valued at €${departure.marketValue.toLocaleString('en-IE')}.`,
    })
  }

  // ---- 7. Commit ------------------------------------------------------------
  await db.transaction(async (tx) => {
    if (summaryRows.length)
      await tx.insert(seasonSummary).values(summaryRows)

    await tx.update(seasonTable).set({ ended: 'true' }).where(eq(seasonTable.id, previousSeason))

    if (!seasonRow)
      await tx.insert(seasonTable).values({ id: newSeason, year: String(2024 + newSeason - 1), ended: 'false' })

    // Prize money for the season just finished, before anything else moves.
    for (const table of finalTables)
      await payPrizeMoney(tx, previousSeason, table)

    /**
     * Then what the manager's partners owe for it.
     *
     * Sponsorship bonuses sit next to prize money because they are the same
     * kind of thing — a verdict on the season that has just ended, not income
     * from the one about to start. A deal in its final season is paid its bonus
     * before it is retired, which is what makes a short deal's larger bonus
     * worth taking.
     */
    const playerTable = finalTables.find(table => table.some(row => row.teamId === gameState.playerTeamId))
    if (playerTable) {
      const finish = playerTable.findIndex(row => row.teamId === gameState.playerTeamId) + 1
      const bonuses = await paySponsorshipBonuses(
        tx, gameState.playerTeamId, previousSeason, finish, playerTable.length,
      )

      for (const bonus of bonuses) {
        news.push({
          season: newSeason,
          round: 0,
          category: 'finance',
          tone: 'positive',
          headline: bonus.description,
          body: `${bonus.amount.toLocaleString('en-IE')} paid into the club's account.`,
        })
      }
    }

    /**
     * Season tickets for the campaign about to start, sold and banked now.
     *
     * The whole point of them is that the money arrives before the football
     * does — a chairman short of cash in July can sell certainty and spend it,
     * and then watch a title run fill a ground he has already been paid for.
     */
    const club = await tx.query.teams.findFirst({ where: eq(teams.id, gameState.playerTeamId) })
    if (club && club.seasonTicketShare > 0) {
      const generalCapacity = Math.max(0, club.stadiumCapacity - seatsLostToBoxes(club.hospitalityBoxes))
      const holders = seasonTicketHolders(generalCapacity, club.seasonTicketShare)
      const revenue = seasonTicketRevenue(
        holders, club.ticketPrice, club.seasonTicketDiscount, roundsFor(20) / 2,
      )

      if (revenue > 0) {
        await postLedger(tx, [{
          teamId: club.id,
          season: newSeason,
          round: 0,
          type: 'season_tickets',
          amount: revenue,
          description: `Season tickets — ${holders.toLocaleString('en-IE')} at `
            + `${club.seasonTicketDiscount}% off`,
        }])

        news.push({
          season: newSeason,
          round: 0,
          category: 'finance',
          tone: 'positive',
          headline: `${holders.toLocaleString('en-IE')} season tickets sold`,
          body: `${revenue.toLocaleString('en-IE')} banked before a ball is kicked. `
            + 'Those seats are spoken for whatever happens now.',
        })
      }
    }

    const lapsed = await expireDeals(tx, gameState.playerTeamId, newSeason)
    for (const deal of lapsed) {
      news.push({
        season: newSeason,
        round: 0,
        category: 'finance',
        tone: 'neutral',
        headline: `Partnership ended — ${deal}`,
        body: 'The slot is open. Offers will arrive over the coming matchdays.',
      })
    }

    /**
     * The ground over the summer: a new pitch, and a diary wiped clean.
     *
     * A surface left at 40 in May is not still at 40 in August — every ground
     * in the world is relaid between seasons, and without this a manager who
     * took one lucrative concert too many in April would carry the penalty into
     * a season the decision had nothing to do with. It is the same argument as
     * the pre-season stamina reset below.
     *
     * Bookings that were never held go with it. `settleStadiumForRound()`
     * filters by season, so a `booked` row for a round that has passed would
     * otherwise sit in the table for ever, un-settleable and still drawn on the
     * diary.
     */
    await tx.update(teams).set({ pitchCondition: 100 })

    await tx.update(stadiumEvents)
      .set({ status: 'expired' })
      .where(and(
        eq(stadiumEvents.season, previousSeason),
        inArray(stadiumEvents.status, ['offered', 'booked']),
      ))

    for (const update of developments) {
      await tx.update(players)
        .set({
          age: update.age,
          skillLevel: update.skillLevel,
          marketValue: update.marketValue,
          // Pre-season. Stamina drains faster than the +10 recovered per match,
          // so a starter finishes 38 games near empty — Courtois ended one on
          // 13%. Without a summer break every season after the first would
          // start with an exhausted squad and rotation would stop meaning
          // anything. Injuries deliberately still carry over.
          stamina: 100,
        })
        .where(eq(players.id, update.id))
    }

    if (retiredIds.size) {
      // Flagged, never deleted: `match_events.player_id` references these rows,
      // so removing them would destroy the match history they appear in.
      await tx.update(players)
        .set({ retired: 1, wage: 0 })
        .where(inArray(players.id, [...retiredIds]))
    }

    for (const renewal of renewals) {
      await tx.update(players)
        .set({ wage: renewal.wage, contractUntilSeason: renewal.contractUntilSeason })
        .where(eq(players.id, renewal.id))
    }

    if (releasedIds.size) {
      // `team_id` deliberately keeps pointing at the club that let them go —
      // it is what the market shows as "released by". The wage is zeroed so a
      // squad query that forgot the `free_agent` filter still cannot invent a
      // wage bill.
      await tx.update(players)
        .set({ freeAgent: 1, wage: 0, contractUntilSeason: 0 })
        .where(inArray(players.id, [...releasedIds]))
    }

    for (const signing of signings) {
      await tx.update(players)
        .set({
          teamId: signing.teamId,
          freeAgent: 0,
          wage: signing.wage,
          contractUntilSeason: signing.contractUntilSeason,
        })
        .where(eq(players.id, signing.id))
    }

    if (youthRows.length)
      await tx.insert(players).values(youthRows)

    // A saved XI may name a player who has just retired or left.
    await tx.update(teams).set({ lineup: null })

    if (nextFixtures.length)
      await tx.insert(matches).values(nextFixtures)

    await tx.update(game)
      .set({ season: newSeason, currentDate: new Date(startDate.getTime() - 1000) })
      .where(eq(game.id, gameState.id))

    // The board judges the season now that it is closed, and sets the target
    // for the next one.
    await settleSeasonEnd(tx, {
      gameState,
      newSeason,
      finish: playerFinish?.position ?? null,
      leagueSize: leagueSizeByTeam.get(gameState.playerTeamId) ?? 20,
      reputation: teamById.get(gameState.playerTeamId)?.reputation ?? 50,
      news,
    })

    await postNews(tx, news)
  })

  // The feed is a running commentary, not an archive — `season_summary` keeps
  // the history that matters.
  await pruneNews(newSeason)

  const bySwing = (a: SquadChange, b: SquadChange) =>
    (b.skillAfter - b.skillBefore) - (a.skillAfter - a.skillBefore)

  return {
    previousSeason,
    newSeason,
    champions,
    playerFinish,
    playerPrizeMoney,
    retirementCount: retirements.length,
    youthCount: youthIntake.length,
    releasedCount: releasedIds.size,
    freeAgentSigningCount: signings.length,
    ownRetirements: retirements.filter(entry => entry.teamId === gameState.playerTeamId),
    ownYouth: youthIntake.filter(entry => entry.teamId === gameState.playerTeamId),
    ownDepartures,
    retirements: [...retirements].sort((a, b) => b.skillBefore - a.skillBefore).slice(0, 12),
    youthIntake: [...youthIntake].sort((a, b) => b.potential - a.potential).slice(0, 12),
    risers: [...changes].sort(bySwing).slice(0, 8),
    fallers: [...changes].sort((a, b) => bySwing(b, a)).slice(0, 8),
  }
}

function ordinal(position: number): string {
  return position === 1 ? 'st' : position === 2 ? 'nd' : position === 3 ? 'rd' : 'th'
}

export { roundsFor }
