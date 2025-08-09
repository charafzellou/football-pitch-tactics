import { db } from '../../server/db'
import { players, teams } from '../../server/db/schema'
import { eq, gt, ne } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { playerId, action } = await readBody(event)
  if (action !== 'sell') {
    throw createError({ statusCode: 400, statusMessage: 'Invalid action' })
  }
  // Get player
  const player = await db.query.players.findFirst({ where: eq(players.id, playerId) })
  if (!player) throw createError({ statusCode: 404, statusMessage: 'Player not found' })
  // Get seller team
  const sellerTeam = await db.query.teams.findFirst({ where: eq(teams.id, player.teamId) })
  if (!sellerTeam) throw createError({ statusCode: 404, statusMessage: 'Seller team not found' })
  // Find random buyer team with enough funds and not the seller
  const possibleBuyers = await db.query.teams.findMany({
    where: (t) => ne(t.id, sellerTeam.id) && gt(t.bankBalance, player.marketValue),
  })
  if (!possibleBuyers.length) throw createError({ statusCode: 400, statusMessage: 'No team can afford this player.' })
  const buyerTeam = possibleBuyers[Math.floor(Math.random() * possibleBuyers.length)]
  // Transfer player and update funds
  await db.transaction(async (tx) => {
    await tx.update(players).set({ teamId: buyerTeam.id }).where(eq(players.id, playerId))
    await tx.update(teams).set({ bankBalance: sellerTeam.bankBalance + player.marketValue }).where(eq(teams.id, sellerTeam.id))
    await tx.update(teams).set({ bankBalance: buyerTeam.bankBalance - player.marketValue }).where(eq(teams.id, buyerTeam.id))
  })
  return { success: true, buyerTeam: buyerTeam.name }
})
