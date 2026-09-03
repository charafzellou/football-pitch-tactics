<script setup lang="ts">
/**
 * League table.
 *
 * The player's own row is highlighted and sticky — previously it was
 * indistinguishable from the other nineteen. Zones are banded (title, Europe,
 * relegation) with a legend, and each club carries its recent form.
 */
import { computed, ref } from 'vue'
import type { FormResult } from '~/utils/results'

interface StandingRow {
  teamId: number
  teamName: string
  played: number
  wins: number
  draws: number
  losses: number
  goalsFor: number
  goalsAgainst: number
  goalDifference: number
  points: number
  form: FormResult[]
}

const { team } = useGameContext()

const standings = ref<StandingRow[]>([])
const loading = ref(true)

watch(() => team.value?.leagueId, async (leagueId) => {
  if (!leagueId) return
  loading.value = true
  try {
    standings.value = await $fetch<StandingRow[]>(`/api/standings?leagueId=${leagueId}`)
  }
  catch {
    standings.value = []
  }
  finally {
    loading.value = false
  }
}, { immediate: true })

const leader = computed(() => standings.value[0]?.points ?? 0)

/**
 * Zone banding. The seeded leagues are 20 clubs, so the usual shape applies:
 * champion, Champions League places, then the bottom three going down.
 */
function zoneOf(rank: number, total: number): 'title' | 'europe' | 'relegation' | null {
  if (rank === 1) return 'title'
  if (rank <= 4) return 'europe'
  if (rank > total - 3) return 'relegation'
  return null
}

const ZONE_CLASS: Record<string, string> = {
  title: 'app-zone-promo',
  europe: 'app-zone-europe',
  relegation: 'app-zone-relegation',
}

const rows = computed(() =>
  standings.value.map((row, index) => {
    const rank = index + 1

    return {
      ...row,
      rank,
      zone: zoneOf(rank, standings.value.length),
      isOwn: row.teamName === team.value?.name,
      behind: leader.value - row.points,
    }
  }),
)

const ownRank = computed(() => rows.value.find(r => r.isOwn)?.rank ?? null)

const medalColor: Record<number, string> = {
  1: 'var(--app-gold)',
  2: '#cbd5e1',
  3: '#b45309',
}
</script>

