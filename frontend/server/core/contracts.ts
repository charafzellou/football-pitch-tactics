/**
 * Contracts: what a player wants to sign, and whether an offer clears it.
 *
 * Pure functions, like `economy.ts` and `progression.ts`, so the whole
 * negotiation can be reasoned about without a database.
 *
 * ## Why this is deterministic
 *
 * A player's demand is a fixed function of their numbers plus a *stable*
 * per-player character factor derived from their id — never `Math.random()`.
 * The renewal screen shows the demand before the offer is made, so a random
 * demand would mean the screen lies: reject an offer the player was shown as
 * acceptable and the manager has no way to tell a hard bargain from a bug.
 * Rolling the dice per call would also let anyone reroll a refusal by closing
 * and reopening the dialog.
 */
import { wageExpectation } from './economy'

export const MIN_CONTRACT_SEASONS = 1
export const MAX_CONTRACT_SEASONS = 5

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Stable 0–1 value from an id. Same player, same answer, every time. */
function seededUnit(id: number): number {
  const x = Math.sin(id * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

export interface ContractContext {
  playerId: number
  marketValue: number
  age: number
  skillLevel: number
  /** Standing of the club making the offer. */
  clubReputation: number
  /** That club's current league position, 1-based. */
  position: number
  leagueSize: number
}

export interface ContractOffer {
  wage: number
  seasons: number
}

/**
 * The longest deal a player of this age will commit to.
 *
 * A 36-year-old signing for five years is the kind of thing a game should not
 * let you do by accident — they intend to retire inside that window, and
 * `shouldRetire()` will duly retire them while you keep paying.
 */
export function maxSeasonsFor(age: number): number {
  if (age >= 35) return 1
  if (age >= 33) return 2
  if (age >= 30) return 3
  return MAX_CONTRACT_SEASONS
}

/**
 * Wage per matchday the player wants for a one-season extension.
 *
 * Built on `wageExpectation()` — which already prices the player and the size
 * of the club — then bent by where that club currently sits in the table. A
 * side pushing for the title gets a discount; one scrapping at the bottom pays
 * for the trouble.
 */
export function contractDemand(context: ContractContext): number {
  const base = wageExpectation(context.marketValue, context.age, context.clubReputation)

  // 1 at the top of the table, 0 at the foot of it.
  const standing = 1 - (context.position - 1) / Math.max(1, context.leagueSize - 1)
  const standingFactor = 1.14 - standing * 0.22

  // Some agents are simply harder work than others, consistently.
  const character = 0.94 + seededUnit(context.playerId) * 0.18

  return Math.max(1_000, Math.round(base * standingFactor * character))
}

/**
 * Security is worth something: each extra season shaves a little off the wage
 * the player will settle for.
 *
 * This is the whole trade-off of the renewal screen. Pay more for a short deal
 * and keep your options, or commit long and pay less — knowing a long contract
 * also makes them dearer to prise away from you (see `negotiation.ts`) and
 * leaves you carrying the wage if they decline.
 */
export function lengthDiscount(seasons: number): number {
  const extra = clamp(seasons, MIN_CONTRACT_SEASONS, MAX_CONTRACT_SEASONS) - 1
  return 1 - extra * 0.03
}

/** Wage the player will accept for a deal of exactly this length. */
export function requiredWage(context: ContractContext, seasons: number): number {
  return Math.max(1_000, Math.round(contractDemand(context) * lengthDiscount(seasons)))
}

export interface OfferOutcome {
  accepted: boolean
  /** What they wanted for the length offered. */
  required: number
  /** Longest deal they will sign at their age. */
  maxSeasons: number
  /** Plain-language explanation, always populated. */
  reason: string
}

export function evaluateOffer(context: ContractContext, offer: ContractOffer): OfferOutcome {
  const maxSeasons = maxSeasonsFor(context.age)
  const seasons = Math.round(offer.seasons)

  if (seasons < MIN_CONTRACT_SEASONS || seasons > MAX_CONTRACT_SEASONS) {
    return {
      accepted: false,
      required: requiredWage(context, MIN_CONTRACT_SEASONS),
      maxSeasons,
      reason: `A contract must run between ${MIN_CONTRACT_SEASONS} and ${MAX_CONTRACT_SEASONS} seasons.`,
    }
  }

  if (seasons > maxSeasons) {
    return {
      accepted: false,
      required: requiredWage(context, maxSeasons),
      maxSeasons,
      reason: `At ${context.age} he will not commit beyond ${maxSeasons} season${maxSeasons === 1 ? '' : 's'}.`,
    }
  }

  const required = requiredWage(context, seasons)

  if (offer.wage < required) {
    return {
      accepted: false,
      required,
      maxSeasons,
      reason: `He wants at least €${required.toLocaleString('en-IE')} per matchday over ${seasons} season${seasons === 1 ? '' : 's'}.`,
    }
  }

  return {
    accepted: true,
    required,
    maxSeasons,
    reason: `Happy to sign for ${seasons} more season${seasons === 1 ? '' : 's'}.`,
  }
}

// ---------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------

/** True when this contract runs out at the end of the season in progress. */
export function isExpiring(contractUntilSeason: number, currentSeason: number): boolean {
  return contractUntilSeason <= currentSeason
}

// ---------------------------------------------------------------------------
// AI clubs
// ---------------------------------------------------------------------------

export interface AiRenewalInput {
  age: number
  skillLevel: number
  /** Median skill of the club's squad — the bar a fringe player falls below. */
  squadMedianSkill: number
  /** Squad size after retirements, before this decision. */
  squadSize: number
  targetSquadSize: number
}

/**
 * Whether a CPU club keeps an out-of-contract player.
 *
 * Deliberately keeps most of the squad. A league where every club released
 * half its players each summer would churn beyond recognition in three
 * seasons, and the free-agent pool would swamp the transfer market.
 */
export function aiRenews(input: AiRenewalInput): boolean {
  // Too thin to let anyone go.
  if (input.squadSize <= input.targetSquadSize - 2)
    return true

  // A fading veteran below the standard of the squad is the obvious release.
  if (input.age >= 33 && input.skillLevel < input.squadMedianSkill)
    return false

  // Fringe players are let go sometimes, key players essentially never.
  const isFringe = input.skillLevel < input.squadMedianSkill - 3
  return Math.random() > (isFringe ? 0.35 : 0.05)
}

/**
 * Length a CPU club offers. Short for veterans, long for anyone with a future,
 * so AI squads don't all fall out of contract in the same summer.
 */
export function aiContractLength(age: number): number {
  const max = maxSeasonsFor(age)
  const wanted = age <= 23 ? 4 : age <= 28 ? 3 : 2

  return Math.min(max, wanted)
}

/**
 * Cash bar for a CPU club taking on a free agent — roughly a season and a half
 * of that wage in the bank. Keeps good free agents flowing to clubs that can
 * actually carry them rather than to whoever happens to be short of bodies.
 */
export function canCarryWage(bankBalance: number, wage: number): boolean {
  return bankBalance > wage * 60
}
