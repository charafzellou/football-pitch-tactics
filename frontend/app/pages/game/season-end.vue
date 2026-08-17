<script setup lang="ts">
/**
 * End of season.
 *
 * The moment the game previously did not have at all — fixtures simply ran out
 * and the dashboard went quiet. Shows where the season finished, then rolls the
 * world forward: ageing, development, retirements and youth intake.
 */
import { computed, ref } from 'vue'
import { useSettingsStore } from '~/stores/settings'

interface SquadChange {
  playerId: number
  name: string
  teamId: number
  teamName: string
  position: string
  age: number
  skillBefore: number
  skillAfter: number
}

interface YouthArrival {
  name: string
  teamName: string
  teamId: number
  position: string
  age: number
  skillLevel: number
  potential: number
}

interface RolloverSummary {
  previousSeason: number
  newSeason: number
  champions: { leagueName: string; teamName: string; points: number }[]
  playerFinish: { leagueName: string; position: number; points: number } | null
  retirementCount: number
  youthCount: number
  ownRetirements: SquadChange[]
  ownYouth: YouthArrival[]
  retirements: SquadChange[]
  youthIntake: YouthArrival[]
  risers: SquadChange[]
  fallers: SquadChange[]
}

const router = useRouter()
const toast = useAppToast()
const sfx = useSfx()
const settings = useSettingsStore()
const { team, refreshAll } = useGameContext()

const { data: status, refresh: refreshStatus } = useAsyncData(
  'season-end-status',
  () => $fetch<any>('/api/season/status'),
)

const rolling = ref(false)
const summary = ref<RolloverSummary | null>(null)

const isChampion = computed(() => {
  // After a rollover the summary is authoritative; before one, fall back to the
  // live table.
  if (summary.value)
    return summary.value.playerFinish?.position === 1

  return Boolean(status.value?.complete && status.value?.playerPosition === 1)
})

async function confirmRollover() {
  rolling.value = true

  try {
    summary.value = await $fetch<RolloverSummary>('/api/season/rollover', { method: 'POST' })
    await Promise.all([refreshAll(), refreshStatus()])

    sfx.play('success')
    if (summary.value.playerFinish?.position === 1 && settings.motion === 'full')
      void celebrate()
  }
  catch (error) {
    toast.fromRequestError(error, 'Could not end the season')
  }
  finally {
    rolling.value = false
  }
}

async function celebrate() {
  try {
    const { default: confetti } = await import('canvas-confetti')
    const styles = getComputedStyle(document.documentElement)
    const colors = ['--app-gold', '--app-accent', '--color-brand-200']
      .map(token => styles.getPropertyValue(token).trim())
      .filter(Boolean)

    for (const origin of [{ x: 0.2, y: 0.6 }, { x: 0.8, y: 0.6 }]) {
      void confetti({
        particleCount: 90,
        spread: 80,
        startVelocity: 45,
        origin,
        colors,
        zIndex: 60,
        disableForReducedMotion: true,
      })
    }
  }
  catch {
    // A celebration must never break a completed rollover.
  }
}

function swing(change: SquadChange) {
  return change.skillAfter - change.skillBefore
}
</script>

