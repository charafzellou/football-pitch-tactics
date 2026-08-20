<script setup lang="ts">
/**
 * The sack.
 *
 * `game.dismissed_at_season` was written by `settleMatchday` and
 * `settleSeasonEnd` and read by nothing — so the board's entire pressure system
 * ended in a flag with no consequence: the dashboard still offered Matchday, the
 * market still took bids, and a dismissed manager carried on managing. This is
 * the ending that flag always implied.
 *
 * It also carries the *reason*. `board.ts` writes a news row for every movement
 * on the explicit principle that pressure must be explainable, and none of those
 * rows had a reader either — a manager could be sacked having never once been
 * told they were in trouble.
 */
import { computed } from 'vue'

interface NewsRow {
  id: number
  season: number
  round: number
  category: string
  tone: string
  headline: string
  body: string | null
}

interface BoardPayload {
  season: number
  clubName: string | null
  boardConfidence: number
  fanConfidence: number
  confidenceStreak: number
  expectation: number
  expectationText: string
  position: number | null
  leagueSize: number
  sackingEnabled: boolean
  dismissed: boolean
  dismissedAtSeason: number | null
  warningThreshold: number
  sackThreshold: number
  sackStreak: number
  news: NewsRow[]
}

interface HistoryRow {
  season: number
  leagueName: string
  champion: string
  championPoints: number
  playerPosition: number | null
  playerPoints: number | null
  isPlayerLeague: boolean
  wonByPlayer: boolean
}

const router = useRouter()

// Wrapped rather than inlined: `router.push` resolves to a `NavigationFailure`,
// which is not a valid click handler return type.
function startAgain() {
  router.push('/new-game')
}

const { data: board } = useAsyncData('dismissed-board', () => $fetch<BoardPayload | null>('/api/board'))
const { data: history } = useAsyncData(
  'dismissed-history',
  () => $fetch<HistoryRow[]>('/api/season/history'),
  { default: () => [] as HistoryRow[] },
)

/** Only the board's own words — the transfer and contract chatter is noise here. */
const verdict = computed(() => (board.value?.news ?? []).filter(row => row.category === 'board'))

const ownSeasons = computed(() => history.value.filter(row => row.isPlayerLeague && row.playerPosition !== null))
const titlesWon = computed(() => history.value.filter(row => row.wonByPlayer).length)

const bestFinish = computed(() => {
  const positions = ownSeasons.value.map(row => row.playerPosition!).filter(Boolean)
  return positions.length ? Math.min(...positions) : null
})

const tenure = computed(() => [
  { label: 'Seasons completed', value: String(ownSeasons.value.length), icon: 'i-lucide-calendar-check' },
  { label: 'Titles won', value: String(titlesWon.value), icon: 'i-lucide-trophy' },
  { label: 'Best finish', value: bestFinish.value ? ordinal(bestFinish.value) : '—', icon: 'i-lucide-medal' },
  { label: 'Dismissed in', value: board.value ? `Season ${board.value.dismissedAtSeason ?? board.value.season}` : '—', icon: 'i-lucide-door-open' },
])

function ordinal(position: number) {
  return position === 1 ? '1st' : position === 2 ? '2nd' : position === 3 ? '3rd' : `${position}th`
}

function toneColor(tone: string) {
  if (tone === 'positive') return 'var(--app-accent)'
  if (tone === 'negative') return 'var(--app-player-sent-off)'
  return 'var(--app-text-muted)'
}
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-4 py-6 sm:space-y-5">
    <AppSkeleton v-if="!board" variant="card" />

    <template v-else>
      <!-- The verdict -->
      <div class="app-elevated animate-rise overflow-hidden p-6 text-center sm:p-10">
        <UIcon
          name="i-lucide-door-open"
          class="mx-auto mb-4 size-14"
          style="color: var(--app-player-sent-off)"
        />

        <p class="app-kicker mb-2">Season {{ board.dismissedAtSeason ?? board.season }}</p>

        <h1 class="text-4xl font-black tracking-tight sm:text-5xl" style="color: var(--app-text)">
          You have been dismissed
        </h1>

        <p class="app-muted-text mx-auto mt-4 max-w-xl">
          <template v-if="board.clubName">
            {{ board.clubName }} have ended your tenure.
          </template>
          The board asked you to {{ board.expectationText }}<template v-if="board.position">,
            and you were {{ ordinal(board.position) }} of {{ board.leagueSize }}</template>.
        </p>

        <div class="mx-auto mt-8 grid max-w-md gap-3 sm:grid-cols-2">
          <div class="app-metric-card text-left">
            <p class="app-kicker mb-1.5 text-[10px]">Board confidence</p>
            <AppStatBar :value="board.boardConfidence" show-value tone="danger" />
          </div>
          <div class="app-metric-card text-left">
            <p class="app-kicker mb-1.5 text-[10px]">Fan confidence</p>
            <AppStatBar
              :value="board.fanConfidence"
              show-value
              :tone="board.fanConfidence <= board.warningThreshold ? 'danger' : 'default'"
            />
          </div>
        </div>

        <div class="mt-8">
          <UButton
            label="Start a new game"
            icon="i-lucide-rotate-ccw"
            size="xl"
            class="app-glow"
            @click="startAgain"
          />
          <p class="app-muted-text mt-3 text-xs">
            This save is closed — results, transfers and team selection are no longer accepted.
          </p>
        </div>
      </div>

      <!-- Tenure -->
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div v-for="item in tenure" :key="item.label" class="app-metric-card">
          <div class="mb-1 flex items-center justify-center gap-1.5">
            <UIcon :name="item.icon" class="size-3.5" style="color: var(--app-text-muted)" />
            <p class="app-kicker text-[10px]">{{ item.label }}</p>
          </div>
          <p class="app-hero-number text-2xl">{{ item.value }}</p>
        </div>
      </div>

      <!-- Why it happened -->
      <UCard v-if="verdict.length" class="app-surface">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-gavel" class="size-4" style="color: var(--app-player-sent-off)" />
            From the boardroom
          </div>
        </template>

        <ul class="space-y-2.5">
          <li
            v-for="item in verdict"
            :key="item.id"
            class="app-surface-subtle border-l-2 p-3"
            :style="{ borderLeftColor: toneColor(item.tone) }"
          >
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <p class="text-sm font-semibold" style="color: var(--app-text)">{{ item.headline }}</p>
              <span class="app-chip shrink-0">
                Season {{ item.season }}<template v-if="item.round"> · R{{ item.round }}</template>
              </span>
            </div>
            <p v-if="item.body" class="app-muted-text mt-1 text-xs">{{ item.body }}</p>
          </li>
        </ul>
      </UCard>

      <!-- What you leave behind -->
      <UCard v-if="ownSeasons.length" class="app-surface">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-scroll-text" class="size-4" style="color: var(--app-gold)" />
            Your record
          </div>
        </template>

        <ul class="space-y-1.5">
          <li
            v-for="row in ownSeasons"
            :key="row.season"
            class="flex items-center gap-2 text-sm"
          >
            <span class="app-chip shrink-0">Season {{ row.season }}</span>
            <span class="min-w-0 flex-1 truncate" style="color: var(--app-text-soft)">
              {{ row.leagueName }}
            </span>
            <span
              class="shrink-0 font-bold tabular-nums"
              :style="{ color: row.wonByPlayer ? 'var(--app-gold)' : 'var(--app-text)' }"
            >
              {{ ordinal(row.playerPosition!) }}
            </span>
            <span class="app-muted-text shrink-0 text-xs">{{ row.playerPoints }} pts</span>
          </li>
        </ul>
      </UCard>
    </template>
  </div>
</template>
