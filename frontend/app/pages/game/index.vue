<script setup lang="ts">
import { UBadge, UButton } from '#components'
import { ref, computed, h, onMounted, watch } from 'vue'
import { useToast } from '#imports'

type LineupPosition = 'GK' | 'DF' | 'MF' | 'FW'

interface SquadPlayer {
  id: number
  name: string
  age: number
  position: string
  skillLevel: number
  stamina: number
  marketValue: number
  teamId: number
}

interface TacticOption {
  name: string
  formation: Record<LineupPosition, number>
  modifiers: { attack: number; defence: number }
}

const POSITION_ORDER: LineupPosition[] = ['GK', 'DF', 'MF', 'FW']
const PITCH_ROW_ORDER: LineupPosition[] = ['FW', 'MF', 'DF', 'GK']
const POSITION_LABELS: Record<LineupPosition, string> = {
  GK: 'Goalkeepers',
  DF: 'Defenders',
  MF: 'Midfielders',
  FW: 'Forwards',
}
const PITCH_ROW_LABELS: Record<LineupPosition, string> = {
  FW: 'Forward Line',
  MF: 'Midfield Line',
  DF: 'Defensive Line',
  GK: 'Goalkeeper',
}

const toast = useToast()

function normalizePosition(position: string): LineupPosition | null {
  const normalized = String(position ?? '').toUpperCase().trim()

  if (['GOALKEEPER', 'GK'].includes(normalized))
    return 'GK'

  if (['DEFENDER', 'DEF', 'DF'].includes(normalized))
    return 'DF'

  if (['MIDFIELDER', 'MID', 'MF'].includes(normalized))
    return 'MF'

  if (['FORWARD', 'ATTACKER', 'ATT', 'FW'].includes(normalized))
    return 'FW'

  return null
}

function averageValue(values: number[]) {
  if (!values.length)
    return 0

  return Math.round(values.reduce((total, value) => total + value, 0) / values.length)
}

function getPlayerInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? '')
    .join('')
}

const { data: gameState, refresh: refreshGameState } = useFetch('/api/game/state')
const { data: team, refresh: refreshTeam } = useFetch(() => `/api/team/${gameState.value?.playerTeamId}`, {
  immediate: !!gameState.value?.playerTeamId,
})
const { data: standings, refresh: refreshStandings } = useFetch(() => `/api/standings?leagueId=${team.value?.leagueId ?? ''}`, {
  immediate: !!team.value?.leagueId,
})
const { data: schedule, refresh: refreshSchedule } = useFetch('/api/schedule')
const { data: tacticsList, refresh: refreshTactics } = useFetch('/api/tactics')

const nextMatch = computed(() => schedule.value?.[0])

const leaguePosition = computed(() => {
  if (!standings.value || !team.value) return null
  // standings is an array sorted by points desc, goalDifference desc
  const idx = (standings.value as any[]).findIndex(s => s.teamName === team.value!.name)
  return idx === -1 ? null : idx + 1
})

// fetch opponent team by nextMatch awayTeamId (declared after nextMatch so computed is available)
const { data: opponentTeam, refresh: refreshOpponent } = useFetch(() => `/api/team/${nextMatch.value?.awayTeamId}`, {
  immediate: !!nextMatch.value?.awayTeamId,
})

const selectedTactic = ref('')
const selectedPlayers = ref<number[]>([])

const squadPlayers = computed(() => (team.value?.squad ?? []) as SquadPlayer[])
const selectedPlayerIds = computed(() => new Set(selectedPlayers.value))
const tacticOptions = computed(() => ((tacticsList.value ?? []) as TacticOption[]))
const selectedTacticDetails = computed(() => {
  return tacticOptions.value.find(tactic => tactic.name === selectedTactic.value) ?? tacticOptions.value[0] ?? null
})

const formationRequirements = computed<Record<LineupPosition, number>>(() => {
  return selectedTacticDetails.value?.formation ?? { GK: 0, DF: 0, MF: 0, FW: 0 }
})

