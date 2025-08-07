import { db } from '../../../server/db'
import { matches, players, teams } from '../../../server/db/schema'
import { simulateMatch } from '../../../server/core/match-engine'
import { eq, and, isNull } from 'drizzle-orm'

export default defineEventHandler(async () => {
  const nextMatchToPlay = await db.query.matches.findFirst({
    where: and(isNull(matches.homeScore)),
    orderBy: (matches, { asc }) => [asc(matches.matchDate)],
  })

  if (!nextMatchToPlay) {
    return { message: 'No matches to simulate' }
  }

  const homeTeam = await db.query.teams.findFirst({
    where: eq(teams.id, nextMatchToPlay.homeTeamId),
  })
  const awayTeam = await db.query.teams.findFirst({
    where: eq(teams.id, nextMatchToPlay.awayTeamId),
  })

  if (!homeTeam || !awayTeam) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Team not found for match',
    })
  }

  // A simple way to calculate team skill level
  const homeTeamSkill = await db.query.players.findMany({ where: eq(players.teamId, homeTeam.id) }).then(p => p.reduce((acc, player) => acc + player.skillLevel, 0) / p.length)
  const awayTeamSkill = await db.query.players.findMany({ where: eq(players.teamId, awayTeam.id) }).then(p => p.reduce((acc, player) => acc + player.skillLevel, 0) / p.length)

  const result = simulateMatch(
    { ...homeTeam, skillLevel: homeTeamSkill },
    { ...awayTeam, skillLevel: awayTeamSkill },
  )

  await db
    .update(matches)
    .set({
      homeScore: result.homeScore,
      awayScore: result.awayScore,
    })
    .where(eq(matches.id, nextMatchToPlay.id))

  // You would also insert match events here

  return { ...nextMatchToPlay, ...result }
})
