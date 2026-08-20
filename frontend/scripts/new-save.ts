/**
 * Creates a save from the command line, so the headless drivers can run without
 * the HTTP layer.
 *
 * Deliberately thin: the reset itself is `createSave()`, the same function
 * `POST /api/game/start` calls, so a verification run and a real game start
 * from identical state.
 */
import { eq } from 'drizzle-orm'
import { db } from '../server/db'
import { teams } from '../server/db/schema'
import { createSave } from '../server/core/save'

export async function newSave(teamName?: string) {
  const clubs = await db.query.teams.findMany()
  const club = teamName
    ? clubs.find(row => row.name.toLowerCase().includes(teamName.toLowerCase()))
    : clubs[0]

  if (!club) throw new Error(`No club matching "${teamName}"`)

  const created = await createSave({ teamId: club.id })
  const refreshed = await db.query.teams.findFirst({ where: eq(teams.id, club.id) })

  return { club: refreshed ?? club, game: created }
}

if (import.meta.main) {
  const { club } = await newSave(process.argv[2])
  console.log(`Save created — ${club.name} (rep ${club.reputation}, balance ${club.bankBalance.toLocaleString('en-IE')})`)
  process.exit(0)
}
