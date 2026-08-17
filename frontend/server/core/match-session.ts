/**
 * Shared plumbing for the three match routes (`start`, `advance`,
 * `changes`). Keeps the "rewind to a minute, then trust only what's
 * persisted" rule in one place so `advance` and `changes` can't drift from
 * each other about what a pause actually does.
 */
import { and, eq, gt } from 'drizzle-orm'
import { db } from '../db'
import { eventType, matchEvents, matches, players, teams } from '../db/schema'
import type { Team } from './match-engine'
import { TACTICS } from './tactics'
import { DEFAULT_TACTIC_NAME } from '#shared/lineup'
import type { MatchEvent, MatchState } from '#shared/match-state'
import { applyEvents, parseMatchState } from '#shared/match-state'

/** Builds the `Team` shape the engine expects for one side of a match. */
export async function buildTeam(teamId: number, tacticName: string | null | undefined, playerTeamId: number, lineupIds?: number[] | null): Promise<Team> {
  const [squad, teamRow] = await Promise.all([
    // Retired and released players stay in the table so `match_events` keeps
    // resolving, but neither can be fielded.
    db.query.players.findMany({
      where: and(eq(players.teamId, teamId), eq(players.retired, 0), eq(players.freeAgent, 0)),
    }),
    db.query.teams.findFirst({ where: eq(teams.id, teamId) }),
  ])

  if (!teamRow) {
    throw createError({ statusCode: 404, statusMessage: `Team ${teamId} not found` })
  }

  const tactic = TACTICS.find(t => t.name === tacticName)
    ?? TACTICS.find(t => t.name === DEFAULT_TACTIC_NAME)
    ?? TACTICS[0]

  if (!tactic) {
    throw createError({ statusCode: 500, statusMessage: 'No tactics available for simulation' })
  }

  return {
    id: teamRow.id,
    name: teamRow.name,
    squad,
    tactic,
    lineupIds,
    autoManaged: teamRow.id !== playerTeamId,
  }
}

/** id → name and name → id maps for the event_type table, creating any unseen names. */
export async function resolveEventTypeIds(names: string[]): Promise<Record<string, number>> {
  const existing = await db.query.eventType.findMany()
  const byName: Record<string, number> = {}
  for (const row of existing)
    byName[row.name] = row.id

  for (const name of new Set(names)) {
    if (byName[name])
      continue

    const inserted = await db.insert(eventType).values({ name }).returning()
    const row = inserted[0]
    if (!row) {
      throw createError({ statusCode: 500, statusMessage: `Failed to persist event type: ${name}` })
    }
    byName[name] = row.id
  }

  return byName
}

export async function eventTypeNamesById(): Promise<Record<number, string>> {
  const rows = await db.query.eventType.findMany()
  const byId: Record<number, string> = {}
  for (const row of rows)
    byId[row.id] = row.name

  return byId
}

/** Persists a batch of events for a match in one round trip. */
export async function insertEvents(matchId: number, events: MatchEvent[]): Promise<void> {
  if (!events.length)
    return

  const typeMap = await resolveEventTypeIds(events.map(e => e.eventType))

  await db.insert(matchEvents).values(events.map(event => ({
    matchId,
    minute: event.minute,
    eventType: typeMap[event.eventType]!,
    playerId: event.playerId ?? null,
    relatedPlayerId: event.relatedPlayerId ?? null,
    teamId: event.teamId,
  })))
}

/**
 * Rewinds/fast-forwards the persisted match state to `minute`: replays
 * whatever's stored in `match_events` since the last persisted snapshot,
 * discards anything beyond `minute` (the manager pausing there means the
 * rest of that segment never "happened"), and re-persists the snapshot.
 *
 * This is what makes a pause at 63' actually change the outcome — the
 * previously-simulated 64–90' is thrown away and replaced once `advance` is
 * called again with an updated team sheet.
 */
export async function syncToMinute(matchId: number, minute: number): Promise<MatchState> {
  const match = await db.query.matches.findFirst({ where: eq(matches.id, matchId) })
  if (!match) {
    throw createError({ statusCode: 404, statusMessage: 'Match not found' })
  }

  const stored = parseMatchState(match.state)
  if (!stored) {
    throw createError({ statusCode: 400, statusMessage: 'Match has not started' })
  }

  const pending = await db.query.matchEvents.findMany({
    where: and(eq(matchEvents.matchId, matchId), gt(matchEvents.minute, stored.minute)),
  })

  const typeNames = await eventTypeNamesById()
  const events: MatchEvent[] = pending.map(row => ({
    minute: row.minute,
    eventType: typeNames[row.eventType] ?? String(row.eventType),
    teamId: row.teamId,
    playerId: row.playerId ?? undefined,
    relatedPlayerId: row.relatedPlayerId ?? undefined,
  }))

  const current = applyEvents(stored, events, minute)

  await db.delete(matchEvents).where(and(eq(matchEvents.matchId, matchId), gt(matchEvents.minute, minute)))
  await db.update(matches).set({ state: JSON.stringify(current) }).where(eq(matches.id, matchId))

  return current
}
