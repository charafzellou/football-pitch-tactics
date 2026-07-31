<script setup lang="ts">
import { useToast } from '#imports'

const searchQuery = ref('')
const normalizedQuery = computed(() => encodeURIComponent(searchQuery.value.trim()))
const buyingPlayerId = ref<number | null>(null)
const toast = useToast()
const { data: gameState, refresh: refreshGameState } = useFetch('/api/game/state')
const playerTeamId = computed(() => gameState.value?.playerTeamId ?? null)
const { data: playerTeam, refresh: refreshPlayerTeam } = useAsyncData('transfers-player-team', () => {
  if (!playerTeamId.value)
    return Promise.resolve(null)

  return $fetch(`/api/team/${playerTeamId.value}`)
}, {
  default: () => null,
  watch: [playerTeamId],
})
const { data: searchResults, pending, refresh: refreshSearch } = useFetch(() => `/api/players/search?query=${normalizedQuery.value}`, {
  default: () => [],
})

const availableBudget = computed(() => playerTeam.value?.bankBalance ?? 0)

function canAffordPlayer(player: { marketValue: number }) {
  return player.marketValue <= availableBudget.value
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value ?? 0)
}

async function buyPlayer(player: any) {
  const confirmed = confirm(`Buy ${player.name} for ${formatMoney(player.marketValue)}?`)
  if (!confirmed)
    return

  buyingPlayerId.value = player.id

  try {
    const result = await $fetch<{ success: boolean; sellerTeam: string; purchasePrice: number }>(`/api/transfers`, {
      method: 'POST',
      body: { playerId: player.id, action: 'buy' },
    })

    await refreshPlayerTeam()
    await refreshSearch()

    toast.add({
      title: 'Player Bought',
      description: `${player.name} signed from ${result.sellerTeam} for ${formatMoney(result.purchasePrice)}.`,
      color: 'success',
      icon: 'i-lucide-circle-check',
    })
  } catch (error: any) {
    toast.add({
      title: 'Transfer Failed',
      description: error?.data?.statusMessage ?? 'Unable to complete the transfer.',
      color: 'error',
      icon: 'i-lucide-octagon-x',
    })
  } finally {
    buyingPlayerId.value = null
  }
}

onMounted(async () => {
  await refreshGameState()
})
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold mb-4">
      Player Transfers
    </h1>
    <div class="mb-8">
      <p class="mb-3 text-sm text-gray-500">
        Available budget: {{ formatMoney(availableBudget) }}
      </p>
      <UInput
        v-model="searchQuery"
        placeholder="Search for players..."
        icon="i-heroicons-magnifying-glass"
      />
    </div>
    <div v-if="pending">
      <p>Loading players...</p>
    </div>
    <div v-else-if="searchResults.length">
      <UCard
        v-for="player in searchResults"
        :key="player.id"
        class="mb-4"
      >
        <div class="flex justify-between items-center">
          <div>
            <p class="font-bold">
              {{ player.name }}
            </p>
            <p>
              {{ player.position }} | Skill: {{ player.skillLevel }} | Value: {{ formatMoney(player.marketValue) }}
            </p>
          </div>
          <UButton
            label="Buy"
            :loading="buyingPlayerId === player.id"
            :disabled="!canAffordPlayer(player)"
            @click="buyPlayer(player)"
          />
        </div>
      </UCard>
    </div>
    <p v-else>No players found.</p>
  </div>
</template>
