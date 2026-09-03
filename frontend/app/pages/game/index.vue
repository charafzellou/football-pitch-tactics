<script setup lang="ts">
/**
 * Dashboard — club status, the next fixture, and the lineup builder.
 *
 * The pitch moved into `LineupPitch.vue`. Three things changed in behaviour:
 * every tap used to fire a toast (three variants, on every click, which buried
 * the ones that mattered); there was no way to auto-pick, clear or save an XI
 * without playing; and the opponent was fetched in full but only its name was
 * ever shown.
 */
import { computed, h, ref, watch } from 'vue'
import { UBadge, UIcon } from '#components'
import type { LineupSlot } from '#shared/lineup'
import {
  DEFAULT_TACTIC_NAME,
  LINEUP_SIZE,
  LINEUP_SLOT_ORDER,
  autoSelectLineup,
  isAvailable,
  normalizePosition,
  parseLineup,
} from '#shared/lineup'
import { averageOf, formatMoney, formatMoneyCompact, formatMatchDate } from '~/utils/format'
import { sortableHeader, positionSortingFn } from '~/utils/table'
import { recentForm } from '~/utils/results'
import type { SquadPlayer, TeamPayload } from '~/composables/useGameContext'

interface TacticOption {
  name: string
  formation: Record<LineupSlot, number>
  modifiers: { attack: number; defence: number }
}

const PITCH_ROW_ORDER: LineupSlot[] = ['FW', 'MF', 'DF', 'GK']
const POSITION_LABELS: Record<LineupSlot, string> = {
  GK: 'Goalkeepers', DF: 'Defenders', MF: 'Midfielders', FW: 'Forwards',
}
const POSITION_SINGULAR: Record<LineupSlot, string> = {
  GK: 'goalkeeper', DF: 'defender', MF: 'midfielder', FW: 'forward',
}
const PITCH_ROW_LABELS: Record<LineupSlot, string> = {
  FW: 'Forward Line', MF: 'Midfield Line', DF: 'Defensive Line', GK: 'Goalkeeper',
}

const toast = useAppToast()
const sfx = useSfx()
const { team, gameState, nextMatch, opponentId, isHomeFixture, refreshTeam } = useGameContext()

const { data: playedFixtures } = useAsyncData(
  'dashboard-history',
  () => $fetch<any[]>('/api/schedule?includePlayed=true'),
  { default: () => [] as any[] },
)

const { data: seasonStatus } = useAsyncData(
  'dashboard-season',
  () => $fetch<any>('/api/season/status'),
)

/**
 * Board and fan confidence.
 *
 * Both meters, and the news rows explaining every movement in them, were
 * written from the first matchday and displayed nowhere — so the one system
 * that pushes back on the manager was invisible right up to the moment it
 * ended their save. `board.ts` states the design goal as pressure that is
 * always *explainable*; that requires it to be visible first.
 */
const { data: board } = useAsyncData('dashboard-board', () => $fetch<any>('/api/board'))

/** The board is unhappy enough that the manager should know about it. */
const boardWarning = computed(() => {
  if (!board.value) return null

  const { boardConfidence, warningThreshold, sackThreshold, confidenceStreak, sackStreak, sackingEnabled } = board.value
  if (boardConfidence > warningThreshold) return null

  if (boardConfidence <= sackThreshold && confidenceStreak > 0) {
    return sackingEnabled
      ? `Your position is under review — ${confidenceStreak} of ${sackStreak} matchdays without confidence.`
      : 'The board has lost faith in you. Dismissal is disabled in this save.'
  }

  return 'The board has concerns about your results.'
})

/**
 * Standings and the opponent hang off `team`, which resolves asynchronously.
 * `useAsyncData`'s `watch` option proved unreliable for this — the dependency
 * is already populated by the time the watcher is installed, so no change ever
 * fires and the request never runs a second time. Plain watchers with
 * `immediate` are explicit about when they run and always catch the transition.
 */
const standings = ref<any[]>([])
watch(() => team.value?.leagueId, async (leagueId) => {
  if (!leagueId) return
  try {
    standings.value = await $fetch<any[]>(`/api/standings?leagueId=${leagueId}`)
  }
  catch {
    standings.value = []
  }
}, { immediate: true })

const opponentTeam = ref<TeamPayload | null>(null)
watch(opponentId, async (id) => {
  if (!id) {
    opponentTeam.value = null
    return
  }
  try {
    opponentTeam.value = await $fetch<TeamPayload>(`/api/team/${id}`)
  }
  catch {
    opponentTeam.value = null
  }
}, { immediate: true })

const { data: tacticsList } = useFetch('/api/tactics')

const selectedTactic = ref('')
const selectedPlayers = ref<number[]>([])
const saving = ref(false)
const formationConfirmOpen = ref(false)
const pendingTactic = ref<string | null>(null)
const draggedPlayer = ref<SquadPlayer | null>(null)

const squadPlayers = computed(() => (team.value?.squad ?? []) as SquadPlayer[])
const selectedPlayerIds = computed(() => new Set(selectedPlayers.value))
const tacticOptions = computed(() => (tacticsList.value ?? []) as TacticOption[])

