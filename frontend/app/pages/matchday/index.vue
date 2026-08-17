<script setup lang="ts">
/**
 * Matchday.
 *
 * The simulation lifecycle is unchanged — start / advance / changes / finish,
 * with the clock deriving everything from `applyEvents` — but the presentation
 * moved out into `components/matchday/*` so this file is about running the
 * match, not drawing it.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { useIntervalFn } from '@vueuse/core'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import type { MatchEvent, MatchState } from '#shared/match-state'
import { HALF_TIME_MINUTE, MATCH_MINUTES, applyEvents } from '#shared/match-state'
import type { FeedEntry } from '~/components/matchday/EventFeed.vue'
import type { GoalMoment } from '~/components/matchday/GoalOverlay.vue'
import { normalizeEventType } from '~/utils/match-events'
import { useSettingsStore } from '~/stores/settings'

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

const router = useRouter()
const toast = useAppToast()
const sfx = useSfx()
const settings = useSettingsStore()

const { data: schedule, refresh: refreshSchedule } = useFetch('/api/schedule')
const { data: tacticsList } = useFetch('/api/tactics')
const { data: gameState } = useFetch('/api/game/state')

const nextMatch = computed(() => schedule.value?.[0] ?? null)

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
const eventFeed = ref<FeedEntry[]>([])
const reportOpen = ref(false)

/** State at the start of the currently-loaded segment, plus every event revealed since. */
const anchorState = shallowRef<MatchState | null>(null)
const allEvents = ref<MatchEvent[]>([])
/** The last minute `allEvents` actually has simulated data for. */
const segmentFetchedThrough = ref(0)
const playbackIndex = ref(0)

const homeTeam = ref<TeamPayload | null>(null)
const awayTeam = ref<TeamPayload | null>(null)

const goalMoment = ref<GoalMoment | null>(null)
let goalKey = 0

// ---------------------------------------------------------------------------
// Derived state
// ---------------------------------------------------------------------------

/** The live match state as of `currentMinute`, from the anchor plus revealed events. */
const liveState = computed(() => {
  if (!anchorState.value) return null
  return applyEvents(anchorState.value, allEvents.value, currentMinute.value)
})

const homeScore = computed(() => liveState.value?.home.score ?? 0)
const awayScore = computed(() => liveState.value?.away.score ?? 0)

const homeTeamId = computed(() => homeTeam.value?.id ?? null)
const awayTeamId = computed(() => awayTeam.value?.id ?? null)

const { rows: statRows, territory, momentum } = useMatchStats(allEvents, currentMinute, homeTeamId, awayTeamId)

const playerSide = computed<'home' | 'away' | null>(() => {
  if (!gameState.value || !homeTeam.value || !awayTeam.value) return null
  if (homeTeam.value.id === gameState.value.playerTeamId) return 'home'
  if (awayTeam.value.id === gameState.value.playerTeamId) return 'away'
  return null
})

const ownTeam = computed(() =>
  playerSide.value === 'home' ? homeTeam.value : playerSide.value === 'away' ? awayTeam.value : null,
)
const ownState = computed(() => (playerSide.value ? liveState.value?.[playerSide.value] ?? null : null))
const ownTactic = computed(() => ownState.value?.tacticName ?? '')

const showTacticsPanel = computed(() =>
  hasStarted.value && !isFinished.value && !!ownTeam.value && !!ownState.value && !!liveState.value
  && (isHalfTime.value || (!playing.value && !loadingMatch.value)),
)

/** Half time wins if an injury lands on the same minute — the break covers it anyway. */
const injuredPlayerName = computed(() => {
  if (isHalfTime.value || injuredPlayerId.value === null) return null
  return ownTeam.value?.squad.find(p => p.id === injuredPlayerId.value)?.name ?? null
})

const allSquad = computed(() => [...(homeTeam.value?.squad ?? []), ...(awayTeam.value?.squad ?? [])])

