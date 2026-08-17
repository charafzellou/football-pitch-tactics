<script setup lang="ts">
/**
 * The 0–90 strip: home events above the line, away below, with a playhead at
 * the current minute. Gives the shape of the match at a glance — which the
 * reverse-chronological text feed never could.
 *
 * Routine crosses and fouls are excluded; at ~45 events a match they would
 * turn the strip into a solid bar. See `isTimelineEvent`.
 */
import { computed } from 'vue'
import { HALF_TIME_MINUTE, MATCH_MINUTES } from '#shared/match-state'
import type { MatchEvent } from '#shared/match-state'
import { eventLabel, eventMarkerColor, isTimelineEvent, normalizeEventType } from '~/utils/match-events'

const props = defineProps<{
  events: MatchEvent[]
  currentMinute: number
  homeTeamId: number | null
  playerNameFor: (playerId?: number) => string | null
}>()

const emit = defineEmits<{ select: [minute: number] }>()

interface Marker {
  key: string
  minute: number
  left: number
  isHome: boolean
  color: string
  type: string
  title: string
}

const markers = computed<Marker[]>(() =>
  props.events
    .filter(event => event.minute <= props.currentMinute && isTimelineEvent(event.eventType))
    .map((event, index) => {
      const player = props.playerNameFor(event.playerId)
      return {
        key: `${event.minute}-${event.eventType}-${index}`,
        minute: event.minute,
        left: Math.min(100, (event.minute / MATCH_MINUTES) * 100),
        isHome: event.teamId === props.homeTeamId,
        color: eventMarkerColor(event.eventType),
        type: normalizeEventType(event.eventType),
        title: `${event.minute}' ${eventLabel(event.eventType)}${player ? ` — ${player}` : ''}`,
      }
    }),
)

const playheadLeft = computed(() => Math.min(100, (props.currentMinute / MATCH_MINUTES) * 100))
const halfTimeLeft = (HALF_TIME_MINUTE / MATCH_MINUTES) * 100
</script>

<template>
  <div class="app-surface px-4 py-3.5 sm:px-5">
    <div class="mb-2 flex items-center justify-between">
      <p class="app-kicker text-[10px]">Timeline</p>
      <div class="flex items-center gap-3 text-[10px]" style="color: var(--app-text-muted)">
        <span class="flex items-center gap-1">
          <span class="size-1.5 rounded-full" style="background-color: var(--app-accent)" /> Goal
        </span>
        <span class="flex items-center gap-1">
          <span class="h-2 w-1.5 rounded-[1px]" style="background-color: var(--app-player-booked)" /> Card
        </span>
        <span class="flex items-center gap-1">
          <span class="size-1.5 rounded-full" style="background-color: var(--app-pos-gk)" /> Sub
        </span>
      </div>
    </div>

    <div class="relative h-14 select-none">
      <!-- Centre line -->
      <div
        class="absolute inset-x-0 top-1/2 h-px -translate-y-1/2"
        style="background-color: var(--app-surface-border-strong)"
      />

      <!-- Elapsed shading -->
      <div
        class="absolute inset-y-0 left-0 rounded-l transition-[width] duration-1000 ease-linear"
        :style="{
          width: `${playheadLeft}%`,
          backgroundImage: 'linear-gradient(90deg, transparent, var(--app-accent-soft))',
        }"
      />

      <!-- Half-time notch -->
      <div
        class="absolute inset-y-2 w-px"
        :style="{ left: `${halfTimeLeft}%`, backgroundColor: 'var(--app-surface-border-strong)' }"
      >
        <span
          class="absolute -top-0.5 left-1/2 -translate-x-1/2 text-[8px] font-bold uppercase"
          style="color: var(--app-text-muted)"
        >HT</span>
      </div>

      <!-- Playhead -->
      <div
        class="absolute inset-y-1 w-0.5 rounded-full transition-[left] duration-1000 ease-linear"
        :style="{ left: `${playheadLeft}%`, backgroundColor: 'var(--app-text)' }"
      />

      <!-- Markers -->
      <button
        v-for="marker in markers"
        :key="marker.key"
        type="button"
        class="absolute -translate-x-1/2 animate-pop-in transition-transform hover:scale-150 focus-visible:scale-150"
        :class="marker.isHome ? 'top-1.5' : 'bottom-1.5'"
        :style="{ left: `${marker.left}%` }"
        :title="marker.title"
        :aria-label="marker.title"
        @click="emit('select', marker.minute)"
      >
        <span
          v-if="marker.type === 'yellow' || marker.type === 'red'"
          class="block h-3 w-2 rounded-[1px]"
          :style="{ backgroundColor: marker.color }"
        />
        <span
          v-else
          class="block rounded-full"
          :class="marker.type === 'goal' ? 'size-3' : 'size-2'"
          :style="{
            backgroundColor: marker.color,
            boxShadow: marker.type === 'goal' ? `0 0 8px ${marker.color}` : undefined,
          }"
        />
      </button>

      <!-- Minute scale -->
      <div class="absolute inset-x-0 -bottom-1 flex justify-between text-[9px] tabular-nums" style="color: var(--app-text-muted)">
        <span>0'</span><span>45'</span><span>90'</span>
      </div>
    </div>
  </div>
</template>
