<script setup lang="ts">
/**
 * The ground — what it holds, what it charges, and what else it could be doing
 * with the six days a week nobody plays football on it.
 *
 * Every control here is a trade rather than an upgrade. Season tickets buy cash
 * now with the upside of a good season; boxes buy steady income with seats and
 * capital; a concert buys a very large cheque with a pitch the team then has to
 * play on.
 */
import { computed, ref, watch } from 'vue'
import { formatMoney, formatMoneyCompact } from '~/utils/format'

interface EventOffer {
  id: number
  round: number
  kind: string
  label: string
  description: string
  promoterName: string
  fee: number
  pitchWear: number
  fanReaction: number
  roundsToDecide: number
}

interface StadiumPayload {
  season: number
  round: number
  totalRounds: number
  balance: number
  club: {
    stadiumName: string | null
    stadiumCapacity: number
    generalCapacity: number
    ticketPrice: number
    fairTicketPrice: number
  }
  attendance: { typical: number; walkUp: number; holders: number; fillPercent: number; gatePerMatch: number }
  seasonTickets: {
    share: number; discount: number; maxShare: number; maxDiscount: number
    holders: number; lumpSum: number; forgone: number
  }
  hospitality: {
    boxes: number; maxBoxes: number; seatsPerBox: number; boxCost: number
    canAfford: boolean; perHomeMatch: number; nextBoxPerHomeMatch: number; seatsLost: number
  }
  pitch: { condition: number; floor: number; penalty: number }
  expansion: { step: number; cost: number; maxCapacity: number; canAfford: boolean; atMax: boolean }
  diary: {
    offers: EventOffer[]
    booked: { id: number; round: number; label: string; promoterName: string; fee: number; pitchWear: number }[]
    held: { id: number; round: number; label: string; fee: number }[]
    earned: number
  }
}

const toast = useAppToast()
const { team, refreshTeam } = useGameContext()
const { refresh: refreshSummary } = useFinanceSummary()
const { refresh: refreshProjection } = useFinanceProjection()

const { data, refresh, status } = useAsyncData(
  'finance-stadium',
  () => $fetch<StadiumPayload | null>('/api/finance/stadium'),
)

const saving = ref(false)
const draftPrice = ref(30)
const draftShare = ref(0)
const draftDiscount = ref(20)
const pendingEvent = ref<EventOffer | null>(null)

// Seeded from the club's saved terms once the payload arrives.
const initialised = ref(false)
watch(data, (value) => {
  if (value && !initialised.value) {
    draftPrice.value = value.club.ticketPrice
    draftShare.value = value.seasonTickets.share
    draftDiscount.value = value.seasonTickets.discount
    initialised.value = true
  }
}, { immediate: true })

/** Plain-language read on the current price, since the number alone says little. */
const priceVerdict = computed(() => {
  const fair = data.value?.club.fairTicketPrice ?? 30
  const ratio = (draftPrice.value - fair) / fair

  if (ratio > 0.35) return { text: 'Well above what supporters expect — expect empty seats', color: 'var(--app-player-sent-off)' }
  if (ratio > 0.12) return { text: 'Above the going rate; some will stay away', color: 'var(--app-player-booked)' }
  if (ratio < -0.25) return { text: 'Cheap — a full house, but you are leaving money behind', color: 'var(--app-player-booked)' }
  return { text: 'About what supporters expect', color: 'var(--app-accent)' }
})

/** What the drafted season-ticket terms would bank, and what they would cost. */
const seasonTicketPreview = computed(() => {
  const payload = data.value
  if (!payload) return null

  const holders = Math.round(payload.club.generalCapacity * draftShare.value / 100)
  const homeMatches = payload.totalRounds / 2
  const perSeat = payload.club.ticketPrice * (1 - draftDiscount.value / 100)
  const lumpSum = Math.round(holders * perSeat * homeMatches)
  const forgone = Math.round(Math.min(payload.attendance.typical, holders) * payload.club.ticketPrice * homeMatches)

  return { holders, lumpSum, forgone, difference: lumpSum - forgone }
})