const selectedTacticDetails = computed(() =>
  tacticOptions.value.find(tactic => tactic.name === selectedTactic.value) ?? tacticOptions.value[0] ?? null,
)

const formationRequirements = computed<Record<LineupSlot, number>>(() =>
  selectedTacticDetails.value?.formation ?? { GK: 0, DF: 0, MF: 0, FW: 0 },
)

const selectedSquadPlayers = computed(() =>
  squadPlayers.value
    .filter(player => selectedPlayerIds.value.has(player.id))
    .sort((left, right) => {
      const leftPosition = normalizePosition(left.position) ?? 'FW'
      const rightPosition = normalizePosition(right.position) ?? 'FW'
      const diff = LINEUP_SLOT_ORDER.indexOf(leftPosition) - LINEUP_SLOT_ORDER.indexOf(rightPosition)
      return diff !== 0 ? diff : right.skillLevel - left.skillLevel
    }),
)

const selectedPositionCounts = computed<Record<LineupSlot, number>>(() => {
  const counts = { GK: 0, DF: 0, MF: 0, FW: 0 }
  for (const player of selectedSquadPlayers.value) {
    const position = normalizePosition(player.position)
    if (position) counts[position]++
  }
  return counts
})

/** Every squad member per slot, and the subset of them fit to play. */
const squadCountsBySlot = computed<Record<LineupSlot, number>>(() => {
  const counts = { GK: 0, DF: 0, MF: 0, FW: 0 }
  for (const player of squadPlayers.value) {
    const position = normalizePosition(player.position)
    if (position) counts[position]++
  }
  return counts
})

const availableCountsBySlot = computed<Record<LineupSlot, number>>(() => {
  const counts = { GK: 0, DF: 0, MF: 0, FW: 0 }
  for (const player of squadPlayers.value) {
    if (!isAvailable(player)) continue
    const position = normalizePosition(player.position)
    if (position) counts[position]++
  }
  return counts
})

/**
 * A line the squad cannot fill with fit players in the current formation.
 *
 * This is what decides whether an injured player becomes selectable. Every
 * formation needs exactly one goalkeeper, so a club whose keepers are all
 * injured could otherwise never name a legal XI — and since the Matchday button
 * is gated on exactly that, no amount of rearranging or changing formation
 * would ever re-enable it.
 */
function slotIsUnfillable(slot: LineupSlot): boolean {
  return availableCountsBySlot.value[slot] < formationRequirements.value[slot]
}

/**
 * Whether *any* formation can be filled from the squad at all, counting injured
 * players as a last resort. False means the club is short of bodies in a slot
 * outright — nothing the builder offers can produce a legal teamsheet, so the
 * emergency path below is the only way out.
 */
const canFieldLegalXi = computed(() =>
  tacticOptions.value.some(tactic =>
    LINEUP_SLOT_ORDER.every(slot => squadCountsBySlot.value[slot] >= tactic.formation[slot])),
)

const pitchRows = computed(() =>
  PITCH_ROW_ORDER.map((position) => {
    const players = selectedSquadPlayers.value.filter(p => normalizePosition(p.position) === position)
    const required = formationRequirements.value[position]

    return {
      position,
      label: PITCH_ROW_LABELS[position],
      selected: players.length,
      required,
      slots: Array.from({ length: Math.max(required, players.length, 1) }, (_, index) => ({
        key: players[index] ? `player-${players[index]!.id}` : `empty-${position}-${index}`,
        player: players[index] ?? null,
        slotNumber: index + 1,
      })),
    }
  }),
)

const lineupIsComplete = computed(() =>
  LINEUP_SLOT_ORDER.every(slot => selectedPositionCounts.value[slot] === formationRequirements.value[slot])
  && selectedSquadPlayers.value.length === LINEUP_SIZE,
)

/** What is still wrong with the teamsheet, in plain language. */
const readinessIssues = computed(() => {
  const issues: string[] = []

  if (!selectedTacticDetails.value) {
    issues.push('Choose a formation')
    return issues
  }

  for (const slot of LINEUP_SLOT_ORDER) {
    const have = selectedPositionCounts.value[slot]
    const need = formationRequirements.value[slot]
    if (have === need) continue

    const missing = Math.abs(need - have)
    const noun = missing === 1 ? POSITION_SINGULAR[slot] : POSITION_LABELS[slot].toLowerCase()

    issues.push(have < need
      ? `Pick ${missing} more ${noun}`
      : `Remove ${missing} ${noun}`)
  }

  const injured = selectedSquadPlayers.value.filter(p => !isAvailable(p))
  if (injured.length)
    issues.push(`${injured.length} selected player${injured.length === 1 ? ' is' : 's are'} injured`)

  return issues
})

