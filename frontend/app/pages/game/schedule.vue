<script setup lang="ts">
/**
 * Schedule — fixtures as cards grouped by month rather than a flat table of
 * ISO dates. The player's own club is always emphasised, the next fixture is
 * called out with a countdown, and results carry their W/D/L colour.
 */
import { computed, ref } from 'vue'
import { daysUntil, formatMatchDate, formatMonthGroup, getInitials } from '~/utils/format'
import { RESULT_COLOR, RESULT_LABEL, resultFor, recentForm } from '~/utils/results'

interface Fixture {
  id: number
  homeTeamId: number
  awayTeamId: number
  homeScore: number | null
  awayScore: number | null
  played: number
  matchDate: string
}

const { team } = useGameContext()

const { data: fixtures, status } = useAsyncData(
  'schedule-all',
  () => $fetch<Fixture[]>('/api/schedule?includePlayed=true'),
  { default: () => [] as Fixture[] },
)

const teamNames = ref<Record<string, string>>({})

watch(() => team.value?.leagueId, async (leagueId) => {
  if (!leagueId) return
  try {
    const teams = await $fetch<{ id: number; name: string }[]>(`/api/teams?leagueId=${leagueId}`)
    teamNames.value = Object.fromEntries(teams.map(t => [String(t.id), t.name]))
  }
  catch {
    teamNames.value = {}
  }
}, { immediate: true })

function nameOf(teamId: number): string {
  return teamNames.value[String(teamId)] ?? `Team ${teamId}`
}

const filter = ref<'all' | 'upcoming' | 'played'>('all')

const ownId = computed(() => team.value?.id ?? null)

/** The next unplayed fixture — highlighted, and the only one with a countdown. */
const nextFixtureId = computed(() => {
  const upcoming = (fixtures.value ?? [])
    .filter(f => f.homeScore === null)
    .sort((a, b) => new Date(a.matchDate).getTime() - new Date(b.matchDate).getTime())
  return upcoming[0]?.id ?? null
})

const form = computed(() => ownId.value ? recentForm(fixtures.value ?? [], ownId.value) : [])

const visible = computed(() => {
  const list = fixtures.value ?? []
  if (filter.value === 'upcoming') return list.filter(f => f.homeScore === null)
  if (filter.value === 'played') return list.filter(f => f.homeScore !== null)
  return list
})

const counts = computed(() => ({
  all: (fixtures.value ?? []).length,
  upcoming: (fixtures.value ?? []).filter(f => f.homeScore === null).length,
  played: (fixtures.value ?? []).filter(f => f.homeScore !== null).length,
}))

/** Fixtures bucketed by calendar month, chronological. */
const grouped = computed(() => {
  const buckets = new Map<string, Fixture[]>()

  for (const fixture of [...visible.value].sort((a, b) =>
    new Date(a.matchDate).getTime() - new Date(b.matchDate).getTime())) {
    const key = formatMonthGroup(fixture.matchDate)
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)!.push(fixture)
  }

  return [...buckets.entries()].map(([month, list]) => ({ month, fixtures: list }))
})

