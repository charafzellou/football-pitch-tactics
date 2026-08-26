/**
 * The transfer market: what a move costs, who bids, and what it does to the club.
 *
 * Three gaps closed here, all of them the same shape — machinery that existed
 * but was never wired to anything:
 *
 * 1. **Transfers bypassed the ledger.** `POST /api/transfers` moved
 *    `teams.bank_balance` directly, so `transfer_in`/`transfer_out` were
 *    declared in `LEDGER_TYPES` and never written. A balance rebuilt from the
 *    ledger disagreed with the stored one for any club that had ever traded,
 *    which defeats the entire point of keeping a ledger.
 * 2. **`nudgeFans()` and `transferReaction()` had no callers.** Selling the best
 *    player at the club moved nothing.
 * 3. **`transfer_offers` was dead schema.** Declared, cleared on a new save,
 *    never inserted into or read. Nothing generated AI interest in the
 *    manager's squad.
 *
 * `settleTransfer` is the single path every move now takes — a purchase, a
 * sale, or an accepted bid — so none of the three can drift back apart.
 */
import { and, eq, inArray, lt, ne } from 'drizzle-orm'
import { db } from '../db'
import { clubNews, game, players, teams, transferOffers } from '../db/schema'
import type { GameRow } from './save'
import { postLedger } from './finance'
import { nudgeFans, transferReaction } from './board'
import { postNews } from './news'
import { MIN_SQUAD_SIZE_TO_SELL, saleBlockedReason } from '#shared/squad-rules'
export { MIN_SQUAD_SIZE_TO_SELL } from '#shared/squad-rules'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Matchdays a bid stays on the table before it lapses. */
export const OFFER_LIFETIME_ROUNDS = 3

/** Most bids the manager can be sitting on at once. */
const MAX_PENDING_OFFERS = 4

/** Chance per matchday that the market takes an interest at all. */
const OFFER_CHANCE_PER_MATCHDAY = 0.45

export interface TransferSettlement {
  playerId: number
  fromTeamId: number
  toTeamId: number
  /** Cash price. `0` for a free agent. */
  fee: number
  season: number
  round: number
  /** Written onto the player when the fee reflects a new valuation. */
  newMarketValue?: number
  /** True only for a manager-initiated sale or accepted manager bid. */
  enforceSquadMinimums?: boolean
}

export interface TransferOutcome {
  playerName: string
  fromTeamName: string
  toTeamName: string
  fee: number
  fanConfidence: number | null
}

/**
 * Moves a player, the money, and everything that reacts to both.
 *
 * Ledger semantics are by **player direction**, mirrored across the two clubs:
 * `transfer_in` is a player joining (cash out, negative) and `transfer_out` is a
 * player leaving (cash in, positive). A sale is therefore one `transfer_out`
 * credit and one `transfer_in` debit, which nets to zero across the world — the
 * property that makes the ledger auditable.
 */
