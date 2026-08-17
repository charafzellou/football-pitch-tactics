/**
 * Season fixture calendar.
 *
 * The pairing logic here is the circle method that was already inline in
 * `seed.ts` — it was correct and is kept as-is. What changed is the dates.
 *
 * Every fixture used to get an independent `faker.date.future()`, so rounds
 * were not chronological and one club could draw two fixtures on the same day.
 * That made "resolve every fixture up to today" undefined, which is the single
 * thing the whole season loop depends on: after the player's match the
 * calendar advances, and everything dated at or before the new date is
 * simulated. Rounds now share a kickoff date and are spaced a week apart, so
 * that window is exactly one matchday.
 */

export interface GeneratedFixture {
  homeTeamId: number
  awayTeamId: number
  season: number
  round: number
  matchDate: Date
}

/** Days between rounds. A 20-club season is 38 rounds ≈ 38 weeks. */
export const DAYS_BETWEEN_ROUNDS = 7

/** Kickoff time of day, so fixture timestamps are stable and comparable. */
const KICKOFF_HOUR = 15

/**
 * The first matchday of a season. Seasons are numbered from 1, and each starts
 * a year after the last so the in-game calendar keeps moving forward.
 */
export function seasonStartDate(season: number, baseYear = 2024): Date {
  return new Date(Date.UTC(baseYear + Math.max(0, season - 1), 7, 10, KICKOFF_HOUR, 0, 0))
}

/** Rounds in a double round-robin. Odd club counts get a bye slot per round. */
export function roundsFor(teamCount: number): number {
  if (teamCount < 2) return 0
  const even = teamCount % 2 === 0 ? teamCount : teamCount + 1
  return (even - 1) * 2
}

/**
 * Builds a full double round-robin: every club plays every other home and away.
 *
 * Uses the circle method — fix the first club, rotate the rest — which
 * guarantees each club appears exactly once per round. The second half repeats
 * the first with venues reversed.
 *
 * An odd number of clubs is padded with a bye, and the club drawn against it
 * simply has no fixture that round.
 */
export function buildSeasonFixtures(
  teamIds: number[],
  season: number,
  startDate: Date = seasonStartDate(season),
): GeneratedFixture[] {
  if (teamIds.length < 2) return []

  // A bye placeholder keeps the rotation symmetric for odd club counts.
  const BYE = -1
  const wheel = teamIds.length % 2 === 0 ? [...teamIds] : [...teamIds, BYE]

  const count = wheel.length
  const half = count / 2
  const rounds = count - 1
  const fixtures: GeneratedFixture[] = []

  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < half; i++) {
      const a = wheel[i]
      const b = wheel[count - 1 - i]
      if (a === undefined || b === undefined || a === BYE || b === BYE)
        continue

      // Alternate which side is at home per round so no club plays a long run
      // of home games in the first half of the season.
      const homeFirstLeg = (round + i) % 2 === 0
      const [firstHome, firstAway] = homeFirstLeg ? [a, b] : [b, a]

      fixtures.push(makeFixture(firstHome, firstAway, season, round + 1, startDate))
      // Reverse leg, same pairing, in the mirrored half of the season.
      fixtures.push(makeFixture(firstAway, firstHome, season, round + 1 + rounds, startDate))
    }

    rotate(wheel)
  }

  return fixtures.sort((left, right) => left.round - right.round)
}

/** Circle method: the first entry is fixed, everything else rotates one step. */
function rotate(wheel: number[]) {
  const last = wheel.pop()
  if (last !== undefined)
    wheel.splice(1, 0, last)
}

function makeFixture(
  homeTeamId: number,
  awayTeamId: number,
  season: number,
  round: number,
  startDate: Date,
): GeneratedFixture {
  return {
    homeTeamId,
    awayTeamId,
    season,
    round,
    matchDate: dateForRound(round, startDate),
  }
}

/** Every fixture in a round shares this timestamp. */
export function dateForRound(round: number, startDate: Date): Date {
  const date = new Date(startDate)
  date.setUTCDate(date.getUTCDate() + (round - 1) * DAYS_BETWEEN_ROUNDS)
  return date
}
