<script setup lang="ts">
/**
 * Contract renewal.
 *
 * The player's demand is shown *before* the offer is made, and for every
 * contract length at once, because the trade-off is the decision: a short deal
 * costs more per matchday but keeps your options, a long one is cheaper and
 * ties up the wage. Hiding that behind trial-and-error offers would turn a
 * negotiation into a guessing game.
 *
 * The server's demand is deterministic (see `server/core/contracts.ts`), so
 * what this panel promises is exactly what the offer will be judged against.
 */
import { computed, ref, watch } from 'vue'
import { formatMoney } from '~/utils/format'

interface DemandOption { seasons: number; wage: number }

interface ContractInfo {
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
  season: number
  seasonsRemaining: number
  expiring: boolean
  baseDemand: number
  maxSeasons: number
  options: DemandOption[]
}

const props = defineProps<{
  /** Player to negotiate with, or null to close. */
  playerId: number | null
  teamId: number | null
}>()

const emit = defineEmits<{ close: []; renewed: [] }>()

const toast = useAppToast()
const sfx = useSfx()

const info = ref<ContractInfo | null>(null)
const loading = ref(false)
const submitting = ref(false)
const rejection = ref<string | null>(null)

const seasons = ref(2)
const wage = ref(0)
/** Stops the wage watcher clobbering a figure the manager just typed. */
const wageTouched = ref(false)

const open = computed(() => props.playerId !== null)

watch(() => props.playerId, async (playerId) => {
  info.value = null
  rejection.value = null
  wageTouched.value = false
  if (!playerId || !props.teamId) return

  loading.value = true
  try {
    info.value = await $fetch<ContractInfo>(
      `/api/team/${props.teamId}/contract?playerId=${playerId}`,
    )
    // Open on the longest deal they will sign, capped at three — the length a
    // club would usually reach for first.
    seasons.value = Math.min(3, info.value.maxSeasons)
    wage.value = demandFor(seasons.value)
  }
  catch (error) {
    toast.fromRequestError(error, 'Could not open contract talks')
    emit('close')
  }
  finally {
    loading.value = false
  }
}, { immediate: true })

function demandFor(length: number): number {
  return info.value?.options.find(option => option.seasons === length)?.wage ?? 0
}

const required = computed(() => demandFor(seasons.value))
const meetsDemand = computed(() => wage.value >= required.value)

/** How far over the asking wage this offer sits. */
const overpayPercent = computed(() => {
  if (!required.value) return 0
  return Math.round(((wage.value - required.value) / required.value) * 100)
})

const totalCost = computed(() => wage.value * 38 * seasons.value)

const currentPerSeason = computed(() => (info.value?.player.wage ?? 0) * 38)

watch(seasons, (length) => {
  rejection.value = null
  // Follow the demand curve unless the manager has deliberately set a figure.
  if (!wageTouched.value) wage.value = demandFor(length)
})

function matchDemand() {
  wage.value = required.value
  wageTouched.value = true
  rejection.value = null
}

