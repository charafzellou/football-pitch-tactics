import { sqliteTable, integer, real, text } from 'drizzle-orm/sqlite-core'

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
  /**
   * The ground's own name, kept while a sponsor's name is displayed instead.
   *
   * Selling naming rights overwrites `stadium_name`; this is what it reverts to
   * when the deal expires, so a club can never permanently lose its identity to
   * a contract that has run out.
   */
  stadiumBaseName: text('stadium_base_name'),
  stadiumCapacity: integer('stadium_capacity').notNull().default(20000),
  /** What the club charges per ticket. The player's main revenue lever. */
  ticketPrice: integer('ticket_price').notNull().default(30),
  /** Perimeter advertising tier, 0–3. Capital buys the next one. */
  perimeterLevel: integer('perimeter_level').notNull().default(0),
  /** Executive boxes built. Each replaces `HOSPITALITY_BOX_SEATS` ordinary seats. */
  hospitalityBoxes: integer('hospitality_boxes').notNull().default(0),
  /** Youth academy tier, 0–3. Feeds the quality and size of the summer intake. */
  academyLevel: integer('academy_level').notNull().default(1),
  /** Training ground tier, 0–3. Feeds development, and recovery from injury. */
  trainingLevel: integer('training_level').notNull().default(1),
  /**
   * Percentage of capacity sold as season tickets before the season starts.
   *
   * Zero for every club by default, which is what keeps attendance and gate
   * receipts identical to what they were before season tickets existed.
   */
  seasonTicketShare: integer('season_ticket_share').notNull().default(0),
  /** Percentage off the gate price season-ticket holders pay. */
  seasonTicketDiscount: integer('season_ticket_discount').notNull().default(20),
  /**
   * Pitch quality 0–100. Non-matchday events wear it down; it recovers weekly.
   *
   * A worn pitch costs the home side in the match engine, which is what stops a
   * summer of concerts from being free money.
   */
  pitchCondition: integer('pitch_condition').notNull().default(100),
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
  /**
   * How far the club's finances have deteriorated: 0 solvent, 1 overdrawn,
   * 2 embargoed, 3 forced sales.
   *
   * Budgets in this game advise and never block. This is the one thing that
   * does bite, and it keys on the balance actually being negative — never on
   * exceeding a recommendation, which the manager is always free to do.
   */
  insolvencyStage: integer('insolvency_stage').notNull().default(0),
  /** Consecutive matchdays finished with a negative balance. */
  insolventRounds: integer('insolvent_rounds').notNull().default(0),
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
  /**
   * One of `LEDGER_TYPES` in `server/core/economy.ts`. Free text rather than a
   * constrained column, so adding a stream is a one-line change there.
   *
   * Income: `gate`, `sponsorship`, `prize`, `transfer_out`, `merchandising`,
   * `perimeter`, `hospitality`, `event_hire`, `season_tickets`, `loan_in`,
   * `bonus`. Outgoings: `wages`, `transfer_in`, `stadium`, `operating`,
   * `facilities`, `loan_repayment`, `interest`.
   */
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
  /** `board` | `fans` | `transfer` | `contract` | `result` | `finance` */
  category: text('category').notNull(),
  /** `positive` | `negative` | `neutral` */
  tone: text('tone').notNull().default('neutral'),
  headline: text('headline').notNull(),
  body: text('body'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

/**
 * Commercial partnerships — offered, signed, and run out.
 *
 * Offers and deals share a table with a status, exactly as bids and completed
 * transfers do, because they are the same object at different points in its
 * life. Splitting them would mean copying six columns across on every signature
 * and inventing a rule for which table the truth lives in.
 *
 * Rows exist only for the manager's club. Every CPU club takes the single
 * blended `sponsorship` credit it always did — see `MatchdayContext` in
 * `server/core/finance.ts` for why that asymmetry is presentational rather than
 * an advantage.
 */
export const sponsorshipDeals = sqliteTable('sponsorship_deals', {
  id: integer('id').primaryKey(),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id),
  /** `shirt` | `kit_maker` | `sleeve` | `naming_rights` */
  slot: text('slot').notNull(),
  sponsorName: text('sponsor_name').notNull(),
  /** Per matchday, like every other figure in this game's money. */
  baseFee: integer('base_fee').notNull(),
  /** Length of the deal in seasons, as offered. */
  seasons: integer('seasons').notNull().default(3),
  signedSeason: integer('signed_season').notNull(),
  /** Last season the deal covers. Paid through the rollover past it. */
  untilSeason: integer('until_season').notNull(),
  /** Paid once at the rollover, if the club finished well enough to earn it. */
  bonusChampion: integer('bonus_champion').notNull().default(0),
  bonusTopFour: integer('bonus_top_four').notNull().default(0),
  bonusSurvival: integer('bonus_survival').notNull().default(0),
  /** `offered` | `active` | `expired` | `declined` */
  status: text('status').notNull().default('offered'),
  /** Matchday the offer was made, so a stale one can lapse. */
  round: integer('round').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

/**
 * Non-matchday bookings — the ground earning its keep between fixtures.
 *
 * Attached to a **round**, not a date. Nothing in this game happens on a day
 * that is not a fixture date, and the stadium is not going to be the exception:
 * as `PUT /api/team/:id/stadium` already puts it, there is no calendar
 * granularity finer than a matchday to hang a timeline on. An event booked
 * "before round 12" is settled when round 12 is played.
 */
export const stadiumEvents = sqliteTable('stadium_events', {
  id: integer('id').primaryKey(),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id),
  season: integer('season').notNull(),
  /** The matchday this booking settles against. */
  round: integer('round').notNull(),
  /** `concert` | `international` | `rugby` | `conference` | `community` */
  kind: text('kind').notNull(),
  promoterName: text('promoter_name').notNull(),
  fee: integer('fee').notNull(),
  /** Points of pitch condition the booking costs. */
  pitchWear: integer('pitch_wear').notNull().default(0),
  /** How supporters take it. */
  fanReaction: integer('fan_reaction').notNull().default(0),
  /** `offered` | `booked` | `held` | `cancelled` | `expired` */
  status: text('status').notNull().default('offered'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

/**
 * Borrowing.
 *
 * A loan is the one thing in this economy that turns money you do not have into
 * money you do, and it is priced so that it is never free: the rate is set by
 * what the club is (`reputation`) and what state it is in (a negative balance
 * costs four points more), and both interest and principal come off every
 * matchday until the term runs out.
 *
 * The rows matter more to the *forecast* than to the balance. A four-season
 * projection with no debt in it is a straight line; debt service is a fixed cost
 * that does not care how the season goes, which is precisely what gives the
 * long view teeth — and what makes borrowing to cover a wage bill a decision
 * rather than a button.
 *
 * Player's club only, like `sponsorship_deals` and `stadium_events`. CPU clubs
 * do not borrow, because nothing would ever read the row back.
 */
export const loans = sqliteTable('loans', {
  id: integer('id').primaryKey(),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id),
  /** What was drawn down, kept so the page can show progress against it. */
  principal: integer('principal').notNull(),
  /** What is still owed. Falls by `repayment_per_round` each matchday. */
  outstanding: integer('outstanding').notNull(),
  /** Annual rate as a percentage — 7.5 means 7.5%. */
  ratePerSeason: real('rate_per_season').notNull(),
  takenSeason: integer('taken_season').notNull(),
  termSeasons: integer('term_seasons').notNull(),
  /** Last season a repayment falls due. */
  untilSeason: integer('until_season').notNull(),
  /** Principal repaid every matchday, fixed at drawdown. */
  repaymentPerRound: integer('repayment_per_round').notNull(),
  /** `active` | `settled` */
  status: text('status').notNull().default('active'),
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
