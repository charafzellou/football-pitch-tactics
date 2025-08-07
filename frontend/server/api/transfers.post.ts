import { db } from '../../server/db'
import { players, teams } from '../../server/db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { playerId, sellerTeamId, buyerTeamId } = await readBody(event)

  const player = await db.query.players.findFirst({
    where: eq(players.id, playerId),
  })

  if (!player) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Player not found',
    })
  }

  const buyerTeam = await db.query.teams.findFirst({
    where: eq(teams.id, buyerTeamId),
  })

  if (!buyerTeam || buyerTeam.bankBalance < player.marketValue) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Insufficient funds',
    })
  }

  await db.transaction(async (tx) => {
    await tx
      .update(teams)
      .set({ bankBalance: buyerTeam.bankBalance - player.marketValue })
      .where(eq(teams.id, buyerTeamId))

    const sellerTeam = await tx.query.teams.findFirst({
      where: eq(teams.id, sellerTeamId),
    })

    if (!sellerTeam) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Seller team not found',
      })
    }

    await tx
      .update(teams)
      .set({ bankBalance: sellerTeam.bankBalance + player.marketValue })
      .where(eq(teams.id, sellerTeamId))

    await tx
      .update(players)
      .set({ teamId: buyerTeamId })
      .where(eq(players.id, playerId))
  })

  return { success: true }
})
