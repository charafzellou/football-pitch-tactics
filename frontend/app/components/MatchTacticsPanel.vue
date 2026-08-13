<script setup lang="ts">
/**
 * The manager's pause / half-time surface: stage substitutions and a
 * formation change for the player's own team. The opponent is CPU-managed
 * and has no equivalent panel — see the AI manager in
 * `server/core/match-engine.ts`.
 */
import { computed, ref, watch } from 'vue'
import type { LineupSlot } from '#shared/lineup'
import { normalizePosition, sortByLineupOrder } from '#shared/lineup'
import { MAX_SUBSTITUTIONS } from '#shared/match-state'

interface SquadPlayer {
  id: number
  name: string
  position: string
  skillLevel: number
}

interface TacticOption {
  name: string
  formation: Record<LineupSlot, number>
}

interface StagedSub {
  playerOutId: number
  playerInId: number
}

const props = defineProps<{
  open: boolean
  teamName: string
  squad: SquadPlayer[]
  onPitchIds: number[]
  benchIds: number[]
  usedPlayerIds: number[]
  bookedIds: number[]
  sentOffIds: number[]
  stamina: Record<number, number>
  subsUsed: number
  tacticOptions: TacticOption[]
  currentTactic: string
  isHalfTime: boolean
  loading: boolean
  /** Set when the pause was caused by one of this team's players going off injured. */
  injuredPlayerId?: number | null
  injuredPlayerName?: string | null
}>()

const emit = defineEmits<{
  confirm: [payload: { substitutions: StagedSub[]; tactic: string }]
  close: []
}>()

const stagedSubs = ref<StagedSub[]>([])
const selectedOutId = ref<number | null>(null)
const selectedTactic = ref(props.currentTactic)

// `immediate` matters: the parent `v-if`s this component on the same
// condition it passes to `open`, so it mounts already open and a false→true
// transition never happens. Without it, an injury pause would never get its
// stricken player pre-selected.
watch([() => props.open, () => props.injuredPlayerId], ([isOpen]) => {
  if (!isOpen)
    return

  stagedSubs.value = []
  // An injury pause opens with the stricken player already chosen as the
  // one going off, so the manager only has to pick who comes on.
  selectedOutId.value = props.injuredPlayerId ?? null
  selectedTactic.value = props.currentTactic
}, { immediate: true })

/** True while this pause is an injury waiting on a decision. */
const isInjuryPause = computed(() => Boolean(props.injuredPlayerId))
const hasSubsLeft = computed(() => props.subsUsed < MAX_SUBSTITUTIONS)

const positionColors: Record<LineupSlot, 'sky' | 'emerald' | 'amber' | 'rose'> = {
  GK: 'sky', DF: 'emerald', MF: 'amber', FW: 'rose',
}

const squadById = computed(() => new Map(props.squad.map(player => [player.id, player])))

/** The pitch/bench view accounting for swaps staged but not yet confirmed. */
const effectiveOnPitch = computed(() => {
  const stagedOut = new Set(stagedSubs.value.map(s => s.playerOutId))
  const stagedIn = new Set(stagedSubs.value.map(s => s.playerInId))
  const ids = props.onPitchIds.filter(id => !stagedOut.has(id)).concat([...stagedIn])
  return sortByLineupOrder(ids.map(id => squadById.value.get(id)).filter((p): p is SquadPlayer => Boolean(p)))
})

/**
 * Only players who can actually come on. A player taken off — staged or
 * already used — never reappears here, and neither does anyone injured.
 */
const effectiveBench = computed(() => {
  const stagedIn = new Set(stagedSubs.value.map(s => s.playerInId))
  const ids = props.benchIds.filter(id =>
    !stagedIn.has(id) && !props.usedPlayerIds.includes(id) && id !== props.injuredPlayerId)

  return sortByLineupOrder(ids.map(id => squadById.value.get(id)).filter((p): p is SquadPlayer => Boolean(p)))
})

const subsRemaining = computed(() => MAX_SUBSTITUTIONS - props.subsUsed - stagedSubs.value.length)

function slotOf(player: SquadPlayer) {
  return normalizePosition(player.position)
}

function staminaOf(playerId: number): number {
  return Math.round(props.stamina[playerId] ?? 100)
}

function staminaColor(value: number): string {
  if (value < 40) return 'bg-red-400'
  if (value < 65) return 'bg-amber-400'
  return 'bg-emerald-400'
}

function selectOnPitch(playerId: number) {
  if (props.sentOffIds.includes(playerId))
    return
  selectedOutId.value = selectedOutId.value === playerId ? null : playerId
}

function selectBench(playerId: number) {
  if (!selectedOutId.value)
    return
  if (subsRemaining.value <= 0)
    return

  stagedSubs.value = [...stagedSubs.value, { playerOutId: selectedOutId.value, playerInId: playerId }]
  selectedOutId.value = null
}

function removeStagedSub(sub: StagedSub) {
  stagedSubs.value = stagedSubs.value.filter(s => s !== sub)
}

function nameOf(playerId: number): string {
  return squadById.value.get(playerId)?.name ?? `#${playerId}`
}

function confirm() {
  emit('confirm', { substitutions: stagedSubs.value, tactic: selectedTactic.value })
}

