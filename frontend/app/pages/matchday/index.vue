<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { UButton, UCard, UBadge } from '#components'
import { useToast } from '#imports'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import type { LineupSlot } from '#shared/lineup'
import { normalizePosition, sortByLineupOrder } from '#shared/lineup'
import type { MatchEvent, MatchState } from '#shared/match-state'
import { HALF_TIME_MINUTE, MATCH_MINUTES, applyEvents } from '#shared/match-state'

interface PlaybackEntry {
  id: string
  minute: number
  type: string
  teamName: string
  playerName: string | null
}

interface SquadPlayer {
  id: number
  name: string
  position: string
  skillLevel: number
}

interface TeamPayload {
  id: number
  name: string
  squad: SquadPlayer[]
  startingXi: number[]
  bench: number[]
  lineupAutoSelected: boolean
}

/** A player as rendered in a lineup panel. */
interface LineupRow {
  id: number
  name: string
  slot: string
  color: 'sky' | 'emerald' | 'amber' | 'rose' | 'neutral'
  statusClass: string
  stamina: number
}

const { data: schedule, refresh: refreshSchedule } = useFetch('/api/schedule')
const nextMatch = computed(() => schedule.value?.[0] ?? null)
const { data: tacticsList } = useFetch('/api/tactics')

const matchId = ref<number | null>(null)
const currentMinute = ref(0)
const playing = ref(false)
const hasStarted = ref(false)
const loadingMatch = ref(false)
const isFinished = ref(false)
const isHalfTime = ref(false)
/** Set when committing the final result failed, so the player can retry rather than being stuck at 90'. */
const finishFailed = ref(false)
/** Set when one of the player's own players goes off injured and needs a decision. */
const injuredPlayerId = ref<number | null>(null)
const eventFeed = ref<PlaybackEntry[]>([])

/** State at the start of the currently-loaded segment, plus every event revealed since. */
const anchorState = ref<MatchState | null>(null)
const allEvents = ref<MatchEvent[]>([])
/** The last minute `allEvents` actually has simulated data for. */
const segmentFetchedThrough = ref(0)
const playbackIndex = ref(0)

const homeTeam = ref<TeamPayload | null>(null)
const awayTeam = ref<TeamPayload | null>(null)

const router = useRouter()
const toast = useToast()

/**
 * Every match request is a fire-and-forget from a click or a clock tick, so
 * an unhandled rejection just freezes the page with the spinner up — which
 * is exactly how the "Resume does nothing" bug presented. Always surface it.
 */
function reportMatchError(error: unknown, title: string) {
  const detail = error as { statusMessage?: string; data?: { statusMessage?: string; message?: string } }
  toast.add({
    color: 'error',
    icon: 'i-lucide-octagon-x',
    title,
    description: detail?.data?.statusMessage ?? detail?.statusMessage ?? detail?.data?.message ?? 'Please try again.',
  })
}

async function loadTeams() {
  if (!nextMatch.value) return
  const home = await $fetch<TeamPayload>(`/api/team/${nextMatch.value.homeTeamId}`)
  const away = await $fetch<TeamPayload>(`/api/team/${nextMatch.value.awayTeamId}`)
  homeTeam.value = home
  awayTeam.value = away
}

onMounted(async () => {
  await refreshSchedule()
  await loadTeams()
})

onBeforeRouteLeave(() => {
  if (hasStarted.value && !isFinished.value)
    return false
})

let intervalHandle: any = null

onBeforeUnmount(() => {
  if (intervalHandle) clearInterval(intervalHandle)
})

function mapEvent(e: any): MatchEvent {
  return { minute: e.minute, eventType: e.eventType, teamId: e.teamId, playerId: e.playerId ?? undefined, relatedPlayerId: e.relatedPlayerId ?? undefined }
}

/** The live match state as of `currentMinute`, derived from the anchor plus every event revealed so far. */
const liveState = computed(() => {
  if (!anchorState.value) return null
  return applyEvents(anchorState.value, allEvents.value, currentMinute.value)
})

