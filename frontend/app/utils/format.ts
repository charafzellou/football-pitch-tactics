/**
 * Shared formatting.
 *
 * Money in particular was inconsistent: the Dashboard rendered the bank
 * balance in USD while the Team and Transfers pages rendered the same number
 * in EUR. One helper, one currency.
 */

const CURRENCY = 'EUR'
const LOCALE = 'en-IE'

const full = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: CURRENCY,
  maximumFractionDigits: 0,
})

const compact = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: CURRENCY,
  notation: 'compact',
  maximumFractionDigits: 1,
})

/** `€24,500,000` — for tables and detail views where precision matters. */
export function formatMoney(value: number | null | undefined): string {
  return full.format(value ?? 0)
}

/** `€24.5M` — for chips, headers and anywhere space is tight. */
export function formatMoneyCompact(value: number | null | undefined): string {
  return compact.format(value ?? 0)
}

/** `Sat 14 Sep` — the schedule's default. */
export function formatMatchDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  return date.toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' })
}

/** `Saturday 14 September 2025` — for a fixture's own header. */
export function formatMatchDateLong(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  return date.toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

/** `September 2025` — the schedule's group headings. */
export function formatMonthGroup(value: string | Date | null | undefined): string {
  if (!value) return 'Unscheduled'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unscheduled'

  return date.toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' })
}

/** Whole days from now until `value`, negative once it's past. */
export function daysUntil(value: string | Date | null | undefined): number | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null

  const day = 24 * 60 * 60 * 1000
  return Math.round((date.setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / day)
}

/** Up to two initials, for crest and avatar placeholders. */
export function getInitials(name: string | null | undefined): string {
  return String(name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? '')
    .join('')
}

export function averageOf(values: number[]): number {
  if (!values.length) return 0
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length)
}

/** Threshold colouring shared by every stamina and skill bar in the app. */
export function staminaTone(value: number): 'danger' | 'warning' | 'default' {
  if (value < 40) return 'danger'
  if (value < 65) return 'warning'
  return 'default'
}

/**
 * A signed amount — `+€1.2M`, `−€840,000`.
 *
 * The finance pages were each inlining `{{ x > 0 ? '+' : '' }}` around a
 * formatter, which is fine until one of them forgets and a loss reads as a gain.
 */
export function formatDelta(value: number | null | undefined, compact = false): string {
  const amount = value ?? 0
  const formatted = compact ? formatMoneyCompact(Math.abs(amount)) : formatMoney(Math.abs(amount))

  if (amount > 0) return `+${formatted}`
  if (amount < 0) return `−${formatted}`
  return formatted
}

/** A whole-number percentage, or `—` when there is nothing to take a share of. */
export function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${Math.round(value)}%`
}

/**
 * Colour for a money figure: healthy, watch it, or in trouble.
 *
 * Returns a CSS variable rather than a class, because a hardcoded colour in a
 * template is invisible to the theme editor.
 */
export function moneyColor(value: number): string {
  return value < 0 ? 'var(--app-player-sent-off)' : 'var(--app-accent)'
}
