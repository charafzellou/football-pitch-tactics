/**
 * Shared save state: which club the player manages, its balance and squad,
 * and the next fixture.
 *
 * Every page was independently chaining `/api/game/state` → `/api/team/:id`,
 * which meant several round-trips just to draw a header. Keyed `useAsyncData`
 * dedupes across components, so the topbar and the page it sits above share
 * one request set and refresh together.
 *
 * State and team resolve in a *single* handler rather than two watched ones.
 * Two separate `useAsyncData` calls race during SSR: the team fetch runs while
 * the id is still null, returns null, and only a client-side watch recovers it
 * — which is why the topbar rendered "Manager Hub" with no balance.
 */
import { computed } from 'vue'

export interface SquadPlayer {
  id: number
  name: string
  age: number
  position: string
  skillLevel: number
  /** Skill ceiling — drives the squad list's development indicator. */
  potential: number
  stamina: number
  marketValue: number
  /** Per matchday, not per week — the only cadence money moves on. */
  wage: number
  /** Last season this contract covers. Equal to the current season = final year. */
  contractUntilSeason: number
  teamId: number
  injuredMatches?: number
}

export interface TeamPayload {
  id: number
  name: string
  leagueId: number
  bankBalance: number
  tactics: string | null
  lineup: number[] | null
  squad: SquadPlayer[]
  formation: Record<'GK' | 'DF' | 'MF' | 'FW', number>
  startingXi: number[]
  bench: number[]
  lineupAutoSelected: boolean
}

export interface GameState {
  id: number
  playerTeamId: number
  season: number
  currentDate: string
}

export interface Fixture {
  id: number
  homeTeamId: number
  awayTeamId: number
  homeScore: number | null
  awayScore: number | null
  played: number
  season: number
  matchDate: string
}

export function useGameContext() {
  const { data: context, refresh: refreshContext, status: contextStatus } = useAsyncData(
    'game-context',
    async () => {
      const state = await $fetch<GameState | null>('/api/game/state')
      if (!state?.playerTeamId)
        return { state: null, team: null }

      const team = await $fetch<TeamPayload>(`/api/team/${state.playerTeamId}`)
      return { state, team }
    },
    { default: () => ({ state: null, team: null }) },
  )

  const { data: fixtures, refresh: refreshFixtures } = useAsyncData(
    'upcoming-fixtures',
    () => $fetch<Fixture[]>('/api/schedule'),
    { default: () => [] as Fixture[] },
  )

  const gameState = computed(() => context.value?.state ?? null)
  const team = computed(() => context.value?.team ?? null)
  const playerTeamId = computed(() => gameState.value?.playerTeamId ?? null)
  const loading = computed(() => contextStatus.value === 'pending')

  const nextMatch = computed(() => fixtures.value?.[0] ?? null)

  const opponentId = computed(() => {
    if (!nextMatch.value || !team.value) return null
    return nextMatch.value.homeTeamId === team.value.id
      ? nextMatch.value.awayTeamId
      : nextMatch.value.homeTeamId
  })

  const isHomeFixture = computed(() =>
    Boolean(nextMatch.value && team.value && nextMatch.value.homeTeamId === team.value.id),
  )

  const squad = computed(() => team.value?.squad ?? [])
  const injuredCount = computed(() => squad.value.filter(p => (p.injuredMatches ?? 0) > 0).length)

  async function refreshAll() {
    await Promise.all([refreshContext(), refreshFixtures()])
  }

  return {
    gameState,
    playerTeamId,
    team,
    squad,
    injuredCount,
    loading,
    fixtures,
    nextMatch,
    opponentId,
    isHomeFixture,
    refreshTeam: refreshContext,
    refreshFixtures,
    refreshAll,
  }
}
