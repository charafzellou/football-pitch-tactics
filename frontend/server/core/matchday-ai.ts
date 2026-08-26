/**
 * Resolution of fixtures the human manager isn't playing.
 *
 * Before this existed, only matches involving the player's club were ever
 * simulated — 2 of 760 in a fresh save — so the league table was fiction and a
 * season could never complete. Every other club's fixtures are now played out
 * headlessly the moment the calendar passes them.
 *
 * No new simulation code: `kickOff()` + `simulateSegment(..., 90)` is a
 * complete match, and `buildTeam()` already flags every non-player club
 * `autoManaged`, so CPU substitutions and injury reactions work unchanged.
 */
import { and, eq, inArray, lte, ne, or } from 'drizzle-orm'
import { db } from '../db'
import { matches, players, teams } from '../db/schema'
import { buildTeam, insertEvents } from './match-session'
import { kickOff, simulateSegment } from './match-engine'
import { buildMatchdayContext, settleMatchFinances } from './finance'
import type { MatchdayContext } from './finance'
import { injuryRecoveryChance, trainingRecoveryBonus } from './progression'
import type { MatchState } from '#shared/match-state'
import {
  INJURY_MATCHES_MAX,
  INJURY_MATCHES_MIN,
  MATCH_MINUTES,
  recoveredStamina,
} from '#shared/match-state'

/** The transaction handle Drizzle hands to `db.transaction`. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Writes end-of-match fitness for everyone who took part.
 *
 * Extracted from `POST /api/match/finish` so the player's match and every AI
 * match settle through the identical path — otherwise the two could drift and
 * only the human's squad would tire.
 *
 * The original did a `SELECT` per player inside the transaction; at 19 AI
 * matches a round that is ~570 round-trips. This reads every affected player
 * once and then writes.
 */
export async function settleMatchFitness(tx: Tx, state: MatchState): Promise<void> {
  const staminaByPlayer = new Map<number, number>()
  const newlyInjured = new Set<number>()

  for (const side of [state.home, state.away]) {
    for (const injuredId of side.injured)
      newlyInjured.add(injuredId)

    for (const [rawId, stamina] of Object.entries(side.stamina))
      staminaByPlayer.set(Number(rawId), stamina)
  }

  const ids = [...staminaByPlayer.keys()]
  if (!ids.length)
    return

  const current = await tx.query.players.findMany({ where: inArray(players.id, ids) })

  /**
   * The training grounds these players go back to.
   *
   * Recovery is the one facility effect a manager feels inside a season, so it
   * has to be read per club rather than assumed — and it is read once for the
   * two clubs involved rather than once per player.
   */
  const teamIds = [...new Set(current.map(player => player.teamId))]
  const clubs = teamIds.length
    ? await tx.query.teams.findMany({ where: inArray(teams.id, teamIds) })
    : []
  const trainingByTeam = new Map(clubs.map(club => [club.id, club.trainingLevel]))

  for (const player of current) {
    const stamina = staminaByPlayer.get(player.id)
    if (stamina === undefined)
      continue

    const trainingLevel = trainingByTeam.get(player.teamId) ?? 1

    // A player already sitting out counts this match against their absence;
    // a fresh injury starts a new one. A good physio department sometimes takes
    // an extra match off an existing absence, never off a new one.
    const healed = 1 + (Math.random() < injuryRecoveryChance(trainingLevel) ? 1 : 0)
    const injuredMatches = newlyInjured.has(player.id)
      ? INJURY_MATCHES_MIN + Math.floor(Math.random() * (INJURY_MATCHES_MAX - INJURY_MATCHES_MIN + 1))
      : Math.max(0, (player.injuredMatches ?? 0) - healed)

    // `players.stamina` is written as the value the player will *start* their
    // next match with, so the lineup builder shows the truth rather than a
    // pre-recovery number the engine would silently improve at kickoff.
    const recovered = recoveredStamina(stamina) + trainingRecoveryBonus(trainingLevel)

    await tx.update(players)
      .set({ stamina: Math.round(Math.min(100, recovered)), injuredMatches })
      .where(eq(players.id, player.id))
  }
}

export interface ResolutionResult {
  resolved: number
  skipped: number
}

/**
 * Plays out every unplayed fixture dated at or before `date` that the human
 * manager isn't involved in.
 *
 * Their own fixtures are deliberately excluded — those are played manually on
 * the matchday screen, and silently simulating one would rob them of the match.
 */
