# Architecture

## System Overview

Football Pitch Tactics is a browser-based football management game with no login. Any visitor can start a save; who they are is a random UUID in an httpOnly cookie, not an account. It runs entirely on one machine: the Nuxt server serves the Vue SPA and all API logic from one process, with a local SQLite database file shared by every save. Rendering is client-side only — `ssr: false`, see [frontend.md](frontend.md#rendering-mode).

```
Browser ──HTTP + fpt_save cookie──▶  Nuxt Dev Server (port 8080)
                   ├── /app/**          ← Vue SPA (pages, components, stores)
                   ├── /api/**          ← Nitro server routes (REST)
                   │     └── middleware/save-context.ts  ← resolves the cookie's save
                   └── /server/db/**    ← Drizzle ORM ──▶ db.sqlite (every save's data)
```

There is no separate backend process. Nuxt's Nitro engine serves both the frontend assets and the API routes from the same Node/Bun process.

### Multi-tenancy

Every visitor's save lives in the same SQLite file, distinguished by `game_id`. There is no per-save database, no separate schema, and no login — the game's whole identity model is an anonymous UUID token, generated once by `createSave()` and set as an httpOnly `fpt_save` cookie. `server/middleware/save-context.ts` runs on every request, reads that cookie, and resolves it to a `game` row it stashes in `event.context.gameId`; route handlers then call `activeSave(event)` / `requireSave(event)` / `requireActiveManager(event)` (`server/core/save.ts`) to get that row rather than ever querying `game` unscoped.

`teams` and `players` hold two different kinds of row in the same table, distinguished by `game_id`:
- **`game_id IS NULL`** — the seed *template* roster `bun run db:seed` produces: 40 clubs, ~880 players, shared read-only reference data.
- **`game_id` set** — a live per-save *clone*, owned by exactly one save, mutated freely by that save's play.

`createSave()` clones every template team and player into a fresh save-owned set of rows the moment a new game starts, rather than resetting shared rows in place — that in-place reset is what the single-save version of this game used to do, which is why starting a second save used to silently overwrite the first one. See [database-schema.md](database-schema.md#multi-tenancy) for exactly which tables carry `game_id` and which stay global template data, and `frontend/scripts/verify-multi-save.ts` for the automated check that two saves never bleed into each other.

---

## Tech Stack

| Layer | Technology | Version | Role |
|---|---|---|---|
| Runtime | Bun | latest | Package manager and JS runtime |
| Framework | Nuxt | ^4.5.2 | Full-stack Vue meta-framework |
| UI | Nuxt UI | ^3.3.7 | Component library (built on Tailwind v4 + Radix) |
| State | Pinia | ^3.0.4 | Client-side store for game/team/league state |
| Styling | Tailwind CSS | v4 (via Nuxt UI) | Utility classes + CSS-first theme |
| Database | SQLite (libsql) | via @libsql/client | Local file-based relational database |
| ORM | Drizzle ORM | ^0.45.2 | Type-safe query builder + schema definition |
| Icons | Lucide (iconify) | @iconify-json/lucide ^1.2 | SVG icon set |
| Fakes | @faker-js/faker | ^9.9.0 | Generating seed data |

---

## Directory Structure

```
football-pitch-tactics/
├── docker-compose.yaml         # Production container setup
├── Dockerfile                  # Multi-stage build for the Nuxt app
├── Makefile                    # Convenience targets (dev, build, db:setup)
├── LICENSE                     # GNU AGPL v3
├── dataset/                    # Raw CSV data (Premier League reference)
├── docs/                       # This documentation folder
└── frontend/                   # Entire application lives here
    ├── nuxt.config.ts           # Nuxt configuration
    ├── drizzle.config.ts        # Drizzle ORM config
    ├── package.json
    ├── db.sqlite                # Runtime database file (git-ignored)
    ├── public/                  # Static assets (favicon, sfx manifest)
    ├── scripts/                 # Dev-only drivers, not shipped
    │   ├── calibrate-match-engine.ts   # `bun run calibrate`
    │   └── sim-season.ts               # Headless season driver
    ├── app/                     # Nuxt "app/" directory (Vue layer)
    │   ├── app.vue              # Root component — UApp wrapper
    │   ├── app.config.ts        # Nuxt UI component token defaults
    │   ├── assets/css/main.css  # Tailwind imports + @theme + @layer components
    │   ├── components/          # Shared Vue components (incl. matchday/)
    │   ├── composables/         # useGameContext, useAppToast, useSfx, …
    │   ├── layouts/             # Default layout (shell + topbar)
    │   ├── middleware/          # Route guards
    │   ├── pages/               # File-based router
    │   ├── plugins/             # theme.client.ts
    │   ├── stores/              # Pinia stores
    │   └── utils/               # Formatting, themes, tables, results
    ├── shared/                  # Code shared by client and server via Nuxt's #shared alias
    │   ├── lineup.ts            # Position normalisation + auto-select/resolve lineup
    │   ├── match-state.ts       # Live match state rules + fatigue/injury constants
    │   └── progression.ts       # Development trend badge
    └── server/                  # Nitro server layer
        ├── api/                 # HTTP route handlers
        ├── core/                # Game logic — see below
        ├── middleware/          # save-context.ts — resolves fpt_save cookie → event.context.gameId
        └── db/                  # Database: schema, migrations, seed, client, league JSON
```

**`server/core/`** holds the game logic, all framework-free and mostly pure:

| Module | Responsibility |
|---|---|
| `match-engine.ts` | The simulation — `kickOff`, `simulateSegment` |
| `match-session.ts` | Persistence plumbing shared by the three `/api/match/*` routes |
| `tactics.ts` | The four formations and their modifiers |
| `calendar.ts` | Round-robin pairings and round-based fixture dates |
| `matchday-ai.ts` | Headless AI-vs-AI resolution, shared fitness settlement |
| `standings.ts` | League table computation |
| `season.ts` | Season completion detection and the rollover transaction |
| `progression.ts` | Ageing, development, retirement, youth intake, valuation |
| `economy.ts` | Reputation, stadium, wages, ticketing, attendance, prize money, the commercial pool and its parts, running costs, capital prices |
| `finance.ts` | The ledger, matchday settlement, prize payouts, and the forecast's inputs |
| `projection.ts` | The four-season forecast and the budget advisor |
| `sponsors.ts` | The commercial market — offers, deals, bonuses, naming rights |
| `stadium.ts` | The diary — promoter approaches, event settlement, pitch condition |
| `loans.ts` | Borrowing terms and per-matchday debt service |
| `insolvency.ts` | Escalating consequences of an overdrawn account |
| `matchday.ts` | `settleAftermath()` — everything that happens once the manager's match is over |
| `contracts.ts` | Renewal terms and whether a player or CPU club accepts them |
| `market.ts` | Transfer settlement (money, ledger, fan reaction, news) and AI bidding |
| `board.ts` | Board and fan confidence, expectations, dismissal |
| `news.ts` | The club news feed |
| `save.ts` | Save lifecycle — `createSave()` clones the template roster per save; `activeSave()`/`requireSave()`/`requireActiveManager()` resolve the caller's save from `event.context.gameId` |
| `results-server.ts` | Server-side W/D/L helpers |

**`shared/`** exists so the exact same rules run on both sides of the wire: the match engine (server) uses `shared/lineup.ts` to pick a CPU team's best XI, and the Dashboard lineup builder (client) imports the same module for position normalisation and slot counts; `shared/match-state.ts` does the same for live match state, so the engine, the API's rewind and the Matchday UI can never disagree about who is on the pitch. `shared/finance.ts` does it for money: the server totals ledger streams and the finance pages label them, and two copies of that map is exactly how "Commercial" comes to mean one thing on the overview and another on the projection. Nuxt exposes this directory automatically via the `#shared` import alias. See [match-engine.md](match-engine.md), [tactics.md](../functional/tactics.md) and [economy.md](economy.md).

---

## Request Lifecycle

1. **Browser navigates** to a URL (e.g. `/game`).
2. **Nuxt router** matches the file in `app/pages/`.
3. The **global middleware** `require-active-game.global.ts` runs before the component mounts. No active save → `/new-game`; a save whose manager has been dismissed → `/game/dismissed`.
4. The **page component** mounts and calls `useFetch()`/`useAsyncData()` hooks which send `GET` requests to Nitro API routes under `/api/`, carrying the `fpt_save` cookie automatically.
5. On the server, `server/middleware/save-context.ts` runs first on every request: it reads the `fpt_save` cookie, looks up the matching `game` row, and sets `event.context.gameId`. No cookie or an unrecognised token leaves `event.context.gameId` unset — the route itself decides whether that is a 404 (`requireSave`) or a legitimate "nothing yet" (`activeSave` returning `null`, e.g. before a save exists).
6. **Nitro handler** imports `db` from `server/db/index.ts` (a Drizzle client pointing at `db.sqlite`) and calls `activeSave(event)` / `requireSave(event)` / `requireActiveManager(event)` (`server/core/save.ts`) to resolve *this request's* save from `event.context.gameId`, never `db.query.game.findFirst()` with no filter — that would silently operate on whichever save happens to be first in the table, which is exactly the bug the multi-tenant migration fixed. Routes that mutate the world call `requireActiveManager()`, which `403`s on a dismissed save; several also re-check that the resource they're touching (`team.id`, `match.id`) actually belongs to `gameState.id` before returning or mutating it.
7. The page renders with the data.

---

## Database Lifecycle

The database is a single local SQLite file at `frontend/db.sqlite`.

| Script | What it does |
|---|---|
| `bun run db:migrate` | Runs `drizzle-kit generate` to produce SQL migration files in `server/db/migrations/` |
| `bun run db:push` | Applies pending migrations to `db.sqlite` via `drizzle-kit push` |
| `bun run db:seed` | Runs `server/db/seed.ts` which deletes all rows and inserts fresh data |
| `bun run db:setup` | Shortcut: migrate → push → seed |

The database is **not** committed to git. Every fresh clone must run `db:setup` before starting.

---

## Environment & Ports

| Concern | Value |
|---|---|
| Dev server port | `8080` (set by `--port 8080` in `dev` script) |
| DB file path | `./db.sqlite` (relative to `frontend/`) |
| SQLite driver | `file:./db.sqlite` (libsql URL format) |
| Docker expose | Port `80` via nginx reverse-proxy (see `nginx/nginx.conf`) |

---

## Production Docker Setup

The `docker-compose.yaml` defines two services:
- **app**: Nuxt production build (Node) exposing port `8080` internally.
- **nginx**: Reverse-proxy listening on port `80`, forwarding to the app.

The `Dockerfile` performs a multi-stage build: install → build → minimal runtime image.