const lineupMetrics = computed(() => {
  const players = selectedSquadPlayers.value
  const opponentSquad = (opponentTeam.value?.squad ?? []) as SquadPlayer[]
  const opponentXi = opponentSquad.filter(p => opponentTeam.value?.startingXi?.includes(p.id))
  const opponentSkill = opponentXi.length ? averageOf(opponentXi.map(p => p.skillLevel)) : null

  return [
    {
      label: 'Average Skill',
      icon: 'i-lucide-star',
      value: players.length ? String(averageOf(players.map(p => p.skillLevel))) : '—',
      compare: opponentSkill !== null && players.length
        ? averageOf(players.map(p => p.skillLevel)) - opponentSkill
        : null,
    },
    {
      label: 'Average Stamina',
      icon: 'i-lucide-zap',
      value: players.length ? `${averageOf(players.map(p => p.stamina))}%` : '—',
      compare: null,
    },
    {
      label: 'Average Age',
      icon: 'i-lucide-user',
      value: players.length ? String(averageOf(players.map(p => p.age))) : '—',
      compare: null,
    },
    {
      label: 'Total Value',
      icon: 'i-lucide-banknote',
      value: players.length ? formatMoneyCompact(players.reduce((t, p) => t + p.marketValue, 0)) : '—',
      compare: null,
    },
  ]
})

const leaguePosition = computed(() => {
  if (!standings.value?.length || !team.value) return null
  const index = standings.value.findIndex(row => row.teamName === team.value!.name)
  return index === -1 ? null : index + 1
})

const ownForm = computed(() =>
  team.value ? recentForm(playedFixtures.value ?? [], team.value.id) : [],
)

const injuredCount = computed(() => squadPlayers.value.filter(p => !isAvailable(p)).length)

/** Average skill of each side's projected XI, for the head-to-head bars. */
const headToHead = computed(() => {
  if (!team.value || !opponentTeam.value) return null

  const ourXi = selectedSquadPlayers.value.length
    ? selectedSquadPlayers.value
    : autoSelectLineup(squadPlayers.value, selectedTacticDetails.value?.formation)

  const theirSquad = (opponentTeam.value.squad ?? []) as SquadPlayer[]
  const theirXi = theirSquad.filter(p => opponentTeam.value!.startingXi?.includes(p.id))

  const ours = averageOf(ourXi.map(p => p.skillLevel))
  const theirs = averageOf((theirXi.length ? theirXi : theirSquad.slice(0, 11)).map(p => p.skillLevel))
  const total = ours + theirs

  return {
    ours,
    theirs,
    ourShare: total ? Math.round((ours / total) * 100) : 50,
    theirPosition: standings.value?.findIndex(r => r.teamName === opponentTeam.value!.name) ?? -1,
  }
})

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

function selectionState(player: SquadPlayer) {
  if (selectedPlayerIds.value.has(player.id))
    return { isSelected: true, canSelect: true, reason: null as string | null }

  const position = normalizePosition(player.position)

  if (!isAvailable(player)) {
    const matches = player.injuredMatches ?? 0
    const reason = `Injured for ${matches} more match${matches === 1 ? '' : 'es'}`

    // Injury blocks selection only while a fit alternative for that line
    // exists. Once it doesn't, fielding someone carrying a knock is the only
    // legal teamsheet there is — the same call `autoSelectLineup` already
    // makes for CPU clubs, and the alternative is a squad locked out of
    // playing at all.
    if (!position || !slotIsUnfillable(position))
      return { isSelected: false, canSelect: false, reason }
  }
  if (!position)
    return { isSelected: false, canSelect: false, reason: 'Unknown position' }
  if (!selectedTacticDetails.value)
    return { isSelected: false, canSelect: false, reason: 'Select a formation first' }
  if (selectedSquadPlayers.value.length >= LINEUP_SIZE)
    return { isSelected: false, canSelect: false, reason: 'Teamsheet already full' }
  if (selectedPositionCounts.value[position] >= formationRequirements.value[position])
    return { isSelected: false, canSelect: false, reason: `${POSITION_LABELS[position]} slots are full` }

  return { isSelected: false, canSelect: true, reason: null as string | null }
}

/**
 * Selection feedback is now silent on success — the pitch marker appearing is
 * the feedback. Only a *blocked* tap gets a toast, because that is the case
 * where nothing visible would otherwise happen.
 */
function togglePlayerSelection(player: SquadPlayer) {
  const state = selectionState(player)

  if (state.isSelected) {
    selectedPlayers.value = selectedPlayers.value.filter(id => id !== player.id)
    sfx.play('deselect')
    return
  }

  if (!state.canSelect) {
    sfx.play('error')
    toast.warn({
      title: 'Cannot select that player',
      description: state.reason ?? 'This player cannot be selected right now.',
      duration: 2500,
    })
    return
  }

  selectedPlayers.value = [...selectedPlayers.value, player.id]
  sfx.play('select')
}

function autoPick() {
  const xi = autoSelectLineup(squadPlayers.value, selectedTacticDetails.value?.formation)
  const previous = [...selectedPlayers.value]
  selectedPlayers.value = xi.map(player => player.id)
  sfx.play('success')

  toast.undoable({
    title: 'Best available XI selected',
    description: `${xi.length} players picked for ${selectedTactic.value}.`,
    onUndo: () => { selectedPlayers.value = previous },
  })
}