const pitchTone = computed(() => {
  const condition = data.value?.pitch.condition ?? 100
  if (condition < 55) return { tone: 'danger' as const, color: 'var(--app-player-sent-off)', text: 'Cut up. The team is feeling it.' }
  if (condition < 80) return { tone: 'warning' as const, color: 'var(--app-player-booked)', text: 'Worn. It will grow back.' }
  return { tone: 'default' as const, color: 'var(--app-accent)', text: 'In good order.' }
})

const termsChanged = computed(() =>
  draftShare.value !== data.value?.seasonTickets.share
  || draftDiscount.value !== data.value?.seasonTickets.discount)

async function refreshAll() {
  await Promise.all([refresh(), refreshSummary(), refreshProjection(), refreshTeam()])
}

async function post(body: Record<string, unknown>, success: (result: any) => { title: string; description: string }, failure: string) {
  saving.value = true
  try {
    const result = await $fetch<any>('/api/finance/stadium', { method: 'POST', body })
    await refreshAll()
    toast.success(success(result))
  }
  catch (error) {
    toast.fromRequestError(error, failure)
  }
  finally {
    saving.value = false
    pendingEvent.value = null
  }
}

async function saveTicketPrice() {
  if (!team.value) return

  saving.value = true
  try {
    await $fetch(`/api/team/${team.value.id}/stadium` as string, {
      method: 'PUT',
      body: { ticketPrice: draftPrice.value },
    })
    await refreshAll()
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
    const result = await $fetch<{ stadiumCapacity: number }>(`/api/team/${team.value.id}/stadium` as string, {
      method: 'PUT',
      body: { expand: true },
    })
    await refreshAll()
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

const saveSeasonTickets = () => post(
  { action: 'season-tickets', share: draftShare.value, discount: draftDiscount.value },
  () => ({
    title: 'Season-ticket terms set',
    description: draftShare.value > 0
      ? `${seasonTicketPreview.value?.holders.toLocaleString('en-IE')} seats go on sale next summer.`
      : 'No seats will be sold in advance.',
  }),
  'Could not set the season-ticket terms',
)

const buildBox = () => post(
  { action: 'build-boxes', boxes: 1 },
  result => ({ title: 'Box built', description: `The ground now has ${result.boxes}.` }),
  'Could not build the box',
)

const bookEvent = (offer: EventOffer) => post(
  { action: 'book-event', eventId: offer.id },
  () => ({ title: `${offer.label} booked`, description: `${formatMoney(offer.fee)} for the week before round ${offer.round}.` }),
  'Could not take that booking',
)

const cancelEvent = (id: number) => post(
  { action: 'cancel-event', eventId: id },
  () => ({ title: 'Booking cancelled', description: 'The promoter will find another ground.' }),
  'Could not cancel that booking',
)

function confirmEvent(offer: EventOffer) {
  // Anything that touches the pitch asks first; a conference does not.
  if (offer.pitchWear > 0) pendingEvent.value = offer
  else bookEvent(offer)
}
</script>

<template>
  <div class="space-y-4 sm:space-y-5">
    <div class="flex items-center gap-2">
      <UIcon name="i-lucide-building" class="size-6" style="color: var(--app-accent)" />
      <h1 class="app-page-title">Stadium</h1>
      <span v-if="data?.club.stadiumName" class="app-chip ml-auto">{{ data.club.stadiumName }}</span>
    </div>

    <FinanceNav />

    <AppSkeleton v-if="status === 'pending' || !data" variant="card" />

    <template v-else>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div class="app-metric-card">
          <p class="app-kicker text-[10px]">Capacity</p>
          <p class="app-hero-number mt-1 text-2xl">{{ data.club.stadiumCapacity.toLocaleString('en-IE') }}</p>
          <p v-if="data.hospitality.seatsLost" class="app-muted-text mt-1 text-[11px]">
            {{ data.hospitality.seatsLost.toLocaleString('en-IE') }} given over to boxes
          </p>
        </div>
        <div class="app-metric-card">
          <p class="app-kicker text-[10px]">Typical crowd</p>
          <p class="app-hero-number mt-1 text-2xl">{{ data.attendance.typical.toLocaleString('en-IE') }}</p>
          <p class="app-muted-text mt-1 text-[11px]">{{ data.attendance.fillPercent }}% full</p>
        </div>
        <div class="app-metric-card">
          <p class="app-kicker text-[10px]">Gate per home match</p>
          <p class="app-hero-number mt-1 text-2xl" style="color: var(--app-accent)">
            {{ formatMoneyCompact(data.attendance.gatePerMatch) }}
          </p>
          <p v-if="data.attendance.holders" class="app-muted-text mt-1 text-[11px]">
            {{ data.attendance.holders.toLocaleString('en-IE') }} already paid in the summer
          </p>
        </div>
        <div class="app-metric-card">
          <p class="app-kicker text-[10px]">Pitch</p>
          <p class="app-hero-number mt-1 text-2xl" :style="{ color: pitchTone.color }">
            {{ data.pitch.condition }}
          </p>
          <AppStatBar :value="data.pitch.condition" :tone="pitchTone.tone" size="xs" class="mt-1.5" />
          <p class="app-muted-text mt-1 text-[11px]">
            {{ pitchTone.text }}
            <template v-if="data.pitch.penalty > 0"> −{{ data.pitch.penalty }} at home.</template>
          </p>
        </div>
      </div>

      <!-- Promoters -->
      <UCard v-if="data.diary.offers.length" class="app-elevated">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-music" class="size-4" style="color: var(--app-gold)" />
            The ground is wanted
          </div>
        </template>

        <div class="grid gap-3 lg:grid-cols-2">
          <div
            v-for="(offer, index) in data.diary.offers"
            :key="offer.id"
            class="app-surface-subtle flex flex-col gap-2 p-3 animate-fade-in-up"
            :style="`animation-delay: ${index * 0.05}s`"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="truncate text-sm font-bold" style="color: var(--app-text)">{{ offer.label }}</p>
                <p class="app-muted-text truncate text-[11px]">{{ offer.promoterName }}</p>
              </div>
              <span class="app-chip shrink-0">week before R{{ offer.round }}</span>
            </div>

            <p class="app-hero-number text-2xl" style="color: var(--app-accent)">
              {{ formatMoneyCompact(offer.fee) }}
            </p>

            <p class="app-muted-text text-[11px]">{{ offer.description }}</p>

            <dl class="space-y-1 text-[11px]">
              <div class="flex justify-between">
                <dt class="app-muted-text">Pitch</dt>
                <dd
                  class="font-semibold tabular-nums"
                  :style="{ color: offer.pitchWear > 15 ? 'var(--app-player-sent-off)' : offer.pitchWear > 0 ? 'var(--app-player-booked)' : 'var(--app-accent)' }"
                >{{ offer.pitchWear > 0 ? `−${offer.pitchWear}` : 'untouched' }}</dd>
              </div>
              <div class="flex justify-between">
                <dt class="app-muted-text">Supporters</dt>
                <dd
                  class="font-semibold tabular-nums"
                  :style="{ color: offer.fanReaction > 0 ? 'var(--app-accent)' : offer.fanReaction < 0 ? 'var(--app-player-booked)' : 'var(--app-text-muted)' }"
                >{{ offer.fanReaction === 0 ? 'indifferent' : offer.fanReaction > 0 ? `+${offer.fanReaction}` : offer.fanReaction }}</dd>
              </div>
            </dl>

            <div class="mt-auto pt-1">
              <UButton
                label="Take the booking"
                icon="i-lucide-calendar-plus"
                size="xs"
                class="w-full justify-center"
                :loading="saving"
                @click="confirmEvent(offer)"
              />
            </div>
          </div>
        </div>
      </UCard>

      <!-- Diary -->
      <UCard v-if="data.diary.booked.length || data.diary.held.length" class="app-surface">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-calendar" class="size-4" style="color: var(--app-accent)" />
            Diary
            <span class="app-chip ml-auto">{{ formatMoneyCompact(data.diary.earned) }} earned this season</span>
          </div>
        </template>

        <ul class="space-y-2">
          <li
            v-for="row in data.diary.booked"
            :key="`b${row.id}`"
            class="app-surface-subtle flex items-center gap-3 px-3 py-2"
          >
            <UIcon name="i-lucide-clock" class="size-4 shrink-0" style="color: var(--app-player-booked)" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm" style="color: var(--app-text)">{{ row.label }}</p>
              <p class="app-muted-text truncate text-[11px]">
                week before round {{ row.round }} · {{ row.promoterName }}
                <template v-if="row.pitchWear"> · pitch −{{ row.pitchWear }}</template>
              </p>
            </div>
            <p class="shrink-0 text-sm font-bold tabular-nums" style="color: var(--app-accent)">
              {{ formatMoneyCompact(row.fee) }}
            </p>
            <UButton
              label="Cancel"
              size="xs"
              color="neutral"
              variant="ghost"
              :loading="saving"
              @click="cancelEvent(row.id)"
            />
          </li>
          <li
            v-for="row in data.diary.held"
            :key="`h${row.id}`"
            class="flex items-center gap-3 px-3 py-1.5"
          >
            <UIcon name="i-lucide-check" class="size-4 shrink-0" style="color: var(--app-text-muted)" />
            <p class="min-w-0 flex-1 truncate text-xs" style="color: var(--app-text-muted)">
              {{ row.label }} — round {{ row.round }}
            </p>
            <p class="shrink-0 text-xs tabular-nums" style="color: var(--app-text-muted)">
              {{ formatMoneyCompact(row.fee) }}
            </p>
          </li>
        </ul>
      </UCard>

      <div class="grid gap-4 lg:grid-cols-2">
        <!-- Ticket price -->
        <UCard class="app-surface">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-ticket" class="size-4" style="color: var(--app-accent)" />
              Ticket price
            </div>
          </template>

          <div class="space-y-3">
            <label class="app-kicker block text-[10px]">
              €{{ draftPrice }} per seat
              <span class="app-muted-text normal-case">
                (supporters expect about €{{ data.club.fairTicketPrice }})
              </span>
            </label>
            <USlider v-model="draftPrice" :min="5" :max="120" :step="1" />

            <p class="flex items-center gap-1.5 text-[11px]" :style="{ color: priceVerdict.color }">
              <UIcon name="i-lucide-info" class="size-3 shrink-0" />
              {{ priceVerdict.text }}
            </p>

            <UButton
              label="Apply price"
              icon="i-lucide-check"
              size="sm"
              :loading="saving"
              :disabled="draftPrice === data.club.ticketPrice"
              @click="saveTicketPrice"
            />
          </div>
        </UCard>

        <!-- Season tickets -->
        <UCard class="app-surface">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-tickets" class="size-4" style="color: var(--app-accent)" />
              Season tickets
            </div>
          </template>

          <div class="space-y-3">
            <div>
              <label class="app-kicker mb-2 block text-[10px]">
                Sell {{ draftShare }}% of the ground in advance
              </label>
              <USlider v-model="draftShare" :min="0" :max="data.seasonTickets.maxShare" :step="1" />
            </div>
            <div>
              <label class="app-kicker mb-2 block text-[10px]">
                At {{ draftDiscount }}% off the gate price
              </label>
              <USlider v-model="draftDiscount" :min="0" :max="data.seasonTickets.maxDiscount" :step="1" />
            </div>

            <dl v-if="seasonTicketPreview" class="space-y-1.5 text-[11px]">
              <div class="flex justify-between">
                <dt class="app-muted-text">Seats sold</dt>
                <dd class="font-bold tabular-nums" style="color: var(--app-text)">
                  {{ seasonTicketPreview.holders.toLocaleString('en-IE') }}
                </dd>
              </div>
              <div class="flex justify-between">
                <dt class="app-muted-text">Banked next summer</dt>
                <dd class="font-bold tabular-nums" style="color: var(--app-accent)">
                  {{ formatMoney(seasonTicketPreview.lumpSum) }}
                </dd>
              </div>
              <div class="flex justify-between">
                <dt class="app-muted-text">Given up at the gate</dt>
                <dd class="font-bold tabular-nums" style="color: var(--app-player-sent-off)">
                  {{ formatMoney(seasonTicketPreview.forgone) }}
                </dd>
              </div>
            </dl>

            <p class="app-muted-text text-[11px]">
              Cash before a ball is kicked, and a floor under the crowd whatever
              happens — paid for with the upside of a season that goes well.
              Terms take effect at the summer sale.
            </p>

            <UButton
              label="Set terms"
              icon="i-lucide-check"
              size="sm"
              :loading="saving"
              :disabled="!termsChanged"
              @click="saveSeasonTickets"
            />
          </div>
        </UCard>

        <!-- Hospitality -->
        <UCard class="app-surface">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-wine" class="size-4" style="color: var(--app-accent)" />
              Executive boxes
            </div>
          </template>

          <div class="space-y-3">
            <div class="grid grid-cols-2 gap-3">
              <div class="app-metric-card">
                <p class="app-kicker text-[10px]">Built</p>
                <p class="app-hero-number mt-1 text-xl">{{ data.hospitality.boxes }}</p>
              </div>
              <div class="app-metric-card">
                <p class="app-kicker text-[10px]">Per home match</p>
                <p class="app-hero-number mt-1 text-xl" style="color: var(--app-accent)">
                  {{ formatMoneyCompact(data.hospitality.perHomeMatch) }}
                </p>
              </div>
            </div>

            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <p class="text-sm font-semibold" style="color: var(--app-text)">
                  Build one for {{ formatMoney(data.hospitality.boxCost) }}
                </p>
                <p class="app-muted-text text-[11px]">
                  {{ formatMoneyCompact(data.hospitality.nextBoxPerHomeMatch) }} a home match,
                  out of {{ data.hospitality.seatsPerBox }} ordinary seats
                  <template v-if="!data.hospitality.canAfford"> · you cannot afford this</template>
                </p>
              </div>
              <UButton
                label="Build"
                icon="i-lucide-hammer"
                size="sm"
                color="neutral"
                variant="soft"
                :loading="saving"
                :disabled="!data.hospitality.canAfford || data.hospitality.boxes >= data.hospitality.maxBoxes"
                @click="buildBox"
              />
            </div>

            <p class="app-muted-text text-[11px]">
              The only seats in the ground that do not care what you charge at the
              turnstile — which is what makes them worth the ones they replace.
            </p>
          </div>
        </UCard>

        <!-- Expansion -->
        <UCard class="app-surface">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-hammer" class="size-4" style="color: var(--app-accent)" />
              Expansion
            </div>
          </template>

          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="text-sm font-semibold" style="color: var(--app-text)">
                Add {{ data.expansion.step.toLocaleString('en-IE') }} seats
              </p>
              <p class="app-muted-text text-[11px]">
                {{ formatMoney(data.expansion.cost) }}
                <template v-if="data.expansion.atMax"> · already at maximum</template>
                <template v-else-if="!data.expansion.canAfford"> · you cannot afford this</template>
              </p>
            </div>
            <UButton
              label="Expand"
              icon="i-lucide-hammer"
              size="sm"
              color="neutral"
              variant="soft"
              :loading="saving"
              :disabled="data.expansion.atMax || !data.expansion.canAfford"
              @click="expandStadium"
            />
          </div>

          <p class="app-muted-text mt-3 text-[11px]">
            Seats are paid for and available immediately — the game has no calendar
            granularity finer than a matchday to hang a construction timeline on.
          </p>
        </UCard>
      </div>
    </template>

    <AppConfirmModal
      :open="pendingEvent !== null"
      tone="warning"
      icon="i-lucide-music"
      :title="pendingEvent ? `Book the ${pendingEvent.label.toLowerCase()}?` : ''"
      description="The pitch will take a fortnight to come back, and the team plays on it in the meantime."
      confirm-label="Take the booking"
      confirm-icon="i-lucide-calendar-plus"
      :loading="saving"
      @confirm="pendingEvent && bookEvent(pendingEvent)"
      @cancel="pendingEvent = null"
    >
      <template #consequences>
        <dl v-if="pendingEvent" class="space-y-1.5 text-xs">
          <div class="flex justify-between gap-4">
            <dt class="app-muted-text">Fee</dt>
            <dd class="font-semibold tabular-nums" style="color: var(--app-accent)">
              {{ formatMoney(pendingEvent.fee) }}
            </dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="app-muted-text">Pitch condition</dt>
            <dd class="font-semibold tabular-nums" style="color: var(--app-player-sent-off)">
              −{{ pendingEvent.pitchWear }}, recovering 9 a week
            </dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="app-muted-text">Cost to the side at home</dt>
            <dd class="font-semibold tabular-nums" style="color: var(--app-player-sent-off)">
              up to −{{ (pendingEvent.pitchWear / 100 * 2.5).toFixed(2) }} attack and defence
            </dd>
          </div>
        </dl>
      </template>
    </AppConfirmModal>
  </div>
</template>
