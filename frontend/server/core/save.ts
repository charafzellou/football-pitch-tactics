/**
 * The save's own lifecycle.
 *
 * `game.dismissed_at_season` is the only flag that *ends* a save rather than
 * changing it. It was written by `settleMatchday` and `settleSeasonEnd` and then
 * read by nothing: the schema called a dismissed save "read-only", but every
 * endpoint kept accepting writes and every page kept rendering, so a sacked
 * manager carried on managing. The board's whole pressure system terminated in
 * a flag nobody looked at.
 *
 * These helpers are that missing read. `requireActiveManager` is the guard for
 * anything that advances or mutates the world; `requireSave` is for the
 * read-only routes that only need the row to exist.
 */
import { eq } from 'drizzle-orm'
import { db } from '../db'
import {
  clubNews,
  financeLedger,
  game,
  loans,
  matchEvents,
  matches,
  season as seasonTable,
  seasonSummary,
  sponsorshipDeals,
  stadiumEvents,
  teams,
  transferOffers,
} from '../db/schema'
import { buildSeasonFixtures, seasonStartDate } from './calendar'
import { expectationFor } from './board'
import { computeStandings } from './standings'
import {
  DEFAULT_FACILITY_LEVEL,
  DEFAULT_SEASON_TICKET_DISCOUNT,
  commercialPoolFor,
  fairTicketPrice,
  slotValueFor,
  startingBalanceFor,
} from './economy'
import { openingDeals } from './sponsors'

export type GameRow = typeof game.$inferSelect

/** Every save starts in season 1. */
export const OPENING_SEASON = 1

/** The current save, or null when none exists. */
export async function activeSave(): Promise<GameRow | null> {
  return (await db.query.game.findFirst()) ?? null
}

/** The current save. 404s when there isn't one. */
export async function requireSave(): Promise<GameRow> {
  const gameState = await db.query.game.findFirst()

  if (!gameState) {
    throw createError({ statusCode: 404, statusMessage: 'Game not found' })
  }

  return gameState
}

/**
 * The current save, refusing anything a dismissed manager should not be able to
 * do — playing a match, buying, selling, renaming an XI, rolling a season over.
 *
 * Deliberately *not* applied to `POST /api/match/finish`: that route only
 * commits a match already in flight, and dismissal is decided by
 * `settleBoardForMatchday()` at the end of that very call. Guarding it would
 * make the client's retry-on-failure path 403 on a result the server had in fact
 * already saved. Blocking `start`, `advance` and `changes` is what actually
 * prevents a new result being produced.
 */
export async function requireActiveManager(): Promise<GameRow> {
  const gameState = await requireSave()

  if (gameState.dismissedAtSeason !== null) {
    throw createError({
      statusCode: 403,
      // Short and plain: h3 warns on (and will one day sanitize) anything
      // longer or punctuated in `statusMessage`, which is the field
      // `useAppToast().fromRequestError` reads first.
      statusMessage: 'You were dismissed. This save is closed.',
    })
  }

  return gameState
}

// ---------------------------------------------------------------------------
// Creating a save
// ---------------------------------------------------------------------------

/**
 * Everything a new save resets, in one place.
 *
 * `POST /api/game/start` used to hold this inline, which meant the headless
 * drivers under `scripts/` created saves that reset less than the real endpoint
 * did — and `verify-economy.ts` duly failed its ledger-integrity check against
 * rows left behind by its own previous run. A verification harness that does not
 * start from the same state as the game is not verifying the game.
 *
 * Squads are deliberately *not* rebuilt: `match_events` and transfer history
 * reference those rows, so ages, development and retirements carry across saves.
 * `bun run db:setup` is the full reset.
 */