const homeScore = computed(() => liveState.value?.home.score ?? 0)
const awayScore = computed(() => liveState.value?.away.score ?? 0)

async function startPlayback() {
  if (!nextMatch.value || hasStarted.value || loadingMatch.value) return
  if (!homeTeam.value || !awayTeam.value)
    await loadTeams()

  loadingMatch.value = true

  let result: any
  try {
    result = await $fetch<any>('/api/match/start', {
      method: 'POST',
      body: { matchId: nextMatch.value.id },
    })
  }
  catch (error) {
    loadingMatch.value = false
    reportMatchError(error, 'Could not start the match')
    return
  }

  if ('message' in result) {
    loadingMatch.value = false
    return
  }

  matchId.value = result.matchId
  hasStarted.value = true

  if (result.resumed) {
    anchorState.value = result.state
    allEvents.value = (result.events ?? []).map(mapEvent)

    // `result.state.minute` only reflects the last minute a pause was
    // explicitly synced to — it can lag behind a segment that was already
    // fully simulated (and whose events are already sitting in the DB) but
    // never paused mid-way. Resume at the furthest minute we actually have
    // events for, not at the possibly-stale anchor.
    const maxEventMinute = allEvents.value.reduce((max, e) => Math.max(max, e.minute), result.state.minute)
    currentMinute.value = maxEventMinute
    playbackIndex.value = allEvents.value.length
    segmentFetchedThrough.value = maxEventMinute
    eventFeed.value = buildFeed(allEvents.value)
    isHalfTime.value = maxEventMinute === HALF_TIME_MINUTE
    loadingMatch.value = false
    playing.value = false

    // A refresh at 90' lands here on a match whose result was never
    // committed (nothing is committed until the clock arrives). Finish it
    // now rather than offering "End Match" on an unsaved result.
    if (maxEventMinute >= MATCH_MINUTES)
      await finishMatch()

    return
  }

  anchorState.value = result.state
  allEvents.value = []
  currentMinute.value = 0
  playbackIndex.value = 0
  eventFeed.value = []

  await fetchNextSegment()
}

/** Simulates from the current minute through to the next break, appending the new events. */
async function fetchNextSegment() {
  if (!matchId.value) return
  loadingMatch.value = true

  try {
    const result = await $fetch<any>('/api/match/advance', {
      method: 'POST',
      body: { matchId: matchId.value, fromMinute: currentMinute.value },
    })

    allEvents.value = [...allEvents.value, ...(result.events ?? []).map(mapEvent)]
    segmentFetchedThrough.value = currentMinute.value < HALF_TIME_MINUTE ? HALF_TIME_MINUTE : MATCH_MINUTES
  }
  catch (error) {
    reportMatchError(error, 'Could not simulate the next passage of play')
    return
  }
  finally {
    loadingMatch.value = false
  }

  // The segment is only simulated, not watched — the clock still ticks
  // through it a minute a second, and the match isn't official until it
  // arrives (see `finishMatch`).
  playing.value = true
  startInterval()
}

function startInterval() {
  if (intervalHandle) clearInterval(intervalHandle)
  intervalHandle = setInterval(tickOnce, 1000)
}

function tickOnce() {
  if (currentMinute.value >= segmentFetchedThrough.value) {
    if (intervalHandle) clearInterval(intervalHandle)
    intervalHandle = null
    playing.value = false

    if (currentMinute.value >= MATCH_MINUTES)
      void finishMatch()
    else if (currentMinute.value === HALF_TIME_MINUTE)
      isHalfTime.value = true

    return
  }

  currentMinute.value++
  const injured = revealUpTo(currentMinute.value)

  // An injury to the player's own team stops the clock and asks for a
  // replacement. The engine has already taken the player off, so doing
  // nothing simply means playing on a man down.
  if (injured !== null && !isHalfTime.value) {
    injuredPlayerId.value = injured
    stopPlayback()
  }
}

