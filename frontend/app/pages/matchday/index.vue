<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { UButton, UCard } from '#components'
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
    // Redirect to dashboard (/game)
    router.push('/game')
}
</script>

<template>
    <div class="space-y-4">
        <h1 class="text-2xl font-bold">Matchday</h1>

        <UCard>
            <template #header>Virtual Clock</template>
            <div class="flex items-center justify-between">
                <div class="text-xl font-bold">{{ currentMinute }}'</div>
                <div class="text-lg">{{ homeTeam?.name ?? 'Home' }} {{ homeScore }} - {{ awayScore }} {{ awayTeam?.name
                    ?? 'Away' }}
                </div>
                <div>
                    <UButton v-if="!hasStarted && !isFinished" :loading="loadingMatch" label="Start Match" @click="startPlayback" />
                    <UButton v-if="hasStarted && playing && !isFinished" label="Pause" @click="stopPlayback" />
                    <UButton v-if="hasStarted && !playing && !isFinished" label="Resume"
                        @click="resumePlayback" />
                    <UButton v-if="isFinished" label="End Match" @click="endMatch" />
                </div>
            </div>
        </UCard>

        <div class="grid grid-cols-3 gap-4">
            <div class="col-span-1">
                <UCard>
                    <template #header>Home Lineup</template>
                    <ul>
                        <li v-for="p in homeTeam?.squad" :key="p.id">{{ p.name }}</li>
                    </ul>
                </UCard>
            </div>

            <div class="col-span-1">
                <UCard>
                    <template #header>Match Events</template>
                    <ul>
                        <li v-for="e in eventFeed" :key="e.id">
                            <strong>{{ e.minute }}'</strong> - <em>{{ e.teamName }}</em> - <span>{{ e.type }}</span>
                            <span v-if="e.playerName">- {{ e.playerName }}</span>
                        </li>
                    </ul>
                </UCard>
            </div>

            <div class="col-span-1">
                <UCard>
                    <template #header>Away Lineup</template>
                    <ul>
                        <li v-for="p in awayTeam?.squad" :key="p.id">{{ p.name }}</li>
                    </ul>
                </UCard>
            </div>
        </div>
    </div>
</template>
