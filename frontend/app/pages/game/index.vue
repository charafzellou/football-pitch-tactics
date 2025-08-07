<script setup lang="ts">
const { data: gameState } = useFetch('/api/game/state')
const { data: team } = useFetch(() => `/api/team/${gameState.value?.playerTeamId}`, {
  immediate: !!gameState.value?.playerTeamId,
})
const { data: schedule } = useFetch('/api/schedule')

const nextMatch = computed(() => schedule.value?.[0])

async function playNextMatch() {
  // Placeholder for match simulation
  alert('Simulating next match...')
}
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold mb-4">
      Dashboard
    </h1>
    <div
      v-if="team"
      class="grid grid-cols-1 md:grid-cols-2 gap-8"
    >
      <UCard>
        <template #header>
          Club Status
        </template>
        <p>
          League Position: <strong>TODO</strong>
        </p>
        <p>
          Bank Balance: <strong>{{ new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(team.bankBalance) }}</strong>
        </p>
      </UCard>
      <UCard v-if="nextMatch">
        <template #header>
          Next Match
        </template>
        <p>
          vs <strong>{{ nextMatch.awayTeamId }}</strong>
        </p>
        <p>
          Date: <strong>{{ new Date(nextMatch.matchDate).toLocaleDateString() }}</strong>
        </p>
        <UButton
          class="mt-4"
          label="Play Next Match"
          @click="playNextMatch"
        />
      </UCard>
    </div>
  </div>
</template>
