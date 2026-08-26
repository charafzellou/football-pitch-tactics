/**
 * Recent form, read from the database.
 *
 * `shared/../utils/results.ts` already computes form from a fixture list on the
 * client. This is the server-side counterpart: it fetches the fixtures itself
 * and returns form for many clubs at once, because attendance needs it for
 * every club on a matchday and doing it one query per club would be twenty
 * round-trips per round.
 */
import { and, eq, isNotNull } from 'drizzle-orm'
import { db } from '../db'
import { matches, teams } from '../db/schema'

export type FormResult = 'W' | 'D' | 'L'

const FORM_WINDOW = 5

/** Team id → their last few results, oldest first. */
export async function recentForm(
  leagueId: number,
  season: number,
  teamIds: number[],
  gameId: number,
): Promise<Map<number, FormResult[]>> {
  const form = new Map<number, FormResult[]>()
  if (!teamIds.length) return form

  const leagueTeams = await db.query.teams.findMany({
    where: and(eq(teams.leagueId, leagueId), eq(teams.gameId, gameId)),
    columns: { id: true },
  })
  const inLeague = new Set(leagueTeams.map(team => team.id))

  const played = await db.query.matches.findMany({
    where: and(eq(matches.season, season), eq(matches.gameId, gameId), isNotNull(matches.homeScore)),
    orderBy: (row, { asc }) => [asc(row.round)],
  })

  for (const teamId of teamIds)
    form.set(teamId, [])

  for (const match of played) {
    if (!inLeague.has(match.homeTeamId) || !inLeague.has(match.awayTeamId))
      continue

    const homeScore = match.homeScore!
    const awayScore = match.awayScore!

    push(form, match.homeTeamId, homeScore > awayScore ? 'W' : homeScore === awayScore ? 'D' : 'L')
    push(form, match.awayTeamId, awayScore > homeScore ? 'W' : awayScore === homeScore ? 'D' : 'L')
  }

  for (const [teamId, results] of form)
    form.set(teamId, results.slice(-FORM_WINDOW))

  return form
}

function push(form: Map<number, FormResult[]>, teamId: number, result: FormResult) {
  const existing = form.get(teamId)
  if (existing) existing.push(result)
}
