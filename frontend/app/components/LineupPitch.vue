<script setup lang="ts">
/**
 * The lineup builder's pitch.
 *
 * Uses the `.app-pitch-*` classes from `main.css` — they were defined there
 * from the start but the Dashboard hand-rolled the same styling in raw
 * Tailwind chains, so they had never actually been used.
 *
 * Players can be dragged between slots or dropped in from the squad list; the
 * legal target for whatever is being dragged is highlighted, and an illegal
 * drop shakes rather than silently doing nothing.
 */
import { computed, ref } from 'vue'
import type { LineupSlot } from '#shared/lineup'
import { normalizePosition } from '#shared/lineup'
import { getInitials } from '~/utils/format'
// The shared squad type, not a local re-declaration — a narrower duplicate here
// made the Dashboard's `@remove` handler structurally incompatible.
import type { SquadPlayer } from '~/composables/useGameContext'

interface PitchRow {
  position: LineupSlot
  label: string
  selected: number
  required: number
  slots: { key: string; player: SquadPlayer | null; slotNumber: number }[]
}

const props = defineProps<{
  rows: PitchRow[]
  /** Slot the currently-dragged player would be legal in, if any. */
  dragSlot: LineupSlot | null
}>()

const emit = defineEmits<{
  remove: [player: SquadPlayer]
  drop: [payload: { playerId: number; slot: LineupSlot }]
  dragStart: [player: SquadPlayer]
  dragEnd: []
}>()

const invalidSlot = ref<string | null>(null)

function onDragStart(event: DragEvent, player: SquadPlayer) {
  event.dataTransfer?.setData('text/plain', String(player.id))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
  emit('dragStart', player)
}

function onDragOver(event: DragEvent, slot: LineupSlot) {
  // Only allow the drop if this is the slot the dragged player belongs in.
  if (props.dragSlot !== slot) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}

function onDrop(event: DragEvent, slot: LineupSlot, key: string) {
  event.preventDefault()
  const playerId = Number(event.dataTransfer?.getData('text/plain'))
  if (!playerId) return

  if (props.dragSlot !== slot) {
    invalidSlot.value = key
    setTimeout(() => { invalidSlot.value = null }, 420)
    return
  }

  emit('drop', { playerId, slot })
}

function staminaTone(value: number) {
  if (value < 40) return 'var(--app-player-sent-off)'
  if (value < 65) return 'var(--app-player-booked)'
  return 'var(--app-accent)'
}

function isInjured(player: SquadPlayer) {
  return (player.injuredMatches ?? 0) > 0
}

/** Conic-gradient ring showing a 0–100 attribute around the avatar. */
function ringStyle(value: number, color: string) {
  return {
    backgroundImage: `conic-gradient(${color} ${value * 3.6}deg, color-mix(in srgb, ${color} 16%, transparent) 0deg)`,
  }
}

const totalSelected = computed(() => props.rows.reduce((sum, row) => sum + row.selected, 0))
</script>

