import { db } from './index'
import * as schema from './schema'
import { faker } from '@faker-js/faker'

// Clear existing data
await db.delete(schema.countries)
await db.delete(schema.leagues)
await db.delete(schema.teams)
await db.delete(schema.players)

// Seed Countries
const countryData = [{ name: 'England' }, { name: 'Spain' }]
const seededCountries = await db
  .insert(schema.countries)
  .values(countryData)
  .returning()

// Seed Leagues
const leagueData = [
  { name: 'Premier League', countryId: seededCountries[0].id },
  { name: 'La Liga', countryId: seededCountries[1].id },
]
const seededLeagues = await db
  .insert(schema.leagues)
  .values(leagueData)
  .returning()

// Seed Teams and Players
for (const league of seededLeagues) {
  for (let i = 0; i < 20; i++) {
    const team = await db
      .insert(schema.teams)
      .values({
        name: faker.company.name(),
        leagueId: league.id,
        bankBalance: faker.number.int({ min: 1000000, max: 50000000 }),
      })
      .returning()

    for (let j = 0; j < 22; j++) {
      await db.insert(schema.players).values({
        name: faker.person.fullName(),
        age: faker.number.int({ min: 18, max: 35 }),
        position: ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'][
          faker.number.int({ min: 0, max: 3 })
        ],
        skillLevel: faker.number.int({ min: 60, max: 90 }),
        stamina: 100,
        marketValue: faker.number.int({ min: 100000, max: 20000000 }),
        teamId: team[0].id,
      })
    }
  }
}

// Generate a full season schedule for the first league
const teamsInFirstLeague = await db.query.teams.findMany({
  where: (teams, { eq }) => eq(teams.leagueId, seededLeagues[0].id),
})

const generateSchedule = (teams: (typeof teamsInFirstLeague)) => {
  const schedule = []
  const numTeams = teams.length
  const halfNumTeams = numTeams / 2
  const rounds = (numTeams - 1) * 2

  const teamIds = teams.map(t => t.id)

  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < halfNumTeams; i++) {
      const homeTeamId = teamIds[i]
      const awayTeamId = teamIds[numTeams - 1 - i]

      if (round < rounds / 2) {
        schedule.push({
          homeTeamId,
          awayTeamId,
          season: '2024/2025',
          matchDate: faker.date.future(),
        })
      }
      else {
        schedule.push({
          homeTeamId: awayTeamId,
          awayTeamId: homeTeamId,
          season: '2024/2025',
          matchDate: faker.date.future(),
        })
      }
    }
    // Rotate teams
    const lastTeam = teamIds.pop()
    if (lastTeam)
      teamIds.splice(1, 0, lastTeam)
  }
  return schedule
}

const schedule = generateSchedule(teamsInFirstLeague)
if (schedule.length > 0) {
  await db.insert(schema.matches).values(schedule)
}

console.log('Database seeded successfully!')
process.exit(0)