export async function settleTransfer(tx: Tx, input: TransferSettlement): Promise<TransferOutcome> {
  const { playerId, fromTeamId, toTeamId, fee, season, round } = input

  const player = await tx.query.players.findFirst({ where: eq(players.id, playerId) })
  const [from, to] = await Promise.all([
    tx.query.teams.findFirst({ where: eq(teams.id, fromTeamId) }),
    tx.query.teams.findFirst({ where: eq(teams.id, toTeamId) }),
  ])

  if (!player || !from || !to) {
    throw createError({ statusCode: 404, statusMessage: 'Transfer participants not found' })
  }

  if (input.enforceSquadMinimums) {
    const squad = await tx.query.players.findMany({
      where: and(
        eq(players.teamId, fromTeamId),
        eq(players.retired, 0),
        eq(players.freeAgent, 0),
      ),
      columns: { id: true, position: true },
    })
    const blocked = saleBlockedReason(squad, playerId)
    if (blocked)
      throw createError({ statusCode: 400, statusMessage: blocked })
  }

  await tx.update(players)
    .set({
      teamId: toTeamId,
      // A signed free agent is attached again.
      freeAgent: 0,
      ...(input.newMarketValue !== undefined ? { marketValue: input.newMarketValue } : {}),
    })
    .where(eq(players.id, playerId))

  if (fee > 0) {
    await postLedger(tx, [
      {
        teamId: fromTeamId,
        season,
        round,
        type: 'transfer_out',
        amount: fee,
        description: `${player.name} sold to ${to.name}`,
      },
      {
        teamId: toTeamId,
        season,
        round,
        type: 'transfer_in',
        amount: -fee,
        description: `${player.name} signed from ${from.name}`,
      },
    ])
  }

  // ---- Reactions, but only to the manager's own business -------------------
  // Both clubs are clones of the same save (a transfer never crosses saves —
  // the transfer market and squad searches are always scoped to one save's
  // teams), so either team's `gameId` identifies which save's board reacts.
  const gameRow = from.gameId !== null
    ? await tx.query.game.findFirst({ where: eq(game.id, from.gameId) })
    : null
  let fanConfidence: number | null = null

  if (gameRow && (fromTeamId === gameRow.playerTeamId || toTeamId === gameRow.playerTeamId)) {
    const direction = fromTeamId === gameRow.playerTeamId ? 'out' : 'in'
    const clubId = gameRow.playerTeamId

    // The bar the player is measured against is their new or former team-mates.
    const squad = await tx.query.players.findMany({
      where: and(eq(players.teamId, clubId), eq(players.retired, 0), eq(players.freeAgent, 0)),
      columns: { skillLevel: true },
    })
    const best = squad.reduce((top, member) => Math.max(top, member.skillLevel), 0)

    const delta = transferReaction(player.skillLevel, best || player.skillLevel, direction)
    if (delta !== 0)
      fanConfidence = await nudgeFans(tx, gameRow.id, gameRow.fanConfidence, delta)

    await postNews(tx, gameRow.id, [{
      season,
      round,
      category: 'transfer',
      tone: delta > 0 ? 'positive' : delta < 0 ? 'negative' : 'neutral',
      headline: direction === 'out'
        ? `${player.name} joins ${to.name}`
        : `${player.name} signs from ${from.name}`,
      body: fee > 0
        ? `Fee of €${fee.toLocaleString('en-IE')}.`
        : 'Signed on a free transfer.',
    }])
  }

  return {
    playerName: player.name,
    fromTeamName: from.name,
    toTeamName: to.name,
    fee,
    fanConfidence,
  }
}

// ---------------------------------------------------------------------------
// AI interest in the manager's squad
// ---------------------------------------------------------------------------

/**
 * What a club is willing to pay over the odds.
 *
 * A stronger, richer club pays a bigger premium — it wants the player more and
 * can absorb the cost. Mirrors the premium band the manager's own sale path
 * uses, so bidding and selling price the same world the same way.
 */
function offerPremium(bidderReputation: number): number {
  const standing = Math.max(0, Math.min(1, bidderReputation / 100))
  return 0.08 + standing * 0.30 + Math.random() * 0.12
}

/**
 * Marks bids that have sat unanswered too long, for one club's own save.
 *
 * `playerTeamId` scopes to `toTeamId` — without it this would expire another
 * save's pending offers the moment their round numbers happened to line up.
 */
export async function expireStaleOffers(playerTeamId: number, season: number, round: number): Promise<number> {
  const stale = await db.query.transferOffers.findMany({
    where: and(
      eq(transferOffers.toTeamId, playerTeamId),
      eq(transferOffers.status, 'pending'),
      eq(transferOffers.season, season),
      lt(transferOffers.round, round - OFFER_LIFETIME_ROUNDS),
    ),
    columns: { id: true },
  })

  if (!stale.length)
    return 0

  await db.update(transferOffers)
    .set({ status: 'expired' })
    .where(inArray(transferOffers.id, stale.map(offer => offer.id)))

  return stale.length
}

/**
 * Generates AI bids for the manager's players, one matchday at a time.
 *
 * Deliberately restrained: a club that received four bids every week would be
 * running an auction house rather than a season. At most one new offer per
 * matchday, and only when the squad is big enough that selling is a real
 * choice rather than a forced one.
 */
