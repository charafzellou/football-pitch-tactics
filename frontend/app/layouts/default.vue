<script setup lang="ts">
const route = useRoute()

const showTopbar = computed(() => route.path.startsWith('/game'))
</script>

<template>
  <div class="app-shell">
    <Sidebar v-if="showTopbar" />
    <main class="px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div class="mx-auto w-full max-w-screen-2xl">
        <slot />
      </div>
    </main>
  </div>
</template>