function clearLineup() {
  if (!selectedPlayers.value.length) return
  const previous = [...selectedPlayers.value]
  selectedPlayers.value = []
  sfx.play('deselect')

  toast.undoable({
    title: 'Teamsheet cleared',
    onUndo: () => { selectedPlayers.value = previous },
  })
}

// ---- Drag and drop ----

const dragSlot = computed(() =>
  draggedPlayer.value ? normalizePosition(draggedPlayer.value.position) : null,
)

function onDragStart(player: SquadPlayer) {
  draggedPlayer.value = player
}

function onDragEnd() {
  draggedPlayer.value = null
}

function onPitchDrop({ playerId }: { playerId: number; slot: LineupSlot }) {
  const player = squadPlayers.value.find(p => p.id === playerId)
  draggedPlayer.value = null
  if (!player || selectedPlayerIds.value.has(playerId)) return

  const state = selectionState(player)
  if (!state.canSelect) {
    toast.warn({ title: 'Cannot select that player', description: state.reason ?? '', duration: 2500 })
    return
  }

  selectedPlayers.value = [...selectedPlayers.value, playerId]
  sfx.play('select')
}

// ---------------------------------------------------------------------------
// Hydration and persistence
// ---------------------------------------------------------------------------

const lineupHydrated = ref(false)

watch([tacticOptions, team], ([availableTactics, currentTeam]) => {
  // Initialise the formation and XI as one saved combination. Tactics can
  // resolve before the team request; choosing the first option in that gap
  // permanently left a saved 4-3-3 XI displayed against the default 4-4-2.
  if (!availableTactics.length || !currentTeam || lineupHydrated.value) return

  selectedTactic.value = availableTactics.find(t => t.name === currentTeam.tactics)?.name
    ?? availableTactics.find(t => t.name === DEFAULT_TACTIC_NAME)?.name
    ?? availableTactics[0]?.name
    ?? ''

  const saved = parseLineup(currentTeam.lineup)
  if (saved) selectedPlayers.value = saved
  lineupHydrated.value = true
}, { immediate: true })

/**
 * A formation change invalidates the position limits, so the XI has to go.
 * That used to happen instantly with only a toast to explain it; now it asks
 * first, and only when there is actually something to lose.
 */
function requestTacticChange(name: string) {
  if (name === selectedTactic.value) return

  if (!selectedPlayers.value.length) {
    selectedTactic.value = name
    return
  }

  pendingTactic.value = name
  formationConfirmOpen.value = true
}

function confirmTacticChange() {
  if (!pendingTactic.value) return

  const previousPlayers = [...selectedPlayers.value]
  const previousTactic = selectedTactic.value

  selectedTactic.value = pendingTactic.value
  selectedPlayers.value = []
  formationConfirmOpen.value = false
  pendingTactic.value = null

  toast.undoable({
    title: `Formation set to ${selectedTactic.value}`,
    description: 'The previous teamsheet was cleared.',
    onUndo: () => {
      selectedTactic.value = previousTactic
      selectedPlayers.value = previousPlayers
    },
  })
}

async function persistTeamSheet(): Promise<boolean> {
  if (!team.value) return false

  try {
    await $fetch(`/api/team/${team.value.id}/tactics`, {
      method: 'PUT',
      body: { tactics: selectedTactic.value },
    })
    await $fetch(`/api/team/${team.value.id}/lineup`, {
      method: 'PUT',
      body: { lineup: selectedPlayers.value },
    })
    await refreshTeam()
    return true
  }
  catch (error) {
    toast.fromRequestError(error, 'Could not save your team sheet')
    return false
  }
}

async function saveOnly() {
  if (!lineupIsComplete.value) {
    toast.warn({ title: 'Teamsheet incomplete', description: readinessIssues.value.join(' · ') })
    return
  }

  saving.value = true
  const ok = await persistTeamSheet()
  saving.value = false

  if (ok) {
    toast.success({ title: 'Team sheet saved', description: `${selectedTactic.value} with ${LINEUP_SIZE} players.` })
  }
}

async function goToMatchday() {
  if (!team.value) {
    toast.error({ title: 'Team data not loaded', description: 'Please refresh the page.' })
    return
  }
  if (!lineupIsComplete.value) {
    toast.warn({ title: 'Teamsheet incomplete', description: readinessIssues.value.join(' · ') })
    return
  }

  saving.value = true
  // Persist both, so Matchday and the engine field the XI that was picked
  // here. Navigating on a failed save would silently field a different XI.
  const ok = await persistTeamSheet()
  saving.value = false

  if (ok) navigateTo('/matchday')
}

/**
 * The way out when the squad is short of a position outright — no fit keeper,
 * or fewer bodies in a line than any formation asks for.
 *
 * The gate above insists on slot counts matching exactly, which is right while
 * the squad *can* meet them and a dead end once it can't: the fixture still has
 * to be played, and there is no other route to Matchday. `autoSelectLineup` is
 * the same fallback the engine applies to every CPU club — best fit players
 * first, then whoever is left — so this fields the strongest legal side
 * available rather than refusing to field one.
 */
