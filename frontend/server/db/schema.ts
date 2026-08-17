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
  /**
   * Club standing, 0–100, derived at seed from squad strength.
   *
   * The single input the whole economy hangs off: it sizes the stadium,
   * sponsorship, prize money and the board's expectations, so a big club earns
   * and is expected to achieve more than a small one.
   */
  reputation: integer('reputation').notNull().default(50),
  stadiumName: text('stadium_name'),
  stadiumCapacity: integer('stadium_capacity').notNull().default(20000),
  /** What the club charges per ticket. The player's main revenue lever. */
  ticketPrice: integer('ticket_price').notNull().default(30),
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
  /**
   * Skill ceiling. Development moves `skillLevel` toward this value while the
   * player is young and never past it. Seeded as `skillLevel` plus headroom
   * that is generous for teenagers and near zero for players already at peak.
   */
  potential: integer('potential').notNull().default(0),
  /** Stamina 0-100, meaning "what this player starts their next match with". */
  stamina: integer('stamina').notNull(),
  /** Matches remaining before this player is available for selection again. 0 = fit. */
  injuredMatches: integer('injured_matches').notNull().default(0),
  /**
   * `1` once the player has retired at a season rollover.
   *
   * Retired players are kept rather than deleted: `match_events.player_id`
   * references them, so removing the row would destroy the match history they
   * appear in. Every squad query filters on this instead.
   */
  retired: integer('retired').notNull().default(0),
  marketValue: integer('market_value').notNull(),
  /**
   * Wage per matchday, not per week.
   *
   * A season is 38 matchdays, which is the only cadence money moves on, so
   * pricing wages the same way keeps every financial figure in one unit.
   */
  wage: integer('wage').notNull().default(0),
  /**
   * The last season this contract covers. At the rollover past it the player
   * leaves on a free unless renewed.
   */
  contractUntilSeason: integer('contract_until_season').notNull().default(1),
  /**
   * `1` while the player is unattached and signable for wages alone.
   *
   * Modelled exactly like `retired`: the row keeps its `team_id` — which then
   * reads as the club that released them — and every squad query excludes the
   * flag instead. Making `team_id` nullable was the alternative and would have
   * rippled through every query and type in the server for no gain.
   *
   * A free agent's `wage` is zeroed, so a squad query that forgot this filter
   * would still not invent money.
   */
  freeAgent: integer('free_agent').notNull().default(0),
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
  /**
   * Whether losing the board's faith can end the save.
   *
   * **Write-once.** Set by `POST /api/game/start` and never updated —
   * deliberately there is no endpoint that can change it, because a difficulty
   * you can switch off the moment it bites is not a difficulty. Board and fan
   * pressure exist either way; this only governs whether dismissal fires.
   */
  sackingEnabled: integer('sacking_enabled').notNull().default(0),
  /** 0–100. How secure the manager's position is. */
  boardConfidence: integer('board_confidence').notNull().default(65),
  /** 0–100. Driven by results, ticket prices and notable transfers. */
  fanConfidence: integer('fan_confidence').notNull().default(65),
  /** League position the board expects this season. */
  boardExpectation: integer('board_expectation').notNull().default(10),
  /**
   * Consecutive matchdays spent below the confidence threshold. Dismissal
   * needs a sustained slump, not one bad afternoon.
   */
  confidenceStreak: integer('confidence_streak').notNull().default(0),
  /** Set when the manager has been dismissed; the save is then read-only. */
  dismissedAtSeason: integer('dismissed_at_season'),
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
  /**
   * Matchday number within the season, 1-based.
   *
   * Every fixture in a round shares a `matchDate`, so a round is what
   * "resolve everything up to today" actually resolves. Stored explicitly so
   * the UI can say "Round 12 of 38" without inferring it from dates.
   */
  round: integer('round').notNull().default(0),
  matchDate: integer('match_date', { mode: 'timestamp' }).notNull(),
  /**
   * Live match state as JSON (see `shared/match-state.ts`'s `MatchState`)
   * while a match is paused mid-way through. Null when the match hasn't
   * started yet, or has already finished.
   */
  state: text('state'),
})

/**
 * One row per league per completed season.
 *
 * Standings are otherwise computed on the fly from `matches`, which is fine
 * while a season is live but loses everything the moment the next season's
 * fixtures are inserted. This is what lets past champions and the player's
 * finishing positions survive a rollover.
 */
export const seasonSummary = sqliteTable('season_summary', {
  id: integer('id').primaryKey(),
  season: integer('season').notNull().references(() => season.id),
  leagueId: integer('league_id').notNull().references(() => leagues.id),
  championTeamId: integer('champion_team_id').notNull().references(() => teams.id),
  championPoints: integer('champion_points').notNull(),
  /** Null when the player's club does not compete in this league. */
  playerTeamId: integer('player_team_id').references(() => teams.id),
  playerPosition: integer('player_position'),
  playerPoints: integer('player_points'),
  completedAt: integer('completed_at', { mode: 'timestamp' }).notNull(),
})

/**
 * Every credit and debit against a club's balance.
 *
 * The balance could be a single running number, but then it could never be
 * explained — only asserted. With a ledger the finance page can show *why* the
 * money moved, and a verification pass can prove balance equals starting
 * balance plus the sum of these rows, which is what catches money being
 * silently created or destroyed.
 */
export const financeLedger = sqliteTable('finance_ledger', {
  id: integer('id').primaryKey(),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id),
  season: integer('season').notNull(),
  /** Matchday the entry belongs to. 0 for season-boundary items like prize money. */
  round: integer('round').notNull().default(0),
  /** `wages` | `gate` | `sponsorship` | `prize` | `transfer_in` | `transfer_out` | `stadium` */
  type: text('type').notNull(),
  /** Positive credits the club, negative debits it. */
  amount: integer('amount').notNull(),
  description: text('description').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

/**
 * Bids an AI club has made for one of the manager's players.
 *
 * Persisted rather than computed on demand: an offer the manager can think
 * about between matchdays is a decision, whereas one regenerated on every page
 * load is just noise they can reroll until they like it.
 */
export const transferOffers = sqliteTable('transfer_offers', {
  id: integer('id').primaryKey(),
  playerId: integer('player_id').notNull().references(() => players.id),
  /** The club bidding. */
  fromTeamId: integer('from_team_id').notNull().references(() => teams.id),
  /** The club being bid to — the player's club when the offer was made. */
  toTeamId: integer('to_team_id').notNull().references(() => teams.id),
  amount: integer('amount').notNull(),
  season: integer('season').notNull(),
  round: integer('round').notNull().default(0),
  /** `pending` | `accepted` | `rejected` | `expired` | `improved` */
  status: text('status').notNull().default('pending'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

/**
 * The club's news feed — board and fan reactions, transfers, contracts.
 *
 * Board confidence is a number, and a number alone never explains itself. These
 * rows are what turn "confidence fell 6" into "the board expected top four and
 * you are 11th", which is the difference between pressure the manager can
 * respond to and pressure that merely happens to them.
 */
export const clubNews = sqliteTable('club_news', {
  id: integer('id').primaryKey(),
  season: integer('season').notNull(),
  round: integer('round').notNull().default(0),
  /** `board` | `fans` | `transfer` | `contract` | `result` */
  category: text('category').notNull(),
  /** `positive` | `negative` | `neutral` */
  tone: text('tone').notNull().default('neutral'),
  headline: text('headline').notNull(),
  body: text('body'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
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
