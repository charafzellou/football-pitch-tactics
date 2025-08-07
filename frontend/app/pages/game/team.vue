<script setup lang="ts">
import { UButton, UDropdownMenu } from '#components'

const { data: gameState } = useFetch('/api/game/state')
const { data: team } = useFetch(() => `/api/team/${gameState.value?.playerTeamId}`, {
  immediate: !!gameState.value?.playerTeamId,
})

const columns = [
  { accessorKey: 'name', header: 'Name', id: 'name' },
  { accessorKey: 'age', header: 'Age', id: 'age' },
  { accessorKey: 'position', header: 'Position', id: 'position' },
  { accessorKey: 'skillLevel', header: 'Skill', id: 'skillLevel' },
  { accessorKey: 'stamina', header: 'Stamina', id: 'stamina' },
  { accessorKey: 'marketValue', header: 'Market Value', id: 'marketValue' },
  {
    id: 'actions',
    header: 'Actions',
    cell: ({ row }: { row: any }) => {
      return h(
        'div',
        { class: 'text-right' },
        h(
          UDropdownMenu as any,
          {
            content: {
              align: 'end'
            },
            items: getRowItems(row),
            'aria-label': 'Actions dropdown'
          },
          () =>
            h(UButton, {
              icon: 'i-lucide-ellipsis-vertical',
              color: 'neutral',
              variant: 'ghost',
              class: 'ml-auto',
              'aria-label': 'Actions dropdown'
            })
        )
      )
    }
  }
]

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
