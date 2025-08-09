<script setup lang="ts">
import { onMounted } from 'vue'
const { data: gameState, refresh: refreshGameState } = useFetch('/api/game/state')
const { data: team, refresh: refreshTeam } = useFetch(() => `/api/team/${gameState.value?.playerTeamId}`, {
  immediate: !!gameState.value?.playerTeamId,
})

const leagueId = computed(() => team.value?.leagueId)
const { data: standings, refresh: refreshStandings } = useFetch<{ [key: string]: any }[]>(
  () => leagueId.value ? `/api/standings?leagueId=${leagueId.value}` : '',
  {
    immediate: false,
  }
)

watch(leagueId, (val) => {
  if (val) refreshStandings()
})

onMounted(async () => {
  await refreshGameState()
  await refreshTeam()
  await refreshStandings()
})

const columns = [
  { accessorKey: 'teamName', header: 'Team', id: 'teamName' },
  { accessorKey: 'played', header: 'P', id: 'played' },
  { accessorKey: 'wins', header: 'W', id: 'wins' },
  { accessorKey: 'draws', header: 'D', id: 'draws' },
  { accessorKey: 'losses', header: 'L', id: 'losses' },
  { accessorKey: 'goalsFor', header: 'GF', id: 'goalsFor' },
  { accessorKey: 'goalsAgainst', header: 'GA', id: 'goalsAgainst' },
  { accessorKey: 'goalDifference', header: 'GD', id: 'goalDifference' },
  { accessorKey: 'points', header: 'Pts', id: 'points' },
]
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold mb-4">
      League Standings
    </h1>
    <UTable :data="standings" :columns="columns" />
  </div>
</template>
