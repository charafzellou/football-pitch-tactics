<script setup lang="ts">
/**
 * The clock, score and transport controls.
 *
 * The minute sits inside a 90-minute progress ring so elapsed time is legible
 * at a glance, and the score digits pop when they change rather than silently
 * swapping. Playback speed is new: watching 90 real seconds per half with no
 * way to hurry is the single biggest friction in the loop.
 */
import { computed, ref, watch } from 'vue'
import { HALF_TIME_MINUTE, MATCH_MINUTES } from '#shared/match-state'
import { getInitials } from '~/utils/format'

const props = defineProps<{
  currentMinute: number
  homeScore: number
  awayScore: number
  homeName: string
  awayName: string
  playerSide: 'home' | 'away' | null
  hasStarted: boolean
  playing: boolean
  isFinished: boolean
  isHalfTime: boolean
  loading: boolean
  finishFailed: boolean
  injuredPlayerName: string | null
  speed: number
}>()

const emit = defineEmits<{
  start: []
  pause: []
  resume: []
  end: []
  retryFinish: []
  'update:speed': [value: number]
  skipToBreak: []
}>()

const SPEEDS = [1, 2, 4]

const progress = computed(() => Math.min(100, (props.currentMinute / MATCH_MINUTES) * 100))

// Ring geometry — r=54 gives a 339.3 circumference, kept in one place so the
// dash offset and the SVG stay in step.
const RADIUS = 54
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
const dashOffset = computed(() => CIRCUMFERENCE * (1 - progress.value / 100))

/** Ring runs accent, then warms as the match closes out. */
const ringColor = computed(() => {
  if (props.isFinished) return 'var(--app-text-muted)'
  if (props.currentMinute >= 80) return 'var(--app-player-sent-off)'
  if (props.currentMinute >= HALF_TIME_MINUTE) return 'var(--app-player-booked)'
  return 'var(--app-accent)'
})

// Re-key the score spans on change so the pop animation actually restarts.
const homeKey = ref(0)
const awayKey = ref(0)
watch(() => props.homeScore, () => { homeKey.value++ })
watch(() => props.awayScore, () => { awayKey.value++ })

const statusLabel = computed(() => {
  if (props.isFinished) return 'Full time'
  if (props.isHalfTime) return 'Half time'
  if (props.injuredPlayerName) return `${props.injuredPlayerName} injured`
  if (props.playing) return 'Live'
  if (props.hasStarted) return 'Paused'
  return 'Not started'
})

const skipLabel = computed(() =>
  props.currentMinute < HALF_TIME_MINUTE ? 'Skip to half time' : 'Skip to full time',
)
</script>

