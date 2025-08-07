<script setup lang="ts">
const { data: gameState } = useFetch('/api/game/state')
const { data: team } = useFetch(() => `/api/team/${gameState.value?.playerTeamId}`, {
  immediate: !!gameState.value?.playerTeamId,
})
const { data: standings } = useFetch(() => `/api/standings?leagueId=${team.value?.leagueId}`, {
  immediate: !!team.value?.leagueId,
})

const columns = [
  { key: 'teamName', label: 'Team', id: 'teamName' },
  { key: 'played', label: 'P', id: 'played' },
  { key: 'wins', label: 'W', id: 'wins' },
  { key: 'draws', label: 'D', id: 'draws' },
  { key: 'losses', label: 'L', id: 'losses' },
  { key: 'goalsFor', label: 'GF', id: 'goalsFor' },
  { key: 'goalsAgainst', label: 'GA', id: 'goalsAgainst' },
  { key: 'goalDifference', label: 'GD', id: 'goalDifference' },
  { key: 'points', label: 'Pts', id: 'points' },
]
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold mb-4">
      League Standings
    </h1>
    <UTable :rows="standings" :columns="columns" />
  </div>
</template>
