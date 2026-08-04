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

### One Draw Per Minute

**At most one event can occur in any given minute** — this is guaranteed by construction, not by filtering afterwards. Each minute makes a single categorical draw across `EVENT_RATES`:

```typescript
let ticket = Math.random() * MATCH_MINUTES        // MATCH_MINUTES = 90

for (const [kind, rate] of EVENT_DRAW) {
  ticket -= rate
  if (ticket < 0) { emit(kind, minute); break }   // this minute's one event
}
// ticket never went negative → a quiet minute
```

Because a type's rate is its *expected count per 90-minute match*, subtracting rates from a ticket drawn uniformly on `[0, 90)` gives each type a per-minute probability of exactly `rate / 90`. Summed over 90 minutes that reproduces the target average precisely, while the `break` makes a second event in the same minute impossible.

The rates total ~63.5, comfortably under 90, so the leftover probability mass (~29%) is the chance of a quiet minute. **If the rates ever summed to more than 90 the model would silently break** — types near the end of the draw order would be starved, since the ticket could never reach them.

### Event Rates

Calibrated to real-world match data. All figures are per match, both teams combined.

| Draw kind | Rate | Emits | Target source |
|---|---|---|---|
| `cross` | 21.5 | `cross` | 21.5 |
| `foul` | 15.5 | `foul` | 15.5 |
| `shotAttempt` | 13.1 | one of `goal` / `shot_on_target` / `shot` | shots 13.1 |
| `corner` | 5.7 | `corner` | 5.7 |
| `yellow` | 4.51 | `yellow`, or `red` on a second booking | yellow cards 4.42 |
| `offside` | 2.7 | `offside` | 2.7 |
| `injury` | 0.3 | `injury` | — |
| `straightRed` | 0.16 | `red` | red cards 0.25 (combined with second bookings) |

Two rates deliberately sit slightly off their target because of interactions:
- **`yellow` is 4.51, not 4.42** — about 0.09 of those draws land on an already-booked player, which becomes a sending-off instead of a yellow (see below), so they leave the yellow tally.
- **`straightRed` is 0.16, not 0.25** — those ~0.09 second bookings make up the rest of the red card total.

### Shot Attempts

A `shotAttempt` resolves into **exactly one** event, so a single shot never emits multiple rows:

```
goalProb = SHOT_OUTCOME.goal × (1 + edge / 40)
roll < goalProb                        → goal
roll < goalProb + SHOT_OUTCOME.saved   → shot_on_target   (on target, saved)
otherwise                              → shot             (off target / blocked)
```

The base shares come straight from the targets: `goal = 2.71/13.1`, `saved = (4.6 − 2.71)/13.1`. This is why `shots` and `shots on target` are *derived* totals rather than their own draw kinds — `shots = goal + shot_on_target + shot` and `shots on target = goal + shot_on_target`.

The goal share carries a **0.964 trim factor**. The side with the skill edge both takes a larger share of the attempts *and* converts more of them; those two effects correlate, which lifts the match average ~4% above target. The trim cancels it so the measured average lands on 2.71.

**Why the edge is capped** (`MAX_EDGE = 12`): the same compounding, unchecked, produced 13-0 scorelines during tuning. Capping keeps mismatches meaningfully one-sided without absurd results — over 30,000 simulated matches only ~1% finish with a 6+ goal margin.

### Which Side, and Which Player

Sides are not a coin flip. The stronger side sees more of the ball:

```
homeAttackShare = 0.5 + (edge(home) − edge(away)) / 96      // bounded to 0.25–0.75
homeFoulShare   = 0.5 + (0.5 − homeAttackShare) × 0.5       // side under pressure fouls more, damped
```

Attacking draws (`shotAttempt`, `cross`, `corner`, `offside`) use `homeAttackShare`; `foul`, `injury`, and cards use `homeFoulShare`.

A player is then picked from that side's `onPitch` list via `pickPlayer()`, weighted by position — **every event names a specific player**, there is no team-only variant:

