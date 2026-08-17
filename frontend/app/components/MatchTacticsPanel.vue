<script setup lang="ts">
/**
 * The manager's pause / half-time / injury surface.
 *
 * Rebuilt around three complaints about the old version: you could not tell
 * which player you had selected, disabled bench players never said why, and
 * there was no confirm step or undo — the footer button read "Resume Match",
 * which sounds like navigation rather than committing a substitution.
 *
 * Validation now runs through `substitutionError()` and `applyMidMatchChanges()`
 * from `#shared/match-state` — the exact functions the server uses in
 * `POST /api/match/changes`. Staged swaps fold in sequence, so chaining
 * ("A off, B on", then "B off, C on") greys out and validates identically on
 * both sides of the wire instead of drifting apart.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { LineupSlot } from '#shared/lineup'
import { normalizePosition, sortByLineupOrder } from '#shared/lineup'
import type { MatchSideState, MatchState, SubstitutionRequest } from '#shared/match-state'
import { MAX_SUBSTITUTIONS, applyMidMatchChanges, effectiveSkill, substitutionError } from '#shared/match-state'
import { useSfx } from '~/composables/useSfx'

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

const props = defineProps<{
  open: boolean
  teamName: string
  squad: SquadPlayer[]
  /** The live match state; the panel derives everything about the side from it. */
  state: MatchState
  side: 'home' | 'away'
  tacticOptions: TacticOption[]
  isHalfTime: boolean
  loading: boolean
  /** Set when the pause was caused by one of this team's players going off injured. */
  injuredPlayerId?: number | null
  injuredPlayerName?: string | null
}>()

const emit = defineEmits<{
  confirm: [payload: { substitutions: SubstitutionRequest[]; tactic: string }]
  close: []
}>()

const sfx = useSfx()

const stagedSubs = ref<SubstitutionRequest[]>([])
const selectedOutId = ref<number | null>(null)
const selectedTactic = ref('')
const shakeBenchId = ref<number | null>(null)

const ownSide = computed<MatchSideState>(() => props.state[props.side])
const squadById = computed(() => new Map(props.squad.map(player => [player.id, player])))

/**
 * `immediate` matters: the parent `v-if`s this component on the same condition
 * it passes to `open`, so it mounts already open and a false→true transition
 * never happens. Without it an injury pause would never pre-select its player.
 */
watch([() => props.open, () => props.injuredPlayerId], ([isOpen]) => {
  if (!isOpen) return

  stagedSubs.value = []
  selectedOutId.value = props.injuredPlayerId ?? null
  selectedTactic.value = ownSide.value.tacticName
}, { immediate: true })

const isInjuryPause = computed(() => Boolean(props.injuredPlayerId))

/**
 * The side as it would be with every staged swap applied — the same fold the
 * server performs before validating the next one in the batch.
 */
const stagedSide = computed<MatchSideState>(() => {
  if (!stagedSubs.value.length) return ownSide.value

  try {
    return applyMidMatchChanges(props.state, ownSide.value.teamId, stagedSubs.value)[props.side]
  }
  catch {
    // Only reachable if state changed underneath a staged list; fall back to
    // the unmodified side rather than rendering nothing.
    return ownSide.value
  }
})

const subsRemaining = computed(() => MAX_SUBSTITUTIONS - stagedSide.value.subsUsed)
const hasSubsLeft = computed(() => ownSide.value.subsUsed < MAX_SUBSTITUTIONS)

/** Pips for the subs counter — spent, staged, or still available. */
const subPips = computed(() =>
  Array.from({ length: MAX_SUBSTITUTIONS }, (_, i) => {
    if (i < ownSide.value.subsUsed) return 'used'
    if (i < stagedSide.value.subsUsed) return 'staged'
    return 'free'
  }),
)

function toPlayer(id: number): SquadPlayer | null {
  return squadById.value.get(id) ?? null
}

function slotOf(player: SquadPlayer): LineupSlot | null {
  return normalizePosition(player.position)
}

function staminaOf(playerId: number): number {
  return Math.round(stagedSide.value.stamina[playerId] ?? 100)
}

/**
 * Who can go off. Normally the pitch; during an injury pause the stricken
 * player counts too, since replacing them is the whole point of the pause
 * even though the engine already took them off.
 */
