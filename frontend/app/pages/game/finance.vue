<script setup lang="ts">
/**
 * Finance — where the money is, where it came from, and where it's heading.
 *
 * Every figure traces back to a `finance_ledger` row, so the balance shown here
 * can always be explained rather than merely asserted.
 */
import { computed, ref, watch } from 'vue'
import { formatMoney, formatMoneyCompact } from '~/utils/format'

const toast = useAppToast()
const { team, refreshTeam } = useGameContext()

const { data: finance, refresh, status } = useAsyncData(
  'finance-summary',
  () => $fetch<any>('/api/finance/summary'),
)

const saving = ref(false)
const draftPrice = ref<number>(30)

// Seeded from the club's saved price once the summary arrives.
const priceInitialised = ref(false)
watch(finance, (value) => {
  if (value && !priceInitialised.value) {
    draftPrice.value = value.club.ticketPrice
    priceInitialised.value = true
  }
}, { immediate: true })

const priceDelta = computed(() => {
  if (!finance.value) return 0
  return draftPrice.value - finance.value.club.fairTicketPrice
})

/** Plain-language read on the current price, since the number alone says little. */
const priceVerdict = computed(() => {
  const delta = priceDelta.value
  const fair = finance.value?.club.fairTicketPrice ?? 30
  const ratio = delta / fair

  if (ratio > 0.35) return { text: 'Well above what supporters expect — expect empty seats', tone: 'danger' }
  if (ratio > 0.12) return { text: 'Above the going rate; some will stay away', tone: 'warning' }
  if (ratio < -0.25) return { text: 'Cheap — a full house, but you are leaving money behind', tone: 'warning' }
  return { text: 'About what supporters expect', tone: 'success' }
})

const INCOME_TYPES = ['gate', 'sponsorship', 'prize', 'transfer_in']
const TYPE_LABELS: Record<string, string> = {
  gate: 'Gate receipts',
  sponsorship: 'Commercial',
  prize: 'Prize money',
  transfer_in: 'Player sales',
  wages: 'Wages',
  transfer_out: 'Transfer fees',
  stadium: 'Stadium works',
}

const breakdown = computed(() => {
  const byType: Record<string, number> = finance.value?.byType ?? {}
  const rows = Object.entries(byType)
    .map(([type, amount]) => ({ type, label: TYPE_LABELS[type] ?? type, amount: amount as number }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))

  return {
    income: rows.filter(r => INCOME_TYPES.includes(r.type) && r.amount !== 0),
    expenses: rows.filter(r => !INCOME_TYPES.includes(r.type) && r.amount !== 0),
  }
})

async function saveTicketPrice() {
  if (!team.value) return

  saving.value = true
  try {
    await $fetch(`/api/team/${team.value.id}/stadium` as string, {
      method: 'PUT',
      body: { ticketPrice: draftPrice.value },
    })
    await Promise.all([refresh(), refreshTeam()])
    toast.success({ title: 'Ticket price updated', description: `Now €${draftPrice.value} per seat.` })
  }
  catch (error) {
    toast.fromRequestError(error, 'Could not update the ticket price')
  }
  finally {
    saving.value = false
  }
}

