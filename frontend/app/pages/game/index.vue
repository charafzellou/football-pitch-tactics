<script setup lang="ts">
import { UButton } from '#components'
import { ref, computed, onMounted } from 'vue'
import { useToast } from '#imports'
const { data: gameState, refresh: refreshGameState } = useFetch('/api/game/state')
const { data: team, refresh: refreshTeam } = useFetch(() => `/api/team/${gameState.value?.playerTeamId}`, {
  immediate: !!gameState.value?.playerTeamId,
})
const { data: standings, refresh: refreshStandings } = useFetch(() => `/api/standings?leagueId=${team.value?.leagueId ?? ''}`, {
  immediate: !!team.value?.leagueId,
})
const { data: schedule, refresh: refreshSchedule } = useFetch('/api/schedule')
const { data: tacticsList, refresh: refreshTactics } = useFetch('/api/tactics')

const nextMatch = computed(() => schedule.value?.[0])

const leaguePosition = computed(() => {
  if (!standings.value || !team.value) return null
  // standings is an array sorted by points desc, goalDifference desc
  const idx = (standings.value as any[]).findIndex(s => s.teamName === team.value!.name)
  return idx === -1 ? null : idx + 1
})

// fetch opponent team by nextMatch awayTeamId (declared after nextMatch so computed is available)
const { data: opponentTeam, refresh: refreshOpponent } = useFetch(() => `/api/team/${nextMatch.value?.awayTeamId}`, {
  immediate: !!nextMatch.value?.awayTeamId,
})

const selectedTactic = ref('')

async function confirmTacticAndSimulate() {
  if (!team.value) {
    useToast().add({
      title: 'Team data not loaded',
      description: 'Please refresh the page.',
      color: 'error',
    })
    return
  } else if (!selectedTactic.value) {
    useToast().add({
      title: 'No tactic selected',
      description: 'Please select a tactic.',
      color: 'error',
    })
    return
  } else if (selectedPlayers.value.length === 0) {
    useToast().add({
      color: 'error',
      icon: 'i-lucide-octagon-x',
      title: 'Invalid lineup',
      description: 'Please select players for the lineup.'
    })
    return
  } else if (selectedPlayers.value.length < 11 || selectedPlayers.value.length > 11) {
    useToast().add({
      color: 'error',
      icon: 'i-lucide-octagon-x',
      title: 'Invalid lineup',
      description: 'Please select 11 players for the lineup.'
    })
    return
  } else {
    // Save tactic
    await $fetch(`/api/team/${team.value.id}/tactics`, {
      method: 'PUT',
      body: { tactics: selectedTactic.value },
    })
    navigateTo('/matchday')
  }
}

async function playNextMatch() {
  try {
    const result = await $fetch('/api/match/simulate', { method: 'POST', body: { teamId: team.value?.id, opponentId: nextMatch.value?.awayTeamId, tactic: selectedTactic.value, lineup: selectedPlayers.value } })
    await refreshSchedule()
    // refresh opponent info after schedule updates
    await refreshOpponent()
    await refreshTeam()
    // refresh standings so league position updates after the match
    await refreshStandings()
    if (
      result &&
      typeof (result as any).homeScore !== 'undefined' &&
      typeof (result as any).awayScore !== 'undefined'
    ) {
      useToast().add({
        title: 'Match Result',
        description: `${(result as any).homeScore} - ${(result as any).awayScore}`,
        color: 'info',
      })
    } else if (result && (result as any).message) {
      useToast().add({
        title: 'Match Simulation Error',
        description: (result as any).message,
        color: 'info',
      })
    }
  } catch (e) {
    useToast().add({
      title: 'Error',
      description: 'Error simulating match.',
      color: 'error',
    })
  }
}

function formatMoney(value: number) {
  return value?.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) ?? ''
}