function countdownFor(fixture: Fixture): string | null {
  if (fixture.id !== nextFixtureId.value) return null
  const days = daysUntil(fixture.matchDate)
  if (days === null) return null
  if (days <= 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  return `In ${days} days`
}
</script>

<template>
  <div class="space-y-4 sm:space-y-5">
    <div class="flex flex-wrap items-center gap-3">
      <UIcon name="i-lucide-calendar" class="size-6" style="color: var(--app-accent)" />
      <h1 class="app-page-title">Match Schedule</h1>
      <div v-if="form.length" class="ml-auto flex items-center gap-2">
        <span class="app-kicker text-[10px]">Form</span>
        <FormGuide :form="form" />
      </div>
    </div>

    <div class="flex flex-wrap gap-1.5">
      <button
        v-for="option in (['all', 'upcoming', 'played'] as const)"
        :key="option"
        type="button"
        class="app-filter-chip inline-flex items-center gap-1 px-3 py-1 capitalize"
        :class="filter === option && 'app-filter-chip--active'"
        :aria-pressed="filter === option"
        @click="filter = option"
      >
        {{ option }}
        <span class="tabular-nums opacity-70">{{ counts[option] }}</span>
      </button>
    </div>

    <AppSkeleton v-if="status === 'pending'" variant="list" :rows="5" />

    <AppEmptyState
      v-else-if="!grouped.length"
      icon="i-lucide-calendar-x"
      title="No fixtures to show"
      description="Try a different filter."
    />

    <div v-else class="space-y-6">
      <section v-for="group in grouped" :key="group.month" class="space-y-2.5">
        <div class="flex items-center gap-3">
          <h2 class="app-kicker">{{ group.month }}</h2>
          <span class="app-divider flex-1" />
        </div>

        <div
          v-for="fixture in group.fixtures"
          :key="fixture.id"
          class="app-surface-subtle animate-fade-in-up p-3.5 transition"
          :class="fixture.id === nextFixtureId && 'app-glow'"
          :style="fixture.id === nextFixtureId
            ? 'border-color: color-mix(in srgb, var(--app-accent) 45%, transparent)'
            : undefined"
        >
          <div class="flex flex-wrap items-center gap-3">
            <!-- Date -->
            <div class="w-24 shrink-0">
              <p class="text-xs font-bold" style="color: var(--app-text)">{{ formatMatchDate(fixture.matchDate) }}</p>
              <p v-if="countdownFor(fixture)" class="text-[10px] font-bold" style="color: var(--app-accent)">
                {{ countdownFor(fixture) }}
              </p>
            </div>

            <!-- Home -->
            <div class="flex min-w-0 flex-1 items-center justify-end gap-2 text-right">
              <span
                class="truncate text-sm"
                :class="fixture.homeTeamId === ownId ? 'font-bold' : 'font-medium'"
                :style="{ color: fixture.homeTeamId === ownId ? 'var(--app-accent)' : 'var(--app-text-soft)' }"
              >{{ nameOf(fixture.homeTeamId) }}</span>
              <span
                class="flex size-7 shrink-0 items-center justify-center rounded-lg text-[10px] font-black"
                :style="fixture.homeTeamId === ownId
                  ? 'background-color: var(--app-accent-soft); color: var(--app-accent)'
                  : 'background-color: var(--app-surface-muted); color: var(--app-text-muted)'"
              >{{ getInitials(nameOf(fixture.homeTeamId)) }}</span>
            </div>

            <!-- Score -->
            <div class="w-20 shrink-0 text-center">
              <template v-if="fixture.homeScore !== null">
                <p class="text-base font-black tabular-nums" style="color: var(--app-text)">
                  {{ fixture.homeScore }} – {{ fixture.awayScore }}
                </p>
                <span
                  v-if="ownId && resultFor(fixture, ownId)"
                  class="text-[9px] font-bold uppercase tracking-wider"
                  :style="{ color: RESULT_COLOR[resultFor(fixture, ownId)!] }"
                >{{ RESULT_LABEL[resultFor(fixture, ownId)!] }}</span>
              </template>
              <span v-else class="app-chip">
                {{ fixture.homeTeamId === ownId || fixture.awayTeamId === ownId ? 'To play' : 'TBD' }}
              </span>
            </div>

            <!-- Away -->
            <div class="flex min-w-0 flex-1 items-center gap-2">
              <span
                class="flex size-7 shrink-0 items-center justify-center rounded-lg text-[10px] font-black"
                :style="fixture.awayTeamId === ownId
                  ? 'background-color: var(--app-accent-soft); color: var(--app-accent)'
                  : 'background-color: var(--app-surface-muted); color: var(--app-text-muted)'"
              >{{ getInitials(nameOf(fixture.awayTeamId)) }}</span>
              <span
                class="truncate text-sm"
                :class="fixture.awayTeamId === ownId ? 'font-bold' : 'font-medium'"
                :style="{ color: fixture.awayTeamId === ownId ? 'var(--app-accent)' : 'var(--app-text-soft)' }"
              >{{ nameOf(fixture.awayTeamId) }}</span>
            </div>

            <!-- Venue -->
            <span v-if="ownId && (fixture.homeTeamId === ownId || fixture.awayTeamId === ownId)" class="app-chip shrink-0">
              {{ fixture.homeTeamId === ownId ? 'H' : 'A' }}
            </span>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
