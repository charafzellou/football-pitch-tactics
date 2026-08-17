/**
 * Result helpers shared by the Dashboard's form guide, the Schedule page and
 * the Standings table.
 */

export type FormResult = 'W' | 'D' | 'L'

interface PlayedFixture {
  homeTeamId: number
  awayTeamId: number
  homeScore: number | null
  awayScore: number | null
  played?: number
  matchDate: string
}

/** W/D/L from `teamId`'s perspective, or null if the match has no score yet. */
export function resultFor(fixture: PlayedFixture, teamId: number): FormResult | null {
  if (fixture.homeScore === null || fixture.awayScore === null) return null

  const isHome = fixture.homeTeamId === teamId
  const own = isHome ? fixture.homeScore : fixture.awayScore
  const other = isHome ? fixture.awayScore : fixture.homeScore

  if (own > other) return 'W'
  if (own < other) return 'L'
  return 'D'
}

/** The team's most recent results, oldest first, capped at `limit`. */
export function recentForm(fixtures: PlayedFixture[], teamId: number, limit = 5): FormResult[] {
  return fixtures
    .filter(fixture =>
      (fixture.homeTeamId === teamId || fixture.awayTeamId === teamId)
      && fixture.homeScore !== null,
    )
    .sort((a, b) => new Date(a.matchDate).getTime() - new Date(b.matchDate).getTime())
    .slice(-limit)
    .map(fixture => resultFor(fixture, teamId))
    .filter((result): result is FormResult => result !== null)
}

export const RESULT_COLOR: Record<FormResult, string> = {
  W: 'var(--app-accent)',
  D: 'var(--app-text-muted)',
  L: 'var(--app-player-sent-off)',
}

export const RESULT_LABEL: Record<FormResult, string> = {
  W: 'Win',
  D: 'Draw',
  L: 'Loss',
}
