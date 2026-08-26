import { describe, expect, it } from 'vitest'
import {
  EVENT_FILTERS,
  eventIcon,
  eventIconClass,
  eventLabel,
  eventMarkerColor,
  eventWeight,
  isTimelineEvent,
  normalizeEventType,
} from './match-events'

describe('normalizeEventType', () => {
  it('collapses the alternate card spellings', () => {
    expect(normalizeEventType('yellow_card')).toBe('yellow')
    expect(normalizeEventType('red_card')).toBe('red')
  })

  it('collapses the alternate substitution spellings', () => {
    expect(normalizeEventType('sub')).toBe('substitution')
    expect(normalizeEventType('sub_off')).toBe('substitution')
  })

  it('lowercases and trims otherwise', () => {
    expect(normalizeEventType(' Goal ')).toBe('goal')
  })
})

describe('eventLabel', () => {
  it('labels cards distinctly from their raw type', () => {
    expect(eventLabel('yellow')).toBe('yellow card')
    expect(eventLabel('red')).toBe('red card')
  })

  it('replaces underscores with spaces for everything else', () => {
    expect(eventLabel('shot_on_target')).toBe('shot on target')
  })
})

describe('eventIcon', () => {
  it('has a distinct icon for goal, card and substitution events', () => {
    const icons = new Set([eventIcon('goal'), eventIcon('yellow'), eventIcon('red'), eventIcon('substitution')])
    expect(icons.size).toBeGreaterThan(1)
  })

  it('falls back to a default icon for an unknown type', () => {
    expect(eventIcon('mystery')).toBe('i-lucide-zap')
  })
})

describe('eventWeight and isTimelineEvent', () => {
  it('a goal is a hero event', () => {
    expect(eventWeight('goal')).toBe('hero')
    expect(isTimelineEvent('goal')).toBe(true)
  })

  it('cards, injuries and subs are notable', () => {
    for (const type of ['yellow', 'red', 'injury', 'substitution', 'shot_on_target'])
      expect(eventWeight(type)).toBe('notable')
  })

  it('routine play is not a timeline event', () => {
    expect(eventWeight('cross')).toBe('routine')
    expect(isTimelineEvent('cross')).toBe(false)
  })
})

describe('eventMarkerColor', () => {
  it('returns a CSS colour value for every weighted type', () => {
    for (const type of ['goal', 'yellow', 'red', 'injury', 'substitution'])
      expect(eventMarkerColor(type)).toMatch(/^var\(--/)
  })
})

describe('EVENT_FILTERS', () => {
  it('includes an "all" filter with no type restriction', () => {
    const all = EVENT_FILTERS.find(f => f.id === 'all')
    expect(all?.types).toBeNull()
  })

  it('every other filter restricts to a non-empty type list', () => {
    for (const filter of EVENT_FILTERS) {
      if (filter.id === 'all') continue
      expect(filter.types?.length).toBeGreaterThan(0)
    }
  })
})