const selectedSquadPlayers = computed(() => {
  return squadPlayers.value
    .filter(player => selectedPlayerIds.value.has(player.id))
    .sort((left, right) => {
      const leftPosition = normalizePosition(left.position) ?? 'FW'
      const rightPosition = normalizePosition(right.position) ?? 'FW'
      const positionDiff = POSITION_ORDER.indexOf(leftPosition) - POSITION_ORDER.indexOf(rightPosition)

      if (positionDiff !== 0)
        return positionDiff

      return right.skillLevel - left.skillLevel
    })
})

const selectedPositionCounts = computed<Record<LineupPosition, number>>(() => {
  const counts = { GK: 0, DF: 0, MF: 0, FW: 0 }

  for (const player of selectedSquadPlayers.value) {
    const position = normalizePosition(player.position)
    if (position)
      counts[position]++
  }

  return counts
})

const lineupSections = computed(() => {
  return POSITION_ORDER.map((position) => ({
    position,
    label: POSITION_LABELS[position],
    required: formationRequirements.value[position],
    selected: selectedPositionCounts.value[position],
    players: selectedSquadPlayers.value.filter(player => normalizePosition(player.position) === position),
  }))
})

const pitchRows = computed(() => {
  return PITCH_ROW_ORDER.map((position) => {
    const players = selectedSquadPlayers.value.filter(player => normalizePosition(player.position) === position)
    const required = formationRequirements.value[position]

    return {
      position,
      label: PITCH_ROW_LABELS[position],
      selected: players.length,
      required,
      slots: Array.from({ length: Math.max(required, 1) }, (_, index) => ({
        key: players[index] ? `player-${players[index].id}` : `empty-${position}-${index}`,
        player: players[index] ?? null,
        slotNumber: index + 1,
      })),
    }
  })
})

const lineupIsComplete = computed(() => {
  return POSITION_ORDER.every(position => selectedPositionCounts.value[position] === formationRequirements.value[position])
    && selectedSquadPlayers.value.length === 11
})

const lineupSummaryText = computed(() => {
  return lineupSections.value
    .map(section => `${section.label} ${section.selected}/${section.required}`)
    .join(' | ')
})

const lineupMetrics = computed(() => {
  const players = selectedSquadPlayers.value

  return [
    {
      label: 'Average Skill',
      icon: 'i-lucide-star',
      value: players.length ? averageValue(players.map(player => player.skillLevel)).toString() : '—',
    },
    {
      label: 'Average Stamina',
      icon: 'i-lucide-zap',
      value: players.length ? `${averageValue(players.map(player => player.stamina))}%` : '—',
    },
    {
      label: 'Average Age',
      icon: 'i-lucide-user',
      value: players.length ? averageValue(players.map(player => player.age)).toString() : '—',
    },
    {
      label: 'Total Value',
      icon: 'i-lucide-banknote',
      value: players.length ? formatMoney(players.reduce((total, player) => total + player.marketValue, 0)) : '—',
    },
  ]
})

function getSelectionState(player: SquadPlayer) {
  const isSelected = selectedPlayerIds.value.has(player.id)
  const position = normalizePosition(player.position)

  if (isSelected) {
    return {
      isSelected: true,
      canSelect: true,
      reason: null as string | null,
    }
  }

  if (!position) {
    return {
      isSelected: false,
      canSelect: false,
      reason: 'Unknown position',
    }
  }

  if (!selectedTacticDetails.value) {
    return {
      isSelected: false,
      canSelect: false,
      reason: 'Select a tactic first',
    }
  }

  if (selectedSquadPlayers.value.length >= 11) {
    return {
      isSelected: false,
      canSelect: false,
      reason: 'Lineup full',
    }
  }

  if (selectedPositionCounts.value[position] >= formationRequirements.value[position]) {
    return {
      isSelected: false,
      canSelect: false,
      reason: `${POSITION_LABELS[position]} full`,
    }
  }

  return {
    isSelected: false,
    canSelect: true,
    reason: null as string | null,
  }
}

function togglePlayerSelection(player: SquadPlayer) {
  const selectionState = getSelectionState(player)

  if (selectionState.isSelected) {
    selectedPlayers.value = selectedPlayers.value.filter(id => id !== player.id)
    toast.add({
      color: 'error',
      icon: 'i-lucide-octagon-x',
      title: 'Player removed',
      description: `You removed ${player.name} from the lineup.`,
      duration: 800,
    })
    return
  }

  if (!selectionState.canSelect) {
    toast.add({
      color: 'warning',
      icon: 'i-lucide-triangle-alert',
      title: 'Selection blocked',
      description: selectionState.reason ?? 'This player cannot be selected right now.',
      duration: 1200,
    })
    return
  }

  selectedPlayers.value = [...selectedPlayers.value, player.id]
  toast.add({
    color: 'success',
    icon: 'i-lucide-check',
    title: 'Player selected',
    description: `${player.name} added to the lineup.`,
    duration: 800,
  })
}

