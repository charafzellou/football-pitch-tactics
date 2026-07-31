# TASKS — Proposed Improvements

Each task below is written in enough detail for an AI sub-agent to implement autonomously. They are ordered roughly by impact, but are independent unless noted.

---

## TASK-01 · Fix Position String Mismatch in Match Engine

**Priority:** Critical (correctness)  
**Files:** `frontend/server/core/match-engine.ts`

**Problem:**  
`selectLineup()` filters the squad using full English position names (`"Goalkeeper"`, `"Defender"`, `"Midfielder"`, `"Forward"`, `"Attacker"`). However, the seed data stores abbreviated positions: `"GK"`, `"DEF"`, `"MID"`, `"ATT"`. This means all position pools except the forward fallback are empty; the engine effectively picks random players regardless of position.

**Fix:**  
Update `selectLineup()` to normalise incoming `player.position` strings before filtering. Apply the same normalisation used in `pages/game/index.vue`:

```typescript
function normalisePos(raw: string): 'GK' | 'DF' | 'MF' | 'FW' | null {
  const s = String(raw ?? '').toUpperCase().trim()
  if (['GOALKEEPER', 'GK'].includes(s)) return 'GK'
  if (['DEFENDER', 'DEF', 'DF'].includes(s)) return 'DF'
  if (['MIDFIELDER', 'MID', 'MF'].includes(s)) return 'MF'
  if (['FORWARD', 'ATTACKER', 'ATT', 'FW'].includes(s)) return 'FW'
  return null
}
```

Then replace the four hardcoded string filters in `selectLineup()` with `normalisePos(p.position) === 'GK'` etc.

**Test:** After fix, a 4-4-2 lineup should contain exactly 1 GK, 4 DEF, 4 MF, 2 FW from the highest-skilled players in each pool.

---

## TASK-02 · Fix Card Event Icon Mismatch on Matchday

**Priority:** High (visual correctness)  
**Files:** `frontend/app/pages/matchday/index.vue`

**Problem:**  
The seed `event_type` table uses event names `'yellow'` and `'red'`, but `eventIcon()` checks for `'yellow_card'` and `'red_card'`. Card events therefore render the fallback `i-lucide-zap` icon instead of the coloured square icon.

**Fix:**  
Update the `eventIcon()` and `eventIconClass()` helper functions to check for both forms:

```typescript
function eventIcon(type: string): string {
  const t = String(type).toLowerCase()
  if (t === 'goal') return 'i-lucide-circle-dot'
  if (t === 'yellow' || t === 'yellow_card') return 'i-lucide-square'
  if (t === 'red' || t === 'red_card') return 'i-lucide-square'
  if (t === 'substitution' || t === 'sub') return 'i-lucide-arrow-left-right'
  if (t === 'foul') return 'i-lucide-flag'
  if (t === 'injury') return 'i-lucide-heart-crack'
  return 'i-lucide-zap'
}

function eventIconClass(type: string): string {
  const t = String(type).toLowerCase()
  if (t === 'goal') return 'text-emerald-400'
  if (t === 'yellow' || t === 'yellow_card') return 'text-amber-400'
  if (t === 'red' || t === 'red_card') return 'text-red-500'
  if (t === 'substitution' || t === 'sub') return 'text-sky-400'
  if (t === 'foul') return 'text-orange-400'
  if (t === 'injury') return 'text-rose-400'
  return 'text-white/50'
}
```

---

## TASK-03 · Implement Transfer History

**Priority:** Medium (feature completeness)  
**Files:**
- `frontend/server/db/schema.ts` — add `transfers` table
- `frontend/server/db/migrations/` — generate migration
- `frontend/server/api/transfers.post.ts` — log each transfer
- `frontend/server/api/transfers/history.get.ts` — return real data
- `frontend/app/pages/game/transfers.vue` — add a history section

**Specification:**

