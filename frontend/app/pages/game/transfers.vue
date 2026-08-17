<script setup lang="ts">
/**
 * Transfer market.
 *
 * Two things were replaced outright: the native `confirm()` box (which ignores
 * the app's styling and states nothing about affordability), and the
 * undebounced search, which fired a request on every keystroke.
 */
import { computed, ref, watch } from 'vue'
import { refDebounced } from '@vueuse/core'
import { normalizePosition, LINEUP_SLOT_ORDER } from '#shared/lineup'
import type { LineupSlot } from '#shared/lineup'
import { formatMoney, formatMoneyCompact } from '~/utils/format'
import { useSettingsStore } from '~/stores/settings'

interface MarketPlayer {
  id: number
  name: string
  age: number
  position: string
  skillLevel: number
  stamina: number
  marketValue: number
  teamId: number
}

const toast = useAppToast()
const settings = useSettingsStore()
const { team, refreshTeam } = useGameContext()

const searchQuery = ref('')
// 350 ms is long enough to stop mid-word requests without feeling laggy.
const debouncedQuery = refDebounced(searchQuery, 350)

const slotFilter = ref<LineupSlot | 'ALL'>('ALL')
const affordableOnly = ref(false)
const sortBy = ref<'value' | 'skill' | 'age'>('skill')

const pendingPurchase = ref<MarketPlayer | null>(null)
const buying = ref(false)

const { data: searchResults, pending, refresh: refreshSearch } = useAsyncData(
  'transfer-search',
  () => $fetch<MarketPlayer[]>(`/api/players/search?query=${encodeURIComponent(debouncedQuery.value.trim())}`),
  { watch: [debouncedQuery], default: () => [] as MarketPlayer[] },
)

const availableBudget = computed(() => team.value?.bankBalance ?? 0)

function canAfford(player: MarketPlayer) {
  return player.marketValue <= availableBudget.value
}

const slotTabs = computed(() => {
  const counts: Record<string, number> = { ALL: searchResults.value.length, GK: 0, DF: 0, MF: 0, FW: 0 }
  for (const player of searchResults.value) {
    const normalized = normalizePosition(player.position)
    if (normalized) counts[normalized]!++
  }
  return (['ALL', ...LINEUP_SLOT_ORDER] as const).map(id => ({ id, label: id === 'ALL' ? 'All' : id, count: counts[id] ?? 0 }))
})

const visiblePlayers = computed(() => {
  const result = searchResults.value.filter((player) => {
    if (slotFilter.value !== 'ALL' && normalizePosition(player.position) !== slotFilter.value) return false
    if (affordableOnly.value && !canAfford(player)) return false
    return true
  })

  const comparators = {
    value: (a: MarketPlayer, b: MarketPlayer) => b.marketValue - a.marketValue,
    skill: (a: MarketPlayer, b: MarketPlayer) => b.skillLevel - a.skillLevel,
    age: (a: MarketPlayer, b: MarketPlayer) => a.age - b.age,
  }

  // Capped: the market can return the entire league, and rendering 400 cards
  // for a blank search is what made this page feel heavy.
  return [...result].sort(comparators[sortBy.value]).slice(0, 60)
})

const balanceAfterPurchase = computed(() =>
  pendingPurchase.value ? availableBudget.value - pendingPurchase.value.marketValue : null,
)

function requestPurchase(player: MarketPlayer) {
  if (!canAfford(player)) {
    toast.warn({
      title: 'Not enough funds',
      description: `You are ${formatMoney(player.marketValue - availableBudget.value)} short for ${player.name}.`,
    })
    return
  }
  pendingPurchase.value = player
}

async function confirmPurchase() {
  const player = pendingPurchase.value
  if (!player) return

  buying.value = true

  try {
    const result = await $fetch<{ success: boolean; sellerTeam: string; purchasePrice: number }>('/api/transfers', {
      method: 'POST',
      body: { playerId: player.id, action: 'buy' },
    })

    await Promise.all([refreshTeam(), refreshSearch()])
    pendingPurchase.value = null

    toast.success({
      title: `${player.name} signed`,
      description: `From ${result.sellerTeam} for ${formatMoney(result.purchasePrice)}.`,
    })

    if (settings.motion === 'full')
      void celebrate()
  }
  catch (error) {
    toast.fromRequestError(error, 'Transfer failed')
  }
  finally {
    buying.value = false
  }
}

