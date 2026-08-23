import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { stadiumEvents, teams } from '../../db/schema'
import {
  EVENT_PROFILES,
  EXPANSION_STEP,
  HOSPITALITY_BOX_COST,
  HOSPITALITY_BOX_SEATS,
  MAX_HOSPITALITY_BOXES,
  MAX_SEASON_TICKET_DISCOUNT,
  MAX_SEASON_TICKET_SHARE,
  MAX_STADIUM_CAPACITY,
  MIN_PITCH_CONDITION,
  attendanceFor,
  expansionCost,
  fairTicketPrice,
  gateReceiptsFor,
  hospitalityIncomeFor,
  pitchPenaltyFor,
  seasonTicketHolders,
  seasonTicketRevenue,
  seatsLostToBoxes,
} from '../../core/economy'
import type { StadiumEventKind } from '../../core/economy'
import { leagueStandingFor } from '../../core/finance'
import { EVENT_OFFER_LIFETIME_ROUNDS } from '../../core/stadium'
import { getSeasonStatus } from '../../core/season'
import { activeSave } from '../../core/save'

/**
 * The ground: what it holds, what it charges, what it costs, and what else it
 * could be doing with the six days a week nobody plays football on it.
 */
export default defineEventHandler(async (event) => {
  const gameState = await activeSave(event)
  if (!gameState) return null

  const club = await db.query.teams.findFirst({ where: eq(teams.id, gameState.playerTeamId) })
  if (!club) return null

  const [status, standing, events] = await Promise.all([
    getSeasonStatus(gameState),
    leagueStandingFor(club.id, gameState.season, 0),
    db.query.stadiumEvents.findMany({
      where: and(eq(stadiumEvents.teamId, club.id), eq(stadiumEvents.season, gameState.season)),
    }),
  ])

  const round = status?.round ?? 0
  const totalRounds = status?.totalRounds ?? 38
  const homeMatches = totalRounds / 2

  const generalCapacity = Math.max(0, club.stadiumCapacity - seatsLostToBoxes(club.hospitalityBoxes))
  const naturalAttendance = attendanceFor({
    capacity: generalCapacity,
    reputation: club.reputation,
    ticketPrice: club.ticketPrice,
    opponentReputation: 55,
    formRating: 0.5,
    position: standing?.position ?? 10,
    leagueSize: standing?.leagueSize ?? 20,
  })

  const holders = seasonTicketHolders(generalCapacity, club.seasonTicketShare)
  const attendance = Math.max(naturalAttendance, holders)
  const walkUp = Math.max(0, attendance - holders)

  const describe = (kind: string) => EVENT_PROFILES[kind as StadiumEventKind]

  return {
    season: gameState.season,
    round,
    totalRounds,
    balance: club.bankBalance,
    club: {
      stadiumName: club.stadiumName,
      stadiumCapacity: club.stadiumCapacity,
      generalCapacity,
      ticketPrice: club.ticketPrice,
      fairTicketPrice: fairTicketPrice(club.reputation),
    },
    attendance: {
      typical: attendance,
      walkUp,
      holders,
      fillPercent: generalCapacity > 0 ? Math.round((attendance / generalCapacity) * 100) : 0,
      gatePerMatch: gateReceiptsFor(walkUp, club.ticketPrice),
    },
    seasonTickets: {
      share: club.seasonTicketShare,
      discount: club.seasonTicketDiscount,
      maxShare: MAX_SEASON_TICKET_SHARE,
      maxDiscount: MAX_SEASON_TICKET_DISCOUNT,
      holders,
      /** What next summer's sale would bank, at the current terms. */
      lumpSum: seasonTicketRevenue(holders, club.ticketPrice, club.seasonTicketDiscount, homeMatches),
      /** What those same seats would have earned at the gate over a season. */
      forgone: gateReceiptsFor(Math.min(naturalAttendance, holders), club.ticketPrice) * homeMatches,
    },
    hospitality: {
      boxes: club.hospitalityBoxes,
      maxBoxes: MAX_HOSPITALITY_BOXES,
      seatsPerBox: HOSPITALITY_BOX_SEATS,
      boxCost: HOSPITALITY_BOX_COST,
      canAfford: club.bankBalance >= HOSPITALITY_BOX_COST,
      perHomeMatch: hospitalityIncomeFor(club.hospitalityBoxes, club.reputation, 55),
      nextBoxPerHomeMatch: hospitalityIncomeFor(1, club.reputation, 55),
      seatsLost: seatsLostToBoxes(club.hospitalityBoxes),
    },
    pitch: {
      condition: club.pitchCondition,
      floor: MIN_PITCH_CONDITION,
      /** What a worn surface costs the side, in tactic-modifier units. */
      penalty: Math.round(pitchPenaltyFor(club.pitchCondition) * 100) / 100,
    },
    expansion: {
      step: EXPANSION_STEP,
      cost: expansionCost(EXPANSION_STEP),
      maxCapacity: MAX_STADIUM_CAPACITY,
      canAfford: club.bankBalance >= expansionCost(EXPANSION_STEP),
      atMax: club.stadiumCapacity >= MAX_STADIUM_CAPACITY,
    },
    diary: {
      offers: events
        .filter(row => row.status === 'offered' && row.round > round)
        .map(row => ({
          id: row.id,
          round: row.round,
          kind: row.kind,
          label: describe(row.kind)?.label ?? row.kind,
          description: describe(row.kind)?.description ?? '',
          promoterName: row.promoterName,
          fee: row.fee,
          pitchWear: row.pitchWear,
          fanReaction: row.fanReaction,
          roundsToDecide: Math.max(0, Math.min(EVENT_OFFER_LIFETIME_ROUNDS, row.round - round)),
        }))
        .sort((a, b) => a.round - b.round),
      booked: events
        .filter(row => row.status === 'booked')
        .map(row => ({
          id: row.id,
          round: row.round,
          label: describe(row.kind)?.label ?? row.kind,
          promoterName: row.promoterName,
          fee: row.fee,
          pitchWear: row.pitchWear,
        }))
        .sort((a, b) => a.round - b.round),
      held: events
        .filter(row => row.status === 'held')
        .map(row => ({
          id: row.id,
          round: row.round,
          label: describe(row.kind)?.label ?? row.kind,
          fee: row.fee,
        }))
        .sort((a, b) => b.round - a.round),
      earned: events.filter(row => row.status === 'held').reduce((total, row) => total + row.fee, 0),
    },
  }
})
