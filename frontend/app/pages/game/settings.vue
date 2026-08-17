<script setup lang="ts">
/**
 * Settings — theme, colours, motion, audio and gameplay defaults.
 *
 * The colour editor writes straight through to the live document: every
 * control here sets a CSS custom property on <html>, which Nuxt UI and every
 * `--app-*` token derive from. There is no preview mode because the whole
 * interface *is* the preview.
 */
import { computed, ref } from 'vue'
import { EDITABLE_SEEDS, THEME_LIST, generateRamp, SHADES } from '~/utils/themes'
import type { SeedKey, ThemeId } from '~/utils/themes'
import { useSettingsStore } from '~/stores/settings'
import type { MotionLevel, SfxCategory } from '~/stores/settings'

const settings = useSettingsStore()
const toast = useAppToast()
const sfx = useSfx()

const importOpen = ref(false)
const importText = ref('')
const resetOpen = ref(false)

/** A few sensible starting points per seed, so nobody has to invent a hex. */
const PRESETS: Partial<Record<SeedKey, string[]>> = {
  brand: ['#00c16a', '#f59e0b', '#38bdf8', '#a855f7', '#ef4444'],
  shell: ['#3d5f92', '#64748b', '#4c6b52', '#6b5b95', '#7c6f64'],
  pitch: ['#0f8f63', '#1a9c3f', '#0d6048', '#166534'],
  gold: ['#d4af37', '#ffd700', '#f59e0b', '#cd7f32'],
  gk: ['#38bdf8', '#22d3ee', '#818cf8'],
  df: ['#34d399', '#4ade80', '#2dd4bf'],
  mf: ['#fbbf24', '#facc15', '#fb923c'],
  fw: ['#fb7185', '#f97316', '#ef4444'],
}

/** Foreground colours worth contrast-checking against the page background. */
const CONTRAST_SEEDS: SeedKey[] = ['brand', 'gold', 'gk', 'df', 'mf', 'fw']

const shellBackground = computed(() => {
  // The darkest shell shade is what body text and accents actually sit on.
  const ramp = generateRamp(settings.effectiveSeeds.shell)
  return ramp[950]
})

const accentRamp = computed(() => generateRamp(settings.effectiveSeeds.brand))
const shellRamp = computed(() => generateRamp(settings.effectiveSeeds.shell))

function selectTheme(id: ThemeId) {
  settings.setTheme(id)
  sfx.play('click')
}

function onSeedChange(key: SeedKey, value: string) {
  settings.setSeed(key, value)
}

function resetSeed(key: SeedKey) {
  settings.resetSeed(key)
  sfx.play('deselect')
}

function resetColors() {
  settings.resetAllSeeds()
  toast.success({ title: 'Colours reset', description: `Back to the ${settings.theme.label} defaults.` })
}

function confirmResetAll() {
  settings.resetToDefaults()
  resetOpen.value = false
  toast.success({ title: 'Settings reset', description: 'Everything is back to its default.' })
}

async function copyTheme() {
  try {
    await navigator.clipboard.writeText(settings.exportTheme())
    toast.success({ title: 'Theme copied', description: 'The palette JSON is on your clipboard.' })
  }
  catch {
    toast.error({ title: 'Could not copy', description: 'Your browser blocked clipboard access.' })
  }
}

function applyImport() {
  const result = settings.importTheme(importText.value)
  if (!result.ok) {
    toast.error({ title: 'Could not import theme', description: result.error })
    return
  }

  importOpen.value = false
  importText.value = ''
  toast.success({ title: 'Theme imported' })
}

const MOTION_OPTIONS: { value: MotionLevel; label: string; hint: string }[] = [
  { value: 'full', label: 'Full', hint: 'Every animation and transition.' },
  { value: 'reduced', label: 'Reduced', hint: 'Instant changes, transitions kept short.' },
  { value: 'off', label: 'Off', hint: 'No animation at all.' },
]

const SFX_CATEGORIES: { key: SfxCategory; label: string; hint: string; test: 'click' | 'goal' | 'whistle' }[] = [
  { key: 'ui', label: 'Interface', hint: 'Selection, confirmation and error cues.', test: 'click' },
  { key: 'crowd', label: 'Crowd', hint: 'Goal reactions during a match.', test: 'goal' },
  { key: 'whistle', label: 'Referee', hint: 'Kick-off, half time and full time.', test: 'whistle' },
]
</script>

