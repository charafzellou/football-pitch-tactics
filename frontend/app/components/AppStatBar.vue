<script setup lang="ts">
/**
 * A labelled progress bar for skill, stamina and any other 0–100 attribute.
 *
 * The track/fill markup was hand-repeated in five files, each with slightly
 * different threshold rules. Thresholds now come from `staminaTone()`.
 */
import { computed } from 'vue'
import { staminaTone } from '~/utils/format'

const props = withDefaults(defineProps<{
  value: number
  max?: number
  /** Show the numeric value alongside the bar. */
  showValue?: boolean
  /** Append `%` to the shown value. */
  percent?: boolean
  /** Colour by threshold (stamina) rather than always using the accent. */
  threshold?: boolean
  /** Force a tone regardless of value. */
  tone?: 'default' | 'warning' | 'danger' | 'gold'
  size?: 'xs' | 'sm'
  /** Pulse the bar when critically low — used for on-pitch stamina. */
  alertWhenLow?: boolean
}>(), {
  max: 100,
  showValue: false,
  percent: false,
  threshold: false,
  size: 'sm',
  alertWhenLow: false,
})

const rounded = computed(() => Math.round(props.value ?? 0))
const pct = computed(() => Math.max(0, Math.min(100, ((props.value ?? 0) / props.max) * 100)))

const resolvedTone = computed(() => {
  if (props.tone) return props.tone
  return props.threshold ? staminaTone(rounded.value) : 'default'
})

const fillClass = computed(() => ({
  default: '',
  warning: 'app-stat-bar-fill--warning',
  danger: 'app-stat-bar-fill--danger',
  gold: 'app-stat-bar-fill--gold',
}[resolvedTone.value]))

const isCritical = computed(() => props.alertWhenLow && rounded.value < 30)
</script>

<template>
  <div class="flex items-center gap-2">
    <span
      v-if="showValue"
      class="shrink-0 text-xs font-semibold tabular-nums"
      :class="[
        size === 'xs' ? 'w-7' : 'w-9',
        resolvedTone === 'danger' && 'text-red-400',
        resolvedTone === 'warning' && 'text-amber-400',
      ]"
    >{{ rounded }}<template v-if="percent">%</template></span>

    <div
      class="app-stat-bar-track min-w-10 flex-1"
      :class="size === 'xs' && 'h-1'"
      role="progressbar"
      :aria-valuenow="rounded"
      :aria-valuemin="0"
      :aria-valuemax="max"
    >
      <div
        class="app-stat-bar-fill"
        :class="[fillClass, isCritical && 'animate-glow-pulse']"
        :style="{ width: `${pct}%` }"
      />
    </div>
  </div>
</template>
