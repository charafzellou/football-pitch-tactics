# Match Engine

The simulation logic lives in `frontend/server/core/match-engine.ts`. It is a pure function — no database access — called by `POST /api/match/simulate`. It shares its lineup rules with the client via `frontend/shared/lineup.ts`.

---

## Entry Point: `simulateMatch(homeTeam, awayTeam)`

```typescript
simulateMatch(
  homeTeam: { id, name, squad: Player[], tactic: Tactic, lineupIds?: number[] | null },
  awayTeam: { id, name, squad: Player[], tactic: Tactic, lineupIds?: number[] | null }
) → { homeScore, awayScore, events, homeLineup, awayLineup }
```

`lineupIds` is the team's saved starting XI (from `teams.lineup`, parsed to an array of player ids). It is `undefined`/`null` for every AI-controlled club today, since only the human player's team currently saves one.

The function runs in three phases: **lineup resolution**, **stats calculation**, then **90-minute event loop**.

---

## Phase 1 — Lineup Resolution (`shared/lineup.ts`)

Lineup selection is **not** engine-specific logic anymore — it lives in `frontend/shared/lineup.ts` so the server (match engine) and the client (Dashboard lineup builder, Matchday lineup panels) resolve the exact same XI. See [tactics.md](../functional/tactics.md) for the client-facing rules.

```typescript
resolveLineup(squad, formation, savedIds) → { starters, bench, autoSelected }
```

1. If `savedIds` names exactly 11 players who are still in the squad, that becomes the starting XI (`autoSelected: false`). A saved id that no longer exists in the squad (e.g. the player was sold) is silently dropped; if that leaves fewer than 11, the saved lineup is discarded entirely and auto-selection takes over.
2. Otherwise `autoSelectLineup(squad, formation)` picks the highest-`skillLevel` players per slot, in `formation` order (`GK`, `DF`, `MF`, `FW`), `autoSelected: true`.
   - If a squad doesn't have enough players in some slot to fill the formation (generated/fallback squads draw positions at random), the shortfall is topped up with the best remaining outfield players — a spare goalkeeper is only used as an absolute last resort, so squads don't field three keepers because they're short on defenders.
3. Everyone not selected becomes `bench`, sorted the same way (GK → DF → MF → FW, best first).

**Position mapping** (`normalizePosition()`, shared): the seed data mixes abbreviations (`"GK"`, `"DEF"`, `"MID"`, `"ATT"`) and full names (`"Goalkeeper"`, `"Defender"`, `"Midfielder"`, `"Forward"`/`"Attacker"`) — both forms map to the canonical `GK | DF | MF | FW` slot, from one function used everywhere a position string is compared.

**CPU teams:** every AI club has `teams.lineup = NULL`, so they are always auto-selected using their tactic's formation (or the default 4-4-2 if no tactic is set). This is the same "Auto-select" logic intended for a future "Auto-select" button on the player's own Dashboard — it isn't wired to a button yet, but the function it would call already exists and is reused, not duplicated.

---

## Phase 2 — Team Stats (`calculateTeamStats`)

```typescript
calculateTeamStats(lineup: Player[], tactic: Tactic) → { attack, defence }
```

Simple formula, computed once per side at kickoff from the *starting XI* (not the full squad):
```
avgSkill = sum(lineup.skillLevel) / lineup.length
attack   = avgSkill + tactic.modifiers.attack
defence  = avgSkill + tactic.modifiers.defence
```

Both stats are floating-point numbers typically in the range **50–100**.

---

## Phase 3 — Event Loop (90 minutes)

The engine iterates minutes 1–90, tracking each side as a `MatchSide`: its resolved lineup, who is currently `onPitch` (shrinks on a red card), which players are `booked` (yellow), and the running score.

### Attack Attempts

For each team, an attack chance is computed from the skill edge over the opponent, damped and randomised:
```
edge       = clamp(-12, +12, side.attack − opponent.defence)   // MAX_EDGE = 12
chance     = edge + random(0–60)                                // CHANCE_ROLL = 60
```

A shot attempt occurs if `chance > 40 AND random() > 0.6` (`CHANCE_THRESHOLD = 40`).

**Why the edge is capped:** both the attempt rate *and* the conversion rate scale with the same skill gap. Left uncapped, a strong squad's advantage compounds into blowout scorelines (13-0 was observed during tuning). Capping the edge at ±12 keeps mismatches meaningfully harder without producing unrealistic scorelines.

