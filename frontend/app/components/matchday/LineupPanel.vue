<script setup lang="ts">
/**
 * One side's live XI and bench.
 *
 * Players carry inline markers for what has happened to them — goals, cards,
 * substitution, injury — so the panel reads as a team sheet rather than a
 * list of names. Injured players get their own state: previously they were
 * styled identically to anyone benched, which the docs called out as a known
 * limitation.
 */
import { computed } from 'vue'
import { sortByLineupOrder } from '#shared/lineup'
import type { MatchSideState } from '#shared/match-state'
import { normalizeEventType } from '~/utils/match-events'
import type { MatchEvent } from '#shared/match-state'

interface SquadPlayer {
  id: number
  name: string
  position: string
  skillLevel: number
}

const props = defineProps<{
  title: string
  accent: string
  squad: SquadPlayer[]
  /** Null before kickoff — the panel then falls back to the pre-match preview. */
  side: MatchSideState | null
  previewXi: number[]
  previewBench: number[]
  autoSelected: boolean
  isPlayerTeam: boolean
  events: MatchEvent[]
  currentMinute: number
  teamId: number | null
}>()

interface Row {
  id: number
  name: string
  position: string
  status: 'on' | 'booked' | 'sentOff' | 'injured' | 'out'
  statusClass: string
  stamina: number
  goals: number
  subbed: boolean
}

const squadById = computed(() => new Map(props.squad.map(p => [p.id, p])))

/** Per-player tallies from the events revealed so far. */
const marks = computed(() => {
  const goals = new Map<number, number>()
  const subbedOff = new Set<number>()

  for (const event of props.events) {
    if (event.minute > props.currentMinute) continue
    if (event.teamId !== props.teamId) continue

    const type = normalizeEventType(event.eventType)
    if (type === 'goal' && event.playerId)
      goals.set(event.playerId, (goals.get(event.playerId) ?? 0) + 1)
    if (type === 'substitution' && event.relatedPlayerId)
      subbedOff.add(event.relatedPlayerId)
  }

  return { goals, subbedOff }
})

function statusOf(playerId: number): Row['status'] {
  const side = props.side
  if (!side) return 'on'

  if (side.sentOff.includes(playerId)) return 'sentOff'
  if (side.injured.includes(playerId)) return 'injured'
  if (side.booked.includes(playerId)) return 'booked'
  if (!side.onPitch.includes(playerId)) return 'out'
  return 'on'
}

const STATUS_CLASS: Record<Row['status'], string> = {
  on: 'app-player-on-pitch',
  booked: 'app-player-booked',
  sentOff: 'app-player-sent-off',
  injured: 'app-player-injured',
  out: 'app-player-out',
}

function toRow(player: SquadPlayer): Row {
  const status = statusOf(player.id)
  return {
    id: player.id,
    name: player.name,
    position: player.position,
    status,
    statusClass: STATUS_CLASS[status],
    stamina: Math.round(props.side?.stamina[player.id] ?? 100),
    goals: marks.value.goals.get(player.id) ?? 0,
    subbed: marks.value.subbedOff.has(player.id),
  }
}

function resolve(ids: number[]): SquadPlayer[] {
  return ids.map(id => squadById.value.get(id)).filter((p): p is SquadPlayer => Boolean(p))
}

const starters = computed(() => {
  const ids = props.side?.onPitch ?? props.previewXi
  return sortByLineupOrder(resolve(ids)).map(toRow)
})

const bench = computed(() => {
  const onPitch = props.side?.onPitch ?? props.previewXi
  const ids = props.side
    ? props.squad.map(p => p.id).filter(id => !onPitch.includes(id))
    : props.previewBench

  return sortByLineupOrder(resolve(ids)).map(toRow)
})
</script>

<template>
  <UCard class="app-surface h-full">
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-shield" class="size-4 shrink-0" :style="{ color: accent }" />
        <span class="truncate">{{ title }}</span>
        <span v-if="isPlayerTeam" class="app-chip app-chip--success shrink-0 px-1.5 py-0">You</span>
        <UTooltip v-if="autoSelected" text="No saved XI — the strongest available eleven was picked automatically">
          <span class="app-chip shrink-0 px-1.5 py-0">Auto</span>
        </UTooltip>
      </div>
    </template>

    <ul class="max-h-96 space-y-1.5 overflow-y-auto pr-1">
      <TransitionGroup
        enter-active-class="transition duration-300 ease-out"
        enter-from-class="opacity-0 translate-x-2"
        leave-active-class="absolute transition duration-200 ease-in"
        leave-to-class="opacity-0 -translate-x-2"
        move-class="transition duration-300"
      >
        <li v-for="player in starters" :key="`s-${player.id}`" class="space-y-1">
          <div class="flex items-center gap-1.5">
            <AppPositionBadge :position="player.position" size="xs" />
            <span class="min-w-0 flex-1 truncate text-xs sm:text-sm" :class="player.statusClass">
              {{ player.name }}
            </span>

            <span v-if="player.goals" class="flex shrink-0 items-center gap-0.5" :title="`${player.goals} goal(s)`">
              <UIcon name="i-lucide-circle-dot" class="size-3" style="color: var(--app-accent)" />
              <span v-if="player.goals > 1" class="text-[9px] font-bold" style="color: var(--app-accent)">
                {{ player.goals }}
              </span>
            </span>
            <span
              v-if="player.status === 'booked'"
              class="h-3 w-2 shrink-0 rounded-[1px]"
              style="background-color: var(--app-player-booked)"
              title="Booked"
            />
            <span
              v-if="player.status === 'sentOff'"
              class="h-3 w-2 shrink-0 rounded-[1px]"
              style="background-color: var(--app-player-sent-off)"
              title="Sent off"
            />
          </div>
          <AppStatBar :value="player.stamina" size="xs" threshold alert-when-low />
        </li>
      </TransitionGroup>

      <li v-if="!starters.length" class="app-muted-text text-sm">No lineup available.</li>

      <template v-if="bench.length">
        <li class="app-kicker pt-3 text-[10px]">Bench</li>
        <li v-for="player in bench" :key="`b-${player.id}`" class="flex items-center gap-1.5">
          <AppPositionBadge :position="player.position" size="xs" muted />
          <span class="min-w-0 flex-1 truncate text-xs sm:text-sm" :class="player.statusClass">
            {{ player.name }}
          </span>
          <span v-if="player.goals" class="shrink-0">
            <UIcon name="i-lucide-circle-dot" class="size-3" style="color: var(--app-accent)" />
          </span>
          <UIcon
            v-if="player.status === 'injured'"
            name="i-lucide-bandage"
            class="size-3 shrink-0"
            style="color: var(--app-player-injured)"
            title="Off injured"
          />
          <UIcon
            v-else-if="player.subbed"
            name="i-lucide-arrow-down"
            class="size-3 shrink-0"
            style="color: var(--app-text-muted)"
            title="Substituted off"
          />
        </li>
      </template>
    </ul>
  </UCard>
</template>
