<script setup lang="ts">
import { UButton } from '#components'
import { onMounted, h } from 'vue'
import { useToast } from '#imports'
const { data: gameState, refresh: refreshGameState } = useFetch('/api/game/state')
const { data: team, refresh: refreshTeam } = useFetch(() => `/api/team/${gameState.value?.playerTeamId}`, {
  immediate: !!gameState.value?.playerTeamId,
})

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
          color: 'error',
          variant: 'solid',
          size: 'xs',
          onClick: () => sellPlayer(row.original.id),
        },
        { default: () => 'Sell' }
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
      description: `${player.name} (${player.position}) sold for ${formatMoney(player.marketValue)} to ${res.buyerTeam}`,
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
    <UTable v-if="team" :data="team.squad" :columns="lineupColumns" />
  </div>
</template>
