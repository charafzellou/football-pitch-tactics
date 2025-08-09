<script setup lang="ts">
import { toast } from '#build/ui'
import { UButton } from '#components'
import { ref, computed, onMounted } from 'vue'
const { data: gameState, refresh: refreshGameState } = useFetch('/api/game/state')
const { data: team, refresh: refreshTeam } = useFetch(() => `/api/team/${gameState.value?.playerTeamId}`, {
  immediate: !!gameState.value?.playerTeamId,
})
const { data: schedule, refresh: refreshSchedule } = useFetch('/api/schedule')
const { data: tacticsList, refresh: refreshTactics } = useFetch('/api/tactics')

const nextMatch = computed(() => schedule.value?.[0])

const showTacticModal = ref(false)
const selectedTactic = ref('')
const tacticError = ref('')

async function confirmTacticAndSimulate() {
  if (!selectedTactic.value) {
    tacticError.value = 'Please select a tactic.'
    return
  }
  if (!team.value) {
    tacticError.value = 'Team data not loaded.'
    return
  }
  // Save tactic
  await $fetch(`/api/team/${team.value.id}/tactics`, {
    method: 'PUT',
    body: { tactics: selectedTactic.value },
  })
  showTacticModal.value = true
  tacticError.value = ''
  await playNextMatch()
}

async function playNextMatch() {
  try {
    if (selectedPlayers.value.length === 0) {
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
    }
    const result = await $fetch('/api/match/simulate', { method: 'POST', body: { teamId: team.value?.id, opponentId: nextMatch.value?.awayTeamId, tactic: selectedTactic.value, lineup: selectedPlayers.value } })
    await refreshSchedule()
    await refreshTeam()
    if (
      result &&
      typeof (result as any).homeScore !== 'undefined' &&
      typeof (result as any).awayScore !== 'undefined'
    ) {
      alert(`Match Result: ${(result as any).homeScore} - ${(result as any).awayScore}`)
    } else if (result && (result as any).message) {
      alert((result as any).message)
    } else {
      alert('Match simulated.')
    }
  } catch (e) {
    alert('Error simulating match.')
  }
}

function formatMoney(value: number) {
  return value?.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) ?? ''
}

const lineupColumns = [
  { accessorKey: 'name', header: 'Name', id: 'name' },
  { accessorKey: 'age', header: 'Age', id: 'age' },
  { accessorKey: 'position', header: 'Position', id: 'position' },
  { accessorKey: 'skillLevel', header: 'Skill', id: 'skillLevel' },
  { accessorKey: 'stamina', header: 'Stamina', id: 'stamina' },
  {
    accessorKey: 'marketValue',
    header: 'Market Value',
    id: 'marketValue',
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
              })
            } else {
              selectedPlayers.value.push(row.original.id)
              useToast().add({
                color: 'primary',
                icon: 'i-lucide-check',
                title: 'Player selected',
                description: `You selected ${row.original.name} as ${row.original.position}`,
              })
            }
          }
        },
        selectedPlayers.value.includes(row.original.id) ? 'Deselect' : 'Select'
      )
    }
  }
]

const selectedPlayers = ref<number[]>([])

onMounted(async () => {
  await refreshGameState()
  await refreshTeam()
  await refreshSchedule()
  await refreshTactics()
})
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold mb-4">
      Dashboard
    </h1>
    <div v-if="team" class="grid grid-cols-1 md:grid-cols-2 gap-8">
      <UCard>
        <template #header>
          Club Status
        </template>
        <p>
          League Position: <strong>TODO</strong>
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
          vs <strong>{{ nextMatch.awayTeamId }}</strong>
        </p>
        <p>
          Date: <strong>{{ new Date(nextMatch.matchDate).toLocaleDateString() }}</strong>
        </p>
        <UModal :open="showTacticModal">
          <UButton class="mt-4" label="Play Next Match" @click="confirmTacticAndSimulate" />
          <template #title>
            Game Summary
          </template>
          <template #content>
            <div>
              <p>Selected Tactic: <strong>{{ selectedTactic }}</strong></p>
              <p>Team: <strong>{{ team.name }}</strong></p>
              <p>Next Match: <strong>{{ nextMatch?.awayTeamId }}</strong></p>
            </div>
            <UButton label="Close" @click="showTacticModal = false" />
          </template>
        </UModal>
      </UCard>
    </div>

    <UCard>
      <template #header>
        Select Tactic & Lineup
      </template>
      <div>
        <div class="grid grid-cols-1 gap-4">
          <select v-model="selectedTactic" class="border rounded px-2 py-1">
            <option value="" disabled>Select tactic</option>
            <option v-for="t in tacticsList" :key="t.name" :value="t.name">
              {{ t.name }} ({{ t.formation.DEF }}-{{ t.formation.MID }}-{{ t.formation.ATT }})
            </option>
            <div v-if="tacticError" class="text-red-600 mt-2">{{ tacticError }}</div>
          </select>
          <h2 class="text-lg mb-2">
            {{ team?.name }} Squad
          </h2>
          <UTable v-if="team" :data="team.squad" :columns="lineupColumns" />
        </div>
      </div>
    </UCard>
  </div>
</template>
