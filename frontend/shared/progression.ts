/**
 * Player development helpers needed on *both* sides of the wire.
 *
 * The full progression model (development curves, retirement odds, youth
 * generation, valuation) is server-only and lives in
 * `server/core/progression.ts`. Only the parts the UI also needs belong here,
 * so the squad list can label a player's trajectory without importing server
 * code into the client bundle — and so the badge can never contradict what the
 * rollover actually does.
 */

export type DevelopmentTrend = 'rising' | 'peak' | 'declining'

/** The age at which decline begins. Mirrors the bands in `developSkill`. */
export const DECLINE_AGE = 30

/** The last age at which a player can still be growing toward their ceiling. */
export const GROWTH_AGE_LIMIT = 27

/**
 * Which way a player is trending.
 *
 * Deliberately derived from the same thresholds `developSkill` uses, so the
 * ▲/▬/▼ shown in the squad list matches what the next rollover will do.
 */
export function developmentTrend(age: number, skillLevel: number, potential: number): DevelopmentTrend {
  if (age >= DECLINE_AGE) return 'declining'
  if (age <= GROWTH_AGE_LIMIT && potential > skillLevel) return 'rising'
  return 'peak'
}
