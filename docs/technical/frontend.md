# Frontend

The frontend is a Nuxt 4 application using the `app/` directory convention. Everything under `frontend/app/` is the Vue SPA layer.

## Rendering mode

`ssr: false` — the app is a true SPA.

Every route sits behind the active-save guard and fetches its own state on mount, so server rendering produced an empty shell while actively causing bugs. The lineup builder restores a saved XI from the API, which the server cannot know about; its markup therefore disagreed with the client's on hydration, and because Vue does not rectify mismatches, controls were left stuck in their server-rendered `disabled` state. There is no SEO surface to lose — it is a local single-player game.

The theme is still applied **before first paint** via a synchronous inline script in `<head>` (see [css-styling.md](css-styling.md#no-flash-of-the-wrong-theme)), so SPA mode costs nothing visually.

---

## Pages

### `/` — `pages/index.vue`
Landing screen. Animated pitch-line backdrop, staggered hero, feature strip.

Checks `GET /api/game/state` on mount: if a save exists, **Continue with {club}** becomes the primary action and "Start a new game" is demoted, with a warning that it replaces the save. Previously the only route out of this page was destroying the current game.

---

### `/new-game` — `pages/new-game.vue`
New save wizard: country → league → club.

- Step indicator is a real progress bar with completion checks.
- The cascade selects **the first item of each fetched list**. It previously used hardcoded id switches (`case 1: selectedLeague = 1`), which silently broke for any country beyond the two seeded ones.
- Selecting a club shows a **preview card** (squad size, average rating, average age, transfer funds, star player) from `GET /api/team/:id`.
- `POST /api/game/start` destroys any existing save, so when one exists the Start button opens an `AppConfirmModal` requiring the phrase **"new game"** to be typed.

---

### `/game` — `pages/game/index.vue`
Dashboard: club status, next fixture, and the lineup builder.

**Club Status** — league position, animated bank balance, squad size with injury count, a last-five **form guide**, and **board / supporter confidence** meters. The card footer states the board's target in plain language and escalates a warning as confidence falls ("Your position is under review — 3 of 5 matchdays without confidence"). Both meters and the news trail behind them come from `GET /api/board`; before it existed they were written every matchday and displayed nowhere, so the pressure system was invisible until it ended the save.

**Next Match** — a real head-to-head: opponent name, their league rank, and average-XI-skill comparison bars with a plain-language verdict. (`opponentTeam` was previously fetched in full but only its name was displayed.)

**Lineup builder** (`components/LineupPitch.vue`)
- Pitch markings, mown stripes, floodlight vignette.
- Player tiles carry a conic-gradient skill ring, stamina bar and injury flag.
- **Drag and drop** from the squad table onto the pitch; the legal slot highlights, an illegal drop shakes.
- Controls: **Auto-pick best XI** (reuses `autoSelectLineup()` from `#shared/lineup`), **Save without playing**, **Clear teamsheet** — all with undo toasts.
- Changing formation clears the XI, so it now asks first via `AppConfirmModal` (with undo) rather than doing it silently.
- Selecting a player is **silent on success** — the marker appearing is the feedback. Only a *blocked* selection raises a toast. The old build fired a toast on every single tap.

The builder hydrates only when both `useGameContext().team` and `GET /api/tactics` have resolved. It restores `teams.tactics` and `teams.lineup` together, falling back to `DEFAULT_TACTIC_NAME` only when the saved tactic is absent or unknown. After each successful team-sheet save, it refreshes the keyed `game-context` cache before navigating, preventing a later Dashboard mount from restoring a stale 4-4-2 around the saved XI.

**Readiness checklist** — the "Go to Matchday" button states exactly what is missing ("Pick 1 more defender") instead of just being disabled. When the squad cannot legally fill *any* formation — every one needs a goalkeeper, so all keepers injured is a permanent lockout — a **Field an emergency XI** button appears instead and hands selection to `autoSelectLineup()`. See [tactics.md](../functional/tactics.md#selection-state).

**Squad table** — position tabs, search, availability/fitness filters and sort, via `useSquadFilters`.

---

### `/game/team` — `pages/game/team.vue`
Full squad with sell actions.

- **Squad summary header**: size, average age, average skill, total value, injured count, players below 60% fitness.
- **Selling now requires confirmation.** It was previously a single unguarded click on a permanent, irreversible transfer. The modal states the fee, the resulting balance, and warns when the sale would leave a position below the current formation's requirement.
- Clicking a name opens a **player detail drawer**.
- Confirmation can be disabled in Settings.

---

### `/game/schedule` — `pages/game/schedule.vue`
Fixtures as cards grouped by month, not a table of ISO dates.

Player's club emphasised on both sides; home/away marker; the next fixture is highlighted with a countdown; results are colour-coded W/D/L; All / Upcoming / Played filters with counts; a form strip in the header.

---

### `/game/standings` — `pages/game/standings.vue`
League table.

The player's own row is **highlighted** (previously indistinguishable from the other nineteen). Zone banding for champion / European places / relegation with a legend, a **form column**, points-behind-leader, medal icons for the top three and a gold treatment for the leader. Each row's `teamId` and last-five `form` come directly from `GET /api/standings`; the page does not use the player-scoped schedule or infer team ids from names.

---

### `/game/transfers` — `pages/game/transfers.vue`
Transfer market, plus the inbox for bids received.

- **Offers for your players** sits above the market whenever a bid is pending: the player, the bidding club, the fee against his valuation, how many matchdays remain to decide, and Accept / Reject. See [transfers.md](../functional/transfers.md#offers-for-your-players).
- **Free agents** carry a badge, show "No fee — wages only" in place of a price and budget bar, and open `ContractModal` in `mode="sign"` instead of a purchase confirmation — the decision is the wage, not the fee.
- The native `confirm()` box is replaced by `AppConfirmModal`, showing fee and balance-after.
- Search is **debounced** (350 ms); it previously fired a request per keystroke.
- Position tabs, "affordable only", and sort by skill/value/age. Results capped at 60.
- Each card shows what share of the budget the fee consumes; unaffordable players state the shortfall.
- A completed signing fires confetti.

---

### `/game/finance/*` — five pages under `pages/game/finance/`

The financial section. `FinanceNav.vue` links them using the `app-filter-chip` idiom from the transfer market's tabs; the topbar needs no change, because `isActiveLink()` prefix-matches and every `/game/finance/*` route already lights the Finance pill.

| Route | Page | Backed by |
|---|---|---|
| `/game/finance` | `finance/index.vue` | `GET /api/finance/summary`, `GET /api/finance/loans` |
| `/game/finance/projection` | `finance/projection.vue` | `GET /api/finance/projection` |
| `/game/finance/commercial` | `finance/commercial.vue` | `GET`/`POST /api/finance/commercial` |
| `/game/finance/stadium` | `finance/stadium.vue` | `GET`/`POST /api/finance/stadium`, `PUT /api/team/:id/stadium` |
| `/game/finance/facilities` | `finance/facilities.vue` | `GET`/`POST /api/finance/facilities` |

**Overview** — a health banner (only when something is wrong; a permanent "everything is fine" banner is furniture, not information), balance / turnover / season result / projected close, a profit and loss grouped by `INCOME_GROUPS` and `COST_GROUPS`, wage pressure against turnover, the debt section with borrow and early-settlement controls, and the ledger.

**Projection** — four seasons as an **inline SVG built in a `computed`**, which is the house pattern (`components/matchday/StatsPanel.vue`): there is no chart library, and adding one would break the styling rules. Central line plus a best/worst band, a per-season stream table, risk flags and the budget advisor.

**Commercial** — competing offers per slot with their term, fee and bonus mix; the deals currently running; the perimeter ladder. Selling naming rights is guarded by `AppConfirmModal` because it costs fan confidence.

**Stadium** — crowd and gate, pitch condition with its match penalty, promoter offers and the diary, ticket price, season-ticket terms with a live preview, boxes and expansion. Any booking that touches the pitch confirms first, showing the fee, the wear and the penalty it will cost the team.

**Facilities** — the academy and the training ground, each stated as *what it changes now* → *what it would change*, with an explicit note that neither pays back this season and a link to the projection, which is the only place the decision can be judged.

---

### `/game/history` — `pages/game/history.vue`
Past seasons from `season_summary` (`GET /api/season/history`) — champions per league, the player's finishing position and points, and a titles-won count. Standings are computed on the fly from `matches` and vanish when the next season's fixtures are inserted, so this table is what survives a rollover.

---

### `/game/season-end` — `pages/game/season-end.vue`
The end-of-season screen. Refuses to roll over while fixtures remain (it reports how many, and how many are the player's). Otherwise: final position, then **Start the next season** → `POST /api/season/rollover`, followed by a summary of retirements, youth intake, and the biggest risers and fallers. Confetti on a title.

---

### `/game/dismissed` — `pages/game/dismissed.vue`
The sack. Terminal: the route guard sends every `/game*` and `/matchday` route here while `game.dismissed_at_season` is set, and the topbar is hidden because this is an ending rather than a section of the app.

Shows the board's verdict, the meters at the end, the boardroom news trail that led to it, a tenure summary (seasons, titles, best finish) and the manager's season-by-season record. One action: **Start a new game**. See [gameflow.md § The Board](../functional/gameflow.md).

---

### `/game/settings` — `pages/game/settings.vue`
**New.** Theme picker with live miniatures, an eight-swatch colour editor with WCAG contrast readouts, the generated 50–950 ramps, a live component preview, motion level, audio controls with test buttons, and gameplay defaults. Export/import a palette as JSON. See [css-styling.md](css-styling.md#themes).

---

### `/matchday` — `pages/matchday/index.vue`
Live match playback. The simulation lifecycle is unchanged — see [matchday.md](../functional/matchday.md) — but presentation moved into `components/matchday/*`, leaving the page responsible only for running the match.

The clock uses `useIntervalFn` at `1000 / speed` ms, so the **playback speed control (1× / 2× / 4×)** and "skip to half/full time" drive it directly.

---

## Components

### Shared primitives
| Component | Purpose |
|---|---|
| `AppConfirmModal.vue` | The single confirmation surface for destructive actions, with a `consequences` slot and optional typed-phrase gate |
| `AppStatBar.vue` | Labelled progress bar with threshold colouring — replaces bar markup that was hand-repeated in five files |
| `AppSkeleton.vue` | Shimmer placeholders (text / card / table / list / pitch) |
| `AppEmptyState.vue` | Icon + headline + hint + optional action |
| `AppPositionBadge.vue` | Position badge — replaces **four** drifted `positionColors` maps, one of which keyed on raw `GK/DEF/MID/ATT` while the rest used normalised `GK/DF/MF/FW` |
| `AppCountUp.vue` | Animated number; falls back to the exact value when the document is hidden, since rAF does not run there |
| `FormGuide.vue` | Last-five W/D/L pills |
| `SquadFilters.vue` | Filter bar, pairs with `useSquadFilters` |
| `LineupPitch.vue` | The lineup builder's pitch |
| `ContractModal.vue` | Contract talks — wage/length offer against the player's published demand curve. `mode="renew"` extends a squad player (Team page); `mode="sign"` takes on a free agent (Transfers page). Same panel, same pricing, different commit endpoint |
| `ThemeSwatchEditor.vue` | One editable colour with picker, hex field, presets and contrast readout |

### Matchday
| Component | Purpose |
|---|---|
| `matchday/Hud.vue` | Clock ring, animated score, transport controls, speed selector |
| `matchday/Timeline.vue` | 0–90 strip; home events above the line, away below, clickable markers |
| `matchday/EventFeed.vue` | Commentary, graded by `eventWeight()` so goals are hero rows and routine play recedes; filter chips carry live counts |
| `matchday/LineupPanel.vue` | One side's live XI and bench with inline goal/card/sub/injury markers |
| `matchday/StatsPanel.vue` | Opposing-bar statistics, territory share and a momentum sparkline |
| `matchday/GoalOverlay.vue` | Full-screen GOAL! moment with confetti (dynamically imported); its score is the `applyEvents()` snapshot immediately after that goal |
| `MatchReport.vue` | **Revived.** Was orphaned dead code; now the full-time report — verdict, scorers, statistics, key moments and player of the match |
| `MatchTacticsPanel.vue` | The pause / half-time / injury surface — see below |
| `Sidebar.vue` | Top navigation with sliding active pill, club context strip, mute and theme toggles |

### `MatchTacticsPanel.vue`
Rebuilt around three complaints: you could not tell which player was selected, disabled bench players never said why, and there was no confirm step or undo.

- Selecting a player to come off applies a red-tinted card, a ring and an **OFF** chip.
- Every unavailable bench player **states its reason** inline.
- The footer reads **"Confirm N substitutions"**, distinct from "Discard and resume".
- **Undo last** button, `Ctrl+Z`, and per-row removal.
- Shows OVR and numeric stamina (the `skillLevel` prop was previously passed but never rendered), plus booked/sent-off/injured markers (`bookedIds` was also unused).
- Formation selector with a shape preview and a plain-language diff ("4-5-1 → 4-3-3: −2 midfielders, +2 forwards").
- Substitution allowance as five pips.
- A "tired legs" suggestion using `effectiveSkill()`.

Validation runs through **`substitutionError()` and `applyMidMatchChanges()` from `#shared/match-state`** — the exact functions `POST /api/match/changes` uses. Staged swaps fold in sequence, so the panel's greying-out and the server's rules cannot drift apart.

---

## Composables

| Composable | Purpose |
|---|---|
| `useGameContext()` | Shared save state — game state, team, squad, fixtures, next opponent. State and team resolve in a **single** handler; two watched `useAsyncData` calls raced and left the topbar without a club |
| `useAppToast()` | Toast wrappers that fix colour/icon pairing, add an undo action, and support a "chatty" tier suppressed unless enabled in Settings |
| `useSfx()` | Web Audio sound engine — see below |
| `useMatchStats()` | Derives shots, corners, cards, territory and momentum from the revealed event list. No new endpoint |
| `useSquadFilters()` | Position tabs, search, availability filters and sort |
| `useFinanceSummary()` | The club's profit and loss. Keyed so the overview, the stadium page and the topbar ride one request and refresh together |
| `useFinanceProjection()` | The four-season forecast and the budgets. Shares a key with the projection page, so the transfer market and the contract modal show the same numbers rather than a second estimate that can drift |
| `useFinanceLoans()` | Debt and borrowing terms. Keyed separately because the limit depends on the forecast, and the overview should not pay for it twice |
| `useFinanceFacilities()` | Academy and training-ground levels, and what each does |

### `useSfx()`
Eight cues **synthesised in the browser** from oscillators and filtered noise — no assets to ship, no licensing, works offline. The AudioContext is created on the first cue, since browsers refuse to start one outside a user gesture.

Real recordings can replace any cue without a code change: drop `public/sfx/{name}.mp3` and list the name in `public/sfx/manifest.json`. The manifest ships empty so the lookup never 404s.

---

## Utilities (`app/utils/`)

| File | Contents |
|---|---|
| `themes.ts` | Ramp generation, contrast scoring, token resolution. Re-exports `theme-definitions.ts` |
| `theme-definitions.ts` | Theme data and the pre-paint script. **Dependency-free** so `nuxt.config.ts` can import it |
| `format.ts` | Money, dates, initials, averages. Fixes a real inconsistency — the Dashboard formatted the bank balance in **USD** while Team and Transfers used **EUR** for the same number |
| `table.ts` | `sortableHeader()` — the sortable-column block was copy-pasted **eleven times** — and `positionSortingFn()` |
| `match-events.ts` | Event icons, labels, colours, weighting and filters |
| `results.ts` | W/D/L computation and recent form |
| `format.ts` (additions) | `formatDelta`, `formatPercent` and `moneyColor` were added here rather than inlined — several pages had been inlining all three |

### `shared/finance.ts`

Not a utility but worth naming here: stream labels, icons and groupings (`STREAM_META`), the profit-and-loss group order, the insolvency `HEALTH_STAGES`, the facility tier names, and `affordableFee()`. Shared between server and client deliberately — the server totals ledger streams and the pages label them, and two copies of that map is exactly how "Commercial" comes to mean one thing on the overview and another on the projection.

---

## Stores

### `stores/game.ts` — `useGameStore`
Minimal save-state store used by the route guard. `initialize()` fetches `GET /api/game/state` and keeps `userTeamId` plus `dismissedAtSeason`; the `dismissed` getter is what the guard branches on.

### `stores/settings.ts` — `useSettingsStore`
Player preferences: `themeId`, seed overrides, `motion`, `muted`, `volume`, per-category sound toggles, `playbackSpeed`, `confirmSelling`, `verboseToasts`.

Persisted to `localStorage` under `fpt:settings:v1` — the same shape the pre-paint script reads, so the two must stay in step. Applying a theme writes the resolved primitives onto `document.documentElement`.

**Removed:** `stores/league.ts`, `stores/team.ts` and `stores/notifications.ts` were defined but referenced by nothing at runtime.

---

## Layouts and middleware

### `layouts/default.vue`
Shell wrapper with layered background glows and film grain, a route-change progress bar, and `<Sidebar>` on `/game*` routes — **except `/game/dismissed`**, which hides it: every nav link there would only bounce straight back.

### `middleware/require-active-game.global.ts`
Guards `/game*` and `/matchday`:

- no save → `/new-game`
- save with `dismissedAtSeason` set → `/game/dismissed`
- `/game/dismissed` without a dismissal → back to `/game`

The redirect is for the player's benefit; the server enforces the same rule independently via `requireActiveManager()`, so the guard is not the only thing holding the line.

---

## Accessibility

- `:focus-visible` rings on every interactive element (there were none before).
- `aria-live="polite"` on the score and the event feed; `aria-pressed` on every toggle chip; `aria-label` on icon-only buttons.
- Motion respects `prefers-reduced-motion` **and** an independent in-app setting.
- The theme editor blocks colours that fail WCAG AA against the page background, so a custom palette cannot be made unreadable.

---

## `nuxt.config.ts`

```ts
ssr: false
modules: ["@nuxt/ui", "@pinia/nuxt", "@vueuse/nuxt"]
app.head.htmlAttrs: { class: "dark" }     // Nuxt UI gates dark rules on .dark
app.head.script: [ pre-paint theme snippet ]
app.pageTransition / layoutTransition: "page-fade"
```

## Dependencies added

`@vueuse/core` + `@vueuse/nuxt`, `canvas-confetti` (dynamically imported), `colord` (+ a11y and mix plugins).