async function submit() {
  if (!info.value || !props.teamId) return

  submitting.value = true
  rejection.value = null

  try {
    const result = await $fetch<{ accepted: boolean; reason: string; required: number; contractUntilSeason?: number }>(
      `/api/team/${props.teamId}/contract`,
      { method: 'PUT', body: { playerId: info.value.player.id, wage: wage.value, seasons: seasons.value } },
    )

    if (!result.accepted) {
      rejection.value = result.reason
      sfx.play('error')
      return
    }

    sfx.play('success')
    toast.success({
      title: `${info.value.player.name} re-signs`,
      description: `${formatMoney(wage.value)} per matchday until season ${result.contractUntilSeason}.`,
    })
    emit('renewed')
    emit('close')
  }
  catch (error) {
    toast.fromRequestError(error, 'Contract talks failed')
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    :title="info ? `Contract talks — ${info.player.name}` : 'Contract talks'"
    description="Offer a wage and a contract length"
    :ui="{ content: 'sm:max-w-lg' }"
    @update:open="value => !value && emit('close')"
  >
    <template #content>
      <div class="app-surface animate-scale-in p-5 sm:p-6">
        <AppSkeleton v-if="loading || !info" variant="text" :rows="5" />

        <template v-else>
          <!-- Who -->
          <div class="mb-4 flex items-center gap-3">
            <div
              class="flex size-12 shrink-0 items-center justify-center rounded-2xl text-base font-black"
              style="background-color: var(--app-accent-soft); color: var(--app-accent)"
            >{{ info.player.skillLevel }}</div>
            <div class="min-w-0 flex-1">
              <h2 class="truncate text-lg font-bold" style="color: var(--app-text)">{{ info.player.name }}</h2>
              <div class="mt-1 flex flex-wrap items-center gap-2">
                <AppPositionBadge :position="info.player.position" size="xs" />
                <span class="app-muted-text text-xs">{{ info.player.age }} years old</span>
                <span
                  class="app-chip"
                  :class="info.expiring ? 'app-chip--danger' : undefined"
                >
                  <UIcon :name="info.expiring ? 'i-lucide-clock-alert' : 'i-lucide-file-check'" class="size-3" />
                  {{ info.expiring
                    ? 'Final season'
                    : `${info.seasonsRemaining} season${info.seasonsRemaining === 1 ? '' : 's'} left` }}
                </span>
              </div>
            </div>
          </div>

          <!-- Contract length: the demand curve, laid out so the trade-off is visible -->
          <p class="app-kicker mb-2 text-[10px]">Contract length</p>
          <div class="mb-4 grid gap-2" :style="{ gridTemplateColumns: `repeat(${info.options.length}, minmax(0, 1fr))` }">
            <button
              v-for="option in info.options"
              :key="option.seasons"
              type="button"
              class="rounded-xl border p-2.5 text-center transition hover:-translate-y-0.5"
              :style="seasons === option.seasons
                ? { borderColor: 'var(--app-accent)', backgroundColor: 'var(--app-accent-soft)' }
                : { borderColor: 'var(--app-surface-border)', backgroundColor: 'var(--app-surface-muted)' }"
              :aria-pressed="seasons === option.seasons"
              @click="seasons = option.seasons"
            >
              <p
                class="text-sm font-bold"
                :style="{ color: seasons === option.seasons ? 'var(--app-accent)' : 'var(--app-text)' }"
              >{{ option.seasons }}y</p>
              <p class="app-muted-text mt-0.5 text-[10px] tabular-nums">
                €{{ Math.round(option.wage / 1000) }}k
              </p>
            </button>
          </div>
          <p v-if="info.maxSeasons < 5" class="app-muted-text -mt-2 mb-4 text-[11px]">
            At {{ info.player.age }} he will not commit beyond {{ info.maxSeasons }} season{{ info.maxSeasons === 1 ? '' : 's' }}.
          </p>

          <!-- Wage -->
          <label class="app-kicker mb-2 block text-[10px]">
            Wage offered — {{ formatMoney(wage) }} per matchday
          </label>
          <USlider
            :model-value="wage"
            :min="Math.round(required * 0.5)"
            :max="Math.max(Math.round(required * 2), required + 1000)"
            :step="500"
            @update:model-value="value => { wage = Number(value); wageTouched = true; rejection = null }"
          />

          <div class="mt-2 flex flex-wrap items-center gap-2">
            <span
              class="app-chip"
              :class="meetsDemand ? 'app-chip--success' : 'app-chip--warning'"
            >
              <UIcon :name="meetsDemand ? 'i-lucide-circle-check' : 'i-lucide-circle-alert'" class="size-3" />
              {{ meetsDemand
                ? overpayPercent > 15 ? `${overpayPercent}% above his demand` : 'He will accept this'
                : `He wants ${formatMoney(required)}` }}
            </span>
            <UButton
              v-if="!meetsDemand || overpayPercent > 0"
              size="xs"
              color="neutral"
              variant="soft"
              icon="i-lucide-equal"
              label="Match his demand"
              @click="matchDemand"
            />
          </div>

          <!-- What it costs -->
          <dl class="app-surface-subtle mt-4 space-y-1.5 p-3 text-sm">
            <div class="flex items-center justify-between gap-4">
              <dt class="app-muted-text">Current wage</dt>
              <dd class="font-semibold" style="color: var(--app-text)">
                {{ formatMoney(info.player.wage) }} <span class="app-muted-text text-xs">/ matchday</span>
              </dd>
            </div>
            <div class="flex items-center justify-between gap-4">
              <dt class="app-muted-text">Change per season</dt>
              <dd
                class="font-semibold tabular-nums"
                :style="{ color: wage * 38 > currentPerSeason ? 'var(--app-player-booked)' : 'var(--app-accent)' }"
              >
                {{ wage * 38 > currentPerSeason ? '+' : '' }}{{ formatMoney(wage * 38 - currentPerSeason) }}
              </dd>
            </div>
            <div class="flex items-center justify-between gap-4">
              <dt class="app-muted-text">Total commitment</dt>
              <dd class="font-bold" style="color: var(--app-accent)">{{ formatMoney(totalCost) }}</dd>
            </div>
          </dl>

          <p
            v-if="rejection"
            class="mt-3 flex items-start gap-2 rounded-lg p-2 text-xs"
            style="background-color: var(--app-badge-warning-bg); color: var(--app-badge-warning-text)"
          >
            <UIcon name="i-lucide-message-square-x" class="mt-0.5 size-3.5 shrink-0" />
            {{ rejection }}
          </p>

          <div class="mt-5 flex justify-end gap-2">
            <UButton label="Walk away" color="neutral" variant="soft" @click="emit('close')" />
            <UButton
              label="Offer contract"
              icon="i-lucide-file-signature"
              :class="meetsDemand && 'app-glow'"
              :loading="submitting"
              @click="submit"
            />
          </div>
        </template>
      </div>
    </template>
  </UModal>
</template>
