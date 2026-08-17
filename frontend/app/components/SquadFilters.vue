<script setup lang="ts">
/** Filter bar for a squad list. Pairs with `useSquadFilters`. */
import { SQUAD_SORT_OPTIONS } from '~/composables/useSquadFilters'
import type { SlotFilter, SquadSort } from '~/composables/useSquadFilters'

defineProps<{
  tabs: { id: SlotFilter; label: string; count: number }[]
  resultCount: number
  isFiltered: boolean
  /** Hide the fitness toggles where they make no sense. */
  showAvailability?: boolean
}>()

const slot = defineModel<SlotFilter>('slot', { required: true })
const search = defineModel<string>('search', { required: true })
const availableOnly = defineModel<boolean>('availableOnly', { required: true })
const freshOnly = defineModel<boolean>('freshOnly', { required: true })
const sort = defineModel<SquadSort>('sort', { required: true })

defineEmits<{ reset: [] }>()
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <!-- Position tabs -->
    <div class="flex gap-1">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        class="app-filter-chip inline-flex items-center gap-1 px-2.5 py-1"
        :class="slot === tab.id && 'app-filter-chip--active'"
        :aria-pressed="slot === tab.id"
        @click="slot = tab.id"
      >
        {{ tab.label }}
        <span class="tabular-nums opacity-70">{{ tab.count }}</span>
      </button>
    </div>

    <UInput
      v-model="search"
      placeholder="Search squad…"
      icon="i-lucide-search"
      size="sm"
      class="w-full sm:w-48"
    />

    <template v-if="showAvailability">
      <button
        type="button"
        class="app-filter-chip px-2.5 py-1"
        :class="availableOnly && 'app-filter-chip--active'"
        :aria-pressed="availableOnly"
        title="Hide injured players"
        @click="availableOnly = !availableOnly"
      >
        Available
      </button>
      <button
        type="button"
        class="app-filter-chip px-2.5 py-1"
        :class="freshOnly && 'app-filter-chip--active'"
        :aria-pressed="freshOnly"
        title="Only players above 65% stamina"
        @click="freshOnly = !freshOnly"
      >
        Fresh
      </button>
    </template>

    <USelectMenu
      v-model="sort"
      :items="SQUAD_SORT_OPTIONS"
      value-key="value"
      size="sm"
      class="w-32"
    />

    <span class="app-muted-text ml-auto text-xs tabular-nums">{{ resultCount }} shown</span>

    <UButton
      v-if="isFiltered"
      label="Clear"
      icon="i-lucide-x"
      size="xs"
      color="neutral"
      variant="ghost"
      @click="$emit('reset')"
    />
  </div>
</template>