<template>
  <div class="space-y-4 sm:space-y-5">
    <div class="flex items-center gap-2">
      <UIcon name="i-lucide-trophy" class="size-6" style="color: var(--app-gold)" />
      <h1 class="app-page-title">End of Season</h1>
    </div>

    <AppSkeleton v-if="!status" variant="card" />

    <!-- Season still running -->
    <AppEmptyState
      v-else-if="!status.complete"
      icon="i-lucide-calendar-clock"
      title="The season isn't over yet"
      :description="`${status.fixturesRemaining} fixture${status.fixturesRemaining === 1 ? '' : 's'} still to play — ${status.playerFixturesRemaining} of them yours.`"
      action-label="Back to dashboard"
      action-icon="i-lucide-arrow-left"
      @action="router.push('/game')"
    />

    <!-- Season finished, not yet rolled over -->
    <template v-else-if="!summary">
      <div class="app-elevated animate-rise overflow-hidden p-6 text-center sm:p-10">
        <UIcon
          name="i-lucide-trophy"
          class="mx-auto mb-4 size-14"
          :class="isChampion && 'animate-glow-pulse'"
          :style="{ color: isChampion ? 'var(--app-gold)' : 'var(--app-text-muted)' }"
        />

        <p class="app-kicker mb-2">Season {{ status.season }} complete</p>

        <h2 v-if="isChampion" class="app-gold-text text-4xl font-black tracking-tight sm:text-5xl">
          Champions!
        </h2>
        <h2 v-else class="app-gradient-text text-3xl font-black tracking-tight sm:text-4xl">
          {{ status.playerPosition ? `Finished ${status.playerPosition}${status.playerPosition === 1 ? 'st' : status.playerPosition === 2 ? 'nd' : status.playerPosition === 3 ? 'rd' : 'th'}` : 'Season complete' }}
        </h2>

        <p v-if="team" class="app-muted-text mt-3">
          {{ team.name }} · {{ status.playerPoints ?? 0 }} points
          <template v-if="status.leader && !isChampion">
            · {{ status.pointsBehindLeader }} behind {{ status.leader.teamName }}
          </template>
        </p>

        <div class="mt-8">
          <UButton
            label="Start the next season"
            icon="i-lucide-calendar-plus"
            size="xl"
            class="app-glow"
            :loading="rolling"
            @click="confirmRollover"
          />
          <p class="app-muted-text mt-3 text-xs">
            Players will age a year, some will retire, and youth will come through.
          </p>
        </div>
      </div>
    </template>

    <!-- Rollover complete -->
    <template v-else>
      <div class="app-elevated animate-rise p-6 text-center sm:p-8">
        <p class="app-kicker mb-2">Season {{ summary.previousSeason }} final standings</p>

        <div class="flex flex-wrap justify-center gap-3">
          <div
            v-for="champion in summary.champions"
            :key="champion.leagueName"
            class="app-glass px-4 py-3 text-left"
          >
            <p class="app-kicker text-[10px]">{{ champion.leagueName }}</p>
            <p class="flex items-center gap-1.5 font-bold" style="color: var(--app-gold)">
              <UIcon name="i-lucide-trophy" class="size-3.5" />
              {{ champion.teamName }}
            </p>
            <p class="app-muted-text text-xs">{{ champion.points }} points</p>
          </div>
        </div>

        <p v-if="summary.playerFinish" class="app-muted-text mt-4 text-sm">
          You finished
          <strong style="color: var(--app-text)">{{ summary.playerFinish.position }}</strong>
          in the {{ summary.playerFinish.leagueName }} on {{ summary.playerFinish.points }} points.
        </p>
      </div>

      <!-- What changed -->
      <div class="grid gap-4 lg:grid-cols-2">
        <UCard class="app-surface">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-door-open" class="size-4" style="color: var(--app-player-sent-off)" />
              Retirements
              <span class="app-chip ml-auto">{{ summary.retirementCount }} across the leagues</span>
            </div>
          </template>

          <div v-if="summary.ownRetirements.length" class="mb-4">
            <p class="app-kicker mb-2 text-[10px]">Left your club</p>
            <ul class="space-y-1.5">
              <li
                v-for="player in summary.ownRetirements"
                :key="player.playerId"
                class="flex items-center gap-2 rounded-xl p-2"
                style="background-color: var(--app-surface-muted)"
              >
                <AppPositionBadge :position="player.position" size="xs" />
                <span class="min-w-0 flex-1 truncate text-sm font-semibold" style="color: var(--app-text)">
                  {{ player.name }}
                </span>
                <span class="app-muted-text text-xs">{{ player.age }}y · {{ player.skillBefore }} OVR</span>
              </li>
            </ul>
          </div>

          <p class="app-kicker mb-2 text-[10px]">Notable elsewhere</p>
          <ul class="space-y-1">
            <li
              v-for="player in summary.retirements"
              :key="player.playerId"
              class="flex items-center gap-2 text-sm"
            >
              <AppPositionBadge :position="player.position" size="xs" muted />
              <span class="min-w-0 flex-1 truncate" style="color: var(--app-text-soft)">{{ player.name }}</span>
              <span class="app-muted-text shrink-0 text-xs">{{ player.teamName }} · {{ player.age }}y</span>
            </li>
          </ul>
        </UCard>

        <UCard class="app-surface">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-sprout" class="size-4" style="color: var(--app-accent)" />
              Youth intake
              <span class="app-chip ml-auto">{{ summary.youthCount }} promoted</span>
            </div>
          </template>

          <div v-if="summary.ownYouth.length" class="mb-4">
            <p class="app-kicker mb-2 text-[10px]">Joined your club</p>
            <ul class="space-y-1.5">
              <li
                v-for="player in summary.ownYouth"
                :key="player.name"
                class="flex items-center gap-2 rounded-xl p-2"
                style="background-color: var(--app-surface-muted)"
              >
                <AppPositionBadge :position="player.position" size="xs" />
                <span class="min-w-0 flex-1 truncate text-sm font-semibold" style="color: var(--app-text)">
                  {{ player.name }}
                </span>
                <span class="app-muted-text text-xs">
                  {{ player.age }}y · {{ player.skillLevel }}
                  <span style="color: var(--app-accent)">→ {{ player.potential }}</span>
                </span>
              </li>
            </ul>
          </div>

          <p class="app-kicker mb-2 text-[10px]">Brightest prospects elsewhere</p>
          <ul class="space-y-1">
            <li v-for="player in summary.youthIntake" :key="player.name" class="flex items-center gap-2 text-sm">
              <AppPositionBadge :position="player.position" size="xs" muted />
              <span class="min-w-0 flex-1 truncate" style="color: var(--app-text-soft)">{{ player.name }}</span>
              <span class="app-muted-text shrink-0 text-xs">
                {{ player.teamName }} · ceiling {{ player.potential }}
              </span>
            </li>
          </ul>
        </UCard>

        <UCard class="app-surface">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-trending-up" class="size-4" style="color: var(--app-accent)" />
              Biggest improvers
            </div>
          </template>
          <ul class="space-y-1.5">
            <li v-for="player in summary.risers" :key="player.playerId" class="flex items-center gap-2 text-sm">
              <AppPositionBadge :position="player.position" size="xs" />
              <span class="min-w-0 flex-1 truncate" style="color: var(--app-text-soft)">{{ player.name }}</span>
              <span class="app-muted-text shrink-0 text-xs">{{ player.age }}y</span>
              <span class="app-chip app-chip--success shrink-0 tabular-nums">
                {{ player.skillBefore }} → {{ player.skillAfter }} (+{{ swing(player) }})
              </span>
            </li>
          </ul>
        </UCard>

        <UCard class="app-surface">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-trending-down" class="size-4" style="color: var(--app-player-sent-off)" />
              Sharpest decline
            </div>
          </template>
          <ul class="space-y-1.5">
            <li v-for="player in summary.fallers" :key="player.playerId" class="flex items-center gap-2 text-sm">
              <AppPositionBadge :position="player.position" size="xs" />
              <span class="min-w-0 flex-1 truncate" style="color: var(--app-text-soft)">{{ player.name }}</span>
              <span class="app-muted-text shrink-0 text-xs">{{ player.age }}y</span>
              <span class="app-chip app-chip--danger shrink-0 tabular-nums">
                {{ player.skillBefore }} → {{ player.skillAfter }} ({{ swing(player) }})
              </span>
            </li>
          </ul>
        </UCard>
      </div>

      <div class="flex justify-center pt-2">
        <UButton
          :label="`Begin season ${summary.newSeason}`"
          icon="i-lucide-arrow-right"
          size="lg"
          class="app-glow"
          @click="() => { router.push('/game') }"
        />
      </div>
    </template>
  </div>
</template>
