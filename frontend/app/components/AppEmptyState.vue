<script setup lang="ts">
withDefaults(defineProps<{
  icon?: string
  title: string
  description?: string
  actionLabel?: string
  actionIcon?: string
  compact?: boolean
}>(), {
  icon: 'i-lucide-inbox',
  compact: false,
})

defineEmits<{ action: [] }>()
</script>

<template>
  <div
    class="flex flex-col items-center justify-center text-center animate-fade-in-up"
    :class="compact ? 'gap-2 py-8' : 'gap-3 py-14'"
  >
    <div
      class="flex items-center justify-center rounded-full"
      :class="compact ? 'size-11' : 'size-16'"
      style="background-color: var(--app-surface-muted)"
    >
      <UIcon :name="icon" :class="compact ? 'size-5' : 'size-7'" style="color: var(--app-text-muted)" />
    </div>

    <p class="font-semibold" :class="compact ? 'text-sm' : 'text-base'" style="color: var(--app-text)">
      {{ title }}
    </p>

    <p v-if="description" class="app-muted-text max-w-sm text-sm">
      {{ description }}
    </p>

    <UButton
      v-if="actionLabel"
      :label="actionLabel"
      :icon="actionIcon"
      color="neutral"
      variant="soft"
      class="mt-1"
      @click="$emit('action')"
    />
  </div>
</template>
