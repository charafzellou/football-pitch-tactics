<script setup lang="ts">
import { UButton, UBadge } from '#components'
import { onMounted, h } from 'vue'
import { useToast } from '#imports'
import type { LineupSlot } from '#shared/lineup'
import { LINEUP_SLOT_ORDER, normalizePosition } from '#shared/lineup'

const { data: gameState, refresh: refreshGameState } = useFetch('/api/game/state')
const { data: team, refresh: refreshTeam } = useFetch(() => `/api/team/${gameState.value?.playerTeamId}`, {
  immediate: !!gameState.value?.playerTeamId,
})

function formatMoney(value: number) {
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value ?? 0)
}

const positionColors: Record<LineupSlot, 'sky' | 'emerald' | 'amber' | 'rose'> = {
  GK: 'sky',
  DF: 'emerald',
  MF: 'amber',
  FW: 'rose',
}

function statBar(value: number, max = 100) {
  const pct = Math.min(100, Math.round((value / max) * 100))
  return h('div', { class: 'flex items-center gap-2' }, [
    h('span', { class: 'w-8 text-sm font-semibold tabular-nums' }, String(value)),
    h('div', { class: 'app-stat-bar-track flex-1 min-w-16' }, [
      h('div', { class: 'app-stat-bar-fill', style: `width: ${pct}%` }),
    ]),
  ])
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
    },
    cell: ({ row }: { row: any }) => {
      const rawPosition = String(row.original.position ?? '')
      const slot = normalizePosition(rawPosition)
      const color = slot ? positionColors[slot] : 'neutral'
      const label = slot ?? (rawPosition.toUpperCase().trim() || '—')
      return h(UBadge, { color, variant: 'soft', label, size: 'sm' })
    },
    // custom sorting to enforce GK, DF, MF, FW ordering
    sortingFn: (rowA: any, rowB: any, columnId: string) => {
      const aRaw = rowA.getValue(columnId)
      const bRaw = rowB.getValue(columnId)
      const aSlot = normalizePosition(String(aRaw ?? ''))
      const bSlot = normalizePosition(String(bRaw ?? ''))
      const ia = aSlot ? LINEUP_SLOT_ORDER.indexOf(aSlot) : -1
      const ib = bSlot ? LINEUP_SLOT_ORDER.indexOf(bSlot) : -1
      // both known positions
      if (ia !== -1 && ib !== -1) return ia === ib ? 0 : ia > ib ? 1 : -1
      // one known, one unknown -> known comes first
      if (ia !== -1) return -1
      if (ib !== -1) return 1
      // both unknown -> fallback to string compare
      return String(aRaw ?? '').localeCompare(String(bRaw ?? ''))
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
    },
    cell: ({ row }: { row: any }) => statBar(row.original.skillLevel ?? 0)
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
    },
    cell: ({ row }: { row: any }) => statBar(row.original.stamina ?? 0)
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
          icon: 'i-lucide-tag',
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
  const res = await $fetch<{ success: boolean; buyerTeam: string; salePrice: number }>(`/api/transfers`, {
    method: 'POST',
    body: { playerId, action: 'sell' },
  })
  await refreshTeam()
  if (res && res.success) {
    useToast().add({
      title: 'Player Sold',
      description: `${player.name} (${player.position}) sold for ${formatMoney(res.salePrice)} to ${res.buyerTeam}`,
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
  <div class="space-y-4 sm:space-y-5">
    <div class="flex items-center gap-2">
      <UIcon name="i-lucide-users" class="size-6 text-emerald-400" />
      <h1 class="app-page-title">
        Team Squad
      </h1>
    </div>
    <h2 class="text-lg font-semibold" style="color: var(--app-text)">
      {{ team?.name }} Squad
    </h2>
    <div class="app-table-shell">
      <div class="min-w-max">
        <UTable v-if="team" :data="team.squad" :columns="lineupColumns" />
      </div>
    </div>
  </div>
</template>
