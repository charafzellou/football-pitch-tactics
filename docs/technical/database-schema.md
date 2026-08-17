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
| `stamina` | INTEGER | NOT NULL | 0–100, initialised to 100 for all players. Written at the end of every match this player took part in — see below |
| `market_value` | INTEGER | NOT NULL | Transfer value in USD |
| `team_id` | INTEGER | NOT NULL, FK → teams.id | Current club |
| `injured_matches` | INTEGER | NOT NULL, default `0` | Matches remaining before this player is selectable again. `0` = fit |
| `potential` | INTEGER | NOT NULL, default `0` | Skill ceiling. Development moves `skill_level` toward it and never past it. See [season.md](season.md#progression) |
| `retired` | INTEGER | NOT NULL, default `0` | `1` once retired at a rollover. **Rows are kept, never deleted** — `match_events.player_id` references them |

**Position string handling:** The seed file stores abbreviated positions (`GK`, `DEF`, `MID`, `ATT`); some code paths historically expected full English names (`Goalkeeper`, `Defender`, `Midfielder`, `Forward`/`Attacker`). Both forms are now normalised to the canonical `GK | DF | MF | FW` slots by a single shared function, `normalizePosition()` in `frontend/shared/lineup.ts`, used by the match engine, the team/lineup API routes, and the Dashboard/Matchday pages. See [match-engine.md](match-engine.md) for details.

**`stamina` means "what this player starts their next match with".** It's written once, at full time, after that match's drain and the flat between-match recovery are both already applied (see [match-engine.md § Fatigue and Stamina](match-engine.md#fatigue-and-stamina)) — not adjusted again at the next kickoff. The lineup builder and squad pages read this column directly, so what they show is what the engine will actually use.

**`injured_matches` is a separate concept from low stamina, deliberately.** Every player — including one sitting out — recovers `+10` stamina at every full time, so a stamina-based definition of "injured" would clear itself the instant it was applied. `injured_matches` counts down independently: decremented at every full time, and reset to a fresh random 2–4 when an `injury` event lands on that player during a match (see [match-engine.md § Injuries](match-engine.md#injuries)). It's the only thing that blocks lineup selection — low stamina never does, so a squad can never be locked out of naming eleven players.

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

**Seed data:** `goal`, `shot`, `shot_on_target`, `yellow`, `red`, `foul`, `injury`, `corner`, `cross`, `offside`, `substitution`.

Kept in sync with the event types the match engine generates — see `EVENT_RATES` in [match-engine.md](match-engine.md#event-rates). `miss` was removed in migration `0006` (an off-target attempt is already a `shot`); existing `miss` rows were reassigned to `shot` rather than deleted, so no match history was lost. `substitution` was added explicitly in migration `0007_add_match_state.sql` (not generated by the engine, so it needed an explicit row) rather than relying purely on lazy upsert, so its id is stable across a fresh seed and an existing database alike.

Ids are not semantically meaningful — `resolveEventTypeIds()` (`server/core/match-session.ts`, used by all three `/api/match/*` routes) resolves types by **name** and inserts any it doesn't find, so a fresh seed and a migrated database can assign different ids to the same type without affecting behaviour.

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
| `round` | INTEGER | NOT NULL, default `0` | Matchday number within the season, 1-based. Every fixture in a round shares a `match_date` |
| `match_date` | INTEGER (timestamp) | NOT NULL | Scheduled kick-off datetime. Rounds are 7 days apart from a fixed season start |
| `state` | TEXT | nullable | Live `MatchState` JSON (see `shared/match-state.ts`) while the match is paused mid-way. `NULL` when not started or already finished — same convention as `teams.lineup`'s "nothing saved" |

**Determining result:** A match with `home_score IS NOT NULL` (equivalently `played = 1`) is considered fully played. **A match with `state IS NOT NULL` and `played = 0` is in progress** — paused between `POST /api/match/start` and full time. `POST /api/match/start`'s fallback (no `matchId` given) prefers an in-progress match over the next unplayed one by date, so a paused game isn't skipped past.

---

### `season_summary`

One row per league per completed season, written by the rollover.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | Surrogate key |
| `season` | INTEGER | NOT NULL, FK → season.id | The season that finished |
| `league_id` | INTEGER | NOT NULL, FK → leagues.id | Which league |
| `champion_team_id` | INTEGER | NOT NULL, FK → teams.id | Winner |
| `champion_points` | INTEGER | NOT NULL | Winning points total |
| `player_team_id` | INTEGER | nullable, FK → teams.id | `NULL` when the player's club isn't in this league |
| `player_position` | INTEGER | nullable | Their finishing position |
| `player_points` | INTEGER | nullable | Their points total |
| `completed_at` | INTEGER (timestamp) | NOT NULL | When the rollover ran |

Standings are otherwise computed on the fly from `matches`, which is fine while a season is live but loses everything the moment the next season's fixtures are inserted. This is what survives a rollover.

**Delete order:** this table references `season`, `leagues` and `teams`, so `seed.ts` must clear it before any of them.

---

### `match_events`

Individual events that occurred during a simulated match.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | Surrogate key |
| `match_id` | INTEGER | NOT NULL, FK → matches.id | Parent fixture |
| `minute` | INTEGER | NOT NULL | Game minute (1–90) |
| `event_type` | INTEGER | NOT NULL, FK → event_type.id | Category of event |
| `player_id` | INTEGER | nullable, FK → players.id | Player involved. For `substitution`, the player coming **on** |
| `related_player_id` | INTEGER | nullable, FK → players.id | `substitution` only — the player going **off**. `NULL` for every other event type |
| `team_id` | INTEGER | NOT NULL, FK → teams.id | Team responsible for the event |

**`player_id` is nullable at the schema level, but the match engine always sets it.** Every event the engine generates picks a specific player from the side's on-pitch lineup, weighted by position (e.g. forwards shoot far more often than defenders; defenders and midfielders draw most cards). This matters for card events in particular: a yellow or red now always names *who* was booked, so the client can highlight that player rather than only the team. See [match-engine.md](match-engine.md#which-side-and-which-player).

**`minute` is *no longer* unique within a match.** Before substitutions, the engine's single categorical draw per minute guaranteed no two events shared a `minute`. A manager (or the CPU's own bench review) can now substitute at any minute, including one that already has a drawn event, so two rows can legitimately share a `minute` value. This was never enforced by a database constraint, so no migration was needed — only this note.

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
| `0006_rework_event_types.sql` | Removes `miss` (reassigning its events to `shot`), adds `shot_on_target`, `corner`, `cross`, `offside` |
| `0007_add_match_state.sql` | Adds `matches.state` and `match_events.related_player_id`; seeds the `substitution` event type |
| `0008_add_player_injuries.sql` | Adds `players.injured_matches`, default `0` |
| `0008_public_exiles.sql` | Adds `players.potential` and `players.retired`, `matches.round`, and the `season_summary` table. Backfills `potential` with age-appropriate headroom so existing saves keep developing |

**Warning:** Two files share the `0004_` prefix, which indicates a migration branch conflict. The `meta/_journal.json` file determines which is actually applied. Run `bun run db:push` to ensure the schema is up to date before running.