Add a `transfers` table:
```typescript
export const transfers = sqliteTable('transfers', {
  id: integer('id').primaryKey(),
  playerId: integer('player_id').notNull().references(() => players.id),
  fromTeamId: integer('from_team_id').notNull().references(() => teams.id),
  toTeamId: integer('to_team_id').notNull().references(() => teams.id),
  transferValue: integer('transfer_value').notNull(),
  action: text('action').notNull(), // 'buy' | 'sell'
  occurredAt: integer('occurred_at', { mode: 'timestamp' }).notNull(),
})
```

In `transfers.post.ts`, after the DB transaction succeeds, insert a row into `transfers`.

In `transfers/history.get.ts`:
```typescript
// GET /api/transfers/history?limit=20
// Returns the most recent transfers involving game.playerTeamId
```

On the Transfers page, below the search results, render a "Recent Activity" section showing the last 10 transfers (player name, from/to club, price, date, buy/sell badge).

---

## TASK-04 · Fix Schedule Date Generation — Use Realistic Fixture Dates

**Priority:** Medium (realism)  
**Files:** `frontend/server/db/seed.ts`

**Problem:**  
The schedule generator calls `faker.date.future()` for each fixture. This produces random dates spread across the next year with no season structure — fixtures may appear wildly out of order or cluster in unplayable ways.

**Fix:**  
Replace `faker.date.future()` with a deterministic date calculation. A real season runs August–May. Generate fixture dates as follows:

```typescript
const SEASON_START = new Date('2024-08-10')

function fixtureDate(roundIndex: number, matchIndexInRound: number): Date {
  const d = new Date(SEASON_START)
  // One round per week, stagger matches within a round by 2 hours
  d.setDate(d.getDate() + roundIndex * 7)
  d.setHours(12 + matchIndexInRound * 2)
  return d
}
```

Update the `generateSchedule()` loop to pass the round index and match-within-round index to `fixtureDate`.

---

## TASK-05 · Stamina System — Fatigue and Recovery

**Priority:** Medium (gameplay depth)  
**Files:**
- `frontend/server/api/match/simulate.post.ts` — reduce stamina after match
- New endpoint `POST /api/game/next-day` — recover stamina (already exists, needs stamina logic)
- `frontend/app/pages/game/index.vue` — show stamina warning for fatigued players
- `frontend/app/pages/game/team.vue` — highlight low-stamina players in red

**Specification:**

After each match simulation, reduce stamina for all players who participated in the lineup:
```
newStamina = max(0, currentStamina - random(10, 25))
```

Players not in the lineup lose 0 stamina (they rested).

Each day passed (`POST /api/game/next-day`) recovers stamina for all players:
```
newStamina = min(100, currentStamina + 8)
```

In the Dashboard's lineup builder, display a warning badge (`text-amber-400`) if a player's stamina is below 60. Stamina should also affect match performance in the engine:

```typescript
// In calculateTeamStats:
const staminaFactor = lineup.reduce((acc, p) => acc + p.stamina, 0) / (lineup.length * 100)
return {
  attack:  avgSkill * staminaFactor + tactic.modifiers.attack,
  defence: avgSkill * staminaFactor + tactic.modifiers.defence,
}
```

---

## TASK-06 · Injury System — Player Availability

**Priority:** Medium (gameplay depth)  
**Files:**
- `frontend/server/db/schema.ts` — add `injured_until` column to `players`
- `frontend/server/api/match/simulate.post.ts` — set injury end date when injury event occurs
- `frontend/server/api/schedule.get.ts` — include player availability in response
- `frontend/app/pages/game/index.vue` — grey out injured players in the lineup builder

**Specification:**

Add to `players` table:
```typescript
injuredUntil: integer('injured_until', { mode: 'timestamp' }).default(null)
```

When an `injury` event is generated during simulation, set `injuredUntil = now + random(7, 28) days` for the affected player.

In the lineup builder, a player with `injuredUntil > game.currentDate` is shown as unavailable with an `i-lucide-heart-crack` icon and cannot be selected (reason: `"Injured until {date}"`).

Players recover when `game.currentDate > injuredUntil` (handled naturally — no cron needed).

---

## TASK-07 · Season End Detection and Progression