function playerNameFor(playerId?: number): string | null {
  if (!playerId) return null
  return allSquad.value.find(p => p.id === playerId)?.name ?? null
}

/** End-of-match stamina for both sides, for the report's player of the match. */
const combinedStamina = computed<Record<number, number>>(() => ({
  ...(liveState.value?.home.stamina ?? {}),
  ...(liveState.value?.away.stamina ?? {}),
}))

// ---------------------------------------------------------------------------
// Playback clock
// ---------------------------------------------------------------------------

const speed = computed({
  get: () => settings.playbackSpeed,
  set: (value: number) => { settings.playbackSpeed = value },
})

/** One in-game minute per second at 1×, scaled by the chosen speed. */
const tickPeriod = computed(() => Math.round(1000 / speed.value))

const { pause: pauseClock, resume: resumeClock } = useIntervalFn(tickOnce, tickPeriod, { immediate: false })

function tickOnce() {
  if (currentMinute.value >= segmentFetchedThrough.value) {
    pauseClock()
    playing.value = false

    if (currentMinute.value >= MATCH_MINUTES) {
      sfx.play('whistleLong')
      void finishMatch()
    }
    else if (currentMinute.value === HALF_TIME_MINUTE) {
      sfx.play('whistle')
      isHalfTime.value = true
    }

    return
  }

  currentMinute.value++
  const revealed = revealUpTo(currentMinute.value)

  // An injury to the player's own team stops the clock and asks for a
  // replacement. The engine has already taken the player off, so doing
  // nothing simply means playing on a man down.
  if (revealed.ownInjury !== null && !isHalfTime.value) {
    injuredPlayerId.value = revealed.ownInjury
    stopPlayback()
  }
}

/** Reveals events up to `minute`, reporting what the UI needs to react to. */
function revealUpTo(minute: number): { ownInjury: number | null } {
  let ownInjury: number | null = null

  while (playbackIndex.value < allEvents.value.length) {
    const event = allEvents.value[playbackIndex.value]
    if (!event || !homeTeam.value || !awayTeam.value || event.minute > minute)
      break

    playbackIndex.value++
    eventFeed.value.unshift(feedEntry(event, playbackIndex.value))

    const type = normalizeEventType(event.eventType)

    if (type === 'goal')
      announceGoal(event)
    else if (type === 'yellow' || type === 'red')
      sfx.play('card')
    else if (type === 'substitution')
      sfx.play('sub')

    if (type === 'injury' && event.playerId && playerSide.value && event.teamId === ownTeam.value?.id)
      ownInjury = event.playerId
  }

  return { ownInjury }
}

function announceGoal(event: MatchEvent) {
  const isHome = event.teamId === homeTeamId.value
  const team = isHome ? homeTeam.value : awayTeam.value
  const isPlayerGoal = Boolean(playerSide.value && event.teamId === ownTeam.value?.id)

  sfx.play(isPlayerGoal ? 'goal' : 'goalAgainst')

  // The score is derived from `currentMinute`, and this runs mid-reveal, so
  // count the goal in by hand rather than reading a value that hasn't caught up.
  goalMoment.value = {
    key: ++goalKey,
    minute: event.minute,
    scorer: playerNameFor(event.playerId),
    teamName: team?.name ?? '—',
    homeScore: homeScore.value + (isHome ? 1 : 0),
    awayScore: awayScore.value + (isHome ? 0 : 1),
    isPlayerGoal,
  }
}

function feedEntry(event: MatchEvent, index: number): FeedEntry {
  const isHome = event.teamId === homeTeamId.value
  const team = isHome ? homeTeam.value : awayTeam.value

  return {
    id: `${event.minute}-${event.eventType}-${index}`,
    minute: event.minute,
    type: event.eventType,
    teamName: team?.name ?? '—',
    playerName: playerNameFor(event.playerId),
    relatedPlayerName: playerNameFor(event.relatedPlayerId),
    isHome,
  }
}

