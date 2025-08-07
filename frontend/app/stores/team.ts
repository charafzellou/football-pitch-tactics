import { defineStore } from 'pinia'

export const useTeamStore = defineStore('team', {
  state: () => ({
    squad: [] as Array<{
      id: number
      name: string
      age: number
      position: string
      skillLevel: number
      stamina: number
      marketValue: number
      teamId: number
    }>,
    bankBalance: 0,
    tactics: '',
  }),
  actions: {
    async fetchTeam(teamId: number) {
      const team = await $fetch(`/api/team/${teamId}`)
      if (team) {
        this.squad = team.squad
        this.bankBalance = team.bankBalance ?? 0
        this.tactics = team.tactics ?? ''
      }
    },
  },
})
