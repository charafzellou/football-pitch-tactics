import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'

/**
 * Represents the `countries` table in the database.
 * Each country has a unique ID and a name.
 */
export const countries = sqliteTable('countries', {
  id: integer('id').primaryKey(),
  name: text('name').notNull().unique(),
})

/**
 * Represents the `leagues` table in the database.
 * Each league belongs to a country.
 */
export const leagues = sqliteTable('leagues', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  countryId: integer('country_id')
    .notNull()
    .references(() => countries.id),
})

/**
 * Represents the `teams` table in the database.
 * Each team belongs to a league and has associated financial and tactical information.
 */
export const teams = sqliteTable('teams', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  leagueId: integer('league_id')
    .notNull()
    .references(() => leagues.id),
  bankBalance: integer('bank_balance').notNull().default(1000000),
  tactics: text('tactics'),
  /** Selected starting XI as a JSON array of player ids. Null → auto-selected. */
  lineup: text('lineup'),
})

/**
 * Represents the `positions` table in the database.
 * This table stores all possible player positions.
 */

export const positions = sqliteTable('positions', {
  id: integer('id').primaryKey(),
  name: text('name').notNull().unique(),
})

/**
 * Represents the `players` table in the database.
 * Each player belongs to a team and has various attributes.
 */
export const players = sqliteTable('players', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  age: integer('age').notNull(),
  position: text('position').notNull(),
  skillLevel: integer('skill_level').notNull(),
  /** Stamina 0-100, meaning "what this player starts their next match with". */
  stamina: integer('stamina').notNull(),
  /** Matches remaining before this player is available for selection again. 0 = fit. */
  injuredMatches: integer('injured_matches').notNull().default(0),
  marketValue: integer('market_value').notNull(),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id),
})


/**
 * Represents the `season` table in the database.
 * This table stores information about each season in the game.
 */
export const season = sqliteTable('season', {
  id: integer('id').primaryKey(),
  year: text('year').notNull(),
  ended: text('ended').notNull().default('false'),
})

/**
 * Represents the `eventTypes` table in the database.
 * This table stores information about the types of events that can occur in a match.
 */
export const eventType = sqliteTable('event_type', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
})

/**
 * Represents the `game` table in the database.
 * This table stores the state of a single-player game.
 */
export const game = sqliteTable('game', {
  id: integer('id').primaryKey(),
  playerTeamId: integer('player_team_id')
    .notNull()
    .references(() => teams.id),
  season: integer('season').notNull().references(() => season.id),
  currentDate: integer('current_date', { mode: 'timestamp' }).notNull(),
})

/**
 * Represents the `matches` table in the database.
 * Each match involves two teams and has a result.
 */
export const matches = sqliteTable('matches', {
  id: integer('id').primaryKey(),
  homeTeamId: integer('home_team_id')
    .notNull()
    .references(() => teams.id),
  awayTeamId: integer('away_team_id')
    .notNull()
    .references(() => teams.id),
  homeScore: integer('home_score'),
  awayScore: integer('away_score'),
  played: integer('played').notNull().default(0),
  season: integer('season').notNull().references(() => season.id),
  matchDate: integer('match_date', { mode: 'timestamp' }).notNull(),
  /**
   * Live match state as JSON (see `shared/match-state.ts`'s `MatchState`)
   * while a match is paused mid-way through. Null when the match hasn't
   * started yet, or has already finished.
   */
  state: text('state'),
})

/**
 * Represents the `match_events` table in the database.
 * This table stores all significant events that occur during a match.
 */
export const matchEvents = sqliteTable('match_events', {
  id: integer('id').primaryKey(),
  matchId: integer('match_id')
    .notNull()
    .references(() => matches.id),
  minute: integer('minute').notNull(),
  eventType: integer('event_type').notNull().references(() => eventType.id),
  playerId: integer('player_id').references(() => players.id),
  /** The player going off, for `substitution` events. `playerId` is the one coming on. */
  relatedPlayerId: integer('related_player_id').references(() => players.id),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id),
})