export async function createSave(input: { teamId: number; sackingEnabled?: boolean }): Promise<GameRow> {
  const club = await db.query.teams.findFirst({ where: eq(teams.id, input.teamId) })
  if (!club)
    throw createError({ statusCode: 404, statusMessage: 'Club not found' })

  // The board's opening target comes from the club's standing. Season 1 has no
  // previous finish to temper it with, so reputation alone sets the bar. Read
  // before the reset below, which is about to empty the table it computes from.
  const table = await computeStandings(club.leagueId, OPENING_SEASON)
  const boardExpectation = expectationFor(club.reputation, null, table.length || 20)

  const leagues = await db.query.leagues.findMany()
  const allTeams = await db.query.teams.findMany()

  const startDate = seasonStartDate(OPENING_SEASON)
  const fixtures: (typeof matches.$inferInsert)[] = []

  for (const league of leagues) {
    const leagueTeams = allTeams.filter(team => team.leagueId === league.id)
    if (leagueTeams.length < 2)
      continue

    fixtures.push(...buildSeasonFixtures(leagueTeams.map(team => team.id), OPENING_SEASON, startDate))
  }

  return db.transaction(async (tx) => {
    await tx.delete(game)
    // Board reactions and bids belong to the manager who received them.
    await tx.delete(clubNews)
    await tx.delete(transferOffers)

    // Results and the money they moved belong to the save being discarded.
    // `match_events` references `matches`, so it goes first.
    await tx.delete(matchEvents)
    await tx.delete(matches)
    await tx.delete(seasonSummary)
    await tx.delete(financeLedger)
    await tx.delete(sponsorshipDeals)
    await tx.delete(stadiumEvents)
    await tx.delete(loans)
    await tx.update(seasonTable).set({ ended: 'false' })

    /**
     * A save owns its clubs' finances, not just its results.
     *
     * Only the `game` row and the fixtures used to be replaced, so a second save
     * on the same database inherited the first one's bank balances, ticket
     * prices and ventures. A brand-new game could open with a club that had
     * already spent two seasons going broke, and every projection built on that
     * balance was fiction. Balances come back from the same
     * `startingBalanceFor()` the seed uses, and every venture returns to its
     * opening state — including a ground whose name had been sold.
     */
    for (const row of allTeams) {
      await tx.update(teams).set({
        bankBalance: startingBalanceFor(row.reputation, row.stadiumCapacity),
        ticketPrice: fairTicketPrice(row.reputation),
        stadiumName: row.stadiumBaseName ?? row.stadiumName,
        stadiumBaseName: row.stadiumBaseName ?? row.stadiumName,
        perimeterLevel: 0,
        hospitalityBoxes: 0,
        academyLevel: DEFAULT_FACILITY_LEVEL,
        trainingLevel: DEFAULT_FACILITY_LEVEL,
        seasonTicketShare: 0,
        seasonTicketDiscount: DEFAULT_SEASON_TICKET_DISCOUNT,
        pitchCondition: 100,
        // A saved XI may name a player who retired during the previous save.
        lineup: null,
      }).where(eq(teams.id, row.id))
    }

    /**
     * The club opens with its three shirt-and-kit slots already sold at the
     * market rate, and its ground still called what it has always been called.
     *
     * Starting with everything unsold would have been the tidier model and is
     * wrong twice over: a real club is never between every sponsor at once, and
     * a manager would spend their first season earning back income the game had
     * silently taken off them. Naming rights are left unsold because that one
     * *is* a decision — it is the slot with something to lose.
     */
    const pool = commercialPoolFor(club.reputation, boardExpectation, table.length || 20)
    await tx.insert(sponsorshipDeals).values(openingDeals({
      teamId: input.teamId,
      season: OPENING_SEASON,
      slotFee: slot => slotValueFor(pool, slot),
    }))

    if (fixtures.length)
      await tx.insert(matches).values(fixtures)

    const inserted = await tx.insert(game).values({
      playerTeamId: input.teamId,
      season: OPENING_SEASON,
      /**
       * The instant before the season's first kickoff.
       *
       * This was `new Date()` — the real wall clock — while fixtures are dated
       * from a fixed season start (10 August 2024 for season 1). Once that date
       * passed in the real world, every fixture in a brand-new save was already
       * behind the calendar, and anything reading the schedule as "dated ahead
       * of today" came back empty: the dashboard drew Club Status with nothing
       * beside it, no Next Match card and no way to reach Matchday.
       * `rollOverSeason` has always set the cursor from the fixture list rather
       * than from the clock; this now matches it.
       */
      currentDate: new Date(startDate.getTime() - 1000),
      sackingEnabled: input.sackingEnabled ? 1 : 0,
      boardExpectation,
    }).returning()

    return inserted[0]!
  })
}
