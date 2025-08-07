<script setup lang="ts">
const { data: gameState } = useFetch('/api/game/state')
const { data: team, refresh: refreshTeam } = useFetch(() => `/api/team/${gameState.value?.playerTeamId}`, {
  immediate: !!gameState.value?.playerTeamId,
})

const tactics = ref('')

watch(team, (newTeam) => {
  if (newTeam?.tactics)
    tactics.value = newTeam.tactics
}, { immediate: true })

async function saveTactics() {
  if (!gameState.value)
    return
  await $fetch(`/api/team/${gameState.value.playerTeamId}/tactics`, {
    method: 'PUT',
    body: { tactics: tactics.value },
  })
  refreshTeam()
  // Add toast notification
}
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold mb-4">
      Tactics
    </h1>
    <div class="space-y-4">
      <UTextarea v-model="tactics" placeholder="e.g. 4-4-2, high press, counter-attack" :rows="5" />
      <UButton label="Save Tactics" @click="saveTactics" />
    </div>
  </div>
</template>