async function fieldEmergencyXi() {
  if (!team.value) return

  const xi = autoSelectLineup(squadPlayers.value, selectedTacticDetails.value?.formation)
  selectedPlayers.value = xi.map(player => player.id)

  saving.value = true
  const ok = await persistTeamSheet()
  saving.value = false

  if (ok) navigateTo('/matchday')
}

// ---------------------------------------------------------------------------
// Squad table
// ---------------------------------------------------------------------------

// Destructured so the template gets plain top-level refs; nested refs on a
// returned object are not auto-unwrapped in templates.
const {
  slot: filterSlot,
  search: filterSearch,
  availableOnly: filterAvailableOnly,
  freshOnly: filterFreshOnly,
  sort: filterSort,
  tabs: filterTabs,
  filtered: filteredSquad,
  isFiltered,
  reset: resetFilters,
} = useSquadFilters(squadPlayers)

const lineupColumns = [
  {
    accessorKey: 'name',
    id: 'name',
    header: sortableHeader('Name'),
    cell: ({ row }: { row: any }) => {
      const player = row.original as SquadPlayer
      const isSelected = selectedPlayerIds.value.has(player.id)
      const injuredMatches = player.injuredMatches ?? 0

      return h('div', {
        class: 'flex items-center gap-2',
        draggable: !injuredMatches && !isSelected,
        onDragstart: (event: DragEvent) => {
          event.dataTransfer?.setData('text/plain', String(player.id))
          onDragStart(player)
        },
        onDragend: onDragEnd,
      }, [
        h('span', {
          class: injuredMatches
            ? 'font-medium app-player-out'
            : isSelected ? 'font-semibold' : 'font-medium cursor-grab',
          style: isSelected ? 'color: var(--app-accent)' : undefined,
        }, player.name),
        injuredMatches
          ? h(UBadge, { label: `Injured · ${injuredMatches}`, icon: 'i-lucide-bandage', color: 'error', variant: 'soft', size: 'sm' })
          : null,
        isSelected
          ? h('span', { class: 'app-selection-pill' }, 'Selected')
          : null,
      ])
    },
  },
  { accessorKey: 'age', id: 'age', header: sortableHeader('Age') },
  {
    accessorKey: 'position',
    id: 'position',
    header: sortableHeader('Position'),
    sortingFn: positionSortingFn,
    cell: ({ row }: { row: any }) => h(resolveComponent('AppPositionBadge'), { position: row.original.position }),
  },
  {
    accessorKey: 'skillLevel',
    id: 'skillLevel',
    header: sortableHeader('Skill'),
    cell: ({ row }: { row: any }) =>
      h(resolveComponent('AppStatBar'), { value: row.original.skillLevel ?? 0, showValue: true, class: 'min-w-28' }),
  },
  {
    accessorKey: 'stamina',
    id: 'stamina',
    header: sortableHeader('Stamina'),
    cell: ({ row }: { row: any }) =>
      h(resolveComponent('AppStatBar'), {
        value: row.original.stamina ?? 0,
        showValue: true,
        percent: true,
        threshold: true,
        class: 'min-w-28',
      }),
  },
  {
    accessorKey: 'marketValue',
    id: 'marketValue',
    header: sortableHeader('Market Value'),
    cell: ({ row }: { row: any }) => formatMoney(row.original.marketValue),
  },
  {
    id: 'actions',
    header: 'Actions',
    cell: ({ row }: { row: any }) => {
      const player = row.original as SquadPlayer
      const state = selectionState(player)

      return h(resolveComponent('UButton'), {
        color: state.isSelected ? 'success' : 'primary',
        variant: state.isSelected ? 'soft' : state.canSelect ? 'solid' : 'outline',
        size: 'xs',
        icon: state.isSelected ? 'i-lucide-check' : state.canSelect ? 'i-lucide-plus' : 'i-lucide-ban',
        disabled: !state.isSelected && !state.canSelect,
        title: state.reason ?? undefined,
        label: state.isSelected ? 'Selected' : state.canSelect ? 'Select' : 'Unavailable',
        onClick: () => togglePlayerSelection(player),
      })
    },
  },
]
</script>

