/**
 * The board and the supporters.
 *
 * Two 0–100 meters, both always present. They are the only thing in the game
 * that pushes back on the manager, so the design goal is that pressure is
 * always *explainable*: every movement comes with a news line saying what
 * caused it, because a confidence bar that drifts without reason is anxiety
 * rather than difficulty.
 *
 * ## Targets, not deltas
 *
 * Confidence is not accumulated from increments. Each matchday a **target** is
 * computed from the current state of the club, and the stored value eases
 * toward it. Accumulated deltas drift — a rounding bias or a double-counted
 * matchday compounds forever, and there is no way to audit the number back to
 * anything. A target is recomputable from the world at any moment, so the meter
 * can always be checked against the league table it claims to reflect.
 *
 * ## Sacking
 *
 * `game.sacking_enabled` is written once, at game start, and no endpoint can
 * change it. The pressure below runs identically whether it is on or off — the
 * same meters, the same warnings, the same streak. The flag governs one thing:
 * whether the streak ever ends the save.
 */
import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import { financeLedger, game, matches } from '../db/schema'
import { fairTicketPrice } from './economy'
import { leagueStandingFor } from './finance'
import { postNews } from './news'
import type { NewsItem } from './news'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Board confidence at or below this counts as a matchday in the danger zone. */
export const SACK_THRESHOLD = 25

/** Consecutive matchdays in the danger zone before the board acts. */
export const SACK_STREAK = 5

/** Warnings start here, well before anything is decided. */
export const WARNING_THRESHOLD = 40

/** How far confidence closes on its target each matchday. */
const EASING = 0.25

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function ease(current: number, target: number): number {
  return Math.round(clamp(current + (target - current) * EASING, 0, 100))
}

// ---------------------------------------------------------------------------
// Expectations
// ---------------------------------------------------------------------------

/**
 * The league position the board wants this season.
 *
 * Reputation sets the baseline — a giant is expected to win things — and last
 * season's finish drags it toward reality, so a club that overachieved is held
 * to a slightly higher bar next time and one that collapsed gets a season of
 * grace rather than an impossible target.
 */
export function expectationFor(reputation: number, lastFinish: number | null, leagueSize: number): number {
  // Reputation 100 → 1st, 0 → bottom half.
  const fromReputation = 1 + (1 - reputation / 100) * (leagueSize - 1) * 0.85

  const target = lastFinish === null
    ? fromReputation
    : fromReputation * 0.65 + lastFinish * 0.35

  return clamp(Math.round(target), 1, leagueSize)
}