const outCandidates = computed(() => {
  const ids = [...stagedSide.value.onPitch]

  for (const injuredId of stagedSide.value.injured) {
    if (!stagedSide.value.usedPlayers.includes(injuredId) && !ids.includes(injuredId))
      ids.push(injuredId)
  }

  return sortByLineupOrder(ids.map(toPlayer).filter((p): p is SquadPlayer => Boolean(p)))
})

const benchPlayers = computed(() =>
  sortByLineupOrder(stagedSide.value.bench.map(toPlayer).filter((p): p is SquadPlayer => Boolean(p))),
)

function isInjured(playerId: number) {
  return stagedSide.value.injured.includes(playerId)
}

function isBooked(playerId: number) {
  return stagedSide.value.booked.includes(playerId)
}

function isSentOff(playerId: number) {
  return stagedSide.value.sentOff.includes(playerId)
}

/** Why this player cannot be taken off, or null if they can. */
function outBlockedReason(playerId: number): string | null {
  if (isSentOff(playerId)) return 'Sent off — cannot be replaced'
  if (subsRemaining.value <= 0) return 'No substitutions remaining'
  return null
}

/**
 * Why this bench player cannot come on right now. This is the message the old
 * panel never showed — players simply greyed out with no explanation.
 */
function benchBlockedReason(playerId: number): string | null {
  if (subsRemaining.value <= 0)
    return 'No substitutions remaining'

  if (selectedOutId.value === null)
    return 'Pick a player to take off first'

  return substitutionError(stagedSide.value, {
    playerOutId: selectedOutId.value,
    playerInId: playerId,
  })
}

function selectOut(playerId: number) {
  const blocked = outBlockedReason(playerId)
  if (blocked) {
    sfx.play('error')
    return
  }

  if (selectedOutId.value === playerId) {
    selectedOutId.value = null
    sfx.play('deselect')
    return
  }

  selectedOutId.value = playerId
  sfx.play('select')
}

function selectBench(playerId: number) {
  if (benchBlockedReason(playerId)) {
    // Shake the row rather than doing nothing silently.
    shakeBenchId.value = playerId
    sfx.play('error')
    setTimeout(() => { shakeBenchId.value = null }, 420)
    return
  }

  stagedSubs.value = [...stagedSubs.value, {
    playerOutId: selectedOutId.value!,
    playerInId: playerId,
  }]
  selectedOutId.value = null
  sfx.play('sub')
}

function removeStagedSub(index: number) {
  stagedSubs.value = stagedSubs.value.filter((_, i) => i !== index)
  sfx.play('deselect')
}

function undoLast() {
  if (!stagedSubs.value.length) return
  stagedSubs.value = stagedSubs.value.slice(0, -1)
  sfx.play('deselect')
}

function nameOf(playerId: number): string {
  return toPlayer(playerId)?.name ?? `#${playerId}`
}

/**
 * The tired-legs suggestion: the lowest effective-skill player on the pitch,
 * paired with the strongest bench player who can legally replace them.
 * Uses `effectiveSkill()` so fatigue is weighted the same way the engine
 * weights it when resolving the match.
 */
const suggestion = computed(() => {
  if (subsRemaining.value <= 0 || isInjuryPause.value) return null

  const candidates = outCandidates.value
    .filter(p => !isSentOff(p.id) && !isInjured(p.id))
    .map(p => ({ player: p, score: effectiveSkill(p.skillLevel, staminaOf(p.id)) }))
    .sort((a, b) => a.score - b.score)

  const weakest = candidates[0]
  if (!weakest || staminaOf(weakest.player.id) > 70) return null

  const wantedSlot = slotOf(weakest.player)
  const replacement = benchPlayers.value
    .filter(p => !substitutionError(stagedSide.value, { playerOutId: weakest.player.id, playerInId: p.id }))
    .filter(p => !wantedSlot || slotOf(p) === wantedSlot)
    .sort((a, b) => effectiveSkill(b.skillLevel, staminaOf(b.id)) - effectiveSkill(a.skillLevel, staminaOf(a.id)))[0]

  if (!replacement) return null
  if (effectiveSkill(replacement.skillLevel, staminaOf(replacement.id)) <= weakest.score) return null

  return { out: weakest.player, in: replacement }
})

function applySuggestion() {
  if (!suggestion.value) return
  stagedSubs.value = [...stagedSubs.value, {
    playerOutId: suggestion.value.out.id,
    playerInId: suggestion.value.in.id,
  }]
  selectedOutId.value = null
  sfx.play('sub')
}

// ---- Formation ----

