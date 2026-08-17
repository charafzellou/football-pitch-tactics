<script setup lang="ts">
/**
 * New save wizard — country → league → club.
 *
 * Three fixes beyond the styling: the cascade used hardcoded id switches
 * (`case 1: selectedLeague = 1`) which silently broke for any other country;
 * `POST /api/game/start` destroys an existing save with no warning; and the
 * club step gave no information to choose on.
 */
import { computed, ref, watch } from 'vue'
import { averageOf, formatMoneyCompact, getInitials } from '~/utils/format'
import type { TeamPayload } from '~/composables/useGameContext'

interface Option { id: number; name: string }

const toast = useAppToast()
const sfx = useSfx()

// `undefined` rather than `null`: USelectMenu's model type is `T | undefined`,
// and a null would not type-check against it.
const selectedCountry = ref<number | undefined>()
const selectedLeague = ref<number | undefined>()
const selectedTeam = ref<number | undefined>()

const starting = ref(false)
const overwriteOpen = ref(false)
const existingSave = ref<{ playerTeamId: number } | null>(null)

const { data: countries } = useAsyncData('countries', () => $fetch<Option[]>('/api/countries'), {
  default: () => [] as Option[],
})

const leagues = ref<Option[]>([])
const teams = ref<Option[]>([])
const leaguesPending = ref(false)
const teamsPending = ref(false)

const preview = ref<TeamPayload | null>(null)
const previewPending = ref(false)

onMounted(async () => {
  try {
    const state = await $fetch<{ playerTeamId: number } | null>('/api/game/state')
    if (state?.playerTeamId) existingSave.value = state
  }
  catch {
    existingSave.value = null
  }
})

// Default to the first country once the list arrives, rather than assuming id 1.
watch(countries, (list) => {
  if (list.length && selectedCountry.value === undefined)
    selectedCountry.value = list[0]!.id
}, { immediate: true })

watch(selectedCountry, async (countryId) => {
  selectedLeague.value = undefined
  selectedTeam.value = undefined
  leagues.value = []
  teams.value = []
  if (!countryId) return

  leaguesPending.value = true
  try {
    leagues.value = await $fetch<Option[]>(`/api/leagues?countryId=${countryId}`)
    // Always select the first *actual* league rather than a hardcoded id.
    selectedLeague.value = leagues.value[0]?.id
  }
  catch (error) {
    toast.fromRequestError(error, 'Could not load leagues')
  }
  finally {
    leaguesPending.value = false
  }
}, { immediate: true })

watch(selectedLeague, async (leagueId) => {
  selectedTeam.value = undefined
  teams.value = []
  if (!leagueId) return

  teamsPending.value = true
  try {
    teams.value = await $fetch<Option[]>(`/api/teams?leagueId=${leagueId}`)
    selectedTeam.value = teams.value[0]?.id
  }
  catch (error) {
    toast.fromRequestError(error, 'Could not load clubs')
  }
  finally {
    teamsPending.value = false
  }
})

// A club preview so the final choice is informed rather than a name in a list.
watch(selectedTeam, async (teamId) => {
  preview.value = null
  if (!teamId) return

  previewPending.value = true
  try {
    preview.value = await $fetch<TeamPayload>(`/api/team/${teamId}`)
  }
  catch {
    preview.value = null
  }
  finally {
    previewPending.value = false
  }
})

const previewStats = computed(() => {
  const squad = preview.value?.squad ?? []
  if (!squad.length) return null

  const best = [...squad].sort((a, b) => b.skillLevel - a.skillLevel)[0]
  return {
    size: squad.length,
    averageSkill: averageOf(squad.map(p => p.skillLevel)),
    averageAge: averageOf(squad.map(p => p.age)),
    balance: preview.value?.bankBalance ?? 0,
    star: best,
  }
})

const steps = [
  { icon: 'i-lucide-globe', label: 'Country', done: computed(() => Boolean(selectedCountry.value)) },
  { icon: 'i-lucide-list', label: 'League', done: computed(() => Boolean(selectedLeague.value)) },
  { icon: 'i-lucide-shield', label: 'Club', done: computed(() => Boolean(selectedTeam.value)) },
]

const completedSteps = computed(() => steps.filter(step => step.done.value).length)
const progressPct = computed(() => (completedSteps.value / steps.length) * 100)

function requestStart() {
  if (!selectedTeam.value) return
  sfx.play('click')

  if (existingSave.value) {
    overwriteOpen.value = true
    return
  }
  void startGame()
}

async function startGame() {
  if (!selectedTeam.value) return

  starting.value = true
  overwriteOpen.value = false

  try {
    await $fetch('/api/game/start', { method: 'POST', body: { teamId: selectedTeam.value } })
    sfx.play('success')
    await navigateTo('/game')
  }
  catch (error) {
    toast.fromRequestError(error, 'Could not start the game')
    starting.value = false
  }
}
</script>

