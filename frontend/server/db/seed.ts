import { db } from './index'
import * as schema from './schema'
import { faker } from '@faker-js/faker'
import { readFileSync } from 'fs'
import { join } from 'path'

// Load league data from JSON files
const premierLeagueData = JSON.parse(
  readFileSync(join(__dirname, 'data/premier-league.json'), 'utf-8')
)
const laLigaData = JSON.parse(
  readFileSync(join(__dirname, 'data/la-liga.json'), 'utf-8')
)

// Clear existing data in correct order (to avoid foreign key constraint issues)
await db.delete(schema.matchEvents)
await db.delete(schema.matches)
await db.delete(schema.eventType)
await db.delete(schema.game)
await db.delete(schema.season)
await db.delete(schema.players)
await db.delete(schema.teams)
await db.delete(schema.leagues)
await db.delete(schema.countries)

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

// Seed 5 playable Seasons
const seasonData = []
for (let year = 2024; year <= 2030; year++) {
  seasonData.push({ year: year.toString(), ended: 'false' })
}
await db
  .insert(schema.season)
  .values(seasonData)
  .returning()

// Seed player positions
const positionData = [
  { name: 'GK' },
  { name: 'DEF' },
  { name: 'MID' },
  { name: 'ATT' },
]
await db
  .insert(schema.positions)
  .values(positionData)
  .returning()

// Seed event types (map common match events to ids)
const eventTypes = [
  { name: 'goal' },
  { name: 'shot' },
  { name: 'miss' },
  { name: 'yellow' },
  { name: 'red' },
  { name: 'foul' },
  { name: 'injury' },
]
await db
  .insert(schema.eventType)
  .values(eventTypes)
  .returning()

// Seed Teams and Players
for (let leagueIndex = 0; leagueIndex < seededLeagues.length; leagueIndex++) {
  const league = seededLeagues[leagueIndex]
  const leagueData = leagueIndex === 0 ? premierLeagueData : laLigaData
  const teamNames = leagueData.teams
  const playersData = leagueData.players

  for (let i = 0; i < teamNames.length; i++) {
    const teamName = teamNames[i]
    const team = await db
      .insert(schema.teams)
      .values({
        name: teamName,
        leagueId: league.id,
        bankBalance: faker.number.int({ min: 1000000, max: 50000000 }),
      })
      .returning()

    // Use real players if available, otherwise generate fake ones
    const teamPlayers = playersData[teamName]
    if (teamPlayers && teamPlayers.length > 0) {
      // Insert real players
      for (const playerData of teamPlayers) {
        await db.insert(schema.players).values({
          name: playerData.name,
          age: playerData.age,
          position: playerData.position,
          skillLevel: playerData.skillLevel,
          stamina: 100,
          marketValue: faker.number.int({
            min: playerData.skillLevel * 50000,
            max: playerData.skillLevel * 250000
          }),
          teamId: team[0].id,
        })
      }
    } else {
      // Generate fake players for teams without real data
      for (let j = 0; j < 22; j++) {
        await db.insert(schema.players).values({
          name: faker.person.fullName(),
          age: faker.number.int({ min: 18, max: 35 }),
          position: ['GK', 'DEF', 'MID', 'ATT'][
            faker.number.int({ min: 0, max: 3 })
          ],
          skillLevel: faker.number.int({ min: 50, max: 79 }),
          stamina: 100,
          marketValue: faker.number.int({ min: 100000, max: 20000000 }),
          teamId: team[0].id,
        })
      }
    }
  }
}

// Generate a full season schedule for all leagues
const generateSchedule = (teams: { id: number }[]) => {
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
          season: 1,
          matchDate: faker.date.future(),
        })
      }
      else {
        schedule.push({
          homeTeamId: awayTeamId,
          awayTeamId: homeTeamId,
          season: 1,
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

// Generate schedules for all leagues
for (const league of seededLeagues) {
  const teamsInLeague = await db.query.teams.findMany({
    where: (teams, { eq }) => eq(teams.leagueId, league.id),
  })

  if (teamsInLeague.length > 0) {
    const schedule = generateSchedule(teamsInLeague)
    if (schedule.length > 0) {
      await db.insert(schema.matches).values(schedule)
    }
  }
}

process.exit(0)