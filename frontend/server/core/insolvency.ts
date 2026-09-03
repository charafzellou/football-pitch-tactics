/**
 * What happens when the money actually runs out.
 *
 * This is the one place in the financial layer with teeth. Every budget in this
 * game *advises* — the wage recommendation, the transfer budget, the four-season
 * forecast — and none of them can refuse anything. Exceeding a recommendation is
 * allowed, on purpose: a recommendation that blocks is a rule wearing a
 * suggestion's clothes, and a manager who cannot overspend cannot make the
 * mistake the advice exists to warn them about.
 *
 * The consequences here key on a fact instead: `teams.bank_balance` is below
 * zero. That is not an opinion about affordability, it is an overdrawn account,
 * and it escalates the longer it lasts.
 *
 * | Stage | Reached when | What it costs |
 * |---|---|---|
 * | 1 | the balance goes negative | overdraft interest every matchday |
 * | 2 | three consecutive matchdays overdrawn | transfer embargo, supporters turn |
 * | 3 | eight matchdays, or worse than −€15M | the board sells your best player |
 *
 * Recovery is deliberately not instant. A solvent matchday steps the stage down
 * by one rather than clearing it, so climbing out of a board intervention takes
 * three matchdays in the black — long enough that a one-off windfall does not
 * simply cancel a crisis the manager spent half a season creating.
 *
 * The existing negative-balance term in `boardConfidenceTarget()` sits
 * underneath all of this untouched, so sustained insolvency already feeds the
 * confidence streak and the dismissal path with no extra code.
 */
import { and, eq, ne } from 'drizzle-orm'
import { db } from '../db'
import { game, players, teams } from '../db/schema'
import { nudgeFans } from './board'
import { settleTransfer } from './market'
import { postNews } from './news'
import type { NewsItem } from './news'
import { evaluateTransferDeparture } from '#shared/squad-transfer'

/** Consecutive overdrawn matchdays before the board stops the club trading. */
export const EMBARGO_ROUNDS = 3

/** Consecutive overdrawn matchdays before the board takes the chequebook. */
export const INTERVENTION_ROUNDS = 8

/** An overdraft this deep is an intervention on its own, however new it is. */
export const INTERVENTION_DEBT = 15_000_000

/**
 * A forced sale is a distress sale.
 *
 * Buyers know the club has to sell, so the fee is a fifth under the valuation —
 * which is the actual punishment. Losing the player hurts; losing him for less
 * than he is worth is what makes stage 3 something to avoid rather than a
 * convenient way to raise money.
 */
export const FORCED_SALE_DISCOUNT = 0.8

export interface ForcedSale {
  playerName: string
  toTeamName: string
  fee: number
}

export interface InsolvencyState {
  stage: number
  insolventRounds: number
  balance: number
  forcedSale: ForcedSale | null
}

function stageFor(balance: number, insolventRounds: number, previousStage: number): number {
  if (balance >= 0)
    return Math.max(0, previousStage - 1)

  if (insolventRounds >= INTERVENTION_ROUNDS || balance < -INTERVENTION_DEBT)
    return 3

  if (insolventRounds >= EMBARGO_ROUNDS)
    return 2

  return 1
}

/**
 * Settles the club's solvency for one matchday.
 *
 * Called after the board has judged the round, because a forced sale is the
 * board acting on a verdict it has already reached — and because the balance
 * being read here has to be the one this matchday's wages actually left behind.
 */
