<script setup lang="ts">
/**
 * The full-time report.
 *
 * This component existed but was orphaned — the original result display,
 * abandoned when live playback was built, and rendered by nothing. Rebuilt as
 * the end-of-match summary: verdict, scorers, discipline, substitutions,
 * statistics and a player of the match.
 */
import { computed } from 'vue'
import type { MatchEvent } from '#shared/match-state'
import { effectiveSkill } from '#shared/match-state'
import type { StatRow } from '~/composables/useMatchStats'
import { eventIcon, eventIconClass, eventLabel, normalizeEventType } from '~/utils/match-events'

interface SquadPlayer {
  id: number
  name: string
  position: string
  skillLevel: number
}

const props = defineProps<{
  open: boolean
  homeName: string
  awayName: string
  homeScore: number
  awayScore: number
  homeTeamId: number | null
  awayTeamId: number | null
  homeSquad: SquadPlayer[]
  awaySquad: SquadPlayer[]
  events: MatchEvent[]
  rows: StatRow[]
  territory: number
  playerSide: 'home' | 'away' | null
  /** End-of-match stamina, for weighting the player of the match. */
  stamina: Record<number, number>
}>()

const emit = defineEmits<{ close: [] }>()

const squadById = computed(() => new Map(
  [...props.homeSquad, ...props.awaySquad].map(p => [p.id, p]),
))

function nameOf(playerId?: number): string | null {
  return playerId ? squadById.value.get(playerId)?.name ?? null : null
}

/** Win / draw / loss from the player's own perspective, if they're involved. */
const verdict = computed(() => {
  if (!props.playerSide) {
    if (props.homeScore === props.awayScore) return { label: 'Draw', tone: 'neutral' as const }
    return { label: 'Full time', tone: 'neutral' as const }
  }

  const own = props.playerSide === 'home' ? props.homeScore : props.awayScore
  const other = props.playerSide === 'home' ? props.awayScore : props.homeScore

  if (own > other) return { label: 'Victory', tone: 'success' as const }
  if (own < other) return { label: 'Defeat', tone: 'error' as const }
  return { label: 'Draw', tone: 'neutral' as const }
})

const verdictColor = computed(() => ({
  success: 'var(--app-accent)',
  error: 'var(--app-player-sent-off)',
  neutral: 'var(--app-text-muted)',
}[verdict.value.tone]))

interface Highlight {
  key: string
  minute: number
  type: string
  isHome: boolean
  text: string
}

/** Goals, cards, injuries and substitutions, oldest first. */
const highlights = computed<Highlight[]>(() =>
  props.events
    .filter((event) => {
      const type = normalizeEventType(event.eventType)
      return ['goal', 'yellow', 'red', 'injury', 'substitution'].includes(type)
    })
    .map((event, index) => {
      const type = normalizeEventType(event.eventType)
      const player = nameOf(event.playerId)
      const related = nameOf(event.relatedPlayerId)

      const text = type === 'substitution' && related
        ? `${player ?? 'Substitute'} on for ${related}`
        : player ?? eventLabel(event.eventType)

      return {
        key: `${event.minute}-${type}-${index}`,
        minute: event.minute,
        type: event.eventType,
        isHome: event.teamId === props.homeTeamId,
        text,
      }
    })
    .sort((a, b) => a.minute - b.minute),
)

const scorers = computed(() => {
  const tally = new Map<number, { name: string; isHome: boolean; minutes: number[] }>()

  for (const event of props.events) {
    if (normalizeEventType(event.eventType) !== 'goal' || !event.playerId) continue

    const existing = tally.get(event.playerId)
    if (existing) {
      existing.minutes.push(event.minute)
      continue
    }

    tally.set(event.playerId, {
      name: nameOf(event.playerId) ?? 'Unknown',
      isHome: event.teamId === props.homeTeamId,
      minutes: [event.minute],
    })
  }

  return [...tally.values()].sort((a, b) => a.minutes[0]! - b.minutes[0]!)
})

/**
 * Player of the match: the best goalscorer by effective skill, weighted by how
 * many they got. With no goals it falls back to the strongest performer still
 * standing — using the same `effectiveSkill()` the engine resolves play with,
 * so it reflects fatigue rather than raw ability.
 */
const playerOfTheMatch = computed(() => {
  const candidates = scorers.value.length
    ? scorers.value.map((scorer) => {
      const player = [...props.homeSquad, ...props.awaySquad].find(p => p.name === scorer.name)
      return player
        ? {
            player,
            isHome: scorer.isHome,
            score: effectiveSkill(player.skillLevel, props.stamina[player.id] ?? 100) + scorer.minutes.length * 25,
            goals: scorer.minutes.length,
          }
        : null
    }).filter((c): c is NonNullable<typeof c> => Boolean(c))
    : [...props.homeSquad.map(p => ({ player: p, isHome: true })), ...props.awaySquad.map(p => ({ player: p, isHome: false }))]
        .map(({ player, isHome }) => ({
          player,
          isHome,
          score: effectiveSkill(player.skillLevel, props.stamina[player.id] ?? 100),
          goals: 0,
        }))

  return candidates.sort((a, b) => b.score - a.score)[0] ?? null
})
</script>

