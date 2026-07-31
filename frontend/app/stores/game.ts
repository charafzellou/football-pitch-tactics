import { defineStore } from 'pinia'

export const useGameStore = defineStore('game', {
  state: () => ({
    season: '2024/2025',
    year: 2024,
    userTeamId: null as number | null,
  }),
  actions: {
    async initialize() {
      const state = await $fetch('/api/game/state')
      this.userTeamId = state?.playerTeamId ?? null
    },
  },
})