/** Reveals events up to `minute`, returning the player's own injured player id if one appeared. */
function revealUpTo(minute: number): number | null {
  let ownInjury: number | null = null

  while (playbackIndex.value < allEvents.value.length) {
    const e = allEvents.value[playbackIndex.value]
    if (!e || !homeTeam.value || !awayTeam.value || e.minute > minute)
      break

    playbackIndex.value++
    eventFeed.value.unshift(feedEntry(e, playbackIndex.value))

    if (e.eventType === 'injury' && e.playerId && playerSide.value && e.teamId === ownTeam.value?.id)
      ownInjury = e.playerId
  }

  return ownInjury
}

function feedEntry(e: MatchEvent, index: number): PlaybackEntry {
  const team = e.teamId === homeTeam.value?.id ? homeTeam.value : awayTeam.value
  const player = team?.squad.find(p => p.id === e.playerId)
  return {
    id: `${e.minute}-${e.eventType}-${index}`,
    minute: e.minute,
    type: e.eventType,
    teamName: team?.name ?? '—',
    playerName: player?.name ?? null,
  }
}

function buildFeed(events: MatchEvent[]): PlaybackEntry[] {
  return events.map((e, i) => feedEntry(e, i + 1)).reverse()
}

function stopPlayback() {
  if (!hasStarted.value || isFinished.value) return
  playing.value = false
  if (intervalHandle) clearInterval(intervalHandle)
  intervalHandle = null
}

/**
 * Full time. The server has simulated these minutes but deliberately hasn't
 * committed anything — right up until the clock arrived, a pause could still
 * rewind and re-simulate the rest. This is the call that makes it official:
 * score, stamina, injuries, calendar.
 */
async function finishMatch() {
  if (isFinished.value || !matchId.value) return

  loadingMatch.value = true
  try {
    await $fetch('/api/match/finish', { method: 'POST', body: { matchId: matchId.value } })
    finishFailed.value = false
    isFinished.value = true
  }
  catch (error) {
    // Leave `isFinished` false so the result isn't silently lost — the
    // player gets a Retry button rather than a dead 90th minute.
    finishFailed.value = true
    reportMatchError(error, 'Could not save the final result')
  }
  finally {
    loadingMatch.value = false
  }
}

/** Resumes after a plain pause, or fetches the next segment first if one is needed. */
async function resumePlayback() {
  if (playing.value || !hasStarted.value || isFinished.value || loadingMatch.value) return

  if (currentMinute.value >= segmentFetchedThrough.value) {
    await fetchNextSegment()
    return
  }

  playing.value = true
  startInterval()
}

/** Called from the tactics panel: apply staged changes, then always fetch the next segment. */
async function applyChangesAndContinue(payload: { substitutions: { playerOutId: number; playerInId: number }[]; tactic: string }) {
  if (!matchId.value) return
  loadingMatch.value = true

  if (payload.substitutions.length || payload.tactic !== ownTactic.value) {
    try {
      const result = await $fetch<any>('/api/match/changes', {
        method: 'POST',
        body: { matchId: matchId.value, atMinute: currentMinute.value, substitutions: payload.substitutions, tactic: payload.tactic },
      })

      anchorState.value = result.state
      // The server discarded anything simulated past this minute — match that here.
      allEvents.value = [...allEvents.value.filter(e => e.minute <= currentMinute.value), ...(result.events ?? []).map(mapEvent)]
      playbackIndex.value = allEvents.value.length
      eventFeed.value = buildFeed(allEvents.value)
      segmentFetchedThrough.value = currentMinute.value
    }
    catch (error) {
      // Leave the clock stopped and the panel up so the manager can decide
      // again rather than being resumed into a match that ignored them. The
      // staged list doesn't survive the re-render, so say so plainly.
      loadingMatch.value = false
      reportMatchError(error, 'Your changes were not applied — please set them again')
      return
    }
  }

  isHalfTime.value = false
  injuredPlayerId.value = null
  loadingMatch.value = false
  await fetchNextSegment()
}

