<script setup lang="ts">
import { ref, watch } from 'vue'

const selectedCountry = ref<number | null>(null)
const selectedLeague = ref<number | null>(null)
const selectedTeam = ref<number | null>(null)

const { data: countries } = useFetch('/api/countries')
const { data: leagues, pending: leaguesPending, refresh: refreshLeagues } = useFetch(
  () => `/api/leagues?countryId=${selectedCountry.value}`,
  { immediate: false }
)
const { data: teams, pending: teamsPending, refresh: refreshTeams } = useFetch(
  () => `/api/teams?leagueId=${selectedLeague.value}`,
  { immediate: false }
)

watch(selectedCountry, () => {
  console.log('Selected country changed:', selectedCountry.value)
  selectedLeague.value = null
  selectedTeam.value = null
  if (selectedCountry.value) refreshLeagues()
})

watch(selectedLeague, () => {
  selectedTeam.value = null
  if (selectedLeague.value) refreshTeams()
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
    <div class="space-y-4 w-72">
      <USelectMenu v-model="selectedCountry" placeholder="Select Country" :items="countries" value-key="id" label-key="name" />
      <USelectMenu v-model="selectedLeague" :items="leagues" placeholder="Select League" value-key="id" label-key="name"
        :loading="leaguesPending" :disabled="!selectedCountry" />
      <USelectMenu v-model="selectedTeam" :items="teams" placeholder="Select Team" value-key="id" label-key="name"
        :loading="teamsPending" :disabled="!selectedLeague" />
      <UButton label="Start Game" size="xl" block :disabled="!selectedTeam" @click="startGame" />
    </div>
  </div>
</template>
