<script setup lang="ts">
defineProps<{
  match: any
}>()
</script>

<template>
  <UModal>
    <UCard>
      <template #header>
        <h2 class="text-xl font-bold">
          Match Report
        </h2>
      </template>

      <div class="text-center">
        <p class="text-2xl font-bold">
          {{ match.homeScore }} - {{ match.awayScore }}
        </p>
      </div>

      <div class="mt-4">
        <h3 class="font-bold">
          Match Events
        </h3>
        <ul>
          <li v-for="event in match.events" :key="event.minute">
            {{ event.minute }}' - {{ event.eventType }}
          </li>
        </ul>
      </div>
    </UCard>
  </UModal>
</template>