const lineupColumns = [
  {
    accessorKey: 'name', id: 'name',
    header: ({ column }: { column: any }) => {
      const isSorted = column.getIsSorted()
      return h(UButton, {
        color: 'neutral',
        variant: 'ghost',
        label: 'Name',
        icon: isSorted
          ? isSorted === 'asc'
            ? 'i-lucide-arrow-up-narrow-wide'
            : 'i-lucide-arrow-down-wide-narrow'
          : 'i-lucide-arrow-up-down',
        class: '-mx-2.5',
        onClick: () => column.toggleSorting(column.getIsSorted() === 'asc')
      })
    }
  },
  {
    accessorKey: 'age', id: 'age',
    header: ({ column }: { column: any }) => {
      const isSorted = column.getIsSorted()
      return h(UButton, {
        color: 'neutral',
        variant: 'ghost',
        label: 'Age',
        icon: isSorted
          ? isSorted === 'asc'
            ? 'i-lucide-arrow-up-narrow-wide'
            : 'i-lucide-arrow-down-wide-narrow'
          : 'i-lucide-arrow-up-down',
        class: '-mx-2.5',
        onClick: () => column.toggleSorting(column.getIsSorted() === 'asc')
      })
    }
  },
  {
    accessorKey: 'position', id: 'position',
    header: ({ column }: { column: any }) => {
      const isSorted = column.getIsSorted()
      return h(UButton, {
        color: 'neutral',
        variant: 'ghost',
        label: 'Position',
        icon: isSorted
          ? isSorted === 'asc'
            ? 'i-lucide-arrow-up-narrow-wide'
            : 'i-lucide-arrow-down-wide-narrow'
          : 'i-lucide-arrow-up-down',
        class: '-mx-2.5',
        onClick: () => column.toggleSorting(column.getIsSorted() === 'asc')
      })
    }
    ,
    // custom sorting to enforce GK, DEF, MID, ATT ordering
    sortingFn: (rowA: any, rowB: any, columnId: string) => {
      const order = ['GK', 'DEF', 'MID', 'ATT']
      const aRaw = rowA.getValue(columnId)
      const bRaw = rowB.getValue(columnId)
      const a = String(aRaw ?? '').toUpperCase().trim()
      const b = String(bRaw ?? '').toUpperCase().trim()
      const ia = order.indexOf(a)
      const ib = order.indexOf(b)
      // both known positions
      if (ia !== -1 && ib !== -1) return ia === ib ? 0 : ia > ib ? 1 : -1
      // one known, one unknown -> known comes first
      if (ia !== -1) return -1
      if (ib !== -1) return 1
      // both unknown -> fallback to string compare
      return a.localeCompare(b)
    }
  },
  {
    accessorKey: 'skillLevel', id: 'skillLevel',
    header: ({ column }: { column: any }) => {
      const isSorted = column.getIsSorted()
      return h(UButton, {
        color: 'neutral',
        variant: 'ghost',
        label: 'Skill Level',
        icon: isSorted
          ? isSorted === 'asc'
            ? 'i-lucide-arrow-up-narrow-wide'
            : 'i-lucide-arrow-down-wide-narrow'
          : 'i-lucide-arrow-up-down',
        class: '-mx-2.5',
        onClick: () => column.toggleSorting(column.getIsSorted() === 'asc')
      })
    }
  },
  {
    accessorKey: 'stamina', id: 'stamina',
    header: ({ column }: { column: any }) => {
      const isSorted = column.getIsSorted()
      return h(UButton, {
        color: 'neutral',
        variant: 'ghost',
        label: 'Stamina',
        icon: isSorted
          ? isSorted === 'asc'
            ? 'i-lucide-arrow-up-narrow-wide'
            : 'i-lucide-arrow-down-wide-narrow'
          : 'i-lucide-arrow-up-down',
        class: '-mx-2.5',
        onClick: () => column.toggleSorting(column.getIsSorted() === 'asc')
      })
    }
  },
  {
    accessorKey: 'marketValue',
    id: 'marketValue',
    header: ({ column }: { column: any }) => {
      const isSorted = column.getIsSorted()
      return h(UButton, {
        color: 'neutral',
        variant: 'ghost',
        label: 'Market Value',
        icon: isSorted
          ? isSorted === 'asc'
            ? 'i-lucide-arrow-up-narrow-wide'
            : 'i-lucide-arrow-down-wide-narrow'
          : 'i-lucide-arrow-up-down',
        class: '-mx-2.5',
        onClick: () => column.toggleSorting(column.getIsSorted() === 'asc')
      })
    },
    cell: ({ row }: { row: any }) => formatMoney(row.original.marketValue)
  },
  {
    id: 'actions',
    header: 'Actions',
    cell: ({ row }: { row: any }) => {
      return h(
        UButton,
        {
          color: 'primary',
          variant: 'solid',
          size: 'xs',
          onClick: () => {
            if (selectedPlayers.value.includes(row.original.id)) {
              selectedPlayers.value = selectedPlayers.value.filter(id => id !== row.original.id)
              useToast().add({
                color: 'error',
                icon: 'i-lucide-octagon-x',
                title: 'Player removed',
                description: `You removed ${row.original.name} from ${row.original.position}`,
                duration: 500,
              })
            } else {
              selectedPlayers.value.push(row.original.id)
              useToast().add({
                color: 'primary',
                icon: 'i-lucide-check',
                title: 'Player selected',
                description: `You selected ${row.original.name} as ${row.original.position}`,
                duration: 500,
              })
            }
          }
        },
        { default: () => (selectedPlayers.value.includes(row.original.id) ? 'Deselect' : 'Select') }
      )
    }
  }
]

