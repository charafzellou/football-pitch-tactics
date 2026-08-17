<script setup lang="ts">
/** Last-five results as W/D/L pills, oldest to newest. */
import { RESULT_COLOR, RESULT_LABEL, type FormResult } from '~/utils/results'

withDefaults(defineProps<{
  form: FormResult[]
  size?: 'xs' | 'sm'
  emptyLabel?: string
}>(), {
  size: 'sm',
  emptyLabel: 'No matches played',
})
</script>

<template>
  <div v-if="form.length" class="flex items-center gap-1" :aria-label="`Recent form: ${form.join(', ')}`">
    <span
      v-for="(result, i) in form"
      :key="i"
      class="flex items-center justify-center rounded font-bold uppercase"
      :class="size === 'xs' ? 'size-4 text-[9px]' : 'size-5 text-[10px]'"
      :style="{
        color: RESULT_COLOR[result],
        backgroundColor: `color-mix(in srgb, ${RESULT_COLOR[result]} 18%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${RESULT_COLOR[result]} 34%, transparent)`,
      }"
      :title="RESULT_LABEL[result]"
    >{{ result }}</span>
  </div>
  <span v-else class="app-muted-text text-xs">{{ emptyLabel }}</span>
</template>
