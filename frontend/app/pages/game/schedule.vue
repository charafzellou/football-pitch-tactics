<script setup lang="ts">
import { onMounted, computed } from 'vue'

interface Team {
  id: string | number
  leagueId: string | number
  name?: string
}

const { data: schedule, refresh: refreshSchedule } = useFetch('/api/schedule?includePlayed=true')
// first get game state and player's team so we can request teams for the correct league
const { data: gameState, refresh: refreshGameState } = useFetch('/api/game/state')
const { data: playerTeam, refresh: refreshPlayerTeam } = useFetch<Team | null>(() => gameState.value?.playerTeamId ? `/api/team/${gameState.value.playerTeamId}` : '', {
  immediate: false,
})
const { data: teams, refresh: refreshTeams } = useFetch<Team[]>(() => playerTeam.value?.leagueId ? `/api/teams?leagueId=${playerTeam.value.leagueId}` : '', {
  immediate: false,
})

onMounted(async () => {
  // refresh schedule, then load game state -> player team -> teams (by league)
  await refreshSchedule()
  await refreshGameState()
  await refreshPlayerTeam()
  await refreshTeams()
})

const columns = [
  { accessorKey: 'matchDate', header: 'Date', id: 'matchDate' },
  { accessorKey: 'homeTeam', header: 'Home Team', id: 'homeTeam' },
  { accessorKey: 'awayTeam', header: 'Away Team', id: 'awayTeam' },
  { accessorKey: 'score', header: 'Score', id: 'score' },
]

const teamMap = computed(() => {
  const map: Record<string, string> = {};
  if (Array.isArray(teams.value)) {
    for (const team of teams.value) {
      // store keys as strings only
      map[String(team.id)] = team.name ?? '';
    }
  }
  return map;
})

const formattedSchedule = computed(() =>
  schedule.value?.map(match => ({
    ...match,
    // use ISO date (YYYY-MM-DD) to avoid timezone/locale differences between server and client
    matchDate: new Date(match.matchDate).toISOString().slice(0, 10),
    homeTeam: teamMap.value[String(match.homeTeamId)] ?? match.homeTeamId,
    awayTeam: teamMap.value[String(match.awayTeamId)] ?? match.awayTeamId,
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
