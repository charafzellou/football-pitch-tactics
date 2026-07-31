# Frontend

The frontend is a Nuxt 4 application using the `app/` directory convention. Everything under `frontend/app/` is the Vue SPA layer.

---

## Pages

All pages live under `frontend/app/pages/` and are auto-registered by Nuxt's file-based router.

### `/` — `pages/index.vue`
**Purpose:** Landing / home screen.

**Behaviour:**
- Renders a centred hero card with animated fade-in.
- Single CTA button → navigates to `/new-game`.
- No API calls.

---

### `/new-game` — `pages/new-game.vue`
**Purpose:** New save wizard. Player selects country → league → club.

**Data fetched:**
- `GET /api/countries` — country list
- `GET /api/leagues?countryId` — leagues for selected country
- `GET /api/teams?leagueId` — teams for selected league

**Reactive cascade:** `watch(selectedCountry)` triggers `refreshLeagues()`; `watch(selectedLeague)` triggers `refreshTeams()`.

**On submit:** Calls `POST /api/game/start` with `{ teamId }` then navigates to `/game`.

**UI notes:** Animated 3-step indicator (Country / League / Club) using `animate-fade-in-up`; each dropdown fades in via Vue `<Transition>`.

---

### `/game` — `pages/game/index.vue`
**Purpose:** Main dashboard. Shows club status, next match, and the lineup builder.

**Data fetched (on mount):**
- `GET /api/game/state` → player team ID
- `GET /api/team/:playerTeamId` → squad + bank balance
- `GET /api/schedule` → next upcoming fixture
- `GET /api/standings?leagueId` → league table for position
- `GET /api/team/:awayTeamId` → opponent details
- `GET /api/tactics` → available formations

**Key computed state:**

| Name | Description |
|---|---|
| `squadPlayers` | Full squad array from team data |
| `selectedSquadPlayers` | Players in the current lineup selection, sorted GK→DF→MF→FW |
| `formationRequirements` | `{ GK, DF, MF, FW }` slot counts from selected tactic |
| `selectedPositionCounts` | How many of each position are currently selected |
| `pitchRows` | Ordered rows (FW→MF→DF→GK) with slots (filled player or empty) for pitch visualisation |
| `lineupIsComplete` | `true` when exactly 11 players are selected matching formation |
| `lineupMetrics` | Average skill, stamina, age, total value for selected lineup |
| `leaguePosition` | Player's current rank in the standings |

**Player selection logic (`togglePlayerSelection`):**
- If already selected → deselect (always allowed).
- If not selected: checks total ≤ 10, position slot not full, valid tactic selected.
- Changing tactic resets the entire lineup (toast notification).

**On "Go to Matchday":** Saves tactic via `PUT /api/team/:id/tactics`, then navigates to `/matchday`.

---

### `/game/team` — `pages/game/team.vue`
**Purpose:** Full squad view with sell actions.

**Data fetched:** `GET /api/team/:playerTeamId`

**Table columns:** Name, Age, Position (colored badge), Skill Level (stat bar), Stamina (stat bar), Market Value, Sell button.

**Sell action:** Calls `POST /api/transfers { playerId, action: 'sell' }`, refreshes team data, shows toast with buyer name and sale price.

---

### `/game/schedule` — `pages/game/schedule.vue`
**Purpose:** Full fixture list — past and upcoming — for the player's team.

**Data fetched:**
- `GET /api/schedule?includePlayed=true` — all fixtures
- `GET /api/game/state` → player team ID
- `GET /api/team/:playerTeamId` → league ID
- `GET /api/teams?leagueId` → team name lookup map

**Table columns:** Date (ISO), Home Team, Away Team, Score (W/D/L badge or TBD badge).

**Score rendering:** If `homeScore !== null`, shows "N – N" plus a colour-coded result badge from the home team's perspective.

---

### `/game/standings` — `pages/game/standings.vue`
**Purpose:** League table.

**Data fetched:** `GET /api/standings?leagueId`

**Table columns:** Rank (medal icon for top 3), Team, P, W, D, L, GF, GA, GD, Pts.

**Rank computation:** Client-side; `standings.value` is already sorted server-side; a `computed` adds `rank: i + 1`.

---

### `/game/transfers` — `pages/game/transfers.vue`
**Purpose:** Transfer market — search for players to buy; sell your own via the Team page.

**Data fetched:**
- `GET /api/game/state` — player team ID
- `GET /api/team/:playerTeamId` — current bank balance
- `GET /api/players/search?query=` — available players (reactive to search input)

**Search:** Debounced via `encodeURIComponent` of search string. Search results exclude the player's own squad (enforced server-side).

**Buy action:** Shows a `confirm()` dialog → `POST /api/transfers { playerId, action: 'buy' }` → refreshes balance and search results → toast.

**Affordability:** Buy button is disabled if `player.marketValue > availableBudget`.

**Budget tracking:** Uses `useAsyncData` watching `playerTeamId` to prevent stale `€0` balance.

---

### `/matchday` — `pages/matchday/index.vue`
**Purpose:** Live match simulation playback with a virtual clock.

See [matchday.md](../functional/matchday.md) for the full functional description.