watch([tacticOptions, team], ([availableTactics, currentTeam]) => {
  if (!availableTactics.length || selectedTactic.value)
    return

  const preferredTactic = availableTactics.find(tactic => tactic.name === currentTeam?.tactics)?.name
    ?? availableTactics[0]?.name
    ?? ''

  if (preferredTactic)
    selectedTactic.value = preferredTactic
}, { immediate: true })

watch(selectedTactic, (newValue, oldValue) => {
  if (!oldValue || newValue === oldValue || !selectedPlayers.value.length)
    return

  selectedPlayers.value = []
  toast.add({
    title: 'Lineup reset',
    description: 'Changing formation clears the current lineup so the new position limits apply cleanly.',
    color: 'info',
    icon: 'i-lucide-refresh-cw',
  })
})

async function confirmTacticAndSimulate() {
  if (!team.value) {
    toast.add({
      title: 'Team data not loaded',
      description: 'Please refresh the page.',
      color: 'error',
    })
  } else if (!selectedTacticDetails.value) {
    toast.add({
      title: 'No tactic selected',
      description: 'Please select a tactic.',
      color: 'error',
    })
  } else if (!lineupIsComplete.value) {
    toast.add({
      color: 'error',
      icon: 'i-lucide-octagon-x',
      title: 'Invalid lineup',
      description: lineupSummaryText.value,
    })
  } else {
    // Save tactic
    await $fetch(`/api/team/${team.value.id}/tactics`, {
      method: 'PUT',
      body: { tactics: selectedTactic.value },
    })
    navigateTo('/matchday')
  }
}

async function playNextMatch() {
  try {
    const result = await $fetch('/api/match/simulate', { method: 'POST', body: { teamId: team.value?.id, opponentId: nextMatch.value?.awayTeamId, tactic: selectedTactic.value, lineup: selectedPlayers.value } })
    await refreshSchedule()
    // refresh opponent info after schedule updates
    await refreshOpponent()
    await refreshTeam()
    // refresh standings so league position updates after the match
    await refreshStandings()
    if (
      result &&
      typeof (result as any).homeScore !== 'undefined' &&
      typeof (result as any).awayScore !== 'undefined'
    ) {
      toast.add({
        title: 'Match Result',
        description: `${(result as any).homeScore} - ${(result as any).awayScore}`,
        color: 'info',
      })
    } else if (result && (result as any).message) {
      toast.add({
        title: 'Match Simulation Error',
        description: (result as any).message,
        color: 'info',
      })
    }
  } catch (e) {
    toast.add({
      title: 'Error',
      description: 'Error simulating match.',
      color: 'error',
    })
  }
}

function formatMoney(value: number) {
  return value?.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) ?? ''
}