function buildFeed(events: MatchEvent[]): FeedEntry[] {
  return events.map((event, i) => feedEntry(event, i + 1)).reverse()
}

function startInterval() {
  playing.value = true
  resumeClock()
}

function stopPlayback() {
  if (!hasStarted.value || isFinished.value) return
  playing.value = false
  pauseClock()
}

/** Fast-forwards to the end of the loaded segment without watching it out. */
function skipToBreak() {
  if (!playing.value) return

  pauseClock()
  currentMinute.value = segmentFetchedThrough.value
  revealUpTo(currentMinute.value)
  playing.value = false

  if (currentMinute.value >= MATCH_MINUTES) {
    sfx.play('whistleLong')
    void finishMatch()
  }
  else if (currentMinute.value === HALF_TIME_MINUTE) {
    sfx.play('whistle')
    isHalfTime.value = true
  }
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

async function loadTeams() {
  if (!nextMatch.value) return
  const [home, away] = await Promise.all([
    $fetch<TeamPayload>(`/api/team/${nextMatch.value.homeTeamId}`),
    $fetch<TeamPayload>(`/api/team/${nextMatch.value.awayTeamId}`),
  ])
  homeTeam.value = home
  awayTeam.value = away
}

function mapEvent(raw: any): MatchEvent {
  return {
    minute: raw.minute,
    eventType: raw.eventType,
    teamId: raw.teamId,
    playerId: raw.playerId ?? undefined,
    relatedPlayerId: raw.relatedPlayerId ?? undefined,
  }
}

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
    toast.fromRequestError(error, 'Could not start the match')
    return
  }

  if ('message' in result) {
    loadingMatch.value = false
    toast.warn({ title: 'Nothing to play', description: result.message })
    return
  }

  matchId.value = result.matchId
  hasStarted.value = true

  if (result.resumed) {
    anchorState.value = result.state
    allEvents.value = (result.events ?? []).map(mapEvent)

    // `result.state.minute` only reflects the last minute a pause was
    // explicitly synced to — it can lag behind a segment that was already
    // fully simulated but never paused mid-way. Resume at the furthest minute
    // we actually have events for, not at the possibly-stale anchor.
    const maxEventMinute = allEvents.value.reduce((max, e) => Math.max(max, e.minute), result.state.minute)
    currentMinute.value = maxEventMinute
    playbackIndex.value = allEvents.value.length
    segmentFetchedThrough.value = maxEventMinute
    eventFeed.value = buildFeed(allEvents.value)
    isHalfTime.value = maxEventMinute === HALF_TIME_MINUTE
    loadingMatch.value = false
    playing.value = false

    toast.info({ title: 'Match resumed', description: `Picked up at ${maxEventMinute}'.` })

    // A refresh at 90' lands here on a match whose result was never committed.
    if (maxEventMinute >= MATCH_MINUTES)
      await finishMatch()

    return
  }

  anchorState.value = result.state
  allEvents.value = []
  currentMinute.value = 0
  playbackIndex.value = 0
  eventFeed.value = []

  sfx.play('whistle')
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
    toast.fromRequestError(error, 'Could not simulate the next passage of play')
    return
  }
  finally {
    loadingMatch.value = false
  }

  startInterval()
}

/**
 * Full time. The server has simulated these minutes but deliberately hasn't
 * committed anything — right up until the clock arrived, a pause could still
 * rewind and re-simulate the rest. This is the call that makes it official.
 */
