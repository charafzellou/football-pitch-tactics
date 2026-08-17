<script setup lang="ts">
/**
 * One editable colour: a native picker, a hex field, presets, and a live
 * contrast readout against the page background.
 *
 * The contrast gate is not decorative — a runtime-editable accent can very
 * easily be made unreadable, and the ratio is the only honest signal for that.
 */
import { computed, ref, watch } from 'vue'
import { contrastGrade, contrastRatio, isValidHex } from '~/utils/themes'

const props = defineProps<{
  label: string
  hint: string
  modelValue: string
  /** Colour the swatch will sit against, for the contrast check. */
  against: string
  /** Contrast only matters for colours used as foreground. */
  checkContrast?: boolean
  isCustomised: boolean
  presets?: string[]
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string]; reset: [] }>()

const draft = ref(props.modelValue)
watch(() => props.modelValue, (next) => { draft.value = next })

const isValid = computed(() => isValidHex(draft.value))

const ratio = computed(() =>
  props.checkContrast ? contrastRatio(props.modelValue, props.against) : null,
)
const grade = computed(() => (ratio.value !== null ? contrastGrade(ratio.value) : null))

const gradeColor = computed(() => ({
  success: 'var(--app-accent)',
  warning: 'var(--app-player-booked)',
  error: 'var(--app-player-sent-off)',
}[grade.value?.tone ?? 'success']))

function commit(value: string) {
  if (!isValidHex(value)) return
  emit('update:modelValue', value)
}

function onHexInput(value: string) {
  draft.value = value
  const normalized = value.startsWith('#') ? value : `#${value}`
  if (isValidHex(normalized)) commit(normalized)
}
</script>

<template>
  <div class="app-surface-subtle p-3.5">
    <div class="flex items-center gap-3">
      <!-- Native picker, styled down to a swatch -->
      <label class="relative shrink-0 cursor-pointer" :title="`Pick ${label} colour`">
        <span
          class="block size-11 rounded-xl border-2 transition-transform hover:scale-105"
          :style="{ backgroundColor: modelValue, borderColor: 'var(--app-surface-border-strong)' }"
        />
        <input
          type="color"
          class="absolute inset-0 size-full cursor-pointer opacity-0"
          :value="modelValue"
          :aria-label="`${label} colour`"
          @input="commit(($event.target as HTMLInputElement).value)"
        >
      </label>

      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <p class="text-sm font-bold" style="color: var(--app-text)">{{ label }}</p>
          <span v-if="isCustomised" class="app-chip app-chip--success px-1.5 py-0 text-[9px]">Edited</span>
        </div>
        <p class="app-muted-text text-[11px]">{{ hint }}</p>
      </div>

      <UButton
        v-if="isCustomised"
        icon="i-lucide-rotate-ccw"
        size="xs"
        color="neutral"
        variant="ghost"
        :aria-label="`Reset ${label}`"
        title="Reset to theme default"
        @click="emit('reset')"
      />
    </div>

    <div class="mt-3 flex flex-wrap items-center gap-2">
      <UInput
        :model-value="draft"
        size="xs"
        class="w-28 font-mono"
        :aria-label="`${label} hex value`"
        :color="isValid ? 'primary' : 'error'"
        @update:model-value="onHexInput"
      />

      <div v-if="presets?.length" class="flex gap-1">
        <button
          v-for="preset in presets"
          :key="preset"
          type="button"
          class="size-6 rounded-md border transition-transform hover:scale-110"
          :style="{
            backgroundColor: preset,
            borderColor: preset.toLowerCase() === modelValue.toLowerCase()
              ? 'var(--app-text)'
              : 'var(--app-surface-border)',
          }"
          :aria-label="`Use ${preset}`"
          :title="preset"
          @click="commit(preset)"
        />
      </div>

      <span
        v-if="grade && ratio !== null"
        class="app-chip ml-auto"
        :style="{ color: gradeColor, borderColor: `color-mix(in srgb, ${gradeColor} 34%, transparent)` }"
        :title="`Contrast ratio ${ratio}:1 against the page background`"
      >
        {{ ratio }}:1 · {{ grade.label }}
      </span>
    </div>
  </div>
</template>