export async function generateTransferOffers(gameRow: GameRow, season: number, round: number): Promise<number> {
  if (!gameRow || gameRow.dismissedAtSeason !== null)
    return 0

  if (Math.random() > OFFER_CHANCE_PER_MATCHDAY)
    return 0

  const pending = await db.query.transferOffers.findMany({
    where: and(
      eq(transferOffers.toTeamId, gameRow.playerTeamId),
      eq(transferOffers.status, 'pending'),
      eq(transferOffers.season, season),
    ),
    columns: { id: true, playerId: true },
  })

  if (pending.length >= MAX_PENDING_OFFERS)
    return 0

  const squad = await db.query.players.findMany({
    where: and(
      eq(players.teamId, gameRow.playerTeamId),
      eq(players.retired, 0),
      eq(players.freeAgent, 0),
    ),
  })

  // Selling out of a thin squad should be the manager's decision to seek, not
  // one the market keeps pressing on them.
  if (squad.length <= MIN_SQUAD_SIZE_TO_SELL)
    return 0

  const alreadyWanted = new Set(pending.map(offer => offer.playerId))
  const targets = squad
    .filter(player => !alreadyWanted.has(player.id))
    .filter(player => !saleBlockedReason(squad, player.id))
    .sort((a, b) => b.skillLevel - a.skillLevel)
    // Interest concentrates on the better half of the squad — nobody bids for
    // the twentieth-best player at the club.
    .slice(0, Math.max(1, Math.floor(squad.length / 2)))

  const target = targets[Math.floor(Math.random() * targets.length)]
  if (!target)
    return 0

  // Suitors are this save's own other clubs — a bid from another save's
  // Real Madrid clone would be nonsensical.
  const suitors = await db.query.teams.findMany({
    where: and(eq(teams.gameId, gameRow.id), ne(teams.id, gameRow.playerTeamId)),
  })
  if (!suitors.length)
    return 0

  // Only clubs that would actually be improved, and can actually pay.
  const squadsByTeam = await db.query.players.findMany({
    where: and(
      inArray(players.teamId, suitors.map(club => club.id)),
      eq(players.retired, 0),
      eq(players.freeAgent, 0),
    ),
    columns: { teamId: true, skillLevel: true },
  })

  const bestByTeam = new Map<number, number>()
  for (const member of squadsByTeam) {
    bestByTeam.set(member.teamId, Math.max(bestByTeam.get(member.teamId) ?? 0, member.skillLevel))
  }

  const candidates = suitors
    .map(club => ({ club, amount: Math.round(target.marketValue * (1 + offerPremium(club.reputation))) }))
    .filter(({ club, amount }) =>
      club.bankBalance >= amount
      // A club does not bid for someone who would not get into its side.
      && target.skillLevel >= (bestByTeam.get(club.id) ?? 0) - 4)

  const winner = candidates[Math.floor(Math.random() * candidates.length)]
  if (!winner)
    return 0

  await db.insert(transferOffers).values({
    playerId: target.id,
    fromTeamId: winner.club.id,
    toTeamId: gameRow.playerTeamId,
    amount: winner.amount,
    season,
    round,
    status: 'pending',
    createdAt: new Date(),
  })

  await postNews(db, gameRow.id, [{
    season,
    round,
    category: 'transfer',
    tone: 'neutral',
    headline: `${winner.club.name} bid for ${target.name}`,
    body: `€${winner.amount.toLocaleString('en-IE')} offered. The bid stands for ${OFFER_LIFETIME_ROUNDS} matchdays.`,
  }])

  return 1
}

/** Runs the market's own matchday: lapse old bids, then maybe make a new one. */
export async function runTransferMarket(gameRow: GameRow, season: number, round: number): Promise<{ expired: number; created: number }> {
  const expired = await expireStaleOffers(gameRow.playerTeamId, season, round)
  const created = await generateTransferOffers(gameRow, season, round)

  return { expired, created }
}

// ---------------------------------------------------------------------------
// Answering a bid
// ---------------------------------------------------------------------------

export interface OfferDecision {
  offerId: number
  /** The offer must belong to this save's own club — never trust the id alone. */
  toTeamId: number
  accept: boolean
  season: number
  round: number
}

export async function resolveOffer(decision: OfferDecision): Promise<TransferOutcome | null> {
  const offer = await db.query.transferOffers.findFirst({
    where: and(
      eq(transferOffers.id, decision.offerId),
      eq(transferOffers.toTeamId, decision.toTeamId),
      eq(transferOffers.status, 'pending'),
    ),
  })

  if (!offer) {
    throw createError({ statusCode: 404, statusMessage: 'That offer is no longer on the table' })
  }

  if (!decision.accept) {
    await db.update(transferOffers)
      .set({ status: 'rejected' })
      .where(eq(transferOffers.id, offer.id))

    return null
  }

  return db.transaction(async (tx) => {
    await tx.update(transferOffers)
      .set({ status: 'accepted' })
      .where(eq(transferOffers.id, offer.id))

    // Any other club still chasing the same player is out of luck.
    await tx.update(transferOffers)
      .set({ status: 'expired' })
      .where(and(eq(transferOffers.playerId, offer.playerId), eq(transferOffers.status, 'pending')))

    return settleTransfer(tx, {
      playerId: offer.playerId,
      fromTeamId: offer.toTeamId,
      toTeamId: offer.fromTeamId,
      fee: offer.amount,
      season: decision.season,
      round: decision.round,
      // A club that just paid this much has repriced him.
      newMarketValue: offer.amount,
      enforceSquadMinimums: true,
    })
  })
}

export { transferOffers, clubNews }