**Priority:** High (game completeness)  
**Files:**
- `frontend/server/api/schedule.get.ts` — expose a `seasonComplete` flag
- New endpoint `POST /api/game/advance-season`
- `frontend/app/pages/game/index.vue` — show season-end screen when all fixtures played
- `frontend/app/pages/game/standings.vue` — highlight champion

**Specification:**

In `GET /api/schedule`, after building the fixture list, also query:
```sql
SELECT COUNT(*) FROM matches WHERE season = gameState.season AND played = 0
  AND (home_team_id = playerTeamId OR away_team_id = playerTeamId)
```
Return `{ schedule, seasonComplete: count === 0 && totalFixtures > 0 }`.

On the Dashboard, when `seasonComplete === true`, show a full-width card:
- Display the league champion (top of standings).
- If the player's team finished 1st, show a trophy icon with congratulations text.
- A "Start Next Season" button.

`POST /api/game/advance-season`:
1. Marks current `season.ended = 'true'`.
2. Finds the next season row (e.g. `season.year = currentYear + 1`).
3. Updates `game.season` to the new season ID.
4. Generates a new fixture list for all leagues for the new season and inserts into `matches`.
5. Resets `currentDate` to the first fixture date of the new season.

---

## TASK-08 · Multiple Save Slots

**Priority:** Low (quality of life)  
**Files:**
- `frontend/server/db/schema.ts` — add `saveSlot` column to `game` (allow multiple rows)
- All API routes that call `db.query.game.findFirst()` — pass slot ID
- `frontend/app/pages/index.vue` — show existing save slots with continue option
- `frontend/app/pages/new-game.vue` — select save slot or create new

**Specification:**

The `game` table currently enforces a single save by deleting all rows on start. Remove the `await db.delete(game)` call and instead add a `slot: integer` column (1–3). Allow up to 3 simultaneous saves.

A save-slot picker component should appear on the home page. Each slot shows: team name, league, current date, last played (from a new `updatedAt` timestamp column). An empty slot shows "New Game".

All API routes that currently call `findFirst()` on `game` need to accept a `?slot=1` query param to identify which save is active. The client stores the active slot in localStorage or a Pinia store.

---

## TASK-09 · Player Development — Ageing and Progression

**Priority:** Low (long-term gameplay)  
**Files:**
- `frontend/server/api/game/advance-season` (TASK-07 prerequisite)
- `frontend/server/db/schema.ts` — add `potential` column to `players`
- `frontend/server/api/game/next-day.post.ts` — apply weekly skill progression

**Specification:**

Add a `potential: integer` column to `players` (range 60–99) set randomly at seed time.

At season end (triggered by `POST /api/game/advance-season`):
- All players age by 1.
- Players aged 16–24 whose `skillLevel < potential` gain `random(1, 3)` skill.
- Players aged 29+ lose `random(0, 2)` skill.
- Players aged 36+ retire (removed from squad; club receives no compensation).

Market values should update proportionally to skill changes:
```
newMarketValue = currentMarketValue × (newSkillLevel / oldSkillLevel) × ageFactor
ageFactor = age <= 27 ? 1.05 : age <= 32 ? 0.95 : 0.80
```

---

## TASK-10 · Transfer Search Filters

**Priority:** Medium (usability)  
**Files:**
- `frontend/server/api/players/search.get.ts` — support additional query params
- `frontend/app/pages/game/transfers.vue` — add filter controls

**Specification:**

Extend `GET /api/players/search` to accept:
- `position` — filter by normalised position (`GK` | `DEF` | `MID` | `ATT`)
- `minSkill` / `maxSkill` — skill range filter
- `maxValue` — only show affordable players (can pass `availableBudget`)
- `sortBy` — `skillLevel` | `marketValue` | `age` (default: `skillLevel desc`)

In the UI, add a collapsible filter panel above the search results with:
- A position toggle group (All / GK / DEF / MID / ATT)
- A max price toggle ("Affordable only")
- A skill minimum slider

---

## TASK-11 · Home Advantage Modifier

