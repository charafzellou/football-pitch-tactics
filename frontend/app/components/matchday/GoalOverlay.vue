<script setup lang="ts">
/**
 * The goal moment.
 *
 * A goal used to be a one-line entry in a scrolling list, indistinguishable
 * from a cross. This is the only thing on the page for a second and a half.
 */
import { onBeforeUnmount, ref, watch } from 'vue'
import { useSettingsStore } from '~/stores/settings'

export interface GoalMoment {
  /** Unique per goal so re-scoring retriggers the animation. */
  key: number
  minute: number
  scorer: string | null
  teamName: string
  homeScore: number
  awayScore: number
  isPlayerGoal: boolean
}

const props = defineProps<{ moment: GoalMoment | null }>()

const settings = useSettingsStore()
const visible = ref(false)
let hideTimer: ReturnType<typeof setTimeout> | null = null

watch(() => props.moment?.key, async (key) => {
  if (key === undefined) return

  visible.value = true
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = setTimeout(() => { visible.value = false }, 1800)

  if (props.moment?.isPlayerGoal && settings.motion === 'full')
    await burst()
})

/**
 * Confetti is loaded on demand — it is only ever needed once the player's own
 * team scores, so it has no business in the initial bundle.
 */
async function burst() {
  try {
    const { default: confetti } = await import('canvas-confetti')
    const shared = { spread: 70, startVelocity: 42, ticks: 140, zIndex: 60, disableForReducedMotion: true }
    const colors = readAccentColors()

    void confetti({ ...shared, particleCount: 70, origin: { x: 0.2, y: 0.7 }, angle: 60, colors })
    void confetti({ ...shared, particleCount: 70, origin: { x: 0.8, y: 0.7 }, angle: 120, colors })
  }
  catch {
    // A blocked dynamic import must never take the match down with it.
  }
}

/** Pulls the live theme accent so the celebration matches the current skin. */
function readAccentColors(): string[] {
  const styles = getComputedStyle(document.documentElement)
  return ['--app-accent', '--app-gold', '--color-brand-200']
    .map(token => styles.getPropertyValue(token).trim())
    .filter(Boolean)
}

function dismiss() {
  visible.value = false
}

onBeforeUnmount(() => {
  if (hideTimer) clearTimeout(hideTimer)
})
</script>

<template>
  <Transition
    enter-active-class="transition duration-200 ease-out"
    enter-from-class="opacity-0"
    leave-active-class="transition duration-300 ease-in"
    leave-to-class="opacity-0"
  >
    <div
      v-if="visible && moment"
      class="fixed inset-0 z-50 flex items-center justify-center p-6"
      style="background-color: rgba(3, 7, 12, 0.72); backdrop-filter: blur(6px)"
      role="alert"
      @click="dismiss"
    >
      <div class="animate-pop-in text-center">
        <p
          class="text-6xl font-black uppercase leading-none tracking-tighter sm:text-8xl"
          :class="moment.isPlayerGoal ? 'app-gradient-text' : ''"
          :style="!moment.isPlayerGoal ? 'color: var(--app-text-muted)' : undefined"
        >
          Goal!
        </p>

        <p class="mt-4 text-2xl font-bold sm:text-3xl" style="color: var(--app-text)">
          {{ moment.scorer ?? moment.teamName }}
        </p>
        <p class="app-muted-text mt-1 text-sm">
          {{ moment.teamName }} · {{ moment.minute }}'
        </p>

        <p class="mt-6 text-5xl font-black tabular-nums sm:text-6xl" style="color: var(--app-text)">
          {{ moment.homeScore }} – {{ moment.awayScore }}
        </p>

        <p class="app-muted-text mt-6 text-xs">Tap to dismiss</p>
      </div>
    </div>
  </Transition>
</template>
