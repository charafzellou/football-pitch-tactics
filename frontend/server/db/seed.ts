import { db } from './index'
import * as schema from './schema'
import { faker } from '@faker-js/faker'
import { readFileSync } from 'fs'
import { join } from 'path'
import { eq } from 'drizzle-orm'
import { buildSeasonFixtures } from '../core/calendar'
import { SQUAD_SHAPE, initialPotential, marketValueFor, positionsToFill } from '../core/progression'
import type { PositionCode } from '../core/progression'
import {
  fairTicketPrice,
  reputationFor,
  squadStrength,
  stadiumCapacityFor,
  stadiumNameFor,
  startingBalanceFor,
  wageFor,
} from '../core/economy'

interface SeedPlayer {
  name: string
  age: number
  position: string
  skillLevel: number
}

interface LeagueSeedData {
  teams: string[]
  players: Record<string, SeedPlayer[]>
}

// Load league data from JSON files
const premierLeagueData = JSON.parse(
  readFileSync(join(__dirname, 'data/premier-league.json'), 'utf-8')
) as LeagueSeedData
const laLigaData = JSON.parse(
  readFileSync(join(__dirname, 'data/la-liga.json'), 'utf-8')
) as LeagueSeedData

// Clear existing data in correct order (to avoid foreign key constraint issues).
// `season_summary` references season, leagues and teams, so it has to go before
// any of them.
await db.delete(schema.matchEvents)
await db.delete(schema.matches)
await db.delete(schema.seasonSummary)
await db.delete(schema.transferOffers)
await db.delete(schema.clubNews)
await db.delete(schema.financeLedger)
await db.delete(schema.eventType)
await db.delete(schema.game)
await db.delete(schema.season)
await db.delete(schema.players)
await db.delete(schema.positions)
await db.delete(schema.teams)
await db.delete(schema.leagues)
await db.delete(schema.countries)

// Seed Countries
const countryData = [{ name: 'England' }, { name: 'Spain' }]
const seededCountries = await db
  .insert(schema.countries)
  .values(countryData)
  .returning()

const england = seededCountries[0]
const spain = seededCountries[1]

if (!england || !spain)
  throw new Error('Failed to seed countries')

