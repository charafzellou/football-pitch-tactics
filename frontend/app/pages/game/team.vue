<script setup lang="ts">
/**
 * Team — the full squad, with sell actions.
 *
 * Selling is permanent and is the largest financial decision in the game, but
 * it used to happen on a single unguarded click. It now goes through
 * `AppConfirmModal`, which states the fee, the resulting balance, and warns if
 * the sale would leave the squad unable to fill the current formation.
 */
import { computed, h, ref } from 'vue'
import { UBadge } from '#components'
import { LINEUP_SLOT_ORDER, normalizePosition, isAvailable } from '#shared/lineup'
import { evaluateTransferDeparture } from '#shared/squad-transfer'
import { developmentTrend } from '#shared/progression'
import { averageOf, formatMoney, formatMoneyCompact } from '~/utils/format'
import { sortableHeader, positionSortingFn } from '~/utils/table'
import type { SquadPlayer } from '~/composables/useGameContext'
import { useSettingsStore } from '~/stores/settings'

const toast = useAppToast()
const settings = useSettingsStore()
const { team, squad, gameState, refreshTeam } = useGameContext()

const selling = ref(false)
const pendingSale = ref<SquadPlayer | null>(null)
const detailPlayer = ref<SquadPlayer | null>(null)
const negotiatingId = ref<number | null>(null)

function saleEligibility(player: SquadPlayer) {
  return evaluateTransferDeparture(squad.value, player.id)
}

const detailSaleEligibility = computed(() =>
  detailPlayer.value ? saleEligibility(detailPlayer.value) : null,
)

const season = computed(() => gameState.value?.season ?? 1)

/** A deal that runs out this summer. Unrenewed, the player leaves on a free. */
function isExpiring(player: SquadPlayer) {
  return (player.contractUntilSeason ?? 0) <= season.value
}

function contractLabel(player: SquadPlayer) {
  const left = (player.contractUntilSeason ?? 0) - season.value
  if (left <= 0) return 'Final season'
  return `${left} season${left === 1 ? '' : 's'}`
}

const {
  slot: filterSlot,
  search: filterSearch,
  availableOnly,
  freshOnly,
  sort: filterSort,
  tabs: filterTabs,
  filtered,
  isFiltered,
  reset: resetFilters,
} = useSquadFilters(squad)

const summary = computed(() => {
  const players = squad.value
  if (!players.length) return null

  return {
    size: players.length,
    averageAge: averageOf(players.map(p => p.age)),
    averageSkill: averageOf(players.map(p => p.skillLevel)),
    totalValue: players.reduce((total, p) => total + p.marketValue, 0),
    injured: players.filter(p => !isAvailable(p)).length,
    tired: players.filter(p => p.stamina < 60).length,
    wageBill: players.reduce((total, p) => total + (p.wage ?? 0), 0),
    expiring: players.filter(isExpiring).length,
  }
})

/** Final-year players worth keeping, best first — the renewal shortlist. */
const expiringPlayers = computed(() =>
  squad.value.filter(isExpiring).sort((a, b) => b.skillLevel - a.skillLevel),
)

/** Count of fit players per slot, used for the depth warning when selling. */
const depthBySlot = computed(() => {
  const counts: Record<string, number> = { GK: 0, DF: 0, MF: 0, FW: 0 }
  for (const player of squad.value) {
    const normalized = normalizePosition(player.position)
    if (normalized && isAvailable(player)) counts[normalized]!++
  }
  return counts
})

/** Non-null when selling this player would drop a position below the formation's need. */
const saleDepthWarning = computed(() => {
  const player = pendingSale.value
  if (!player || !team.value) return null

  const normalized = normalizePosition(player.position)
  if (!normalized) return null

  const required = team.value.formation?.[normalized] ?? 0
  const remaining = (depthBySlot.value[normalized] ?? 0) - (isAvailable(player) ? 1 : 0)

  if (remaining >= required) return null
  return `This would leave ${remaining} fit ${normalized} for a formation that needs ${required}.`
})

const balanceAfterSale = computed(() => {
  if (!team.value || !pendingSale.value) return null
  // The engine adds a 5–50% premium on top of market value; show the floor so
  // the number can only be a pleasant surprise.
  return (team.value.bankBalance ?? 0) + pendingSale.value.marketValue
})