<template>
  <div class="app-elevated overflow-hidden">
    <!-- Live sheen along the top edge while play is running -->
    <div v-if="playing" class="absolute inset-x-0 top-0 h-px overflow-hidden">
      <div
        class="h-full w-1/3 animate-sweep"
        style="background-image: linear-gradient(90deg, transparent, var(--app-accent), transparent)"
      />
    </div>

    <div class="flex flex-col gap-6 p-5 sm:p-6 lg:flex-row lg:items-center lg:gap-8">
      <!-- Clock ring -->
      <div class="relative mx-auto size-32 shrink-0 lg:mx-0">
        <svg class="size-full -rotate-90" viewBox="0 0 120 120" aria-hidden="true">
          <circle
            cx="60" cy="60" :r="RADIUS" fill="none" stroke-width="6"
            style="stroke: color-mix(in srgb, var(--app-text-muted) 22%, transparent)"
          />
          <circle
            cx="60" cy="60" :r="RADIUS" fill="none" stroke-width="6" stroke-linecap="round"
            :stroke-dasharray="CIRCUMFERENCE"
            :stroke-dashoffset="dashOffset"
            :style="{ stroke: ringColor, transition: 'stroke-dashoffset 0.9s linear, stroke 0.6s ease' }"
          />
        </svg>

        <div class="absolute inset-0 flex flex-col items-center justify-center">
          <p class="app-hero-number text-4xl" aria-live="off">
            {{ currentMinute }}<span class="text-xl" style="color: var(--app-text-muted)">'</span>
          </p>
          <span
            class="mt-0.5 flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest"
            :style="{ color: ringColor }"
          >
            <span
              v-if="playing"
              class="size-1.5 animate-live-ping rounded-full"
              style="background-color: var(--app-player-sent-off)"
            />
            {{ statusLabel }}
          </span>
        </div>
      </div>

      <!-- Scoreline -->
      <div class="min-w-0 flex-1">
        <div class="flex items-center justify-center gap-3 sm:gap-5">
          <!-- Home -->
          <div class="flex min-w-0 flex-1 items-center justify-end gap-2 text-right">
            <div class="min-w-0">
              <p class="truncate text-sm font-bold sm:text-base" style="color: var(--app-text)">{{ homeName }}</p>
              <span class="app-chip mt-0.5" :class="playerSide === 'home' && 'app-chip--success'">
                {{ playerSide === 'home' ? 'Your club' : 'Home' }}
              </span>
            </div>
            <div
              class="flex size-9 shrink-0 items-center justify-center rounded-xl text-xs font-black"
              style="background-color: var(--app-accent-soft); color: var(--app-accent)"
            >{{ getInitials(homeName) }}</div>
          </div>

          <!-- Score -->
          <div class="shrink-0 text-center" aria-live="polite" :aria-label="`${homeScore} ${awayScore}`">
            <p class="app-gradient-text flex items-center gap-1 text-4xl font-black tracking-tight sm:text-5xl">
              <span :key="homeKey" class="inline-block animate-score-flip">{{ homeScore }}</span>
              <span class="text-2xl opacity-40 sm:text-3xl">–</span>
              <span :key="awayKey" class="inline-block animate-score-flip">{{ awayScore }}</span>
            </p>
          </div>

          <!-- Away -->
          <div class="flex min-w-0 flex-1 items-center gap-2">
            <div
              class="flex size-9 shrink-0 items-center justify-center rounded-xl text-xs font-black"
              style="background-color: color-mix(in srgb, var(--app-pos-gk) 18%, transparent); color: var(--app-pos-gk)"
            >{{ getInitials(awayName) }}</div>
            <div class="min-w-0">
              <p class="truncate text-sm font-bold sm:text-base" style="color: var(--app-text)">{{ awayName }}</p>
              <span class="app-chip mt-0.5" :class="playerSide === 'away' && 'app-chip--success'">
                {{ playerSide === 'away' ? 'Your club' : 'Away' }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Controls -->
      <div class="flex shrink-0 flex-col items-center gap-2.5 lg:items-end">
        <div class="flex flex-wrap justify-center gap-2">
          <UButton
            v-if="!hasStarted && !isFinished"
            :loading="loading"
            label="Start Match"
            icon="i-lucide-play"
            size="lg"
            class="app-glow"
            @click="emit('start')"
          />
          <UButton
            v-if="hasStarted && playing && !isFinished"
            label="Pause"
            icon="i-lucide-pause"
            color="neutral"
            variant="soft"
            @click="emit('pause')"
          />
          <UButton
            v-if="hasStarted && !playing && !isFinished && !isHalfTime && !injuredPlayerName"
            :loading="loading"
            label="Resume"
            icon="i-lucide-play"
            @click="emit('resume')"
          />
          <UButton
            v-if="hasStarted && playing && !isFinished"
            :label="skipLabel"
            icon="i-lucide-fast-forward"
            color="neutral"
            variant="ghost"
            size="sm"
            @click="emit('skipToBreak')"
          />
          <UButton
            v-if="finishFailed && !isFinished"
            label="Retry saving result"
            icon="i-lucide-refresh-cw"
            color="warning"
            class="app-glow"
            style="--glow: var(--app-player-booked)"
            :loading="loading"
            @click="emit('retryFinish')"
          />
          <UButton
            v-if="isFinished"
            label="End Match"
            icon="i-lucide-flag"
            color="success"
            class="app-glow"
            @click="emit('end')"
          />
        </div>

        <!-- Playback speed -->
        <div v-if="hasStarted && !isFinished" class="flex items-center gap-1.5">
          <span class="app-kicker text-[9px]">Speed</span>
          <div class="flex gap-1">
            <button
              v-for="option in SPEEDS"
              :key="option"
              type="button"
              class="app-filter-chip px-2 py-0.5 tabular-nums"
              :class="speed === option && 'app-filter-chip--active'"
              :aria-pressed="speed === option"
              @click="emit('update:speed', option)"
            >{{ option }}×</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
