<script setup lang="ts">
import { onMounted, computed } from 'vue'

const { data: schedule, refresh: refreshSchedule } = useFetch('/api/schedule')
const { data: teams, refresh: refreshTeams } = useFetch('/api/teams')

onMounted(async () => {
  await Promise.all([
    refreshSchedule(),
    refreshTeams(),
  ])
})

const columns = [
  { accessorKey: 'matchDate', header: 'Date', id: 'matchDate' },
  { accessorKey: 'homeTeam', header: 'Home Team', id: 'homeTeam' },
  { accessorKey: 'awayTeam', header: 'Away Team', id: 'awayTeam' },
  { accessorKey: 'score', header: 'Score', id: 'score' },
]

const teamMap = computed(() => {
  const map: Record<number, string> = {};
  if (teams.value) {
    for (const team of teams.value) {
      map[team.id] = team.name;
    }
  }
  return map;
})

const formattedSchedule = computed(() =>
  schedule.value?.map(match => ({
    ...match,
    matchDate: new Date(match.matchDate).toLocaleDateString(),
    homeTeam: teamMap.value[match.homeTeamId] || match.homeTeamId,
    awayTeam: teamMap.value[match.awayTeamId] || match.awayTeamId,
    score: match.homeScore !== null ? `${match.homeScore} - ${match.awayScore}` : 'TBD',
  })),
)
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold mb-4">
      Match Schedule
    </h1>
    <UTable :data="formattedSchedule" :columns="columns" />
  </div>
</template>
