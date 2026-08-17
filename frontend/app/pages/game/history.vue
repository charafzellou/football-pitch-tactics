<script setup lang="ts">
/**
 * Past seasons.
 *
 * Standings are computed on the fly from `matches`, so they vanish the moment
 * the next season's fixtures are inserted. `season_summary` is what survives a
 * rollover, and this is where it surfaces.
 */
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

const { data: history, status } = useAsyncData(
  'season-history',
  () => $fetch<HistoryRow[]>('/api/season/history'),
  { default: () => [] as HistoryRow[] },
)

const titlesWon = computed(() => history.value.filter(row => row.wonByPlayer).length)

const seasons = computed(() => {
  const grouped = new Map<number, HistoryRow[]>()
  for (const row of history.value) {
    if (!grouped.has(row.season)) grouped.set(row.season, [])
    grouped.get(row.season)!.push(row)
  }
  return [...grouped.entries()].sort((a, b) => b[0] - a[0])
})

function ordinal(position: number) {
  return position === 1 ? '1st' : position === 2 ? '2nd' : position === 3 ? '3rd' : `${position}th`
}
</script>

<template>
  <div class="space-y-4 sm:space-y-5">
    <div class="flex flex-wrap items-center gap-3">
      <UIcon name="i-lucide-scroll-text" class="size-6" style="color: var(--app-gold)" />
      <h1 class="app-page-title">Club History</h1>
      <span v-if="titlesWon" class="app-chip app-chip--gold ml-auto">
        <UIcon name="i-lucide-trophy" class="size-3" />
        {{ titlesWon }} title{{ titlesWon === 1 ? '' : 's' }} won
      </span>
    </div>

    <AppSkeleton v-if="status === 'pending'" variant="list" :rows="3" />

    <AppEmptyState
      v-else-if="!seasons.length"
      icon="i-lucide-hourglass"
      title="No completed seasons yet"
      description="Finish a season and its champions will be recorded here."
    />

    <div v-else class="space-y-4">
      <section v-for="[season, rows] in seasons" :key="season" class="space-y-2.5">
        <div class="flex items-center gap-3">
          <h2 class="app-kicker">Season {{ season }}</h2>
          <span class="app-divider flex-1" />
        </div>

        <div class="grid gap-3 sm:grid-cols-2">
          <div
            v-for="row in rows"
            :key="row.leagueName"
            class="app-surface-subtle animate-fade-in-up p-4"
            :class="row.wonByPlayer && 'app-glow'"
            :style="row.wonByPlayer ? '--glow: var(--app-gold)' : undefined"
          >
            <p class="app-kicker text-[10px]">{{ row.leagueName }}</p>

            <p class="mt-1 flex items-center gap-2 text-lg font-bold">
              <UIcon name="i-lucide-trophy" class="size-4 shrink-0" style="color: var(--app-gold)" />
              <span :class="row.wonByPlayer ? 'app-gold-text' : ''" :style="!row.wonByPlayer ? 'color: var(--app-text)' : undefined">
                {{ row.champion }}
              </span>
            </p>
            <p class="app-muted-text text-xs">{{ row.championPoints }} points</p>

            <p v-if="row.isPlayerLeague && row.playerPosition" class="mt-2.5 text-sm">
              <span class="app-muted-text">You finished </span>
              <strong :style="{ color: row.playerPosition <= 4 ? 'var(--app-accent)' : 'var(--app-text)' }">
                {{ ordinal(row.playerPosition) }}
              </strong>
              <span class="app-muted-text"> on {{ row.playerPoints }} points</span>
            </p>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
