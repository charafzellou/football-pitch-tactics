<script setup lang="ts">
/**
 * Opposing-bar match statistics, derived client-side from the revealed events
 * (see `useMatchStats`). No new endpoint — the engine already records every
 * shot, cross, corner and foul.
 */
import { computed } from 'vue'
import type { StatRow } from '~/composables/useMatchStats'

const props = defineProps<{
  rows: StatRow[]
  territory: number
  momentum: number[]
  homeName: string
  awayName: string
}>()

const HOME = 'var(--app-accent)'
const AWAY = 'var(--app-pos-gk)'

/** Normalised sparkline points for the momentum series. */
const momentumPath = computed(() => {
  const series = props.momentum
  if (series.length < 2) return null

  const peak = Math.max(4, ...series.map(Math.abs))
  const step = 100 / (series.length - 1)

  return series
    .map((value, i) => `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(2)} ${(20 - (value / peak) * 18).toFixed(2)}`)
    .join(' ')
})
</script>

<template>
  <UCard class="app-surface">
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-chart-no-axes-column" class="size-4 shrink-0" style="color: var(--app-accent)" />
        <span>Match Stats</span>
      </div>
    </template>

    <div class="space-y-4">
      <!-- Territory -->
      <div>
        <div class="mb-1.5 flex items-center justify-between text-xs">
          <span class="font-bold tabular-nums" :style="{ color: HOME }">{{ territory }}%</span>
          <UTooltip text="Share of attacking events — the engine models no true possession">
            <span class="app-kicker text-[10px]">Territory</span>
          </UTooltip>
          <span class="font-bold tabular-nums" :style="{ color: AWAY }">{{ 100 - territory }}%</span>
        </div>
        <div class="flex h-2 overflow-hidden rounded-full" style="background-color: var(--app-surface-muted)">
          <div
            class="transition-all duration-700 ease-out"
            :style="{ width: `${territory}%`, backgroundColor: HOME }"
          />
          <div class="flex-1 transition-all duration-700 ease-out" :style="{ backgroundColor: AWAY }" />
        </div>
      </div>

      <!-- Momentum -->
      <div v-if="momentumPath">
        <p class="app-kicker mb-1 text-[10px]">Momentum</p>
        <svg viewBox="0 0 100 40" preserveAspectRatio="none" class="h-10 w-full" aria-hidden="true">
          <line x1="0" y1="20" x2="100" y2="20" stroke="var(--app-surface-border-strong)" stroke-width="0.4" />
          <path
            :d="momentumPath"
            fill="none"
            :stroke="HOME"
            stroke-width="1.4"
            stroke-linecap="round"
            stroke-linejoin="round"
            vector-effect="non-scaling-stroke"
          />
        </svg>
        <div class="flex justify-between text-[9px]" style="color: var(--app-text-muted)">
          <span>{{ homeName }} on top</span>
          <span>{{ awayName }} on top</span>
        </div>
      </div>

      <!-- Stat rows -->
      <div v-if="rows.length" class="space-y-2.5">
        <div v-for="row in rows" :key="row.label">
          <div class="mb-1 flex items-center justify-between text-xs">
            <span class="w-6 text-left font-bold tabular-nums" style="color: var(--app-text)">{{ row.home }}</span>
            <span class="app-muted-text">{{ row.label }}</span>
            <span class="w-6 text-right font-bold tabular-nums" style="color: var(--app-text)">{{ row.away }}</span>
          </div>
          <div class="flex h-1.5 gap-0.5">
            <div class="flex flex-1 justify-end overflow-hidden rounded-l-full" style="background-color: var(--app-surface-muted)">
              <div
                class="h-full rounded-l-full transition-all duration-700 ease-out"
                :style="{ width: `${row.homeShare}%`, backgroundColor: HOME }"
              />
            </div>
            <div class="flex flex-1 overflow-hidden rounded-r-full" style="background-color: var(--app-surface-muted)">
              <div
                class="h-full rounded-r-full transition-all duration-700 ease-out"
                :style="{ width: `${100 - row.homeShare}%`, backgroundColor: AWAY }"
              />
            </div>
          </div>
        </div>
      </div>

      <AppEmptyState
        v-else
        compact
        icon="i-lucide-chart-no-axes-column"
        title="No statistics yet"
        description="They build up as the match is played."
      />
    </div>
  </UCard>
</template>
