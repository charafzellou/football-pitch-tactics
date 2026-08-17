/**
 * The club news feed.
 *
 * Board confidence, fan confidence and the transfer market all move numbers;
 * these rows are what say *why*. Written from the same code paths that move
 * those numbers so a reaction can never appear without the thing it reacts to.
 */
import { desc, eq, lt } from 'drizzle-orm'
import { db } from '../db'
import { clubNews } from '../db/schema'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type NewsCategory = 'board' | 'fans' | 'transfer' | 'contract' | 'result'
export type NewsTone = 'positive' | 'negative' | 'neutral'

export interface NewsItem {
  season: number
  round?: number
  category: NewsCategory
  tone?: NewsTone
  headline: string
  body?: string
}

export async function postNews(client: Tx | typeof db, items: NewsItem[]): Promise<void> {
  if (!items.length) return

  const now = new Date()

  await client.insert(clubNews).values(items.map(item => ({
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
export async function recentNews(limit = 20) {
  return db.query.clubNews.findMany({
    orderBy: [desc(clubNews.id)],
    limit,
  })
}

/**
 * Drops everything from seasons before `season`.
 *
 * The feed is a running commentary, not an archive — `season_summary` is what
 * preserves history. Without this a long save accumulates thousands of rows the
 * dashboard would never show.
 */
export async function pruneNews(season: number): Promise<void> {
  await db.delete(clubNews).where(lt(clubNews.season, season))
}

export { clubNews, eq }
