# Architecture

## System Overview

Football Pitch Tactics is a single-player, browser-based football management game. It runs entirely on one machine: the Nuxt server handles both the Vue SSR/SPA frontend and all API logic, with a local SQLite database file.

```
Browser ──HTTP──▶  Nuxt Dev Server (port 8080)
                   ├── /app/**          ← Vue SPA (pages, components, stores)
                   ├── /api/**          ← Nitro server routes (REST)
                   └── /server/db/**    ← Drizzle ORM ──▶ db.sqlite
```

There is no separate backend process. Nuxt's Nitro engine serves both the frontend assets and the API routes from the same Node/Bun process.

---

## Tech Stack

| Layer | Technology | Version | Role |
|---|---|---|---|
| Runtime | Bun | latest | Package manager and JS runtime |
| Framework | Nuxt | ^4.5.1 | Full-stack Vue meta-framework |
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
├── TASKS.md                    # Backlog of proposed improvements
├── dataset/                    # Raw CSV data (Premier League tactics reference)
├── docs/                       # This documentation folder
└── frontend/                   # Entire application lives here
    ├── nuxt.config.ts           # Nuxt configuration
    ├── drizzle.config.ts        # Drizzle ORM config
    ├── package.json
    ├── db.sqlite                # Runtime database file (git-ignored)
    ├── app/                     # Nuxt "app/" directory (Vue layer)
    │   ├── app.vue              # Root component — UApp wrapper
    │   ├── app.config.ts        # Nuxt UI component token defaults
    │   ├── assets/css/main.css  # Tailwind imports + @theme + @layer components
    │   ├── components/          # Shared Vue components
    │   ├── layouts/             # Default layout (shell + sidebar)
    │   ├── middleware/          # Route guards
    │   ├── pages/               # File-based router
    │   └── stores/              # Pinia stores
    └── server/                  # Nitro server layer
        ├── api/                 # HTTP route handlers
        ├── core/                # Game logic (match engine, tactics)
        └── db/                  # Database: schema, migrations, seed, client
```

---

## Request Lifecycle

1. **Browser navigates** to a URL (e.g. `/game`).
2. **Nuxt router** matches the file in `app/pages/`.
3. The **global middleware** `require-active-game.global.ts` runs before the component mounts; if no active save exists it redirects to `/new-game`.
4. The **page component** mounts and calls `useFetch()` hooks which send `GET` requests to Nitro API routes under `/api/`.
5. **Nitro handler** imports `db` from `server/db/index.ts` (a Drizzle client pointing at `db.sqlite`), runs the query, and returns JSON.
6. The page renders with the data.

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
- **app**: Nuxt production build (Node) exposing port `3000` internally.
- **nginx**: Reverse-proxy listening on port `80`, forwarding to the app.

The `Dockerfile` performs a multi-stage build: install → build → minimal runtime image.
