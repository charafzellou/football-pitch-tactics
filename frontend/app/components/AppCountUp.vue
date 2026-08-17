<script setup lang="ts">
/**
 * A number that rolls to its new value instead of snapping.
 *
 * The tween is driven by requestAnimationFrame, which does not run while the
 * document is hidden. Without a guard a page loaded in a background tab shows
 * the *start* of the animation forever — a bank balance stuck at €0. The
 * displayed value therefore falls back to the exact number whenever the tween
 * cannot be trusted to be running: document hidden, or motion turned off.
 */
import { computed, ref, watch } from 'vue'
import { useDocumentVisibility, useTransition, TransitionPresets } from '@vueuse/core'
import { useSettingsStore } from '~/stores/settings'

const props = withDefaults(defineProps<{
  value: number
  duration?: number
  /** Formatter for the displayed value — money, percentages, plain integers. */
  format?: (value: number) => string
}>(), {
  duration: 700,
})

const settings = useSettingsStore()
const visibility = useDocumentVisibility()

const source = ref(props.value)
watch(() => props.value, (next) => { source.value = next })

const animated = useTransition(source, {
  duration: props.duration,
  transition: TransitionPresets.easeOutCubic,
})

const useExactValue = computed(() =>
  visibility.value !== 'visible' || settings.motion === 'off',
)

const display = computed(() => {
  const raw = useExactValue.value ? props.value : animated.value
  return props.format ? props.format(raw) : String(Math.round(raw))
})
</script>

<template>
  <span class="tabular-nums">{{ display }}</span>
</template>
