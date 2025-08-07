<script setup lang="ts">
import { separator } from '#build/ui';
import { USeparator } from '#components';

const links = [
  { label: 'Dashboard', to: '/game' },
  { label: 'Team', to: '/game/team' },
  { label: 'Tactics', to: '/game/tactics' },
  { label: 'Schedule', to: '/game/schedule' },
  { label: 'Standings', to: '/game/standings' },
  { label: 'Transfers', to: '/game/transfers' },
]
</script>

<template>
  <aside class="w-64 bg-gray-800 text-white p-4">
    <USeparator />
    <h2 class="text-xl font-bold mb-8">
      Football Pitch Tactics
    </h2>
    <USeparator />
    <nav class="flex flex-col space-y-2">
      <UButton v-for="link in links" :key="link.to" :to="link.to" color="gray" variant="ghost" class="justify-start">
        {{ link.label }}
      </UButton>
    </nav>
    <USeparator />
    <p class="mt-16 text-sm text-gray-400">
      © 2025 Football Pitch Tactics
    </p>
  </aside>
</template>
