import { db } from '../../server/db'
import { teams, matches } from '../../server/db/schema'
import { and, eq, isNotNull, or } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const leagueId = Number(getQuery(event).leagueId)
  if (!leagueId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'League ID is required',
    })
  }

  const leagueTeams = await db.query.teams.findMany({
    where: eq(teams.leagueId, leagueId),
  })

  const standings = await Promise.all(
    leagueTeams.map(async (team) => {
      const playedMatches = await db.query.matches.findMany({
        where: and(
          eq(matches.season, '2024/2025'),
          or(eq(matches.homeTeamId, team.id), eq(matches.awayTeamId, team.id)),
          isNotNull(matches.homeScore),
        ),
      })

      let points = 0
      let wins = 0
      let draws = 0
      let losses = 0
      let goalsFor = 0
      let goalsAgainst = 0

      for (const match of playedMatches) {
        if (match.homeTeamId === team.id) {
          goalsFor += match.homeScore!
          goalsAgainst += match.awayScore!
          if (match.homeScore! > match.awayScore!) {
            points += 3
            wins++
          }
          else if (match.homeScore! === match.awayScore!) {
            points += 1
            draws++
          }
          else {
            losses++
          }
        }
        else {
          goalsFor += match.awayScore!
          goalsAgainst += match.homeScore!
          if (match.awayScore! > match.homeScore!) {
            points += 3
            wins++
          }
          else if (match.awayScore! === match.homeScore!) {
            points += 1
            draws++
          }
          else {
            losses++
          }
        }
      }

      return {
        teamName: team.name,
        played: playedMatches.length,
        wins,
        draws,
        losses,
        goalsFor,
        goalsAgainst,
        goalDifference: goalsFor - goalsAgainst,
        points,
      }
    }),
  )

  return standings.sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference)
})