async function expandStadium() {
  if (!team.value) return

  saving.value = true
  try {
    const result = await $fetch<any>(`/api/team/${team.value.id}/stadium` as string, {
      method: 'PUT',
      body: { expand: true },
    })
    await Promise.all([refresh(), refreshTeam()])
    toast.success({
      title: 'Stadium expanded',
      description: `Capacity is now ${result.stadiumCapacity.toLocaleString('en-IE')}.`,
    })
  }
  catch (error) {
    toast.fromRequestError(error, 'Could not expand the stadium')
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="space-y-4 sm:space-y-5">
    <div class="flex items-center gap-2">
      <UIcon name="i-lucide-banknote" class="size-6" style="color: var(--app-accent)" />
      <h1 class="app-page-title">Finances</h1>
      <span v-if="finance" class="app-chip ml-auto">
        Round {{ finance.round }} of {{ finance.totalRounds }}
      </span>
    </div>

    <AppSkeleton v-if="status === 'pending' || !finance" variant="card" />

    <template v-else>
      <!-- Headline -->
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div class="app-elevated p-4">
          <p class="app-kicker text-[10px]">Balance</p>
          <AppCountUp
            :value="finance.club.balance"
            :format="formatMoneyCompact"
            class="app-hero-number mt-1 text-3xl"
            :style="{ color: finance.club.balance < 0 ? 'var(--app-player-sent-off)' : 'var(--app-text)' }"
          />
          <p class="app-muted-text mt-1 text-[11px]">{{ formatMoney(finance.club.balance) }}</p>
        </div>

        <div class="app-metric-card">
          <p class="app-kicker text-[10px]">Season income</p>
          <p class="app-hero-number mt-1 text-2xl" style="color: var(--app-accent)">
            {{ formatMoneyCompact(finance.income) }}
          </p>
        </div>

        <div class="app-metric-card">
          <p class="app-kicker text-[10px]">Season outgoings</p>
          <p class="app-hero-number mt-1 text-2xl" style="color: var(--app-player-sent-off)">
            {{ formatMoneyCompact(Math.abs(finance.expenses)) }}
          </p>
        </div>

        <div class="app-metric-card">
          <p class="app-kicker text-[10px]">Projected at season end</p>
          <p
            class="app-hero-number mt-1 text-2xl"
            :style="{ color: finance.projectedBalance < 0 ? 'var(--app-player-sent-off)' : 'var(--app-text)' }"
          >{{ formatMoneyCompact(finance.projectedBalance) }}</p>
          <p class="app-muted-text mt-1 text-[11px]">At the current rate</p>
        </div>
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <!-- Wage pressure -->
        <UCard class="app-surface">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-users" class="size-4" style="color: var(--app-accent)" />
              Wage bill
            </div>
          </template>

          <div class="space-y-3">
            <div class="flex items-end justify-between gap-4">
              <div>
                <p class="app-kicker text-[10px]">Per matchday</p>
                <p class="app-hero-number text-2xl">{{ formatMoneyCompact(finance.wageBill) }}</p>
              </div>
              <div class="text-right">
                <p class="app-kicker text-[10px]">Across the season</p>
                <p class="text-lg font-bold" style="color: var(--app-text)">
                  {{ formatMoneyCompact(finance.wageBillPerSeason) }}
                </p>
              </div>
            </div>

            <div v-if="finance.wageRatio !== null">
              <div class="mb-1 flex items-center justify-between text-xs">
                <span class="app-muted-text">Share of income</span>
                <span
                  class="font-bold tabular-nums"
                  :style="{ color: finance.wageRatio > 80 ? 'var(--app-player-sent-off)' : finance.wageRatio > 65 ? 'var(--app-player-booked)' : 'var(--app-accent)' }"
                >{{ finance.wageRatio }}%</span>
              </div>
              <AppStatBar
                :value="Math.min(100, finance.wageRatio)"
                :tone="finance.wageRatio > 80 ? 'danger' : finance.wageRatio > 65 ? 'warning' : 'default'"
              />
              <p class="app-muted-text mt-1.5 text-[11px]">
                {{ finance.wageRatio > 80
                  ? 'Unsustainable — wages are eating almost everything you earn.'
                  : finance.wageRatio > 65
                    ? 'High. Little room to strengthen without selling.'
                    : 'Comfortable. There is room to invest.' }}
              </p>
            </div>
          </div>
        </UCard>

        <!-- Stadium -->
        <UCard class="app-surface">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-building" class="size-4" style="color: var(--app-accent)" />
              {{ finance.club.stadiumName ?? 'Stadium' }}
            </div>
          </template>

          <div class="space-y-4">
            <div class="grid grid-cols-2 gap-3">
              <div class="app-metric-card">
                <p class="app-kicker text-[10px]">Capacity</p>
                <p class="app-hero-number mt-1 text-xl">
                  {{ finance.club.stadiumCapacity.toLocaleString('en-IE') }}
                </p>
              </div>
              <div class="app-metric-card">
                <p class="app-kicker text-[10px]">Typical crowd</p>
                <p class="app-hero-number mt-1 text-xl">
                  {{ finance.preview.attendance.toLocaleString('en-IE') }}
                </p>
                <p class="app-muted-text text-[11px]">{{ finance.preview.fillPercent }}% full</p>
              </div>
            </div>

            <div>
              <label class="app-kicker mb-2 block text-[10px]">
                Ticket price — €{{ draftPrice }}
                <span class="app-muted-text normal-case">
                  (supporters expect about €{{ finance.club.fairTicketPrice }})
                </span>
              </label>
              <USlider v-model="draftPrice" :min="5" :max="120" :step="1" />

              <p
                class="mt-2 flex items-center gap-1.5 text-[11px]"
                :style="{
                  color: priceVerdict.tone === 'danger' ? 'var(--app-player-sent-off)'
                    : priceVerdict.tone === 'warning' ? 'var(--app-player-booked)'
                      : 'var(--app-accent)',
                }"
              >
                <UIcon name="i-lucide-info" class="size-3 shrink-0" />
                {{ priceVerdict.text }}
              </p>

              <div class="mt-3 flex items-center gap-2">
                <UButton
                  label="Apply price"
                  icon="i-lucide-check"
                  size="sm"
                  :loading="saving"
                  :disabled="draftPrice === finance.club.ticketPrice"
                  @click="saveTicketPrice"
                />
                <span class="app-muted-text text-[11px]">
                  ≈ {{ formatMoneyCompact(finance.preview.gatePerMatch) }} per home match
                </span>
              </div>
            </div>

            <div class="app-divider" />

            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <p class="text-sm font-semibold" style="color: var(--app-text)">
                  Add {{ finance.expansion.step.toLocaleString('en-IE') }} seats
                </p>
                <p class="app-muted-text text-[11px]">
                  {{ formatMoney(finance.expansion.cost) }}
                  <template v-if="finance.expansion.atMax"> · already at maximum</template>
                  <template v-else-if="!finance.expansion.canAfford"> · you cannot afford this</template>
                </p>
              </div>
              <UButton
                label="Expand"
                icon="i-lucide-hammer"
                size="sm"
                color="neutral"
                variant="soft"
                :loading="saving"
                :disabled="finance.expansion.atMax || !finance.expansion.canAfford"
                @click="expandStadium"
              />
            </div>
          </div>
        </UCard>
      </div>

      <!-- Breakdown -->
      <div class="grid gap-4 lg:grid-cols-2">
        <UCard class="app-surface">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-trending-up" class="size-4" style="color: var(--app-accent)" />
              Income this season
            </div>
          </template>
          <ul v-if="breakdown.income.length" class="space-y-2">
            <li v-for="row in breakdown.income" :key="row.type" class="flex items-center justify-between text-sm">
              <span class="app-muted-text">{{ row.label }}</span>
              <span class="font-bold tabular-nums" style="color: var(--app-accent)">
                {{ formatMoney(row.amount) }}
              </span>
            </li>
          </ul>
          <AppEmptyState v-else compact icon="i-lucide-inbox" title="No income recorded yet" />
        </UCard>

        <UCard class="app-surface">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-trending-down" class="size-4" style="color: var(--app-player-sent-off)" />
              Outgoings this season
            </div>
          </template>
          <ul v-if="breakdown.expenses.length" class="space-y-2">
            <li v-for="row in breakdown.expenses" :key="row.type" class="flex items-center justify-between text-sm">
              <span class="app-muted-text">{{ row.label }}</span>
              <span class="font-bold tabular-nums" style="color: var(--app-player-sent-off)">
                {{ formatMoney(row.amount) }}
              </span>
            </li>
          </ul>
          <AppEmptyState v-else compact icon="i-lucide-inbox" title="No outgoings recorded yet" />
        </UCard>
      </div>

      <!-- Ledger -->
      <UCard class="app-surface">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-receipt" class="size-4" style="color: var(--app-accent)" />
            Recent transactions
          </div>
        </template>

        <div v-if="finance.ledger.length" class="app-table-shell">
          <table class="w-full min-w-max border-collapse text-sm">
            <thead>
              <tr style="border-bottom: 1px solid var(--app-surface-border)">
                <th class="app-kicker px-3 py-2 text-left text-[10px]">Round</th>
                <th class="app-kicker px-3 py-2 text-left text-[10px]">Type</th>
                <th class="app-kicker px-3 py-2 text-left text-[10px]">Detail</th>
                <th class="app-kicker px-3 py-2 text-right text-[10px]">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(entry, index) in finance.ledger"
                :key="index"
                style="border-bottom: 1px solid var(--app-surface-border)"
              >
                <td class="px-3 py-2 tabular-nums" style="color: var(--app-text-muted)">
                  {{ entry.round || '—' }}
                </td>
                <td class="px-3 py-2">
                  <span class="app-chip">{{ TYPE_LABELS[entry.type] ?? entry.type }}</span>
                </td>
                <td class="px-3 py-2" style="color: var(--app-text-soft)">{{ entry.description }}</td>
                <td
                  class="px-3 py-2 text-right font-bold tabular-nums"
                  :style="{ color: entry.amount > 0 ? 'var(--app-accent)' : 'var(--app-player-sent-off)' }"
                >
                  {{ entry.amount > 0 ? '+' : '' }}{{ formatMoney(entry.amount) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <AppEmptyState
          v-else
          icon="i-lucide-receipt"
          title="No transactions yet"
          description="Money moves on every matchday."
        />
      </UCard>
    </template>
  </div>
</template>
