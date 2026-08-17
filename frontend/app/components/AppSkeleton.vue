<script setup lang="ts">
/**
 * Shimmer placeholders. Finally puts `--animate-shimmer` to work — it was
 * declared in `main.css` and marked "reserved" but never used anywhere.
 */
withDefaults(defineProps<{
  variant?: 'text' | 'card' | 'table' | 'list' | 'pitch'
  rows?: number
}>(), {
  variant: 'text',
  rows: 5,
})
</script>

<template>
  <div class="w-full" role="status" aria-busy="true" aria-live="polite">
    <span class="sr-only">Loading…</span>

    <template v-if="variant === 'text'">
      <div class="space-y-2">
        <div v-for="i in rows" :key="i" class="app-skeleton h-3.5" :style="{ width: `${100 - i * 8}%` }" />
      </div>
    </template>

    <template v-else-if="variant === 'card'">
      <div class="app-surface space-y-4 p-5">
        <div class="app-skeleton h-4 w-1/3" />
        <div class="app-skeleton h-9 w-2/3" />
        <div class="app-skeleton h-3 w-full" />
        <div class="app-skeleton h-3 w-4/5" />
      </div>
    </template>

    <template v-else-if="variant === 'table'">
      <div class="app-table-shell space-y-3 p-4">
        <div class="app-skeleton h-4 w-1/4" />
        <div v-for="i in rows" :key="i" class="flex items-center gap-4">
          <div class="app-skeleton h-8 w-8 rounded-full" />
          <div class="app-skeleton h-3.5 flex-1" />
          <div class="app-skeleton h-3.5 w-16" />
          <div class="app-skeleton h-3.5 w-24" />
          <div class="app-skeleton h-7 w-16 rounded-lg" />
        </div>
      </div>
    </template>

    <template v-else-if="variant === 'list'">
      <div class="space-y-3">
        <div v-for="i in rows" :key="i" class="app-surface-subtle flex items-center gap-3 p-4">
          <div class="app-skeleton size-10 rounded-full" />
          <div class="flex-1 space-y-2">
            <div class="app-skeleton h-3.5 w-1/3" />
            <div class="app-skeleton h-3 w-1/2" />
          </div>
          <div class="app-skeleton h-8 w-20 rounded-lg" />
        </div>
      </div>
    </template>

    <template v-else>
      <div class="app-pitch-board flex min-h-120 flex-col justify-between gap-6">
        <div v-for="row in 4" :key="row" class="flex justify-center gap-3">
          <div v-for="col in (row === 1 ? 3 : row === 4 ? 1 : 4)" :key="col" class="app-skeleton h-31 w-35 rounded-[1.35rem]" />
        </div>
      </div>
    </template>
  </div>
</template>
