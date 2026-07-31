<script setup lang="ts">
import { onMounted, computed, h } from 'vue'
import { UIcon } from '#components'

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

const rankedStandings = computed(() =>
  (standings.value ?? []).map((row, i) => ({ ...row, rank: i + 1 }))
)

const medalColors: Record<number, string> = {
  1: 'text-amber-400',
  2: 'text-slate-300',
  3: 'text-amber-600',
}

const columns = [
  {
    id: 'rank',
    header: '#',
    cell: ({ row }: { row: any }) => {
      const rank: number = row.original.rank
      const color = medalColors[rank]
      if (color) {
        return h('div', { class: `flex items-center gap-1 font-bold ${color}` }, [
          h(UIcon, { name: 'i-lucide-medal', class: 'size-3.5' }),
          h('span', {}, String(rank)),
        ])
      }
      return h('span', { style: 'color: var(--app-text-muted)' }, String(rank))
    },
  },
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
  <div class="space-y-4 sm:space-y-5">
    <div class="flex items-center gap-2">
      <UIcon name="i-lucide-trophy" class="size-6 text-amber-400" />
      <h1 class="app-page-title">
        League Standings
      </h1>
    </div>
    <div class="app-table-shell">
      <div class="min-w-max">
        <UTable :data="rankedStandings" :columns="columns" />
      </div>
    </div>
  </div>
</template>
