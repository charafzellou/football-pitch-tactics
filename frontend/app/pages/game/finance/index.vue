<script setup lang="ts">
/**
 * Finance overview — the club's profit and loss for the season so far.
 *
 * Every figure traces back to a `finance_ledger` row, so the balance shown here
 * can always be explained rather than merely asserted. The page deliberately
 * reports and never blocks: budgets in this game advise, and the only thing that
 * bites is the balance actually going negative, which is what the health banner
 * is for.
 */
import { computed, ref, watch } from 'vue'
import { formatDelta, formatMoney, formatMoneyCompact } from '~/utils/format'
import { COST_GROUPS, INCOME_GROUPS, healthStage, streamMeta } from '#shared/finance'
import type { FinanceStream, LoanRow } from '~/composables/useFinance'

const toast = useAppToast()
const { refreshTeam } = useGameContext()
const { finance, status, refresh: refreshSummary } = useFinanceSummary()
const { debt, refresh: refreshDebt } = useFinanceLoans()
const { refresh: refreshProjection } = useFinanceProjection()

interface StreamGroup {
  name: string
  total: number
  rows: FinanceStream[]
}

/** Streams gathered under their profit-and-loss heading, biggest first. */
function group(kind: 'income' | 'cost', order: readonly string[]): StreamGroup[] {
  const rows = (finance.value?.streams ?? []).filter(row => row.kind === kind && row.amount > 0)

  return order
    .map(name => ({
      name,
      rows: rows.filter(row => row.group === name),
      total: rows.filter(row => row.group === name).reduce((total, row) => total + row.amount, 0),
    }))
    .filter(entry => entry.rows.length > 0)
}

const incomeGroups = computed(() => group('income', INCOME_GROUPS))
const costGroups = computed(() => group('cost', COST_GROUPS))

const health = computed(() => healthStage(finance.value?.health.stage ?? 0))

/** What the club is being told, in the order it would hear it. */
const healthMessage = computed(() => {
  const stage = finance.value?.health.stage ?? 0
  const rounds = finance.value?.health.insolventRounds ?? 0

  if (stage >= 3) return 'The board has taken control of the finances. Expect a forced sale.'
  if (stage >= 2) return `Overdrawn for ${rounds} matchdays. The board has placed the club under a transfer embargo.`
  if (stage >= 1) return 'The club is overdrawn and paying interest on it.'
  return ''
})

const wageTone = computed(() => {
  const ratio = finance.value?.wageRatio ?? 0
  if (ratio > 80) return { tone: 'danger' as const, color: 'var(--app-player-sent-off)' }
  if (ratio > 65) return { tone: 'warning' as const, color: 'var(--app-player-booked)' }
  return { tone: 'default' as const, color: 'var(--app-accent)' }
})

const wageVerdict = computed(() => {
  const ratio = finance.value?.wageRatio ?? 0
  if (ratio > 80) return 'Unsustainable — wages are eating almost everything you earn.'
  if (ratio > 65) return 'High. Little room to strengthen without selling.'
  return 'Comfortable. There is room to invest.'
})

// ---------------------------------------------------------------------------
// Borrowing
// ---------------------------------------------------------------------------

const saving = ref(false)
const draftAmount = ref(0)
const draftTerm = ref(3)

// Seeded from the limit once it arrives, so the slider opens somewhere useful
// rather than at zero.
watch(debt, (value) => {
  if (value && draftAmount.value === 0)
    draftAmount.value = Math.min(value.limit, Math.max(value.minLoan, value.step * 4))
}, { immediate: true })

/**
 * What the drafted loan would actually cost, computed from the terms the server
 * sent rather than re-derived — the page must never quote a rate the endpoint
 * would not write.
 */
const loanPreview = computed(() => {
  const payload = debt.value
  if (!payload || draftAmount.value < payload.minLoan) return null

  const term = payload.terms.find(row => row.seasons === draftTerm.value)
  if (!term) return null

  const millions = draftAmount.value / 1_000_000

  return {
    repaymentPerRound: Math.round(term.repaymentPerRoundPerMillion * millions),
    interest: Math.round(term.interestPerMillion * millions),
    untilSeason: payload.season + draftTerm.value - 1,
  }
})

const canBorrow = computed(() => {
  const payload = debt.value
  return !!payload
    && payload.limit >= payload.minLoan
    && draftAmount.value >= payload.minLoan
    && draftAmount.value <= payload.limit
})

async function refreshAll() {
  await Promise.all([refreshSummary(), refreshDebt(), refreshProjection(), refreshTeam()])
}

