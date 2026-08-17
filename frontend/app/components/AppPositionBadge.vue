<script setup lang="ts">
/**
 * Position badge.
 *
 * Replaces four separate `positionColors` maps that had drifted apart — the
 * Transfers page keyed its map on the raw `GK/DEF/MID/ATT` values while every
 * other page keyed on the normalised `GK/DF/MF/FW`, so transfer badges fell
 * through to neutral grey. Everything now goes through `normalizePosition()`.
 *
 * Colours come from `--app-pos-*`, which the theme engine owns, so they are
 * editable in Settings.
 */
import { computed } from 'vue'
import { normalizePosition } from '#shared/lineup'

const props = withDefaults(defineProps<{
  position: string | null | undefined
  size?: 'xs' | 'sm' | 'md'
  muted?: boolean
}>(), {
  size: 'sm',
  muted: false,
})

const slot = computed(() => normalizePosition(props.position ?? ''))

const label = computed(() =>
  slot.value ?? (String(props.position ?? '').toUpperCase().trim() || '—'),
)

const slotClass = computed(() => (slot.value ? `app-pos-${slot.value.toLowerCase()}` : ''))

const sizeClass = computed(() => ({
  xs: 'text-[9px] min-w-7 px-1',
  sm: 'text-[10px] min-w-8 px-1.5',
  md: 'text-xs min-w-9 px-2 py-1',
}[props.size]))
</script>

<template>
  <span
    class="app-pos-badge"
    :class="[slotClass, sizeClass, muted && 'opacity-60']"
  >{{ label }}</span>
</template>