function requestSale(player: SquadPlayer) {
  const eligibility = saleEligibility(player)
  if (!eligibility.allowed) {
    toast.warn({
      title: `${player.name} is required`,
      description: eligibility.reason ?? 'This transfer would leave the squad below its minimum depth.',
    })
    return
  }

  if (!settings.confirmSelling) {
    void completeSale(player)
    return
  }
  pendingSale.value = player
}

async function confirmSale() {
  if (!pendingSale.value) return
  await completeSale(pendingSale.value)
}

async function completeSale(player: SquadPlayer) {
  selling.value = true

  try {
    const result = await $fetch<{ success: boolean; buyerTeam: string; salePrice: number }>('/api/transfers', {
      method: 'POST',
      body: { playerId: player.id, action: 'sell' },
    })

    await refreshTeam()
    pendingSale.value = null

    if (result?.success) {
      toast.success({
        title: `${player.name} sold`,
        description: `${formatMoney(result.salePrice)} from ${result.buyerTeam}.`,
      })
    }
  }
  catch (error) {
    toast.fromRequestError(error, `Could not sell ${player.name}`)
  }
  finally {
    selling.value = false
  }
}

const columns = [
  {
    accessorKey: 'name',
    id: 'name',
    header: sortableHeader('Name'),
    cell: ({ row }: { row: any }) => {
      const player = row.original as SquadPlayer
      const injured = player.injuredMatches ?? 0

      return h('div', { class: 'flex items-center gap-2' }, [
        h('button', {
          class: 'font-medium hover:underline text-left',
          style: injured ? 'color: var(--app-player-out)' : 'color: var(--app-text)',
          onClick: () => { detailPlayer.value = player },
        }, player.name),
        injured
          ? h(UBadge, {
              label: `Injured · ${injured}`,
              icon: 'i-lucide-bandage',
              color: 'error',
              variant: 'soft',
              size: 'sm',
            })
          : null,
      ])
    },
  },
  {
    accessorKey: 'age',
    id: 'age',
    header: sortableHeader('Age'),
    cell: ({ row }: { row: any }) => {
      const player = row.original as SquadPlayer
      const trend = developmentTrend(player.age, player.skillLevel, player.potential ?? player.skillLevel)
      const marks = {
        rising: { icon: 'i-lucide-trending-up', color: 'var(--app-accent)', title: 'Still improving' },
        peak: { icon: 'i-lucide-minus', color: 'var(--app-text-muted)', title: 'At their peak' },
        declining: { icon: 'i-lucide-trending-down', color: 'var(--app-player-sent-off)', title: 'Declining with age' },
      }[trend]

      return h('span', { class: 'flex items-center gap-1.5 tabular-nums', title: marks.title }, [
        String(player.age),
        h(resolveComponent('UIcon'), { name: marks.icon, class: 'size-3.5', style: `color: ${marks.color}` }),
      ])
    },
  },
  {
    accessorKey: 'position',
    id: 'position',
    header: sortableHeader('Position'),
    sortingFn: positionSortingFn,
    cell: ({ row }: { row: any }) => h(resolveComponent('AppPositionBadge'), { position: row.original.position }),
  },
  {
    accessorKey: 'skillLevel',
    id: 'skillLevel',
    header: sortableHeader('Skill'),
    cell: ({ row }: { row: any }) =>
      h(resolveComponent('AppStatBar'), { value: row.original.skillLevel ?? 0, showValue: true, class: 'min-w-28' }),
  },
  {
    accessorKey: 'stamina',
    id: 'stamina',
    header: sortableHeader('Stamina'),
    cell: ({ row }: { row: any }) =>
      h(resolveComponent('AppStatBar'), {
        value: row.original.stamina ?? 0,
        showValue: true,
        percent: true,
        threshold: true,
        class: 'min-w-28',
      }),
  },
  {
    accessorKey: 'marketValue',
    id: 'marketValue',
    header: sortableHeader('Market Value'),
    cell: ({ row }: { row: any }) => formatMoney(row.original.marketValue),
  },
  {
    accessorKey: 'wage',
    id: 'wage',
    header: sortableHeader('Wage'),
    cell: ({ row }: { row: any }) => h('span', { class: 'tabular-nums whitespace-nowrap' }, [
      formatMoney(row.original.wage ?? 0),
      h('span', { class: 'app-muted-text text-[10px]' }, ' /md'),
    ]),
  },
  {
    accessorKey: 'contractUntilSeason',
    id: 'contract',
    header: sortableHeader('Contract'),
    cell: ({ row }: { row: any }) => {
      const player = row.original as SquadPlayer
      const expiring = isExpiring(player)

      return h(UBadge, {
        label: contractLabel(player),
        icon: expiring ? 'i-lucide-clock-alert' : undefined,
        color: expiring ? 'error' : 'neutral',
        variant: 'soft',
        size: 'sm',
      })
    },
  },
  {
    id: 'actions',
    header: 'Actions',
    cell: ({ row }: { row: any }) => {
      const player = row.original as SquadPlayer
      const eligibility = saleEligibility(player)

      return h('div', { class: 'flex items-center gap-1.5' }, [
        h(resolveComponent('UButton'), {
          color: isExpiring(player) ? 'primary' : 'neutral',
          variant: 'soft',
          size: 'xs',
          icon: 'i-lucide-file-signature',
          label: 'Renew',
          title: `Open contract talks with ${player.name}`,
          onClick: () => { negotiatingId.value = player.id },
        }),
        h('span', {
          class: 'inline-flex',
          title: eligibility.reason ?? `Sell ${player.name}`,
        }, [
          h(resolveComponent('UButton'), {
            color: 'error',
            variant: 'soft',
            size: 'xs',
            icon: 'i-lucide-tag',
            label: 'Sell',
            disabled: !eligibility.allowed,
            'aria-label': eligibility.reason ?? `Sell ${player.name}`,
            onClick: () => requestSale(player),
          }),
        ]),
      ])
    },
  },
]
</script>

