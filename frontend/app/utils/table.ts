/**
 * Sortable column headers for `UTable`.
 *
 * The same twenty-line `h(UButton, { ... })` block was copy-pasted eleven
 * times across the Dashboard and Team pages, differing only in its label.
 */
import { h } from 'vue'
import { UButton } from '#components'
import { LINEUP_SLOT_ORDER, normalizePosition } from '#shared/lineup'

interface SortableColumn {
  getIsSorted: () => false | 'asc' | 'desc'
  toggleSorting: (desc: boolean) => void
}

function sortIcon(state: false | 'asc' | 'desc') {
  if (!state) return 'i-lucide-arrow-up-down'
  return state === 'asc' ? 'i-lucide-arrow-up-narrow-wide' : 'i-lucide-arrow-down-wide-narrow'
}

/** Header cell renderer for a sortable column. */
export function sortableHeader(label: string) {
  return ({ column }: { column: SortableColumn }) => h(UButton, {
    color: 'neutral',
    variant: 'ghost',
    label,
    icon: sortIcon(column.getIsSorted()),
    class: '-mx-2.5 font-semibold',
    onClick: () => column.toggleSorting(column.getIsSorted() === 'asc'),
  })
}

/**
 * Orders a position column GK → DF → MF → FW rather than alphabetically.
 * Unknown positions sort last, then alphabetically among themselves.
 */
export function positionSortingFn(rowA: any, rowB: any, columnId: string): number {
  const left = String(rowA.getValue(columnId) ?? '')
  const right = String(rowB.getValue(columnId) ?? '')
  const leftIndex = indexOfSlot(left)
  const rightIndex = indexOfSlot(right)

  if (leftIndex !== -1 && rightIndex !== -1)
    return leftIndex - rightIndex
  if (leftIndex !== -1) return -1
  if (rightIndex !== -1) return 1

  return left.localeCompare(right)
}

function indexOfSlot(raw: string): number {
  const slot = normalizePosition(raw)
  return slot ? LINEUP_SLOT_ORDER.indexOf(slot) : -1
}
