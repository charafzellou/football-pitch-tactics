# Football Pitch Tactics — Documentation

This folder contains all documentation for the project, split into **technical** (implementation detail) and **functional** (game rules and flow) sections.

---

## Technical Documentation

| File | Contents |
|---|---|
| [technical/architecture.md](technical/architecture.md) | System overview, tech stack, how frontend/backend/DB connect |
| [technical/database-schema.md](technical/database-schema.md) | Every table, column, relationship, and constraint |
| [technical/api-routes.md](technical/api-routes.md) | Every HTTP endpoint — method, URL, request body, response shape, error codes |
| [technical/frontend.md](technical/frontend.md) | Pages, components, layouts, Pinia stores, middleware |
| [technical/css-styling.md](technical/css-styling.md) | Tailwind v4 theme, CSS variable system, component class catalogue |
| [technical/match-engine.md](technical/match-engine.md) | Simulation algorithm — lineup resolution, stats calculation, weighted event generation |

## Functional Documentation

| File | Contents |
|---|---|
| [functional/gameflow.md](functional/gameflow.md) | End-to-end game lifecycle from new save to season end |
| [functional/matchday.md](functional/matchday.md) | Matchday experience, playback system, live clock mechanics |
| [functional/tactics.md](functional/tactics.md) | Formations, modifiers, lineup legality rules |
| [functional/transfers.md](functional/transfers.md) | Buy/sell flow, market value, AI buyer selection |