async function finishMatch() {
  if (isFinished.value || !matchId.value) return

  loadingMatch.value = true
  try {
    await $fetch('/api/match/finish', { method: 'POST', body: { matchId: matchId.value } })
    finishFailed.value = false
    isFinished.value = true
    reportOpen.value = true
  }
  catch (error) {
    // Leave `isFinished` false so the result isn't silently lost — the player
    // gets a Retry button rather than a dead 90th minute.
    finishFailed.value = true
    toast.fromRequestError(error, 'Could not save the final result')
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

  startInterval()
}

/** Called from the tactics panel: apply staged changes, then fetch the next segment. */
async function applyChangesAndContinue(payload: {
  substitutions: { playerOutId: number; playerInId: number }[]
  tactic: string
}) {
  if (!matchId.value) return
  loadingMatch.value = true

  if (payload.substitutions.length || payload.tactic !== ownTactic.value) {
    try {
      const result = await $fetch<any>('/api/match/changes', {
        method: 'POST',
        body: {
          matchId: matchId.value,
          atMinute: currentMinute.value,
          substitutions: payload.substitutions,
          tactic: payload.tactic,
        },
      })

      anchorState.value = result.state
      // The server discarded anything simulated past this minute — match that here.
      allEvents.value = [
        ...allEvents.value.filter(e => e.minute <= currentMinute.value),
        ...(result.events ?? []).map(mapEvent),
      ]
      playbackIndex.value = allEvents.value.length
      eventFeed.value = buildFeed(allEvents.value)
      segmentFetchedThrough.value = currentMinute.value

      if (payload.substitutions.length) {
        const summary = payload.substitutions
          .map(sub => `${playerNameFor(sub.playerInId) ?? '—'} on for ${playerNameFor(sub.playerOutId) ?? '—'}`)
          .join(', ')
        toast.success({
          title: `${payload.substitutions.length} substitution${payload.substitutions.length === 1 ? '' : 's'} made`,
          description: summary,
        })
      }
      else if (payload.tactic !== ownTactic.value) {
        toast.success({ title: 'Formation changed', description: `Now playing ${payload.tactic}.` })
      }
    }
    catch (error) {
      // Leave the clock stopped and the panel up so the manager can decide
      // again rather than being resumed into a match that ignored them.
      loadingMatch.value = false
      toast.fromRequestError(error, 'Your changes were not applied — please set them again')
      return
    }
  }

  isHalfTime.value = false
  injuredPlayerId.value = null
  loadingMatch.value = false
  await fetchNextSegment()
}

/**
 * "Continue without changes" / "Play on with ten". Nothing needs re-simulating:
 * the engine already played the rest of this segment with the injured player
 * off, so the buffered events are already consistent with playing short.
 */
function skipChanges() {
  isHalfTime.value = false
  injuredPlayerId.value = null
  void resumePlayback()
}

function endMatch() {
  router.push('/game')
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

const feedRef = ref<{ scrollToMinute: (minute: number) => void } | null>(null)

function onTimelineSelect(minute: number) {
  feedRef.value?.scrollToMinute(minute)
}

onMounted(async () => {
  await refreshSchedule()
  await loadTeams()
})

onBeforeUnmount(pauseClock)

onBeforeRouteLeave(() => {
  if (hasStarted.value && !isFinished.value) {
    // Previously this blocked silently, which looked like a broken link.
    toast.warn({
      title: 'Match in progress',
      description: 'Play through to full time before leaving — the result is not saved until the 90th minute.',
    })
    return false
  }
})
</script>

<template>
  <div class="space-y-4 sm:space-y-5">
    <h1 class="app-page-title flex items-center gap-2">
      <UIcon name="i-lucide-flag" class="size-6" style="color: var(--app-accent)" />
      Matchday
    </h1>

    <AppEmptyState
      v-if="!nextMatch"
      icon="i-lucide-calendar-x"
      title="No fixture to play"
      description="Every scheduled match has been played."
      action-label="Back to dashboard"
      action-icon="i-lucide-arrow-left"
      @action="router.push('/game')"
    />

    <template v-else>
      <MatchdayHud
        :current-minute="currentMinute"
        :home-score="homeScore"
        :away-score="awayScore"
        :home-name="homeTeam?.name ?? 'Home'"
        :away-name="awayTeam?.name ?? 'Away'"
        :player-side="playerSide"
        :has-started="hasStarted"
        :playing="playing"
        :is-finished="isFinished"
        :is-half-time="isHalfTime"
        :loading="loadingMatch"
        :finish-failed="finishFailed"
        :injured-player-name="injuredPlayerName"
        :speed="speed"
        @start="startPlayback"
        @pause="stopPlayback"
        @resume="resumePlayback"
        @end="endMatch"
        @retry-finish="finishMatch"
        @skip-to-break="skipToBreak"
        @update:speed="value => speed = value"
      />

      <MatchdayTimeline
        v-if="hasStarted"
        :events="allEvents"
        :current-minute="currentMinute"
        :home-team-id="homeTeamId"
        :player-name-for="playerNameFor"
        @select="onTimelineSelect"
      />

      <!--
        Mobile: two columns — lineups on the top row, events spanning the bottom.
        lg and up: a single row of three columns.
      -->
      <div class="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <MatchdayLineupPanel
          class="order-1 lg:order-none"
          title="Home Lineup"
          accent="var(--app-accent)"
          :squad="homeTeam?.squad ?? []"
          :side="liveState?.home ?? null"
          :preview-xi="homeTeam?.startingXi ?? []"
          :preview-bench="homeTeam?.bench ?? []"
          :auto-selected="Boolean(homeTeam?.lineupAutoSelected)"
          :is-player-team="playerSide === 'home'"
          :events="allEvents"
          :current-minute="currentMinute"
          :team-id="homeTeamId"
        />

        <MatchdayEventFeed
          ref="feedRef"
          class="order-3 col-span-2 lg:order-none lg:col-span-1"
          :entries="eventFeed"
          :has-started="hasStarted"
        />

        <MatchdayLineupPanel
          class="order-2 lg:order-none"
          title="Away Lineup"
          accent="var(--app-pos-gk)"
          :squad="awayTeam?.squad ?? []"
          :side="liveState?.away ?? null"
          :preview-xi="awayTeam?.startingXi ?? []"
          :preview-bench="awayTeam?.bench ?? []"
          :auto-selected="Boolean(awayTeam?.lineupAutoSelected)"
          :is-player-team="playerSide === 'away'"
          :events="allEvents"
          :current-minute="currentMinute"
          :team-id="awayTeamId"
        />
      </div>

      <MatchdayStatsPanel
        v-if="hasStarted"
        :rows="statRows"
        :territory="territory"
        :momentum="momentum"
        :home-name="homeTeam?.name ?? 'Home'"
        :away-name="awayTeam?.name ?? 'Away'"
      />
    </template>

    <MatchdayGoalOverlay :moment="goalMoment" />

    <!--
      `v-if` on showTacticsPanel, not just `:open`: the modal's DOM node
      outlives its open prop going false, which left the panel painted over the
      full-time screen with its stale staged substitutions live. Unmounting is
      also what resets the staged list between pauses.
    -->
    <MatchTacticsPanel
      v-if="showTacticsPanel && ownTeam && liveState && playerSide"
      :open="showTacticsPanel"
      :team-name="ownTeam.name"
      :squad="ownTeam.squad"
      :state="liveState"
      :side="playerSide"
      :tactic-options="tacticsList ?? []"
      :is-half-time="isHalfTime"
      :loading="loadingMatch"
      :injured-player-id="isHalfTime ? null : injuredPlayerId"
      :injured-player-name="injuredPlayerName"
      @confirm="applyChangesAndContinue"
      @close="skipChanges"
    />

    <MatchReport
      v-if="isFinished"
      :open="reportOpen"
      :home-name="homeTeam?.name ?? 'Home'"
      :away-name="awayTeam?.name ?? 'Away'"
      :home-score="homeScore"
      :away-score="awayScore"
      :home-team-id="homeTeamId"
      :away-team-id="awayTeamId"
      :home-squad="homeTeam?.squad ?? []"
      :away-squad="awayTeam?.squad ?? []"
      :events="allEvents"
      :rows="statRows"
      :territory="territory"
      :player-side="playerSide"
      :stamina="combinedStamina"
      @close="reportOpen = false"
    />
  </div>
</template>
