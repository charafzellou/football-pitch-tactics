# Football Pitch Tactics — Documentation

This folder contains all documentation for the project, split into **technical** (implementation detail) and **functional** (game rules and flow) sections.

---

## Technical Documentation

| File | Contents |
|---|---|
| [technical/architecture.md](technical/architecture.md) | System overview, tech stack, and frontend/API/database data flow |
| [technical/database-schema.md](technical/database-schema.md) | Every table, column, relationship, constraint, and derived value |
| [technical/api-routes.md](technical/api-routes.md) | Every HTTP endpoint — method, URL, request body, response shape, and error codes |
| [technical/frontend.md](technical/frontend.md) | Pages, components, layouts, shared data caches, hydration, and middleware |
| [technical/css-styling.md](technical/css-styling.md) | Tailwind v4 theme, CSS variable system, and component class catalogue |
| [technical/match-engine.md](technical/match-engine.md) | Simulation and replay — lineup resolution, live state, score calculation, and weighted event generation |
| [technical/season.md](technical/season.md) | Season lifecycle — fixture calendar, AI fixture resolution, league-wide form, progression, and rollover |
| [technical/economy.md](technical/economy.md) | Money — the ledger, the commercial decomposition, sponsors, the stadium, debt, insolvency, the four-season forecast and the budget advisor |

## Functional Documentation

| File | Contents |
|---|---|
| [functional/gameflow.md](functional/gameflow.md) | End-to-end game lifecycle from new save to season end, including what persists between matches |
| [functional/matchday.md](functional/matchday.md) | Matchday experience, playback system, live clock, and event-time scoring |
| [functional/tactics.md](functional/tactics.md) | Formations, lineup legality, saved team sheets, and match-specific changes |
| [functional/transfers.md](functional/transfers.md) | Buy/sell flow, market value, AI buyer selection |
| [functional/finances.md](functional/finances.md) | The Chairman's and Director of Football's decisions — commercial deals, the ground, facilities, budgets, and what insolvency costs |
