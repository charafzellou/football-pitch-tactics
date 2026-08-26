/**
 * The ground between matches.
 *
 * A stadium sits empty for six days out of seven, and a chairman who leaves it
 * that way is leaving money on the table. Promoters want it; the pitch pays for
 * it. That exchange — cash now against a surface the team has to play on — is
 * the whole of this module.
 *
 * Bookings attach to a **round**, never to a date. Nothing in this game happens
 * on a day that is not a fixture date, and the stadium is not the place to
 * invent a second clock.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../db'
import { stadiumEvents, teams } from '../db/schema'
import {
  EVENT_KINDS,
  EVENT_PROFILES,
  eventFeeFor,
  recoverPitch,
  wearPitch,
} from './economy'
import type { StadiumEventKind } from './economy'
import { postLedger } from './finance'
import { nudgeFans } from './board'
import { postNews } from './news'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Matchdays a promoter waits for an answer. */
export const EVENT_OFFER_LIFETIME_ROUNDS = 3

/** How often somebody asks about the ground. */
const APPROACH_CHANCE_PER_ROUND = 0.55

/** Most bookings a club can have waiting to be answered. */
const MAX_PENDING_OFFERS = 3

/** How far ahead a promoter books. */
const LEAD_ROUNDS = 2

const PROMOTERS = [
  'Fenwick Live', 'Northgate Events', 'Rialto Touring', 'Highwater Promotions',
  'Cascade Entertainment', 'Bellmark Group', 'Argent Live', 'Silverline Events',
]

const ACTS = [
  'a stadium tour date', 'a two-night residency', 'a summer festival bill',
  'a farewell tour date', 'an arena headliner',
]

function pick<T>(pool: T[]): T {
  return pool[Math.floor(Math.random() * pool.length)]!
}

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------

export interface StadiumOfferContext {
  teamId: number
  season: number
  round: number
  totalRounds: number
}

/**
 * A promoter comes forward for a free week.
 *
 * One at a time, and never for a round already spoken for — a page listing six
 * simultaneous concerts would read as a menu rather than as somebody asking.
 */
export async function generateEventOffers(context: StadiumOfferContext): Promise<number> {
  if (Math.random() > APPROACH_CHANCE_PER_ROUND) return 0

  const club = await db.query.teams.findFirst({ where: eq(teams.id, context.teamId) })
  if (!club) return 0

  const existing = await db.query.stadiumEvents.findMany({
    where: and(eq(stadiumEvents.teamId, context.teamId), eq(stadiumEvents.season, context.season)),
  })

  const pending = existing.filter(row => row.status === 'offered')
  if (pending.length >= MAX_PENDING_OFFERS) return 0

  const targetRound = context.round + LEAD_ROUNDS
  if (targetRound > context.totalRounds) return 0

  // One booking per week. The ground cannot host two things at once.
  const taken = new Set(existing
    .filter(row => row.status === 'offered' || row.status === 'booked')
    .map(row => row.round))
  if (taken.has(targetRound)) return 0

  const kind = pick([...EVENT_KINDS]) as StadiumEventKind
  const profile = EVENT_PROFILES[kind]
  const fee = Math.round(eventFeeFor(kind, club.stadiumCapacity, club.reputation) * (0.9 + Math.random() * 0.2))

  await db.insert(stadiumEvents).values({
    teamId: context.teamId,
    season: context.season,
    round: targetRound,
    kind,
    promoterName: kind === 'concert' ? `${pick(PROMOTERS)} — ${pick(ACTS)}` : pick(PROMOTERS),
    fee,
    pitchWear: profile.wear,
    fanReaction: profile.fanReaction,
    status: 'offered',
    createdAt: new Date(),
  })

  return 1
}

/** Promoters do not wait for ever, and a week that has passed cannot be sold. */
export async function expireStaleEventOffers(teamId: number, season: number, round: number): Promise<number> {
  const offers = await db.query.stadiumEvents.findMany({
    where: and(eq(stadiumEvents.teamId, teamId), eq(stadiumEvents.season, season), eq(stadiumEvents.status, 'offered')),
  })

  const gone = offers.filter(row => row.round <= round)
  if (!gone.length) return 0

  await db.update(stadiumEvents)
    .set({ status: 'expired' })
    .where(inArray(stadiumEvents.id, gone.map(row => row.id)))

  return gone.length
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

export interface StadiumSettlement {
  held: { label: string; fee: number }[]
  pitchCondition: number
}

/**
 * One matchday at the ground: the pitch recovers a little, and anything booked
 * for this round happens.
 *
 * Runs once per round for the manager's club, whether they were at home or away
 * — a concert takes place at the ground regardless of where the team played.
 */
export async function settleStadiumForRound(input: {
  gameId: number
  teamId: number
  season: number
  round: number
  fanConfidence: number
}): Promise<StadiumSettlement> {
  const club = await db.query.teams.findFirst({ where: eq(teams.id, input.teamId) })
  if (!club) return { held: [], pitchCondition: 100 }

  const due = await db.query.stadiumEvents.findMany({
    where: and(
      eq(stadiumEvents.teamId, input.teamId),
      eq(stadiumEvents.season, input.season),
      eq(stadiumEvents.status, 'booked'),
    ),
  })

  const happening = due.filter(row => row.round === input.round)

  // The pitch recovers first, then takes whatever this week does to it.
  let condition = recoverPitch(club.pitchCondition)
  const held: { label: string; fee: number }[] = []

  await db.transaction(async (tx) => {
    for (const event of happening) {
      const profile = EVENT_PROFILES[event.kind as StadiumEventKind]
      condition = wearPitch(condition, event.pitchWear)
      held.push({ label: profile?.label ?? event.kind, fee: event.fee })

      await postLedger(tx, [{
        teamId: input.teamId,
        season: input.season,
        round: input.round,
        type: 'event_hire',
        amount: event.fee,
        description: `${profile?.label ?? event.kind} — ${event.promoterName}`,
      }])

      if (event.fanReaction !== 0)
        await nudgeFans(tx, input.gameId, input.fanConfidence, event.fanReaction)

      await postNews(tx, input.gameId, [{
        season: input.season,
        round: input.round,
        category: 'finance',
        tone: event.fanReaction < 0 ? 'negative' : 'positive',
        headline: `${profile?.label ?? event.kind} at ${club.stadiumName ?? 'the ground'}`,
        body: `${event.fee.toLocaleString('en-IE')} for the week`
          + (event.pitchWear > 0 ? `, and the pitch will need a fortnight.` : '.'),
      }])
    }

    if (happening.length) {
      await tx.update(stadiumEvents)
        .set({ status: 'held' })
        .where(inArray(stadiumEvents.id, happening.map(row => row.id)))
    }

    if (condition !== club.pitchCondition)
      await tx.update(teams).set({ pitchCondition: condition }).where(eq(teams.id, input.teamId))
  })

  return { held, pitchCondition: condition }
}

/**
 * The ground's own matchday routine: bookings settle, then promoters call about
 * the weeks still free.
 */
export async function runStadiumDiary(input: {
  gameId: number
  teamId: number
  season: number
  round: number
  totalRounds: number
  fanConfidence: number
}): Promise<{ held: number; expired: number; offered: number }> {
  const settlement = await settleStadiumForRound(input)
  const expired = await expireStaleEventOffers(input.teamId, input.season, input.round)
  const offered = await generateEventOffers(input)

  return { held: settlement.held.length, expired, offered }
}
