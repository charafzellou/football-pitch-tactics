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
</script>

<template>
  <div class="flex flex-col items-center justify-center min-h-screen">
    <h1 class="text-2xl font-bold mb-8">Select Your Team</h1>
    <div class="grid grid-cols-1 grid-rows-4 gap-4 w-full max-w-md">
      <USelectMenu v-model="selectedCountry" placeholder="Select Country" :items="countries" value-key="id"
        label-key="name" />
      <USelectMenu v-if="selectedCountry" v-model="selectedLeague" :items="leagues" placeholder="Select League"
        value-key="id" label-key="name" :loading="leaguesPending" :disabled="!selectedCountry" />
      <USelectMenu v-if="selectedLeague" v-model="selectedTeam" :items="teams" placeholder="Select Team" value-key="id"
        label-key="name" :loading="teamsPending" :disabled="!selectedLeague" />
      <UButton label="Start Game" size="xl" block :disabled="!selectedTeam" @click="startGame" />
    </div>
  </div>
</template>
