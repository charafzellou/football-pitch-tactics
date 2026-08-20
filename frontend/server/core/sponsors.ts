/**
 * Commercial partnerships.
 *
 * The chairman's half of the club's income. `sponsorshipFor()` used to hand
 * every club one number every matchday with no decision attached to it; this
 * turns the manager's share of that number into contracts with a length, a fee
 * and something to play for.
 *
 * ## The choice the offers are built around
 *
 * A partner who commits for five seasons is buying certainty and prices it in:
 * they pay a little less per matchday and put less behind performance. A partner
 * who commits for one is betting on you, and pays for the privilege of
 * re-pricing sooner. Neither is right — a club on the way up wants the short
 * deal, a club that has just overachieved wants the long one — which is exactly
 * what makes signing one a decision rather than a formality.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../db'
import { sponsorshipDeals, teams } from '../db/schema'
import {
  COMMERCIAL_SLOTS,
  SLOT_LABELS,
  commercialPoolFor,
  slotValueFor,
} from './economy'
import type { CommercialSlot } from './economy'
import { lengthDiscount } from './contracts'
import { leagueStandingFor, postLedger } from './finance'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Matchdays an unanswered offer stays on the table. */
export const OFFER_LIFETIME_ROUNDS = 4

/**
 * Fan feeling about a ground losing its own name.
 *
 * Deliberately the largest single reaction any commercial decision produces.
 * Naming rights are the one deal that changes something supporters can see from
 * the street, and money that costs nothing is not a decision.
 */
export const NAMING_RIGHTS_FAN_COST = -9

// ---------------------------------------------------------------------------
// Sponsors
// ---------------------------------------------------------------------------

/**
 * Invented names, by the kind of business that buys each slot.
 *
 * Fictional on purpose: a real brand on a shirt in a game that also models the
 * club going bankrupt is a claim about a real company nobody asked for.
 */
const SPONSOR_POOLS: Record<CommercialSlot, string[]> = {
  shirt: [
    'Aurelian Airways', 'Northwind Bank', 'Veltro Telecom', 'Halcyon Energy',
    'Meridian Assurance', 'Cobalt Motors', 'Solvay Logistics', 'Kestrel Air',
    'Ironvale Steel', 'Lumen Broadband', 'Pallas Capital', 'Verdant Foods',
  ],
  kit_maker: [
    'Strider', 'Kaskade', 'Vulpes Athletic', 'Orbis Sport',
    'Talon', 'Nimbus Athletic', 'Corvid', 'Sable Sportswear',
  ],
  sleeve: [
    'Bright Harbour', 'Quillon', 'Fenwick & Rye', 'Astra Rentals',
    'Pinehall Group', 'Marlow Digital', 'Everline', 'Copperbridge',
  ],
  naming_rights: [
    'Aurelian', 'Northwind', 'Halcyon', 'Meridian',
    'Cobalt', 'Kestrel', 'Lumen', 'Pallas', 'Verdant', 'Solvay',
  ],
}

