<script setup lang="ts">
import { computed, ref } from 'vue'

const route = useRoute()
const router = useRouter()

// The dismissal screen is a full stop, not a section of the app — every nav
// link on it would only bounce straight back to it.
const showTopbar = computed(() =>
  route.path.startsWith('/game') && route.path !== '/game/dismissed',
)

// A thin progress bar during route changes. Data fetching happens after the
// component mounts, so without this the app looks frozen between pages.
const navigating = ref(false)
router.beforeEach(() => { navigating.value = true })
router.afterEach(() => { setTimeout(() => { navigating.value = false }, 220) })
router.onError(() => { navigating.value = false })
</script>

<template>
  <div class="app-shell app-noise">
    <Transition
      enter-active-class="transition-opacity duration-150"
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-300"
      leave-to-class="opacity-0"
    >
      <div v-if="navigating" class="fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden">
        <div
          class="h-full w-1/3 animate-sweep rounded-full"
          style="background-image: linear-gradient(90deg, transparent, var(--app-accent), transparent)"
        />
      </div>
    </Transition>

    <Sidebar v-if="showTopbar" />

    <main class="px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div class="mx-auto w-full max-w-screen-2xl">
        <slot />
      </div>
    </main>
  </div>
</template>
