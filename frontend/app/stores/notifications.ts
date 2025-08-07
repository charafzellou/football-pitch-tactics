import { defineStore } from 'pinia'

export const useNotificationsStore = defineStore('notifications', {
  state: () => ({
    message: '',
    type: 'info' as 'info' | 'success' | 'warning' | 'error',
    visible: false,
  }),
  actions: {
    show(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') {
      this.message = message
      this.type = type
      this.visible = true
      setTimeout(() => {
        this.visible = false
      }, 3000)
    },
  },
})
