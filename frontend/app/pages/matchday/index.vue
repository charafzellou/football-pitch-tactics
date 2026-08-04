<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { UButton, UCard, UBadge } from '#components'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import type { LineupSlot } from '#shared/lineup'
import { normalizePosition, sortByLineupOrder } from '#shared/lineup'

interface PlaybackEntry {
    id: string
    minute: number
    type: string
    teamName: string
    playerName: string | null
}

interface SimulationEvent {
    minute: number
    eventType: string
    teamId: number
    playerId?: number
}

interface SimulationResponse {
    homeScore: number
    awayScore: number
    events: SimulationEvent[]
    homeLineup: number[]
    awayLineup: number[]
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
    lineupAutoSelected: boolean
}

/** A player as rendered in a lineup panel. */
interface LineupRow {
    id: number
    name: string
    slot: string
    color: 'sky' | 'emerald' | 'amber' | 'rose' | 'neutral'
    statusClass: string
}

const { data: schedule, refresh: refreshSchedule } = useFetch('/api/schedule')
const nextMatch = computed(() => schedule.value?.[0] ?? null)

const currentMinute = ref(0)
const playing = ref(false)
const hasStarted = ref(false)
const loadingMatch = ref(false)
const events = ref<SimulationEvent[]>([])
const playbackIndex = ref(0)
const homeScore = ref(0)
const awayScore = ref(0)
const isFinished = ref(false)
const eventFeed = ref<PlaybackEntry[]>([])

const homeTeam = ref<TeamPayload | null>(null)
const awayTeam = ref<TeamPayload | null>(null)
// Kept separate from the team payload so the simulation response can confirm
// the XI that actually took the field.
const homeStartingXi = ref<number[]>([])
const awayStartingXi = ref<number[]>([])

const router = useRouter()