**Data fetched:**
- `GET /api/schedule` → next unplayed fixture
- `GET /api/team/:homeTeamId` and `GET /api/team/:awayTeamId` → both squads

**Navigation guard:** `onBeforeRouteLeave` blocks leaving while `hasStarted && !isFinished`, preventing the player from abandoning an in-progress match.

---

## Components

### `components/Sidebar.vue`
The top navigation bar, rendered only on `/game*` routes.

**Desktop:** Inline nav buttons with icons for each section. Active link uses `variant: soft`, inactive uses `variant: ghost`.

**Mobile:** Hamburger toggle reveals a dropdown panel with the same links as a vertical stack. Panel animates in/out via Vue `<Transition>`.

**Active detection:** `isActiveLink(path)` — exact match for `/game`, prefix match for all sub-routes.

---

### `components/MatchReport.vue`
A `UModal` + `UCard` wrapper for displaying a match report. Accepts a `match` prop with `homeScore`, `awayScore`, and `events` array. **Currently not used** by any active route — it was the original match result display before the matchday playback was built.

---

## Layouts

### `layouts/default.vue`
Wraps every page. Shows `<Sidebar>` only when the current route starts with `/game`. The main content area has responsive horizontal padding.

```
┌────────────────────────────────────┐
│  Sidebar (if /game*)               │
├────────────────────────────────────┤
│  <main>  max-w-screen-2xl          │
│    <slot />                        │
└────────────────────────────────────┘
```

---

## Middleware

### `middleware/require-active-game.global.ts`
Runs on **every** route navigation. Guards `/game*` and `/matchday`:

1. If the route does not start with `/game` or `/matchday`, passes through immediately.
2. Calls `gameStore.initialize()` which hits `GET /api/game/state`.
3. If `gameStore.userTeamId` is falsy (no active save), redirects to `/new-game`.

---

## Pinia Stores

Stores are defined in `frontend/app/stores/`. They are available globally via auto-imports.

### `stores/game.ts` — `useGameStore`
Minimal save-state store used primarily by the route guard.

| State | Type | Description |
|---|---|---|
| `season` | string | Hardcoded `'2024/2025'` (not synced from DB) |
| `year` | number | Hardcoded `2024` (not synced from DB) |
| `userTeamId` | `number | null` | Set by `initialize()` from `GET /api/game/state` |

**Actions:**
- `initialize()` — fetches game state and sets `userTeamId`. Called by the global middleware.

**Note:** `season` and `year` are placeholder values not yet driven by actual DB data.

---

### `stores/league.ts` — `useLeagueStore`
Holds schedule and standings data.

| State | Type | Description |
|---|---|---|
| `schedule` | `Array<{ date: string; teams: string[] }>` | Match schedule (loosely typed) |
| `standings` | `Array<{ team: string; points: number }>` | League table (loosely typed) |

**Actions:**
- `fetchSchedule()` — `GET /api/schedule`
- `fetchStandings(leagueId)` — `GET /api/standings?leagueId`

**Note:** This store is defined but pages currently use `useFetch()` directly rather than going through the store. The store is effectively unused at runtime.

---

### `stores/team.ts` — `useTeamStore`
Holds the player's squad.

| State | Type | Description |
|---|---|---|
| `squad` | `Player[]` | Full squad array |
| `bankBalance` | number | Current funds |
| `tactics` | string | Selected formation name |

**Actions:**
- `fetchTeam(teamId)` — `GET /api/team/:teamId`

**Note:** Like `leagueStore`, pages use `useFetch` directly. This store is unused at runtime.

---

### `stores/notifications.ts` — `useNotificationsStore`
A simple auto-dismiss notification system.

| State | Type | Description |
|---|---|---|
| `message` | string | Toast message |
| `type` | `'info' | 'success' | 'warning' | 'error'` | Severity |
| `visible` | boolean | Controls display |

**Actions:**
- `show(message, type)` — Sets message and schedules auto-hide after 3 seconds.

**Note:** Pages use Nuxt UI's `useToast()` directly. This store is also unused at runtime, but could be the foundation for a custom notification component.

---

## `app.config.ts`

Configures Nuxt UI component token defaults. After the UI overhaul it contains only `ui.*` settings — `theme.colors` was removed and all CSS vars now live in `main.css`.

| Key | Value | Effect |
|---|---|---|
| `ui.colors.primary` | `'emerald'` | Green accent throughout |
| `ui.colors.neutral` | `'slate'` | Slate greys for neutral elements |
| `ui.card.slots.root` | `'app-card-root'` | Applies `rounded-3xl overflow-hidden` to all `UCard` roots |
| `ui.card.defaultVariants.variant` | `'subtle'` | All cards use `bg-elevated` background |
| `ui.button.defaultVariants` | `color: 'primary', variant: 'solid'` | Default emerald solid buttons |

---

## `nuxt.config.ts`

```typescript
modules: ["@nuxt/ui", "@pinia/nuxt"]
css: ["@/assets/css/main.css"]
compatibilityDate: '2025-08-07'
```

No SSR-specific config; the app runs as a full SPA in development mode.
