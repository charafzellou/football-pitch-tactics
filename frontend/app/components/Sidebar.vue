<script setup lang="ts">
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
    <h2 class="text-xl font-bold mb-8">
      Main Menu
    </h2>
    <nav class="flex flex-col space-y-2">
      <UButton v-for="link in links" :key="link.to" :to="link.to" color="gray" variant="ghost" class="justify-start">
        {{ link.label }}
      </UButton>
    </nav>
  </aside>
</template>
