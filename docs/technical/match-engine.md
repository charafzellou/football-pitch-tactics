# Match Engine

The simulation logic lives in `frontend/server/core/match-engine.ts`. It is a pure function — no database access — called by `POST /api/match/simulate`.

---

## Entry Point: `simulateMatch(homeTeam, awayTeam)`

```typescript
simulateMatch(
  homeTeam: { id, name, squad: Player[], tactic: Tactic },
  awayTeam: { id, name, squad: Player[], tactic: Tactic }
) → { homeScore, awayScore, events, homeLineup, awayLineup }
```

The function runs in three phases: **lineup selection**, **stats calculation**, then **90-minute event loop**.

---

## Phase 1 — Lineup Selection (`selectLineup`)

```typescript
selectLineup(squad: Player[], tactic: Tactic): Player[]
```

Picks the best available players to fill the formation's slot requirements:

1. Splits the squad into four position pools: `GK`, `DF`, `MF`, `FW`.
2. Sorts each pool by `skillLevel` descending.
3. Takes the top N players per position as specified by `tactic.formation`.

**Position mapping used internally:**
| DB value | Pool |
|---|---|
| `"Goalkeeper"` | GK |
| `"Defender"` | DF |
| `"Midfielder"` | MF |
| `"Forward"` or `"Attacker"` | FW |

> **Known issue:** The seed data stores `"GK"`, `"DEF"`, `"MID"`, `"ATT"` but the engine filters for `"Goalkeeper"`, `"Defender"`, `"Midfielder"`, `"Forward"`. This mismatch means the engine currently gets **empty position pools** for most seeded players, and selects mostly from the forward pool due to the fallback. See [TASKS.md](../../TASKS.md) task #1 for the fix.

---

## Phase 2 — Team Stats (`calculateTeamStats`)

```typescript
calculateTeamStats(lineup: Player[], tactic: Tactic) → { attack, defence }
```

Simple formula:
```
avgSkill = sum(lineup.skillLevel) / lineup.length
attack   = avgSkill + tactic.modifiers.attack
defence  = avgSkill + tactic.modifiers.defence
```

Both stats are floating-point numbers typically in the range **50–100**.

---

## Phase 3 — Event Loop (90 minutes)

The engine iterates minutes 1–90. On each tick:

### Attack Attempts

For each team, an attack chance is computed:
```
homeChance = homeStats.attack + random(0–10) − awayStats.defence
awayChance = awayStats.attack + random(0–10) − homeStats.defence
```

A shot attempt occurs if `chance > 70 AND random() > 0.6`.

On a shot attempt:
- A random forward/attacker is selected as the shooter.
- The score probability is clamped:
  ```
  scoreProb = clamp(0.05, 0.9, (attack − defence) / 100 + random() × 0.2)
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

Each picks a random player from the applicable team's lineup.

---

## Event Object Shape

```typescript
{
  minute: number       // 1–90
  eventType: string    // 'goal' | 'shot' | 'miss' | 'yellow' | 'red' | 'foul' | 'injury'
  teamId: number       // which team the event belongs to
  playerId?: number    // optional — set for goals/shots/cards
}
```

---

## Expected Goal Counts

With average seeded skill levels (~70) and no tactic modifiers:
- `attack ≈ defence ≈ 70`
- `homeChance = 70 + 5 − 70 = 5` → rarely exceeds 70, so most minutes produce no shot
- Expected shots per team: `~5–10`
- Expected goals per team: `~0.5–2`

This produces low-scoring, realistic-ish matches. Unbalanced squads (high skill gap) produce more lopsided results.

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
1. Writing `homeScore`, `awayScore`, `played = 1` to the `matches` table.
2. Resolving `eventType` strings to `event_type.id` values (inserting new types if needed).
3. Inserting one row per event into `match_events`.
4. Advancing `game.currentDate` to `matchDate + 1ms`.

---

## Limitations & Known Issues

| Issue | Impact |
|---|---|
| Position string mismatch (DB `"DEF"` vs engine `"Defender"`) | Lineup selection ignores most positions; all teams effectively play with only forwards |
| No stamina influence on match performance | `stamina` column exists but is unused in simulation |
| No home advantage modifier | Home/away teams have identical stats bases |
| No injury list — injure event does not affect future availability | Red card event also has no follow-up effect |
| All events are randomly distributed; goals can happen in minute 1 | No momentum or match state model |
| `scoreProb` can go negative if `attack << defence` — clamped to 0.05 minimum | Very weak teams still score occasionally |
