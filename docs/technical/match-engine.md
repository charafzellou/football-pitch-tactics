# Match Engine

The simulation logic lives in `frontend/server/core/match-engine.ts`. It is a pure function — no database access — called by `POST /api/match/start`, `/api/match/advance` and `/api/match/changes` (see [api-routes.md](api-routes.md)), and by `server/core/matchday-ai.ts` to play out AI-vs-AI fixtures headlessly. It shares its lineup rules with the client via `frontend/shared/lineup.ts`, and its live-match state rules via `frontend/shared/match-state.ts`.

---

## Entry Points: `kickOff` and `simulateSegment`

A match is no longer resolved in one call. It's split so a manager can pause, substitute, and change tactics mid-match and have that genuinely affect what happens next:

```typescript
kickOff(homeTeam: Team, awayTeam: Team) → MatchState

simulateSegment(
  homeTeam: Team, awayTeam: Team,
  state: MatchState, toMinute: number
) → { state: MatchState; events: MatchEvent[] }
```

`Team` is `{ id, name, squad: Player[], tactic: Tactic, lineupIds?: number[] | null, autoManaged?: boolean }`. `lineupIds` is the team's saved starting XI (from `teams.lineup`); it's `undefined`/`null` for every AI-controlled club. `autoManaged: true` marks a CPU-controlled side, which reviews its own bench during the match — see [CPU Substitutions](#cpu-substitutions) below.

`kickOff` resolves both starting XIs (same as the old `simulateMatch` did) and returns a `MatchState` at minute 0 — see [Match State](#match-state-frontendsharedmatch-statets) below. `simulateSegment` runs the minute loop from `state.minute + 1` up to and including `toMinute`, returning the new state and the events generated along the way. A full match is two calls: `simulateSegment(..., 45)` then `simulateSegment(..., 90)` — or more, if the manager pauses and changes something in between, in which case the API layer re-derives `state` at the pause minute first (see [Persistence](#persistence-handled-by-the-api-not-the-engine) below) and simulates a shorter segment from there.

The function still runs the same three phases per minute it always did: **lineup resolution** (once, at kickoff), **stats calculation** (now every minute, not once), then the **event draw**.

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

**CPU teams:** every AI club has `teams.lineup = NULL`, so they are always auto-selected using their tactic's formation (or the default 4-4-2 if no tactic is set). The Dashboard's **Auto-pick best XI** button and its **Field an emergency XI** fallback call the same `autoSelectLineup()` for the player's own team, so there is one implementation rather than two that can drift.

A rollover clears `teams.lineup` for *every* club, including the player's — a saved XI may name someone who has just retired or left — so the first match of each new season is auto-selected on both sides until the manager saves a teamsheet.

---

## Phase 2 — Team Stats (`calculateTeamStats`)

```typescript
calculateTeamStats(onPitch: Player[], stamina: Record<number, number>, tactic: Tactic, pitchPenalty = 0) → { attack, defence }
```

Recomputed **every minute** now, not once at kickoff, from whoever is currently `onPitch` and their current stamina:
```
avgSkill = sum(effectiveSkill(p.skillLevel, stamina[p.id])) / LINEUP_SIZE   // LINEUP_SIZE = 11, not onPitch.length
attack   = avgSkill + tactic.modifiers.attack  − pitchPenalty
defence  = avgSkill + tactic.modifiers.defence − pitchPenalty
```

`pitchPenalty` is `pitchPenaltyFor(homeTeam.pitchCondition)` and is applied **to the home side only** — up to `MAX_PITCH_PENALTY` (2.5), which is deliberately comparable to a formation choice. It is the ground's own club that hired it out for a concert, so it is the ground's own club that plays on the goalmouth afterwards; the money and the rutted turf belong to the same decision. The away side's rating is unaffected.

**The injury rate is not split that way.** `drawKind(injuryScale)` takes `pitchInjuryScaleFor(homeTeam.pitchCondition)` and inflates the `injury` bucket for **both** sides by up to 50% — a cut-up goalmouth does not know who booked the concert. The extra probability comes out of the empty remainder of the ticket (the minutes in which nothing happens), so every other event type keeps its exact rate and none of the calibration below is disturbed. See [economy.md § Pitch condition](economy.md#pitch-condition).

`effectiveSkill` (in `shared/match-state.ts`) damps skill by fatigue — see [Fatigue and Stamina](#fatigue-and-stamina) below. Both stats are floating-point numbers typically in the range **50–100**. Recomputing every minute is what makes a substitution or a tired legs take effect immediately rather than only at the next match — and why this is safe for calibration: recomputing per-minute doesn't change the *shape* of the calculation, only when it's evaluated, and fatigue applied symmetrically to both sides cancels out in the edge calculation below (see [Measured Output](#measured-output)).

**Dividing by a fixed 11, not by however many are actually on the pitch, is deliberate.** A true average rewards going a player down whenever the missing player was below-average — losing your weakest defender would *raise* the side's rating. Against a fixed eleven, every missing player (a red card, an unreplaced injury) costs the side roughly a eleventh of its rating — about 7-8 points, against a `MAX_EDGE` of 12 — which is what being short-handed should actually feel like. A full XI is unaffected either way: 11 players over 11.

---

## Phase 3 — Event Loop

The engine iterates minutes `state.minute + 1` to `toMinute`, tracking each side as a `MatchSideState` (`shared/match-state.ts`): who is currently `onPitch`, who's on the `bench`, who's been substituted off (`usedPlayers`), which players are `booked` (yellow), `sentOff`, each player's `stamina`, `subsUsed`, and the running `score`. Unlike the old `MatchSide`, this is a plain serializable object — it's what gets persisted between segments.

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

**If the rates ever summed to more than 90 the model would silently break** — types near the end of the draw order would be starved, since the ticket could never reach them. At the current total (~38, see [Event Rates](#event-rates-real-world-data-scaled-for-pacing)) the leftover probability mass — the chance of a quiet minute — is ~57%.

### Event Rates: Real-World Data, Scaled for Pacing

`REAL_WORLD_EVENT_RATES` holds the literal per-match averages from published match studies — the same numbers used to calibrate the engine originally. Summed directly they total ~54.5, which fills ~60% of the 90 minutes with an event. That's accurate as a statistical match report, but as a *live minute-by-minute feed* (1 real second = 1 in-game minute) it still reads as denser than football.

`EVENT_RATES` — what the draw loop actually uses — is every one of those numbers multiplied by one constant:

```typescript
const EVENT_FREQUENCY_SCALE = 45 / 64   // ~0.703
```

Scaling uniformly (rather than trimming individual types) preserves the real-world *mix* — goals stay exactly as likely relative to shots, cards relative to fouls, corners relative to crosses — while bringing the total down. `EVENT_FREQUENCY_SCALE` is the single knob for overall pace; redialing it doesn't require touching anything else.

> **Known discrepancy:** the `45 / 64` scale was tuned against an older, higher `REAL_WORLD_EVENT_RATES` set that summed to ~64. The rates were later retuned down (see table below) without updating this constant, so the denominator no longer matches the current real-world sum (~54.5). The result is that matches now run at **~38 events**, not the ~45 the constant's name implies — confirmed by measurement below. This is current, intentional-until-changed behavior, not something this doc silently corrects.

| Draw kind | Real-world rate | Scaled rate (×0.703) | Emits |
|---|---|---|---|
| `cross` | 19.5 | 13.71 | `cross` |
| `foul` | 13.5 | 9.49 | `foul` |
| `shotAttempt` | 11.1 | 7.80 | one of `goal` / `shot_on_target` / `shot` |
| `corner` | 4.7 | 3.30 | `corner` |
| `yellow` | 3.51 | 2.47 | `yellow`, or `red` on a second booking |
| `offside` | 1.7 | 1.20 | `offside` |
| `injury` | 0.3 | 0.21 | `injury` |
| `straightRed` | 0.2 | 0.14 | `red` |

Two real-world rates deliberately sit off their literal target, for reasons that compound under scaling:
- **`yellow` is 3.51, not the 4.42 target** — about 0.09 of those draws (at full frequency) land on an already-booked player, which becomes a sending-off instead of a second yellow (see [Cards](#cards) below), so they leave the yellow tally. (The gap between 3.51 and 4.42 is now wider than the ~0.09 carryover alone explains — a byproduct of the rate retune described above, not yet reconciled against the target.)
- **`straightRed` is 0.2, not the naive 0.16** — at lower `EVENT_FREQUENCY_SCALE`, fewer yellow draws means fewer already-booked players around to draw a second time, so the yellow→red carryover shrinks *faster* than linearly with the scale factor. `straightRed` is set above the naive scaled value to compensate, so total reds still land close to the real-world 0.25 target once carryover is added back in.

### Shot Attempts

A `shotAttempt` resolves into **exactly one** event, so a single shot never emits multiple rows:

```
goalProb = SHOT_OUTCOME.goal × (1 + edge / 40)
roll < goalProb                        → goal
roll < goalProb + SHOT_OUTCOME.saved   → shot_on_target   (on target, saved)
otherwise                              → shot             (off target / blocked)
```

The base shares come straight from the targets: `goal = 2.71/13.1`, `saved = (4.6 − 2.71)/13.1`. These are *shares of `shotAttempt`*, not standalone rates — they're unaffected by the code's real-world/13.1 baseline, which is now stale (`shotAttempt` itself is 11.1, not 13.1), but the shares are still computed against the original 2.71/4.6/13.1 literature figures, not the current `shotAttempt` rate. `EVENT_FREQUENCY_SCALE` doesn't touch these shares directly — scaling `shotAttempt` down scales `goal`/`shot_on_target`/`shot` down with it, automatically, in proportion. This is also why `shots` and `shots on target` are *derived* totals rather than their own draw kinds — `shots = goal + shot_on_target + shot` and `shots on target = goal + shot_on_target`.

The goal share carries a **0.964 trim factor**. The side with the skill edge both takes a larger share of the attempts *and* converts more of them; those two effects correlate, which lifts the match average above target. The trim compensates; the measured average is now ~1.57 goals/match at the current scale (see [Measured Output](#measured-output) below).

**Why the edge is capped** (`MAX_EDGE = 12`): the same compounding, unchecked, produced 13-0 scorelines during tuning. Capping keeps mismatches meaningfully one-sided without absurd results — over 30,000 simulated matches only ~0.2% finish with a 6+ goal margin.

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

**Second bookable offence → red.** If the picked player is already in `booked`, the engine emits a single `red` event (not a yellow followed by a red — that would put two events in one minute) and removes them from `onPitch`. A `straightRed` draw does the same without needing a prior booking. This carryover is what makes the yellow→red ratio sensitive to `EVENT_FREQUENCY_SCALE` — see [Event Rates](#event-rates-real-world-data-scaled-for-pacing) above.

A sending-off shrinks `onPitch` for the rest of the match, so the player can take no further part. Since `calculateTeamStats` is recomputed every minute and divides by a fixed 11 (see [Phase 2](#phase-2--team-stats-calculateteamstats)), a red card now measurably weakens the side from the next minute on — not just the pool later events are drawn from.

---

## Event Object Shape

```typescript
{
  minute: number              // 1–90 — no longer guaranteed unique: a manager
                              // substitution shares its minute with whatever
                              // was drawn that minute (see note below)
  eventType: string           // 'goal' | 'shot' | 'shot_on_target' | 'yellow' | 'red'
                              // | 'foul' | 'injury' | 'corner' | 'cross' | 'offside'
                              // | 'substitution'
  teamId: number              // which team the event belongs to
  playerId?: number           // always set in practice; for 'substitution' this is the player coming ON
  relatedPlayerId?: number    // 'substitution' only — the player going OFF
}
```

`playerId` is typed optional because the field is nullable at the DB level (`match_events.player_id`), but every event the engine currently generates sets it. `relatedPlayerId` is new (`match_events.related_player_id`), and is only ever set on `substitution` events.

> **Minute uniqueness no longer holds.** Before substitutions, "at most one event per minute" was guaranteed by the one-draw loop. A manager (or the CPU's own reviewer, see below) can now substitute at any minute, including one that already has a drawn event — so `minute` is no longer a unique key within a match. `database-schema.md` has been updated to reflect this.

The `miss` event type has been removed: an off-target attempt is already a `shot`, so `miss` was redundant. See migration `0006_rework_event_types.sql`. `substitution` was added in migration `0007_add_match_state.sql`.

---

## Match State (`frontend/shared/match-state.ts`)

```typescript
interface MatchSideState {
  teamId, tacticName
  startingXi: number[]      // fixed at kickoff
  onPitch: number[]
  bench: number[]
  usedPlayers: number[]     // subbed off — cannot return
  booked: number[]
  sentOff: number[]
  injured: number[]         // off the pitch, cannot return, cannot be picked again
  subsUsed: number
  stamina: Record<number, number>
  drainRates: Record<number, number>   // per-player stamina drain multiplier, fixed at kickoff
  score: number
}
interface MatchState { minute: number; home: MatchSideState; away: MatchSideState }
```

`drainRates` exists only because of one constraint: `applyEvents` must reproduce the engine's own state exactly, since the client uses it to derive the pitch and the API uses it to rewind. A `Math.random()` inside the per-minute drain would make that replay diverge from the engine on every single minute. So the per-player jitter is rolled **once, in `kickOff`, server-side only**, and baked into `drainRates` — everything downstream of kickoff, including `advanceMinute`, is a pure function of state.

Three functions do all the state work, shared between the engine, the API, and the Matchday UI so all three can never disagree about who's on the pitch:

- **`advanceMinute(state, minute, events)`** — the one state transition. Drains stamina for everyone on the pitch (by their `drainRates` multiplier), applies a small recovery bump crossing 45→46 (skipping anyone `injured`), then folds each event (`goal` → score, `yellow`/`red` → booked/sentOff, `injury` → moves the player to `injured` and off `onPitch` with stamina set to 0, `substitution` → moves the incoming player from bench to pitch and the outgoing one to `usedPlayers`). The engine calls this once per minute inside `simulateSegment`.
- **`applyEvents(state, events, toMinute)`** — replays `advanceMinute` minute-by-minute from `state.minute` to `toMinute`, ignoring anything at or before `state.minute`. This is how the Matchday UI derives "what does the pitch look like right now" from the events revealed so far, and how the API rewinds a match to the minute a manager paused at. A goal celebration applies only the event slice through that goal, so its score is the exact event-time score even when skip-ahead reveals several goals in one pass; it never adds another goal to the already-updated HUD score.
- **`applyMidMatchChanges(state, teamId, substitutions, tacticName)`** — the administrative counterpart: applies a manager's pause-time decisions without advancing the clock or draining stamina (that only happens via gameplay minutes, not decisions).

---

## Fatigue and Stamina

`players.stamina` now actually does something, and `players.stamina` in the database always means **"what this player starts their next match with"** — it's written at full time, after that match's drain and recovery, not adjusted again at the next kickoff. Constants live in `shared/match-state.ts`:

| Constant | Value | Effect |
|---|---|---|
| `STAMINA_DRAIN_PER_MINUTE` | 0.25 | Base rate before the position factor below |
| `STAMINA_DRAIN_BY_SLOT` | `{ GK: 0.2, DF: 0.75, MF: 1, FW: 1 }` | Multiplies the base rate — a keeper covers a fraction of the ground a midfielder does |
| `STAMINA_DRAIN_JITTER` | 0.15 | Per-player variation, ±15%, rolled once at kickoff (see `drainRates` above) |
| `HALF_TIME_RECOVERY` | 2 | Small bounce for everyone still fit, crossing into the second half |
| `FATIGUE_FLOOR` | 0.8 | A fully-drained player still plays at 80% of skill, not 0 |
| `STAMINA_RECOVERY_PER_MATCH` | 10 | Flat recovery applied to everyone at full time, capped at 100 |

```
effectiveSkill = skillLevel × (0.80 + 0.20 × stamina / 100)
```

Fatigue only ever feeds into `calculateTeamStats` via `effectiveSkill` — see [Phase 2](#phase-2--team-stats-calculateteamstats). A full 90 minutes costs, before jitter: **GK ~4.5, DF ~16.9, MF/FW ~22.5**. Recovery is a flat `+10` rather than a fraction of the deficit — a flat amount is what makes repeated selection compound: a proportional recovery would hand most of a hard match straight back, so fielding the same XI every week would never really cost anything. At `+10` against a ~22.5 drain, an ever-present midfielder's kickoff stamina runs 100 → 87.5 → 75 → 62.5 → 50 → … and *converges* to kicking off at **10** rather than reaching a true zero (the in-match floor of 0 plus the flat `+10` recovery meet there) — from roughly the fifth match onward they're a clearly worse option than a rested squad player, without ever becoming literally unselectable. Exhaustion alone never blocks selection; only an injury does (see below). At full time, `POST /api/match/finish` writes each participant's `recoveredStamina(endOfMatchStamina)` back to `players.stamina`.

---

## Injuries

An `injury` draw (see [Event Rates](#event-rates-real-world-data-scaled-for-pacing)) now has a real consequence, handled entirely by `foldEvent` in `shared/match-state.ts`: the player's stamina is set to 0, they're added to `injured`, and removed from `onPitch` immediately — the same minute, not at the next review. Their side plays the rest of that stretch a player down, which the `/ LINEUP_SIZE` change above makes a genuine cost.

**Availability is tracked as an explicit countdown, not a stamina threshold.** `players.injuredMatches` (migration `0008_add_player_injuries.sql`) counts down at every full time and is set to a fresh random 2–4 (`INJURY_MATCHES_MIN`/`MAX`) whenever a player is in a side's `injured` set at that point. This has to be a separate counter from stamina: stamina recovers `+10` for everyone at full time — including players sitting out — so a stamina-based "injured" definition would clear itself the moment it was applied. `isAvailable()` in `shared/lineup.ts` is the one predicate every selection surface checks: the Dashboard lineup builder, `autoSelectLineup` (skips unavailable players, but falls back to including them rather than fielding fewer than eleven), `resolveLineup` (a saved XI containing a newly-injured player is invalidated exactly like a sold one), and `kickOff` (filters an injured player off the `bench`, so they can never be offered as a substitute).

The Dashboard applies one deliberate exception: an injured player becomes selectable once no fit player remains for their line, because every formation needs a goalkeeper and blocking them outright would lock a club out of naming any legal XI. See [tactics.md § Selection State](../functional/tactics.md#selection-state).

**Replacing an injured player is treated as a substitution**, not a special event type — `substitutionError` allows the outgoing player to be either on the pitch *or* already in `injured` (as long as no one has come on for them yet), so "confirm a replacement" and "substitute a tired player" go through the exact same validation and the exact same `applyMidMatchChanges` path.

Injured players still recover the flat `+10`/match while they're out, so a 3-match absence returns someone at roughly 30 — back in the squad, but not match-sharp.

---

## Substitutions

Up to `MAX_SUBSTITUTIONS = 5` per side per match (`shared/match-state.ts`). `substitutionError(side, request)` is the single validation function — checks subs remaining, that the outgoing player is actually on the pitch (or injured — see above) and not sent off, and the incoming player is on the bench, not already used, and not injured — called both by the API (to reject an illegal request with a 400) and by the Matchday tactics panel (to grey out illegal choices before the request is even sent).

A substitution doesn't touch `stats.attack`/`stats.defence` directly — those are derived fresh every minute from whoever is currently `onPitch` (see [Phase 2](#phase-2--team-stats-calculateteamstats)), so swapping a player takes effect on the very next minute simulated.

### CPU Substitutions

A `Team` with `autoManaged: true` (every club except the human player's) manages its own bench, in two ways:

- **Injury reaction, immediate.** If a CPU side has an unreplaced player in `injured`, `pickInjuryReplacement` fires on the very next minute — same-slot bench player if one exists, otherwise the best bench player available. There's no upgrade margin to clear: the side is already a player down, so any fit body beats staying at ten.
- **Routine review, scheduled.** At `AI_REVIEW_MINUTES = [45, 60, 70, 80]`, if it has subs remaining, it compares its weakest on-pitch outfielder (by `effectiveSkill`) against the best bench player in the same position slot, and swaps if the gain clears `AI_UPGRADE_MARGIN = 2` effective skill points.

At most one substitution per side per minute either way.

---

## Measured Output

Verified over **30,000 simulated matches** against synthetic squads (random `skillLevel` 55–90, standard 4-4-2 for both sides). All figures are per match, both teams combined.

The literal real-world total (~54.5 events, filling ~60% of the 90 minutes) still reads as denser than a sporadic live feed, so every rate is scaled by `EVENT_FREQUENCY_SCALE ≈ 0.703` (see [Event Rates](#event-rates-real-world-data-scaled-for-pacing) above and the known discrepancy noted there — the scale constant's denominator is stale, so the actual total lands at ~38, below the ~45 the constant implies). The **"real-world" column is the unscaled literature figure**; **"measured" is what the engine actually produces** today.

| Event | Measured | Real-world | Scale vs. real-world |
|---|---|---|---|
| Goals | 1.57 | 2.71 | −42.1% |
| Shots *(derived)* | 7.79 | 13.1 | −40.5% |
| Shots on target *(derived)* | 2.70 | 4.6 | −41.3% |
| Yellow cards | 2.45 | 4.42 | −44.6% |
| Red cards | 0.17 | 0.25 | −33.6% |
| Fouls | 9.48 | 15.5 | −38.9% |
| Corners | 3.30 | 5.7 | −42.1% |
| Crosses | 13.73 | 21.5 | −36.1% |
| Offsides | 1.19 | 2.7 | −55.9% |
| Injuries | 0.21 | 0.3 | −30.7% |
| **Total events / match** | **38.3** | **63.47*** | — |

*The real-world total row still cites the original ~63.5 literature figure (kept for continuity with the per-type "real-world" column above); the current `REAL_WORLD_EVENT_RATES` constants actually sum to ~54.5 — see the discrepancy note in [Event Rates](#event-rates-real-world-data-scaled-for-pacing). Because the rate retune wasn't uniform across types (offsides and yellows dropped more than crosses and fouls), the mix is **no longer preserved** the way it was under the original single-scale design — per-type deviation from the real-world column now ranges from −31% to −56%, not a flat ~29%.

**Event spacing**, informally: with ~38 events across 90 minutes, roughly 58% of minutes are quiet, so gaps skew slightly longer than a 50%-fill model — median gap 2 minutes, with more 3+ minute gaps than a coin-flip-per-minute baseline would produce. This is the expected shape for a memoryless per-minute draw; there's no clustering logic and none is needed.

**Invariants confirmed across the same sample:** zero minutes carrying more than one event, zero events without a `playerId`, and no event types outside the calibrated set.

**Re-run check.** The table above is one 30,000-match snapshot. A fresh `bun run calibrate` reproduces it within sampling variance — goals 1.62, shots 7.80, on target 2.76, yellows 2.44, reds 0.16, fouls 9.52, with 0/30,000 parity and 0/30,000 rewind failures. Squads are drawn at random per run, so small movements between runs are expected; treat the table as the shape, not as exact constants.

> The script's own printed "literature" column disagrees with this document's real-world column for fouls (24.75 vs 15.5). The draw rate the engine actually uses is `REAL_WORLD_EVENT_RATES.foul = 13.5`; both figures are baselines quoted for comparison, and neither feeds the simulation.

**Scoreline shape:** median 1 goal per match, 90th percentile 3, 99th percentile 5, maximum 10 (30,000-match sample, both teams combined). `MAX_EDGE` still caps mismatches, but blowout-margin frequency wasn't re-measured for this update — treat the earlier "~0.2% finish 6+ goal margin" figure as unverified against the retuned rates.

Re-running this measurement is cheap — the engine is a pure function, so it can be driven directly in-process against squads read from `db.sqlite` without starting the dev server, writing to the database, or consuming fixtures. `bun run calibrate` (`frontend/scripts/calibrate-match-engine.ts`) is that script; besides the table above it also asserts `applyEvents` reproduces the engine's own state exactly (0/30,000 parity failures) and that rewinding to an arbitrary earlier minute matches a run stopped there (0/30,000 rewind failures), and reports average end-of-match stamina by position against the constants in [Fatigue and Stamina](#fatigue-and-stamina).

The fatigue rebalance (halved drain, per-slot rates, injuries) left every figure in the table above unchanged from the pre-rebalance baseline — the engine's skill terms are all *edges* (`edgeOver`, and the shares derived from it), so fatigue and injuries applied symmetrically to both sides cancel out. Only asymmetric fatigue — one side rotating its squad more than the other — shifts anything, which is the intended effect and isn't visible in a same-strength calibration sample.

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

The engine is still a pure function — none of this lives in `match-engine.ts`. It's in `frontend/server/core/match-session.ts` (shared plumbing) and the three route handlers under `frontend/server/api/match/`:

- **`POST /api/match/start`** — `kickOff()`s a fresh match and persists the minute-0 `MatchState` as `matches.state` (JSON), or resumes an in-progress one by returning the persisted state plus its events. See [api-routes.md](api-routes.md).
- **`POST /api/match/advance`** — the workhorse. First calls `syncToMinute(matchId, fromMinute)`, which rewinds/fast-forwards the persisted state to the client's actual minute by replaying `match_events` since the last snapshot, and discards anything simulated past that minute. Then runs `simulateSegment(..., nextBreakAfter(fromMinute))` (to 45 or 90) and batch-inserts the new events. It deliberately persists **nothing** else. Only `syncToMinute` writes `matches.state`, always from real events, never from a segment simulated speculatively ahead of the clock.
- **`POST /api/match/finish`** — full time, called when the client's clock actually reaches 90. Commits `homeScore`/`awayScore`/`played = 1`, writes each player's recovered stamina back to `players.stamina`, updates injury countdowns, nulls `matches.state`, settles the matchday's finances, and advances `game.currentDate`. It does **not** copy the final live XI or tactic into `teams.lineup`/`teams.tactics`, so the saved pre-match team sheet remains the next fixture's default. It then resolves the rest of the round headlessly and settles board/fan confidence — both of which need every other result in first. Idempotent, so a refresh at 90' into an already-finished match is a no-op rather than an error. Deliberately **not** guarded against a dismissed save; see [api-routes.md](api-routes.md#a-dismissed-save-is-read-only).
- **`POST /api/match/changes`** — the manager's pause-time decisions. Also starts with `syncToMinute`, then applies the substitutions and any tactic change through `applyMidMatchChanges` — which validates each swap against the state *including the swaps before it* — and persists the result, so the *next* `advance` call simulates onward from the changed team sheet.

**Everything above is one rule: nothing about a match is durable until the clock the player is watching has actually reached it.** Both bugs that violated it looked different and broke differently:

| Violation | Symptom |
|---|---|
| `advance` persisted its own segment-end state | A pause-and-substitute mid-segment rewound against that premature future snapshot, found no pending events past it, and silently no-opped — leaving the next segment folding new events onto stale state, which put a duplicated player on the pitch. |
| `advance` finalised as soon as its segment reached minute 90 | `matches.state` was nulled the moment the second half was *simulated*, ~45 seconds before it was *watched*. Every pause in the second half then failed with `400 Match has not started`, and the fixture disappeared from `GET /api/schedule` mid-playback. |

Resolving `eventType` strings to `event_type.id` values (inserting unseen ones, e.g. `'substitution'` before its migration ran) is shared via `resolveEventTypeIds()` in `match-session.ts`. `homeLineup`/`awayLineup` — the actual XI used, including auto-selection — are still returned to the client the same way they always were, now via `start`'s response.

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
| Literal real-world rates filled too much of the 90 minutes to read as sporadic in a live feed | **Fixed, but drifted.** `EVENT_FREQUENCY_SCALE` (~0.703) scales every rate down uniformly. It was tuned for an older ~64-total rate set; after rates were retuned to sum to ~54.5, the actual output is ~38 events/match, not the ~45 the constant implies, and per-type deviation from the real-world mix is no longer uniform (−31% to −56%). See [Event Rates](#event-rates-real-world-data-scaled-for-pacing). |
| `EVENT_FREQUENCY_SCALE`'s denominator (`64`) no longer matches `REAL_WORLD_EVENT_RATES`'s actual sum (~54.5) | Not reconciled — current behavior is documented above, not corrected |
| No stamina influence on match performance | **Fixed.** See [Fatigue and Stamina](#fatigue-and-stamina) — `effectiveSkill` feeds fatigue into `calculateTeamStats` every minute, and stamina carries between matches. |
| No half-time break, no substitutions, no mid-match tactics | **Fixed.** See [Substitutions](#substitutions) and `docs/functional/matchday.md`. |
| No injury list — the `injury` event has no follow-up effect on future availability | **Fixed.** See [Injuries](#injuries) — an injury takes the player off immediately and blocks selection for a random 2-4 matches. |
| A red card shrinks `onPitch` but does not recalculate team stats to penalise being a player down | **Fixed.** `calculateTeamStats` now divides by a fixed 11, not by `onPitch.length` — see [Phase 2](#phase-2--team-stats-calculateteamstats). Every missing player (red card or unreplaced injury) now measurably weakens the side. |
| Stamina drain was uniform across positions and deterministic | **Fixed.** `STAMINA_DRAIN_BY_SLOT` gives keepers and defenders a lighter rate than midfielders/forwards, and `STAMINA_DRAIN_JITTER` adds ±15% per-player variation, fixed at kickoff so replay stays deterministic. |
| No home advantage modifier | Home/away teams have identical stats bases |
| All events are randomly distributed; goals can happen in minute 1 | No momentum or match state model |
| Rates must keep summing to under 90 | Types late in the draw order would be starved if the total ever exceeded `MATCH_MINUTES` |
| `match_events.minute` is no longer unique within a match | A manager substitution can share a minute with whatever the draw loop generated that same minute — see [Event Object Shape](#event-object-shape) |
| ~~Only the two clubs in a played fixture have stamina/injuries updated~~ | **Fixed.** `resolveFixturesUpTo()` plays out every other fixture in the round headlessly when the player's match finishes, and AI squads settle through the same `settleMatchFitness()` — so the whole league tires and picks up injuries. See [season.md § Resolving AI fixtures](season.md#resolving-ai-fixtures). |