/** A small burst on a completed signing. Loaded on demand. */
async function celebrate() {
  try {
    const { default: confetti } = await import('canvas-confetti')
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--app-accent').trim()
    void confetti({
      particleCount: 50,
      spread: 60,
      origin: { y: 0.7 },
      colors: accent ? [accent] : undefined,
      disableForReducedMotion: true,
      zIndex: 60,
    })
  }
  catch {
    // Never let a celebration break a completed transfer.
  }
}

/** Share of the budget a player would consume, for the affordability bar. */
function budgetShare(player: MarketPlayer) {
  if (!availableBudget.value) return 100
  return Math.min(100, Math.round((player.marketValue / availableBudget.value) * 100))
}

watch(slotFilter, () => { /* purely reactive filter */ })
</script>

<template>
  <div class="space-y-4 sm:space-y-5">
    <div class="flex items-center gap-2">
      <UIcon name="i-lucide-arrow-left-right" class="size-6" style="color: var(--app-accent)" />
      <h1 class="app-page-title">Transfer Market</h1>
    </div>

    <!-- Budget -->
    <div class="app-elevated flex flex-wrap items-center gap-4 p-4 sm:p-5">
      <div
        class="flex size-11 shrink-0 items-center justify-center rounded-2xl"
        style="background-color: var(--app-accent-soft); color: var(--app-accent)"
      >
        <UIcon name="i-lucide-wallet" class="size-5" />
      </div>
      <div class="min-w-0">
        <p class="app-kicker text-[10px]">Available budget</p>
        <AppCountUp :value="availableBudget" :format="formatMoney" class="app-hero-number text-2xl" />
      </div>
      <p
        v-if="availableBudget < 1_000_000"
        class="app-chip app-chip--warning ml-auto"
      >
        <UIcon name="i-lucide-triangle-alert" class="size-3" />
        Funds are low — consider selling first
      </p>
    </div>

    <!-- Search and filters -->
    <UCard class="app-surface">
      <template #header>
        <div class="space-y-3">
          <UInput
            v-model="searchQuery"
            placeholder="Search players by name…"
            icon="i-lucide-search"
            size="lg"
            class="w-full"
          />

          <div class="flex flex-wrap items-center gap-2">
            <div class="flex gap-1">
              <button
                v-for="tab in slotTabs"
                :key="tab.id"
                type="button"
                class="app-filter-chip inline-flex items-center gap-1 px-2.5 py-1"
                :class="slotFilter === tab.id && 'app-filter-chip--active'"
                :aria-pressed="slotFilter === tab.id"
                @click="slotFilter = tab.id"
              >
                {{ tab.label }}
                <span class="tabular-nums opacity-70">{{ tab.count }}</span>
              </button>
            </div>

            <button
              type="button"
              class="app-filter-chip px-2.5 py-1"
              :class="affordableOnly && 'app-filter-chip--active'"
              :aria-pressed="affordableOnly"
              @click="affordableOnly = !affordableOnly"
            >
              Affordable only
            </button>

            <USelectMenu
              v-model="sortBy"
              :items="[
                { label: 'Best skill', value: 'skill' },
                { label: 'Most valuable', value: 'value' },
                { label: 'Youngest', value: 'age' },
              ]"
              value-key="value"
              size="sm"
              class="w-36"
            />

            <span class="app-muted-text ml-auto text-xs tabular-nums">{{ visiblePlayers.length }} shown</span>
          </div>
        </div>
      </template>

      <AppSkeleton v-if="pending" variant="list" :rows="4" />

      <div v-else-if="visiblePlayers.length" class="space-y-2.5">
        <div
          v-for="(player, i) in visiblePlayers"
          :key="player.id"
          class="app-surface-subtle animate-fade-in-up p-4 transition hover:-translate-y-0.5"
          :style="`animation-delay: ${Math.min(i, 12) * 0.04}s`"
        >
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex min-w-0 flex-1 items-center gap-3">
              <div
                class="flex size-11 shrink-0 items-center justify-center rounded-2xl text-sm font-black"
                style="background-color: var(--app-accent-soft); color: var(--app-accent)"
              >{{ player.skillLevel }}</div>

              <div class="min-w-0 flex-1 space-y-1.5">
                <div class="flex items-center gap-2">
                  <p class="truncate font-bold" style="color: var(--app-text)">{{ player.name }}</p>
                  <AppPositionBadge :position="player.position" size="xs" />
                  <span class="app-muted-text text-xs">{{ player.age }}y</span>
                </div>

                <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span class="text-sm font-bold" style="color: var(--app-accent)">
                    {{ formatMoney(player.marketValue) }}
                  </span>
                  <span class="flex items-center gap-1.5 text-[11px]" style="color: var(--app-text-muted)">
                    {{ budgetShare(player) }}% of budget
                    <span class="h-1 w-16 overflow-hidden rounded-full" style="background-color: var(--app-surface-muted)">
                      <span
                        class="block h-full rounded-full transition-all duration-500"
                        :style="{
                          width: `${budgetShare(player)}%`,
                          backgroundColor: canAfford(player) ? 'var(--app-accent)' : 'var(--app-player-sent-off)',
                        }"
                      />
                    </span>
                  </span>
                </div>
              </div>
            </div>

            <div class="shrink-0">
              <UButton
                icon="i-lucide-shopping-cart"
                :label="canAfford(player) ? 'Buy' : 'Too expensive'"
                :color="canAfford(player) ? 'primary' : 'neutral'"
                :variant="canAfford(player) ? 'solid' : 'soft'"
                :disabled="!canAfford(player)"
                :title="canAfford(player)
                  ? `Sign ${player.name}`
                  : `You are ${formatMoneyCompact(player.marketValue - availableBudget)} short`"
                class="w-full sm:w-auto"
                @click="requestPurchase(player)"
              />
            </div>
          </div>
        </div>
      </div>

      <AppEmptyState
        v-else
        icon="i-lucide-user-search"
        :title="searchQuery ? `No players matching “${searchQuery}”` : 'No players available'"
        :description="affordableOnly ? 'Try turning off the affordability filter.' : 'Try a different search term.'"
        :action-label="affordableOnly || slotFilter !== 'ALL' ? 'Clear filters' : undefined"
        @action="() => { affordableOnly = false; slotFilter = 'ALL' }"
      />
    </UCard>

    <AppConfirmModal
      :open="Boolean(pendingPurchase)"
      tone="primary"
      icon="i-lucide-shopping-cart"
      :title="`Sign ${pendingPurchase?.name}?`"
      description="The fee is deducted immediately and the player joins your squad."
      confirm-label="Complete transfer"
      confirm-icon="i-lucide-check"
      :loading="buying"
      @confirm="confirmPurchase"
      @cancel="pendingPurchase = null"
    >
      <template #consequences>
        <dl v-if="pendingPurchase" class="space-y-1.5">
          <div class="flex items-center justify-between gap-4">
            <dt class="app-muted-text">Player</dt>
            <dd class="flex items-center gap-2 font-semibold" style="color: var(--app-text)">
              <AppPositionBadge :position="pendingPurchase.position" size="xs" />
              {{ pendingPurchase.name }} · {{ pendingPurchase.skillLevel }} OVR
            </dd>
          </div>
          <div class="flex items-center justify-between gap-4">
            <dt class="app-muted-text">Fee</dt>
            <dd class="font-semibold" style="color: var(--app-text)">{{ formatMoney(pendingPurchase.marketValue) }}</dd>
          </div>
          <div class="flex items-center justify-between gap-4">
            <dt class="app-muted-text">Balance after</dt>
            <dd
              class="font-semibold"
              :style="{ color: (balanceAfterPurchase ?? 0) < 1_000_000 ? 'var(--app-player-booked)' : 'var(--app-accent)' }"
            >
              {{ balanceAfterPurchase !== null ? formatMoney(balanceAfterPurchase) : '—' }}
            </dd>
          </div>
        </dl>
      </template>
    </AppConfirmModal>
  </div>
</template>
