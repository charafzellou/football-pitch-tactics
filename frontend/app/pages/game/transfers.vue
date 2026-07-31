<script setup lang="ts">
import { UBadge } from '#components'
import { useToast } from '#imports'

interface PlayerTeamSummary {
  id: number
  bankBalance: number
}

const positionColors: Record<string, 'sky' | 'emerald' | 'amber' | 'rose'> = {
  GK: 'sky', DEF: 'emerald', MID: 'amber', ATT: 'rose',
}

function positionColor(pos: string): 'sky' | 'emerald' | 'amber' | 'rose' | 'neutral' {
  return positionColors[String(pos ?? '').toUpperCase().trim()] ?? 'neutral'
}

const searchQuery = ref('')
const normalizedQuery = computed(() => encodeURIComponent(searchQuery.value.trim()))
const buyingPlayerId = ref<number | null>(null)
const toast = useToast()
const { data: gameState, refresh: refreshGameState } = useFetch('/api/game/state')
const playerTeamId = computed(() => gameState.value?.playerTeamId ?? null)
const playerTeam = ref<PlayerTeamSummary | null>(null)
const { data: searchResults, pending, refresh: refreshSearch } = useFetch(() => `/api/players/search?query=${normalizedQuery.value}`, {
  default: () => [],
})

const availableBudget = computed(() => playerTeam.value?.bankBalance ?? 0)

async function refreshPlayerTeam() {
  if (!playerTeamId.value) {
    playerTeam.value = null
    return
  }

  playerTeam.value = await $fetch<PlayerTeamSummary>(`/api/team/${playerTeamId.value}`)
}

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
  await refreshPlayerTeam()
})

watch(playerTeamId, async () => {
  await refreshPlayerTeam()
})
</script>

<template>
  <div class="space-y-5 sm:space-y-6">
    <div class="flex items-center gap-2">
      <UIcon name="i-lucide-arrow-left-right" class="size-6 text-emerald-400" />
      <h1 class="app-page-title">Player Transfers</h1>
    </div>

    <div class="max-w-2xl space-y-3">
      <div class="flex items-center gap-3 rounded-2xl border px-4 py-3" style="background-color: var(--app-surface-muted); border-color: var(--app-surface-border)">
        <UIcon name="i-lucide-wallet" class="size-4 text-emerald-400" />
        <span class="text-sm" style="color: var(--app-text-muted)">Available budget</span>
        <span class="ml-auto font-bold text-emerald-400">{{ formatMoney(availableBudget) }}</span>
      </div>
      <UInput
        v-model="searchQuery"
        placeholder="Search for players..."
        icon="i-lucide-search"
      />
    </div>

    <div v-if="pending" class="app-muted-text flex items-center gap-2 py-4">
      <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
      Loading players...
    </div>

    <div v-else-if="searchResults.length" class="max-w-2xl space-y-3">
      <div
        v-for="(player, i) in searchResults"
        :key="player.id"
        class="app-surface-subtle animate-fade-in-up p-4"
        :style="`animation-delay: ${i * 0.06}s`"
      >
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex-1 space-y-2">
            <div class="flex items-center gap-2">
              <p class="font-bold" style="color: var(--app-text)">{{ player.name }}</p>
              <UBadge :color="positionColor(player.position)" variant="soft" size="sm" :label="player.position" />
            </div>
            <div class="grid grid-cols-2 gap-x-4 gap-y-2">
              <div>
                <p class="app-kicker mb-1 text-[10px]">OVR</p>
                <div class="flex items-center gap-2">
                  <span class="text-sm font-bold">{{ player.skillLevel }}</span>
                  <div class="app-stat-bar-track flex-1">
                    <div class="app-stat-bar-fill" :style="`width: ${player.skillLevel}%`" />
                  </div>
                </div>
              </div>
              <div>
                <p class="app-kicker mb-1 text-[10px]">Value</p>
                <p class="text-sm font-semibold text-emerald-400">{{ formatMoney(player.marketValue) }}</p>
              </div>
            </div>
          </div>
          <UButton
            icon="i-lucide-shopping-cart"
            :label="canAffordPlayer(player) ? 'Buy' : 'Too expensive'"
            :loading="buyingPlayerId === player.id"
            :disabled="!canAffordPlayer(player)"
            class="w-full shrink-0 sm:w-auto"
            @click="buyPlayer(player)"
          />
        </div>
      </div>
    </div>

    <p v-else class="app-muted-text">No players found.</p>
  </div>
</template>