<template>
  <div class="app-pitch-board">
    <!-- Markings -->
    <div class="app-pitch-line inset-4 rounded-[1.75rem]" />
    <div class="app-pitch-line inset-x-4 top-1/2 h-0 border-x-0 border-b-0" />
    <div class="app-pitch-line left-1/2 top-1/2 size-20 -translate-x-1/2 -translate-y-1/2 rounded-full sm:size-28" />
    <div class="app-pitch-line left-1/2 top-4 h-12 w-28 -translate-x-1/2 rounded-b-[1.5rem] border-t-0 sm:w-40" />
    <div class="app-pitch-line left-1/2 bottom-4 h-12 w-28 -translate-x-1/2 rounded-t-[1.5rem] border-b-0 sm:w-40" />
    <!-- Six-yard boxes -->
    <div class="app-pitch-line left-1/2 top-4 h-5 w-16 -translate-x-1/2 rounded-b-lg border-t-0 sm:w-24" />
    <div class="app-pitch-line left-1/2 bottom-4 h-5 w-16 -translate-x-1/2 rounded-t-lg border-b-0 sm:w-24" />
    <!-- Centre spot -->
    <div
      class="pointer-events-none absolute left-1/2 top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
      style="background-color: var(--app-pitch-line)"
    />

    <div class="relative z-10 flex min-h-120 flex-col justify-between gap-5">
      <div v-for="row in rows" :key="row.position" class="space-y-3">
        <div class="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.18em]">
          <span class="app-pitch-muted">{{ row.label }}</span>
          <span
            class="tabular-nums"
            :class="row.selected === row.required ? 'app-pitch-muted' : ''"
            :style="row.selected !== row.required ? 'color: var(--app-player-booked)' : undefined"
          >{{ row.selected }}/{{ row.required }}</span>
        </div>

        <div class="flex flex-wrap items-stretch justify-center gap-3 sm:gap-4">
          <TransitionGroup
            enter-active-class="transition duration-300 ease-out"
            enter-from-class="opacity-0 scale-90"
            leave-active-class="absolute transition duration-200 ease-in"
            leave-to-class="opacity-0 scale-90"
            move-class="transition duration-300"
          >
            <template v-for="slot in row.slots" :key="slot.key">
              <!-- Filled -->
              <button
                v-if="slot.player"
                type="button"
                draggable="true"
                class="app-pitch-player group relative"
                :title="`${slot.player.name} — click to remove, drag to move`"
                @click="emit('remove', slot.player)"
                @dragstart="onDragStart($event, slot.player)"
                @dragend="emit('dragEnd')"
              >
                <span
                  v-if="isInjured(slot.player)"
                  class="absolute right-2 top-2"
                  :title="`Injured for ${slot.player.injuredMatches} match(es)`"
                >
                  <UIcon name="i-lucide-bandage" class="size-3.5" style="color: var(--app-player-injured)" />
                </span>

                <!-- Skill ring around the initials -->
                <span
                  class="mb-2 flex size-11 items-center justify-center rounded-full p-[2px] transition-transform group-hover:scale-105"
                  :style="ringStyle(slot.player.skillLevel, 'var(--app-accent)')"
                >
                  <span
                    class="flex size-full items-center justify-center rounded-full text-sm font-bold"
                    style="background-color: rgba(8,15,23,0.72); color: var(--app-pitch-text)"
                  >{{ getInitials(slot.player.name) }}</span>
                </span>

                <span class="text-sm font-semibold leading-tight">{{ slot.player.name }}</span>

                <span class="mt-1 flex items-center gap-1.5 text-[11px]">
                  <span class="app-pitch-muted font-bold tabular-nums">{{ slot.player.skillLevel }}</span>
                  <span class="app-pitch-faint">·</span>
                  <span class="font-bold tabular-nums" :style="{ color: staminaTone(slot.player.stamina) }">
                    {{ slot.player.stamina }}%
                  </span>
                </span>

                <span
                  class="mt-1.5 h-1 w-14 overflow-hidden rounded-full"
                  style="background-color: rgba(255,255,255,0.18)"
                >
                  <span
                    class="block h-full rounded-full transition-all duration-500"
                    :style="{ width: `${slot.player.stamina}%`, backgroundColor: staminaTone(slot.player.stamina) }"
                  />
                </span>
              </button>

              <!-- Empty -->
              <div
                v-else
                class="app-pitch-slot"
                :class="[
                  dragSlot === row.position && 'app-pitch-slot--target',
                  invalidSlot === slot.key && 'animate-shake',
                ]"
                @dragover="onDragOver($event, row.position)"
                @drop="onDrop($event, row.position, slot.key)"
              >
                <UIcon
                  :name="dragSlot === row.position ? 'i-lucide-circle-plus' : 'i-lucide-user-plus'"
                  class="mb-1 size-5"
                  :class="dragSlot === row.position && 'animate-glow-pulse'"
                />
                <span class="text-[11px] font-semibold uppercase tracking-[0.2em]">{{ row.position }}</span>
                <span class="mt-1 text-xs font-medium">
                  {{ dragSlot === row.position ? 'Drop here' : `Slot ${slot.slotNumber}` }}
                </span>
              </div>
            </template>
          </TransitionGroup>
        </div>
      </div>
    </div>

    <!-- Counter -->
    <div class="relative z-10 mt-4 flex justify-center">
      <span
        class="rounded-full px-3 py-1 text-[11px] font-bold tabular-nums backdrop-blur"
        style="background-color: rgba(8,15,23,0.45); color: var(--app-pitch-text)"
      >{{ totalSelected }} / 11 on the teamsheet</span>
    </div>
  </div>
</template>
