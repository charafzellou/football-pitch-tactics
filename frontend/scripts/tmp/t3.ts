import { and, eq } from 'drizzle-orm'
import { db } from '../../server/db'
import { game, players, teams, financeLedger } from '../../server/db/schema'
import { playSeason } from '../sim-season'
import { rollOverSeason } from '../../server/core/season'

// Real Madrid, sacking off for this run.
const club = await db.query.teams.findFirst({ where: eq(teams.name, 'Real Madrid') })
if (!club) throw new Error('no club')

await db.delete(game)
await db.insert(game).values({
  playerTeamId: club.id, season: 1, currentDate: new Date(),
  sackingEnabled: 0, boardExpectation: 2,
})

console.time('season')
await playSeason()
console.timeEnd('season')

const before = await db.query.players.findMany({ where: and(eq(players.teamId, club.id), eq(players.retired, 0), eq(players.freeAgent, 0)) })
const expiring = before.filter(p => p.contractUntilSeason <= 1)
console.log(`\nSquad ${before.length}, expiring ${expiring.length}:`, expiring.slice(0, 5).map(p => `${p.name}(${p.age})`).join(', '))

const balBefore = (await db.query.teams.findFirst({ where: eq(teams.id, club.id) }))!.bankBalance

const summary = await rollOverSeason()
console.log('\n--- ROLLOVER ---')
console.log('finish', JSON.stringify(summary.playerFinish), 'prize', summary.playerPrizeMoney)
console.log('retired', summary.retirementCount, 'released', summary.releasedCount, 'freeAgentSignings', summary.freeAgentSigningCount, 'youth', summary.youthCount)
console.log('own departures:', summary.ownDepartures.map(d => `${d.name} ${d.age}y ${d.skillLevel}`).join(' | ') || 'none')

const after = await db.query.players.findMany({ where: and(eq(players.teamId, club.id), eq(players.retired, 0), eq(players.freeAgent, 0)) })
const freeAgents = await db.query.players.findMany({ where: and(eq(players.retired, 0), eq(players.freeAgent, 1)) })
console.log(`squad ${before.length} -> ${after.length}; free agents in world: ${freeAgents.length}`)
console.log('free agent wages non-zero:', freeAgents.filter(p => p.wage !== 0).length)
console.log('best free agents:', freeAgents.sort((a,b)=>b.skillLevel-a.skillLevel).slice(0,5).map(p=>`${p.name} ${p.skillLevel} ${p.age}y`).join(' | '))

const prize = await db.query.financeLedger.findMany({ where: and(eq(financeLedger.teamId, club.id), eq(financeLedger.type, 'prize')) })
console.log('prize ledger rows:', prize.map(r => `${r.amount} ${r.description}`).join(' | '))
const balAfter = (await db.query.teams.findFirst({ where: eq(teams.id, club.id) }))!.bankBalance
console.log(`balance ${balBefore} -> ${balAfter} (delta ${balAfter - balBefore})`)

const g = await db.query.game.findFirst()
console.log('game:', { season: g!.season, board: g!.boardConfidence, fans: g!.fanConfidence, expectation: g!.boardExpectation, streak: g!.confidenceStreak, dismissed: g!.dismissedAtSeason })

const news = await db.query.clubNews.findMany({ limit: 8, orderBy: (n, { desc }) => [desc(n.id)] })
console.log('\nnews:'); for (const n of news) console.log(` [${n.tone}] ${n.headline} — ${n.body ?? ''}`)
