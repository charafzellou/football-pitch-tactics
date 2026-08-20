<script setup lang="ts">
/**
 * Sub-navigation for the finance section.
 *
 * The topbar's `isActiveLink()` prefix-matches, so every `/game/finance/*` route
 * already lights the Finance pill — this is what says *which* of them you are on.
 * Uses the same `app-filter-chip` idiom as the transfer market's tabs rather
 * than a second navigation style.
 */
const route = useRoute()

const links = [
  { label: 'Overview', to: '/game/finance', icon: 'i-lucide-wallet' },
  { label: 'Projection', to: '/game/finance/projection', icon: 'i-lucide-chart-no-axes-combined' },
  { label: 'Commercial', to: '/game/finance/commercial', icon: 'i-lucide-handshake' },
  { label: 'Stadium', to: '/game/finance/stadium', icon: 'i-lucide-building' },
  { label: 'Facilities', to: '/game/finance/facilities', icon: 'i-lucide-dumbbell' },
]

function isActive(to: string): boolean {
  return to === '/game/finance' ? route.path === to : route.path.startsWith(to)
}
</script>

<template>
  <nav class="flex flex-wrap gap-2" aria-label="Finance sections">
    <NuxtLink
      v-for="link in links"
      :key="link.to"
      :to="link.to"
      class="app-filter-chip"
      :class="isActive(link.to) && 'app-filter-chip--active'"
      :aria-current="isActive(link.to) ? 'page' : undefined"
    >
      <UIcon :name="link.icon" class="size-3.5" />
      {{ link.label }}
    </NuxtLink>
  </nav>
</template>