const currentFormation = computed(() =>
  props.tacticOptions.find(t => t.name === ownSide.value.tacticName)?.formation ?? null,
)

const selectedFormation = computed(() =>
  props.tacticOptions.find(t => t.name === selectedTactic.value)?.formation ?? null,
)

const tacticItems = computed(() => props.tacticOptions.map(t => ({
  label: `${t.name}  ·  ${t.formation.DF}-${t.formation.MF}-${t.formation.FW}`,
  value: t.name,
})))

/** Plain-language description of what changing formation actually does. */
const formationDiff = computed(() => {
  const from = currentFormation.value
  const to = selectedFormation.value
  if (!from || !to || selectedTactic.value === ownSide.value.tacticName) return null

  const names: Record<LineupSlot, [string, string]> = {
    GK: ['goalkeeper', 'goalkeepers'],
    DF: ['defender', 'defenders'],
    MF: ['midfielder', 'midfielders'],
    FW: ['forward', 'forwards'],
  }

  const parts: string[] = []
  for (const slot of ['DF', 'MF', 'FW'] as LineupSlot[]) {
    const delta = to[slot] - from[slot]
    if (!delta) continue
    const count = Math.abs(delta)
    const [singular, plural] = names[slot]
    parts.push(`${delta > 0 ? '+' : '−'}${count} ${count === 1 ? singular : plural}`)
  }

  return parts.length ? parts.join(', ') : null
})

/** Rows of dots for the little formation shape preview. */
const formationShape = computed(() => {
  const formation = selectedFormation.value
  if (!formation) return []
  return (['FW', 'MF', 'DF', 'GK'] as LineupSlot[])
    .map(slot => ({ slot, count: formation[slot] }))
    .filter(row => row.count > 0)
})

// ---- Actions ----

const canConfirm = computed(() => {
  if (isInjuryPause.value) return stagedSubs.value.length > 0
  return true
})

const confirmLabel = computed(() => {
  if (isInjuryPause.value) return 'Confirm replacement'
  if (stagedSubs.value.length) {
    const count = stagedSubs.value.length
    return `Confirm ${count} substitution${count === 1 ? '' : 's'}`
  }
  if (formationDiff.value) return 'Confirm formation change'
  return props.isHalfTime ? 'Start second half' : 'Resume match'
})

const skipLabel = computed(() => {
  if (isInjuryPause.value) return 'Play on with ten'
  return stagedSubs.value.length || formationDiff.value ? 'Discard and resume' : 'Continue without changes'
})

function confirm() {
  if (!canConfirm.value) return
  emit('confirm', { substitutions: stagedSubs.value, tactic: selectedTactic.value })
}

function skip() {
  emit('close')
}

