/**
 * The club news feed.
 *
 * Board confidence, fan confidence and the transfer market all move numbers;
 * these rows are what say *why*. Written from the same code paths that move
 * those numbers so a reaction can never appear without the thing it reacts to.
 *
 * Every row belongs to exactly one save (`game_id`) — the feed used to have
 * no owner column at all, so every save's browser saw every other save's
 * board reactions mixed together in one global list.
 */
import { and, desc, eq, lt } from 'drizzle-orm'
import { db } from '../db'
import { clubNews } from '../db/schema'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type NewsCategory = 'board' | 'fans' | 'transfer' | 'contract' | 'result' | 'finance'
export type NewsTone = 'positive' | 'negative' | 'neutral'

export interface NewsItem {
  season: number
  round?: number
  category: NewsCategory
  tone?: NewsTone
  headline: string
  body?: string
}

export async function postNews(client: Tx | typeof db, gameId: number, items: NewsItem[]): Promise<void> {
  if (!items.length) return

  const now = new Date()

  await client.insert(clubNews).values(items.map(item => ({
    gameId,
    season: item.season,
    round: item.round ?? 0,
    category: item.category,
    tone: item.tone ?? 'neutral',
    headline: item.headline,
    body: item.body ?? null,
    createdAt: now,
  })))
}

/** Most recent first. */
export async function recentNews(gameId: number, limit = 20) {
  return db.query.clubNews.findMany({
    where: eq(clubNews.gameId, gameId),
    orderBy: [desc(clubNews.id)],
    limit,
  })
}

/**
 * Drops everything from seasons before `season`, for one save.
 *
 * The feed is a running commentary, not an archive — `season_summary` is what
 * preserves history. Without this a long save accumulates thousands of rows the
 * dashboard would never show.
 */
export async function pruneNews(gameId: number, season: number): Promise<void> {
  await db.delete(clubNews).where(and(eq(clubNews.gameId, gameId), lt(clubNews.season, season)))
}

export { clubNews, eq }