const lineupColumns = [
  {
    accessorKey: 'name', id: 'name',
    header: ({ column }: { column: any }) => {
      const isSorted = column.getIsSorted()
      return h(UButton, {
        color: 'neutral',
        variant: 'ghost',
        label: 'Name',
        icon: isSorted
          ? isSorted === 'asc'
            ? 'i-lucide-arrow-up-narrow-wide'
            : 'i-lucide-arrow-down-wide-narrow'
          : 'i-lucide-arrow-up-down',
        class: '-mx-2.5',
        onClick: () => column.toggleSorting(column.getIsSorted() === 'asc')
      })
    }
    ,
    cell: ({ row }: { row: any }) => {
      const player = row.original as SquadPlayer
      const isSelected = selectedPlayerIds.value.has(player.id)

      return h('div', { class: 'flex items-center gap-2' }, [
        h('span', { class: isSelected ? 'font-semibold text-primary-600' : 'font-medium' }, player.name),
        isSelected
          ? h(UBadge, {
              label: 'Selected',
              color: 'success',
              variant: 'soft',
              size: 'sm',
              class: 'app-selection-pill',
            })
          : null,
      ])
    }
  },
  {
    accessorKey: 'age', id: 'age',
    header: ({ column }: { column: any }) => {
      const isSorted = column.getIsSorted()
      return h(UButton, {
        color: 'neutral',
        variant: 'ghost',
        label: 'Age',
        icon: isSorted
          ? isSorted === 'asc'
            ? 'i-lucide-arrow-up-narrow-wide'
            : 'i-lucide-arrow-down-wide-narrow'
          : 'i-lucide-arrow-up-down',
        class: '-mx-2.5',
        onClick: () => column.toggleSorting(column.getIsSorted() === 'asc')
      })
    }
  },
  {
    accessorKey: 'position', id: 'position',
    header: ({ column }: { column: any }) => {
      const isSorted = column.getIsSorted()
      return h(UButton, {
        color: 'neutral',
        variant: 'ghost',
        label: 'Position',
        icon: isSorted
          ? isSorted === 'asc'
            ? 'i-lucide-arrow-up-narrow-wide'
            : 'i-lucide-arrow-down-wide-narrow'
          : 'i-lucide-arrow-up-down',
        class: '-mx-2.5',
        onClick: () => column.toggleSorting(column.getIsSorted() === 'asc')
      })
    }
    ,
    // custom sorting to enforce GK, DEF, MID, ATT ordering
    sortingFn: (rowA: any, rowB: any, columnId: string) => {
      const aRaw = rowA.getValue(columnId)
      const bRaw = rowB.getValue(columnId)
      const aNormalized = normalizePosition(String(aRaw ?? ''))
      const bNormalized = normalizePosition(String(bRaw ?? ''))
      const ia = aNormalized ? POSITION_ORDER.indexOf(aNormalized) : -1
      const ib = bNormalized ? POSITION_ORDER.indexOf(bNormalized) : -1
      // both known positions
      if (ia !== -1 && ib !== -1) return ia === ib ? 0 : ia > ib ? 1 : -1
      // one known, one unknown -> known comes first
      if (ia !== -1) return -1
      if (ib !== -1) return 1
      // both unknown -> fallback to string compare
      return String(aRaw ?? '').localeCompare(String(bRaw ?? ''))
    }
  },
  {
    accessorKey: 'skillLevel', id: 'skillLevel',
    header: ({ column }: { column: any }) => {
      const isSorted = column.getIsSorted()
      return h(UButton, {
        color: 'neutral',
        variant: 'ghost',
        label: 'Skill Level',
        icon: isSorted
          ? isSorted === 'asc'
            ? 'i-lucide-arrow-up-narrow-wide'
            : 'i-lucide-arrow-down-wide-narrow'
          : 'i-lucide-arrow-up-down',
        class: '-mx-2.5',
        onClick: () => column.toggleSorting(column.getIsSorted() === 'asc')
      })
    }
  },
  {
    accessorKey: 'stamina', id: 'stamina',
    header: ({ column }: { column: any }) => {
      const isSorted = column.getIsSorted()
      return h(UButton, {
        color: 'neutral',
        variant: 'ghost',
        label: 'Stamina',
        icon: isSorted
          ? isSorted === 'asc'
            ? 'i-lucide-arrow-up-narrow-wide'
            : 'i-lucide-arrow-down-wide-narrow'
          : 'i-lucide-arrow-up-down',
        class: '-mx-2.5',
        onClick: () => column.toggleSorting(column.getIsSorted() === 'asc')
      })
    }
  },
  {
    accessorKey: 'marketValue',
    id: 'marketValue',
    header: ({ column }: { column: any }) => {
      const isSorted = column.getIsSorted()
      return h(UButton, {
        color: 'neutral',
        variant: 'ghost',
        label: 'Market Value',
        icon: isSorted
          ? isSorted === 'asc'
            ? 'i-lucide-arrow-up-narrow-wide'
            : 'i-lucide-arrow-down-wide-narrow'
          : 'i-lucide-arrow-up-down',
        class: '-mx-2.5',
        onClick: () => column.toggleSorting(column.getIsSorted() === 'asc')
      })
    },
    cell: ({ row }: { row: any }) => formatMoney(row.original.marketValue)
  },
  {
    id: 'actions',
    header: 'Actions',
    cell: ({ row }: { row: any }) => {
      const player = row.original as SquadPlayer
      const selectionState = getSelectionState(player)

      return h(
        UButton,
        {
          color: selectionState.isSelected ? 'success' : 'primary',
          variant: selectionState.isSelected ? 'soft' : selectionState.canSelect ? 'solid' : 'outline',
          size: 'xs',
          disabled: !selectionState.isSelected && !selectionState.canSelect,
          onClick: () => togglePlayerSelection(player),
        },
        {
          default: () => {
            if (selectionState.isSelected)
              return 'Selected'

            if (!selectionState.canSelect)
              return 'Unavailable'

            return 'Select'
          },
        }
      )
    }
  }
]

