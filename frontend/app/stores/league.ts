import { defineStore } from 'pinia'

export const useLeagueStore = defineStore('league', {
  state: () => ({
    schedule: [] as Array<{ date: string; teams: string[] }>,
    standings: [] as Array<{ team: string; points: number }>,
  }),
  actions: {
    async fetchSchedule() {
      this.schedule = await $fetch<Array<{ date: string; teams: string[] }>>('/api/schedule')
    },
    async fetchStandings(leagueId: number) {
      this.standings = await $fetch<Array<{ team: string; points: number }>>(`/api/standings?leagueId=${leagueId}`)
    },
  },
})