<template>
  <div class="flex min-h-[76vh] flex-col items-center justify-center px-4 py-10">
    <div class="app-surface w-full max-w-xl animate-rise p-5 sm:p-8">
      <!-- Progress -->
      <div class="mb-7">
        <div class="mb-4 flex items-center justify-between">
          <template v-for="(step, i) in steps" :key="step.label">
            <div class="flex flex-col items-center gap-1.5">
              <div
                class="flex size-10 items-center justify-center rounded-full border-2 transition-all duration-300"
                :style="step.done.value
                  ? { borderColor: 'var(--app-accent)', backgroundColor: 'var(--app-accent-soft)', color: 'var(--app-accent)' }
                  : { borderColor: 'var(--app-surface-border-strong)', color: 'var(--app-text-muted)' }"
              >
                <UIcon :name="step.done.value ? 'i-lucide-check' : step.icon" class="size-4" />
              </div>
              <span
                class="text-[10px] font-bold uppercase tracking-widest transition-colors duration-300"
                :style="{ color: step.done.value ? 'var(--app-accent)' : 'var(--app-text-muted)' }"
              >{{ step.label }}</span>
            </div>
            <div v-if="i < steps.length - 1" class="mx-2 mb-5 h-0.5 flex-1 overflow-hidden rounded-full" style="background-color: var(--app-surface-border)">
              <div
                class="h-full rounded-full transition-all duration-500"
                :style="{
                  width: steps[i + 1]!.done.value ? '100%' : '0%',
                  backgroundColor: 'var(--app-accent)',
                }"
              />
            </div>
          </template>
        </div>

        <div class="app-stat-bar-track">
          <div class="app-stat-bar-fill" :style="{ width: `${progressPct}%` }" />
        </div>
      </div>

      <h1 class="mb-2 text-center text-2xl font-bold sm:text-3xl" style="color: var(--app-text)">Select Your Club</h1>
      <p class="app-muted-text mb-7 text-center text-sm sm:text-base">
        Choose your country, league and club to start a new save.
      </p>

      <div class="grid grid-cols-1 gap-4">
        <div>
          <label class="app-kicker mb-1.5 block text-[10px]">Country</label>
          <USelectMenu
            v-model="selectedCountry"
            :items="countries"
            value-key="id"
            label-key="name"
            placeholder="Select country"
            class="w-full"
          />
        </div>

        <Transition
          enter-active-class="transition duration-300 ease-out"
          enter-from-class="opacity-0 -translate-y-2"
        >
          <div v-if="selectedCountry">
            <label class="app-kicker mb-1.5 block text-[10px]">League</label>
            <USelectMenu
              v-model="selectedLeague"
              :items="leagues"
              value-key="id"
              label-key="name"
              placeholder="Select league"
              :loading="leaguesPending"
              class="w-full"
            />
          </div>
        </Transition>

        <Transition
          enter-active-class="transition duration-300 ease-out"
          enter-from-class="opacity-0 -translate-y-2"
        >
          <div v-if="selectedLeague">
            <label class="app-kicker mb-1.5 block text-[10px]">Club</label>
            <USelectMenu
              v-model="selectedTeam"
              :items="teams"
              value-key="id"
              label-key="name"
              placeholder="Select club"
              :loading="teamsPending"
              class="w-full"
            />
          </div>
        </Transition>

        <!-- Club preview -->
        <Transition
          enter-active-class="transition duration-300 ease-out"
          enter-from-class="opacity-0 scale-95"
        >
          <div v-if="previewPending" class="app-surface-subtle p-4">
            <AppSkeleton variant="text" :rows="3" />
          </div>
          <div v-else-if="preview && previewStats" class="app-surface-subtle p-4">
            <div class="flex items-center gap-3">
              <div
                class="flex size-12 shrink-0 items-center justify-center rounded-2xl text-sm font-black"
                style="background-image: linear-gradient(140deg, var(--app-accent), var(--color-brand-700)); color: var(--color-brand-950)"
              >{{ getInitials(preview.name) }}</div>
              <div class="min-w-0 flex-1">
                <p class="truncate text-base font-bold" style="color: var(--app-text)">{{ preview.name }}</p>
                <p class="app-muted-text text-xs">
                  {{ previewStats.size }} players · average age {{ previewStats.averageAge }}
                </p>
              </div>
            </div>

            <div class="mt-3 grid grid-cols-3 gap-2">
              <div class="app-metric-card p-2.5">
                <p class="app-kicker text-[9px]">Squad rating</p>
                <p class="mt-0.5 text-lg font-bold" style="color: var(--app-text)">{{ previewStats.averageSkill }}</p>
              </div>
              <div class="app-metric-card p-2.5">
                <p class="app-kicker text-[9px]">Transfer funds</p>
                <p class="mt-0.5 text-lg font-bold" style="color: var(--app-accent)">
                  {{ formatMoneyCompact(previewStats.balance) }}
                </p>
              </div>
              <div class="app-metric-card p-2.5">
                <p class="app-kicker text-[9px]">Star player</p>
                <p class="mt-0.5 truncate text-xs font-bold" style="color: var(--app-text)" :title="previewStats.star?.name">
                  {{ previewStats.star?.name }}
                </p>
                <p class="app-muted-text text-[10px]">{{ previewStats.star?.skillLevel }} OVR</p>
              </div>
            </div>
          </div>
        </Transition>

        <UButton
          label="Start Game"
          icon="i-lucide-play"
          size="xl"
          block
          class="app-glow"
          :loading="starting"
          :disabled="!selectedTeam"
          @click="requestStart"
        />

        <p v-if="existingSave" class="app-muted-text text-center text-xs">
          <UIcon name="i-lucide-triangle-alert" class="mr-1 inline size-3" style="color: var(--app-player-booked)" />
          You already have a save — starting a new game will replace it.
        </p>
      </div>
    </div>

    <AppConfirmModal
      :open="overwriteOpen"
      tone="danger"
      icon="i-lucide-trash-2"
      title="Replace your existing save?"
      description="Starting a new game permanently deletes your current club, squad, results and league position."
      confirm-label="Delete and start new"
      confirm-icon="i-lucide-trash-2"
      require-phrase="new game"
      :loading="starting"
      @confirm="startGame"
      @cancel="overwriteOpen = false"
    >
      <template #consequences>
        <p style="color: var(--app-text-soft)">
          Your current save will be erased and replaced with
          <strong style="color: var(--app-text)">{{ preview?.name ?? 'the selected club' }}</strong>.
        </p>
        <p class="app-muted-text mt-1 text-xs">This cannot be undone.</p>
      </template>
    </AppConfirmModal>
  </div>
</template>