export async function settleInsolvency(input: {
  season: number
  round: number
}): Promise<InsolvencyState | null> {
  const gameRow = await db.query.game.findFirst()
  if (!gameRow || gameRow.dismissedAtSeason !== null)
    return null

  const club = await db.query.teams.findFirst({ where: eq(teams.id, gameRow.playerTeamId) })
  if (!club)
    return null

  const balance = club.bankBalance
  const insolventRounds = balance < 0 ? gameRow.insolventRounds + 1 : 0
  const stage = stageFor(balance, insolventRounds, gameRow.insolvencyStage)
  const escalated = stage > gameRow.insolvencyStage

  const news: NewsItem[] = []
  const { season, round } = input

  if (escalated && stage === 1) {
    news.push({
      season,
      round,
      category: 'finance',
      tone: 'negative',
      headline: 'The club is overdrawn',
      body: `${Math.abs(balance).toLocaleString('en-IE')} in the red. Interest is now being charged `
        + 'every matchday until the account is back in credit.',
    })
  }

  if (escalated && stage === 2) {
    news.push({
      season,
      round,
      category: 'finance',
      tone: 'negative',
      headline: 'Transfer embargo',
      body: `Overdrawn for ${insolventRounds} matchdays. The board has stopped the club signing players `
        + 'or improving contracts until the balance is positive again.',
    })
  }

  if (escalated && stage === 3) {
    news.push({
      season,
      round,
      category: 'finance',
      tone: 'negative',
      headline: 'The board has taken control of the finances',
      body: 'They will sell whoever they have to. You are expected to cut the wage bill, not to argue '
        + 'about who goes.',
    })
  }

  if (stage < gameRow.insolvencyStage && stage === 0) {
    news.push({
      season,
      round,
      category: 'finance',
      tone: 'positive',
      headline: 'The club is solvent again',
      body: 'The board has lifted its restrictions.',
    })
  }

  const forcedSale = stage >= 3 ? await forceSale(club.id, season, round, news) : null

  await db.transaction(async (tx) => {
    await tx.update(game)
      .set({ insolvencyStage: stage, insolventRounds })
      .where(eq(game.id, gameRow.id))

    // Supporters notice a crisis, and they notice it once — the hit lands on
    // the matchday the stage is reached, not every matchday it persists.
    if (escalated && stage >= 2)
      await nudgeFans(tx, gameRow.id, gameRow.fanConfidence, stage === 3 ? -8 : -5)

    await postNews(tx, news)
  })

  return { stage, insolventRounds, balance, forcedSale }
}

/**
 * The board sells the most valuable player it is allowed to sell.
 *
 * "Allowed" means the club retains the universal squad-size and positional
 * floors. If nobody can leave, the board complains instead. That is a real
 * outcome — a club can be too broke to be saved by selling.
 */
async function forceSale(
  teamId: number,
  season: number,
  round: number,
  news: NewsItem[],
): Promise<ForcedSale | null> {
  const squad = await db.query.players.findMany({
    where: and(eq(players.teamId, teamId), eq(players.retired, 0), eq(players.freeAgent, 0)),
  })

  const saleable = squad.filter(player => evaluateTransferDeparture(squad, player.id).allowed)

  if (!saleable.length) {
    news.push({
      season,
      round,
      category: 'finance',
      tone: 'negative',
      headline: 'There is nothing left to sell',
      body: 'The squad is at its minimum depth. The board cannot raise money without leaving you '
        + 'unable to field a complete squad.',
    })
    return null
  }

  const target = [...saleable].sort((a, b) => b.marketValue - a.marketValue)[0]
  if (!target)
    return null

  const fee = Math.round(target.marketValue * FORCED_SALE_DISCOUNT)

  // Whoever can actually pay, richest first — a distress sale goes to the club
  // with the cash, not to the club that needs the player.
  const buyers = await db.query.teams.findMany({ where: ne(teams.id, teamId) })
  const buyer = [...buyers].sort((a, b) => b.bankBalance - a.bankBalance)[0]
  if (!buyer)
    return null

  const outcome = await db.transaction(tx => settleTransfer(tx, {
    playerId: target.id,
    fromTeamId: teamId,
    toTeamId: buyer.id,
    fee,
    season,
    round,
  }))

  news.push({
    season,
    round,
    category: 'finance',
    tone: 'negative',
    headline: `${target.name} sold to ${buyer.name}`,
    body: `${fee.toLocaleString('en-IE')} — a fifth under his valuation, because everyone knew you had `
      + 'no choice. The board acted without consulting you.',
  })

  return { playerName: outcome.playerName, toTeamName: outcome.toTeamName, fee }
}

/**
 * The guard the transfer market and the contract desk call.
 *
 * Throws when the club is under embargo, and is deliberately the **only** hard
 * financial block in the game — it keys on the insolvency stage, never on a
 * budget recommendation.
 */
export function assertNotEmbargoed(stage: number): void {
  if (stage >= 2) {
    throw createError({
      statusCode: 403,
      // Short and unpunctuated: h3 warns on anything longer in `statusMessage`,
      // which is the field `useAppToast().fromRequestError` reads first.
      statusMessage: 'The club is under a transfer embargo',
    })
  }
}
