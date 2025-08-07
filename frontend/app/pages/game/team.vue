<script setup lang="ts">
const { data: gameState } = useFetch('/api/game/state')
const { data: team } = useFetch(() => `/api/team/${gameState.value?.playerTeamId}`, {
  immediate: !!gameState.value?.playerTeamId,
})

const columns = [
  { key: 'name', label: 'Name', id: 'name' },
  { key: 'age', label: 'Age', id: 'age' },
  { key: 'position', label: 'Position', id: 'position' },
  { key: 'skillLevel', label: 'Skill', id: 'skillLevel' },
  { key: 'stamina', label: 'Stamina', id: 'stamina' },
  { key: 'marketValue', label: 'Market Value', id: 'marketValue' },
]
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold mb-4">
      Team Squad
    </h1>
    <h2 class="text-lg mb-2">
      {{ team?.name }} Squad
    </h2>
    <UTable v-if="team" :rows="team.squad" :columns="columns" />
  </div>
</template>
