/**
 * Position tabs, search and availability filters over a squad.
 *
 * Shared by the Dashboard's lineup builder and the Team page so both offer the
 * same controls and the same counts.
 */
import { computed, ref, type Ref } from 'vue'
import type { LineupSlot } from '#shared/lineup'
import { LINEUP_SLOT_ORDER, isAvailable, normalizePosition } from '#shared/lineup'

interface FilterablePlayer {
  id: number
  name: string
  position: string
  skillLevel: number
  stamina: number
  age: number
  marketValue: number
  injuredMatches?: number
}

export type SlotFilter = LineupSlot | 'ALL'
export type SquadSort = 'position' | 'skill' | 'stamina' | 'value' | 'age' | 'name'

export function useSquadFilters<T extends FilterablePlayer>(players: Ref<T[]>) {
  const slot = ref<SlotFilter>('ALL')
  const search = ref('')
  const availableOnly = ref(false)
  const freshOnly = ref(false)
  const sort = ref<SquadSort>('position')

  const slotCounts = computed(() => {
    const counts: Record<SlotFilter, number> = { ALL: players.value.length, GK: 0, DF: 0, MF: 0, FW: 0 }
    for (const player of players.value) {
      const normalized = normalizePosition(player.position)
      if (normalized) counts[normalized]++
    }
    return counts
  })

  const tabs = computed(() =>
    (['ALL', ...LINEUP_SLOT_ORDER] as SlotFilter[]).map(id => ({
      id,
      label: id === 'ALL' ? 'All' : id,
      count: slotCounts.value[id],
    })),
  )

  const filtered = computed(() => {
    const query = search.value.trim().toLowerCase()

    const result = players.value.filter((player) => {
      if (slot.value !== 'ALL' && normalizePosition(player.position) !== slot.value) return false
      if (query && !player.name.toLowerCase().includes(query)) return false
      if (availableOnly.value && !isAvailable(player)) return false
      if (freshOnly.value && player.stamina < 65) return false
      return true
    })

    return result.sort(comparatorFor(sort.value))
  })

  const isFiltered = computed(() =>
    slot.value !== 'ALL' || Boolean(search.value.trim()) || availableOnly.value || freshOnly.value,
  )

  function reset() {
    slot.value = 'ALL'
    search.value = ''
    availableOnly.value = false
    freshOnly.value = false
  }

  return { slot, search, availableOnly, freshOnly, sort, tabs, filtered, isFiltered, slotCounts, reset }
}

function comparatorFor<T extends FilterablePlayer>(sort: SquadSort): (a: T, b: T) => number {
  switch (sort) {
    case 'skill': return (a, b) => b.skillLevel - a.skillLevel
    case 'stamina': return (a, b) => b.stamina - a.stamina
    case 'value': return (a, b) => b.marketValue - a.marketValue
    case 'age': return (a, b) => a.age - b.age
    case 'name': return (a, b) => a.name.localeCompare(b.name)
    default:
      return (a, b) => {
        const left = normalizePosition(a.position)
        const right = normalizePosition(b.position)
        const leftIndex = left ? LINEUP_SLOT_ORDER.indexOf(left) : 99
        const rightIndex = right ? LINEUP_SLOT_ORDER.indexOf(right) : 99
        return leftIndex - rightIndex || b.skillLevel - a.skillLevel
      }
  }
}

export const SQUAD_SORT_OPTIONS: { label: string; value: SquadSort }[] = [
  { label: 'Position', value: 'position' },
  { label: 'Skill', value: 'skill' },
  { label: 'Stamina', value: 'stamina' },
  { label: 'Value', value: 'value' },
  { label: 'Age', value: 'age' },
  { label: 'Name', value: 'name' },
]
