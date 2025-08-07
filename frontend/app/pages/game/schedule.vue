<script setup lang="ts">
const { data: schedule } = useFetch('/api/schedule')

const columns = [
  { key: 'matchDate', label: 'Date', id: 'matchDate' },
  { key: 'homeTeamId', label: 'Home Team', id: 'homeTeamId' },
  { key: 'awayTeamId', label: 'Away Team', id: 'awayTeamId' },
  { key: 'score', label: 'Score', id: 'score' },
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
    <UTable :rows="formattedSchedule" :columns="columns" />
  </div>
</template>
