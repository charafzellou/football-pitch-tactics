import { db } from './index'
import * as schema from './schema'
import { faker } from '@faker-js/faker'
import { readFileSync } from 'fs'
import { join } from 'path'
import { and, eq, isNull } from 'drizzle-orm'
import { SQUAD_SHAPE, initialPotential, marketValueFor, positionsToFill } from '../core/progression'
import type { PositionCode } from '../core/progression'
import {
  DEFAULT_FACILITY_LEVEL,
  DEFAULT_SEASON_TICKET_DISCOUNT,
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
//
// `teams` and `players` now hold BOTH the seed template roster (`game_id IS
// NULL`) AND live per-save clones (`game_id` set) — only the template rows
// belong to this script. Deleting unconditionally would destroy every
// player's save the moment the template roster is reseeded, which defeats
// the entire point of separating templates from saves. `season`, `matches`
// and everything else keyed to a save are never touched here at all — they
// are created per-save by `createSave()`.
// Event types are global and historical match events reference them. Preserve
// existing rows during a template reseed and add only newly supported names.
await db.delete(schema.players).where(isNull(schema.players.gameId))
await db.delete(schema.teams).where(isNull(schema.teams.gameId))

// Seed Countries
const countryData = [{ name: 'England' }, { name: 'Spain' }]
const seededCountries = []
for (const country of countryData) {
  const existing = await db.query.countries.findFirst({ where: eq(schema.countries.name, country.name) })
  const row = existing ?? (await db.insert(schema.countries).values(country).returning())[0]
  if (row)
    seededCountries.push(row)
}

const england = seededCountries.find(country => country.name === 'England')
const spain = seededCountries.find(country => country.name === 'Spain')

if (!england || !spain)
  throw new Error('Failed to seed countries')

// Seed Leagues
const leagueData = [
  { name: 'Premier League', countryId: england.id },
  { name: 'La Liga', countryId: spain.id },
]
const seededLeagues = []
for (const league of leagueData) {
  const existing = await db.query.leagues.findFirst({
    where: and(eq(schema.leagues.name, league.name), eq(schema.leagues.countryId, league.countryId)),
  })
  const row = existing ?? (await db.insert(schema.leagues).values(league).returning())[0]
  if (row)
    seededLeagues.push(row)
}

// `season` rows are no longer seeded globally — they are created per-save by
// `createSave()`, one row per save per season, scoped by `game_id`. See
// server/core/save.ts.

// Seed player positions
const positionData = [
  { name: 'GK' },
  { name: 'DEF' },
  { name: 'MID' },
  { name: 'ATT' },
]
for (const position of positionData) {
  const existing = await db.query.positions.findFirst({ where: eq(schema.positions.name, position.name) })
  if (!existing)
    await db.insert(schema.positions).values(position)
}

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
const existingEventTypes = await db.query.eventType.findMany({ columns: { name: true } })
const existingEventTypeNames = new Set(existingEventTypes.map(row => row.name))
const missingEventTypes = eventTypes.filter(row => !existingEventTypeNames.has(row.name))
if (missingEventTypes.length)
  await db.insert(schema.eventType).values(missingEventTypes)

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
      // The shape also deliberately stays above the transfer-market minimums:
      // at least 2 GK, 5 DEF, 5 MID, 2 ATT and 16 players total.
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
  // Template teams only — once saves exist, this league also contains live
  // per-save clones (`game_id` set), and this pass must never touch those.
  const leagueTeams = await db.query.teams.findMany({
    where: (teams, { eq, and, isNull }) => and(eq(teams.leagueId, league.id), isNull(teams.gameId)),
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
    // The ground keeps its own name in `stadium_base_name` so that selling the
    // naming rights later is reversible when the deal runs out.
    const name = stadiumNameFor(team.name)

    /**
     * Every venture starts at its opening state, written explicitly rather than
     * left to the column defaults.
     *
     * The defaults in migration `0011` are literals; these are the constants the
     * game actually reasons with. They agree today, and the point of stating
     * them here is that they cannot quietly stop agreeing — a seeded club whose
     * academy sat one level below `DEFAULT_FACILITY_LEVEL` would be charged the
     * wrong upkeep, and `COMMERCIAL_UPLIFT` is derived from that exact level.
     */
    await db.update(schema.teams).set({
      reputation,
      stadiumCapacity: capacity,
      stadiumName: name,
      stadiumBaseName: name,
      ticketPrice: fairTicketPrice(reputation),
      bankBalance: startingBalanceFor(reputation, capacity),
      perimeterLevel: 0,
      hospitalityBoxes: 0,
      academyLevel: DEFAULT_FACILITY_LEVEL,
      trainingLevel: DEFAULT_FACILITY_LEVEL,
      seasonTicketShare: 0,
      seasonTicketDiscount: DEFAULT_SEASON_TICKET_DISCOUNT,
      pitchCondition: 100,
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

// `matches` are no longer seeded globally either — `createSave()` generates
// this save's own season-1 fixtures over its cloned team ids the moment a
// save is created. See server/core/save.ts.

process.exit(0)