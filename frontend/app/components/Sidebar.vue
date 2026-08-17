<script setup lang="ts">
/**
 * The top navigation bar for every `/game*` route.
 *
 * Beyond navigation it now carries the club context — crest, balance, season,
 * next fixture — which previously required leaving whatever page you were on
 * to find out. The active link is a sliding pill rather than a variant swap,
 * so moving between sections reads as motion instead of a repaint.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useWindowScroll } from '@vueuse/core'
import { formatMoneyCompact, daysUntil, getInitials } from '~/utils/format'
import { useSettingsStore } from '~/stores/settings'

const route = useRoute()
const settings = useSettingsStore()
const sfx = useSfx()
const { team, gameState, nextMatch, opponentId, isHomeFixture, injuredCount } = useGameContext()

const { data: seasonStatus } = useAsyncData('sidebar-season', () => $fetch<any>('/api/season/status'))

const isMenuOpen = ref(false)
const { y: scrollY } = useWindowScroll()
const isCondensed = computed(() => scrollY.value > 80)

const links = [
  { label: 'Dashboard', to: '/game', icon: 'i-lucide-layout-dashboard' },
  { label: 'Team', to: '/game/team', icon: 'i-lucide-users' },
  { label: 'Schedule', to: '/game/schedule', icon: 'i-lucide-calendar' },
  { label: 'Standings', to: '/game/standings', icon: 'i-lucide-trophy' },
  { label: 'Transfers', to: '/game/transfers', icon: 'i-lucide-arrow-left-right' },
  { label: 'Finance', to: '/game/finance', icon: 'i-lucide-banknote' },
  { label: 'History', to: '/game/history', icon: 'i-lucide-scroll-text' },
  { label: 'Settings', to: '/game/settings', icon: 'i-lucide-settings' },
]

function isActiveLink(path: string) {
  return path === '/game' ? route.path === path : route.path.startsWith(path)
}

// The sliding indicator is positioned from the active button's own geometry,
// so it stays correct across font loading, resizes and label changes.
const navRef = ref<HTMLElement | null>(null)
const indicator = ref({ left: 0, width: 0, visible: false })

async function repositionIndicator() {
  await nextTick()
  const nav = navRef.value
  if (!nav) return

  const active = nav.querySelector<HTMLElement>('[data-active="true"]')
  if (!active) {
    indicator.value = { ...indicator.value, visible: false }
    return
  }

  indicator.value = {
    left: active.offsetLeft,
    width: active.offsetWidth,
    visible: true,
  }
}

onMounted(repositionIndicator)
watch(() => route.path, () => {
  isMenuOpen.value = false
  repositionIndicator()
})

const opponentName = ref<string | null>(null)
watch(opponentId, async (id) => {
  if (!id) {
    opponentName.value = null
    return
  }
  try {
    const opponent = await $fetch<{ name: string }>(`/api/team/${id}`)
    opponentName.value = opponent.name
  }
  catch {
    opponentName.value = null
  }
}, { immediate: true })

const countdown = computed(() => {
  const days = daysUntil(nextMatch.value?.matchDate)
  if (days === null) return null
  if (days <= 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  return `in ${days} days`
})

function toggleMenu() {
  sfx.play('click')
  isMenuOpen.value = !isMenuOpen.value
}

function onNavigate() {
  sfx.play('click')
}

function toggleMute() {
  settings.toggleMute()
  // Feedback only makes sense on the way back on.
  if (!settings.muted) sfx.play('success')
}

function cycleTheme() {
  settings.cycleTheme()
  sfx.play('click')
}
</script>

<template>
  <header class="app-topbar sticky top-0 z-40 transition-[padding] duration-300">
    <div
      class="mx-auto flex max-w-screen-2xl items-center justify-between gap-4 px-4 transition-all duration-300 sm:px-6 lg:px-8"
      :class="isCondensed ? 'py-2' : 'py-3'"
    >
      <!-- Brand + club identity -->
      <NuxtLink to="/game" class="flex min-w-0 items-center gap-3" @click="onNavigate">
        <div class="relative shrink-0">
          <div
            class="flex items-center justify-center rounded-2xl font-black transition-all duration-300"
            :class="isCondensed ? 'size-8 text-xs' : 'size-10 text-sm'"
            style="background-image: linear-gradient(140deg, var(--app-accent), var(--color-brand-700)); color: var(--color-brand-950)"
          >
            {{ team ? getInitials(team.name) : '⚽' }}
          </div>
          <span
            v-if="injuredCount"
            class="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full text-[9px] font-bold"
            style="background-color: var(--app-player-injured); color: var(--color-shell-950)"
            :title="`${injuredCount} injured`"
          >{{ injuredCount }}</span>
        </div>

        <div class="min-w-0">
          <p
            class="app-topbar-kicker font-semibold uppercase transition-all duration-300"
            :class="isCondensed ? 'text-[9px]' : 'text-[11px]'"
            style="letter-spacing: 0.28em"
          >
            Football Pitch Tactics
          </p>
          <h2
            class="truncate font-semibold text-white transition-all duration-300"
            :class="isCondensed ? 'text-sm' : 'text-lg sm:text-xl'"
          >
            {{ team?.name ?? 'Manager Hub' }}
          </h2>
        </div>
      </NuxtLink>

      <!-- Club context strip -->
      <div
        class="hidden items-center gap-2 xl:flex"
        :class="isCondensed && 'opacity-0 pointer-events-none'"
      >
        <div v-if="team" class="app-glass flex items-center gap-2 px-3 py-1.5">
          <UIcon name="i-lucide-wallet" class="size-3.5" style="color: var(--app-accent)" />
          <AppCountUp
            :value="team.bankBalance ?? 0"
            :format="formatMoneyCompact"
            class="text-xs font-bold"
            style="color: var(--app-text)"
          />
        </div>

        <div v-if="nextMatch" class="app-glass flex items-center gap-2 px-3 py-1.5" :title="countdown ?? ''">
          <UIcon name="i-lucide-swords" class="size-3.5" style="color: var(--app-player-injured)" />
          <span class="text-xs font-semibold" style="color: var(--app-text-soft)">
            <span class="app-muted-text">{{ isHomeFixture ? 'vs' : 'at' }}</span>
            {{ opponentName ?? '…' }}
          </span>
          <span v-if="countdown" class="text-[10px] font-bold uppercase" style="color: var(--app-text-muted)">
            {{ countdown }}
          </span>
        </div>

        <div v-if="gameState" class="app-glass flex items-center gap-2 px-3 py-1.5">
          <UIcon name="i-lucide-calendar-days" class="size-3.5" style="color: var(--app-gold)" />
          <span class="text-xs font-semibold" style="color: var(--app-text-soft)">
            Season {{ gameState.season }}<template v-if="seasonStatus?.totalRounds">
              · R{{ seasonStatus.round }}/{{ seasonStatus.totalRounds }}</template>
          </span>
        </div>
      </div>

      <!-- Desktop nav with sliding indicator -->
      <div class="hidden items-center gap-1 md:flex">
        <nav ref="navRef" class="relative flex items-center gap-1">
          <span
            class="pointer-events-none absolute inset-y-0 rounded-full transition-all duration-300 ease-out"
            :class="indicator.visible ? 'opacity-100' : 'opacity-0'"
            :style="{
              left: `${indicator.left}px`,
              width: `${indicator.width}px`,
              backgroundColor: 'var(--app-accent-soft)',
              boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--app-accent) 35%, transparent)',
            }"
          />
          <NuxtLink
            v-for="link in links"
            :key="link.to"
            :to="link.to"
            :data-active="isActiveLink(link.to)"
            class="app-topbar-link relative z-10 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors"
            :style="isActiveLink(link.to) ? 'color: var(--app-accent-strong)' : undefined"
            :aria-current="isActiveLink(link.to) ? 'page' : undefined"
            @click="onNavigate"
          >
            <UIcon :name="link.icon" class="size-4 shrink-0" />
            <span class="hidden lg:inline">{{ link.label }}</span>
          </NuxtLink>
        </nav>

        <span class="mx-1 h-5 w-px" style="background-color: var(--app-topbar-border)" />

        <ClientOnly>
          <UButton
            :icon="settings.muted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'"
            color="neutral"
            variant="ghost"
            size="sm"
            class="app-topbar-link rounded-full"
            :aria-label="settings.muted ? 'Unmute sound' : 'Mute sound'"
            :title="settings.muted ? 'Sound off' : 'Sound on'"
            @click="toggleMute"
          />
          <template #fallback>
            <div class="size-8" />
          </template>
        </ClientOnly>

        <UButton
          icon="i-lucide-palette"
          color="neutral"
          variant="ghost"
          size="sm"
          class="app-topbar-link rounded-full"
          aria-label="Switch theme"
          title="Switch theme"
          @click="cycleTheme"
        />
      </div>

      <UButton
        class="md:hidden"
        color="neutral"
        variant="ghost"
        :icon="isMenuOpen ? 'i-lucide-x' : 'i-lucide-menu'"
        :aria-label="isMenuOpen ? 'Close menu' : 'Open menu'"
        :aria-expanded="isMenuOpen"
        @click="toggleMenu"
      />
    </div>

    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="-translate-y-2 opacity-0"
      enter-to-class="translate-y-0 opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="translate-y-0 opacity-100"
      leave-to-class="-translate-y-2 opacity-0"
    >
      <div v-if="isMenuOpen" class="app-topbar-panel md:hidden">
        <nav class="mx-auto flex max-w-screen-2xl flex-col gap-1.5 px-4 py-4 sm:px-6">
          <NuxtLink
            v-for="(link, i) in links"
            :key="link.to"
            :to="link.to"
            class="app-topbar-link flex animate-fade-in-up items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium"
            :style="[
              `animation-delay: ${i * 0.04}s`,
              isActiveLink(link.to)
                ? 'color: var(--app-accent-strong); background-color: var(--app-accent-soft)'
                : '',
            ]"
            :aria-current="isActiveLink(link.to) ? 'page' : undefined"
            @click="onNavigate"
          >
            <UIcon :name="link.icon" class="size-4 shrink-0" />
            {{ link.label }}
          </NuxtLink>

          <div class="app-divider my-2" />

          <div class="flex items-center justify-between gap-2 px-1">
            <div v-if="team" class="flex items-center gap-2">
              <UIcon name="i-lucide-wallet" class="size-4" style="color: var(--app-accent)" />
              <span class="text-sm font-bold" style="color: var(--app-text)">
                {{ formatMoneyCompact(team.bankBalance ?? 0) }}
              </span>
            </div>
            <div class="flex items-center gap-1">
              <ClientOnly>
                <UButton
                  :icon="settings.muted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  :aria-label="settings.muted ? 'Unmute sound' : 'Mute sound'"
                  @click="toggleMute"
                />
              </ClientOnly>
              <UButton
                icon="i-lucide-palette"
                color="neutral"
                variant="ghost"
                size="sm"
                aria-label="Switch theme"
                @click="cycleTheme"
              />
            </div>
          </div>
        </nav>
      </div>
    </Transition>
  </header>
</template>
