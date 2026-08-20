<script setup lang="ts">
/**
 * The commercial department.
 *
 * Partners used to be one number the game paid the club every matchday with no
 * decision attached to it. Here it is a portfolio: three shirt-and-kit slots
 * that run out and have to be re-sold, a ground whose name can be sold once for
 * real money and real ill-feeling, and hoardings that can be bought better.
 */
import { computed, ref } from 'vue'
import { formatMoney, formatMoneyCompact } from '~/utils/format'

interface Deal {
  id: number
  slot: string
  slotLabel: string
  sponsorName: string
  baseFee: number
  perSeason: number
  signedSeason: number
  untilSeason: number
  seasonsLeft: number
  finalSeason: boolean
  bonusChampion: number
  bonusTopFour: number
  bonusSurvival: number
}

interface Offer extends Omit<Deal, 'seasonsLeft' | 'finalSeason' | 'signedSeason'> {
  seasons: number
  roundsRemaining: number
}

interface CommercialPayload {
  season: number
  round: number
  totalRounds: number
  balance: number
  fanConfidence: number
  pool: number
  valuations: { slot: string; label: string; marketRate: number }[]
  deals: Deal[]
  offers: Offer[]
  merchandising: { perMatchday: number; starPower: number }
  stadium: { name: string | null; baseName: string | null; namingRightsSold: boolean }
  perimeter: {
    level: number
    tier: { level: number; name: string; multiplier: number }
    tiers: { level: number; name: string; multiplier: number }[]
    atMax: boolean
    perHomeMatch: number
    nextPerHomeMatch: number
    upgradeCost: number
    canAfford: boolean
    paybackSeasons: number | null
  }
}

const toast = useAppToast()
const { refreshTeam } = useGameContext()
const { refresh: refreshSummary } = useFinanceSummary()
const { refresh: refreshProjection } = useFinanceProjection()

const { data, refresh, status } = useAsyncData(
  'finance-commercial',
  () => $fetch<CommercialPayload | null>('/api/finance/commercial'),
)

const working = ref(false)
const pendingNaming = ref<Offer | null>(null)

/** Offers gathered by the slot they compete for, so the trade-off is side by side. */
const offerGroups = computed(() => {
  const groups = new Map<string, { slot: string; label: string; marketRate: number; offers: Offer[] }>()

  for (const offer of data.value?.offers ?? []) {
    const existing = groups.get(offer.slot)
    if (existing) {
      existing.offers.push(offer)
      continue
    }
    groups.set(offer.slot, {
      slot: offer.slot,
      label: offer.slotLabel,
      marketRate: data.value?.valuations.find(row => row.slot === offer.slot)?.marketRate ?? 0,
      offers: [offer],
    })
  }

  // Longest commitment first, so the table reads from safe to speculative.
  for (const group of groups.values()) group.offers.sort((a, b) => b.seasons - a.seasons)

  return [...groups.values()]
})

const commercialPerMatchday = computed(() =>
  (data.value?.deals ?? []).reduce((total, deal) => total + deal.baseFee, 0)
  + (data.value?.merchandising.perMatchday ?? 0))

async function refreshAll() {
  await Promise.all([refresh(), refreshSummary(), refreshProjection(), refreshTeam()])
}

async function respond(offer: Offer, action: 'accept' | 'decline') {
  // Selling the ground's name is the one deal that costs something other than
  // money, so it is the one that asks first.
  if (action === 'accept' && offer.slot === 'naming_rights') {
    pendingNaming.value = offer
    return
  }

  await send(offer, action)
}

async function send(offer: Offer, action: 'accept' | 'decline') {
  working.value = true
  try {
    const result = await $fetch<{ sponsorName?: string; slotLabel?: string; declined?: boolean }>(
      '/api/finance/commercial',
      { method: 'POST', body: { action, offerId: offer.id } },
    )
    await refreshAll()

    if (result.declined) {
      toast.info({ title: 'Offer declined', description: `${offer.sponsorName} will look elsewhere.` })
    }
    else {
      toast.success({
        title: `${offer.sponsorName} signed`,
        description: `${formatMoney(offer.baseFee)} a matchday until the end of season ${offer.untilSeason}.`,
      })
    }
  }
  catch (error) {
    toast.fromRequestError(error, 'Could not answer that offer')
  }
  finally {
    working.value = false
    pendingNaming.value = null
  }
}

