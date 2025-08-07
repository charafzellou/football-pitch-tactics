<script setup lang="ts">

const searchQuery = ref('')
const { data: searchResults, refresh: refreshSearch } = useFetch(() => `/api/players/search?query=${searchQuery.value}`, { immediate: false })

watch(searchQuery, () => {
  if (searchQuery.value.length > 2)
    refreshSearch()
})

async function buyPlayer(player: any) {
  // Placeholder for buy logic
  alert(`Buying ${player.name}`)
}
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold mb-4">
      Player Transfers
    </h1>
    <div class="mb-8">
      <UInput
        v-model="searchQuery"
        placeholder="Search for players..."
        icon="i-heroicons-magnifying-glass"
      />
    </div>
    <div v-if="searchResults">
      <UCard
        v-for="player in searchResults"
        :key="player.id"
        class="mb-4"
      >
        <div class="flex justify-between items-center">
          <div>
            <p class="font-bold">
              {{ player.name }}
            </p>
            <p>
              {{ player.position }} | Skill: {{ player.skillLevel }} | Value: {{ player.marketValue }}
            </p>
          </div>
          <UButton
            label="Buy"
            @click="buyPlayer(player)"
          />
        </div>
      </UCard>
    </div>
  </div>
</template>
