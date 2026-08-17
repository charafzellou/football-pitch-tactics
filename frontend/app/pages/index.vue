<script setup lang="ts">
/**
 * Landing page.
 *
 * Adds the one thing it was missing: a way back into an existing save. The
 * only route out of here used to be starting a new game, which silently
 * destroys the current one.
 */
import { ref } from 'vue'

const sfx = useSfx()
const existingSave = ref<{ playerTeamId: number } | null>(null)
const clubName = ref<string | null>(null)

// Not `useAsyncData`: a missing save is the normal case on a first run and
// should not surface as an error state.
onMounted(async () => {
  try {
    const state = await $fetch<{ playerTeamId: number } | null>('/api/game/state')
    if (!state?.playerTeamId) return

    existingSave.value = state
    const team = await $fetch<{ name: string }>(`/api/team/${state.playerTeamId}`)
    clubName.value = team.name
  }
  catch {
    existingSave.value = null
  }
})

const features = [
  { icon: 'i-lucide-clipboard-list', title: 'Pick your XI', text: 'Formations, fitness and a pitch you can drag players onto.' },
  { icon: 'i-lucide-radio', title: 'Live matchdays', text: 'Minute-by-minute play with substitutions that change the outcome.' },
  { icon: 'i-lucide-arrow-left-right', title: 'Build a squad', text: 'Buy, sell and rotate across a full league season.' },
]
</script>

<template>
  <div class="relative flex min-h-[78vh] flex-col items-center justify-center overflow-hidden px-4 py-10 text-center">
    <!-- Pitch markings drifting behind the hero -->
    <div class="pointer-events-none absolute inset-0 -z-10 opacity-[0.07]" aria-hidden="true">
      <div class="absolute left-1/2 top-1/2 size-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full border-2" style="border-color: var(--app-accent)" />
      <div class="absolute left-1/2 top-1/2 size-[22rem] -translate-x-1/2 -translate-y-1/2 rounded-full border-2" style="border-color: var(--app-accent)" />
      <div class="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2" style="background-color: var(--app-accent)" />
      <div class="absolute left-1/2 top-8 h-40 w-80 -translate-x-1/2 rounded-b-3xl border-2 border-t-0" style="border-color: var(--app-accent)" />
      <div class="absolute bottom-8 left-1/2 h-40 w-80 -translate-x-1/2 rounded-t-3xl border-2 border-b-0" style="border-color: var(--app-accent)" />
    </div>

    <div class="app-surface w-full max-w-3xl animate-rise px-6 py-12 sm:px-10 sm:py-14">
      <div class="mb-5 flex justify-center">
        <UIcon
          name="i-lucide-shield-half"
          class="size-14 animate-glow-pulse"
          style="color: var(--app-accent); filter: drop-shadow(0 0 24px color-mix(in srgb, var(--app-accent) 45%, transparent))"
        />
      </div>

      <p class="app-kicker mb-4">Football Pitch Tactics</p>

      <h1 class="app-gradient-text mb-4 text-4xl font-black leading-tight tracking-tight sm:text-6xl">
        Lead your club to glory.
      </h1>

      <p class="app-muted-text mx-auto mb-8 max-w-xl text-base sm:text-lg">
        Build your squad, pick your tactics, and dominate the league — one matchday at a time.
      </p>

      <div class="flex flex-col items-center gap-3">
        <!-- Continue is the primary action once a save exists. -->
        <UButton
          v-if="existingSave"
          to="/game"
          :label="clubName ? `Continue with ${clubName}` : 'Continue your save'"
          icon="i-lucide-play"
          size="xl"
          class="app-glow w-full max-w-xs justify-center animate-fade-in-up"
          @click="sfx.play('click')"
        />

        <UButton
          to="/new-game"
          :label="existingSave ? 'Start a new game' : 'Start New Game'"
          :icon="existingSave ? 'i-lucide-plus' : 'i-lucide-play'"
          :color="existingSave ? 'neutral' : 'primary'"
          :variant="existingSave ? 'soft' : 'solid'"
          :size="existingSave ? 'lg' : 'xl'"
          class="w-full max-w-xs justify-center"
          :class="!existingSave && 'app-glow'"
          @click="sfx.play('click')"
        />

        <p v-if="existingSave" class="app-muted-text text-xs">
          Starting a new game replaces your current save.
        </p>
      </div>
    </div>

    <!-- Feature strip -->
    <div class="mt-6 grid w-full max-w-3xl gap-3 sm:grid-cols-3">
      <div
        v-for="(feature, i) in features"
        :key="feature.title"
        class="app-surface-subtle animate-fade-in-up p-4 text-left"
        :style="`animation-delay: ${0.15 + i * 0.08}s`"
      >
        <UIcon :name="feature.icon" class="mb-2 size-5" style="color: var(--app-accent)" />
        <p class="text-sm font-bold" style="color: var(--app-text)">{{ feature.title }}</p>
        <p class="app-muted-text mt-0.5 text-xs">{{ feature.text }}</p>
      </div>
    </div>
  </div>
</template>