// Seed Leagues
const leagueData = [
  { name: 'Premier League', countryId: england.id },
  { name: 'La Liga', countryId: spain.id },
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

// Seed event types (map common match events to ids).
// Kept in sync with the event types the match engine generates — see
// EVENT_RATES in server/core/match-engine.ts.
const eventTypes = [
  { name: 'goal' },
  { name: 'shot' },
  { name: 'shot_on_target' },
  { name: 'yellow' },
  { name: 'red' },
  { name: 'foul' },
  { name: 'injury' },
  { name: 'corner' },
  { name: 'cross' },
  { name: 'offside' },
  { name: 'substitution' },
]
await db
  .insert(schema.eventType)
  .values(eventTypes)
  .returning()

// Seed Teams and Players
for (let leagueIndex = 0; leagueIndex < seededLeagues.length; leagueIndex++) {
  const league = seededLeagues[leagueIndex]
  if (!league)
    continue

  const leagueData = leagueIndex === 0 ? premierLeagueData : laLigaData
  const teamNames = leagueData.teams
  const playersData = leagueData.players

  for (let i = 0; i < teamNames.length; i++) {
    const teamName = teamNames[i]
    if (!teamName)
      continue

    const team = await db
      .insert(schema.teams)
      .values({
        name: teamName,
        leagueId: league.id,
        bankBalance: faker.number.int({ min: 1000000, max: 50000000 }),
      })
      .returning()

    const insertedTeam = team[0]
    if (!insertedTeam)
      throw new Error(`Failed to seed team: ${teamName}`)

    // Use real players if available, otherwise generate fake ones
    const teamPlayers = playersData[teamName]
    if (teamPlayers && teamPlayers.length > 0) {
      // Insert real players
      await db.insert(schema.players).values(teamPlayers.map(playerData => ({
        name: playerData.name,
        age: playerData.age,
        position: playerData.position,
        skillLevel: playerData.skillLevel,
        potential: initialPotential(playerData.skillLevel, playerData.age),
        stamina: 100,
        marketValue: marketValueFor(playerData.skillLevel, playerData.age),
        teamId: insertedTeam.id,
      })))
    } else {
      // Generated squads for clubs without real data.
      //
      // Positions come from `positionsToFill` rather than a uniform random
      // draw: the old version could hand a club eight goalkeepers and no
      // forwards, which is why lineup auto-selection needs a fallback path.
      const empty = { GK: 0, DEF: 0, MID: 0, ATT: 0 } as Record<PositionCode, number>
      const squadSize = Object.values(SQUAD_SHAPE).reduce((total, n) => total + n, 0)

      await db.insert(schema.players).values(positionsToFill(empty, squadSize).map((position) => {
        const age = faker.number.int({ min: 18, max: 35 })
        const skillLevel = faker.number.int({ min: 50, max: 79 })
        const potential = initialPotential(skillLevel, age)

        return {
          name: faker.person.fullName(),
          age,
          position,
          skillLevel,
          potential,
          stamina: 100,
          marketValue: marketValueFor(skillLevel, age, potential),
          teamId: insertedTeam.id,
        }
      }))
    }
  }
}

/**
 * Economy pass.
 *
 * Runs after every squad exists because reputation is partly a club's *rank*
 * within its league, which can't be known until all of them are seeded. It then
 * cascades: reputation sizes the stadium, the stadium and reputation set the
 * ticket price and starting balance, and reputation feeds back into wages so a
 * bigger club pays more for the same player.
 */
for (const league of seededLeagues) {
  const leagueTeams = await db.query.teams.findMany({
    where: (teams, { eq }) => eq(teams.leagueId, league.id),
  })
  if (!leagueTeams.length)
    continue

  const squads = new Map<number, { skillLevel: number; id: number; age: number; marketValue: number }[]>()
  for (const team of leagueTeams) {
    squads.set(team.id, await db.query.players.findMany({
      where: (players, { eq }) => eq(players.teamId, team.id),
      columns: { id: true, age: true, skillLevel: true, marketValue: true },
    }))
  }

  const ranked = [...leagueTeams].sort((a, b) =>
    squadStrength(squads.get(b.id) ?? []) - squadStrength(squads.get(a.id) ?? []))

  for (const [index, team] of ranked.entries()) {
    const squad = squads.get(team.id) ?? []
    const reputation = reputationFor(squad, index + 1, ranked.length)
    const capacity = stadiumCapacityFor(reputation)

    await db.update(schema.teams).set({
      reputation,
      stadiumCapacity: capacity,
      stadiumName: stadiumNameFor(team.name),
      ticketPrice: fairTicketPrice(reputation),
      bankBalance: startingBalanceFor(reputation, capacity),
    }).where(eq(schema.teams.id, team.id))

    for (const player of squad) {
      await db.update(schema.players).set({
        wage: wageFor(player.marketValue, player.age, reputation),
        // Staggered so the squad doesn't all come out of contract at once —
        // roughly one in six is in a final year from the start, which gives the
        // player renewal decisions immediately rather than in three seasons.
        contractUntilSeason: 1 + (Math.random() < 0.17 ? 0 : 1 + Math.floor(Math.random() * 3)),
      }).where(eq(schema.players.id, player.id))
    }
  }
}

// Generate season 1 fixtures for every league.
//
// The pairing logic moved into `server/core/calendar.ts` so the season
// rollover can reuse it verbatim for season 2 onward. Fixtures within a round
// now share a kickoff date a week apart from the last, which is what makes
// "resolve every fixture up to today" mean exactly one matchday.
for (const league of seededLeagues) {
  const teamsInLeague = await db.query.teams.findMany({
    where: (teams, { eq }) => eq(teams.leagueId, league.id),
  })

  if (!teamsInLeague.length)
    continue

  const fixtures = buildSeasonFixtures(teamsInLeague.map(team => team.id), 1)
  if (fixtures.length)
    await db.insert(schema.matches).values(fixtures)
}

process.exit(0)