export default defineNuxtRouteMiddleware(async (to) => {
  const requiresActiveGame = to.path.startsWith('/game') || to.path.startsWith('/matchday')

  if (!requiresActiveGame)
    return

  const gameStore = useGameStore()
  await gameStore.initialize()

  if (!gameStore.userTeamId)
    return navigateTo('/new-game')
})