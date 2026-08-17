<script setup lang="ts">
/**
 * The commentary feed.
 *
 * Every row used to carry identical weight, so three goals sat visually level
 * with fifteen crosses. Rows are now graded by `eventWeight()`: goals become
 * hero cards, discipline and subs are tinted, routine play recedes.
 */
import { computed, ref, watch } from 'vue'
import { EVENT_FILTERS, eventIcon, eventIconClass, eventLabel, eventWeight, normalizeEventType } from '~/utils/match-events'
import type { EventFilterId } from '~/utils/match-events'

export interface FeedEntry {
  id: string
  minute: number
  type: string
  teamName: string
  playerName: string | null
  relatedPlayerName: string | null
  isHome: boolean
}

const props = defineProps<{
  entries: FeedEntry[]
  hasStarted: boolean
}>()

const activeFilter = ref<EventFilterId>('all')
const scroller = ref<HTMLElement | null>(null)
const isPinned = ref(true)

const counts = computed(() => {
  const map: Record<string, number> = {}
  for (const filter of EVENT_FILTERS) {
    map[filter.id] = filter.types
      ? props.entries.filter(e => filter.types!.includes(normalizeEventType(e.type))).length
      : props.entries.length
  }
  return map
})

const filtered = computed(() => {
  const filter = EVENT_FILTERS.find(f => f.id === activeFilter.value)
  if (!filter?.types) return props.entries
  return props.entries.filter(entry => filter.types!.includes(normalizeEventType(entry.type)))
})

// Feed is newest-first, so "latest" means scrolled to the top. Only auto-stick
// when the player hasn't deliberately scrolled back through the match.
function onScroll() {
  const el = scroller.value
  if (!el) return
  isPinned.value = el.scrollTop <= 8
}

watch(() => props.entries.length, () => {
  if (isPinned.value && scroller.value)
    scroller.value.scrollTo({ top: 0, behavior: 'smooth' })
})

function jumpToLatest() {
  scroller.value?.scrollTo({ top: 0, behavior: 'smooth' })
  isPinned.value = true
}

/** Scrolls a given minute into view — used by the timeline's markers. */
function scrollToMinute(minute: number) {
  const el = scroller.value?.querySelector<HTMLElement>(`[data-minute="${minute}"]`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('animate-pop-in')
  setTimeout(() => el.classList.remove('animate-pop-in'), 400)
}

defineExpose({ scrollToMinute })
</script>

<template>
  <UCard class="app-surface flex h-full flex-col">
    <template #header>
      <div class="space-y-2.5">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-activity" class="size-4 shrink-0" style="color: var(--app-accent)" />
          <span class="truncate">Match Events</span>
          <span v-if="entries.length" class="app-chip ml-auto shrink-0">{{ entries.length }}</span>
        </div>

        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="filter in EVENT_FILTERS"
            :key="filter.id"
            type="button"
            class="app-filter-chip inline-flex items-center gap-1 px-2 py-1 uppercase"
            :class="activeFilter === filter.id && 'app-filter-chip--active'"
            :aria-pressed="activeFilter === filter.id"
            @click="activeFilter = filter.id"
          >
            {{ filter.label }}
            <span v-if="counts[filter.id]" class="tabular-nums opacity-70">{{ counts[filter.id] }}</span>
          </button>
        </div>
      </div>
    </template>

    <div class="relative">
      <ul
        ref="scroller"
        class="max-h-96 space-y-1.5 overflow-y-auto pr-1"
        aria-live="polite"
        aria-relevant="additions"
        @scroll="onScroll"
      >
        <TransitionGroup
          enter-active-class="transition duration-300 ease-out"
          enter-from-class="opacity-0 -translate-x-3"
          move-class="transition duration-300"
        >
          <li
            v-for="entry in filtered"
            :key="entry.id"
            :data-minute="entry.minute"
            class="rounded-xl border px-2.5 py-2 transition"
            :class="{
              'border-transparent': eventWeight(entry.type) === 'routine',
              'opacity-70': eventWeight(entry.type) === 'routine',
            }"
            :style="eventWeight(entry.type) === 'hero'
              ? {
                borderColor: 'color-mix(in srgb, var(--app-accent) 45%, transparent)',
                backgroundColor: 'var(--app-accent-soft)',
              }
              : eventWeight(entry.type) === 'notable'
                ? { borderColor: 'var(--app-surface-border)', backgroundColor: 'var(--app-surface-muted)' }
                : undefined"
          >
            <div class="flex items-center gap-2">
              <UIcon
                :name="eventIcon(entry.type)"
                class="shrink-0"
                :class="[eventIconClass(entry.type), eventWeight(entry.type) === 'hero' ? 'size-5' : 'size-4']"
              />
              <span
                class="w-7 shrink-0 font-bold tabular-nums"
                :class="eventWeight(entry.type) === 'hero' ? 'text-base' : 'text-sm'"
                style="color: var(--app-text)"
              >{{ entry.minute }}'</span>

              <div class="min-w-0 flex-1">
                <p
                  class="truncate font-semibold capitalize"
                  :class="eventWeight(entry.type) === 'hero' ? 'text-base' : 'text-sm'"
                  style="color: var(--app-text-soft)"
                >
                  {{ eventLabel(entry.type) }}
                  <span v-if="entry.playerName" style="color: var(--app-text)">— {{ entry.playerName }}</span>
                </p>
                <p class="truncate text-[11px]" style="color: var(--app-text-muted)">
                  {{ entry.teamName }}
                  <template v-if="entry.relatedPlayerName">
                    · {{ entry.relatedPlayerName }} off
                  </template>
                </p>
              </div>

              <span
                class="size-1.5 shrink-0 rounded-full"
                :style="{ backgroundColor: entry.isHome ? 'var(--app-accent)' : 'var(--app-pos-gk)' }"
                :title="entry.isHome ? 'Home' : 'Away'"
              />
            </div>
          </li>
        </TransitionGroup>

        <li v-if="!filtered.length">
          <AppEmptyState
            compact
            icon="i-lucide-radio"
            :title="entries.length ? 'Nothing of that kind yet' : hasStarted ? 'Waiting for the first event' : 'Kick off to begin'"
            :description="entries.length ? 'Try another filter.' : undefined"
          />
        </li>
      </ul>

      <!-- Jump back to the newest event once the player has scrolled away -->
      <Transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="opacity-0 translate-y-2"
        leave-active-class="transition duration-150 ease-in"
        leave-to-class="opacity-0 translate-y-2"
      >
        <button
          v-if="!isPinned && entries.length"
          type="button"
          class="app-chip app-chip--success absolute inset-x-0 bottom-2 mx-auto w-fit shadow-lg"
          @click="jumpToLatest"
        >
          <UIcon name="i-lucide-arrow-up" class="size-3" />
          Jump to latest
        </button>
      </Transition>
    </div>
  </UCard>
</template>