async function post(
  body: Record<string, unknown>,
  success: (result: any) => { title: string; description: string },
  failure: string,
) {
  saving.value = true
  try {
    const result = await $fetch<any>('/api/finance/loans', { method: 'POST', body })
    await refreshAll()
    toast.success(success(result))
  }
  catch (error) {
    toast.fromRequestError(error, failure)
  }
  finally {
    saving.value = false
  }
}

const borrow = () => post(
  { amount: draftAmount.value, seasons: draftTerm.value },
  result => ({
    title: `${formatMoney(result.amount)} drawn down`,
    description: `${formatMoney(result.repaymentPerRound)} of principal plus interest every matchday.`,
  }),
  'No lender would write that',
)

const settle = (loan: LoanRow) => post(
  { action: 'repay', loanId: loan.id, amount: loan.outstanding },
  () => ({ title: 'Loan settled', description: 'Nothing more leaves the account for it.' }),
  'Could not settle that loan',
)
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

    <FinanceNav />

    <AppSkeleton v-if="status === 'pending' || !finance" variant="card" />

    <template v-else>
      <!-- Only shown when there is something wrong: a permanent "everything is
           fine" banner is furniture, not information. -->
      <div
        v-if="finance.health.stage > 0"
        class="app-surface-subtle flex items-start gap-3 p-4"
        :style="{ borderColor: 'var(--app-player-sent-off)' }"
      >
        <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-5 shrink-0" style="color: var(--app-player-sent-off)" />
        <div class="min-w-0">
          <p class="text-sm font-bold" style="color: var(--app-player-sent-off)">{{ health.label }}</p>
          <p class="app-muted-text mt-0.5 text-[11px]">{{ healthMessage }}</p>
        </div>
      </div>

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
          <p class="app-kicker text-[10px]">Turnover</p>
          <p class="app-hero-number mt-1 text-2xl" style="color: var(--app-accent)">
            {{ formatMoneyCompact(finance.turnover) }}
          </p>
          <p class="app-muted-text mt-1 text-[11px]">
            {{ formatMoneyCompact(finance.income) }} in, less {{ formatMoneyCompact(finance.runningCosts) }} to run the club
          </p>
        </div>

        <div class="app-metric-card">
          <p class="app-kicker text-[10px]">Season result</p>
          <p
            class="app-hero-number mt-1 text-2xl"
            :style="{ color: finance.net < 0 ? 'var(--app-player-sent-off)' : 'var(--app-accent)' }"
          >{{ formatDelta(finance.net, true) }}</p>
          <p class="app-muted-text mt-1 text-[11px]">Income less everything</p>
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

      <!-- Profit and loss -->
      <div class="grid gap-4 lg:grid-cols-2">
        <UCard class="app-surface">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-trending-up" class="size-4" style="color: var(--app-accent)" />
              Where the money comes from
              <span class="app-chip ml-auto">{{ formatMoneyCompact(finance.income) }}</span>
            </div>
          </template>

          <div v-if="incomeGroups.length" class="space-y-4">
            <div v-for="entry in incomeGroups" :key="entry.name" class="space-y-2">
              <div class="flex items-baseline justify-between">
                <p class="app-kicker text-[10px]">{{ entry.name }}</p>
                <p class="text-xs font-bold tabular-nums" style="color: var(--app-text-soft)">
                  {{ formatMoneyCompact(entry.total) }}
                </p>
              </div>
              <div
                v-for="row in entry.rows"
                :key="row.type"
                class="app-surface-subtle flex items-center gap-3 px-3 py-2"
              >
                <UIcon :name="row.icon" class="size-4 shrink-0" style="color: var(--app-accent)" />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm" style="color: var(--app-text)">{{ row.label }}</p>
                  <div class="app-stat-bar-track mt-1 h-1">
                    <div class="app-stat-bar-fill" :style="{ width: `${row.share}%` }" />
                  </div>
                </div>
                <div class="shrink-0 text-right">
                  <p class="text-sm font-bold tabular-nums" style="color: var(--app-accent)">
                    {{ formatMoneyCompact(row.amount) }}
                  </p>
                  <p class="app-muted-text text-[10px] tabular-nums">
                    {{ formatMoneyCompact(row.perMatchday) }}/md
                  </p>
                </div>
              </div>
            </div>
          </div>
          <AppEmptyState v-else compact icon="i-lucide-inbox" title="No income recorded yet" />
        </UCard>

        <UCard class="app-surface">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-trending-down" class="size-4" style="color: var(--app-player-sent-off)" />
              Where it goes
              <span class="app-chip ml-auto">{{ formatMoneyCompact(Math.abs(finance.expenses)) }}</span>
            </div>
          </template>

          <div v-if="costGroups.length" class="space-y-4">
            <div v-for="entry in costGroups" :key="entry.name" class="space-y-2">
              <div class="flex items-baseline justify-between">
                <p class="app-kicker text-[10px]">{{ entry.name }}</p>
                <p class="text-xs font-bold tabular-nums" style="color: var(--app-text-soft)">
                  {{ formatMoneyCompact(entry.total) }}
                </p>
              </div>
              <div
                v-for="row in entry.rows"
                :key="row.type"
                class="app-surface-subtle flex items-center gap-3 px-3 py-2"
              >
                <UIcon :name="row.icon" class="size-4 shrink-0" style="color: var(--app-player-sent-off)" />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm" style="color: var(--app-text)">{{ row.label }}</p>
                  <div class="app-stat-bar-track mt-1 h-1">
                    <div class="app-stat-bar-fill app-stat-bar-fill--danger" :style="{ width: `${row.share}%` }" />
                  </div>
                </div>
                <div class="shrink-0 text-right">
                  <p class="text-sm font-bold tabular-nums" style="color: var(--app-player-sent-off)">
                    {{ formatMoneyCompact(row.amount) }}
                  </p>
                  <p class="app-muted-text text-[10px] tabular-nums">
                    {{ formatMoneyCompact(row.perMatchday) }}/md
                  </p>
                </div>
              </div>
            </div>
          </div>
          <AppEmptyState v-else compact icon="i-lucide-inbox" title="No outgoings recorded yet" />
        </UCard>
      </div>

      <!-- Wage pressure -->
      <UCard class="app-surface">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-users" class="size-4" style="color: var(--app-accent)" />
            Wage bill
          </div>
        </template>

        <div class="grid gap-4 sm:grid-cols-3">
          <div class="app-metric-card">
            <p class="app-kicker text-[10px]">Per matchday</p>
            <p class="app-hero-number mt-1 text-2xl">{{ formatMoneyCompact(finance.wageBill) }}</p>
          </div>
          <div class="app-metric-card">
            <p class="app-kicker text-[10px]">Across the season</p>
            <p class="app-hero-number mt-1 text-2xl">{{ formatMoneyCompact(finance.wageBillPerSeason) }}</p>
          </div>
          <div class="app-metric-card">
            <p class="app-kicker text-[10px]">Out of contract</p>
            <p class="app-hero-number mt-1 text-2xl">{{ finance.expiringContracts }}</p>
            <p class="app-muted-text mt-1 text-[11px]">Players leaving in the summer unless renewed</p>
          </div>
        </div>

        <div v-if="finance.wageRatio !== null" class="mt-4">
          <div class="mb-1 flex items-center justify-between text-xs">
            <span class="app-muted-text">Share of turnover</span>
            <span class="font-bold tabular-nums" :style="{ color: wageTone.color }">{{ finance.wageRatio }}%</span>
          </div>
          <AppStatBar :value="Math.min(100, finance.wageRatio)" :tone="wageTone.tone" />
          <p class="app-muted-text mt-1.5 text-[11px]">{{ wageVerdict }}</p>
        </div>
      </UCard>

      <!-- Borrowing -->
      <UCard class="app-surface">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-landmark" class="size-4" style="color: var(--app-accent)" />
            Borrowing
            <span v-if="finance.debt.outstanding > 0" class="app-chip ml-auto">
              {{ formatMoneyCompact(finance.debt.outstanding) }} outstanding
            </span>
          </div>
        </template>

        <div class="grid gap-3 sm:grid-cols-3">
          <div class="app-metric-card">
            <p class="app-kicker text-[10px]">Owed</p>
            <p
              class="app-hero-number mt-1 text-2xl"
              :style="{ color: finance.debt.outstanding > 0 ? 'var(--app-player-booked)' : 'var(--app-text)' }"
            >{{ formatMoneyCompact(finance.debt.outstanding) }}</p>
            <p class="app-muted-text mt-1 text-[11px]">
              {{ finance.debt.count }} {{ finance.debt.count === 1 ? 'facility' : 'facilities' }}
            </p>
          </div>
          <div class="app-metric-card">
            <p class="app-kicker text-[10px]">Debt service</p>
            <p class="app-hero-number mt-1 text-2xl">
              {{ formatMoneyCompact(finance.debt.servicePerRound) }}
            </p>
            <p class="app-muted-text mt-1 text-[11px]">Every matchday, whatever the season brings</p>
          </div>
          <div class="app-metric-card">
            <p class="app-kicker text-[10px]">Overdraft interest</p>
            <p
              class="app-hero-number mt-1 text-2xl"
              :style="{ color: finance.debt.overdraftPerRound > 0 ? 'var(--app-player-sent-off)' : 'var(--app-text)' }"
            >{{ formatMoneyCompact(finance.debt.overdraftPerRound) }}</p>
            <p class="app-muted-text mt-1 text-[11px]">
              {{ finance.debt.overdraftPerRound > 0 ? 'Charged while the account is in the red' : 'The account is in credit' }}
            </p>
          </div>
        </div>

        <!-- The book -->
        <ul v-if="finance.debt.loans.length" class="mt-4 space-y-2">
          <li
            v-for="loan in finance.debt.loans"
            :key="loan.id"
            class="app-surface-subtle flex flex-wrap items-center gap-3 px-3 py-2"
          >
            <div class="min-w-0 flex-1">
              <p class="text-sm" style="color: var(--app-text)">
                {{ formatMoney(loan.principal) }} at {{ loan.ratePerSeason }}%
                <span class="app-muted-text">— repaid by the end of season {{ loan.untilSeason }}</span>
              </p>
              <div class="app-stat-bar-track mt-1 h-1">
                <div class="app-stat-bar-fill" :style="{ width: `${loan.repaidPercent}%` }" />
              </div>
            </div>
            <div class="shrink-0 text-right">
              <p class="text-sm font-bold tabular-nums" style="color: var(--app-player-booked)">
                {{ formatMoneyCompact(loan.outstanding) }}
              </p>
              <p class="app-muted-text text-[10px] tabular-nums">
                {{ formatMoneyCompact(loan.repaymentPerRound + loan.interestPerRound) }}/md
              </p>
            </div>
            <UButton
              label="Settle"
              icon="i-lucide-check"
              size="xs"
              variant="ghost"
              :loading="saving"
              :disabled="finance.club.balance < loan.outstanding"
              @click="settle(loan)"
            />
          </li>
        </ul>

        <!-- Taking one out -->
        <div v-if="debt" class="app-surface-subtle mt-4 space-y-3 p-3">
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <p class="app-kicker text-[10px]">Take out a loan</p>
            <p class="app-muted-text text-[11px]">
              Up to {{ formatMoneyCompact(debt.limit) }} at {{ debt.rate }}%
            </p>
          </div>

          <template v-if="debt.limit >= debt.minLoan">
            <div>
              <label class="app-kicker mb-2 block text-[10px]">
                {{ formatMoney(draftAmount) }}
              </label>
              <USlider v-model="draftAmount" :min="debt.minLoan" :max="debt.limit" :step="debt.step" />
            </div>

            <div class="flex flex-wrap gap-2">
              <button
                v-for="term in debt.terms"
                :key="term.seasons"
                type="button"
                class="app-filter-chip"
                :class="draftTerm === term.seasons && 'app-filter-chip--active'"
                @click="draftTerm = term.seasons"
              >
                {{ term.seasons }} {{ term.seasons === 1 ? 'season' : 'seasons' }}
              </button>
            </div>

            <dl v-if="loanPreview" class="space-y-1.5 text-[11px]">
              <div class="flex justify-between">
                <dt class="app-muted-text">Leaves the account each matchday</dt>
                <dd class="font-bold tabular-nums" style="color: var(--app-player-sent-off)">
                  {{ formatMoney(loanPreview.repaymentPerRound) }}
                </dd>
              </div>
              <div class="flex justify-between">
                <dt class="app-muted-text">Interest over the term</dt>
                <dd class="font-bold tabular-nums" style="color: var(--app-player-booked)">
                  {{ formatMoney(loanPreview.interest) }}
                </dd>
              </div>
              <div class="flex justify-between">
                <dt class="app-muted-text">Repaid by</dt>
                <dd class="font-bold tabular-nums" style="color: var(--app-text)">
                  End of season {{ loanPreview.untilSeason }}
                </dd>
              </div>
            </dl>

            <p class="app-muted-text text-[11px]">
              Borrowing is capped at {{ Math.round(debt.maxShare * 100) }}% of a season's income
              ({{ formatMoneyCompact(debt.annualIncome) }}), less what you already owe.
            </p>

            <UButton
              label="Draw it down"
              icon="i-lucide-landmark"
              size="sm"
              :loading="saving"
              :disabled="!canBorrow"
              @click="borrow"
            />
          </template>

          <p v-else class="app-muted-text text-[11px]">
            No lender will go further on this income until some of what you owe is repaid.
          </p>
        </div>
      </UCard>

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
                  <span class="app-chip">{{ streamMeta(entry.type).label }}</span>
                </td>
                <td class="px-3 py-2" style="color: var(--app-text-soft)">{{ entry.description }}</td>
                <td
                  class="px-3 py-2 text-right font-bold tabular-nums"
                  :style="{ color: entry.amount > 0 ? 'var(--app-accent)' : 'var(--app-player-sent-off)' }"
                >
                  {{ formatDelta(entry.amount) }}
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
