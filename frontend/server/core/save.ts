/**
 * The save's own lifecycle.
 *
 * A save is identified by an anonymous UUID token, set as an httpOnly
 * cookie the moment `createSave()` runs and resolved on every request by
 * `server/middleware/save-context.ts` into `event.context.gameId`. There is
 * no login — any visitor who starts a game gets their own save, and the
 * cookie is what routes their browser back to it.
 *
 * `teams` and `players` hold two kinds of row: seed *template* rows
 * (`game_id IS NULL`, the reference roster `db:seed` produces) and live
 * per-save *clones* (`game_id` set, owned by exactly one save).
 * `createSave()` clones an entire world of templates into a fresh
 * namespace rather than resetting the shared template rows in place —
 * that in-place reset is what used to make every new save overwrite the
 * one before it.
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
 * read-only routes that only need the row to exist. Both take the request's
 * `H3Event` so they can resolve `event.context.gameId` — set once per
 * request by the save-context middleware — instead of guessing which save a
 * caller means.
 */
import type { H3Event } from 'h3'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../db'
import {
  game,
  matches,
  players,
  season as seasonTable,
  sponsorshipDeals,
  teams,
} from '../db/schema'
import { buildSeasonFixtures, seasonStartDate } from './calendar'
import { expectationFor } from './board'
import {
  DEFAULT_FACILITY_LEVEL,
  DEFAULT_SEASON_TICKET_DISCOUNT,
  commercialPoolFor,
  fairTicketPrice,
  slotValueFor,
  squadStrength,
  startingBalanceFor,
} from './economy'
import { openingDeals } from './sponsors'

export type GameRow = typeof game.$inferSelect

/** Every save starts in season 1. */
export const OPENING_SEASON = 1

/** The current save for this request, or null when none exists. */
export async function activeSave(event: H3Event): Promise<GameRow | null> {
  const gameId = event.context.gameId
  if (!gameId) return null
  return (await db.query.game.findFirst({ where: eq(game.id, gameId) })) ?? null
}

/** The current save for this request. 404s when there isn't one. */
export async function requireSave(event: H3Event): Promise<GameRow> {
  const gameState = await activeSave(event)

  if (!gameState) {
    throw createError({ statusCode: 404, statusMessage: 'Game not found' })
  }

  return gameState
}

/**
 * The current save for this request, refusing anything a dismissed manager
 * should not be able to do — playing a match, buying, selling, renaming an
 * XI, rolling a season over.
 *
 * Deliberately *not* applied to `POST /api/match/finish`: that route only
 * commits a match already in flight, and dismissal is decided by
 * `settleBoardForMatchday()` at the end of that very call. Guarding it would
 * make the client's retry-on-failure path 403 on a result the server had in fact
 * already saved. Blocking `start`, `advance` and `changes` is what actually
 * prevents a new result being produced.
 */
export async function requireActiveManager(event: H3Event): Promise<GameRow> {
  const gameState = await requireSave(event)

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
 * Ranks the template roster of one league by squad strength, the same way
 * `seed.ts`'s economy pass does. Needed because `createSave()` has to size
 * the chosen club's opening board expectation *before* any fixtures (and
 * therefore any standings) exist for this save — `computeStandings()` reads
 * `matches`, which a save that doesn't exist yet has none of.
 */
async function rankTemplateLeague(leagueId: number): Promise<{ teamId: number }[]> {
  const leagueTeams = await db.query.teams.findMany({
    where: and(eq(teams.leagueId, leagueId), isNull(teams.gameId)),
  })
  if (!leagueTeams.length) return []

  const squadByTeam = new Map<number, { skillLevel: number }[]>()
  for (const team of leagueTeams) {
    squadByTeam.set(team.id, await db.query.players.findMany({
      where: and(eq(players.teamId, team.id), isNull(players.gameId)),
      columns: { skillLevel: true },
    }))
  }

  return [...leagueTeams]
    .sort((a, b) => squadStrength(squadByTeam.get(b.id) ?? []) - squadStrength(squadByTeam.get(a.id) ?? []))
    .map(team => ({ teamId: team.id }))
}

/**
 * Creates a save by cloning the template roster into a fresh, save-owned
 * namespace.
 *
 * `input.teamId` is always a *template* team id (`game_id IS NULL`) — the
 * new-game wizard only ever lists template teams (`GET /api/teams`). Every
 * template team in both leagues is cloned into this save (not just the
 * player's own club), because the player's world needs forty clubs to
 * compete against, not one.
 *
 * The `game` row is inserted first, with foreign-key checks deferred for
 * the rest of the transaction (`PRAGMA defer_foreign_keys = ON`), because
 * every child row below (`teams.game_id`, `players.game_id`,
 * `season.game_id`, `matches.game_id`) needs `game.id` to already exist as
 * a value, while `game.player_team_id`/`game.season` themselves can only be
 * known once the clones exist. SQLite only re-checks deferred FKs at COMMIT,
 * by which point every row is consistent.
 *
 * Squads are deliberately cloned, never referenced: two saves must never
 * share a player row, or a transfer/injury/retirement in one save would
 * silently show up in another's.
 */