export async function resolveFixturesUpTo(date: Date, playerTeamId: number, gameId: number): Promise<ResolutionResult> {
  const due = await db.query.matches.findMany({
    where: and(
      eq(matches.gameId, gameId),
      eq(matches.played, 0),
      lte(matches.matchDate, date),
      ne(matches.homeTeamId, playerTeamId),
      ne(matches.awayTeamId, playerTeamId),
    ),
    orderBy: (row, { asc }) => [asc(row.matchDate), asc(row.id)],
  })

  if (!due.length)
    return { resolved: 0, skipped: 0 }

  // One read of every club involved, rather than two per fixture.
  const teamIds = [...new Set(due.flatMap(fixture => [fixture.homeTeamId, fixture.awayTeamId]))]
  const teamRows = await db.query.teams.findMany({ where: inArray(teams.id, teamIds) })
  const tacticByTeam = new Map(teamRows.map(team => [team.id, team.tactics]))

  // League context (positions and form) is built once per league rather than
  // per fixture — attendance needs it for every club on the matchday.
  const leagueByTeam = new Map(teamRows.map(team => [team.id, team.leagueId]))
  const contexts = new Map<string, MatchdayContext>()

  async function contextFor(leagueId: number, season: number, round: number) {
    const key = `${leagueId}:${season}:${round}`
    let context = contexts.get(key)
    if (!context) {
      context = await buildMatchdayContext(leagueId, season, round, gameId)
      contexts.set(key, context)
    }
    return context
  }

  let resolved = 0
  let skipped = 0

  for (const fixture of due) {
    const leagueId = leagueByTeam.get(fixture.homeTeamId)
    const context = leagueId ? await contextFor(leagueId, fixture.season, fixture.round) : null

    const played = await playFixture(fixture, tacticByTeam, playerTeamId, context)
    if (played) resolved++
    else skipped++
  }

  return { resolved, skipped }
}

async function playFixture(
  fixture: { id: number; homeTeamId: number; awayTeamId: number },
  tacticByTeam: Map<number, string | null>,
  playerTeamId: number,
  financeContext: MatchdayContext | null,
): Promise<boolean> {
  const home = await buildTeam(fixture.homeTeamId, tacticByTeam.get(fixture.homeTeamId), playerTeamId)
  const away = await buildTeam(fixture.awayTeamId, tacticByTeam.get(fixture.awayTeamId), playerTeamId)

  // A club with nobody left to field cannot play. This should not happen, but
  // leaving the fixture unplayed is far better than crashing a whole matchday
  // — and season completion will surface it rather than hiding it.
  if (!home.squad.length || !away.squad.length)
    return false

  const { state, events } = simulateSegment(home, away, kickOff(home, away), MATCH_MINUTES)

  await insertEvents(fixture.id, events)

  await db.transaction(async (tx) => {
    await tx.update(matches).set({
      homeScore: state.home.score,
      awayScore: state.away.score,
      played: 1,
      state: null,
    }).where(eq(matches.id, fixture.id))

    await settleMatchFitness(tx, state)

    // Wages, gate receipts and commercial income — identical to the path the
    // player's own match takes, so AI clubs are never running cost-free.
    if (financeContext)
      await settleMatchFinances(tx, fixture.homeTeamId, fixture.awayTeamId, financeContext)
  })

  return true
}

/**
 * Fixtures still outstanding for a season, ignoring dates.
 * Used by season-end detection.
 */
export async function unplayedFixtureCount(season: number): Promise<number> {
  const rows = await db.query.matches.findMany({
    where: and(eq(matches.season, season), eq(matches.played, 0)),
    columns: { id: true },
  })
  return rows.length
}

/**
 * Every fixture in the season the player's club is *not* in, regardless of
 * date. Used to finish out a season when the player has played all of theirs
 * but AI fixtures on later dates remain.
 */
export async function remainingAiFixtures(season: number, playerTeamId: number) {
  return db.query.matches.findMany({
    where: and(
      eq(matches.season, season),
      eq(matches.played, 0),
      ne(matches.homeTeamId, playerTeamId),
      ne(matches.awayTeamId, playerTeamId),
    ),
    columns: { id: true },
  })
}

/** Fixtures the player still has to play personally this season. */
export async function remainingPlayerFixtures(season: number, playerTeamId: number) {
  return db.query.matches.findMany({
    where: and(
      eq(matches.season, season),
      eq(matches.played, 0),
      or(eq(matches.homeTeamId, playerTeamId), eq(matches.awayTeamId, playerTeamId)),
    ),
    orderBy: (row, { asc }) => [asc(row.matchDate)],
  })
}