**Priority:** Low (realism)  
**Files:** `frontend/server/core/match-engine.ts`

**Specification:**

Apply a small home advantage bonus to the home team's attack and defence stats:

```typescript
const HOME_ADVANTAGE = 2.5

// In simulateMatch(), after calculateTeamStats:
homeStats.attack  += HOME_ADVANTAGE
homeStats.defence += HOME_ADVANTAGE * 0.5
```

This makes home matches ~5–10% more likely to be won by the home team.

---

## TASK-12 · Real-time Match Commentary Text

**Priority:** Low (polish)  
**Files:** `frontend/app/pages/matchday/index.vue`

**Problem:**  
The event feed shows bare event type strings (`goal`, `yellow`, etc.). Replace these with varied commentary snippets.

**Specification:**

Add a `generateCommentary(eventType, playerName, teamName, minute)` function with template strings:

```typescript
const COMMENTARY: Record<string, string[]> = {
  goal: [
    '{player} fires home for {team}!',
    'GOAL! {player} makes it {minute} minutes on the clock.',
    '{team} are ahead — {player} with the finish!',
  ],
  yellow: [
    '{player} is booked. One more and they\'re off.',
    'Yellow card shown to {player} of {team}.',
  ],
  // ...
}
```

Pick a random template per event and fill in the variables.

---

## TASK-13 · AI Team Transfer Activity Between Seasons

**Priority:** Low (ecosystem simulation)  
**Files:**
- `frontend/server/api/game/advance-season` (TASK-07 prerequisite)

**Specification:**

At season end, for each AI team:
1. Identify the 2 weakest players in the squad (by `skillLevel`).
2. Release them (mark as free agents — a new table or `teamId = NULL`).
3. With 20% of `bankBalance`, buy 2 free agents or the cheapest available players that fit positional needs.

This keeps the transfer market active and prevents all strong players concentrating at one club over time.

---

## TASK-14 · Cup Competition (Knockout Tournament)

**Priority:** Low (gameplay variety)  
**Files:**
- `frontend/server/db/schema.ts` — add `competitions` and `cup_rounds` tables
- New endpoints: `POST /api/cup/simulate-round`, `GET /api/cup/bracket`
- New page: `frontend/app/pages/game/cup.vue`
- `frontend/app/components/Sidebar.vue` — add "Cup" nav link

**Specification:**

A simple 16-team single-elimination cup runs alongside the league, starting in December.

`competitions` table: `{ id, name, season, type: 'cup' | 'league' }`  
`cup_matches` table: `{ id, competitionId, round, homeTeamId, awayTeamId, homeScore, awayScore, played }`

The cup bracket page shows the draw and results for each round. When the player's team is scheduled for a cup match, the Dashboard shows a second "Cup Fixture" card below the league fixture.

---

## TASK-15 · Wage System and Weekly Finances

**Priority:** Low (economic depth)  
**Files:**
- `frontend/server/db/schema.ts` — add `weeklyWage` to `players`
- `frontend/server/api/game/next-day.post.ts` — deduct wages on week boundary
- `frontend/app/pages/game/team.vue` — show wage column
- `frontend/app/pages/game/index.vue` — show weekly wage bill in Club Status

**Specification:**

Add `weeklyWage: integer` to `players`, calculated at seed time:
```
weeklyWage = round(marketValue / 260)  // approx 5-year contract amortised
```

Each time `POST /api/game/next-day` is called, if the new date is a Monday:
```
weeklyWages = sum(squad.weeklyWage)
team.bankBalance -= weeklyWages
```

If `bankBalance` goes negative, show a warning notification. Add a `wageProtection` guard: if `bankBalance < weeklyWages * 4`, disable the "Buy" button in the transfer market.

---

## TASK-16 · Improve Match Simulation Realism

**Priority:** Medium (gameplay feel)  
**Files:** `frontend/server/core/match-engine.ts`

**Specification:**

Several improvements to the simulation algorithm:

