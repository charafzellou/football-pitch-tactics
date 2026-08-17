/**
 * Match statistics, derived entirely on the client from the event list.
 *
 * The engine records every shot, cross, corner and foul it generates, so a
 * full stats panel needs no new endpoint — only a tally of what has already
 * been revealed on the clock. Counting stops at `currentMinute` so the panel
 * never spoils events the player has not watched yet.
 */
import { computed, type Ref } from 'vue'
import type { MatchEvent } from '#shared/match-state'
import { normalizeEventType } from '~/utils/match-events'

export interface SideStats {
  goals: number
  shots: number
  onTarget: number
  corners: number
  crosses: number
  fouls: number
  offsides: number
  yellows: number
  reds: number
  substitutions: number
  /** Every event attributed to this side — the possession proxy's numerator. */
  total: number
}

function emptyStats(): SideStats {
  return {
    goals: 0, shots: 0, onTarget: 0, corners: 0, crosses: 0,
    fouls: 0, offsides: 0, yellows: 0, reds: 0, substitutions: 0, total: 0,
  }
}

export interface StatRow {
  label: string
  home: number
  away: number
  /** Share of the row's total held by the home side, 0–100. */
  homeShare: number
}

export function useMatchStats(
  events: Ref<MatchEvent[]>,
  currentMinute: Ref<number>,
  homeTeamId: Ref<number | null>,
  awayTeamId: Ref<number | null>,
) {
  const tally = computed(() => {
    const home = emptyStats()
    const away = emptyStats()

    for (const event of events.value) {
      if (event.minute > currentMinute.value) continue

      const side = event.teamId === homeTeamId.value
        ? home
        : event.teamId === awayTeamId.value ? away : null
      if (!side) continue

      side.total++

      switch (normalizeEventType(event.eventType)) {
        case 'goal':
          side.goals++
          side.shots++
          side.onTarget++
          break
        case 'shot_on_target':
          side.shots++
          side.onTarget++
          break
        case 'shot':
          side.shots++
          break
        case 'corner': side.corners++; break
        case 'cross': side.crosses++; break
        case 'foul': side.fouls++; break
        case 'offside': side.offsides++; break
        case 'yellow': side.yellows++; break
        case 'red': side.reds++; break
        case 'substitution': side.substitutions++; break
      }
    }

    return { home, away }
  })

  /**
   * A possession stand-in. The engine models no true possession, so this is
   * each side's share of attacking events — which tracks it closely enough to
   * be informative, and is labelled "Territory" rather than "Possession" so it
   * doesn't claim to be something it isn't.
   */
  const territory = computed(() => {
    const { home, away } = tally.value
    const total = home.total + away.total
    if (!total) return 50
    return Math.round((home.total / total) * 100)
  })

  const rows = computed<StatRow[]>(() => {
    const { home, away } = tally.value

    return ([
      ['Shots', home.shots, away.shots],
      ['On target', home.onTarget, away.onTarget],
      ['Corners', home.corners, away.corners],
      ['Crosses', home.crosses, away.crosses],
      ['Fouls', home.fouls, away.fouls],
      ['Offsides', home.offsides, away.offsides],
      ['Yellow cards', home.yellows, away.yellows],
    ] as const)
      .map(([label, homeValue, awayValue]) => {
        const total = homeValue + awayValue
        return {
          label,
          home: homeValue,
          away: awayValue,
          homeShare: total ? Math.round((homeValue / total) * 100) : 50,
        }
      })
      // A row nobody has registered yet is noise.
      .filter(row => row.home || row.away)
  })

  /**
   * Rolling attacking pressure per 10-minute block, home minus away.
   * Positive means the home side was on top. Drives the momentum sparkline.
   */
  const momentum = computed(() => {
    const blockSize = 10
    const blocks = Math.max(1, Math.ceil(currentMinute.value / blockSize))
    const series = Array.from({ length: blocks }, () => 0)

    for (const event of events.value) {
      if (event.minute > currentMinute.value) continue

      const weight = attackWeight(event.eventType)
      if (!weight) continue

      const index = Math.min(blocks - 1, Math.floor((event.minute - 1) / blockSize))
      if (index < 0) continue

      if (event.teamId === homeTeamId.value) series[index]! += weight
      else if (event.teamId === awayTeamId.value) series[index]! -= weight
    }

    return series
  })

  return { tally, territory, rows, momentum }
}

/** How much an event says about who is on top. Fouls and cards say nothing. */
function attackWeight(eventType: string): number {
  switch (normalizeEventType(eventType)) {
    case 'goal': return 5
    case 'shot_on_target': return 3
    case 'shot': return 2
    case 'corner': return 1.5
    case 'cross': return 1
    default: return 0
  }
}