<template>
  <div class="space-y-4 sm:space-y-5">
    <div class="flex items-center gap-2">
      <UIcon name="i-lucide-users" class="size-6" style="color: var(--app-accent)" />
      <h1 class="app-page-title">Team Squad</h1>
      <span v-if="team" class="app-chip ml-auto">{{ team.name }}</span>
    </div>

    <AppSkeleton v-if="!team" variant="table" />

    <template v-else>
      <!-- Squad summary -->
      <div v-if="summary" class="grid animate-fade-in-up grid-cols-2 gap-3 lg:grid-cols-7">
        <div class="app-metric-card">
          <p class="app-kicker text-[10px]">Squad size</p>
          <p class="app-hero-number mt-1 text-2xl">{{ summary.size }}</p>
        </div>
        <div class="app-metric-card">
          <p class="app-kicker text-[10px]">Average age</p>
          <p class="app-hero-number mt-1 text-2xl">{{ summary.averageAge }}</p>
        </div>
        <div class="app-metric-card">
          <p class="app-kicker text-[10px]">Average skill</p>
          <p class="app-hero-number mt-1 text-2xl">{{ summary.averageSkill }}</p>
        </div>
        <div class="app-metric-card">
          <p class="app-kicker text-[10px]">Total value</p>
          <AppCountUp :value="summary.totalValue" :format="formatMoneyCompact" class="app-hero-number mt-1 text-2xl" />
        </div>
        <div class="app-metric-card">
          <p class="app-kicker text-[10px]">Wage bill</p>
          <AppCountUp :value="summary.wageBill" :format="formatMoneyCompact" class="app-hero-number mt-1 text-2xl" />
          <p class="app-muted-text mt-0.5 text-[10px]">per matchday</p>
        </div>
        <div class="app-metric-card">
          <p class="app-kicker text-[10px]">Injured</p>
          <p
            class="app-hero-number mt-1 text-2xl"
            :style="summary.injured ? 'color: var(--app-player-injured)' : undefined"
          >{{ summary.injured }}</p>
        </div>
        <div class="app-metric-card">
          <p class="app-kicker text-[10px]">Below 60% fit</p>
          <p
            class="app-hero-number mt-1 text-2xl"
            :style="summary.tired ? 'color: var(--app-player-booked)' : undefined"
          >{{ summary.tired }}</p>
        </div>
      </div>

      <!--
        Expiring deals.
        A contract runs out silently at the rollover, so this has to be
        impossible to miss: it is the one squad decision with a deadline.
      -->
      <div
        v-if="expiringPlayers.length"
        class="app-elevated animate-fade-in-up p-4 sm:p-5"
        style="border-color: color-mix(in srgb, var(--app-player-injured) 40%, transparent)"
      >
        <div class="flex flex-wrap items-center gap-3">
          <div
            class="flex size-10 shrink-0 items-center justify-center rounded-2xl"
            style="background-color: var(--app-badge-warning-bg); color: var(--app-badge-warning-text)"
          >
            <UIcon name="i-lucide-clock-alert" class="size-5" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="font-bold" style="color: var(--app-text)">
              {{ expiringPlayers.length }} contract{{ expiringPlayers.length === 1 ? '' : 's' }} expiring this summer
            </p>
            <p class="app-muted-text text-xs">
              Anyone still unsigned at the season rollover leaves on a free transfer.
            </p>
          </div>
        </div>

        <div class="mt-3 flex flex-wrap gap-2">
          <button
            v-for="player in expiringPlayers"
            :key="player.id"
            type="button"
            class="app-surface-subtle flex items-center gap-2 px-3 py-1.5 text-xs transition hover:-translate-y-0.5"
            :title="`Open contract talks with ${player.name}`"
            @click="negotiatingId = player.id"
          >
            <AppPositionBadge :position="player.position" size="xs" />
            <span class="font-semibold" style="color: var(--app-text)">{{ player.name }}</span>
            <span class="app-muted-text tabular-nums">{{ player.skillLevel }}</span>
            <UIcon name="i-lucide-file-signature" class="size-3.5" style="color: var(--app-accent)" />
          </button>
        </div>
      </div>

      <UCard class="app-surface">
        <template #header>
          <SquadFilters
            v-model:slot="filterSlot"
            v-model:search="filterSearch"
            v-model:available-only="availableOnly"
            v-model:fresh-only="freshOnly"
            v-model:sort="filterSort"
            :tabs="filterTabs"
            :result-count="filtered.length"
            :is-filtered="isFiltered"
            show-availability
            @reset="resetFilters"
          />
        </template>

        <div v-if="filtered.length" class="app-table-shell">
          <div class="min-w-max">
            <UTable :data="filtered" :columns="columns" />
          </div>
        </div>

        <AppEmptyState
          v-else
          icon="i-lucide-search-x"
          title="No players match those filters"
          action-label="Clear filters"
          @action="resetFilters"
        />
      </UCard>
    </template>

    <!-- Sell confirmation -->
    <AppConfirmModal
      :open="Boolean(pendingSale)"
      tone="danger"
      icon="i-lucide-tag"
      :title="`Sell ${pendingSale?.name}?`"
      description="Transfers are permanent. The player leaves your squad immediately and cannot be bought back at this price."
      confirm-label="Sell player"
      confirm-icon="i-lucide-tag"
      :loading="selling"
      @confirm="confirmSale"
      @cancel="pendingSale = null"
    >
      <template #consequences>
        <dl v-if="pendingSale" class="space-y-1.5">
          <div class="flex items-center justify-between gap-4">
            <dt class="app-muted-text">Player</dt>
            <dd class="flex items-center gap-2 font-semibold" style="color: var(--app-text)">
              <AppPositionBadge :position="pendingSale.position" size="xs" />
              {{ pendingSale.name }} · {{ pendingSale.skillLevel }} OVR
            </dd>
          </div>
          <div class="flex items-center justify-between gap-4">
            <dt class="app-muted-text">Minimum fee</dt>
            <dd class="font-semibold" style="color: var(--app-accent)">
              {{ formatMoney(pendingSale.marketValue) }}
            </dd>
          </div>
          <div class="flex items-center justify-between gap-4">
            <dt class="app-muted-text">Balance after</dt>
            <dd class="font-semibold" style="color: var(--app-text)">
              {{ balanceAfterSale !== null ? formatMoney(balanceAfterSale) : '—' }}
            </dd>
          </div>
        </dl>

        <p
          v-if="saleDepthWarning"
          class="mt-3 flex items-start gap-2 rounded-lg p-2 text-xs"
          style="background-color: var(--app-badge-warning-bg); color: var(--app-badge-warning-text)"
        >
          <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-3.5 shrink-0" />
          {{ saleDepthWarning }}
        </p>
      </template>
    </AppConfirmModal>

    <!-- Player detail -->
    <UModal
      :open="Boolean(detailPlayer)"
      :title="detailPlayer?.name ?? 'Player'"
      description="Player attributes and market value"
      :ui="{ content: 'sm:max-w-md' }"
      @update:open="value => !value && (detailPlayer = null)"
    >
      <template #content>
        <div v-if="detailPlayer" class="app-surface animate-scale-in p-5 sm:p-6">
          <div class="mb-4 flex items-center gap-3">
            <div
              class="flex size-12 shrink-0 items-center justify-center rounded-2xl text-base font-black"
              style="background-color: var(--app-accent-soft); color: var(--app-accent)"
            >{{ detailPlayer.skillLevel }}</div>
            <div class="min-w-0 flex-1">
              <h2 class="truncate text-lg font-bold" style="color: var(--app-text)">{{ detailPlayer.name }}</h2>
              <div class="mt-1 flex items-center gap-2">
                <AppPositionBadge :position="detailPlayer.position" size="xs" />
                <span class="app-muted-text text-xs">{{ detailPlayer.age }} years old</span>
              </div>
            </div>
          </div>

          <dl class="space-y-3">
            <div>
              <dt class="app-kicker mb-1 text-[10px]">Skill</dt>
              <dd><AppStatBar :value="detailPlayer.skillLevel" show-value /></dd>
            </div>
            <div>
              <dt class="app-kicker mb-1 text-[10px]">Stamina</dt>
              <dd><AppStatBar :value="detailPlayer.stamina" show-value percent threshold /></dd>
            </div>
            <div v-if="(detailPlayer.potential ?? 0) > detailPlayer.skillLevel">
              <dt class="app-kicker mb-1 flex items-center justify-between text-[10px]">
                <span>Growth headroom</span>
                <span style="color: var(--app-accent)">ceiling {{ detailPlayer.potential }}</span>
              </dt>
              <dd>
                <div class="app-stat-bar-track">
                  <div
                    class="app-stat-bar-fill"
                    :style="{ width: `${detailPlayer.potential}%`, opacity: 0.35 }"
                  />
                </div>
                <p class="app-muted-text mt-1 text-[11px]">
                  {{ (detailPlayer.potential ?? 0) - detailPlayer.skillLevel }} points of potential left to reach.
                </p>
              </dd>
            </div>

            <div class="flex items-center justify-between">
              <dt class="app-kicker text-[10px]">Market value</dt>
              <dd class="font-bold" style="color: var(--app-accent)">{{ formatMoney(detailPlayer.marketValue) }}</dd>
            </div>
            <div class="flex items-center justify-between">
              <dt class="app-kicker text-[10px]">Wage</dt>
              <dd class="font-semibold" style="color: var(--app-text)">
                {{ formatMoney(detailPlayer.wage ?? 0) }}
                <span class="app-muted-text text-xs">/ matchday</span>
              </dd>
            </div>
            <div class="flex items-center justify-between">
              <dt class="app-kicker text-[10px]">Contract</dt>
              <dd
                class="font-semibold"
                :style="{ color: isExpiring(detailPlayer) ? 'var(--app-player-injured)' : 'var(--app-text)' }"
              >
                {{ contractLabel(detailPlayer) }}
              </dd>
            </div>
            <div v-if="(detailPlayer.injuredMatches ?? 0) > 0" class="flex items-center justify-between">
              <dt class="app-kicker text-[10px]">Availability</dt>
              <dd class="font-semibold" style="color: var(--app-player-injured)">
                Out for {{ detailPlayer.injuredMatches }} match{{ detailPlayer.injuredMatches === 1 ? '' : 'es' }}
              </dd>
            </div>
          </dl>

          <p
            v-if="detailSaleEligibility && !detailSaleEligibility.allowed"
            class="mt-4 flex items-start gap-2 rounded-lg p-2 text-xs"
            style="background-color: var(--app-badge-warning-bg); color: var(--app-badge-warning-text)"
          >
            <UIcon name="i-lucide-shield-alert" class="mt-0.5 size-3.5 shrink-0" />
            {{ detailSaleEligibility.reason }}
          </p>

          <div class="mt-5 flex justify-end gap-2">
            <UButton label="Close" color="neutral" variant="soft" @click="() => { detailPlayer = null }" />
            <UButton
              label="Renew"
              icon="i-lucide-file-signature"
              variant="soft"
              @click="() => { const p = detailPlayer; detailPlayer = null; if (p) negotiatingId = p.id }"
            />
            <UButton
              label="Sell player"
              icon="i-lucide-tag"
              color="error"
              :disabled="!detailSaleEligibility?.allowed"
              :title="detailSaleEligibility?.reason ?? `Sell ${detailPlayer.name}`"
              @click="() => { const p = detailPlayer; detailPlayer = null; if (p) requestSale(p) }"
            />
          </div>
        </div>
      </template>
    </UModal>

    <ContractModal
      :player-id="negotiatingId"
      :team-id="team?.id ?? null"
      @close="negotiatingId = null"
      @renewed="refreshTeam"
    />
  </div>
</template>
