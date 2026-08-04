# Database Schema

The database is SQLite, managed by Drizzle ORM. The schema is declared in `frontend/server/db/schema.ts`. Migrations live in `frontend/server/db/migrations/`.

---

## Entity-Relationship Overview

```
countries ──< leagues ──< teams ──< players
                                └── matches (home/away FK to teams)
                                      └── match_events (FK to matches, players, teams, event_type)
                           teams ─── game (playerTeamId FK)
season ──< matches
season ──< game
```

---

## Tables

### `countries`

Stores the real-world countries available in the game.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | Auto-increment surrogate key |
| `name` | TEXT | NOT NULL, UNIQUE | Country name (e.g. "England") |

**Seed data:** England, Spain.

---

### `leagues`

Each league belongs to one country.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | Auto-increment surrogate key |
| `name` | TEXT | NOT NULL | League display name (e.g. "Premier League") |
| `country_id` | INTEGER | NOT NULL, FK → countries.id | Parent country |

**Seed data:** Premier League (England), La Liga (Spain).

---

### `teams`

Clubs that compete in a league. Both player-controlled and AI-controlled teams share this table.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | Surrogate key |
| `name` | TEXT | NOT NULL | Club name |
| `league_id` | INTEGER | NOT NULL, FK → leagues.id | Which league the team competes in |
| `bank_balance` | INTEGER | NOT NULL, DEFAULT 1000000 | Current cash balance in USD |
| `tactics` | TEXT | nullable | Name of the selected tactic (e.g. "4-4-2") |
| `lineup` | TEXT | nullable | Selected starting XI, stored as a JSON array of `players.id` (e.g. `"[12,45,...]"`) |

**Notes:**
- `bank_balance` is set to a random value between 1,000,000 and 50,000,000 during seeding.
- `tactics` is `NULL` until the player (or simulation) sets one; the match engine falls back to `DEFAULT_TACTIC_NAME` (4-4-2) when `NULL`.
- `lineup` is `NULL` until the player saves an XI via `PUT /api/team/:id/lineup`. AI-controlled teams never set it, so they are always auto-selected. A saved lineup is only honoured if it still resolves to exactly 11 valid squad members at read time (e.g. a sold player invalidates it) — see [match-engine.md](match-engine.md) for the resolution logic shared between the client and the engine.

---

### `positions`

Lookup table for positional abbreviations.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | Surrogate key |
| `name` | TEXT | NOT NULL, UNIQUE | Abbreviation: `GK`, `DEF`, `MID`, `ATT` |

**Note:** This table exists but is not currently referenced by foreign key from `players`. The `players.position` column stores the string directly.

---

### `players`

Individual footballers. Each player belongs to exactly one team.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | Surrogate key |
| `name` | TEXT | NOT NULL | Full name |
| `age` | INTEGER | NOT NULL | Age in years |
| `position` | TEXT | NOT NULL | One of: `GK`, `DEF`, `MID`, `ATT` (seed data) or `Goalkeeper`/`Defender`/`Midfielder`/`Forward`/`Attacker` (match-engine internal labels) |
| `skill_level` | INTEGER | NOT NULL | Overall rating 50–99 |
| `stamina` | INTEGER | NOT NULL | Stamina 0–100, initialised to 100 for all players |
| `market_value` | INTEGER | NOT NULL | Transfer value in USD |
| `team_id` | INTEGER | NOT NULL, FK → teams.id | Current club |

**Position string handling:** The seed file stores abbreviated positions (`GK`, `DEF`, `MID`, `ATT`); some code paths historically expected full English names (`Goalkeeper`, `Defender`, `Midfielder`, `Forward`/`Attacker`). Both forms are now normalised to the canonical `GK | DF | MF | FW` slots by a single shared function, `normalizePosition()` in `frontend/shared/lineup.ts`, used by the match engine, the team/lineup API routes, and the Dashboard/Matchday pages. See [match-engine.md](match-engine.md) for details.

**Market value calculation at seed time:**
```
marketValue = random(skillLevel × 50_000, skillLevel × 250_000)
```