onMounted(async () => {
  await refreshGameState()
  await refreshTeam()
  await refreshSchedule()
  await refreshStandings()
  await refreshOpponent()
  await refreshTactics()
})
</script>

<template>

  <div class="grid grid-cols-1 gap-4 sm:gap-6">
    <h1 class="app-page-title mb-2">
      Dashboard
    </h1>
    <div v-if="team" class="grid grid-cols-1 md:grid-cols-2 gap-8 animate-fade-in-up">
      <UCard class="app-surface">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-chart-no-axes-combined" class="size-4 text-emerald-400" />
            Club Status
          </div>
        </template>
        <div class="space-y-3">
          <div class="flex items-center justify-between rounded-xl px-4 py-3" style="background-color: var(--app-surface-muted)">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-trophy" class="size-4 text-amber-400" />
              <span class="text-sm" style="color: var(--app-text-muted)">League Position</span>
            </div>
            <strong class="text-lg font-bold">{{ leaguePosition ?? '—' }}</strong>
          </div>
          <div class="flex items-center justify-between rounded-xl px-4 py-3" style="background-color: var(--app-surface-muted)">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-wallet" class="size-4 text-emerald-400" />
              <span class="text-sm" style="color: var(--app-text-muted)">Bank Balance</span>
            </div>
            <strong class="text-lg font-bold">{{ new Intl.NumberFormat('en-US', {
              style: 'currency', currency: 'USD'
            }).format(team.bankBalance ?? 0) }}</strong>
          </div>
        </div>
      </UCard>
      <UCard v-if="nextMatch" class="app-surface">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-swords" class="size-4 text-rose-400" />
            Next Match
          </div>
        </template>
        <div class="space-y-3">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-shield-half" class="size-4" style="color: var(--app-text-muted)" />
            <span class="text-sm" style="color: var(--app-text-muted)">vs</span>
            <strong>{{ opponentTeam?.name ?? nextMatch.awayTeamId }}</strong>
          </div>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-calendar-clock" class="size-4" style="color: var(--app-text-muted)" />
            <span class="text-sm" style="color: var(--app-text-muted)">Date</span>
            <strong>{{ new Date(nextMatch.matchDate).toLocaleDateString() }}</strong>
          </div>
        </div>
        <template #footer>
          <UButton class="w-full sm:w-auto" label="Go to Matchday" icon="i-lucide-play" @click="confirmTacticAndSimulate" />
        </template>
      </UCard>
    </div>


    <UCard>
      <div class="grid gap-6 lg:grid-cols-[1.2fr,0.8fr]">
        <div class="space-y-4">
          <div class="flex items-center justify-between gap-4">
            <div>
              <p class="app-kicker">Lineup Builder</p>
              <h2 class="text-xl font-semibold" style="color: var(--app-text)">
                {{ selectedSquadPlayers.length }}/11 selected
              </h2>
              <p class="app-muted-text text-sm">
                {{ lineupSummaryText }}
              </p>
            </div>
            <span
              class="app-status-pill"
              :class="lineupIsComplete ? 'app-status-pill--success' : 'app-status-pill--warning'"
            >
              {{ lineupIsComplete ? 'Lineup ready' : 'Incomplete lineup' }}
            </span>
          </div>

          <div class="relative overflow-hidden rounded-4xl border border-emerald-900/20 bg-linear-to-b from-emerald-300/20 via-emerald-700 to-slate-950 px-4 py-5 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] sm:px-6 lg:px-8">
            <div class="absolute inset-4 rounded-[1.75rem] border border-white/20"></div>
            <div class="absolute inset-x-4 top-1/2 border-t border-white/20"></div>
            <div class="absolute left-1/2 top-1/2 h-20 w-20 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/20 sm:h-28 sm:w-28"></div>
            <div class="absolute left-1/2 top-4 h-12 w-28 -translate-x-1/2 rounded-b-[1.5rem] border border-t-0 border-white/20 sm:w-36"></div>
            <div class="absolute left-1/2 bottom-4 h-12 w-28 -translate-x-1/2 rounded-t-[1.5rem] border border-b-0 border-white/20 sm:w-36"></div>

            <div class="relative z-10 flex min-h-120 flex-col justify-between gap-5">
              <div
                v-for="row in pitchRows"
                :key="row.position"
                class="space-y-3"
              >
                <div class="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
                  <span>{{ row.label }}</span>
                  <span>{{ row.selected }}/{{ row.required }}</span>
                </div>

                <div class="flex flex-wrap items-stretch justify-center gap-3 sm:gap-4">
                  <template v-for="slot in row.slots" :key="slot.key">
                    <button
                      v-if="slot.player"
                      type="button"
                      class="flex min-h-31 w-35 flex-col items-center justify-center rounded-[1.35rem] border border-white/15 bg-white/12 px-3 py-3 text-center shadow-lg shadow-emerald-950/20 backdrop-blur transition hover:-translate-y-0.5 hover:bg-white/18"
                      @click="togglePlayerSelection(slot.player)"
                    >
                      <span class="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-white/16 text-sm font-bold text-white/95">
                        {{ getPlayerInitials(slot.player.name) }}
                      </span>
                      <span class="text-sm font-semibold leading-tight text-white">
                        {{ slot.player.name }}
                      </span>
                      <span class="mt-1 text-[11px] text-emerald-100/85">
                        OVR {{ slot.player.skillLevel }} • STA {{ slot.player.stamina }}
                      </span>
                    </button>

                    <div
                      v-else
                      class="flex min-h-31 w-35 flex-col items-center justify-center rounded-[1.35rem] border border-dashed border-white/20 bg-black/10 px-3 py-3 text-center shadow-inner shadow-emerald-950/30"
                    >
                      <UIcon name="i-lucide-user-plus" class="mb-1 size-5 text-white/35" />
                      <span class="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/55">{{ row.position }}</span>
                      <span class="mt-1 text-xs font-medium text-white/40">Slot {{ slot.slotNumber }}</span>
                    </div>
                  </template>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="app-surface-subtle space-y-4 p-5">
          <div>
            <p class="app-kicker">Formation</p>
            <select v-model="selectedTactic" class="app-control">
              <option value="" disabled>Select tactic</option>
          <option v-for="t in tacticsList" :key="t.name" :value="t.name">
            {{ t.name }} ({{ t.formation.DF }}-{{ t.formation.MF }}-{{ t.formation.FW }})
          </option>
            </select>
            <p class="app-muted-text mt-2 text-xs">Player selection is limited by this formation.</p>
          </div>

          <div>
            <p class="app-kicker">Selected Squad Metrics</p>
            <div class="mt-3 grid gap-3 sm:grid-cols-2">
              <div
                v-for="metric in lineupMetrics"
                :key="metric.label"
                class="app-metric-card"
              >
                <div class="mb-1 flex items-center gap-1.5">
                  <UIcon :name="metric.icon" class="size-3.5" style="color: var(--app-text-muted)" />
                  <p class="app-kicker text-[10px]">{{ metric.label }}</p>
                </div>
                <p class="mt-1 text-xl font-semibold" style="color: var(--app-text)">{{ metric.value }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </UCard>
    <UCard class="app-surface">
      <h2 class="mb-2 text-(--app-text) text-lg">
        {{ team?.name }} Squad
      </h2>
      <p class="app-muted-text mb-4 text-sm">
        Selected players are highlighted, slots lock automatically once a formation role is full, and you can click any player marker on the pitch to remove them.
      </p>
      <div class="overflow-x-auto">
        <div class="min-w-max">
          <UTable v-if="team" :data="team.squad" :columns="lineupColumns" />
        </div>
      </div>
    </UCard>
  </div>
</template>