<template>
  <div class="space-y-4 sm:space-y-5">
    <div class="flex flex-wrap items-center gap-3">
      <UIcon name="i-lucide-trophy" class="size-6" style="color: var(--app-gold)" />
      <h1 class="app-page-title">League Standings</h1>
      <span v-if="ownRank" class="app-chip app-chip--success ml-auto">
        You are {{ ownRank }}{{ ownRank === 1 ? 'st' : ownRank === 2 ? 'nd' : ownRank === 3 ? 'rd' : 'th' }}
      </span>
    </div>

    <!-- Legend -->
    <div class="flex flex-wrap items-center gap-4 text-[11px]" style="color: var(--app-text-muted)">
      <span class="flex items-center gap-1.5">
        <span class="h-3 w-1 rounded-full" style="background-color: var(--color-brand-400)" /> Champion
      </span>
      <span class="flex items-center gap-1.5">
        <span class="h-3 w-1 rounded-full" style="background-color: var(--app-pos-gk)" /> European places
      </span>
      <span class="flex items-center gap-1.5">
        <span class="h-3 w-1 rounded-full" style="background-color: var(--app-player-sent-off)" /> Relegation
      </span>
    </div>

    <AppSkeleton v-if="loading" variant="table" :rows="8" />

    <AppEmptyState
      v-else-if="!rows.length"
      icon="i-lucide-table"
      title="No standings yet"
      description="They appear once matches have been played."
    />

    <div v-else class="app-table-shell">
      <table class="w-full min-w-max border-collapse text-sm">
        <thead>
          <tr style="border-bottom: 1px solid var(--app-surface-border)">
            <th class="app-kicker px-3 py-2.5 text-left text-[10px]">#</th>
            <th class="app-kicker px-3 py-2.5 text-left text-[10px]">Club</th>
            <th class="app-kicker px-2 py-2.5 text-center text-[10px]">P</th>
            <th class="app-kicker px-2 py-2.5 text-center text-[10px]">W</th>
            <th class="app-kicker px-2 py-2.5 text-center text-[10px]">D</th>
            <th class="app-kicker px-2 py-2.5 text-center text-[10px]">L</th>
            <th class="app-kicker px-2 py-2.5 text-center text-[10px]">GF</th>
            <th class="app-kicker px-2 py-2.5 text-center text-[10px]">GA</th>
            <th class="app-kicker px-2 py-2.5 text-center text-[10px]">GD</th>
            <th class="app-kicker px-3 py-2.5 text-center text-[10px]">Pts</th>
            <th class="app-kicker px-3 py-2.5 text-left text-[10px]">Form</th>
            <th class="app-kicker px-3 py-2.5 text-center text-[10px]">Behind</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, index) in rows"
            :key="row.teamName"
            class="animate-fade-in-up transition-colors"
            :class="[row.zone ? ZONE_CLASS[row.zone] : '', row.isOwn && 'app-row-highlight']"
            :style="`animation-delay: ${Math.min(index, 15) * 0.025}s; border-bottom: 1px solid var(--app-surface-border)`"
          >
            <td class="px-3 py-2.5">
              <span class="flex items-center gap-1.5 font-bold tabular-nums">
                <UIcon
                  v-if="row.rank <= 3"
                  name="i-lucide-medal"
                  class="size-3.5"
                  :style="{ color: medalColor[row.rank] }"
                />
                <span :style="row.rank === 1 ? 'color: var(--app-gold)' : 'color: var(--app-text-muted)'">
                  {{ row.rank }}
                </span>
              </span>
            </td>
            <td class="px-3 py-2.5">
              <span
                class="font-semibold"
                :class="row.rank === 1 && 'app-gold-text'"
                :style="row.isOwn ? 'color: var(--app-accent)' : row.rank === 1 ? undefined : 'color: var(--app-text)'"
              >{{ row.teamName }}</span>
              <span v-if="row.isOwn" class="app-selection-pill ml-2">You</span>
            </td>
            <td class="px-2 py-2.5 text-center tabular-nums" style="color: var(--app-text-muted)">{{ row.played }}</td>
            <td class="px-2 py-2.5 text-center tabular-nums" style="color: var(--app-text-soft)">{{ row.wins }}</td>
            <td class="px-2 py-2.5 text-center tabular-nums" style="color: var(--app-text-soft)">{{ row.draws }}</td>
            <td class="px-2 py-2.5 text-center tabular-nums" style="color: var(--app-text-soft)">{{ row.losses }}</td>
            <td class="px-2 py-2.5 text-center tabular-nums" style="color: var(--app-text-muted)">{{ row.goalsFor }}</td>
            <td class="px-2 py-2.5 text-center tabular-nums" style="color: var(--app-text-muted)">{{ row.goalsAgainst }}</td>
            <td
              class="px-2 py-2.5 text-center font-medium tabular-nums"
              :style="{ color: row.goalDifference > 0 ? 'var(--app-accent)' : row.goalDifference < 0 ? 'var(--app-player-sent-off)' : 'var(--app-text-muted)' }"
            >{{ row.goalDifference > 0 ? '+' : '' }}{{ row.goalDifference }}</td>
            <td class="px-3 py-2.5 text-center text-base font-black tabular-nums" style="color: var(--app-text)">
              {{ row.points }}
            </td>
            <td class="px-3 py-2.5">
              <FormGuide :form="row.form" size="xs" empty-label="—" />
            </td>
            <td class="px-3 py-2.5 text-center tabular-nums" style="color: var(--app-text-muted)">
              {{ row.behind === 0 ? '—' : `-${row.behind}` }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