---

### `season`

One row per available game season.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | Surrogate key |
| `year` | TEXT | NOT NULL | Calendar year as string (e.g. "2024") |
| `ended` | TEXT | NOT NULL, DEFAULT 'false' | Whether the season is finished. Stored as string `'true'`/`'false'` |

**Seed data:** Years 2024–2030 (7 seasons), all `ended = 'false'`.

---

### `event_type`

Lookup table for match event categories.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | Surrogate key |
| `name` | TEXT | NOT NULL | Event label |

**Seed data:** `goal`, `shot`, `miss`, `yellow`, `red`, `foul`, `injury`.

---

### `game`

Represents the active save state. Only one row is kept at a time — `POST /api/game/start` deletes all existing rows before inserting a new one.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | Surrogate key |
| `player_team_id` | INTEGER | NOT NULL, FK → teams.id | The club the human player manages |
| `season` | INTEGER | NOT NULL, FK → season.id | Current season (always `1` in practice) |
| `current_date` | INTEGER (timestamp) | NOT NULL | Virtual in-game calendar date |

**`current_date` usage:** The schedule API uses `current_date` to filter upcoming matches (only fixtures ≥ `current_date` are shown as upcoming). After each match simulation, `current_date` is advanced to `matchDate + 1 second` so the just-played fixture drops off the upcoming list.

---

### `matches`

One row per fixture in the season schedule.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | Surrogate key |
| `home_team_id` | INTEGER | NOT NULL, FK → teams.id | Home club |
| `away_team_id` | INTEGER | NOT NULL, FK → teams.id | Away club |
| `home_score` | INTEGER | nullable | Goals scored by home team; `NULL` = not yet played |
| `away_score` | INTEGER | nullable | Goals scored by away team; `NULL` = not yet played |
| `played` | INTEGER | NOT NULL, DEFAULT 0 | `1` once the match has been simulated |
| `season` | INTEGER | NOT NULL, FK → season.id | Which season this fixture belongs to |
| `match_date` | INTEGER (timestamp) | NOT NULL | Scheduled kick-off datetime |

**Determining result:** A match with `home_score IS NOT NULL` is considered played. The `played` flag is a redundant index-friendly boolean.

---

### `match_events`

Individual events that occurred during a simulated match.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | Surrogate key |
| `match_id` | INTEGER | NOT NULL, FK → matches.id | Parent fixture |
| `minute` | INTEGER | NOT NULL | Game minute (1–90) |
| `event_type` | INTEGER | NOT NULL, FK → event_type.id | Category of event |
| `player_id` | INTEGER | nullable, FK → players.id | Player involved |
| `team_id` | INTEGER | NOT NULL, FK → teams.id | Team responsible for the event |

**`player_id` is nullable at the schema level, but the match engine always sets it.** Every event the engine generates — goals, shots, misses, cards, fouls, injuries — picks a specific player from the side's on-pitch lineup, weighted by position (e.g. forwards shoot far more often than defenders; defenders and midfielders draw most cards). This matters for card events in particular: a yellow or red now always names *who* was booked, so the client can highlight that player rather than only the team. See [match-engine.md](match-engine.md#disciplinary-events).

---

## Migrations

Drizzle generates incremental SQL migration files in `server/db/migrations/`. Current files:

| File | Summary |
|---|---|
| `0000_steady_patriot.sql` | Initial schema: all core tables |
| `0001_natural_owl.sql` | Follow-up adjustments |
| `0002_groovy_luke_cage.sql` | Further schema changes |
| `0003_watery_golden_guardian.sql` | Additional columns |
| `0004_add_played_to_matches.sql` | Adds `played` column to `matches` |
| `0004_late_quasar.sql` | Parallel branch migration (same version number, different content) |
| `0005_add_lineup_to_teams.sql` | Adds `lineup` column to `teams` |

**Warning:** Two files share the `0004_` prefix, which indicates a migration branch conflict. The `meta/_journal.json` file determines which is actually applied. Run `bun run db:push` to ensure the schema is up to date before running.
