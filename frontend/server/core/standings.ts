/**
 * League table computation.
 *
 * Extracted from `GET /api/standings` so the season rollover crowns the same
 * champion the table shows. The route also hardcoded `season = 1`, which would
 * have silently kept showing season 1 forever once a rollover happened.
 *
 * One query per league rather than one per club — the old version issued 20.
 */
import { and, eq, isNotNull, or } from 'drizzle-orm'
import { db } from '../db'
import { matches, teams } from '../db/schema'

export interface StandingRow {
  teamId: number
  teamName: string
  played: number
  wins: number
  draws: number
  losses: number
  goalsFor: number
  goalsAgainst: number
  goalDifference: number
  points: number
}

export async function computeStandings(leagueId: number, season: number): Promise<StandingRow[]> {
  const leagueTeams = await db.query.teams.findMany({ where: eq(teams.leagueId, leagueId) })
  if (!leagueTeams.length)
    return []

  const teamIds = new Set(leagueTeams.map(team => team.id))

  const played = await db.query.matches.findMany({
    where: and(eq(matches.season, season), isNotNull(matches.homeScore)),
  })

  const rows = new Map<number, StandingRow>(
    leagueTeams.map(team => [team.id, {
      teamId: team.id,
      teamName: team.name,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0,
    }]),
  )

  for (const match of played) {
    // Cross-league fixtures don't exist today, but filtering here means a cup
    // or a friendly could not silently corrupt a league table later.
    if (!teamIds.has(match.homeTeamId) || !teamIds.has(match.awayTeamId))
      continue

    const homeScore = match.homeScore!
    const awayScore = match.awayScore!

    applyResult(rows.get(match.homeTeamId), homeScore, awayScore)
    applyResult(rows.get(match.awayTeamId), awayScore, homeScore)
  }

  return [...rows.values()]
    .map(row => ({ ...row, goalDifference: row.goalsFor - row.goalsAgainst }))
    .sort(byLeaguePosition)
}

function applyResult(row: StandingRow | undefined, scored: number, conceded: number) {
  if (!row)
    return

  row.played++
  row.goalsFor += scored
  row.goalsAgainst += conceded

  if (scored > conceded) {
    row.wins++
    row.points += 3
  }
  else if (scored === conceded) {
    row.draws++
    row.points += 1
  }
  else {
    row.losses++
  }
}

/** Points, then goal difference, then goals scored, then name. */
export function byLeaguePosition(a: StandingRow, b: StandingRow): number {
  return b.points - a.points
    || b.goalDifference - a.goalDifference
    || b.goalsFor - a.goalsFor
    || a.teamName.localeCompare(b.teamName)
}
