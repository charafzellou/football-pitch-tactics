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
  /** Unattached — costs a wage and no fee. */
  freeAgent: boolean
  /** What signing him costs in cash: `0` for a free agent. */
  fee: number
  teamName: string
}

interface TransferOffer {
  id: number
  amount: number
  round: number
  roundsRemaining: number
  fromTeamName: string
  fromTeamReputation: number
  premiumPercent: number
  player: {
    id: number
    name: string
    age: number
    position: string
    skillLevel: number
    marketValue: number
    wage: number
    contractUntilSeason: number
  }
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

/** Free agent currently in contract talks, if any. */
const signingPlayerId = ref<number | null>(null)

/** Offer being answered, so only that card shows a spinner. */
const answeringOfferId = ref<number | null>(null)

const { data: searchResults, pending, refresh: refreshSearch } = useAsyncData(
  'transfer-search',
  () => $fetch<MarketPlayer[]>(`/api/players/search?query=${encodeURIComponent(debouncedQuery.value.trim())}`),
  { watch: [debouncedQuery], default: () => [] as MarketPlayer[] },
)

const { data: offers, refresh: refreshOffers } = useAsyncData(
  'transfer-offers',
  () => $fetch<TransferOffer[]>('/api/transfers/offers'),
  { default: () => [] as TransferOffer[] },
)

/**
 * What the club can actually pay today. This is the affordability rule, and it
 * matches the server's — a fee above the balance is refused.
 */
const availableBudget = computed(() => team.value?.bankBalance ?? 0)

const { projection } = useFinanceProjection()

/**
 * What the club can pay *without finishing the season overdrawn*.
 *
 * Deliberately advisory. It never disables a button and the server never checks
 * it: a chairman is allowed to bet the house on a striker, and find out.
 */
const safeSpend = computed(() => projection.value?.transferBudget.safeSpend ?? null)

/** Affordable now, but only by eating into next season. */
function isOverSafeBudget(player: MarketPlayer): boolean {
  if (player.freeAgent || safeSpend.value === null) return false
  return player.fee > safeSpend.value && player.fee <= availableBudget.value
}

/** A free agent is always affordable — there is no fee, only a wage. */
function canAfford(player: MarketPlayer) {
  return player.freeAgent || player.fee <= availableBudget.value
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
  pendingPurchase.value ? availableBudget.value - pendingPurchase.value.fee : null,
)

function requestPurchase(player: MarketPlayer) {
  // A free agent costs no fee, so there is nothing to confirm — the decision is
  // the wage, which contract talks put in front of the manager instead.
  if (player.freeAgent) {
    signingPlayerId.value = player.id
    return
  }

  if (!canAfford(player)) {
    toast.warn({
      title: 'Not enough funds',
      description: `You are ${formatMoney(player.fee - availableBudget.value)} short for ${player.name}.`,
    })
    return
  }
  pendingPurchase.value = player
}

async function onSigned() {
  await Promise.all([refreshTeam(), refreshSearch()])
  if (settings.motion === 'full')
    void celebrate()
}

// ---------------------------------------------------------------------------
// Bids for the manager's own players
// ---------------------------------------------------------------------------

async function answerOffer(offer: TransferOffer, accept: boolean) {
  answeringOfferId.value = offer.id

  try {
    const result = await $fetch<{ accepted: boolean; fee?: number; buyerTeam?: string }>(
      '/api/transfers/offers',
      { method: 'POST', body: { offerId: offer.id, action: accept ? 'accept' : 'reject' } },
    )

    await Promise.all([refreshOffers(), refreshTeam(), refreshSearch()])

    if (result.accepted) {
      toast.success({
        title: `${offer.player.name} sold`,
        description: `To ${result.buyerTeam} for ${formatMoney(result.fee ?? offer.amount)}.`,
      })
    }
    else {
      toast.info({
        title: 'Bid rejected',
        description: `${offer.fromTeamName} have been turned down for ${offer.player.name}.`,
      })
    }
  }
  catch (error) {
    toast.fromRequestError(error, 'Could not answer that bid')
  }
  finally {
    answeringOfferId.value = null
  }
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
    await refreshOffers()

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
  if (player.freeAgent) return 0
  if (!availableBudget.value) return 100
  return Math.min(100, Math.round((player.fee / availableBudget.value) * 100))
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
        <p v-if="safeSpend !== null" class="app-muted-text mt-0.5 text-[11px]">
          {{ formatMoney(safeSpend) }} of it can be spent without finishing the season overdrawn
        </p>
      </div>
      <p
        v-if="availableBudget < 1_000_000"
        class="app-chip app-chip--warning ml-auto"
      >
        <UIcon name="i-lucide-triangle-alert" class="size-3" />
        Funds are low — consider selling first
      </p>
    </div>

    <!-- Bids for your players -->
    <UCard v-if="offers.length" class="app-elevated">
      <template #header>
        <div class="flex flex-wrap items-center gap-2">
          <UIcon name="i-lucide-gavel" class="size-4" style="color: var(--app-gold)" />
          Offers for your players
          <span class="app-chip ml-auto">{{ offers.length }} on the table</span>
        </div>
      </template>

      <div class="space-y-2.5">
        <div
          v-for="offer in offers"
          :key="offer.id"
          class="app-surface-subtle animate-fade-in-up p-4"
        >
          <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div class="flex min-w-0 flex-1 items-center gap-3">
              <div
                class="flex size-11 shrink-0 items-center justify-center rounded-2xl text-sm font-black"
                style="background-color: var(--app-accent-soft); color: var(--app-accent)"
              >{{ offer.player.skillLevel }}</div>

              <div class="min-w-0 flex-1 space-y-1.5">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="truncate font-bold" style="color: var(--app-text)">{{ offer.player.name }}</p>
                  <AppPositionBadge :position="offer.player.position" size="xs" />
                  <span class="app-muted-text text-xs">{{ offer.player.age }}y</span>
                </div>

                <p class="app-muted-text text-xs">
                  <span style="color: var(--app-text-soft)">{{ offer.fromTeamName }}</span>
                  bid <span class="font-bold" style="color: var(--app-gold)">{{ formatMoney(offer.amount) }}</span>
                  <span v-if="offer.premiumPercent !== 0">
                    · {{ offer.premiumPercent > 0 ? '+' : '' }}{{ offer.premiumPercent }}% on his
                    {{ formatMoneyCompact(offer.player.marketValue) }} valuation
                  </span>
                </p>

                <p class="text-[11px]" :style="{ color: offer.roundsRemaining <= 1 ? 'var(--app-player-booked)' : 'var(--app-text-muted)' }">
                  <UIcon name="i-lucide-clock" class="mr-1 inline size-3" />
                  {{ offer.roundsRemaining === 0
                    ? 'Lapses after this matchday'
                    : `${offer.roundsRemaining} matchday${offer.roundsRemaining === 1 ? '' : 's'} to decide` }}
                </p>
              </div>
            </div>

            <div class="flex shrink-0 gap-2">
              <UButton
                icon="i-lucide-check"
                label="Accept"
                color="primary"
                :loading="answeringOfferId === offer.id"
                :disabled="answeringOfferId !== null"
                @click="answerOffer(offer, true)"
              />
              <UButton
                icon="i-lucide-x"
                label="Reject"
                color="neutral"
                variant="soft"
                :disabled="answeringOfferId !== null"
                @click="answerOffer(offer, false)"
              />
            </div>
          </div>
        </div>
      </div>
    </UCard>

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
                <div class="flex flex-wrap items-center gap-2">
                  <p class="truncate font-bold" style="color: var(--app-text)">{{ player.name }}</p>
                  <AppPositionBadge :position="player.position" size="xs" />
                  <span class="app-muted-text text-xs">{{ player.age }}y</span>
                  <span v-if="player.freeAgent" class="app-chip app-chip--success">
                    <UIcon name="i-lucide-user-round-check" class="size-3" />
                    Free agent
                  </span>
                  <span v-else class="app-muted-text truncate text-xs">{{ player.teamName }}</span>
                </div>

                <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span
                    class="text-sm font-bold"
                    :style="{ color: player.freeAgent ? 'var(--app-gold)' : 'var(--app-accent)' }"
                  >
                    {{ player.freeAgent ? 'No fee — wages only' : formatMoney(player.fee) }}
                  </span>
                  <span
                    v-if="!player.freeAgent"
                    class="flex items-center gap-1.5 text-[11px]"
                    style="color: var(--app-text-muted)"
                  >
                    <UIcon
                      v-if="isOverSafeBudget(player)"
                      name="i-lucide-triangle-alert"
                      class="size-3"
                      style="color: var(--app-player-booked)"
                    />
                    <span :style="isOverSafeBudget(player) ? 'color: var(--app-player-booked)' : undefined">
                      {{ isOverSafeBudget(player) ? 'above your safe budget' : `${budgetShare(player)}% of budget` }}
                    </span>
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
                :icon="player.freeAgent ? 'i-lucide-file-signature' : 'i-lucide-shopping-cart'"
                :label="player.freeAgent ? 'Talk terms' : canAfford(player) ? 'Buy' : 'Too expensive'"
                :color="canAfford(player) ? 'primary' : 'neutral'"
                :variant="canAfford(player) ? 'solid' : 'soft'"
                :disabled="!canAfford(player)"
                :title="player.freeAgent
                  ? `Agree terms with ${player.name} — no fee`
                  : canAfford(player)
                    ? `Sign ${player.name}`
                    : `You are ${formatMoneyCompact(player.fee - availableBudget)} short`"
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
            <dd class="font-semibold" style="color: var(--app-text)">{{ formatMoney(pendingPurchase.fee) }}</dd>
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

    <!--
      Signing a free agent is a negotiation, not a purchase — the same panel the
      Team page uses to renew a contract, pointed at the signing endpoint.
    -->
    <ContractModal
      :player-id="signingPlayerId"
      :team-id="team?.id ?? null"
      mode="sign"
      @close="signingPlayerId = null"
      @renewed="onSigned"
    />
  </div>
</template>