function skip() {
  emit('close')
}
</script>

<template>
  <UModal :open="open" :dismissible="false" :ui="{ content: 'sm:max-w-2xl' }">
    <template #content>
      <UCard class="app-surface">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon :name="isInjuryPause ? 'i-lucide-bandage' : 'i-lucide-clipboard-list'" class="size-5"
              :class="isInjuryPause ? 'text-red-400' : 'text-emerald-400'" />
            <span class="text-lg font-bold" style="color: var(--app-text)">
              {{ isInjuryPause ? 'Injury' : isHalfTime ? 'Half Time' : 'Tactical Pause' }}
            </span>
            <UBadge color="neutral" variant="soft" size="xs" :label="teamName" class="ml-auto" />
          </div>
        </template>

        <div class="space-y-4">
          <div v-if="isInjuryPause" class="rounded-xl p-3 text-sm"
            style="background-color: rgba(239,68,68,0.12); color: var(--app-text-soft)">
            <span class="font-semibold" style="color: var(--app-text)">{{ injuredPlayerName }}</span>
            is off injured.
            <template v-if="hasSubsLeft">Pick a replacement from the bench, or play on with ten.</template>
            <template v-else>You have no substitutions left — you must play on with ten.</template>
          </div>

          <div class="flex items-center justify-between">
            <p class="app-kicker">Substitutions remaining: {{ subsRemaining }} / {{ MAX_SUBSTITUTIONS }}</p>
            <div class="flex items-center gap-2">
              <span class="app-muted-text text-xs">Formation</span>
              <select v-model="selectedTactic" class="app-control mt-0 w-auto py-1.5">
                <option v-for="tactic in tacticOptions" :key="tactic.name" :value="tactic.name">{{ tactic.name }}</option>
              </select>
            </div>
          </div>

          <div v-if="stagedSubs.length" class="app-surface-subtle space-y-1.5 rounded-xl p-3">
            <p class="app-kicker text-[10px]">Staged substitutions</p>
            <div v-for="sub in stagedSubs" :key="`${sub.playerOutId}-${sub.playerInId}`" class="flex items-center gap-2 text-sm">
              <UIcon name="i-lucide-arrow-left-right" class="size-3.5 text-sky-400" />
              <span style="color: var(--app-text-soft)">{{ nameOf(sub.playerOutId) }} <span class="app-muted-text">off</span>, {{ nameOf(sub.playerInId) }} <span class="app-muted-text">on</span></span>
              <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" class="ml-auto" @click="removeStagedSub(sub)" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <p class="app-kicker mb-2 text-[10px]">On the Pitch — tap to substitute off</p>
              <ul class="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                <li v-for="p in effectiveOnPitch" :key="p.id">
                  <button type="button" class="app-filter-chip flex w-full items-center gap-2 px-2 py-1.5 text-left"
                    :class="{ 'app-filter-chip--active': selectedOutId === p.id }" @click="selectOnPitch(p.id)">
                    <UBadge :color="positionColors[slotOf(p) ?? 'MF']" variant="soft" size="xs" :label="slotOf(p) ?? '—'" />
                    <span class="min-w-0 flex-1 truncate text-xs" style="color: var(--app-text-soft)">{{ p.name }}</span>
                  </button>
                  <div class="app-stat-bar-track mt-1">
                    <div class="app-stat-bar-fill" :class="staminaColor(staminaOf(p.id))" :style="{ width: `${staminaOf(p.id)}%` }" />
                  </div>
                </li>
              </ul>
            </div>

            <div>
              <p class="app-kicker mb-2 text-[10px]">Bench — tap to bring on</p>
              <ul class="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                <li v-for="p in effectiveBench" :key="p.id">
                  <button type="button" class="app-filter-chip flex w-full items-center gap-2 px-2 py-1.5 text-left"
                    :disabled="!selectedOutId || subsRemaining <= 0" @click="selectBench(p.id)">
                    <UBadge :color="positionColors[slotOf(p) ?? 'MF']" variant="soft" size="xs" :label="slotOf(p) ?? '—'" class="opacity-70" />
                    <span class="min-w-0 flex-1 truncate text-xs" style="color: var(--app-text-soft)">{{ p.name }}</span>
                  </button>
                  <div class="app-stat-bar-track mt-1">
                    <div class="app-stat-bar-fill" :class="staminaColor(staminaOf(p.id))" :style="{ width: `${staminaOf(p.id)}%` }" />
                  </div>
                </li>
                <li v-if="!effectiveBench.length" class="app-muted-text text-xs">No players available.</li>
              </ul>
            </div>
          </div>
        </div>

        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton :label="isInjuryPause ? 'Play on with ten' : 'Continue without changes'" color="neutral"
              variant="soft" :disabled="loading" @click="skip" />
            <UButton v-if="!isInjuryPause || hasSubsLeft"
              :label="isInjuryPause ? 'Confirm replacement' : isHalfTime ? 'Start Second Half' : 'Resume Match'"
              icon="i-lucide-play" :loading="loading" :disabled="isInjuryPause && !stagedSubs.length"
              @click="confirm" />
          </div>
        </template>
      </UCard>
    </template>
  </UModal>
</template>
