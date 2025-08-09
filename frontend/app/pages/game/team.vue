<script setup lang="ts">
import { UButton, UDropdownMenu } from '#components'
import { onMounted } from 'vue'
import { useToast } from '#imports'
const { data: gameState, refresh: refreshGameState } = useFetch('/api/game/state')
const { data: team, refresh: refreshTeam } = useFetch(() => `/api/team/${gameState.value?.playerTeamId}`, {
  immediate: !!gameState.value?.playerTeamId,
})

function formatMoney(value: number) {
  return value?.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) ?? ''
}

const columns = [
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
          color: 'error',
          variant: 'solid',
          size: 'xs',
          onClick: () => sellPlayer(row.original.id),
        },
        'Sell'
      )
    }
  }
]

async function sellPlayer(playerId: number) {
  const player = team.value?.squad.find((p: any) => p.id === playerId)
  if (!player) return
  const res = await $fetch(`/api/transfers`, {
    method: 'POST',
    body: { playerId, action: 'sell' },
  })
  await refreshTeam()
  if (res && res.success) {
    useToast().add({
      title: 'Player Sold',
      description: `${player.name} (${player.position}) sold for $${player.marketValue} to ${res.buyerTeam}`,
      color: 'success',
      icon: 'i-lucide-circle-check',
    })
  }
}

function getRowItems(row: any) {
  return [
    {
      type: 'label',
      label: 'Actions'
    },
    {
      label: 'Copy payment ID',
      onSelect() {
        useToast().add({
          title: 'Payment ID copied to clipboard!',
          color: 'success',
          icon: 'i-lucide-circle-check'
        })
      }
    },
    {
      type: 'separator'
    },
    {
      label: 'View customer'
    },
    {
      label: 'View payment details'
    }
  ]
}

onMounted(async () => {
  await refreshGameState()
  await refreshTeam()
})

</script>

<template>
  <div>
    <h1 class="text-2xl font-bold mb-4">
      Team Squad
    </h1>
    <h2 class="text-lg mb-2">
      {{ team?.name }} Squad
    </h2>
    <UTable v-if="team" :data="team.squad" :columns="columns" />
  </div>
</template>