1. **Momentum system:** Track `matchMomentum` (-10 to +10). After each goal, momentum swings +3 toward the scoring team. Attacking chance is multiplied by `(1 + momentum/100)`.

2. **Fatigue curve:** Reduce attack chance by `1 - (minute / 90) * 0.1` in the second half — teams tire.

3. **Red card effect:** When a `red` event is generated, remove the player from the lineup. The weakened team's stats should be recalculated.

4. **More realistic goal rates:** Currently goals are rare because `chance > 70` is required. The average should be ~2.6 goals per match. Calibrate the thresholds with this target.

5. **Set pieces:** Add a `corner` event type. When a shot misses, 30% chance of a corner, which generates a 20% chance of a goal header (heading goal event type).

---

## TASK-17 · Notification Centre / Match Feed

**Priority:** Low (polish)  
**Files:**
- `frontend/app/stores/notifications.ts` — extend the existing (unused) store
- New component: `frontend/app/components/NotificationFeed.vue`
- `frontend/app/layouts/default.vue` — mount the feed

**Specification:**

The existing `useNotificationsStore` is unused. Wire it up so all `useToast()` calls in `team.vue` and `transfers.vue` **also** push to the store's history array. Notifications should persist until dismissed.

Add a bell icon button (`i-lucide-bell`) to the Sidebar with an unread count badge. Clicking it opens a slide-over panel showing the last 20 notifications with timestamps.

---

## TASK-18 · AI Tactic Variety

**Priority:** Low (realism)  
**Files:** `frontend/server/db/seed.ts`

**Specification:**

During seeding, assign a random tactic to each AI team instead of leaving `tactics = NULL`:

```typescript
const tacticNames = ['4-4-2', '4-5-1', '4-3-3', '3-5-2']
const assignedTactic = tacticNames[Math.floor(Math.random() * tacticNames.length)]

await db.insert(schema.teams).values({
  ...,
  tactics: assignedTactic,
})
```

This gives each AI team a distinct identity (the 3-5-2 teams will be more volatile; the 4-5-1 teams harder to score against) and makes the simulation results more varied.

---

## TASK-19 · Player Statistics Tracking

**Priority:** Medium (game depth)  
**Files:**
- `frontend/server/db/schema.ts` — add `player_stats` table
- `frontend/server/api/match/simulate.post.ts` — populate stats from events
- New endpoint: `GET /api/player/:id/stats`
- New page: `frontend/app/pages/game/player/[id].vue`

**Specification:**

```typescript
export const playerStats = sqliteTable('player_stats', {
  id: integer('id').primaryKey(),
  playerId: integer('player_id').notNull().references(() => players.id),
  season: integer('season').notNull().references(() => season.id),
  goals: integer('goals').notNull().default(0),
  yellowCards: integer('yellow_cards').notNull().default(0),
  redCards: integer('red_cards').notNull().default(0),
  matchesPlayed: integer('matches_played').notNull().default(0),
})
```

After each match simulation, upsert `player_stats` for all players in the two lineups.

Add a player detail page at `/game/player/:id` showing a career stats table (goals, cards, appearances) per season.

In the squad table (`/game/team`), make player names clickable links to their detail page.

---

## TASK-20 · Docker Production Hardening

**Priority:** Low (ops)  
**Files:** `Dockerfile`, `docker-compose.yaml`, `nginx/nginx.conf`

**Problem:**  
The SQLite DB file is not persisted across container restarts. The Dockerfile does not run `db:setup` as part of the container startup.

**Specification:**

1. Add a Docker volume for the SQLite file: `./data:/app/db`.
2. Update `drizzle.config.ts` and `server/db/index.ts` to use the env var `DATABASE_URL` (defaulting to `file:./db.sqlite`) so the path is configurable.
3. Add an entrypoint script `docker-entrypoint.sh` that runs `bun run db:setup` only if `db.sqlite` does not exist, then starts the Nuxt server.
4. Add a `HEALTHCHECK` instruction to the Dockerfile.
5. Set `NODE_ENV=production` and ensure `nuxt.config.ts` disables devtools in production mode.
