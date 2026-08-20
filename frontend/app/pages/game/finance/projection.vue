<script setup lang="ts">
/**
 * Four seasons ahead, and what they say the club can afford.
 *
 * The chart earns its place by showing the *band*: a single line implies a
 * precision the forecast does not have, and the distance between finishing
 * fourth and finishing twelfth is most of what a chairman needs to know.
 *
 * Nothing on this page blocks anything. The budgets are advice — the manager is
 * free to ignore every one of them, and only an actually negative balance has
 * consequences.
 */
import { computed, ref } from 'vue'
import { formatDelta, formatMoney, formatMoneyCompact } from '~/utils/format'
import { affordableFee, streamMeta } from '#shared/finance'

const { projection: data, status } = useFinanceProjection()

const { finance } = useFinanceSummary()

/** Wage the manager is imagining paying a target, for the affordability read. */
const draftWage = ref(0)

const affordable = computed(() => {
  const budget = data.value?.transferBudget
  if (!budget) return 0
  return affordableFee(budget.safeSpend, budget.roundsRemaining, draftWage.value)
})

const wageSliderMax = computed(() => Math.max(20_000, Math.round((data.value?.wageBudget.ceiling ?? 0) / 3)))

// ---------------------------------------------------------------------------
// Chart
// ---------------------------------------------------------------------------

const WIDTH = 320
const HEIGHT = 130
const PAD_Y = 8

interface ChartPoint { label: string; value: number; best: number; worst: number }

const points = computed<ChartPoint[]>(() => {
  const seasons = data.value?.projection ?? []
  if (!seasons.length) return []

  const opening = seasons[0]!.openingBalance
  return [
    { label: 'Now', value: opening, best: opening, worst: opening },
    ...seasons.map(row => ({
      label: `S${row.season}`,
      value: row.closingBalance,
      best: row.bestClosing,
      worst: row.worstClosing,
    })),
  ]
})

const bounds = computed(() => {
  const values = points.value.flatMap(point => [point.best, point.worst, point.value])
  if (!values.length) return { min: 0, max: 1 }

  // Always show the zero line: whether the club goes broke is the question.
  const min = Math.min(0, ...values)
  const max = Math.max(0, ...values)
  return { min, max: max === min ? min + 1 : max }
})

function x(index: number): number {
  const count = Math.max(1, points.value.length - 1)
  return (index / count) * WIDTH
}

function y(value: number): number {
  const { min, max } = bounds.value
  const usable = HEIGHT - PAD_Y * 2
  return PAD_Y + usable - ((value - min) / (max - min)) * usable
}

const centralPath = computed(() =>
  points.value.map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)} ${y(point.value).toFixed(1)}`).join(' '))

/** Best along the top, worst back along the bottom — one closed shape. */
const bandPath = computed(() => {
  const rows = points.value
  if (!rows.length) return ''

  const top = rows.map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)} ${y(point.best).toFixed(1)}`).join(' ')
  const bottom = [...rows].reverse()
    .map((point, index) => `L${x(rows.length - 1 - index).toFixed(1)} ${y(point.worst).toFixed(1)}`).join(' ')

  return `${top} ${bottom} Z`
})

const zeroY = computed(() => y(0))
const crossesZero = computed(() => bounds.value.min < 0)

function streamRows(record: Record<string, number>) {
  return Object.entries(record)
    .map(([type, amount]) => ({ type, amount, label: streamMeta(type).label, icon: streamMeta(type).icon }))
    .sort((a, b) => b.amount - a.amount)
}
</script>