export function describeExpectation(target: number, leagueSize: number): string {
  if (target <= 1) return 'win the league'
  if (target <= 4) return `finish in the top ${target}`
  if (target <= Math.ceil(leagueSize / 2)) return `finish in the top ${target}`
  if (target <= leagueSize - 5) return 'finish comfortably clear of trouble'
  return 'stay up'
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

export interface ConfidenceInputs {
  /** Current league position, 1-based. */
  position: number
  /** The position the board asked for. */
  expectation: number
  leagueSize: number
  /** Recent results as a 0–1 share of available points. */
  formRating: number
  bankBalance: number
  /** Share of income going on wages, 0–100, or null before any income lands. */
  wageRatio: number | null
  roundsPlayed: number
  totalRounds: number
}

/**
 * How well a league position reads against the target, 0–100.
 *
 * Two terms, and the second is the one that matters. A pure
 * position-versus-expectation gap cannot reward the best outcomes: a club told
 * to finish top-two can only beat that by a single place, so winning the league
 * scored barely above merely qualifying — while a side told to survive could
 * clear its target by eight places and score higher for a tenth-place finish
 * than a champion did for the title.
 *
 * The absolute term fixes that. Finishing first is excellent whoever you are;
 * the gap term then decides whether it was expected of you.
 *
 * Falling short is also weighted a little heavier than exceeding, because
 * boards are not symmetric about disappointment.
 */
export function positionalStanding(position: number, expectation: number, leagueSize: number): number {
  const gap = expectation - position
  const achievement = 1 - (position - 1) / Math.max(1, leagueSize - 1)

  return clamp(45 + (gap >= 0 ? gap * 4.5 : gap * 5) + achievement * 30, 0, 100)
}

/**
 * Where board confidence is heading.
 *
 * Position against expectation dominates. Money matters, but only when it has
 * gone wrong: a healthy balance earns nothing, while debt is punished hard,
 * because a board notices overspending and does not congratulate thrift.
 */
export function boardConfidenceTarget(inputs: ConfidenceInputs): number {
  const positional = positionalStanding(inputs.position, inputs.expectation, inputs.leagueSize)

  // Early in a season the board reserves judgement. Full weight lands around
  // a third of the way in, which is roughly when a table starts meaning
  // something.
  const settled = clamp(inputs.roundsPlayed / Math.max(1, inputs.totalRounds * 0.35), 0, 1)
  let target = 62 + (positional - 62) * settled

  target += (inputs.formRating - 0.5) * 10

  if (inputs.bankBalance < 0) {
    // Scaled by depth, floored so any debt is felt.
    const depth = clamp(Math.abs(inputs.bankBalance) / 20_000_000, 0.25, 1)
    target -= 18 + depth * 22
  }

  if (inputs.wageRatio !== null && inputs.wageRatio > 85)
    target -= Math.min(15, (inputs.wageRatio - 85) * 0.6)

  return clamp(Math.round(target), 0, 100)
}

export interface FanInputs extends ConfidenceInputs {
  ticketPrice: number
  reputation: number
}

/**
 * Where fan confidence is heading.
 *
 * Supporters care about what they watch and what it costs them, in that order.
 * Form outweighs the table, and an inflated ticket price is felt every single
 * home match — which is the same lever that empties the ground in
 * `attendanceFor()`, so overcharging costs goodwill and gate receipts together.
 */
export function fanConfidenceTarget(inputs: FanInputs): number {
  let target = 55 + (inputs.formRating - 0.5) * 60

  const gap = inputs.expectation - inputs.position
  target += clamp(gap * 2, -14, 14)

  const fair = fairTicketPrice(inputs.reputation)
  if (inputs.ticketPrice > fair)
    target -= Math.min(30, ((inputs.ticketPrice - fair) / fair) * 40)
  else
    target += Math.min(6, ((fair - inputs.ticketPrice) / fair) * 12)

  return clamp(Math.round(target), 0, 100)
}

// ---------------------------------------------------------------------------
// Matchday settlement
// ---------------------------------------------------------------------------

export interface BoardState {
  boardConfidence: number
  fanConfidence: number
  confidenceStreak: number
  dismissed: boolean
}

export interface SettleMatchdayInput {
  gameRow: typeof game.$inferSelect
  inputs: FanInputs
  round: number
  /** Appended to, so the caller can post one batch of news. */
  news: NewsItem[]
}

/**
 * Moves both meters one matchday closer to where the club's situation says
 * they should be, and decides whether the board has run out of patience.
 */
export async function settleMatchday(tx: Tx, input: SettleMatchdayInput): Promise<BoardState> {
  const { gameRow, inputs, round, news } = input

  if (gameRow.dismissedAtSeason !== null)
    return { boardConfidence: gameRow.boardConfidence, fanConfidence: gameRow.fanConfidence, confidenceStreak: gameRow.confidenceStreak, dismissed: true }

  const boardConfidence = ease(gameRow.boardConfidence, boardConfidenceTarget(inputs))
  const fanConfidence = ease(gameRow.fanConfidence, fanConfidenceTarget(inputs))

  // The streak runs whether or not sacking is enabled, so the warnings a
  // manager sees are identical either way.
  const confidenceStreak = boardConfidence <= SACK_THRESHOLD ? gameRow.confidenceStreak + 1 : 0

  const dismissed = gameRow.sackingEnabled === 1 && confidenceStreak >= SACK_STREAK

  // Only report a crossing, not every matchday, or the feed becomes noise.
  const wasCalm = gameRow.boardConfidence > WARNING_THRESHOLD
  if (wasCalm && boardConfidence <= WARNING_THRESHOLD) {
    news.push({
      season: gameRow.season,
      round,
      category: 'board',
      tone: 'negative',
      headline: 'The board has concerns',
      body: `They asked you to ${describeExpectation(inputs.expectation, inputs.leagueSize)}; you are ${inputs.position}${ordinal(inputs.position)}.`,
    })
  }
  else if (!wasCalm && boardConfidence > WARNING_THRESHOLD) {
    news.push({
      season: gameRow.season,
      round,
      category: 'board',
      tone: 'positive',
      headline: 'The board is reassured',
      body: 'Recent results have eased the pressure.',
    })
  }

  if (confidenceStreak > 0 && confidenceStreak < SACK_STREAK && boardConfidence <= SACK_THRESHOLD) {
    news.push({
      season: gameRow.season,
      round,
      category: 'board',
      tone: 'negative',
      headline: gameRow.sackingEnabled
        ? `Your position is under review (${confidenceStreak}/${SACK_STREAK})`
        : 'The board has lost faith in you',
      body: gameRow.sackingEnabled
        ? 'A sustained run at this level will cost you the job.'
        : 'Dismissal is disabled in this save, but the board is no longer behind you.',
    })
  }

  if (dismissed) {
    news.push({
      season: gameRow.season,
      round,
      category: 'board',
      tone: 'negative',
      headline: 'You have been dismissed',
      body: `The board has ended your tenure after ${SACK_STREAK} matchdays without confidence.`,
    })
  }

  await tx.update(game)
    .set({
      boardConfidence,
      fanConfidence,
      confidenceStreak,
      ...(dismissed ? { dismissedAtSeason: gameRow.season } : {}),
    })
    .where(eq(game.id, gameRow.id))

  return { boardConfidence, fanConfidence, confidenceStreak, dismissed }
}

/**
 * Reads the club's whole situation and settles both meters for this matchday.
 *
 * Deliberately called *after* the rest of the round has been resolved, not
 * before: the manager's own result is only half of what moved them up or down
 * the table, and judging them on a position that ignores nineteen other results
 * would be judging them on a table nobody else can see.
 *
 * Season status is read straight from `matches` rather than through
 * `getSeasonStatus()`, which lives in `season.ts` — and `season.ts` already
 * imports this module for the end-of-season verdict.
 */
export async function settleBoardForMatchday(): Promise<BoardState | null> {
  const gameRow = await db.query.game.findFirst()
  if (!gameRow || gameRow.dismissedAtSeason !== null)
    return null

  const fixtures = await db.query.matches.findMany({
    where: eq(matches.season, gameRow.season),
    columns: { played: true, round: true },
  })

  const totalRounds = fixtures.reduce((max, fixture) => Math.max(max, fixture.round), 0) || 38
  const roundsPlayed = fixtures
    .filter(fixture => fixture.played)
    .reduce((max, fixture) => Math.max(max, fixture.round), 0)

  const standing = await leagueStandingFor(gameRow.playerTeamId, gameRow.season, roundsPlayed)
  if (!standing)
    return null

  // Wage pressure, from the ledger rather than the squad — what the board sees
  // is what actually left the account.
  const entries = await db.query.financeLedger.findMany({
    where: and(
      eq(financeLedger.teamId, gameRow.playerTeamId),
      eq(financeLedger.season, gameRow.season),
    ),
    columns: { type: true, amount: true },
  })

  const income = entries.filter(entry => entry.amount > 0).reduce((total, entry) => total + entry.amount, 0)
  const wages = entries
    .filter(entry => entry.type === 'wages')
    .reduce((total, entry) => total + Math.abs(entry.amount), 0)

  const news: NewsItem[] = []

  const state = await db.transaction(tx => settleMatchday(tx, {
    gameRow,
    round: roundsPlayed,
    news,
    inputs: {
      position: standing.position,
      expectation: gameRow.boardExpectation,
      leagueSize: standing.leagueSize,
      formRating: standing.formRating,
      bankBalance: standing.club.bankBalance,
      wageRatio: income > 0 ? Math.round((wages / income) * 100) : null,
      roundsPlayed,
      totalRounds,
      ticketPrice: standing.club.ticketPrice,
      reputation: standing.club.reputation,
    },
  }))

  await postNews(db, news)

  return state
}

// ---------------------------------------------------------------------------
// Season boundary
// ---------------------------------------------------------------------------

export interface SettleSeasonEndInput {
  gameState: typeof game.$inferSelect
  newSeason: number
  /** Final league position, or null if the club wasn't in a ranked league. */
  finish: number | null
  leagueSize: number
  reputation: number
  news: NewsItem[]
}

/**
 * The board's verdict on a finished season, and the target for the next one.
 *
 * The end of a season is when a board actually decides things, so the swing
 * here is larger than any single matchday — and a manager who has missed the
 * target badly can be dismissed in the summer even after a calm run-in.
 */
export async function settleSeasonEnd(tx: Tx, input: SettleSeasonEndInput): Promise<void> {
  const { gameState, newSeason, finish, leagueSize, reputation, news } = input

  if (gameState.dismissedAtSeason !== null)
    return

  const nextExpectation = expectationFor(reputation, finish, leagueSize)

  if (finish === null) {
    await tx.update(game).set({ boardExpectation: nextExpectation }).where(eq(game.id, gameState.id))
    return
  }

  const gap = gameState.boardExpectation - finish

  // The season's verdict dominates, but not entirely — a board that has watched
  // a manager all year does not arrive at the final whistle with no memory of
  // it. Four parts where they already were, six parts what the table says.
  const verdict = clamp(
    positionalStanding(finish, gameState.boardExpectation, leagueSize) + (gap >= 0 ? 8 : -10),
    0,
    100,
  )
  const boardConfidence = Math.round(clamp(gameState.boardConfidence * 0.4 + verdict * 0.6, 0, 100))

  const dismissed = gameState.sackingEnabled === 1 && boardConfidence <= SACK_THRESHOLD

  news.push({
    season: newSeason,
    category: 'board',
    tone: gap >= 0 ? 'positive' : 'negative',
    headline: gap >= 0
      ? 'The board is satisfied with the season'
      : 'The board expected better',
    body: `They asked you to ${describeExpectation(gameState.boardExpectation, leagueSize)}; you finished ${finish}${ordinal(finish)}. Next season they want ${describeExpectation(nextExpectation, leagueSize)}.`,
  })

  if (dismissed) {
    news.push({
      season: newSeason,
      category: 'board',
      tone: 'negative',
      headline: 'You have been dismissed',
      body: `A ${finish}${ordinal(finish)} place finish ended your tenure.`,
    })
  }

  await tx.update(game)
    .set({
      boardConfidence,
      boardExpectation: nextExpectation,
      confidenceStreak: 0,
      ...(dismissed ? { dismissedAtSeason: gameState.season } : {}),
    })
    .where(eq(game.id, gameState.id))
}

// ---------------------------------------------------------------------------
// One-off shocks
// ---------------------------------------------------------------------------

/**
 * An immediate hit or lift to fan confidence — selling a star, signing one.
 *
 * Applied directly rather than through a target, because the reaction is to an
 * event rather than a state. The matchday easing then pulls the meter back
 * toward whatever the league table says, so a shock fades if results hold up.
 */
export async function nudgeFans(tx: Tx, gameId: number, current: number, delta: number): Promise<number> {
  const next = clamp(Math.round(current + delta), 0, 100)
  await tx.update(game).set({ fanConfidence: next }).where(eq(game.id, gameId))

  return next
}

/**
 * How strongly the support reacts to a player leaving or arriving.
 *
 * Scaled by how good the player was relative to the squad — selling the best
 * player at the club is felt, selling the twentieth-best is not.
 */
export function transferReaction(playerSkill: number, squadBestSkill: number, direction: 'in' | 'out'): number {
  const standing = clamp(playerSkill / Math.max(1, squadBestSkill), 0, 1)
  // Below ~90% of the best player at the club, nobody much minds.
  const notable = Math.max(0, standing - 0.9) * 10

  return Math.round(notable * (direction === 'out' ? -12 : 8))
}

function ordinal(position: number): string {
  return position === 1 ? 'st' : position === 2 ? 'nd' : position === 3 ? 'rd' : 'th'
}
