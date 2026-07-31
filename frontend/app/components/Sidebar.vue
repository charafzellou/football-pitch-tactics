<script setup lang="ts">
import { ref, watch } from 'vue'

const route = useRoute()
const isMenuOpen = ref(false)

const links = [
  { label: 'Dashboard', to: '/game', icon: 'i-lucide-layout-dashboard' },
  { label: 'Team', to: '/game/team', icon: 'i-lucide-users' },
  { label: 'Schedule', to: '/game/schedule', icon: 'i-lucide-calendar' },
  { label: 'Standings', to: '/game/standings', icon: 'i-lucide-trophy' },
  { label: 'Transfers', to: '/game/transfers', icon: 'i-lucide-arrow-left-right' },
]

function isActiveLink(path: string) {
  return path === '/game' ? route.path === path : route.path.startsWith(path)
}

function toggleMenu() {
  isMenuOpen.value = !isMenuOpen.value
}

watch(() => route.path, () => {
  isMenuOpen.value = false
})
</script>

<template>
  <header class="app-topbar sticky top-0 z-40">
    <div class="mx-auto flex max-w-screen-2xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
      <NuxtLink to="/game" class="flex min-w-0 items-center gap-3">
        <UIcon name="i-lucide-shield-half" class="size-7 shrink-0 text-emerald-400" />
        <div class="min-w-0">
          <p class="app-topbar-kicker text-[11px] font-semibold uppercase tracking-[0.28em]">
            Football Pitch Tactics
          </p>
          <h2 class="truncate text-lg font-semibold text-white sm:text-xl">
            Manager Hub
          </h2>
        </div>
      </NuxtLink>

      <nav class="hidden items-center gap-1 md:flex">
        <UButton
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          :icon="link.icon"
          :color="isActiveLink(link.to) ? 'primary' : 'neutral'"
          :variant="isActiveLink(link.to) ? 'soft' : 'ghost'"
          class="app-topbar-link rounded-full px-3"
        >
          {{ link.label }}
        </UButton>
      </nav>

      <UButton
        class="md:hidden"
        color="neutral"
        variant="ghost"
        :icon="isMenuOpen ? 'i-lucide-x' : 'i-lucide-menu'"
        :label="isMenuOpen ? 'Close' : 'Menu'"
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
        <nav class="mx-auto flex max-w-screen-2xl flex-col gap-2 px-4 py-4 sm:px-6">
          <UButton
            v-for="link in links"
            :key="link.to"
            :to="link.to"
            :icon="link.icon"
            :color="isActiveLink(link.to) ? 'primary' : 'neutral'"
            :variant="isActiveLink(link.to) ? 'soft' : 'ghost'"
            class="app-topbar-link justify-start rounded-2xl"
          >
            {{ link.label }}
          </UButton>
        </nav>
      </div>
    </Transition>
  </header>
</template>