<template>
  <div class="space-y-4 sm:space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="app-page-title flex items-center gap-2">
        <UIcon name="i-lucide-layout-dashboard" class="size-6" style="color: var(--app-accent)" />
        Dashboard
      </h1>
      <div class="flex flex-wrap items-center gap-2">
        <span v-if="seasonStatus?.totalRounds" class="app-chip">
          <UIcon name="i-lucide-flag" class="size-3" />
          Round {{ seasonStatus.round }} of {{ seasonStatus.totalRounds }}
        </span>
        <span v-if="gameState" class="app-chip">
          <UIcon name="i-lucide-calendar-days" class="size-3" />
          {{ formatMatchDate(gameState.currentDate) }} · Season {{ gameState.season }}
        </span>
      </div>
    </div>

    <AppSkeleton v-if="!team" variant="card" />

    <template v-else>
      <!-- Club status + next fixture -->
      <div class="grid animate-fade-in-up gap-4 md:grid-cols-2">
        <UCard class="app-surface">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-chart-no-axes-combined" class="size-4" style="color: var(--app-accent)" />
              Club Status
            </div>
          </template>

          <div class="grid grid-cols-2 gap-3">
            <div class="app-metric-card">
              <div class="mb-1 flex items-center justify-center gap-1.5">
                <UIcon name="i-lucide-trophy" class="size-3.5" style="color: var(--app-gold)" />
                <p class="app-kicker text-[10px]">League Position</p>
              </div>
              <p class="app-hero-number text-2xl">{{ leaguePosition ?? '—' }}</p>
              <p
                v-if="seasonStatus?.pointsBehindLeader !== null && seasonStatus?.pointsBehindLeader !== undefined"
                class="mt-1 truncate text-[11px]"
                :style="{ color: seasonStatus.pointsBehindLeader === 0 ? 'var(--app-accent)' : 'var(--app-text-muted)' }"
              >
                {{ seasonStatus.pointsBehindLeader === 0
                  ? 'Top of the league'
                  : `${seasonStatus.pointsBehindLeader} behind ${seasonStatus.leader?.teamName}` }}
              </p>
            </div>

            <div class="app-metric-card">
              <div class="mb-1 flex items-center justify-center gap-1.5">
                <UIcon name="i-lucide-wallet" class="size-3.5" style="color: var(--app-accent)" />
                <p class="app-kicker text-[10px]">Bank Balance</p>
              </div>
              <AppCountUp
                :value="team.bankBalance ?? 0"
                :format="formatMoneyCompact"
                class="app-hero-number text-2xl"
              />
            </div>

            <div class="app-metric-card">
              <div class="mb-1 flex items-center justify-center gap-1.5">
                <UIcon name="i-lucide-users" class="size-3.5" style="color: var(--app-text-muted)" />
                <p class="app-kicker text-[10px]">Squad</p>
              </div>
              <p class="app-hero-number text-2xl">{{ team.squad.length }}</p>
              <p v-if="injuredCount" class="mt-1 text-[11px]" style="color: var(--app-player-injured)">
                {{ injuredCount }} injured
              </p>
            </div>

            <div class="app-metric-card">
              <div class="mb-1 flex items-center justify-center gap-1.5">
                <UIcon name="i-lucide-activity" class="size-3.5" style="color: var(--app-text-muted)" />
                <p class="app-kicker text-[10px]">Recent Form</p>
              </div>
              <FormGuide :form="ownForm" class="mt-1.5 justify-center" />
            </div>

            <div v-if="board" class="app-metric-card">
              <div class="mb-1.5 flex items-center justify-center gap-1.5">
                <UIcon name="i-lucide-gavel" class="size-3.5" style="color: var(--app-text-muted)" />
                <p class="app-kicker text-[10px]">Board</p>
              </div>
              <AppStatBar
                :value="board.boardConfidence"
                show-value
                :tone="board.boardConfidence <= board.sackThreshold
                  ? 'danger'
                  : board.boardConfidence <= board.warningThreshold ? 'warning' : 'default'"
              />
            </div>

            <div v-if="board" class="app-metric-card">
              <div class="mb-1.5 flex items-center justify-center gap-1.5">
                <UIcon name="i-lucide-heart" class="size-3.5" style="color: var(--app-text-muted)" />
                <p class="app-kicker text-[10px]">Supporters</p>
              </div>
              <AppStatBar
                :value="board.fanConfidence"
                show-value
                :tone="board.fanConfidence <= board.sackThreshold
                  ? 'danger'
                  : board.fanConfidence <= board.warningThreshold ? 'warning' : 'default'"
              />
            </div>
          </div>

          <template #footer>
            <div class="space-y-1.5">
              <p v-if="board" class="app-muted-text text-xs">
                The board want you to <strong style="color: var(--app-text-soft)">{{ board.expectationText }}</strong>.
              </p>
              <p
                v-if="boardWarning"
                class="flex items-start gap-1.5 text-[11px] font-semibold"
                :style="{ color: board.boardConfidence <= board.sackThreshold
                  ? 'var(--app-player-sent-off)'
                  : 'var(--app-player-booked)' }"
              >
                <UIcon name="i-lucide-circle-alert" class="mt-px size-3 shrink-0" />
                {{ boardWarning }}
              </p>
            </div>
          </template>
        </UCard>

        <!-- Season over: there is no next fixture, so point at the rollover. -->
        <UCard v-if="seasonStatus?.complete" class="app-elevated">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-trophy" class="size-4" style="color: var(--app-gold)" />
              Season {{ seasonStatus.season }} complete
            </div>
          </template>

          <div class="space-y-2 text-center">
            <p class="app-hero-number text-3xl">
              {{ seasonStatus.playerPosition ?? '—' }}<span class="text-lg" style="color: var(--app-text-muted)">
                {{ seasonStatus.playerPosition === 1 ? 'st' : seasonStatus.playerPosition === 2 ? 'nd' : seasonStatus.playerPosition === 3 ? 'rd' : 'th' }}
              </span>
            </p>
            <p class="app-muted-text text-sm">
              Final position on {{ seasonStatus.playerPoints ?? 0 }} points.
            </p>
          </div>

          <template #footer>
            <UButton
              to="/game/season-end"
              class="app-glow w-full justify-center"
              size="lg"
              label="End of season"
              icon="i-lucide-trophy"
            />
          </template>
        </UCard>

        <!-- Next match, with a real head-to-head -->
        <UCard v-else-if="nextMatch" class="app-elevated">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-swords" class="size-4" style="color: var(--app-player-injured)" />
              Next Match
              <span class="app-chip ml-auto">{{ isHomeFixture ? 'Home' : 'Away' }}</span>
            </div>
          </template>

          <div class="space-y-4">
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <p class="app-kicker text-[10px]">Opponent</p>
                <p class="truncate text-lg font-bold" style="color: var(--app-text)">
                  {{ opponentTeam?.name ?? '…' }}
                </p>
                <p class="app-muted-text text-xs">{{ formatMatchDate(nextMatch.matchDate) }}</p>
              </div>
              <div
                v-if="headToHead && headToHead.theirPosition >= 0"
                class="app-metric-card shrink-0 px-3 py-2 text-center"
              >
                <p class="app-kicker text-[9px]">Their rank</p>
                <p class="text-lg font-bold" style="color: var(--app-text)">{{ headToHead.theirPosition + 1 }}</p>
              </div>
            </div>

            <div v-if="headToHead">
              <div class="mb-1.5 flex items-center justify-between text-xs">
                <span class="font-bold tabular-nums" style="color: var(--app-accent)">{{ headToHead.ours }}</span>
                <span class="app-kicker text-[10px]">Average XI skill</span>
                <span class="font-bold tabular-nums" style="color: var(--app-pos-gk)">{{ headToHead.theirs }}</span>
              </div>
              <div class="flex h-2 overflow-hidden rounded-full" style="background-color: var(--app-surface-muted)">
                <div
                  class="transition-all duration-700"
                  :style="{ width: `${headToHead.ourShare}%`, backgroundColor: 'var(--app-accent)' }"
                />
                <div class="flex-1" style="background-color: var(--app-pos-gk)" />
              </div>
              <p class="app-muted-text mt-1.5 text-[11px]">
                {{ headToHead.ours > headToHead.theirs
                  ? 'You field the stronger side on paper.'
                  : headToHead.ours < headToHead.theirs
                    ? 'They field the stronger side on paper.'
                    : 'Evenly matched on paper.' }}
              </p>
            </div>
          </div>

          <template #footer>
            <div class="space-y-2">
              <UButton
                class="w-full justify-center"
                :class="lineupIsComplete && 'app-glow'"
                size="lg"
                label="Go to Matchday"
                icon="i-lucide-play"
                :loading="saving"
                :disabled="!lineupIsComplete"
                @click="goToMatchday"
              />
              <UButton
                v-if="!canFieldLegalXi && !lineupIsComplete"
                class="w-full justify-center"
                size="lg"
                color="warning"
                variant="soft"
                label="Field an emergency XI"
                icon="i-lucide-triangle-alert"
                :loading="saving"
                @click="fieldEmergencyXi"
              />
              <p
                v-if="!canFieldLegalXi"
                class="text-[11px]"
                style="color: var(--app-player-booked)"
              >
                Your squad is short in a position every formation needs. The best available eleven
                will be picked for you.
              </p>
              <ul v-if="readinessIssues.length" class="space-y-0.5">
                <li
                  v-for="issue in readinessIssues"
                  :key="issue"
                  class="flex items-center gap-1.5 text-[11px]"
                  style="color: var(--app-player-booked)"
                >
                  <UIcon name="i-lucide-circle-alert" class="size-3 shrink-0" />
                  {{ issue }}
                </li>
              </ul>
              <p v-else class="flex items-center gap-1.5 text-[11px]" style="color: var(--app-accent)">
                <UIcon name="i-lucide-circle-check" class="size-3 shrink-0" />
                Team sheet ready
              </p>
            </div>
          </template>
        </UCard>
      </div>

      <!-- Lineup builder -->
      <UCard class="app-surface">
        <div class="grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
          <div class="space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p class="app-kicker">Lineup Builder</p>
                <h2 class="text-xl font-semibold" style="color: var(--app-text)">
                  {{ selectedSquadPlayers.length }}/{{ LINEUP_SIZE }} selected
                </h2>
              </div>
              <span
                class="app-status-pill"
                :class="lineupIsComplete ? 'app-status-pill--success' : 'app-status-pill--warning'"
              >
                {{ lineupIsComplete ? 'Lineup ready' : 'Incomplete lineup' }}
              </span>
            </div>

            <LineupPitch
              :rows="pitchRows"
              :drag-slot="dragSlot"
              @remove="togglePlayerSelection"
              @drop="onPitchDrop"
              @drag-start="onDragStart"
              @drag-end="onDragEnd"
            />
          </div>

          <div class="space-y-4">
            <div class="app-surface-subtle space-y-3 p-4">
              <p class="app-kicker">Formation</p>
              <div class="grid grid-cols-2 gap-2">
                <button
                  v-for="tactic in tacticOptions"
                  :key="tactic.name"
                  type="button"
                  class="rounded-xl border p-2.5 text-left transition hover:-translate-y-0.5"
                  :style="selectedTactic === tactic.name
                    ? { borderColor: 'var(--app-accent)', backgroundColor: 'var(--app-accent-soft)' }
                    : { borderColor: 'var(--app-surface-border)', backgroundColor: 'var(--app-surface-muted)' }"
                  :aria-pressed="selectedTactic === tactic.name"
                  @click="requestTacticChange(tactic.name)"
                >
                  <p
                    class="text-sm font-bold"
                    :style="{ color: selectedTactic === tactic.name ? 'var(--app-accent)' : 'var(--app-text)' }"
                  >{{ tactic.name }}</p>
                  <p class="app-muted-text text-[10px]">
                    {{ tactic.formation.DF }}-{{ tactic.formation.MF }}-{{ tactic.formation.FW }}
                  </p>
                </button>
              </div>
              <p class="app-muted-text text-xs">Player selection is limited by this formation.</p>
            </div>

            <div class="app-surface-subtle space-y-2 p-4">
              <p class="app-kicker">Teamsheet</p>
              <UButton
                block
                label="Auto-pick best XI"
                icon="i-lucide-wand-sparkles"
                color="primary"
                variant="soft"
                @click="autoPick"
              />
              <UButton
                block
                label="Save without playing"
                icon="i-lucide-save"
                color="neutral"
                variant="soft"
                :loading="saving"
                :disabled="!lineupIsComplete"
                @click="saveOnly"
              />
              <UButton
                block
                label="Clear teamsheet"
                icon="i-lucide-eraser"
                color="neutral"
                variant="ghost"
                :disabled="!selectedPlayers.length"
                @click="clearLineup"
              />
            </div>

            <div class="app-surface-subtle space-y-3 p-4">
              <p class="app-kicker">Selected Squad Metrics</p>
              <div class="grid gap-2.5 sm:grid-cols-2">
                <div v-for="metric in lineupMetrics" :key="metric.label" class="app-metric-card">
                  <div class="mb-1 flex items-center justify-center gap-1.5">
                    <UIcon :name="metric.icon" class="size-3.5" style="color: var(--app-text-muted)" />
                    <p class="app-kicker text-[10px]">{{ metric.label }}</p>
                  </div>
                  <p class="text-xl font-semibold" style="color: var(--app-text)">{{ metric.value }}</p>
                  <p
                    v-if="metric.compare !== null"
                    class="mt-0.5 text-[11px] font-semibold"
                    :style="{ color: metric.compare >= 0 ? 'var(--app-accent)' : 'var(--app-player-sent-off)' }"
                  >
                    {{ metric.compare >= 0 ? '+' : '' }}{{ metric.compare }} vs opponent
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </UCard>

      <!-- Squad -->
      <UCard class="app-surface">
        <template #header>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-users" class="size-4" style="color: var(--app-accent)" />
              {{ team.name }} Squad
            </div>
          </div>
        </template>

        <div class="space-y-3">
          <SquadFilters
            v-model:slot="filterSlot"
            v-model:search="filterSearch"
            v-model:available-only="filterAvailableOnly"
            v-model:fresh-only="filterFreshOnly"
            v-model:sort="filterSort"
            :tabs="filterTabs"
            :result-count="filteredSquad.length"
            :is-filtered="isFiltered"
            show-availability
            @reset="resetFilters"
          />

          <p class="app-muted-text text-sm">
            Drag a player onto the pitch, or use Select. Tap a marker on the pitch to remove them.
          </p>

          <div v-if="filteredSquad.length" class="app-table-shell">
            <div class="min-w-max">
              <UTable :data="filteredSquad" :columns="lineupColumns" />
            </div>
          </div>

          <AppEmptyState
            v-else
            compact
            icon="i-lucide-search-x"
            title="No players match those filters"
            action-label="Clear filters"
            @action="resetFilters"
          />
        </div>
      </UCard>
    </template>

    <AppConfirmModal
      :open="formationConfirmOpen"
      tone="warning"
      icon="i-lucide-refresh-cw"
      title="Change formation?"
      :description="`Switching to ${pendingTactic} changes how many players each position needs.`"
      confirm-label="Change formation"
      confirm-icon="i-lucide-check"
      @confirm="confirmTacticChange"
      @cancel="formationConfirmOpen = false; pendingTactic = null"
    >
      <template #consequences>
        <p style="color: var(--app-text-soft)">
          Your current teamsheet of
          <strong style="color: var(--app-text)">{{ selectedPlayers.length }} players</strong>
          will be cleared so the new position limits apply cleanly.
        </p>
        <p class="app-muted-text mt-1 text-xs">You can undo this straight afterwards.</p>
      </template>
    </AppConfirmModal>
  </div>
</template>
