<script setup lang="ts">
/**
 * The single confirmation surface for anything irreversible.
 *
 * Before this, selling a player — permanent, and the largest financial
 * decision in the game — happened on one unguarded click, while buying used a
 * native `confirm()` box. Both now come through here, along with starting a
 * new save over an existing one.
 *
 * `consequences` is the important slot: it states what will actually change
 * (balance before/after, squad depth) rather than just asking "are you sure?".
 */
import { computed, ref, watch } from 'vue'
import { useSfx } from '~/composables/useSfx'

const props = withDefaults(defineProps<{
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  confirmIcon?: string
  /** `danger` for destructive actions, `primary` for ordinary ones. */
  tone?: 'danger' | 'primary' | 'warning'
  icon?: string
  loading?: boolean
  /** Require the exact phrase to be typed. Reserved for save-destroying actions. */
  requirePhrase?: string
}>(), {
  confirmLabel: 'Confirm',
  cancelLabel: 'Cancel',
  tone: 'primary',
  loading: false,
})

const emit = defineEmits<{ confirm: []; cancel: [] }>()

const sfx = useSfx()
const typed = ref('')

watch(() => props.open, (isOpen) => {
  if (isOpen) typed.value = ''
})

const toneIcon = computed(() => props.icon ?? ({
  danger: 'i-lucide-triangle-alert',
  warning: 'i-lucide-alert-circle',
  primary: 'i-lucide-help-circle',
}[props.tone]))

const toneColor = computed(() => ({
  danger: 'error',
  warning: 'warning',
  primary: 'primary',
}[props.tone] as 'error' | 'warning' | 'primary'))

const toneAccent = computed(() => ({
  danger: 'var(--app-player-sent-off)',
  warning: 'var(--app-player-booked)',
  primary: 'var(--app-accent)',
}[props.tone]))

const phraseSatisfied = computed(() =>
  !props.requirePhrase || typed.value.trim().toLowerCase() === props.requirePhrase.trim().toLowerCase(),
)

function confirm() {
  if (!phraseSatisfied.value) return
  sfx.play('click')
  emit('confirm')
}

function cancel() {
  sfx.play('deselect')
  emit('cancel')
}
</script>

<template>
  <!--
    `title`/`description` are passed even though the #content slot draws its own
    header: Nuxt UI wraps them in a VisuallyHidden DialogTitle/DialogDescription,
    without which Reka's dialog is unlabelled for screen readers.
  -->
  <UModal
    :open="open"
    :title="title"
    :description="description"
    :dismissible="!loading"
    :ui="{ content: 'sm:max-w-lg' }"
    @update:open="value => !value && cancel()"
  >
    <template #content>
      <div class="app-surface animate-scale-in overflow-hidden">
        <div class="flex items-start gap-4 p-5 sm:p-6">
          <div
            class="flex size-11 shrink-0 items-center justify-center rounded-2xl"
            :style="{
              backgroundColor: `color-mix(in srgb, ${toneAccent} 16%, transparent)`,
              color: toneAccent,
            }"
          >
            <UIcon :name="toneIcon" class="size-5" />
          </div>

          <div class="min-w-0 flex-1 space-y-2">
            <h2 class="text-lg font-bold leading-tight" style="color: var(--app-text)">
              {{ title }}
            </h2>
            <p v-if="description" class="app-muted-text text-sm">
              {{ description }}
            </p>
          </div>
        </div>

        <!-- What will actually change. -->
        <div v-if="$slots.consequences" class="px-5 pb-4 sm:px-6">
          <div
            class="rounded-2xl border p-4 text-sm"
            :style="{
              backgroundColor: 'var(--app-surface-muted)',
              borderColor: `color-mix(in srgb, ${toneAccent} 22%, transparent)`,
            }"
          >
            <slot name="consequences" />
          </div>
        </div>

        <div v-if="requirePhrase" class="px-5 pb-4 sm:px-6">
          <label class="app-kicker mb-2 block text-[10px]">
            Type <span class="font-mono normal-case" style="color: var(--app-text)">{{ requirePhrase }}</span> to confirm
          </label>
          <UInput v-model="typed" :placeholder="requirePhrase" autocomplete="off" class="w-full" />
        </div>

        <div
          class="flex flex-col-reverse gap-2 border-t p-5 sm:flex-row sm:justify-end sm:px-6"
          style="border-color: var(--app-surface-border)"
        >
          <UButton
            :label="cancelLabel"
            color="neutral"
            variant="soft"
            :disabled="loading"
            @click="cancel"
          />
          <UButton
            :label="confirmLabel"
            :icon="confirmIcon"
            :color="toneColor"
            :loading="loading"
            :disabled="!phraseSatisfied"
            @click="confirm"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