function pick<T>(pool: T[], exclude: Set<string> = new Set()): T {
  const available = pool.filter(entry => !exclude.has(String(entry)))
  const from = available.length ? available : pool
  return from[Math.floor(Math.random() * from.length)]!
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

/**
 * The term a slot's market rate is quoted for.
 *
 * Everything is priced relative to this, so a standard deal pays exactly what
 * the slot is worth — which is what keeps a club that simply renews on time
 * earning what the blended `sponsorship` credit used to pay it, and therefore
 * what keeps `COMMERCIAL_UPLIFT` honest.
 */
const STANDARD_SEASONS = 3

/**
 * How a deal's length moves its fee — the same curve a player's contract uses.
 *
 * `lengthDiscount()` comes from `contracts.ts` rather than being a second set of
 * numbers here, so "security is worth something" means the same thing to a
 * sponsor as it does to a centre-half: 3% off the rate per extra year committed.
 * Two curves would have drifted the first time either was tuned, and the game
 * would have been quietly teaching two different lessons about the same
 * trade-off.
 *
 * Normalised against the standard term so the middle shape is exactly ×1 —
 * `lengthDiscount()` is anchored at one season, and using it raw would have
 * priced every ordinary renewal 6% under the market rate the calibration is
 * built on.
 */
export function feeFactorFor(seasons: number): number {
  return lengthDiscount(seasons) / lengthDiscount(STANDARD_SEASONS)
}

export interface OfferShape {
  seasons: number
  /** Multiplier on the slot's market rate, from `feeFactorFor()`. */
  feeFactor: number
  /** Bonus sizes as multiples of the per-matchday fee. */
  championMultiple: number
  topFourMultiple: number
  survivalMultiple: number
  label: string
}

/**
 * The three shapes every negotiation offers, so the trade-off is visible at a
 * glance rather than discovered by accepting one.
 */
export const OFFER_SHAPES: OfferShape[] = [
  {
    label: 'Long term',
    seasons: 5,
    feeFactor: feeFactorFor(5),
    championMultiple: 6,
    topFourMultiple: 2.5,
    survivalMultiple: 1.5,
  },
  {
    label: 'Standard',
    seasons: STANDARD_SEASONS,
    feeFactor: feeFactorFor(STANDARD_SEASONS),
    championMultiple: 10,
    topFourMultiple: 4,
    survivalMultiple: 2,
  },
  {
    label: 'Short and rich',
    seasons: 1,
    feeFactor: feeFactorFor(1),
    championMultiple: 16,
    topFourMultiple: 7,
    survivalMultiple: 3,
  },
]

/**
 * How keen the market is on this club right now.
 *
 * Supporters are the audience a sponsor is buying, so how they feel moves the
 * price — which quietly ties the commercial department to results and to the
 * ticket price, without another dial.
 */
export function marketAppetite(fanConfidence: number): number {
  return 0.88 + (Math.max(0, Math.min(100, fanConfidence)) / 100) * 0.28
}

export interface SlotValuation {
  slot: CommercialSlot
  label: string
  marketRate: number
}

export function valuationsFor(pool: number): SlotValuation[] {
  return COMMERCIAL_SLOTS.map(slot => ({
    slot,
    label: SLOT_LABELS[slot],
    marketRate: slotValueFor(pool, slot),
  }))
}

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------

export interface DealContext {
  teamId: number
  season: number
  round: number
  pool: number
  fanConfidence: number
}

/**
 * Puts offers on the table for every slot that is free or in its final season.
 *
 * Persisted rather than generated per page load, for the reason
 * `transfer_offers` already documents: an offer you can reroll by refreshing is
 * not a decision, it is a slot machine.
 */
export async function generateSponsorshipOffers(context: DealContext): Promise<number> {
  const existing = await db.query.sponsorshipDeals.findMany({
    where: eq(sponsorshipDeals.teamId, context.teamId),
  })

  const active = existing.filter(row => row.status === 'active' && row.untilSeason >= context.season)
  const pending = existing.filter(row => row.status === 'offered')

  const appetite = marketAppetite(context.fanConfidence)
  const usedNames = new Set(existing.map(row => row.sponsorName))
  const rows: (typeof sponsorshipDeals.$inferInsert)[] = []
  const now = new Date()

  for (const slot of COMMERCIAL_SLOTS) {
    // Nothing to negotiate while a deal is running and not yet in its last season.
    const running = active.find(row => row.slot === slot)
    if (running && running.untilSeason > context.season) continue
    if (pending.some(row => row.slot === slot)) continue

    const marketRate = slotValueFor(context.pool, slot)

    for (const shape of OFFER_SHAPES) {
      const name = pick(SPONSOR_POOLS[slot], usedNames)
      usedNames.add(name)

      // A little character per offer, so two clubs never see the same table.
      const character = 0.95 + Math.random() * 0.12
      const fee = Math.max(1_000, Math.round(marketRate * shape.feeFactor * appetite * character))

      rows.push({
        teamId: context.teamId,
        slot,
        sponsorName: name,
        baseFee: fee,
        seasons: shape.seasons,
        signedSeason: context.season,
        untilSeason: context.season + shape.seasons - 1,
        bonusChampion: Math.round(fee * shape.championMultiple),
        bonusTopFour: Math.round(fee * shape.topFourMultiple),
        bonusSurvival: Math.round(fee * shape.survivalMultiple),
        status: 'offered',
        round: context.round,
        createdAt: now,
      })
    }
  }

  if (rows.length)
    await db.insert(sponsorshipDeals).values(rows)

  return rows.length
}

/** Drops offers the manager has left on the table too long. */
export async function expireStaleOffers(season: number, round: number): Promise<number> {
  const stale = await db.query.sponsorshipDeals.findMany({
    where: and(
      eq(sponsorshipDeals.status, 'offered'),
      eq(sponsorshipDeals.signedSeason, season),
    ),
  })

  const expired = stale.filter(row => row.round < round - OFFER_LIFETIME_ROUNDS)
  if (!expired.length) return 0

  await db.update(sponsorshipDeals)
    .set({ status: 'expired' })
    .where(inArray(sponsorshipDeals.id, expired.map(row => row.id)))

  return expired.length
}

// ---------------------------------------------------------------------------
// Income
// ---------------------------------------------------------------------------

/** Deals paying this season, for one club. */
export async function activeDeals(teamId: number, season: number) {
  const rows = await db.query.sponsorshipDeals.findMany({
    where: and(eq(sponsorshipDeals.teamId, teamId), eq(sponsorshipDeals.status, 'active')),
  })

  return rows.filter(row => row.signedSeason <= season && row.untilSeason >= season)
}

/**
 * Season-end bonuses for every deal that earned one.
 *
 * Paid at the rollover next to prize money, because both are a verdict on the
 * season just finished rather than income from the one starting.
 */
export async function paySponsorshipBonuses(
  tx: Tx,
  teamId: number,
  season: number,
  position: number,
  leagueSize: number,
): Promise<{ description: string; amount: number }[]> {
  const rows = await tx.query.sponsorshipDeals.findMany({
    where: and(eq(sponsorshipDeals.teamId, teamId), eq(sponsorshipDeals.status, 'active')),
  })

  const paying = rows.filter(row => row.signedSeason <= season && row.untilSeason >= season)
  const relegationZone = leagueSize - 2
  const awarded: { description: string; amount: number }[] = []

  for (const deal of paying) {
    let amount = 0
    let reason = ''

    if (position === 1 && deal.bonusChampion > 0) {
      amount = deal.bonusChampion
      reason = 'winning the league'
    }
    else if (position <= 4 && deal.bonusTopFour > 0) {
      amount = deal.bonusTopFour
      reason = 'a top-four finish'
    }
    else if (position < relegationZone && deal.bonusSurvival > 0) {
      amount = deal.bonusSurvival
      reason = 'staying up'
    }

    if (amount > 0)
      awarded.push({ description: `${deal.sponsorName} bonus — ${reason}`, amount })
  }

  if (awarded.length) {
    await postLedger(tx, awarded.map(entry => ({
      teamId,
      season,
      round: 0,
      type: 'bonus' as const,
      amount: entry.amount,
      description: entry.description,
    })))
  }

  return awarded
}

/**
 * Retires deals whose last season has passed, handing a sold ground its own
 * name back.
 */
export async function expireDeals(tx: Tx, teamId: number, newSeason: number): Promise<string[]> {
  const rows = await tx.query.sponsorshipDeals.findMany({
    where: and(eq(sponsorshipDeals.teamId, teamId), eq(sponsorshipDeals.status, 'active')),
  })

  const finished = rows.filter(row => row.untilSeason < newSeason)
  if (!finished.length) return []

  await tx.update(sponsorshipDeals)
    .set({ status: 'expired' })
    .where(inArray(sponsorshipDeals.id, finished.map(row => row.id)))

  if (finished.some(row => row.slot === 'naming_rights')) {
    const club = await tx.query.teams.findFirst({ where: eq(teams.id, teamId) })
    if (club?.stadiumBaseName)
      await tx.update(teams).set({ stadiumName: club.stadiumBaseName }).where(eq(teams.id, teamId))
  }

  return finished.map(row => `${SLOT_LABELS[row.slot as CommercialSlot] ?? row.slot} — ${row.sponsorName}`)
}

/** The club's commercial pool right now, for pricing every slot off. */
export async function poolFor(teamId: number, season: number, round: number): Promise<number> {
  const standing = await leagueStandingFor(teamId, season, round)
  if (!standing) return 0

  return commercialPoolFor(standing.club.reputation, standing.position, standing.leagueSize)
}

/**
 * The deals a save starts with: the three kit slots sold at the market rate on
 * staggered terms, and the ground still called what it has always been called.
 *
 * Staggered deliberately — three partnerships all expiring in the same summer
 * would hand the manager one enormous decision every third season and nothing
 * to do in between.
 */
export function openingDeals(input: {
  teamId: number
  season: number
  slotFee: (slot: CommercialSlot) => number
}): (typeof sponsorshipDeals.$inferInsert)[] {
  const now = new Date()
  const terms: Record<Exclude<CommercialSlot, 'naming_rights'>, number> = {
    shirt: 3,
    kit_maker: 4,
    sleeve: 2,
  }

  const usedNames = new Set<string>()

  return (Object.keys(terms) as (keyof typeof terms)[]).map((slot) => {
    const fee = input.slotFee(slot)
    const name = pick(SPONSOR_POOLS[slot], usedNames)
    usedNames.add(name)

    return {
      teamId: input.teamId,
      slot,
      sponsorName: name,
      baseFee: fee,
      seasons: terms[slot],
      signedSeason: input.season,
      untilSeason: input.season + terms[slot] - 1,
      bonusChampion: Math.round(fee * 10),
      bonusTopFour: Math.round(fee * 4),
      bonusSurvival: Math.round(fee * 2),
      status: 'active',
      round: 0,
      createdAt: now,
    }
  })
}

/**
 * The commercial market for one matchday: lapse what has gone stale, then put
 * fresh offers on the table for anything unsold.
 *
 * Mirrors `runTransferMarket()` and runs alongside it at full time, so both
 * markets move on the same clock the rest of the game does.
 */
export async function runCommercialMarket(input: {
  teamId: number
  season: number
  round: number
  fanConfidence: number
}): Promise<{ expired: number; created: number }> {
  const expired = await expireStaleOffers(input.season, input.round)

  const pool = await poolFor(input.teamId, input.season, input.round)
  if (!pool) return { expired, created: 0 }

  const created = await generateSponsorshipOffers({
    teamId: input.teamId,
    season: input.season,
    round: input.round,
    pool,
    fanConfidence: input.fanConfidence,
  })

  return { expired, created }
}
