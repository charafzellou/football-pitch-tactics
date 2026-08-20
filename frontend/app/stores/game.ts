import { defineStore } from 'pinia'

export const useGameStore = defineStore('game', {
  state: () => ({
    season: '2024/2025',
    year: 2024,
    userTeamId: null as number | null,
    /**
     * Set once the board has sacked the manager. The save is over at that
     * point — the route guard funnels every `/game*` and `/matchday` route to
     * the verdict screen, and the server refuses anything that would advance
     * or mutate the world.
     */
    dismissedAtSeason: null as number | null,
  }),
  getters: {
    dismissed: state => state.dismissedAtSeason !== null,
  },
  actions: {
    async initialize() {
      const state = await $fetch('/api/game/state')
      this.userTeamId = state?.playerTeamId ?? null
      this.dismissedAtSeason = state?.dismissedAtSeason ?? null
    },
  },
})