/**
 * "Continue without changes" / "Play on with ten". Nothing needs
 * re-simulating: the engine already played the rest of this segment with
 * the injured player off, so the buffered events are already consistent
 * with carrying on short-handed.
 */
function skipChanges() {
  isHalfTime.value = false
  injuredPlayerId.value = null
  resumePlayback()
}

function endMatch() {
  router.push('/game')
}

const positionColors: Record<LineupSlot, 'sky' | 'emerald' | 'amber' | 'rose'> = {
  GK: 'sky', DF: 'emerald', MF: 'amber', FW: 'rose',
}

/** The seed data mixes 'yellow'/'yellow_card' spellings — collapse them here. */
function normalizeEventType(type: string): string {
  const value = String(type ?? '').toLowerCase().trim()

  if (value === 'yellow_card') return 'yellow'
  if (value === 'red_card') return 'red'
  if (value === 'sub' || value === 'sub_off') return 'substitution'

  return value
}

function eventLabel(type: string): string {
  switch (normalizeEventType(type)) {
    case 'yellow': return 'yellow card'
    case 'red': return 'red card'
    default: return normalizeEventType(type).replace(/_/g, ' ')
  }
}

function eventIcon(type: string): string {
  switch (normalizeEventType(type)) {
    case 'goal': return 'i-lucide-circle-dot'
    case 'yellow': return 'i-lucide-square'
    case 'red': return 'i-lucide-square'
    case 'substitution': return 'i-lucide-arrow-left-right'
    case 'foul': return 'i-lucide-flag'
    case 'injury': return 'i-lucide-heart-crack'
    case 'shot': return 'i-lucide-crosshair'
    case 'shot_on_target': return 'i-lucide-target'
    case 'corner': return 'i-lucide-flag-triangle-right'
    case 'cross': return 'i-lucide-move-right'
    case 'offside': return 'i-lucide-ban'
    default: return 'i-lucide-zap'
  }
}

function eventIconClass(type: string): string {
  switch (normalizeEventType(type)) {
    case 'goal': return 'text-emerald-400'
    case 'yellow': return 'text-amber-400'
    case 'red': return 'text-red-500'
    case 'substitution': return 'text-sky-400'
    case 'foul': return 'text-orange-400'
    case 'injury': return 'text-rose-400'
    case 'shot_on_target': return 'text-sky-400'
    case 'corner': return 'text-teal-400'
    case 'offside': return 'text-orange-300'
    default: return 'text-white/50'
  }
}

/**
 * Feed filters. A realistic match produces ~63 events, dominated by crosses and
 * fouls, so the feed can be narrowed to the categories worth watching.
 */
const EVENT_FILTERS = [
  { id: 'all', label: 'All', types: null as string[] | null },
  { id: 'goals', label: 'Goals', types: ['goal'] },
  { id: 'shots', label: 'Shots', types: ['goal', 'shot_on_target', 'shot'] },
  { id: 'cards', label: 'Cards', types: ['yellow', 'red'] },
  { id: 'subs', label: 'Subs', types: ['substitution'] },
  { id: 'fouls', label: 'Fouls', types: ['foul', 'offside', 'injury'] },
]

const eventFilter = ref('all')

const filteredEventFeed = computed(() => {
  const active = EVENT_FILTERS.find(filter => filter.id === eventFilter.value)
  if (!active?.types)
    return eventFeed.value

  return eventFeed.value.filter(entry => active.types!.includes(normalizeEventType(entry.type)))
})

function statusClassFor(playerId: number, side: 'home' | 'away'): string {
  const state = liveState.value
  if (!state) return 'app-player-out'

  const sideState = state[side]
  if (sideState.sentOff.includes(playerId))
    return 'app-player-sent-off'
  if (sideState.booked.includes(playerId))
    return 'app-player-booked'
  if (!sideState.onPitch.includes(playerId))
    return 'app-player-out'

  return 'app-player-on-pitch'
}