export async function createSave(input: { teamId: number; sackingEnabled?: boolean }): Promise<GameRow> {
  const templateClub = await db.query.teams.findFirst({
    where: and(eq(teams.id, input.teamId), isNull(teams.gameId)),
  })
  if (!templateClub)
    throw createError({ statusCode: 404, statusMessage: 'Club not found' })

  const table = await rankTemplateLeague(templateClub.leagueId)
  const boardExpectation = expectationFor(templateClub.reputation, null, table.length || 20)

  const leagues = await db.query.leagues.findMany()
  const templateTeams = await db.query.teams.findMany({ where: isNull(teams.gameId) })
  const templatePlayers = await db.query.players.findMany({ where: isNull(players.gameId) })

  const token = crypto.randomUUID()

  return db.transaction(async (tx) => {
    // Deferred rather than off: still enforced at COMMIT, just not after
    // every individual statement — which is what lets `game` be inserted
    // before the rows it references (its own clones) exist yet.
    await tx.run(sql`PRAGMA defer_foreign_keys = ON`)

    const [gameRow] = await tx.insert(game).values({
      token,
      // `playerTeamId` is a placeholder — patched once the clones below give
      // us the real cloned club id. Safe only because foreign-key checks are
      // deferred to COMMIT. `season` needs no such patch: it's a plain
      // number, not a foreign key, so OPENING_SEASON is already correct.
      playerTeamId: input.teamId,
      season: OPENING_SEASON,
      currentDate: new Date(),
      sackingEnabled: input.sackingEnabled ? 1 : 0,
      boardExpectation,
    }).returning()
    if (!gameRow) throw createError({ statusCode: 500, statusMessage: 'Failed to create save' })

    // ---- Clone every template team into this save's namespace -------------
    const clonedTeamIdByTemplateId = new Map<number, number>()
    for (const row of templateTeams) {
      const [cloned] = await tx.insert(teams).values({
        gameId: gameRow.id,
        name: row.name,
        leagueId: row.leagueId,
        bankBalance: startingBalanceFor(row.reputation, row.stadiumCapacity),
        tactics: null,
        lineup: null,
        reputation: row.reputation,
        stadiumName: row.stadiumBaseName ?? row.stadiumName,
        stadiumBaseName: row.stadiumBaseName ?? row.stadiumName,
        stadiumCapacity: row.stadiumCapacity,
        ticketPrice: fairTicketPrice(row.reputation),
        perimeterLevel: 0,
        hospitalityBoxes: 0,
        academyLevel: DEFAULT_FACILITY_LEVEL,
        trainingLevel: DEFAULT_FACILITY_LEVEL,
        seasonTicketShare: 0,
        seasonTicketDiscount: DEFAULT_SEASON_TICKET_DISCOUNT,
        pitchCondition: 100,
      }).returning({ id: teams.id })
      if (!cloned) throw createError({ statusCode: 500, statusMessage: 'Failed to clone team' })
      clonedTeamIdByTemplateId.set(row.id, cloned.id)
    }

    // ---- Clone every template player onto their cloned club ---------------
    const playerRows = templatePlayers.map(player => ({
      gameId: gameRow.id,
      name: player.name,
      age: player.age,
      position: player.position,
      skillLevel: player.skillLevel,
      potential: player.potential,
      stamina: 100,
      injuredMatches: 0,
      retired: 0,
      marketValue: player.marketValue,
      wage: player.wage,
      contractUntilSeason: player.contractUntilSeason,
      freeAgent: 0,
      teamId: clonedTeamIdByTemplateId.get(player.teamId)!,
    }))
    if (playerRows.length)
      await tx.insert(players).values(playerRows)

    // ---- Opening sponsorship deals, on the cloned club ---------------------
    const clonedPlayerClubId = clonedTeamIdByTemplateId.get(input.teamId)!
    const pool = commercialPoolFor(templateClub.reputation, boardExpectation, table.length || 20)
    await tx.insert(sponsorshipDeals).values(openingDeals({
      teamId: clonedPlayerClubId,
      season: OPENING_SEASON,
      slotFee: slot => slotValueFor(pool, slot),
    }))

    // ---- This save's own season 1 row (year/ended bookkeeping only) -------
    await tx.insert(seasonTable).values({
      gameId: gameRow.id,
      seasonNumber: OPENING_SEASON,
      year: '2024',
      ended: 'false',
    })

    // ---- This save's own season-1 fixtures, over the cloned team ids ------
    const startDate = seasonStartDate(OPENING_SEASON)
    const fixtures: (typeof matches.$inferInsert)[] = []

    for (const league of leagues) {
      const leagueTeamIds = templateTeams
        .filter(t => t.leagueId === league.id)
        .map(t => clonedTeamIdByTemplateId.get(t.id))
        .filter((id): id is number => id !== undefined)

      if (leagueTeamIds.length < 2) continue

      fixtures.push(...buildSeasonFixtures(leagueTeamIds, OPENING_SEASON, startDate)
        .map(fixture => ({ ...fixture, gameId: gameRow.id })))
    }
    if (fixtures.length)
      await tx.insert(matches).values(fixtures)

    // ---- Patch the game row with the real playerTeamId ---------------------
    const [finalGame] = await tx.update(game)
      .set({
        playerTeamId: clonedPlayerClubId,
        currentDate: new Date(startDate.getTime() - 1000),
      })
      .where(eq(game.id, gameRow.id))
      .returning()

    if (!finalGame) throw createError({ statusCode: 500, statusMessage: 'Failed to finalize save' })
    return finalGame
  })
}