<template>
  <UModal
    :open="open"
    title="Full-time report"
    :description="`${homeName} ${homeScore} - ${awayScore} ${awayName}`"
    :ui="{ content: 'sm:max-w-2xl' }"
    @update:open="value => !value && emit('close')"
  >
    <template #content>
      <div class="app-surface animate-scale-in max-h-[92vh] overflow-y-auto">
        <!-- Result header -->
        <div
          class="relative overflow-hidden px-6 py-8 text-center"
          :style="{ backgroundImage: `linear-gradient(160deg, color-mix(in srgb, ${verdictColor} 22%, transparent), transparent 70%)` }"
        >
          <p
            class="text-xs font-bold uppercase tracking-[0.28em]"
            :style="{ color: verdictColor }"
          >{{ verdict.label }}</p>

          <div class="mt-4 flex items-center justify-center gap-4 sm:gap-6">
            <p class="min-w-0 flex-1 truncate text-right text-sm font-bold sm:text-base" style="color: var(--app-text)">
              {{ homeName }}
            </p>
            <p class="app-hero-number shrink-0 text-4xl sm:text-5xl">
              {{ homeScore }} <span class="opacity-30">–</span> {{ awayScore }}
            </p>
            <p class="min-w-0 flex-1 truncate text-left text-sm font-bold sm:text-base" style="color: var(--app-text)">
              {{ awayName }}
            </p>
          </div>

          <div v-if="scorers.length" class="mt-4 flex flex-wrap justify-center gap-2">
            <span
              v-for="scorer in scorers"
              :key="scorer.name"
              class="app-chip app-chip--success"
            >
              <UIcon name="i-lucide-circle-dot" class="size-3" />
              {{ scorer.name }} {{ scorer.minutes.map(m => `${m}'`).join(', ') }}
            </span>
          </div>
        </div>

        <div class="space-y-5 px-5 pb-5 sm:px-6">
          <!-- Player of the match -->
          <div
            v-if="playerOfTheMatch"
            class="flex items-center gap-3 rounded-2xl p-4"
            style="background-color: var(--app-gold-soft); border: 1px solid color-mix(in srgb, var(--app-gold) 34%, transparent)"
          >
            <UIcon name="i-lucide-award" class="size-7 shrink-0" style="color: var(--app-gold)" />
            <div class="min-w-0 flex-1">
              <p class="app-kicker text-[10px]">Player of the match</p>
              <p class="truncate font-bold" style="color: var(--app-text)">{{ playerOfTheMatch.player.name }}</p>
              <p class="app-muted-text text-xs">
                {{ playerOfTheMatch.isHome ? homeName : awayName }}
                <template v-if="playerOfTheMatch.goals"> · {{ playerOfTheMatch.goals }} goal{{ playerOfTheMatch.goals === 1 ? '' : 's' }}</template>
              </p>
            </div>
            <AppPositionBadge :position="playerOfTheMatch.player.position" size="md" />
          </div>

          <!-- Statistics -->
          <div v-if="rows.length">
            <p class="app-kicker mb-2 text-[10px]">Statistics</p>
            <div class="space-y-2">
              <div class="flex items-center justify-between text-xs">
                <span class="w-8 font-bold tabular-nums" style="color: var(--app-accent)">{{ territory }}%</span>
                <span class="app-muted-text">Territory</span>
                <span class="w-8 text-right font-bold tabular-nums" style="color: var(--app-pos-gk)">{{ 100 - territory }}%</span>
              </div>
              <div v-for="row in rows" :key="row.label" class="flex items-center justify-between text-xs">
                <span class="w-8 font-bold tabular-nums" style="color: var(--app-text)">{{ row.home }}</span>
                <span class="app-muted-text">{{ row.label }}</span>
                <span class="w-8 text-right font-bold tabular-nums" style="color: var(--app-text)">{{ row.away }}</span>
              </div>
            </div>
          </div>

          <!-- Timeline of notable events -->
          <div v-if="highlights.length">
            <p class="app-kicker mb-2 text-[10px]">Key moments</p>
            <ul class="max-h-56 space-y-1 overflow-y-auto pr-1">
              <li
                v-for="item in highlights"
                :key="item.key"
                class="flex items-center gap-2 rounded-lg px-2 py-1 text-sm"
                :class="item.isHome ? '' : 'flex-row-reverse text-right'"
              >
                <UIcon :name="eventIcon(item.type)" class="size-3.5 shrink-0" :class="eventIconClass(item.type)" />
                <span class="w-8 shrink-0 font-bold tabular-nums" style="color: var(--app-text-muted)">
                  {{ item.minute }}'
                </span>
                <span class="min-w-0 flex-1 truncate" style="color: var(--app-text-soft)">{{ item.text }}</span>
              </li>
            </ul>
          </div>
        </div>

        <div class="flex justify-end border-t p-5 sm:px-6" style="border-color: var(--app-surface-border)">
          <UButton label="Close report" icon="i-lucide-x" color="neutral" variant="soft" @click="emit('close')" />
        </div>
      </div>
    </template>
  </UModal>
</template>
