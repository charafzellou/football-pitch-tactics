import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { teams } from '../../db/schema'
import {
  MAX_FACILITY_LEVEL,
  commercialPoolFor,
  facilityUpgradeCost,
  facilityUpkeepFor,
} from '../../core/economy'
import {
  academyGrade,
  academyIntakeBonus,
  injuryRecoveryChance,
  trainingDecayFactor,
  trainingDevelopmentFactor,
  trainingRecoveryBonus,
} from '../../core/progression'
import { facilityTier } from '#shared/finance'
import { leagueStandingFor } from '../../core/finance'
import { requireSave } from '../../core/save'
import { getSeasonStatus } from '../../core/season'

/**
 * The Director of Football's two long bets.
 *
 * Everything here is reported as *what it does*, not as a level number, because
 * the whole difficulty of this decision is that neither facility pays anything
 * back this season. A page that showed only "Academy: 2" would be asking the
 * manager to spend eight figures on a noun.
 */
export default defineEventHandler(async (event) => {
  const gameState = await requireSave(event)

  const club = await db.query.teams.findFirst({ where: eq(teams.id, gameState.playerTeamId) })
  if (!club)
    return null

  const status = await getSeasonStatus(gameState)
  const standing = await leagueStandingFor(club.id, gameState.season, status?.round ?? 0)
  const pool = commercialPoolFor(
    club.reputation,
    standing?.position ?? 10,
    standing?.leagueSize ?? 20,
  )

  const totalRounds = status?.totalRounds ?? 38
  const balance = club.bankBalance

  /** One facility, described by what the next level would change. */
  function describe(level: number, kind: 'academy' | 'training') {
    const atMax = level >= MAX_FACILITY_LEVEL
    const cost = atMax ? 0 : facilityUpgradeCost(pool, level)
    const next = Math.min(MAX_FACILITY_LEVEL, level + 1)

    const effects = kind === 'academy'
      ? {
          current: academyEffect(level),
          next: atMax ? null : academyEffect(next),
        }
      : {
          current: trainingEffect(level),
          next: atMax ? null : trainingEffect(next),
        }

    return {
      level,
      tier: facilityTier(level),
      nextTier: atMax ? null : facilityTier(next),
      atMax,
      cost,
      canAfford: !atMax && balance >= cost,
      /** Upkeep this facility alone adds, per matchday. */
      upkeepPerRound: facilityUpkeepFor(pool, kind === 'academy' ? level : 0, kind === 'training' ? level : 0),
      upkeepAfterUpgrade: atMax
        ? null
        : facilityUpkeepFor(pool, kind === 'academy' ? next : 0, kind === 'training' ? next : 0),
      ...effects,
    }
  }

  function academyEffect(level: number) {
    const grade = academyGrade(level)
    return {
      skillBonus: grade.skill,
      potentialBonus: grade.potential,
      bonusGraduates: academyIntakeBonus(level),
    }
  }

  function trainingEffect(level: number) {
    return {
      developmentPercent: Math.round((trainingDevelopmentFactor(level) - 1) * 100),
      declinePercent: Math.round((1 - trainingDecayFactor(level)) * 100),
      staminaPerMatch: trainingRecoveryBonus(level),
      injuryRecoveryPercent: Math.round(injuryRecoveryChance(level) * 100),
    }
  }

  const upkeepPerRound = facilityUpkeepFor(pool, club.academyLevel, club.trainingLevel)

  return {
    balance,
    season: gameState.season,
    maxLevel: MAX_FACILITY_LEVEL,
    upkeepPerRound,
    upkeepPerSeason: upkeepPerRound * totalRounds,
    academy: describe(club.academyLevel, 'academy'),
    training: describe(club.trainingLevel, 'training'),
    health: { stage: gameState.insolvencyStage },
  }
})