function onKeydown(event: KeyboardEvent) {
  if (!props.open) return

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    undoLast()
    return
  }

  if (event.key === 'Escape' && selectedOutId.value !== null) {
    // Clear the selection before the modal's own Esc handling gets it.
    event.preventDefault()
    event.stopPropagation()
    selectedOutId.value = null
    sfx.play('deselect')
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <!-- title/description give Reka's dialog an accessible name (rendered visually hidden). -->
  <UModal
    :open="open"
    :title="isInjuryPause ? 'Injury' : isHalfTime ? 'Half Time' : 'Tactical Pause'"
    :description="`Manage substitutions and formation for ${teamName}`"
    :dismissible="false"
    :ui="{ content: 'sm:max-w-3xl' }"
  >
    <template #content>
      <div class="app-surface animate-scale-in max-h-[92vh] overflow-y-auto">
        <!-- Header -->
        <div
          class="sticky top-0 z-10 flex items-center gap-3 border-b p-5 backdrop-blur-xl"
          :style="{
            borderColor: 'var(--app-surface-border)',
            backgroundColor: 'var(--app-surface)',
          }"
        >
          <div
            class="flex size-10 shrink-0 items-center justify-center rounded-2xl"
            :style="{
              backgroundColor: isInjuryPause ? 'rgba(251,113,133,0.16)' : 'var(--app-accent-soft)',
              color: isInjuryPause ? 'var(--app-player-injured)' : 'var(--app-accent)',
            }"
          >
            <UIcon
              :name="isInjuryPause ? 'i-lucide-bandage' : isHalfTime ? 'i-lucide-coffee' : 'i-lucide-clipboard-list'"
              class="size-5"
              :class="isInjuryPause && 'animate-heartbeat'"
            />
          </div>

          <div class="min-w-0 flex-1">
            <h2 class="text-lg font-bold leading-tight" style="color: var(--app-text)">
              {{ isInjuryPause ? 'Injury' : isHalfTime ? 'Half Time' : 'Tactical Pause' }}
            </h2>
            <p class="app-muted-text truncate text-xs">{{ teamName }}</p>
          </div>

          <!-- Substitution allowance as pips -->
          <div class="flex shrink-0 items-center gap-2">
            <div class="hidden text-right sm:block">
              <p class="app-kicker text-[9px]">Subs left</p>
              <p class="text-sm font-bold tabular-nums" style="color: var(--app-text)">
                {{ subsRemaining }}<span class="app-muted-text">/{{ MAX_SUBSTITUTIONS }}</span>
              </p>
            </div>
            <div class="flex gap-1" :aria-label="`${subsRemaining} of ${MAX_SUBSTITUTIONS} substitutions remaining`">
              <span
                v-for="(pip, i) in subPips"
                :key="i"
                class="size-2 rounded-full transition-all duration-300"
                :style="{
                  backgroundColor: pip === 'used'
                    ? 'var(--app-text-muted)'
                    : pip === 'staged'
                      ? 'var(--app-accent)'
                      : 'color-mix(in srgb, var(--app-text-muted) 28%, transparent)',
                  transform: pip === 'staged' ? 'scale(1.25)' : 'scale(1)',
                }"
              />
            </div>
          </div>
        </div>

        <div class="space-y-4 p-5">
          <!-- Injury banner -->
          <div
            v-if="isInjuryPause"
            class="flex items-start gap-3 rounded-2xl p-3.5 text-sm animate-pop-in"
            style="background-color: rgba(251,113,133,0.12); border: 1px solid rgba(251,113,133,0.28)"
          >
            <UIcon name="i-lucide-bandage" class="mt-0.5 size-4 shrink-0" style="color: var(--app-player-injured)" />
            <p style="color: var(--app-text-soft)">
              <span class="font-bold" style="color: var(--app-text)">{{ injuredPlayerName }}</span>
              is off injured.
              <template v-if="hasSubsLeft">Pick a replacement from the bench, or play on with ten.</template>
              <template v-else>You have no substitutions left — you must play on with ten.</template>
            </p>
          </div>

          <!-- Formation -->
          <div class="app-surface-subtle p-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="flex items-center gap-3">
                <!-- Shape preview -->
                <div
                  class="flex h-14 w-11 shrink-0 flex-col justify-around rounded-lg px-1 py-1.5"
                  style="background-image: linear-gradient(to bottom, var(--app-pitch-from), var(--app-pitch-via)); border: 1px solid var(--app-surface-border)"
                  aria-hidden="true"
                >
                  <div v-for="row in formationShape" :key="row.slot" class="flex justify-center gap-0.5">
                    <span
                      v-for="n in row.count"
                      :key="n"
                      class="size-1 rounded-full transition-all duration-300"
                      style="background-color: rgba(255,255,255,0.9)"
                    />
                  </div>
                </div>

                <div>
                  <p class="app-kicker text-[10px]">Formation</p>
                  <USelectMenu
                    v-model="selectedTactic"
                    :items="tacticItems"
                    value-key="value"
                    class="mt-1 w-44"
                    size="sm"
                  />
                </div>
              </div>

              <div v-if="formationDiff" class="app-chip app-chip--warning animate-pop-in">
                <UIcon name="i-lucide-arrow-right-left" class="size-3" />
                {{ ownSide.tacticName }} → {{ selectedTactic }}: {{ formationDiff }}
              </div>
            </div>
          </div>

          <!-- Suggestion -->
          <button
            v-if="suggestion && !stagedSubs.length"
            type="button"
            class="app-surface-subtle flex w-full items-center gap-3 p-3 text-left transition hover:-translate-y-0.5 animate-fade-in-up"
            style="border-color: color-mix(in srgb, var(--app-player-booked) 30%, transparent)"
            @click="applySuggestion"
          >
            <UIcon name="i-lucide-lightbulb" class="size-4 shrink-0" style="color: var(--app-player-booked)" />
            <span class="min-w-0 flex-1 text-xs" style="color: var(--app-text-soft)">
              <span class="font-bold" style="color: var(--app-text)">{{ suggestion.out.name }}</span>
              is tiring ({{ staminaOf(suggestion.out.id) }}%). Bring on
              <span class="font-bold" style="color: var(--app-text)">{{ suggestion.in.name }}</span>?
            </span>
            <span class="app-chip app-chip--warning shrink-0">Apply</span>
          </button>

          <!-- Staged substitutions -->
          <Transition
            enter-active-class="transition duration-200 ease-out"
            enter-from-class="opacity-0 -translate-y-2"
            leave-active-class="transition duration-150 ease-in"
            leave-to-class="opacity-0 -translate-y-2"
          >
            <div
              v-if="stagedSubs.length"
              class="app-surface-subtle space-y-2 p-3.5"
              style="border-color: color-mix(in srgb, var(--app-accent) 34%, transparent)"
            >
              <div class="flex items-center justify-between">
                <p class="app-kicker text-[10px]">
                  Staged — {{ stagedSubs.length }} substitution{{ stagedSubs.length === 1 ? '' : 's' }}
                </p>
                <UButton
                  label="Undo last"
                  icon="i-lucide-undo-2"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  title="Undo last substitution (Ctrl+Z)"
                  @click="undoLast"
                />
              </div>

              <TransitionGroup
                enter-active-class="transition duration-200 ease-out"
                enter-from-class="opacity-0 translate-x-3"
                leave-active-class="absolute transition duration-150 ease-in"
                leave-to-class="opacity-0 -translate-x-3"
                move-class="transition duration-200"
                tag="div"
                class="relative space-y-1.5"
              >
                <div
                  v-for="(sub, index) in stagedSubs"
                  :key="`${sub.playerOutId}-${sub.playerInId}`"
                  class="flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-sm"
                  style="background-color: var(--app-surface-muted)"
                >
                  <span class="app-chip app-chip--danger shrink-0 px-1.5 py-0">
                    <UIcon name="i-lucide-arrow-down" class="size-3" />
                    {{ nameOf(sub.playerOutId) }}
                  </span>
                  <span class="app-chip app-chip--success shrink-0 px-1.5 py-0">
                    <UIcon name="i-lucide-arrow-up" class="size-3" />
                    {{ nameOf(sub.playerInId) }}
                  </span>
                  <UButton
                    icon="i-lucide-x"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    class="ml-auto shrink-0"
                    :aria-label="`Remove ${nameOf(sub.playerOutId)} substitution`"
                    @click="removeStagedSub(index)"
                  />
                </div>
              </TransitionGroup>
            </div>
          </Transition>

          <!-- Pitch / bench -->
          <div class="grid gap-3 sm:grid-cols-2">
            <!-- On the pitch -->
            <div>
              <p class="app-kicker mb-2 text-[10px]">
                On the pitch — tap to take off
              </p>
              <ul class="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                <li v-for="player in outCandidates" :key="player.id">
                  <button
                    type="button"
                    class="w-full rounded-xl border p-2 text-left transition duration-200"
                    :disabled="Boolean(outBlockedReason(player.id))"
                    :aria-pressed="selectedOutId === player.id"
                    :title="outBlockedReason(player.id) ?? `Take ${player.name} off`"
                    :style="selectedOutId === player.id
                      ? {
                        borderColor: 'var(--app-player-sent-off)',
                        backgroundColor: 'rgba(248,113,113,0.14)',
                        boxShadow: '0 0 0 3px rgba(248,113,113,0.2)',
                      }
                      : {
                        borderColor: 'var(--app-surface-border)',
                        backgroundColor: 'var(--app-surface-muted)',
                      }"
                    :class="[
                      Boolean(outBlockedReason(player.id)) && 'cursor-not-allowed opacity-45',
                      !outBlockedReason(player.id) && selectedOutId !== player.id && 'hover:-translate-y-0.5',
                    ]"
                    @click="selectOut(player.id)"
                  >
                    <div class="flex items-center gap-2">
                      <AppPositionBadge :position="player.position" size="xs" />
                      <span class="min-w-0 flex-1 truncate text-xs font-medium" style="color: var(--app-text-soft)">
                        {{ player.name }}
                      </span>

                      <UIcon
                        v-if="isInjured(player.id)"
                        name="i-lucide-bandage"
                        class="size-3 shrink-0"
                        style="color: var(--app-player-injured)"
                        title="Injured"
                      />
                      <span
                        v-if="isBooked(player.id)"
                        class="h-3 w-2 shrink-0 rounded-[1px]"
                        style="background-color: var(--app-player-booked)"
                        title="Booked — at risk of a second yellow"
                      />
                      <span
                        v-if="isSentOff(player.id)"
                        class="h-3 w-2 shrink-0 rounded-[1px]"
                        style="background-color: var(--app-player-sent-off)"
                        title="Sent off"
                      />

                      <span class="shrink-0 text-[10px] font-bold tabular-nums" style="color: var(--app-text-muted)">
                        {{ player.skillLevel }}
                      </span>

                      <span
                        v-if="selectedOutId === player.id"
                        class="app-chip app-chip--danger shrink-0 animate-pop-in px-1.5 py-0"
                      >
                        <UIcon name="i-lucide-arrow-down" class="size-3" />
                        Off
                      </span>
                    </div>

                    <AppStatBar
                      :value="staminaOf(player.id)"
                      class="mt-1.5"
                      size="xs"
                      show-value
                      percent
                      threshold
                      alert-when-low
                    />
                  </button>
                </li>
                <li v-if="!outCandidates.length" class="app-muted-text text-xs">No players on the pitch.</li>
              </ul>
            </div>

            <!-- Bench -->
            <div>
              <p class="app-kicker mb-2 flex items-center gap-1.5 text-[10px]">
                Bench —
                <span v-if="selectedOutId" style="color: var(--app-accent)">
                  tap who replaces {{ nameOf(selectedOutId) }}
                </span>
                <span v-else>pick a player to take off first</span>
              </p>
              <ul class="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                <li v-for="player in benchPlayers" :key="player.id">
                  <button
                    type="button"
                    class="w-full rounded-xl border p-2 text-left transition duration-200"
                    :class="[
                      benchBlockedReason(player.id) ? 'cursor-not-allowed opacity-45' : 'hover:-translate-y-0.5',
                      shakeBenchId === player.id && 'animate-shake',
                    ]"
                    :style="!benchBlockedReason(player.id)
                      ? {
                        borderColor: 'color-mix(in srgb, var(--app-accent) 45%, transparent)',
                        backgroundColor: 'var(--app-accent-soft)',
                      }
                      : {
                        borderColor: 'var(--app-surface-border)',
                        backgroundColor: 'var(--app-surface-muted)',
                      }"
                    :title="benchBlockedReason(player.id) ?? `Bring ${player.name} on`"
                    @click="selectBench(player.id)"
                  >
                    <div class="flex items-center gap-2">
                      <AppPositionBadge :position="player.position" size="xs" :muted="Boolean(benchBlockedReason(player.id))" />
                      <span class="min-w-0 flex-1 truncate text-xs font-medium" style="color: var(--app-text-soft)">
                        {{ player.name }}
                      </span>
                      <span class="shrink-0 text-[10px] font-bold tabular-nums" style="color: var(--app-text-muted)">
                        {{ player.skillLevel }}
                      </span>
                      <UIcon
                        v-if="!benchBlockedReason(player.id)"
                        name="i-lucide-arrow-up"
                        class="size-3.5 shrink-0"
                        style="color: var(--app-accent)"
                      />
                    </div>

                    <AppStatBar
                      :value="staminaOf(player.id)"
                      class="mt-1.5"
                      size="xs"
                      show-value
                      percent
                      threshold
                    />

                    <!-- The explanation the old panel never gave. -->
                    <p
                      v-if="benchBlockedReason(player.id)"
                      class="mt-1 text-[10px] italic"
                      style="color: var(--app-text-muted)"
                    >
                      {{ benchBlockedReason(player.id) }}
                    </p>
                  </button>
                </li>
                <li v-if="!benchPlayers.length" class="app-muted-text text-xs">No players available.</li>
              </ul>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div
          class="sticky bottom-0 flex flex-col-reverse gap-2 border-t p-5 backdrop-blur-xl sm:flex-row sm:justify-end"
          :style="{ borderColor: 'var(--app-surface-border)', backgroundColor: 'var(--app-surface)' }"
        >
          <UButton
            :label="skipLabel"
            color="neutral"
            variant="soft"
            :disabled="loading"
            @click="skip"
          />
          <UButton
            v-if="!isInjuryPause || hasSubsLeft"
            :label="confirmLabel"
            :icon="stagedSubs.length ? 'i-lucide-check' : 'i-lucide-play'"
            :loading="loading"
            :disabled="!canConfirm"
            :class="stagedSubs.length && 'app-glow'"
            @click="confirm"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
