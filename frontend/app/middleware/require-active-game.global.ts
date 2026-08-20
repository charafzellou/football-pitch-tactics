const DISMISSAL_SCREEN = '/game/dismissed'

export default defineNuxtRouteMiddleware(async (to) => {
  const requiresActiveGame = to.path.startsWith('/game') || to.path.startsWith('/matchday')

  if (!requiresActiveGame)
    return

  const gameStore = useGameStore()
  await gameStore.initialize()

  if (!gameStore.userTeamId)
    return navigateTo('/new-game')

  /**
   * A dismissed save is finished, not merely restricted.
   *
   * `dismissed_at_season` used to be written and never read, so the sack was
   * invisible: the dashboard still offered Matchday, the transfer market still
   * took bids, and the manager carried on as though nothing had happened. Every
   * route now funnels to the one screen that reads as an ending — and the server
   * enforces the same rule, so this is a redirect for the sake of the player
   * rather than the only thing holding the line.
   */
  if (gameStore.dismissed && to.path !== DISMISSAL_SCREEN)
    return navigateTo(DISMISSAL_SCREEN)

  if (!gameStore.dismissed && to.path === DISMISSAL_SCREEN)
    return navigateTo('/game')
})
