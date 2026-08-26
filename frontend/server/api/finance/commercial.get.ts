import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { sponsorshipDeals, teams } from '../../db/schema'
import {
  MAX_PERIMETER_LEVEL,
  PERIMETER_TIERS,
  SLOT_LABELS,
  merchandisingFor,
  perimeterIncomeFor,
  perimeterTier,
  perimeterUpgradeCost,
  starPowerOf,
} from '../../core/economy'
import type { CommercialSlot } from '../../core/economy'
import { leagueStandingFor } from '../../core/finance'
import { OFFER_LIFETIME_ROUNDS, poolFor, valuationsFor } from '../../core/sponsors'
import { getSeasonStatus } from '../../core/season'
import { activeSave } from '../../core/save'

/**
 * The commercial department: who pays the club, what the open slots are worth,
 * and what the hoardings could be earning.
 */
export default defineEventHandler(async (event) => {
  const gameState = await activeSave(event)
  if (!gameState) return null

  const club = await db.query.teams.findFirst({ where: eq(teams.id, gameState.playerTeamId) })
  if (!club) return null

  const status = await getSeasonStatus(gameState)
  const round = status?.round ?? 0

  const [rows, standing, squad] = await Promise.all([
    db.query.sponsorshipDeals.findMany({ where: eq(sponsorshipDeals.teamId, club.id) }),
    leagueStandingFor(club.id, gameState.season, round),
    db.query.players.findMany({
      where: (players, { and: every, eq: is }) => every(
        is(players.teamId, club.id), is(players.retired, 0), is(players.freeAgent, 0),
      ),
      columns: { skillLevel: true },
    }),
  ])

  const pool = await poolFor(club.id, gameState.season, round)
  const position = standing?.position ?? 10
  const leagueSize = standing?.leagueSize ?? 20

  const active = rows
    .filter(row => row.status === 'active' && row.untilSeason >= gameState.season)
    .map(row => ({
      id: row.id,
      slot: row.slot,
      slotLabel: SLOT_LABELS[row.slot as CommercialSlot] ?? row.slot,
      sponsorName: row.sponsorName,
      baseFee: row.baseFee,
      perSeason: row.baseFee * (status?.totalRounds ?? 38),
      signedSeason: row.signedSeason,
      untilSeason: row.untilSeason,
      seasonsLeft: row.untilSeason - gameState.season + 1,
      finalSeason: row.untilSeason === gameState.season,
      bonusChampion: row.bonusChampion,
      bonusTopFour: row.bonusTopFour,
      bonusSurvival: row.bonusSurvival,
    }))

  const offers = rows
    .filter(row => row.status === 'offered')
    .map(row => ({
      id: row.id,
      slot: row.slot,
      slotLabel: SLOT_LABELS[row.slot as CommercialSlot] ?? row.slot,
      sponsorName: row.sponsorName,
      baseFee: row.baseFee,
      perSeason: row.baseFee * (status?.totalRounds ?? 38),
      seasons: row.seasons,
      untilSeason: row.untilSeason,
      bonusChampion: row.bonusChampion,
      bonusTopFour: row.bonusTopFour,
      bonusSurvival: row.bonusSurvival,
      roundsRemaining: Math.max(0, OFFER_LIFETIME_ROUNDS - (round - row.round)),
    }))
    .sort((a, b) => b.baseFee - a.baseFee)

  // What a typical home crowd is doing, so the hoardings can be priced.
  const typicalFill = 0.76
  const currentPerimeter = perimeterIncomeFor(pool, club.perimeterLevel, typicalFill, position, leagueSize)
  const nextLevel = Math.min(MAX_PERIMETER_LEVEL, club.perimeterLevel + 1)
  const nextIncome = perimeterIncomeFor(pool, nextLevel, typicalFill, position, leagueSize)
  const upgradeCost = perimeterUpgradeCost(pool, club.perimeterLevel)
  const homeMatches = (status?.totalRounds ?? 38) / 2
  const gain = (nextIncome - currentPerimeter) * homeMatches

  return {
    season: gameState.season,
    round,
    totalRounds: status?.totalRounds ?? 38,
    balance: club.bankBalance,
    fanConfidence: gameState.fanConfidence,
    pool,
    valuations: valuationsFor(pool),
    deals: active,
    offers,
    merchandising: {
      perMatchday: merchandisingFor(pool, gameState.fanConfidence, starPowerOf(squad)),
      starPower: starPowerOf(squad),
    },
    stadium: {
      name: club.stadiumName,
      baseName: club.stadiumBaseName,
      namingRightsSold: active.some(deal => deal.slot === 'naming_rights'),
    },
    perimeter: {
      level: club.perimeterLevel,
      tier: perimeterTier(club.perimeterLevel),
      tiers: PERIMETER_TIERS,
      atMax: club.perimeterLevel >= MAX_PERIMETER_LEVEL,
      perHomeMatch: currentPerimeter,
      nextPerHomeMatch: nextIncome,
      upgradeCost,
      canAfford: club.bankBalance >= upgradeCost,
      /** Seasons for the upgrade to earn back what it cost. */
      paybackSeasons: gain > 0 ? Math.round((upgradeCost / gain) * 10) / 10 : null,
    },
  }
})
