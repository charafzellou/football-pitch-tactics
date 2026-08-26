import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  averageOf,
  daysUntil,
  formatDelta,
  formatMatchDate,
  formatMatchDateLong,
  formatMonthGroup,
  formatMoney,
  formatMoneyCompact,
  formatPercent,
  getInitials,
  moneyColor,
  staminaTone,
} from './format'

describe('formatMoney', () => {
  it('formats a whole euro figure with the euro sign', () => {
    expect(formatMoney(24_500_000)).toContain('24,500,000')
    expect(formatMoney(24_500_000)).toContain('€')
  })

  it('defaults a nullish value to zero', () => {
    expect(formatMoney(null)).toBe(formatMoney(0))
    expect(formatMoney(undefined)).toBe(formatMoney(0))
  })
})

describe('formatMoneyCompact', () => {
  it('abbreviates millions', () => {
    expect(formatMoneyCompact(24_500_000)).toMatch(/24\.5M/)
  })
})

describe('formatMatchDate and formatMatchDateLong', () => {
  it('returns an em-dash for a missing date', () => {
    expect(formatMatchDate(null)).toBe('—')
    expect(formatMatchDate(undefined)).toBe('—')
    expect(formatMatchDateLong(null)).toBe('—')
  })

  it('returns an em-dash for an invalid date string', () => {
    expect(formatMatchDate('not a date')).toBe('—')
  })

  it('formats a valid date', () => {
    const formatted = formatMatchDate('2025-09-14T15:00:00Z')
    expect(formatted).toContain('Sep')
    expect(formatted).toContain('14')
  })

  it('the long form includes the year and full weekday', () => {
    const formatted = formatMatchDateLong('2025-09-14T15:00:00Z')
    expect(formatted).toContain('2025')
    expect(formatted).toContain('September')
  })
})

describe('formatMonthGroup', () => {
  it('returns "Unscheduled" for a missing or invalid date', () => {
    expect(formatMonthGroup(null)).toBe('Unscheduled')
    expect(formatMonthGroup('nonsense')).toBe('Unscheduled')
  })

  it('formats month and year', () => {
    expect(formatMonthGroup('2025-09-14T15:00:00Z')).toBe('September 2025')
  })
})

describe('daysUntil', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-10T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns null for a missing or invalid date', () => {
    expect(daysUntil(null)).toBeNull()
    expect(daysUntil('nonsense')).toBeNull()
  })

  it('counts whole days to a future date', () => {
    expect(daysUntil('2025-01-15T12:00:00Z')).toBe(5)
  })

  it('is negative for a date already past', () => {
    expect(daysUntil('2025-01-05T12:00:00Z')).toBe(-5)
  })

  it('is 0 for today', () => {
    expect(daysUntil('2025-01-10T18:00:00Z')).toBe(0)
  })
})

describe('getInitials', () => {
  it('takes up to two initials from a name', () => {
    expect(getInitials('Erling Haaland')).toBe('EH')
  })

  it('caps at two initials for a longer name', () => {
    expect(getInitials('Jean Paul Marie Dupont')).toBe('JP')
  })

  it('handles a single-word name', () => {
    expect(getInitials('Pele')).toBe('P')
  })

  it('returns an empty string for nothing', () => {
    expect(getInitials(null)).toBe('')
    expect(getInitials(undefined)).toBe('')
    expect(getInitials('')).toBe('')
  })
})

describe('averageOf', () => {
  it('returns 0 for an empty array', () => {
    expect(averageOf([])).toBe(0)
  })

  it('rounds the mean', () => {
    expect(averageOf([1, 2])).toBe(2) // 1.5 rounds to 2
    expect(averageOf([10, 20, 30])).toBe(20)
  })
})

describe('staminaTone', () => {
  it('is danger below 40', () => {
    expect(staminaTone(39)).toBe('danger')
  })

  it('is warning between 40 and 64', () => {
    expect(staminaTone(40)).toBe('warning')
    expect(staminaTone(64)).toBe('warning')
  })

  it('is default at 65 and above', () => {
    expect(staminaTone(65)).toBe('default')
    expect(staminaTone(100)).toBe('default')
  })
})

describe('formatDelta', () => {
  it('prefixes a positive amount with a plus sign', () => {
    expect(formatDelta(1_200_000)).toMatch(/^\+/)
  })

  it('prefixes a negative amount with a minus sign', () => {
    expect(formatDelta(-840_000)).toMatch(/^−/)
  })

  it('has no sign for exactly zero', () => {
    const formatted = formatDelta(0)
    expect(formatted.startsWith('+')).toBe(false)
    expect(formatted.startsWith('−')).toBe(false)
  })

  it('defaults a nullish value to zero', () => {
    expect(formatDelta(null)).toBe(formatDelta(0))
  })
})

describe('formatPercent', () => {
  it('returns an em-dash for a nullish value', () => {
    expect(formatPercent(null)).toBe('—')
    expect(formatPercent(undefined)).toBe('—')
  })

  it('rounds to a whole percentage', () => {
    expect(formatPercent(54.6)).toBe('55%')
  })
})

describe('moneyColor', () => {
  it('returns the sent-off colour variable for a negative amount', () => {
    expect(moneyColor(-100)).toBe('var(--app-player-sent-off)')
  })

  it('returns the accent colour variable for a non-negative amount', () => {
    expect(moneyColor(0)).toBe('var(--app-accent)')
    expect(moneyColor(100)).toBe('var(--app-accent)')
  })
})
