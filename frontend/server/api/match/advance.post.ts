import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { matches } from '../../db/schema'
import { simulateSegment } from '../../core/match-engine'
import { buildTeam, insertEvents, syncToMinute } from '../../core/match-session'
import { nextBreakAfter } from '#shared/match-state'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ matchId?: number | string; fromMinute?: number }>(event)
  const matchId = Number(body?.matchId)
  const fromMinute = Number(body?.fromMinute ?? 0)

  if (!matchId) {
    throw createError({ statusCode: 400, statusMessage: 'matchId is required' })
  }

  const match = await db.query.matches.findFirst({ where: eq(matches.id, matchId) })
  if (!match) {
    throw createError({ statusCode: 404, statusMessage: 'Match not found' })
  }

  const gameState = await db.query.game.findFirst()
  if (!gameState) {
    throw createError({ statusCode: 404, statusMessage: 'Game not found' })
  }

  // Rewind to the minute the client actually reached, discarding anything
  // simulated past it — this is what lets a pause change the outcome.
  const state = await syncToMinute(matchId, fromMinute)
  const toMinute = nextBreakAfter(fromMinute)

  const [homeTeam, awayTeam] = await Promise.all([
    buildTeam(match.homeTeamId, state.home.tacticName, gameState.playerTeamId),
    buildTeam(match.awayTeamId, state.away.tacticName, gameState.playerTeamId),
  ])

  const result = simulateSegment(homeTeam, awayTeam, state, toMinute)

  // Deliberately NOT persisting `result.state` here: it reflects the whole
  // segment simulated ahead of the clock, not the minute the manager has
  // actually reached. If it were saved now and the manager later paused and
  // substituted mid-segment, `syncToMinute` would rewind against this
  // premature future anchor instead of the real one — and since there'd be
  // no pending `match_events` past it to replay, the rewind would silently
  // no-op, leaving stale onPitch/bench state for the next segment to fold
  // events on top of (this is what produced a duplicated player on the
  // pitch after a pause + substitution during testing). `matches.state`
  // only moves forward via `syncToMinute`, which derives it from events
  // that actually happened, at whatever minute the client presents.
  await insertEvents(matchId, result.events)

  // Nor is the match finalised here, for exactly the same reason. A segment
  // ending at minute 90 has been simulated, not *watched* — the clock is
  // still ~45 seconds behind it, and a pause anywhere in that stretch
  // rewinds and re-simulates the rest. Committing the score here would null
  // `matches.state` for the whole second half, which made every
  // mid-second-half substitution fail with "Match has not started".
  // `POST /api/match/finish` does it once the clock genuinely arrives.
  return { events: result.events, state: result.state, toMinute }
})