<template>
  <div class="space-y-4 sm:space-y-5">
    <div class="flex flex-wrap items-center gap-3">
      <UIcon name="i-lucide-settings" class="size-6" style="color: var(--app-accent)" />
      <h1 class="app-page-title">Settings</h1>
      <UButton
        label="Reset everything"
        icon="i-lucide-rotate-ccw"
        color="neutral"
        variant="ghost"
        size="sm"
        class="ml-auto"
        @click="() => { resetOpen = true }"
      />
    </div>

    <ClientOnly>
      <div class="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div class="space-y-4">
          <!-- Theme picker -->
          <UCard class="app-surface">
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-palette" class="size-4" style="color: var(--app-accent)" />
                Theme
              </div>
            </template>

            <div class="grid gap-3 sm:grid-cols-3">
              <button
                v-for="theme in THEME_LIST"
                :key="theme.id"
                type="button"
                class="rounded-2xl border p-3 text-left transition hover:-translate-y-0.5"
                :style="settings.themeId === theme.id
                  ? { borderColor: 'var(--app-accent)', backgroundColor: 'var(--app-accent-soft)' }
                  : { borderColor: 'var(--app-surface-border)', backgroundColor: 'var(--app-surface-muted)' }"
                :aria-pressed="settings.themeId === theme.id"
                @click="selectTheme(theme.id)"
              >
                <!-- Miniature of the theme, drawn from its own seeds -->
                <div
                  class="mb-2.5 flex h-16 items-end gap-1 overflow-hidden rounded-lg p-2"
                  :style="{
                    backgroundImage: `linear-gradient(140deg, ${generateRamp(theme.seeds.shell)[950]}, ${theme.seeds.pitch})`,
                    borderRadius: theme.chrome['--ui-radius'],
                  }"
                >
                  <span
                    class="h-5 w-9"
                    :style="{ backgroundColor: theme.seeds.brand, borderRadius: theme.chrome['--ui-radius'] }"
                  />
                  <span
                    class="h-3.5 w-5"
                    :style="{ backgroundColor: theme.seeds.gold, borderRadius: theme.chrome['--ui-radius'] }"
                  />
                  <span
                    class="h-2.5 w-4"
                    :style="{ backgroundColor: theme.seeds.gk, borderRadius: theme.chrome['--ui-radius'] }"
                  />
                </div>

                <p
                  class="text-sm font-bold"
                  :style="{ color: settings.themeId === theme.id ? 'var(--app-accent)' : 'var(--app-text)' }"
                >{{ theme.label }}</p>
                <p class="app-muted-text mt-0.5 text-[11px] leading-snug">{{ theme.description }}</p>
              </button>
            </div>
          </UCard>

          <!-- Colours -->
          <UCard class="app-surface">
            <template #header>
              <div class="flex flex-wrap items-center gap-2">
                <UIcon name="i-lucide-droplet" class="size-4" style="color: var(--app-accent)" />
                Colours
                <span v-if="settings.hasCustomColors" class="app-chip app-chip--success">
                  {{ settings.customisedSeeds.length }} edited
                </span>
                <div class="ml-auto flex gap-1">
                  <UButton
                    v-if="settings.hasCustomColors"
                    label="Reset colours"
                    icon="i-lucide-rotate-ccw"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    @click="resetColors"
                  />
                  <UButton label="Copy" icon="i-lucide-copy" size="xs" color="neutral" variant="ghost" @click="copyTheme" />
                  <UButton label="Import" icon="i-lucide-clipboard-paste" size="xs" color="neutral" variant="ghost" @click="() => { importOpen = true }" />
                </div>
              </div>
            </template>

            <div class="space-y-2.5">
              <ThemeSwatchEditor
                v-for="seed in EDITABLE_SEEDS"
                :key="seed.key"
                :label="seed.label"
                :hint="seed.hint"
                :model-value="settings.effectiveSeeds[seed.key]"
                :against="shellBackground"
                :check-contrast="CONTRAST_SEEDS.includes(seed.key)"
                :is-customised="settings.customisedSeeds.includes(seed.key)"
                :presets="PRESETS[seed.key]"
                @update:model-value="value => onSeedChange(seed.key, value)"
                @reset="resetSeed(seed.key)"
              />
            </div>
          </UCard>
        </div>

        <div class="space-y-4">
          <!-- Generated ramps -->
          <UCard class="app-surface">
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-layers" class="size-4" style="color: var(--app-accent)" />
                Generated palette
              </div>
            </template>

            <div class="space-y-3">
              <div v-for="ramp in [{ label: 'Accent', value: accentRamp }, { label: 'Shell', value: shellRamp }]" :key="ramp.label">
                <p class="app-kicker mb-1.5 text-[10px]">{{ ramp.label }}</p>
                <div class="flex overflow-hidden rounded-lg">
                  <span
                    v-for="shade in SHADES"
                    :key="shade"
                    class="h-7 flex-1"
                    :style="{ backgroundColor: ramp.value[shade] }"
                    :title="`${shade}: ${ramp.value[shade]}`"
                  />
                </div>
              </div>

              <p class="app-muted-text text-[11px]">
                Each accent generates a full 50–950 scale. Every button, badge and border in the app is drawn from it.
              </p>

              <!-- Live component preview -->
              <div class="app-surface-subtle space-y-2.5 p-3">
                <p class="app-kicker text-[10px]">Preview</p>
                <div class="flex flex-wrap items-center gap-2">
                  <UButton label="Primary" size="sm" />
                  <UButton label="Soft" color="primary" variant="soft" size="sm" />
                  <UButton label="Neutral" color="neutral" variant="soft" size="sm" />
                  <span class="app-chip app-chip--success">Success</span>
                  <span class="app-chip app-chip--warning">Warning</span>
                  <span class="app-chip app-chip--gold">Gold</span>
                </div>
                <div class="flex gap-1.5">
                  <AppPositionBadge position="GK" />
                  <AppPositionBadge position="DF" />
                  <AppPositionBadge position="MF" />
                  <AppPositionBadge position="FW" />
                </div>
                <AppStatBar :value="72" show-value percent />
              </div>
            </div>
          </UCard>

          <!-- Motion -->
          <UCard class="app-surface">
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-wand-sparkles" class="size-4" style="color: var(--app-accent)" />
                Motion
              </div>
            </template>

            <div class="space-y-2">
              <button
                v-for="option in MOTION_OPTIONS"
                :key="option.value"
                type="button"
                class="flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition"
                :style="settings.motion === option.value
                  ? { borderColor: 'var(--app-accent)', backgroundColor: 'var(--app-accent-soft)' }
                  : { borderColor: 'var(--app-surface-border)', backgroundColor: 'var(--app-surface-muted)' }"
                :aria-pressed="settings.motion === option.value"
                @click="settings.motion = option.value"
              >
                <UIcon
                  :name="settings.motion === option.value ? 'i-lucide-circle-check' : 'i-lucide-circle'"
                  class="size-4 shrink-0"
                  :style="{ color: settings.motion === option.value ? 'var(--app-accent)' : 'var(--app-text-muted)' }"
                />
                <span class="min-w-0 flex-1">
                  <span class="block text-sm font-semibold" style="color: var(--app-text)">{{ option.label }}</span>
                  <span class="app-muted-text block text-[11px]">{{ option.hint }}</span>
                </span>
              </button>
              <p class="app-muted-text text-[11px]">
                Your system's "reduce motion" preference is always respected on top of this.
              </p>
            </div>
          </UCard>

          <!-- Audio -->
          <UCard class="app-surface">
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon :name="settings.muted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'" class="size-4" style="color: var(--app-accent)" />
                Sound
              </div>
            </template>

            <div class="space-y-3">
              <div class="flex items-center justify-between gap-3">
                <span class="text-sm font-semibold" style="color: var(--app-text)">Mute everything</span>
                <USwitch v-model="settings.muted" />
              </div>

              <div :class="settings.muted && 'pointer-events-none opacity-50'">
                <label class="app-kicker mb-2 block text-[10px]">Volume · {{ Math.round(settings.volume * 100) }}%</label>
                <USlider v-model="settings.volume" :min="0" :max="1" :step="0.05" />
              </div>

              <div class="space-y-2" :class="settings.muted && 'pointer-events-none opacity-50'">
                <div
                  v-for="category in SFX_CATEGORIES"
                  :key="category.key"
                  class="flex items-center gap-3 rounded-xl p-2.5"
                  style="background-color: var(--app-surface-muted)"
                >
                  <span class="min-w-0 flex-1">
                    <span class="block text-sm font-semibold" style="color: var(--app-text)">{{ category.label }}</span>
                    <span class="app-muted-text block text-[11px]">{{ category.hint }}</span>
                  </span>
                  <UButton
                    icon="i-lucide-play"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    :aria-label="`Test ${category.label} sound`"
                    @click="sfx.preview(category.test)"
                  />
                  <USwitch v-model="settings.sfxCategories[category.key]" />
                </div>
              </div>

              <p class="app-muted-text text-[11px]">
                Sounds are generated in the browser — nothing is downloaded.
              </p>
            </div>
          </UCard>

          <!-- Gameplay -->
          <UCard class="app-surface">
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-gamepad-2" class="size-4" style="color: var(--app-accent)" />
                Gameplay
              </div>
            </template>

            <div class="space-y-3">
              <div>
                <label class="app-kicker mb-2 block text-[10px]">Default match speed</label>
                <div class="flex gap-1.5">
                  <button
                    v-for="option in [1, 2, 4]"
                    :key="option"
                    type="button"
                    class="app-filter-chip px-3 py-1 tabular-nums"
                    :class="settings.playbackSpeed === option && 'app-filter-chip--active'"
                    :aria-pressed="settings.playbackSpeed === option"
                    @click="settings.playbackSpeed = option"
                  >{{ option }}×</button>
                </div>
              </div>

              <div class="flex items-center justify-between gap-3">
                <span class="min-w-0">
                  <span class="block text-sm font-semibold" style="color: var(--app-text)">Confirm before selling</span>
                  <span class="app-muted-text block text-[11px]">Transfers out are permanent.</span>
                </span>
                <USwitch v-model="settings.confirmSelling" />
              </div>

              <div class="flex items-center justify-between gap-3">
                <span class="min-w-0">
                  <span class="block text-sm font-semibold" style="color: var(--app-text)">Chatty notifications</span>
                  <span class="app-muted-text block text-[11px]">Show a toast for minor actions too.</span>
                </span>
                <USwitch v-model="settings.verboseToasts" />
              </div>
            </div>
          </UCard>
        </div>
      </div>

      <template #fallback>
        <AppSkeleton variant="card" />
      </template>
    </ClientOnly>

    <!-- Import -->
    <UModal
      :open="importOpen"
      title="Import a theme"
      description="Paste palette JSON exported from this page"
      :ui="{ content: 'sm:max-w-lg' }"
      @update:open="value => importOpen = value"
    >
      <template #content>
        <div class="app-surface animate-scale-in p-5 sm:p-6">
          <h2 class="mb-1 text-lg font-bold" style="color: var(--app-text)">Import a theme</h2>
          <p class="app-muted-text mb-4 text-sm">Paste palette JSON exported from this page.</p>

          <UTextarea
            v-model="importText"
            :rows="8"
            placeholder='{ "themeId": "premium", "seeds": { "brand": "#00c16a" } }'
            class="w-full font-mono text-xs"
          />

          <div class="mt-4 flex justify-end gap-2">
            <UButton label="Cancel" color="neutral" variant="soft" @click="() => { importOpen = false }" />
            <UButton label="Import" icon="i-lucide-check" :disabled="!importText.trim()" @click="applyImport" />
          </div>
        </div>
      </template>
    </UModal>

    <AppConfirmModal
      :open="resetOpen"
      tone="warning"
      icon="i-lucide-rotate-ccw"
      title="Reset all settings?"
      description="Theme, colours, motion, sound and gameplay preferences return to their defaults."
      confirm-label="Reset settings"
      confirm-icon="i-lucide-rotate-ccw"
      @confirm="confirmResetAll"
      @cancel="resetOpen = false"
    >
      <template #consequences>
        <p style="color: var(--app-text-soft)">
          This only affects preferences stored in this browser. Your save, squad and league position are untouched.
        </p>
      </template>
    </AppConfirmModal>
  </div>
</template>
