/**
 * Player preferences: theme, motion, audio and a few gameplay defaults.
 *
 * Persisted to localStorage under a versioned key. The shape written here is
 * exactly what `buildPrePaintScript()` reads back in `<head>` before first
 * paint, so the two must stay in step — see `utils/themes.ts`.
 */
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import {
  DEFAULT_THEME_ID,
  SETTINGS_STORAGE_KEY,
  THEMES,
  applyTokens,
  isValidHex,
  resolveThemeTokens,
} from '~/utils/themes'
import type { SeedKey, Seeds, ThemeId } from '~/utils/themes'

export type MotionLevel = 'full' | 'reduced' | 'off'
export type SfxCategory = 'ui' | 'crowd' | 'whistle'

interface PersistedSettings {
  themeId: ThemeId
  seeds: Partial<Seeds>
  motion: MotionLevel
  muted: boolean
  volume: number
  sfxCategories: Record<SfxCategory, boolean>
  playbackSpeed: number
  confirmSelling: boolean
  verboseToasts: boolean
}

function defaults(): PersistedSettings {
  return {
    themeId: DEFAULT_THEME_ID,
    seeds: {},
    motion: 'full',
    muted: false,
    volume: 0.6,
    sfxCategories: { ui: true, crowd: true, whistle: true },
    playbackSpeed: 1,
    confirmSelling: true,
    verboseToasts: false,
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const themeId = ref<ThemeId>(DEFAULT_THEME_ID)
  const seeds = ref<Partial<Seeds>>({})
  const motion = ref<MotionLevel>('full')
  const muted = ref(false)
  const volume = ref(0.6)
  const sfxCategories = ref<Record<SfxCategory, boolean>>({ ui: true, crowd: true, whistle: true })
  const playbackSpeed = ref(1)
  const confirmSelling = ref(true)
  const verboseToasts = ref(false)

  /**
   * False until the client has read localStorage. Anything that renders a
   * stored value must wait for this, otherwise the server HTML (always
   * defaults) and the client's first render disagree and Vue warns about a
   * hydration mismatch.
   */
  const hydrated = ref(false)

  const theme = computed(() => THEMES[themeId.value] ?? THEMES[DEFAULT_THEME_ID])

  /** The theme's own seeds with any player edits folded in. */
  const effectiveSeeds = computed<Seeds>(() => ({ ...theme.value.seeds, ...seeds.value }))

  /** Which seeds the player has actually changed from the theme's defaults. */
  const customisedSeeds = computed<SeedKey[]>(() =>
    (Object.keys(seeds.value) as SeedKey[]).filter(key => seeds.value[key] !== theme.value.seeds[key]),
  )

  const hasCustomColors = computed(() => customisedSeeds.value.length > 0)

  function snapshot(): PersistedSettings {
    return {
      themeId: themeId.value,
      seeds: { ...seeds.value },
      motion: motion.value,
      muted: muted.value,
      volume: volume.value,
      sfxCategories: { ...sfxCategories.value },
      playbackSpeed: playbackSpeed.value,
      confirmSelling: confirmSelling.value,
      verboseToasts: verboseToasts.value,
    }
  }

  function load() {
    if (!import.meta.client) return

    const base = defaults()
    let stored: Partial<PersistedSettings> = {}
    try {
      stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}') ?? {}
    }
    catch {
      // A corrupted blob should not brick the app — fall back to defaults and
      // let the next write overwrite it.
      stored = {}
    }

    themeId.value = stored.themeId && stored.themeId in THEMES ? stored.themeId : base.themeId
    seeds.value = sanitiseSeeds(stored.seeds)
    motion.value = (['full', 'reduced', 'off'] as const).includes(stored.motion as MotionLevel)
      ? stored.motion as MotionLevel
      : base.motion
    muted.value = typeof stored.muted === 'boolean' ? stored.muted : base.muted
    volume.value = clamp(stored.volume ?? base.volume, 0, 1)
    sfxCategories.value = { ...base.sfxCategories, ...(stored.sfxCategories ?? {}) }
    playbackSpeed.value = [1, 2, 4].includes(stored.playbackSpeed as number) ? stored.playbackSpeed! : base.playbackSpeed
    confirmSelling.value = typeof stored.confirmSelling === 'boolean' ? stored.confirmSelling : base.confirmSelling
    verboseToasts.value = typeof stored.verboseToasts === 'boolean' ? stored.verboseToasts : base.verboseToasts

    hydrated.value = true
  }

  function persist() {
    if (!import.meta.client) return
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(snapshot()))
    }
    catch {
      // Private browsing or a full quota. Preferences just won't survive the
      // session; nothing else should break.
    }
  }

  /** Pushes the current theme onto <html>. Cheap enough to run on every change. */
  function applyTheme() {
    if (!import.meta.client) return

    applyTokens(document.documentElement, resolveThemeTokens(theme.value, seeds.value))

    if (motion.value === 'full')
      document.documentElement.removeAttribute('data-motion')
    else
      document.documentElement.setAttribute('data-motion', motion.value)
  }

  function setTheme(id: ThemeId) {
    themeId.value = id
    // Edits are per-theme by intent — carrying a custom emerald into the retro
    // skin would quietly undo the thing the player just chose.
    seeds.value = {}
  }

  function setSeed(key: SeedKey, value: string) {
    if (!isValidHex(value)) return
    seeds.value = { ...seeds.value, [key]: value }
  }

  function resetSeed(key: SeedKey) {
    const next = { ...seeds.value }
    delete next[key]
    seeds.value = next
  }

  function resetAllSeeds() {
    seeds.value = {}
  }

  function toggleMute() {
    muted.value = !muted.value
  }

  function cycleTheme() {
    const ids = Object.keys(THEMES) as ThemeId[]
    const next = ids[(ids.indexOf(themeId.value) + 1) % ids.length]
    if (next) setTheme(next)
  }

  /** Serialises the active palette so a player can share or re-import it. */
  function exportTheme(): string {
    return JSON.stringify({ themeId: themeId.value, seeds: effectiveSeeds.value }, null, 2)
  }

  function importTheme(raw: string): { ok: boolean; error?: string } {
    let parsed: { themeId?: string; seeds?: Partial<Seeds> }
    try {
      parsed = JSON.parse(raw)
    }
    catch {
      return { ok: false, error: 'That is not valid JSON.' }
    }

    if (parsed.themeId && !(parsed.themeId in THEMES))
      return { ok: false, error: `Unknown theme "${parsed.themeId}".` }

    const cleaned = sanitiseSeeds(parsed.seeds)
    if (!Object.keys(cleaned).length && !parsed.themeId)
      return { ok: false, error: 'No usable colours found in that file.' }

    if (parsed.themeId) themeId.value = parsed.themeId as ThemeId
    seeds.value = cleaned
    return { ok: true }
  }

  function resetToDefaults() {
    const base = defaults()
    themeId.value = base.themeId
    seeds.value = {}
    motion.value = base.motion
    muted.value = base.muted
    volume.value = base.volume
    sfxCategories.value = { ...base.sfxCategories }
    playbackSpeed.value = base.playbackSpeed
    confirmSelling.value = base.confirmSelling
    verboseToasts.value = base.verboseToasts
  }

  // Any change re-applies and re-saves. Both are idempotent and sub-millisecond.
  watch(
    [themeId, seeds, motion],
    () => {
      applyTheme()
      persist()
    },
    { deep: true },
  )

  watch(
    [muted, volume, sfxCategories, playbackSpeed, confirmSelling, verboseToasts],
    persist,
    { deep: true },
  )

  return {
    themeId,
    seeds,
    motion,
    muted,
    volume,
    sfxCategories,
    playbackSpeed,
    confirmSelling,
    verboseToasts,
    hydrated,
    theme,
    effectiveSeeds,
    customisedSeeds,
    hasCustomColors,
    load,
    applyTheme,
    setTheme,
    setSeed,
    resetSeed,
    resetAllSeeds,
    resetToDefaults,
    toggleMute,
    cycleTheme,
    exportTheme,
    importTheme,
  }
})

function sanitiseSeeds(raw: unknown): Partial<Seeds> {
  if (!raw || typeof raw !== 'object') return {}

  const clean: Partial<Seeds> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' && isValidHex(value))
      clean[key as SeedKey] = value
  }
  return clean
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
