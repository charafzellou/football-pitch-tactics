/**
 * Presentation for match events — icons, colours, labels and weighting.
 *
 * Lifted out of `pages/matchday/index.vue` so the live feed, the timeline
 * strip and the full-time report all describe an event the same way.
 */

/** The seed data mixes `yellow`/`yellow_card` spellings — collapse them here. */
export function normalizeEventType(type: string): string {
  const value = String(type ?? '').toLowerCase().trim()

  if (value === 'yellow_card') return 'yellow'
  if (value === 'red_card') return 'red'
  if (value === 'sub' || value === 'sub_off') return 'substitution'

  return value
}

export function eventLabel(type: string): string {
  const value = normalizeEventType(type)

  switch (value) {
    case 'yellow': return 'yellow card'
    case 'red': return 'red card'
    default: return value.replace(/_/g, ' ')
  }
}

export function eventIcon(type: string): string {
  switch (normalizeEventType(type)) {
    case 'goal': return 'i-lucide-circle-dot'
    case 'yellow': return 'i-lucide-square'
    case 'red': return 'i-lucide-square'
    case 'substitution': return 'i-lucide-arrow-left-right'
    case 'foul': return 'i-lucide-flag'
    case 'injury': return 'i-lucide-heart-crack'
    case 'shot': return 'i-lucide-crosshair'
    case 'shot_on_target': return 'i-lucide-target'
    case 'corner': return 'i-lucide-flag-triangle-right'
    case 'cross': return 'i-lucide-move-right'
    case 'offside': return 'i-lucide-ban'
    default: return 'i-lucide-zap'
  }
}

export function eventIconClass(type: string): string {
  switch (normalizeEventType(type)) {
    case 'goal': return 'text-[var(--app-accent)]'
    case 'yellow': return 'text-amber-400'
    case 'red': return 'text-red-500'
    case 'substitution': return 'text-sky-400'
    case 'foul': return 'text-orange-400'
    case 'injury': return 'text-rose-400'
    case 'shot_on_target': return 'text-sky-400'
    case 'corner': return 'text-teal-400'
    case 'offside': return 'text-orange-300'
    default: return 'text-[var(--app-text-muted)]'
  }
}

/**
 * How much visual weight a feed row deserves.
 *
 * A match generates ~45 events dominated by crosses and fouls; rendering all
 * of them at identical weight is why the feed reads as noise. Goals become
 * hero rows, discipline is tinted, routine play recedes.
 */
export type EventWeight = 'hero' | 'notable' | 'routine'

export function eventWeight(type: string): EventWeight {
  switch (normalizeEventType(type)) {
    case 'goal':
      return 'hero'
    case 'red':
    case 'yellow':
    case 'injury':
    case 'substitution':
    case 'shot_on_target':
      return 'notable'
    default:
      return 'routine'
  }
}

/** Marker colour for the timeline strip, as a CSS colour value. */
export function eventMarkerColor(type: string): string {
  switch (normalizeEventType(type)) {
    case 'goal': return 'var(--app-accent)'
    case 'yellow': return 'var(--app-player-booked)'
    case 'red': return 'var(--app-player-sent-off)'
    case 'injury': return 'var(--app-player-injured)'
    case 'substitution': return 'var(--app-pos-gk)'
    case 'shot_on_target': return 'var(--app-pos-gk)'
    default: return 'var(--app-text-muted)'
  }
}

/** Events worth marking on the timeline — the rest would just be clutter. */
export function isTimelineEvent(type: string): boolean {
  return eventWeight(type) !== 'routine'
}

export type EventFilterId = 'all' | 'goals' | 'shots' | 'cards' | 'subs' | 'fouls'

export interface EventFilter {
  id: EventFilterId
  label: string
  /** `null` means "everything" — the default filter. */
  types: string[] | null
}

export const EVENT_FILTERS: readonly EventFilter[] = [
  { id: 'all', label: 'All', types: null },
  { id: 'goals', label: 'Goals', types: ['goal'] },
  { id: 'shots', label: 'Shots', types: ['goal', 'shot_on_target', 'shot'] },
  { id: 'cards', label: 'Cards', types: ['yellow', 'red'] },
  { id: 'subs', label: 'Subs', types: ['substitution'] },
  { id: 'fouls', label: 'Fouls', types: ['foul', 'offside', 'injury'] },
]