On a shot attempt:
- The shooter is picked from `side.onPitch`, weighted toward attacking positions (see [Player Selection](#player-selection-by-position) below) — keepers never shoot.
- The score probability is clamped:
  ```
  scoreProb = clamp(0.05, 0.9, edge / 200 + random() × 0.18)
  ```
- If `random() < scoreProb` → **goal** event, score incremented.
- Otherwise → **shot** event. If `random() > 0.8` → additional **miss** event.

### Disciplinary Events

| Condition | Event | Approximate frequency per minute |
|---|---|---|
| `random() > 0.995` | `red` | ~0.5% |
| `random() > 0.98` | `yellow` | ~2% |
| `random() > 0.997` | `injury` | ~0.3% |
| `random() > 0.99` | `foul` | ~1% |

The affected side is chosen at random (50/50), then a player is picked from that side's `onPitch` list, weighted toward defenders and midfielders (see below) — every card, foul, and injury event always names a specific player; there is no team-only variant.

**Second yellow → red:** if a player who is already `booked` (has a first yellow) receives a second yellow, the engine emits the `yellow` event *and* immediately follows it with a `red` event for the same player, then removes them from `onPitch`. A standalone red card (the `random() > 0.995` branch) also removes the player from `onPitch` — the weakened side's `onPitch` pool shrinks for the rest of the match, but `stats.attack`/`stats.defence` (computed once at kickoff from the full starting XI) are not recalculated; a red card reduces who can be picked for further events, not the side's underlying stats.

### Player Selection by Position

```typescript
pickPlayer(candidates: Player[], weights: Record<LineupSlot, number>): Player
```

Two weight tables bias the random pick toward realistic roles:

| Slot | Shooting weight | Discipline weight |
|---|---|---|
| GK | 0 | 1 |
| DF | 1 | 4 |
| MF | 3 | 4 |
| FW | 6 | 2 |

Goals/shots/misses use the shooting table (forwards shoot ~6× as often as defenders; keepers never shoot). Cards/fouls/injuries use the discipline table (defenders and midfielders are booked far more than forwards; keepers rarely). If every remaining candidate weighs zero (e.g. only the goalkeeper is left on the pitch after two red cards), the pick falls back to a uniform random choice among whoever remains, rather than being unable to pick anyone.

---

## Event Object Shape

```typescript
{
  minute: number       // 1–90
  eventType: string    // 'goal' | 'shot' | 'miss' | 'yellow' | 'red' | 'foul' | 'injury'
  teamId: number       // which team the event belongs to
  playerId?: number    // always set in practice — every generated event names a player
}
```

`playerId` is typed optional because the field is nullable at the DB level (`match_events.player_id`), but every event the engine currently generates sets it. Card events, in particular, used to be emitted with only a `teamId` (see [Known Limitations](#known-limitations--history) below) — this has been fixed.

---

## Expected Goal Counts

With average seeded skill levels (~70) and no tactic modifiers, calibrated over repeated simulation runs:
- ~2.6–2.8 goals per match combined, ~12 shot attempts per team
- Conversion rate around 10–12%
- Even matchups stay close; skill mismatches are noticeably harder to win but rarely blow out past single digits, thanks to the capped edge

---

## Tactic Modifier Effect

See [tactics.md](../functional/tactics.md) for the modifier table. The effect is additive on the base average skill:

```
4-4-2:  attack +0,  defence +0   (balanced)
4-5-1:  attack −1,  defence +1   (defensive)
4-3-3:  attack +1,  defence −1   (attacking)
3-5-2:  attack +1,  defence −2   (high risk)
```

The modifier is small relative to skill differences, so squad quality dominates.

---

## Persistence (handled by the API, not the engine)

After `simulateMatch()` returns, `POST /api/match/simulate` handles:
1. Reading each team's saved lineup (`teams.lineup`, parsed via `parseLineup()`) and passing it in as `lineupIds`.
2. Writing `homeScore`, `awayScore`, `played = 1` to the `matches` table.
3. Resolving `eventType` strings to `event_type.id` values (inserting new types if needed).
4. Inserting one row per event into `match_events`, including `playerId`.
5. Advancing `game.currentDate` to `matchDate + 1ms`.
6. Returning `homeLineup`/`awayLineup` (arrays of player ids) alongside the events, so the client can render the *actual* XI the simulation used — including any auto-selection — rather than re-deriving it separately.

---

## Known Limitations & History

| Issue | Status |
|---|---|
| Position string mismatch (DB `"DEF"` vs full names) | **Fixed.** Normalised in one shared function, `shared/lineup.ts#normalizePosition`, used by both server and client. |
| Card events had no `playerId`, only `teamId` | **Fixed.** All events now select a specific player. |
| Matchday lineup panels showed the full squad, not the XI that played | **Fixed.** `GET /api/team/:id` now returns `startingXi`/`bench`, resolved with the same shared logic the engine uses. |
| Blowout scorelines (13-0) once real lineups/stats were wired up | **Fixed.** Skill edge is capped (`MAX_EDGE = 12`) and shot/conversion constants retuned. |
| No stamina influence on match performance | `stamina` column exists but is unused in simulation |
| No home advantage modifier | Home/away teams have identical stats bases |
| No injury list — the `injury` event has no follow-up effect on future availability | Player is not marked unavailable for the next match |
| All events are randomly distributed; goals can happen in minute 1 | No momentum or match state model |
| `scoreProb` can go negative if `attack ≪ defence` — clamped to 0.05 minimum | Very weak teams still score occasionally |