function toRow(player: SquadPlayer, side: 'home' | 'away'): LineupRow {
  const slot = normalizePosition(player.position)
  const stamina = liveState.value?.[side].stamina[player.id] ?? 100

  return {
    id: player.id,
    name: player.name,
    slot: slot ?? '—',
    color: slot ? positionColors[slot] : 'neutral',
    statusClass: statusClassFor(player.id, side),
    stamina: Math.round(stamina),
  }
}

/** Renders whoever the live state says is on the pitch/bench for a side, not the pre-match XI. */
function buildLineup(team: TeamPayload | null, side: 'home' | 'away') {
  if (!team) return { starters: [] as LineupRow[], bench: [] as LineupRow[] }

  const state = liveState.value?.[side]
  const onPitchIds = state?.onPitch ?? team.startingXi
  const benchIds = state ? team.squad.map(p => p.id).filter(id => !onPitchIds.includes(id)) : team.bench

  const squadById = new Map(team.squad.map(player => [player.id, player]))
  const starters = onPitchIds.map(id => squadById.get(id)).filter((p): p is SquadPlayer => Boolean(p))
  const bench = sortByLineupOrder(benchIds.map(id => squadById.get(id)).filter((p): p is SquadPlayer => Boolean(p)))

  return {
    starters: sortByLineupOrder(starters).map(player => toRow(player, side)),
    bench: bench.map(player => toRow(player, side)),
  }
}

const homeLineup = computed(() => buildLineup(homeTeam.value, 'home'))
const awayLineup = computed(() => buildLineup(awayTeam.value, 'away'))

/** Which side, if either, the player actually manages — the tactics panel only applies to them. */
const { data: gameState } = useFetch('/api/game/state')
const playerSide = computed<'home' | 'away' | null>(() => {
  if (!gameState.value || !homeTeam.value || !awayTeam.value) return null
  if (homeTeam.value.id === gameState.value.playerTeamId) return 'home'
  if (awayTeam.value.id === gameState.value.playerTeamId) return 'away'
  return null
})

const ownTeam = computed(() => (playerSide.value === 'home' ? homeTeam.value : playerSide.value === 'away' ? awayTeam.value : null))
const ownState = computed(() => (playerSide.value ? liveState.value?.[playerSide.value] ?? null : null))
const ownTactic = computed(() => ownState.value?.tacticName ?? '')
const showTacticsPanel = computed(() => hasStarted.value && !isFinished.value && !!ownTeam.value && !!ownState.value && (isHalfTime.value || (!playing.value && !loadingMatch.value)))
/** Half time wins if an injury lands on the same minute — the break covers it anyway. */
const injuredPlayerName = computed(() => {
  if (isHalfTime.value || injuredPlayerId.value === null) return null
  return ownTeam.value?.squad.find(p => p.id === injuredPlayerId.value)?.name ?? null
})
</script>