const selectedPlayers = ref<number[]>([])

onMounted(async () => {
  await refreshGameState()
  await refreshTeam()
  await refreshSchedule()
  await refreshStandings()
  await refreshOpponent()
  await refreshTactics()
})
</script>

<template>

  <div class="grid grid-cols-1 gap-4">
    <h1 class="text-2xl font-bold mb-4">
      Dashboard
    </h1>
    <div v-if="team" class="grid grid-cols-1 md:grid-cols-2 gap-8">
      <UCard>
        <template #header>
          Club Status
        </template>
        <p>
          League Position: <strong>{{ leaguePosition ?? '—' }}</strong>
        </p>
        <p>
          Bank Balance: <strong>{{ new Intl.NumberFormat('en-US', {
            style: 'currency', currency: 'USD'
          }).format(team.bankBalance ?? 0) }}</strong>
        </p>
      </UCard>
      <UCard v-if="nextMatch">
        <template #header>
          Next Match
        </template>
        <p>
          vs <strong>{{ opponentTeam?.name ?? nextMatch.awayTeamId }}</strong>
        </p>
        <p>
          Date: <strong>{{ new Date(nextMatch.matchDate).toLocaleDateString() }}</strong>
        </p>
        <UButton class="mt-4" label="Play Next Match" @click="confirmTacticAndSimulate" />
      </UCard>
    </div>


    <UCard>
      <div class="grid grid-cols-2 gap-4">
        <p>
          {{ selectedPlayers.length }} players selected for lineup
        </p>
        <select v-model="selectedTactic" class="border rounded px-2 py-1">
          <option value="" disabled>Select tactic</option>
          <option v-for="t in tacticsList" :key="t.name" :value="t.name">
            {{ t.name }} ({{ t.formation.DEF }}-{{ t.formation.MID }}-{{ t.formation.ATT }})
          </option>
          <div v-if="!selectedTactic" class="text-red-600 mt-2">Please select a tactic.</div>
        </select>
      </div>
    </UCard>
    <UCard>
      <h2 class="text-lg mb-2">
        {{ team?.name }} Squad
      </h2>
      <UTable v-if="team" :data="team.squad" :columns="lineupColumns" />
    </UCard>
  </div>
</template>
