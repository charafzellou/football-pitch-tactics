/**
 * The theme engine.
 *
 * Nuxt UI 3 resolves every component colour through a chain of CSS custom
 * properties (verified in `@nuxt/ui/dist/runtime/plugins/colors.js` and
 * `@nuxt/ui/.nuxt/ui.css`):
 *
 *   --color-brand-{50..950}        ← declared by us in `@theme static`
 *     → --ui-color-primary-{shade} ← generated from app.config `ui.colors.primary: 'brand'`
 *       → --color-primary-{shade}  ← Tailwind alias, drives every `primary` utility
 *
 * Every link in that chain is a plain custom property, so writing
 * `--color-brand-500` as an *inline style on <html>* re-themes the entire app
 * at runtime — inline styles outrank the `:root` rule the plugin emits. The
 * same applies to `--color-shell-*` (neutral) and to `--ui-radius`, which alone
 * drives `--radius-xs` through `--radius-3xl`.
 *
 * Only these *primitives* are written from JS:
 *   - the two 50–950 ramps
 *   - four position colours, pitch and gold
 *   - a handful of `--app-*` chrome values (radius, border width, blur…)
 *
 * Every other `--app-*` token is derived from them in `main.css` with
 * `color-mix()`, which keeps this file small and means a theme change moves
 * surfaces, borders and text tones coherently instead of leaving orphaned
 * greys behind.
 *
 * Theme *data* and the pre-paint snippet live in `theme-definitions.ts`, which
 * has no dependencies so `nuxt.config.ts` can import it.
 */
import { colord, extend } from 'colord'
import a11yPlugin from 'colord/plugins/a11y'
import mixPlugin from 'colord/plugins/mix'
import {
  DIRECT_SEED_TOKENS,
  RAMP_SEEDS,
  SHADES,
  SHADE_LIGHTNESS,
} from './theme-definitions'
import type { SeedKey, Seeds, Shade, ThemeDefinition } from './theme-definitions'

extend([a11yPlugin, mixPlugin])

export * from './theme-definitions'

/**
 * Builds a 50→950 ramp from a single seed colour.
 *
 * Hue and saturation come from the seed; lightness is forced to the table in
 * `theme-definitions.ts`. Saturation is damped at both extremes so a vivid
 * seed doesn't produce a neon 50 or a glowing 950.
 */
export function generateRamp(seedHex: string): Record<Shade, string> {
  const parsed = colord(seedHex)
  const base = parsed.isValid() ? parsed : colord('#00dc82')
  const { h, s } = base.toHsl()

  const ramp = {} as Record<Shade, string>
  for (const shade of SHADES) {
    const l = SHADE_LIGHTNESS[shade]
    const damp = l > 85 ? 0.7 : l < 20 ? 0.82 : 1
    ramp[shade] = colord({ h, s: Math.min(100, s * damp), l }).toHex()
  }
  return ramp
}

export function isValidHex(value: string): boolean {
  return colord(value).isValid()
}

/** WCAG contrast ratio, for the Settings page's readability gate. */
export function contrastRatio(foreground: string, background: string): number {
  if (!isValidHex(foreground) || !isValidHex(background)) return 0
  return Math.round(colord(foreground).contrast(colord(background)) * 100) / 100
}

export function contrastGrade(ratio: number): { label: string; tone: 'success' | 'warning' | 'error' } {
  if (ratio >= 7) return { label: 'AAA', tone: 'success' }
  if (ratio >= 4.5) return { label: 'AA', tone: 'success' }
  if (ratio >= 3) return { label: 'Large text only', tone: 'warning' }
  return { label: 'Fails contrast', tone: 'error' }
}

/**
 * Expands a theme's seeds into the flat set of primitives to write onto
 * `<html>`. Everything else is derived from these in `main.css`.
 */
export function resolveThemeTokens(theme: ThemeDefinition, overrides: Partial<Seeds> = {}): Record<string, string> {
  const seeds: Seeds = { ...theme.seeds, ...stripInvalid(overrides) }
  const tokens: Record<string, string> = { ...theme.chrome }

  for (const name of RAMP_SEEDS) {
    const ramp = generateRamp(seeds[name])
    for (const shade of SHADES)
      tokens[`--color-${name}-${shade}`] = ramp[shade]
  }

  for (const [key, property] of Object.entries(DIRECT_SEED_TOKENS))
    tokens[property] = seeds[key as SeedKey]

  return tokens
}

function stripInvalid(overrides: Partial<Seeds>): Partial<Seeds> {
  const clean: Partial<Seeds> = {}
  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value === 'string' && isValidHex(value))
      clean[key as SeedKey] = value
  }
  return clean
}

/** Writes resolved tokens onto an element — `<html>` in practice. */
export function applyTokens(element: HTMLElement, tokens: Record<string, string>) {
  for (const [property, value] of Object.entries(tokens))
    element.style.setProperty(property, value)
}