<template>
  <div class="space-y-4 sm:space-y-6">
    <h1 class="app-page-title flex items-center gap-2">
      <UIcon name="i-lucide-flag" class="size-6 text-emerald-400" />
      Matchday
    </h1>

    <!-- Clock + score card -->
    <UCard class="overflow-hidden"
      style="background: linear-gradient(135deg, rgba(13,96,72,0.3), var(--app-surface) 60%); border-color: var(--app-surface-border)">
      <template #header>
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-timer" class="size-4 text-emerald-400" />
            <span>Virtual Clock</span>
          </div>
          <span v-if="hasStarted && !isFinished && !isHalfTime && !injuredPlayerName"
            class="flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-widest text-red-400"
            style="background-color: rgba(239,68,68,0.15)">
            <span class="size-2 rounded-full bg-red-400 animate-live-ping" />
            LIVE
          </span>
          <UBadge v-if="isHalfTime" color="warning" variant="soft" label="Half time" size="sm" />
          <UBadge v-else-if="injuredPlayerName" color="error" variant="soft" icon="i-lucide-bandage"
            :label="`${injuredPlayerName} injured`" size="sm" />
          <UBadge v-if="isFinished" color="success" variant="soft" label="Full time" size="sm" />
        </div>
      </template>

      <div class="flex flex-col items-center gap-4 py-2 md:flex-row md:justify-between">
        <div class="text-center md:text-left">
          <p class="app-kicker mb-1">Minute</p>
          <p class="text-3xl font-black tabular-nums" style="color: var(--app-text)">{{ currentMinute }}<span
              class="text-lg font-semibold" style="color: var(--app-text-muted)">'</span></p>
        </div>

        <div class="text-center">
          <p class="app-muted-text mb-1 text-sm">
            {{ homeTeam?.name ?? 'Home' }} <span style="color: var(--app-text-muted)">vs</span> {{ awayTeam?.name ??
            'Away' }}
          </p>
          <p class="app-gradient-text text-4xl font-black tracking-tight sm:text-5xl">
            {{ homeScore }} – {{ awayScore }}
          </p>
        </div>

        <div class="flex flex-wrap justify-center gap-2 md:justify-end">
          <UButton v-if="!hasStarted && !isFinished" :loading="loadingMatch" label="Start Match" icon="i-lucide-play"
            @click="startPlayback" />
          <UButton v-if="hasStarted && playing && !isFinished" label="Pause" icon="i-lucide-pause" color="neutral"
            variant="soft" @click="stopPlayback" />
          <UButton v-if="hasStarted && !playing && !isFinished && !isHalfTime && !injuredPlayerName" :loading="loadingMatch" label="Resume" icon="i-lucide-play"
            @click="resumePlayback" />
          <UButton v-if="finishFailed && !isFinished" label="Retry saving result" icon="i-lucide-refresh-cw"
            color="warning" :loading="loadingMatch" @click="finishMatch" />
          <UButton v-if="isFinished" label="End Match" icon="i-lucide-flag" color="success" @click="endMatch" />
        </div>
      </div>
    </UCard>

    <!--
          Mobile: two columns — lineups on the top row, events spanning the bottom.
          lg and up: a single row of three columns.
        -->
    <div class="grid grid-cols-2 gap-4 lg:grid-cols-3">
      <UCard class="app-surface order-1 h-full lg:order-0">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-shield" class="size-4 shrink-0 text-emerald-400" />
            <span class="truncate">Home Lineup</span>
            <UBadge v-if="homeTeam?.lineupAutoSelected" color="neutral" variant="soft" size="xs" label="Auto" />
          </div>
        </template>
        <ul class="max-h-96 space-y-1.5 overflow-y-auto pr-1">
          <li v-for="p in homeLineup.starters" :key="p.id" class="space-y-1">
            <div class="flex items-center gap-2">
              <UBadge :color="p.color" variant="soft" size="xs" :label="p.slot" class="shrink-0" />
              <span class="min-w-0 truncate text-xs sm:text-sm" :class="p.statusClass">{{ p.name }}</span>
            </div>
            <div class="app-stat-bar-track">
              <div class="app-stat-bar-fill" :style="{ width: `${p.stamina}%` }" />
            </div>
          </li>
          <li v-if="!homeLineup.starters.length" class="app-muted-text text-sm">No lineup available.</li>

          <template v-if="homeLineup.bench.length">
            <li class="app-kicker pt-3 text-[10px]">Bench</li>
            <li v-for="p in homeLineup.bench" :key="p.id" class="flex items-center gap-2">
              <UBadge :color="p.color" variant="soft" size="xs" :label="p.slot" class="shrink-0 opacity-60" />
              <span class="min-w-0 truncate text-xs sm:text-sm" :class="p.statusClass">{{ p.name }}</span>
            </li>
          </template>
        </ul>
      </UCard>

      <UCard class="app-surface order-3 col-span-2 h-full lg:order-0 lg:col-span-1">
        <template #header>
          <div class="space-y-2.5">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-activity" class="size-4 shrink-0 text-emerald-400" />
              <span class="truncate">Match Events</span>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <button v-for="filter in EVENT_FILTERS" :key="filter.id" type="button"
                class="p-2 app-filter-chip text-xs font-semibold uppercase tracking-widest transition-colors hover:bg-white/10"
                :class="{ 'app-filter-chip--active': eventFilter === filter.id }" @click="eventFilter = filter.id">
                {{ filter.label }}
              </button>
            </div>
          </div>
        </template>
        <ul class="max-h-96 space-y-2 overflow-y-auto pr-1">
          <li v-for="e in filteredEventFeed" :key="e.id" class="flex items-center gap-2 text-sm animate-slide-in-left">
            <UIcon :name="eventIcon(e.type)" class="size-4 shrink-0" :class="eventIconClass(e.type)" />
            <span class="w-7 shrink-0 font-bold tabular-nums" style="color: var(--app-text)">{{ e.minute }}'</span>
            <span class="truncate" style="color: var(--app-text-muted)">{{ e.teamName }}</span>
            <span class="shrink-0 font-medium capitalize" style="color: var(--app-text-soft)">{{ eventLabel(e.type)
              }}</span>
            <span v-if="e.playerName" class="truncate text-xs" style="color: var(--app-text-muted)">– {{ e.playerName
              }}</span>
          </li>
          <li v-if="!filteredEventFeed.length" class="app-muted-text text-sm">
            {{ eventFeed.length ? 'No events of this type yet.' : 'No events yet.' }}
          </li>
        </ul>
      </UCard>

      <UCard class="app-surface order-2 h-full lg:order-0">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-shield" class="size-4 shrink-0 text-sky-400" />
            <span class="truncate">Away Lineup</span>
            <UBadge v-if="awayTeam?.lineupAutoSelected" color="neutral" variant="soft" size="xs" label="Auto" />
          </div>
        </template>
        <ul class="max-h-96 space-y-1.5 overflow-y-auto pr-1">
          <li v-for="p in awayLineup.starters" :key="p.id" class="space-y-1">
            <div class="flex items-center gap-2">
              <UBadge :color="p.color" variant="soft" size="xs" :label="p.slot" class="shrink-0" />
              <span class="min-w-0 truncate text-xs sm:text-sm" :class="p.statusClass">{{ p.name }}</span>
            </div>
            <div class="app-stat-bar-track">
              <div class="app-stat-bar-fill" :style="{ width: `${p.stamina}%` }" />
            </div>
          </li>
          <li v-if="!awayLineup.starters.length" class="app-muted-text text-sm">No lineup available.</li>

          <template v-if="awayLineup.bench.length">
            <li class="app-kicker pt-3 text-[10px]">Bench</li>
            <li v-for="p in awayLineup.bench" :key="p.id" class="flex items-center gap-2">
              <UBadge :color="p.color" variant="soft" size="xs" :label="p.slot" class="shrink-0 opacity-60" />
              <span class="min-w-0 truncate text-xs sm:text-sm" :class="p.statusClass">{{ p.name }}</span>
            </li>
          </template>
        </ul>
      </UCard>
    </div>

    <!--
      `v-if` on showTacticsPanel, not just `:open`: the modal's DOM node
      outlives its open prop going false, which left the panel painted over
      the full-time screen (and its stale staged substitutions live).
      Unmounting is also what resets the staged list between pauses.
    -->
    <MatchTacticsPanel v-if="showTacticsPanel && ownTeam && ownState" :open="showTacticsPanel" :team-name="ownTeam.name"
      :squad="ownTeam.squad" :on-pitch-ids="ownState.onPitch" :bench-ids="ownState.bench"
      :used-player-ids="ownState.usedPlayers" :booked-ids="ownState.booked" :sent-off-ids="ownState.sentOff"
      :stamina="ownState.stamina" :subs-used="ownState.subsUsed" :tactic-options="tacticsList ?? []"
      :current-tactic="ownTactic" :is-half-time="isHalfTime" :loading="loadingMatch"
      :injured-player-id="isHalfTime ? null : injuredPlayerId" :injured-player-name="injuredPlayerName"
      @confirm="applyChangesAndContinue" @close="skipChanges" />
  </div>
</template>
