<script setup lang="ts">
const { data: schedule } = useFetch('/api/schedule')

const columns = [
  { accessorKey: 'matchDate', header: 'Date', id: 'matchDate' },
  { accessorKey: 'homeTeamId', header: 'Home Team', id: 'homeTeamId' },
  { accessorKey: 'awayTeamId', header: 'Away Team', id: 'awayTeamId' },
  { accessorKey: 'score', header: 'Score', id: 'score' },
]

const formattedSchedule = computed(() =>
  schedule.value?.map(match => ({
    ...match,
    matchDate: new Date(match.matchDate).toLocaleDateString(),
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
