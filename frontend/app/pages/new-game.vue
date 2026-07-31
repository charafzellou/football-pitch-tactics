<script setup lang="ts">
import { ref, watch } from 'vue'

const selectedCountry = ref<number>(1)
const selectedLeague = ref<number>(1)
const selectedTeam = ref<number>(1)

const { data: countries } = useFetch('/api/countries')
const { data: leagues, pending: leaguesPending, refresh: refreshLeagues } = useFetch(
  () => `/api/leagues?countryId=${selectedCountry.value}`,
  { immediate: false }
)
const { data: teams, pending: teamsPending, refresh: refreshTeams } = useFetch(
  () => `/api/teams?leagueId=${selectedLeague.value}`,
  { immediate: false }
)

onMounted(async () => {
  await refreshLeagues()
  await refreshTeams()
})

watch(selectedCountry, () => {
  switch (selectedCountry.value) {
    case 1:
      selectedLeague.value = 1
      break;
    case 2:
      selectedLeague.value = 2
      break;
  }
  refreshLeagues()
})

watch(selectedLeague, () => {
  switch (selectedLeague.value) {
    case 1:
      selectedTeam.value = 1
      break;
    case 2:
      selectedTeam.value = 21
      break;
  }
  refreshTeams()
})

async function startGame() {
  if (!selectedTeam.value) return
  await $fetch('/api/game/start', {
    method: 'POST',
    body: { teamId: selectedTeam.value },
  })
  await navigateTo('/game')
}

const steps = [
  { icon: 'i-lucide-globe', label: 'Country' },
  { icon: 'i-lucide-list', label: 'League' },
  { icon: 'i-lucide-shield', label: 'Club' },
]
</script>

<template>
  <div class="flex min-h-[70vh] flex-col items-center justify-center px-4 py-10">
    <div class="app-surface w-full max-w-lg p-5 sm:p-8 animate-fade-in-up">
      <div class="mb-8 flex items-center justify-center">
        <template v-for="(step, i) in steps" :key="step.label">
          <div class="flex flex-col items-center gap-1">
            <div
              class="flex size-9 items-center justify-center rounded-full border transition-colors duration-300"
              :class="(i === 0) || (i === 1 && selectedCountry) || (i === 2 && selectedLeague) ? 'border-emerald-500 bg-emerald-500/15 text-emerald-400' : 'border-white/15 text-white/30'"
            >
              <UIcon :name="step.icon" class="size-4" />
            </div>
            <span
              class="text-[10px] font-semibold uppercase tracking-widest transition-colors duration-300"
              :class="(i === 0) || (i === 1 && selectedCountry) || (i === 2 && selectedLeague) ? 'text-emerald-400' : 'text-white/30'"
            >{{ step.label }}</span>
          </div>
          <div
            v-if="i < steps.length - 1"
            class="mx-3 mb-5 h-px w-10 transition-colors duration-500"
            :class="(i === 0 && selectedCountry) || (i === 1 && selectedLeague) ? 'bg-emerald-500/50' : 'bg-white/10'"
          />
        </template>
      </div>

      <h1 class="mb-3 text-center text-2xl font-bold sm:text-3xl">Select Your Team</h1>
      <p class="app-muted-text mb-8 text-center text-sm sm:text-base">
        Choose your country, league and club to start a new save.
      </p>

      <div class="grid grid-cols-1 gap-4">
        <div class="animate-fade-in-up" style="animation-delay: 0.05s">
          <USelectMenu v-model="selectedCountry" placeholder="Select Country" :items="countries" value-key="id"
            label-key="name" />
        </div>
        <Transition enter-active-class="transition duration-300 ease-out" enter-from-class="opacity-0 translate-y-2" enter-to-class="opacity-100 translate-y-0">
          <USelectMenu v-if="selectedCountry" v-model="selectedLeague" :items="leagues" placeholder="Select League"
            value-key="id" label-key="name" :loading="leaguesPending" :disabled="!selectedCountry" />
        </Transition>
        <Transition enter-active-class="transition duration-300 ease-out" enter-from-class="opacity-0 translate-y-2" enter-to-class="opacity-100 translate-y-0">
          <USelectMenu v-if="selectedLeague" v-model="selectedTeam" :items="teams" placeholder="Select Team" value-key="id"
            label-key="name" :loading="teamsPending" :disabled="!selectedLeague" />
        </Transition>
        <UButton label="Start Game" icon="i-lucide-play" size="xl" block :disabled="!selectedTeam" @click="startGame" />
      </div>
    </div>
  </div>
</template>