async function upgradePerimeter() {
  working.value = true
  try {
    const result = await $fetch<{ tierName: string }>('/api/finance/commercial', {
      method: 'POST',
      body: { action: 'upgrade-perimeter' },
    })
    await refreshAll()
    toast.success({ title: 'Boards upgraded', description: `The ground now has ${result.tierName.toLowerCase()}.` })
  }
  catch (error) {
    toast.fromRequestError(error, 'Could not upgrade the boards')
  }
  finally {
    working.value = false
  }
}
</script>

<template>
  <div class="space-y-4 sm:space-y-5">
    <div class="flex items-center gap-2">
      <UIcon name="i-lucide-handshake" class="size-6" style="color: var(--app-accent)" />
      <h1 class="app-page-title">Commercial</h1>
      <span v-if="data" class="app-chip ml-auto">
        {{ formatMoneyCompact(commercialPerMatchday) }} a matchday
      </span>
    </div>

    <FinanceNav />

    <AppSkeleton v-if="status === 'pending' || !data" variant="card" />

    <template v-else>
      <!-- Offers first: they lapse, everything else does not. -->
      <UCard v-if="offerGroups.length" class="app-elevated">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-mail" class="size-4" style="color: var(--app-gold)" />
            Offers on the table
          </div>
        </template>

        <div class="space-y-5">
          <div v-for="group in offerGroups" :key="group.slot" class="space-y-2">
            <div class="flex flex-wrap items-baseline gap-2">
              <p class="app-kicker text-[10px]">{{ group.label }}</p>
              <p class="app-muted-text text-[11px]">
                worth about {{ formatMoney(group.marketRate) }} a matchday
              </p>
              <p
                v-if="group.slot === 'naming_rights'"
                class="app-chip app-chip--warning ml-auto"
              >
                <UIcon name="i-lucide-triangle-alert" class="size-3" />
                Supporters will not like losing the name
              </p>
            </div>

            <div class="grid gap-3 lg:grid-cols-3">
              <div
                v-for="(offer, index) in group.offers"
                :key="offer.id"
                class="app-surface-subtle flex flex-col gap-2 p-3 animate-fade-in-up"
                :style="`animation-delay: ${index * 0.05}s`"
              >
                <div class="flex items-start justify-between gap-2">
                  <p class="min-w-0 truncate text-sm font-bold" style="color: var(--app-text)">
                    {{ offer.sponsorName }}
                  </p>
                  <span class="app-chip shrink-0">
                    {{ offer.seasons }} {{ offer.seasons === 1 ? 'season' : 'seasons' }}
                  </span>
                </div>

                <div>
                  <p class="app-hero-number text-xl" style="color: var(--app-accent)">
                    {{ formatMoneyCompact(offer.baseFee) }}
                  </p>
                  <p class="app-muted-text text-[11px]">
                    a matchday · {{ formatMoneyCompact(offer.perSeason) }} a season
                  </p>
                </div>

                <dl class="space-y-1 text-[11px]">
                  <div class="flex justify-between">
                    <dt class="app-muted-text">Win the league</dt>
                    <dd class="font-semibold tabular-nums" style="color: var(--app-gold)">
                      {{ formatMoneyCompact(offer.bonusChampion) }}
                    </dd>
                  </div>
                  <div class="flex justify-between">
                    <dt class="app-muted-text">Top four</dt>
                    <dd class="font-semibold tabular-nums" style="color: var(--app-text-soft)">
                      {{ formatMoneyCompact(offer.bonusTopFour) }}
                    </dd>
                  </div>
                  <div class="flex justify-between">
                    <dt class="app-muted-text">Stay up</dt>
                    <dd class="font-semibold tabular-nums" style="color: var(--app-text-soft)">
                      {{ formatMoneyCompact(offer.bonusSurvival) }}
                    </dd>
                  </div>
                </dl>

                <p class="app-muted-text text-[10px]">
                  Lapses in {{ offer.roundsRemaining }} {{ offer.roundsRemaining === 1 ? 'matchday' : 'matchdays' }}
                </p>

                <div class="mt-auto flex gap-2 pt-1">
                  <UButton
                    label="Sign"
                    icon="i-lucide-pen-line"
                    size="xs"
                    class="flex-1 justify-center"
                    :loading="working"
                    @click="respond(offer, 'accept')"
                  />
                  <UButton
                    label="Decline"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    :loading="working"
                    @click="respond(offer, 'decline')"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </UCard>

      <!-- Current partners -->
      <UCard class="app-surface">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-handshake" class="size-4" style="color: var(--app-accent)" />
            Partners
          </div>
        </template>

        <div v-if="data.deals.length" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div
            v-for="deal in data.deals"
            :key="deal.id"
            class="app-metric-card"
            :style="deal.finalSeason ? { borderColor: 'var(--app-player-booked)' } : undefined"
          >
            <p class="app-kicker text-[10px]">{{ deal.slotLabel }}</p>
            <p class="mt-1 truncate text-sm font-bold" style="color: var(--app-text)">{{ deal.sponsorName }}</p>
            <p class="app-hero-number mt-1 text-xl" style="color: var(--app-accent)">
              {{ formatMoneyCompact(deal.baseFee) }}
            </p>
            <p class="app-muted-text text-[11px]">a matchday</p>
            <p
              class="mt-2 text-[11px]"
              :style="{ color: deal.finalSeason ? 'var(--app-player-booked)' : 'var(--app-text-muted)' }"
            >
              {{ deal.finalSeason
                ? 'Final season — offers are arriving'
                : `${deal.seasonsLeft} seasons to run` }}
            </p>
          </div>
        </div>
        <AppEmptyState
          v-else
          compact
          icon="i-lucide-handshake"
          title="No partners"
          description="Every slot is unsold. Offers arrive on matchdays."
        />
      </UCard>

      <div class="grid gap-4 lg:grid-cols-2">
        <!-- Hoardings -->
        <UCard class="app-surface">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-tv-minimal" class="size-4" style="color: var(--app-accent)" />
              Perimeter advertising
            </div>
          </template>

          <div class="space-y-3">
            <div class="grid grid-cols-2 gap-3">
              <div class="app-metric-card">
                <p class="app-kicker text-[10px]">Installed</p>
                <p class="mt-1 text-sm font-bold" style="color: var(--app-text)">{{ data.perimeter.tier.name }}</p>
              </div>
              <div class="app-metric-card">
                <p class="app-kicker text-[10px]">Per home match</p>
                <p class="app-hero-number mt-1 text-xl" style="color: var(--app-accent)">
                  {{ formatMoneyCompact(data.perimeter.perHomeMatch) }}
                </p>
              </div>
            </div>

            <ol class="space-y-1.5">
              <li
                v-for="tier in data.perimeter.tiers"
                :key="tier.level"
                class="flex items-center gap-2 text-xs"
                :style="{ color: tier.level === data.perimeter.level ? 'var(--app-accent)' : 'var(--app-text-muted)' }"
              >
                <UIcon
                  :name="tier.level <= data.perimeter.level ? 'i-lucide-circle-check' : 'i-lucide-circle-dashed'"
                  class="size-3.5 shrink-0"
                />
                {{ tier.name }}
                <span class="ml-auto tabular-nums">×{{ tier.multiplier }}</span>
              </li>
            </ol>

            <template v-if="!data.perimeter.atMax">
              <div class="app-divider" />
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0">
                  <p class="text-sm font-semibold" style="color: var(--app-text)">
                    Upgrade for {{ formatMoney(data.perimeter.upgradeCost) }}
                  </p>
                  <p class="app-muted-text text-[11px]">
                    {{ formatMoneyCompact(data.perimeter.nextPerHomeMatch) }} a home match
                    <template v-if="data.perimeter.paybackSeasons">
                      · pays for itself in about {{ data.perimeter.paybackSeasons }} seasons
                    </template>
                    <template v-if="!data.perimeter.canAfford"> · you cannot afford this</template>
                  </p>
                </div>
                <UButton
                  label="Upgrade"
                  icon="i-lucide-hammer"
                  size="sm"
                  color="neutral"
                  variant="soft"
                  :loading="working"
                  :disabled="!data.perimeter.canAfford"
                  @click="upgradePerimeter"
                />
              </div>
            </template>
          </div>
        </UCard>

        <!-- Shop -->
        <UCard class="app-surface">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-shopping-bag" class="size-4" style="color: var(--app-accent)" />
              Club shop
            </div>
          </template>

          <div class="space-y-3">
            <div class="app-elevated p-4">
              <p class="app-kicker text-[10px]">Merchandising</p>
              <p class="app-hero-number mt-1 text-2xl" style="color: var(--app-accent)">
                {{ formatMoneyCompact(data.merchandising.perMatchday) }}
              </p>
              <p class="app-muted-text mt-1 text-[11px]">a matchday</p>
            </div>

            <dl class="space-y-1.5 text-[11px]">
              <div class="flex justify-between">
                <dt class="app-muted-text">Supporter confidence</dt>
                <dd class="font-bold tabular-nums" style="color: var(--app-text)">{{ data.fanConfidence }}%</dd>
              </div>
              <div class="flex justify-between">
                <dt class="app-muted-text">Marquee name in the squad</dt>
                <dd
                  class="font-bold tabular-nums"
                  :style="{ color: data.merchandising.starPower > 0 ? 'var(--app-accent)' : 'var(--app-text-muted)' }"
                >
                  {{ data.merchandising.starPower > 0 ? `+${data.merchandising.starPower}` : data.merchandising.starPower }}
                </dd>
              </div>
            </dl>

            <p class="app-muted-text text-[11px]">
              The shop follows the support and whoever is on the back of the shirts.
              Sign a genuine star and he pays part of his own fee back through here —
              lose the dressing room and the shop notices before the accountant does.
            </p>
          </div>
        </UCard>
      </div>

      <!-- The ground's name -->
      <UCard class="app-surface">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-building" class="size-4" style="color: var(--app-accent)" />
            Naming rights
          </div>
        </template>

        <div class="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div>
            <p class="app-kicker text-[10px]">Currently called</p>
            <p class="mt-1 text-lg font-bold" style="color: var(--app-text)">{{ data.stadium.name }}</p>
          </div>
          <div v-if="data.stadium.namingRightsSold">
            <p class="app-kicker text-[10px]">Its own name</p>
            <p class="app-muted-text mt-1 text-sm">{{ data.stadium.baseName }}</p>
          </div>
          <p class="app-muted-text max-w-md text-[11px] sm:ml-auto">
            {{ data.stadium.namingRightsSold
              ? 'The name returns when the deal runs out.'
              : `Selling the name is worth about ${formatMoney(data.valuations.find(v => v.slot === 'naming_rights')?.marketRate ?? 0)} a matchday, and supporters will hold it against you.` }}
          </p>
        </div>
      </UCard>
    </template>

    <AppConfirmModal
      :open="pendingNaming !== null"
      tone="warning"
      icon="i-lucide-building"
      title="Sell the ground's name?"
      :description="pendingNaming
        ? `${pendingNaming.sponsorName} would put their name on the ground until the end of season ${pendingNaming.untilSeason}.`
        : ''"
      confirm-label="Sell the name"
      confirm-icon="i-lucide-pen-line"
      :loading="working"
      @confirm="pendingNaming && send(pendingNaming, 'accept')"
      @cancel="pendingNaming = null"
    >
      <template #consequences>
        <dl v-if="pendingNaming" class="space-y-1.5 text-xs">
          <div class="flex justify-between gap-4">
            <dt class="app-muted-text">Income</dt>
            <dd class="font-semibold tabular-nums" style="color: var(--app-accent)">
              {{ formatMoney(pendingNaming.baseFee) }} a matchday
            </dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="app-muted-text">Supporter confidence</dt>
            <dd class="font-semibold tabular-nums" style="color: var(--app-player-sent-off)">−9</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="app-muted-text">The name returns</dt>
            <dd class="font-semibold" style="color: var(--app-text)">end of season {{ pendingNaming.untilSeason }}</dd>
          </div>
        </dl>
      </template>
    </AppConfirmModal>
  </div>
</template>
