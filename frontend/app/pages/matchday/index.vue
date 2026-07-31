<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { UButton, UCard, UBadge } from '#components'
import { onBeforeRouteLeave, useRouter } from 'vue-router'

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

const homeTeam = ref<any>(null)
const awayTeam = ref<any>(null)

const router = useRouter()

async function loadTeams() {
    if (!nextMatch.value) return
    const home = await $fetch(`/api/team/${nextMatch.value.homeTeamId}`)
    const away = await $fetch(`/api/team/${nextMatch.value.awayTeamId}`)
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
        if (String(e.eventType) === 'goal') {
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

const positionColors: Record<string, 'sky' | 'emerald' | 'amber' | 'rose'> = {
  GK: 'sky', DEF: 'emerald', DF: 'emerald', MID: 'amber', MF: 'amber', ATT: 'rose', FW: 'rose',
}
function positionColor(pos: string): 'sky' | 'emerald' | 'amber' | 'rose' | 'neutral' {
  return positionColors[String(pos ?? '').toUpperCase().trim()] ?? 'neutral'
}

function eventIcon(type: string): string {
  switch (String(type).toLowerCase()) {
    case 'goal': return 'i-lucide-circle-dot'
    case 'yellow_card': return 'i-lucide-square'
    case 'red_card': return 'i-lucide-square'
    case 'substitution': return 'i-lucide-arrow-left-right'
    default: return 'i-lucide-zap'
  }
}

function eventIconClass(type: string): string {
  switch (String(type).toLowerCase()) {
    case 'goal': return 'text-emerald-400'
    case 'yellow_card': return 'text-amber-400'
    case 'red_card': return 'text-red-500'
    case 'substitution': return 'text-sky-400'
    default: return 'text-white/50'
  }
}
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

        <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div>
                <UCard class="app-surface h-full">
                    <template #header>
                      <div class="flex items-center gap-2">
                        <UIcon name="i-lucide-shield" class="size-4 text-emerald-400" />
                        Home Lineup
                      </div>
                    </template>
                    <ul class="max-h-96 space-y-1.5 overflow-y-auto pr-1">
                        <li v-for="p in homeTeam?.squad" :key="p.id" class="flex items-center gap-2">
                          <UBadge :color="positionColor(p.position)" variant="soft" size="xs" :label="p.position" />
                          <span class="text-sm" style="color: var(--app-text-soft)">{{ p.name }}</span>
                        </li>
                    </ul>
                </UCard>
            </div>

            <div class="md:col-span-2 xl:col-span-1">
                <UCard class="app-surface h-full">
                    <template #header>
                      <div class="flex items-center gap-2">
                        <UIcon name="i-lucide-activity" class="size-4 text-emerald-400" />
                        Match Events
                      </div>
                    </template>
                    <ul class="max-h-96 space-y-2 overflow-y-auto pr-1">
                        <li
                          v-for="e in eventFeed"
                          :key="e.id"
                          class="flex items-center gap-2 text-sm animate-slide-in-left"
                        >
                            <UIcon :name="eventIcon(e.type)" class="size-4 shrink-0" :class="eventIconClass(e.type)" />
                            <span class="w-7 shrink-0 font-bold tabular-nums" style="color: var(--app-text)">{{ e.minute }}'</span>
                            <span class="truncate" style="color: var(--app-text-muted)">{{ e.teamName }}</span>
                            <span class="shrink-0 font-medium capitalize" style="color: var(--app-text-soft)">{{ e.type.replace('_', ' ') }}</span>
                            <span v-if="e.playerName" class="truncate text-xs" style="color: var(--app-text-muted)">– {{ e.playerName }}</span>
                        </li>
                        <li v-if="!eventFeed.length" class="app-muted-text text-sm">No events yet.</li>
                    </ul>
                </UCard>
            </div>

            <div>
                <UCard class="app-surface h-full">
                    <template #header>
                      <div class="flex items-center gap-2">
                        <UIcon name="i-lucide-shield" class="size-4 text-sky-400" />
                        Away Lineup
                      </div>
                    </template>
                    <ul class="max-h-96 space-y-1.5 overflow-y-auto pr-1">
                        <li v-for="p in awayTeam?.squad" :key="p.id" class="flex items-center gap-2">
                          <UBadge :color="positionColor(p.position)" variant="soft" size="xs" :label="p.position" />
                          <span class="text-sm" style="color: var(--app-text-soft)">{{ p.name }}</span>
                        </li>
                    </ul>
                </UCard>
            </div>
        </div>
    </div>
</template>
