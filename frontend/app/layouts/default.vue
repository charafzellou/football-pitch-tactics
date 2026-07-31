<script setup lang="ts">
const route = useRoute()

const showSidebar = computed(() => route.path.startsWith('/game'))
</script>

<template>
  <div class="flex h-screen">
    <Sidebar v-if="showSidebar" />
    <main class="flex-1 p-8 overflow-y-auto">
      <slot />
    </main>
  </div>
</template>
