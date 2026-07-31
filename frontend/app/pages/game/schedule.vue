<script setup lang="ts">
import { onMounted, computed, h } from 'vue'
import { UBadge } from '#components'

interface Team {
  id: string | number
  leagueId: string | number
  name?: string
}

const { data: schedule, refresh: refreshSchedule } = useFetch('/api/schedule?includePlayed=true')
const { data: gameState, refresh: refreshGameState } = useFetch('/api/game/state')
const { data: playerTeam, refresh: refreshPlayerTeam } = useFetch<Team | null>(() => gameState.value?.playerTeamId ? `/api/team/${gameState.value.playerTeamId}` : '', {
  immediate: false,
})
const { data: teams, refresh: refreshTeams } = useFetch<Team[]>(() => playerTeam.value?.leagueId ? `/api/teams?leagueId=${playerTeam.value.leagueId}` : '', {
  immediate: false,
})

onMounted(async () => {
  await refreshSchedule()
  await refreshGameState()
  await refreshPlayerTeam()
  await refreshTeams()
})

const teamMap = computed(() => {
  const map: Record<string, string> = {};
  if (Array.isArray(teams.value)) {
    for (const team of teams.value) {
      map[String(team.id)] = team.name ?? '';
    }
  }
  return map;
})

const formattedSchedule = computed(() =>
  schedule.value?.map(match => ({
    ...match,
    matchDate: new Date(match.matchDate).toISOString().slice(0, 10),
    homeTeam: teamMap.value[String(match.homeTeamId)] ?? match.homeTeamId,
    awayTeam: teamMap.value[String(match.awayTeamId)] ?? match.awayTeamId,
  })),
)

const columns = [
  { accessorKey: 'matchDate', header: 'Date', id: 'matchDate' },
  { accessorKey: 'homeTeam', header: 'Home Team', id: 'homeTeam' },
  { accessorKey: 'awayTeam', header: 'Away Team', id: 'awayTeam' },
  {
    id: 'score',
    header: 'Score',
    cell: ({ row }: { row: any }) => {
      const match = row.original
      if (match.homeScore === null || match.homeScore === undefined) {
        return h(UBadge, { color: 'neutral', variant: 'soft', label: 'TBD', size: 'sm' })
      }
      const diff = match.homeScore - match.awayScore
      const result = diff > 0 ? 'W' : diff < 0 ? 'L' : 'D'
      const colorMap: Record<string, 'success' | 'neutral' | 'error'> = { W: 'success', D: 'neutral', L: 'error' }
      return h('div', { class: 'flex items-center gap-2' }, [
        h('span', { class: 'font-mono font-semibold' }, `${match.homeScore} – ${match.awayScore}`),
        h(UBadge, { color: colorMap[result], variant: 'soft', label: result, size: 'sm' }),
      ])
    },
  },
]
</script>

<template>
  <div class="space-y-4 sm:space-y-5">
    <div class="flex items-center gap-2">
      <UIcon name="i-lucide-calendar" class="size-6 text-emerald-400" />
      <h1 class="app-page-title">
        Match Schedule
      </h1>
    </div>
    <div class="app-table-shell">
      <div class="min-w-max">
        <UTable :data="formattedSchedule" :columns="columns" />
      </div>
    </div>
  </div>
</template>