| Slot | Shooting | Crossing | Corner | Offside | Discipline | Injury |
|---|---|---|---|---|---|---|
| GK | 0 | 0 | 0 | 0 | 1 | 1 |
| DF | 1 | 3 | 1 | 1 | 4 | 3 |
| MF | 3 | 5 | 5 | 2 | 4 | 3 |
| FW | 6 | 2 | 3 | 7 | 2 | 3 |

If every remaining candidate weighs zero (e.g. only the goalkeeper is left after two red cards), the pick falls back to a uniform random choice among whoever remains, rather than being unable to pick anyone.

### Cards

`pickPlayer` accepts the side's `booked` set and multiplies an already-booked player's weight by `BOOKED_CARD_WEIGHT = 0.12`. This models both referee leniency toward a player on a yellow and the player's own caution — without it, second yellows alone would overshoot the 0.25 red card target.

**Second bookable offence → red.** If the picked player is already in `booked`, the engine emits a single `red` event (not a yellow followed by a red — that would put two events in one minute) and removes them from `onPitch`. A `straightRed` draw does the same without needing a prior booking.

A sending-off shrinks `onPitch` for the rest of the match, so the player can take no further part. `stats.attack`/`stats.defence` are computed once at kickoff and are **not** recalculated — a red card changes who can be picked for later events, not the side's underlying strength.

---

## Event Object Shape

```typescript
{
  minute: number       // 1–90, unique across the match — at most one event per minute
  eventType: string    // 'goal' | 'shot' | 'shot_on_target' | 'yellow' | 'red'
                       // | 'foul' | 'injury' | 'corner' | 'cross' | 'offside'
  teamId: number       // which team the event belongs to
  playerId?: number    // always set in practice — every generated event names a player
}
```

`playerId` is typed optional because the field is nullable at the DB level (`match_events.player_id`), but every event the engine currently generates sets it. Card events, in particular, used to be emitted with only a `teamId` (see [Known Limitations](#known-limitations--history) below) — this has been fixed.

The `miss` event type has been removed: an off-target attempt is already a `shot`, so `miss` was redundant. See migration `0006_rework_event_types.sql`.

---

## Measured Output

Verified over **30,000 simulated matches** against real seeded squads. All figures are per match, both teams combined.

| Event | Measured | Target |
|---|---|---|
| Goals | 2.75 | 2.71 |
| Shots *(derived)* | 13.13 | 13.1 |
| Shots on target *(derived)* | 4.64 | 4.6 |
| Yellow cards | 4.43 | 4.42 |
| Red cards | 0.24 | 0.25 |
| Fouls | 15.50 | 15.5 |
| Corners | 5.70 | 5.7 |
| Crosses | 21.51 | 21.5 |
| Offsides | 2.70 | 2.7 |
| Injuries | 0.30 | — |

Every rate lands within ~2% of target. Total ≈ 63.5 events per match, filling ~70% of the 90 minutes.

**Invariants confirmed across the same sample:** zero minutes carrying more than one event, zero events without a `playerId`, and no event types outside the calibrated set.

**Scoreline shape:** median 3 goals per match, 90th percentile 5, 99th percentile 7, maximum 11. About 1% of matches finish with a 6+ goal margin.

Re-running this measurement is cheap — the engine is a pure function, so it can be driven directly in-process against squads read from `db.sqlite` without starting the dev server, writing to the database, or consuming fixtures.

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
| Multiple events could land in the same minute | **Fixed.** One categorical draw per minute makes a second event impossible by construction. |
| Event frequencies were arbitrary and unrealistic | **Fixed.** Every rate is calibrated to real-world match data and verified over 30,000 matches. |
| No stamina influence on match performance | `stamina` column exists but is unused in simulation |
| No home advantage modifier | Home/away teams have identical stats bases |
| No injury list — the `injury` event has no follow-up effect on future availability | Player is not marked unavailable for the next match |
| All events are randomly distributed; goals can happen in minute 1 | No momentum or match state model |
| A red card shrinks `onPitch` but does not recalculate team stats | The 10-man side is not measurably weaker, only short of players to pick from |
| Rates must keep summing to under 90 | Types late in the draw order would be starved if the total ever exceeded `MATCH_MINUTES` |