<template>
  <div class="space-y-4 sm:space-y-5">
    <div class="flex items-center gap-2">
      <UIcon name="i-lucide-chart-no-axes-combined" class="size-6" style="color: var(--app-accent)" />
      <h1 class="app-page-title">Projection</h1>
      <span v-if="data" class="app-chip ml-auto">
        Assuming a {{ data.expectedPosition }}{{ data.expectedPosition === 1 ? 'st' : data.expectedPosition === 2 ? 'nd' : data.expectedPosition === 3 ? 'rd' : 'th' }} place finish
      </span>
    </div>

    <FinanceNav />

    <AppSkeleton v-if="status === 'pending' || !data" variant="card" />

    <template v-else>
      <!-- The forecast -->
      <UCard class="app-surface">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-trending-up" class="size-4" style="color: var(--app-accent)" />
            Bank balance, four seasons out
          </div>
        </template>

        <svg
          :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
          preserveAspectRatio="none"
          class="h-40 w-full sm:h-52"
          role="img"
          aria-label="Projected bank balance over the next four seasons, with a band for the plausible range of league finishes"
        >
          <path :d="bandPath" fill="var(--app-accent-soft)" opacity="0.55" />
          <line
            v-if="crossesZero"
            x1="0" :y1="zeroY" :x2="WIDTH" :y2="zeroY"
            stroke="var(--app-player-sent-off)"
            stroke-width="0.6"
            stroke-dasharray="3 3"
            vector-effect="non-scaling-stroke"
          />
          <path
            :d="centralPath"
            fill="none"
            stroke="var(--app-accent)"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            vector-effect="non-scaling-stroke"
          />
          <circle
            v-for="(point, index) in points"
            :key="point.label"
            :cx="x(index)"
            :cy="y(point.value)"
            r="2.2"
            fill="var(--app-accent)"
            vector-effect="non-scaling-stroke"
          />
        </svg>

        <div class="mt-1 flex justify-between">
          <span
            v-for="point in points"
            :key="point.label"
            class="app-kicker text-[10px]"
          >{{ point.label }}</span>
        </div>

        <p class="app-muted-text mt-3 text-[11px]">
          The shaded band is the difference between finishing near the top of your
          plausible range and near the bottom. It compounds — three good seasons
          land a long way from three bad ones.
        </p>
      </UCard>

      <!-- Budget advice -->
      <div class="grid gap-4 lg:grid-cols-2">
        <UCard class="app-surface">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-users" class="size-4" style="color: var(--app-accent)" />
              Wage budget
            </div>
          </template>

          <div class="space-y-3">
            <div class="grid grid-cols-2 gap-3">
              <div class="app-metric-card">
                <p class="app-kicker text-[10px]">Currently paying</p>
                <p class="app-hero-number mt-1 text-xl">{{ formatMoneyCompact(data.wageBudget.current) }}</p>
                <p class="app-muted-text text-[11px]">per matchday</p>
              </div>
              <div class="app-metric-card">
                <p class="app-kicker text-[10px]">Headroom</p>
                <p
                  class="app-hero-number mt-1 text-xl"
                  :style="{ color: data.wageBudget.headroom < 0 ? 'var(--app-player-sent-off)' : 'var(--app-accent)' }"
                >{{ formatDelta(data.wageBudget.headroom, true) }}</p>
                <p class="app-muted-text text-[11px]">against a healthy bill</p>
              </div>
            </div>

            <div>
              <div class="mb-1 flex items-center justify-between text-xs">
                <span class="app-muted-text">Share of projected turnover</span>
                <span
                  class="font-bold tabular-nums"
                  :style="{ color: data.wageBudget.ratio > 75 ? 'var(--app-player-sent-off)' : data.wageBudget.ratio > 60 ? 'var(--app-player-booked)' : 'var(--app-accent)' }"
                >{{ data.wageBudget.ratio }}%</span>
              </div>
              <AppStatBar
                :value="Math.min(100, data.wageBudget.ratio)"
                :tone="data.wageBudget.ratio > 75 ? 'danger' : data.wageBudget.ratio > 60 ? 'warning' : 'default'"
              />
            </div>

            <dl class="space-y-1.5 text-[11px]">
              <div class="flex justify-between">
                <dt class="app-muted-text">Healthy bill (60% of turnover)</dt>
                <dd class="font-bold tabular-nums" style="color: var(--app-text)">
                  {{ formatMoney(data.wageBudget.healthy) }}/md
                </dd>
              </div>
              <div class="flex justify-between">
                <dt class="app-muted-text">Ceiling before the board objects</dt>
                <dd class="font-bold tabular-nums" style="color: var(--app-text)">
                  {{ formatMoney(data.wageBudget.ceiling) }}/md
                </dd>
              </div>
            </dl>

            <p class="app-muted-text text-[11px]">
              Advice, not a limit. Nothing here stops you signing anyone — only an
              overdrawn account does that.
            </p>
          </div>
        </UCard>

        <UCard class="app-surface">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-arrow-left-right" class="size-4" style="color: var(--app-accent)" />
              Transfer budget
            </div>
          </template>

          <div class="space-y-3">
            <div class="app-elevated p-4">
              <p class="app-kicker text-[10px]">Safe to spend on fees</p>
              <p class="app-hero-number mt-1 text-3xl" style="color: var(--app-accent)">
                {{ formatMoneyCompact(affordable) }}
              </p>
              <p class="app-muted-text mt-1 text-[11px]">
                <template v-if="draftWage > 0">
                  if he earns {{ formatMoney(draftWage) }} a matchday for the remaining
                  {{ data.transferBudget.roundsRemaining }} rounds
                </template>
                <template v-else>
                  before allowing for his wages
                </template>
              </p>
            </div>

            <div>
              <label class="app-kicker mb-2 block text-[10px]">
                His wage — {{ formatMoney(draftWage) }} per matchday
              </label>
              <USlider v-model="draftWage" :min="0" :max="wageSliderMax" :step="1000" />
            </div>

            <dl class="space-y-1.5 text-[11px]">
              <div class="flex justify-between">
                <dt class="app-muted-text">Projected balance at season end</dt>
                <dd
                  class="font-bold tabular-nums"
                  :style="{ color: data.transferBudget.projectedClosing < 0 ? 'var(--app-player-sent-off)' : 'var(--app-text)' }"
                >{{ formatMoney(data.transferBudget.projectedClosing) }}</dd>
              </div>
              <div class="flex justify-between">
                <dt class="app-muted-text">Cushion held back</dt>
                <dd class="font-bold tabular-nums" style="color: var(--app-text)">
                  {{ formatMoney(data.transferBudget.buffer) }}
                </dd>
              </div>
              <div v-if="finance" class="flex justify-between">
                <dt class="app-muted-text">In the bank right now</dt>
                <dd class="font-bold tabular-nums" style="color: var(--app-text)">
                  {{ formatMoney(finance.club.balance) }}
                </dd>
              </div>
            </dl>
          </div>
        </UCard>
      </div>

      <!-- Season by season -->
      <UCard
        v-for="row in data.projection"
        :key="row.season"
        class="app-surface"
      >
        <template #header>
          <div class="flex flex-wrap items-center gap-2">
            <UIcon name="i-lucide-calendar" class="size-4" style="color: var(--app-accent)" />
            Season {{ row.season }}
            <span v-if="row.partial" class="app-chip">{{ row.rounds }} matchdays left</span>
            <span
              class="app-chip ml-auto"
              :class="row.net < 0 ? 'app-chip--danger' : 'app-chip--success'"
            >{{ formatDelta(row.net, true) }}</span>
          </div>
        </template>

        <div class="space-y-3">
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div class="app-metric-card">
              <p class="app-kicker text-[10px]">Income</p>
              <p class="app-hero-number mt-1 text-lg" style="color: var(--app-accent)">
                {{ formatMoneyCompact(row.totalIncome) }}
              </p>
            </div>
            <div class="app-metric-card">
              <p class="app-kicker text-[10px]">Costs</p>
              <p class="app-hero-number mt-1 text-lg" style="color: var(--app-player-sent-off)">
                {{ formatMoneyCompact(row.totalCosts) }}
              </p>
            </div>
            <div class="app-metric-card">
              <p class="app-kicker text-[10px]">Closing balance</p>
              <p
                class="app-hero-number mt-1 text-lg"
                :style="{ color: row.closingBalance < 0 ? 'var(--app-player-sent-off)' : 'var(--app-text)' }"
              >{{ formatMoneyCompact(row.closingBalance) }}</p>
            </div>
            <div class="app-metric-card">
              <p class="app-kicker text-[10px]">Wages</p>
              <p class="app-hero-number mt-1 text-lg">{{ row.wageRatio }}%</p>
              <p class="app-muted-text text-[11px]">of turnover</p>
            </div>
          </div>

          <div v-if="row.flags.length" class="space-y-1.5">
            <p
              v-for="flag in row.flags"
              :key="flag.kind + flag.message"
              class="flex items-start gap-1.5 text-[11px]"
              :style="{ color: flag.severity === 'danger' ? 'var(--app-player-sent-off)' : 'var(--app-player-booked)' }"
            >
              <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-3 shrink-0" />
              {{ flag.message }}
            </p>
          </div>

          <div class="app-divider" />

          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <p class="app-kicker mb-2 text-[10px]">Income</p>
              <ul class="space-y-1">
                <li
                  v-for="entry in streamRows(row.income)"
                  :key="entry.type"
                  class="flex items-center justify-between text-xs"
                >
                  <span class="app-muted-text flex items-center gap-1.5">
                    <UIcon :name="entry.icon" class="size-3" />
                    {{ entry.label }}
                  </span>
                  <span class="font-bold tabular-nums" style="color: var(--app-accent)">
                    {{ formatMoneyCompact(entry.amount) }}
                  </span>
                </li>
              </ul>
            </div>
            <div>
              <p class="app-kicker mb-2 text-[10px]">Costs</p>
              <ul class="space-y-1">
                <li
                  v-for="entry in streamRows(row.costs)"
                  :key="entry.type"
                  class="flex items-center justify-between text-xs"
                >
                  <span class="app-muted-text flex items-center gap-1.5">
                    <UIcon :name="entry.icon" class="size-3" />
                    {{ entry.label }}
                  </span>
                  <span class="font-bold tabular-nums" style="color: var(--app-player-sent-off)">
                    {{ formatMoneyCompact(entry.amount) }}
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </UCard>
    </template>
  </div>
</template>