async function loadTeams() {
    if (!nextMatch.value) return
    const home = await $fetch<TeamPayload>(`/api/team/${nextMatch.value.homeTeamId}`)
    const away = await $fetch<TeamPayload>(`/api/team/${nextMatch.value.awayTeamId}`)
    homeTeam.value = home
    awayTeam.value = away
    homeStartingXi.value = home.startingXi ?? []
    awayStartingXi.value = away.startingXi ?? []
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

async function startPlayback() {
    if (!nextMatch.value || hasStarted.value || loadingMatch.value) return
    if (!homeTeam.value || !awayTeam.value)
        await loadTeams()

    // start a new simulation from minute 0
    currentMinute.value = 0
    playbackIndex.value = 0
    eventFeed.value = []
    homeScore.value = 0
    awayScore.value = 0
    isFinished.value = false
    events.value = []
    loadingMatch.value = true

    const result = await $fetch<SimulationResponse | { message: string }>('/api/match/simulate', {
        method: 'POST',
        body: { matchId: nextMatch.value.id },
    })

    if ('message' in result) {
        loadingMatch.value = false
        return
    }

    events.value = result.events ?? []
    // Adopt the XIs the engine fielded, in case they drifted from the preview.
    if (result.homeLineup?.length) homeStartingXi.value = result.homeLineup
    if (result.awayLineup?.length) awayStartingXi.value = result.awayLineup
    hasStarted.value = true
    playing.value = true
    loadingMatch.value = false

    // start clock: 1 second per minute
    if (intervalHandle) clearInterval(intervalHandle)
    intervalHandle = setInterval(tickOnce, 1000)
}

function tickOnce() {
    if (currentMinute.value >= 90) {
        stopPlayback()
        isFinished.value = true
        return
    }
    currentMinute.value++
    // play events that match this minute
    while (playbackIndex.value < events.value.length) {
        const e = events.value[playbackIndex.value]
        if (!e || !homeTeam.value || !awayTeam.value || e.minute > currentMinute.value)
            break

        playbackIndex.value++
        // resolve player name and team name
        const team = e.teamId === homeTeam.value.id ? homeTeam.value : awayTeam.value
        const player = team.squad.find((p: any) => p.id === e.playerId)
        const entry = {
            id: `${e.minute}-${e.eventType}-${playbackIndex.value}`,
            minute: e.minute,
            type: e.eventType,
            teamName: team.name,
            playerName: player?.name ?? null,
        }
        eventFeed.value.unshift(entry)
        // update score on goals
        if (normalizeEventType(e.eventType) === 'goal') {
            if (e.teamId === homeTeam.value.id) homeScore.value++
            else awayScore.value++
        }
    }
}

function resumePlayback() {
    if (playing.value || !hasStarted.value || isFinished.value) return
    if (loadingMatch.value)
        return

    playing.value = true
    // resume interval
    if (intervalHandle) clearInterval(intervalHandle)
    intervalHandle = setInterval(tickOnce, 1000)
}

function stopPlayback() {
    if (!hasStarted.value || isFinished.value) return
    playing.value = false
    if (intervalHandle) clearInterval(intervalHandle)
    intervalHandle = null
}

function resetPlayback() {
    stopPlayback()
    currentMinute.value = 0
    playbackIndex.value = 0
    eventFeed.value = []
    events.value = []
    homeScore.value = 0
    awayScore.value = 0
    isFinished.value = false
    hasStarted.value = false
    loadingMatch.value = false
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
  { id: 'fouls', label: 'Fouls', types: ['foul', 'offside', 'injury'] },
]

const eventFilter = ref('all')

const filteredEventFeed = computed(() => {
  const active = EVENT_FILTERS.find(filter => filter.id === eventFilter.value)
  if (!active?.types)
    return eventFeed.value

  return eventFeed.value.filter(entry => active.types!.includes(normalizeEventType(entry.type)))
})

/** Only events already played back count — the panels follow the clock. */
const revealedEvents = computed(() => events.value.slice(0, playbackIndex.value))

const playerStatus = computed(() => {
  const booked = new Set<number>()
  const sentOff = new Set<number>()
  const substituted = new Set<number>()

  for (const event of revealedEvents.value) {
    if (!event.playerId)
      continue

    switch (normalizeEventType(event.eventType)) {
      case 'yellow': booked.add(event.playerId); break
      case 'red': sentOff.add(event.playerId); break
      case 'substitution': substituted.add(event.playerId); break
    }
  }

  return { booked, sentOff, substituted }
})

function statusClassFor(playerId: number, isStarter: boolean): string {
  const { booked, sentOff, substituted } = playerStatus.value

  if (sentOff.has(playerId))
    return 'app-player-sent-off'

  if (booked.has(playerId))
    return 'app-player-booked'

  if (!isStarter || substituted.has(playerId))
    return 'app-player-out'

  return 'app-player-on-pitch'
}

function toRow(player: SquadPlayer, isStarter: boolean): LineupRow {
  const slot = normalizePosition(player.position)

  return {
    id: player.id,
    name: player.name,
    slot: slot ?? '—',
    color: slot ? positionColors[slot] : 'neutral',
    statusClass: statusClassFor(player.id, isStarter),
  }
}

function buildLineup(team: TeamPayload | null, startingXi: number[]) {
  if (!team)
    return { starters: [] as LineupRow[], bench: [] as LineupRow[] }

  const squadById = new Map(team.squad.map(player => [player.id, player]))
  const starterIds = new Set(startingXi)
  const starters = startingXi
    .map(id => squadById.get(id))
    .filter((player): player is SquadPlayer => Boolean(player))
  const bench = sortByLineupOrder(team.squad.filter(player => !starterIds.has(player.id)))

  return {
    starters: starters.map(player => toRow(player, true)),
    bench: bench.map(player => toRow(player, false)),
  }
}

const homeLineup = computed(() => buildLineup(homeTeam.value, homeStartingXi.value))
const awayLineup = computed(() => buildLineup(awayTeam.value, awayStartingXi.value))
</script>

<template>
    <div class="space-y-4 sm:space-y-6">
        <h1 class="app-page-title flex items-center gap-2">
          <UIcon name="i-lucide-flag" class="size-6 text-emerald-400" />
          Matchday
        </h1>

        <!-- Clock + score card -->
        <UCard class="overflow-hidden" style="background: linear-gradient(135deg, rgba(13,96,72,0.3), var(--app-surface) 60%); border-color: var(--app-surface-border)">
            <template #header>
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <UIcon name="i-lucide-timer" class="size-4 text-emerald-400" />
                  <span>Virtual Clock</span>
                </div>
                <span
                  v-if="hasStarted && !isFinished"
                  class="flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-widest text-red-400"
                  style="background-color: rgba(239,68,68,0.15)"
                >
                  <span class="size-2 rounded-full bg-red-400 animate-live-ping" />
                  LIVE
                </span>
                <UBadge v-if="isFinished" color="success" variant="soft" label="Full time" size="sm" />
              </div>
            </template>

            <div class="flex flex-col items-center gap-4 py-2 md:flex-row md:justify-between">
                <div class="text-center md:text-left">
                  <p class="app-kicker mb-1">Minute</p>
                  <p class="text-3xl font-black tabular-nums" style="color: var(--app-text)">{{ currentMinute }}<span class="text-lg font-semibold" style="color: var(--app-text-muted)">'</span></p>
                </div>

                <div class="text-center">
                  <p class="app-muted-text mb-1 text-sm">
                    {{ homeTeam?.name ?? 'Home' }} <span style="color: var(--app-text-muted)">vs</span> {{ awayTeam?.name ?? 'Away' }}
                  </p>
                  <p class="app-gradient-text text-4xl font-black tracking-tight sm:text-5xl">
                    {{ homeScore }} – {{ awayScore }}
                  </p>
                </div>

                <div class="flex flex-wrap justify-center gap-2 md:justify-end">
                    <UButton v-if="!hasStarted && !isFinished" :loading="loadingMatch" label="Start Match" icon="i-lucide-play" @click="startPlayback" />
                    <UButton v-if="hasStarted && playing && !isFinished" label="Pause" icon="i-lucide-pause" color="neutral" variant="soft" @click="stopPlayback" />
                    <UButton v-if="hasStarted && !playing && !isFinished" label="Resume" icon="i-lucide-play" @click="resumePlayback" />
                    <UButton v-if="isFinished" label="End Match" icon="i-lucide-flag" color="success" @click="endMatch" />
                </div>
            </div>
        </UCard>

        <!--
          Mobile: two columns — lineups on the top row, events spanning the bottom.
          lg and up: a single row of three columns.
        -->
        <div class="grid grid-cols-2 gap-4 lg:grid-cols-3">
            <UCard class="app-surface order-1 h-full lg:order-none">
                <template #header>
                  <div class="flex items-center gap-2">
                    <UIcon name="i-lucide-shield" class="size-4 shrink-0 text-emerald-400" />
                    <span class="truncate">Home Lineup</span>
                    <UBadge v-if="homeTeam?.lineupAutoSelected" color="neutral" variant="soft" size="xs" label="Auto" />
                  </div>
                </template>
                <ul class="max-h-96 space-y-1.5 overflow-y-auto pr-1">
                    <li v-for="p in homeLineup.starters" :key="p.id" class="flex items-center gap-2">
                      <UBadge :color="p.color" variant="soft" size="xs" :label="p.slot" class="shrink-0" />
                      <span class="min-w-0 truncate text-xs sm:text-sm" :class="p.statusClass">{{ p.name }}</span>
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

            <UCard class="app-surface order-3 col-span-2 h-full lg:order-none lg:col-span-1">
                <template #header>
                  <div class="space-y-2.5">
                    <div class="flex items-center gap-2">
                      <UIcon name="i-lucide-activity" class="size-4 shrink-0 text-emerald-400" />
                      <span class="truncate">Match Events</span>
                    </div>
                    <div class="flex flex-wrap gap-1.5">
                      <button
                        v-for="filter in EVENT_FILTERS"
                        :key="filter.id"
                        type="button"
                        class="app-filter-chip"
                        :class="{ 'app-filter-chip--active': eventFilter === filter.id }"
                        @click="eventFilter = filter.id"
                      >
                        {{ filter.label }}
                      </button>
                    </div>
                  </div>
                </template>
                <ul class="max-h-96 space-y-2 overflow-y-auto pr-1">
                    <li
                      v-for="e in filteredEventFeed"
                      :key="e.id"
                      class="flex items-center gap-2 text-sm animate-slide-in-left"
                    >
                        <UIcon :name="eventIcon(e.type)" class="size-4 shrink-0" :class="eventIconClass(e.type)" />
                        <span class="w-7 shrink-0 font-bold tabular-nums" style="color: var(--app-text)">{{ e.minute }}'</span>
                        <span class="truncate" style="color: var(--app-text-muted)">{{ e.teamName }}</span>
                        <span class="shrink-0 font-medium capitalize" style="color: var(--app-text-soft)">{{ eventLabel(e.type) }}</span>
                        <span v-if="e.playerName" class="truncate text-xs" style="color: var(--app-text-muted)">– {{ e.playerName }}</span>
                    </li>
                    <li v-if="!filteredEventFeed.length" class="app-muted-text text-sm">
                      {{ eventFeed.length ? 'No events of this type yet.' : 'No events yet.' }}
                    </li>
                </ul>
            </UCard>

            <UCard class="app-surface order-2 h-full lg:order-none">
                <template #header>
                  <div class="flex items-center gap-2">
                    <UIcon name="i-lucide-shield" class="size-4 shrink-0 text-sky-400" />
                    <span class="truncate">Away Lineup</span>
                    <UBadge v-if="awayTeam?.lineupAutoSelected" color="neutral" variant="soft" size="xs" label="Auto" />
                  </div>
                </template>
                <ul class="max-h-96 space-y-1.5 overflow-y-auto pr-1">
                    <li v-for="p in awayLineup.starters" :key="p.id" class="flex items-center gap-2">
                      <UBadge :color="p.color" variant="soft" size="xs" :label="p.slot" class="shrink-0" />
                      <span class="min-w-0 truncate text-xs sm:text-sm" :class="p.statusClass">{{ p.name }}</span>
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
    </div>
</template>
