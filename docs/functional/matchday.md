# Matchday

The matchday page (`/matchday`) is the core gameplay experience. It simulates a football match as a minute-by-minute live feed with a virtual clock.

---

## Prerequisites

Before the player can start a matchday:

1. An active save must exist (enforced by global middleware).
2. The player must have a valid 11-player lineup selected and a tactic chosen (enforced by the Dashboard's **Go to Matchday** button, which persists both — `PUT /api/team/:id/tactics` then `PUT /api/team/:id/lineup` — and only navigates if `lineupIsComplete === true` and both saves succeed).
3. There must be an unplayed fixture for the player's team (the page reads `GET /api/schedule` on mount; if the schedule is empty, the match info section shows nothing).

---

## Page States

The matchday page has eight states, controlled by `hasStarted`, `playing`, `isFinished`, `isHalfTime`, `injuredPlayerId`, and `loadingMatch`:

| State | `hasStarted` | `playing` | `isHalfTime` | `injuredPlayerId` | `isFinished` | `loadingMatch` | UI shown |
|---|---|---|---|---|---|---|---|
| Pre-match | `false` | `false` | `false` | `null` | `false` | `false` | **Start Match** button |
| Loading | `false` | `false` | `false` | `null` | `false` | `true` | Spinner on Start button |
| Playing | `true` | `true` | `false` | `null` | `false` | `false` | **Pause** button |
| Paused (tactical) | `true` | `false` | `false` | `null` | `false` | `false` | **Resume** button + `MatchTacticsPanel` |
| Half time | `true` | `false` | `true` | — | `false` | `false` | `MatchTacticsPanel` (half-time framing), no Resume button — continuing is the panel's job |
| Injury pause | `true` | `false` | `false` | *player id* | `false` | `false` | `MatchTacticsPanel` (injury framing), no Resume button — see [Injury Pauses](#injury-pauses) |
| Loading next segment | `true` | `false` | — | — | `false` | `true` | Spinner |
| Finished | `true` | `false` | `false` | `null` | `true` | `false` | **End Match** button |
| Result not saved | `true` | `false` | `false` | `null` | `false` | `false` | **Retry saving result** button (`finishFailed`) — the clock reached 90 but `POST /api/match/finish` failed |

Half time takes priority if both land on the same tick: the clock only checks for an own-team injury when `isHalfTime` is `false`, since the half-time break already covers the interruption.

---

## Simulation Lifecycle

The match is no longer resolved in one shot. It's simulated in **segments** — 1–45, then 46–90 — so a pause between segments can genuinely change what happens in the next one. See [match-engine.md](../technical/match-engine.md#entry-points-kickoff-and-simulatesegment) for the engine side of this.

### 1. Pre-match setup (on mount)
```
GET /api/schedule  →  nextMatch (first unplayed fixture)
GET /api/team/:homeTeamId  →  homeTeam (name, full squad, startingXi, bench, lineupAutoSelected)
GET /api/team/:awayTeamId  →  awayTeam (name, full squad, startingXi, bench, lineupAutoSelected)
GET /api/tactics  →  tacticsList (for the tactics panel's formation selector)
GET /api/game/state  →  used to work out which side, if either, the player manages
```

`startingXi`/`bench` are the pre-kickoff preview, already resolved server-side. See [tactics.md](tactics.md#lineup-resolution-and-auto-select) for the resolution rules. Once a match is under way, the lineup panels switch to deriving who's actually on the pitch from live match state instead — see [Lineup Panels](#lineup-panels) below.

### 2. Start Match (user clicks button — also the Resume-after-refresh button)

```
POST /api/match/start { matchId: nextMatch.id }
```

This does one of two things:
- **Fresh kickoff:** the server resolves both XIs, seeds a `MatchState` at minute 0 (stamina recovered from each player's last match — see [Fatigue and Stamina](../technical/match-engine.md#fatigue-and-stamina)), persists it, and returns `{ matchId, state, events: [] }`. The client then immediately calls `POST /api/match/advance` to simulate the first half.
- **Resuming an in-progress match** (the same button, clicked again after a refresh mid-match): the server returns the persisted `state` plus every event recorded so far. The client derives the furthest minute it actually has events for and jumps straight there — this is what makes a refresh at half-time (or mid-pause) safe: nothing is lost, and nothing has to be watched twice.

### 3. Segment fetch (`fetchNextSegment`)

```
POST /api/match/advance { matchId, fromMinute: currentMinute }
```

The server rewinds/fast-forwards its persisted state to `fromMinute` (discarding anything simulated past it — this is the step that makes a pause-and-substitute actually change the outcome), simulates onward to the next break (45 or 90), and returns the new events. The client appends them to its event list and starts (or restarts) the clock.

### 4. Playback loop

```
playing = true
```

A `useIntervalFn` timer fires every **`1000 / speed` ms** (1 second = 1 in-game minute at 1×), calling `tickOnce()`.

**Playback speed** is selectable at 1× / 2× / 4× from the HUD and persists as a preference. **Skip to half time / full time** jumps straight to the end of the currently-loaded segment, revealing every event at once — it does not simulate anything extra, so the result is identical to watching it out.

### 5. `tickOnce()` — the heart of the playback

On each tick:
1. If `currentMinute` has reached the end of what's been fetched (`segmentFetchedThrough` — 45, or 90): stop the interval, `playing = false`, and either set `isFinished = true` (at 90) or `isHalfTime = true` (at 45).
2. Otherwise increment `currentMinute` by 1 and reveal any events up to that minute into `eventFeed` (prepended, newest first). If one of those events is an `injury` belonging to the player's own team — and it isn't already half time — `revealUpTo` reports the injured player's id back to `tickOnce`, which sets `injuredPlayerId` and stops the interval, exactly as if the manager had paused.

The score and every lineup panel are **derived**, not accumulated by hand: `liveState = applyEvents(anchorState, allEvents, currentMinute)` (from `shared/match-state.ts`) replays every event revealed so far onto the last known anchor, giving the score, who's on the pitch, who's booked, and current stamina — the same function the engine and the API use internally, so the UI can never derive a different answer than the server did.

### 6. Half time

At minute 45 the clock stops itself — no player action needed — and `MatchTacticsPanel` opens automatically, framed as "Half Time" rather than a generic pause. See [Tactical Pauses](#tactical-pauses-and-half-time) below.

### 7. Pause / Resume (any other minute)

**Pause:** Clears the interval, `playing = false`. `MatchTacticsPanel` becomes available (not forced open the way half-time is, but reachable) since the manager might want to react to what just happened.

**Resume:** If nothing was changed and the current segment already covers minutes up to the next break, this just restarts the interval. If the manager made a substitution or tactic change, or the segment boundary was reached, this fetches a new segment first (step 3) — the events for the remainder of the segment are freshly simulated, reflecting the change.

### 8. Full time

When `currentMinute` reaches 90 (`tickOnce` detects it):
- Clock stops and the client calls `POST /api/match/finish`, which commits `homeScore`/`awayScore`/`played = 1`, writes each player's recovered stamina back to `players.stamina`, updates injury countdowns, settles the matchday's finances (wages, gate receipts, sponsorship), advances `game.currentDate`, **resolves every other fixture in the round headlessly** (see [season.md](../technical/season.md#resolving-ai-fixtures)), settles board and fan confidence now that the whole round's results are in, and finally runs the transfer market — lapsing stale bids and possibly generating a new one (`offersReceived` / `offersExpired` in the response). See [transfers.md](transfers.md#offers-for-your-players).
- `isFinished = true` only once that call succeeds, and the **End Match** button appears — navigating to `/game`, or to `/game/dismissed` if this result was the one that cost the manager their job (`board.dismissed` in the response, which also raises a toast at full time).
- If it fails, the result is *not* silently dropped: a toast explains, and a **Retry saving result** button appears in place of End Match.

Full time does not write the final on-pitch formation or personnel back to the club. The saved pre-match tactic and starting XI remain the default for the next fixture; substitutions, red cards, injuries, and tactical changes affect only the running match. Recorded events remain in match history, while the temporary `matches.state` snapshot is cleared after the result is committed.

> **Nothing is committed until the clock gets here.** The second half is simulated in one go the moment the manager leaves half time, ~45 seconds of playback before minute 90 arrives — and a pause anywhere in that stretch rewinds and re-simulates the rest, so the "result" is provisional the whole time. Finalising at simulation time (as an earlier version did, inside `advance`) nulled `matches.state` for the entire second half, which made every mid-second-half substitution fail with `400 Match has not started`.

---

## Tactical Pauses and Half Time

`MatchTacticsPanel.vue` is the manager's in-match surface — pitch/bench for the player's own team, a formation selector, and staged substitutions. It never appears for the opponent's team; the CPU manages its own bench automatically (see [CPU Substitutions](../technical/match-engine.md#cpu-substitutions)).

**Staging a substitution:** tap a pitch player, then a bench player. The pair is added to a staged list (with a remove button) rather than applied immediately, so several swaps can be queued before committing. `MAX_SUBSTITUTIONS = 5` per side per match; the panel shows subs remaining and disables bench players once the cap is staged.

**Confirming:** `POST /api/match/changes { matchId, atMinute, substitutions, tactic }` validates each swap server-side (same rule the panel uses to grey out illegal choices, so a request that got this far should never actually fail), applies them, and records a `substitution` event per swap — visible in the feed with both player names moments later. The client then always fetches the next segment (step 3), whether or not anything was actually staged, since reaching this point means the previously-fetched segment is no longer trustworthy (truncated by the pause) or was never fetched (the half-time boundary).

Swaps are validated **in sequence**, each against the state left by the ones before it, so chaining is legal: staging "A off, B on" and then "B off, C on" in the same batch works, because B really is on the pitch by the time the second swap is checked.

If the request fails, the clock stays stopped and the panel stays up with an error toast rather than resuming into a match that ignored the manager. The staged list does not survive that re-render, so the changes have to be set again.

**"Continue without changes":** skips straight to fetching the next segment.

---

## Injury Pauses

When one of the player's own players goes off injured, the clock stops on its own — the same as half time, except the trigger is an event in the feed rather than a fixed minute. The `Virtual Clock` header shows a `{Player} injured` badge in place of the LIVE indicator while this is open.

`MatchTacticsPanel` opens already primed for the decision: the injured player is pre-selected as the outgoing half of a swap (they're already off the pitch — the engine removed them the instant the event was generated, and `calculateTeamStats` is already treating the side as a player down), so the manager only has to tap who comes on. The panel offers two actions instead of the usual pair:

- **Confirm replacement** — enabled once a bench player is tapped. Goes through the exact same `POST /api/match/changes` path as any other substitution.
- **Play on with ten** — resumes the clock with no request at all. The engine already simulated the remainder of the current segment with the injured player off `onPitch`, so the buffered events are already consistent with playing short; there's nothing to re-fetch.

If `MAX_SUBSTITUTIONS` has already been used up, "Confirm replacement" doesn't appear and the panel explains that no substitutions remain — "Play on with ten" is the only option.

An injured CPU player never reaches the human manager at all: the opponent's side reacts on its own the following minute (see [CPU Substitutions](../technical/match-engine.md#cpu-substitutions)).

---

## Event Feed (`eventFeed`)

Each displayed entry:

```typescript
{
  id:         string    // unique key for v-for: "{minute}-{eventType}-{playbackIndex}"
  minute:     number    // in-game minute
  type:       string    // event category
  teamName:   string    // resolved from homeTeam/awayTeam
  playerName: string|null  // resolved from squad, null if not found
}
```

**Display order:** Newest first (`unshift`). New events slide in from the left via `animate-slide-in-left`.

**Event type normalisation:** a `normalizeEventType()` helper collapses spelling variants (`yellow_card` → `yellow`, `red_card` → `red`, `sub`/`sub_off` → `substitution`) to a single canonical form before any icon, colour, or label lookup runs. This closes the historical mismatch where the seeded `event_type` table used `'yellow'`/`'red'` but the icon helpers only recognised `'yellow_card'`/`'red_card'`, so card events silently fell back to the generic zap icon — every lookup now goes through the same normaliser, so a future rename in one place can't drift out of sync with another.

**Icons by event type:**
| `type` | Icon | Color class |
|---|---|---|
| `goal` | `i-lucide-circle-dot` | `text-emerald-400` |
| `yellow` (yellow card) | `i-lucide-square` | `text-amber-400` |
| `red` (red card) | `i-lucide-square` | `text-red-500` |
| `shot` | `i-lucide-crosshair` | `text-white/50` |
| `shot_on_target` | `i-lucide-target` | `text-sky-400` |
| `corner` | `i-lucide-flag-triangle-right` | `text-teal-400` |
| `cross` | `i-lucide-move-right` | `text-white/50` |
| `offside` | `i-lucide-ban` | `text-orange-300` |
| `foul` | `i-lucide-flag` | `text-orange-400` |
| `injury` | `i-lucide-heart-crack` | `text-rose-400` |
| `substitution` | `i-lucide-arrow-left-right` | `text-sky-400` |
| (other) | `i-lucide-zap` | `text-white/50` |

The feed label itself (`eventLabel()`) also goes through the normaliser: `yellow` displays as "yellow card", `red` as "red card", everything else as the normalised type with underscores replaced by spaces (so `shot_on_target` renders as "shot on target").

---

## Feed Filters

A match generates ~38 events (scaled down from real-world frequencies — see [match-engine.md](../technical/match-engine.md#event-rates-real-world-data-scaled-for-pacing)), still dominated by crosses (~13.7) and fouls (~9.5), so the feed carries filter chips. All events are always stored in `match_events` — the filter is display-only.

| Chip | Shows |
|---|---|
| **All** (default) | Every event |
| Goals | `goal` |
| Shots | `goal`, `shot_on_target`, `shot` |
| Cards | `yellow`, `red` |
| Subs | `substitution` |
| Fouls | `foul`, `offside`, `injury` |

Chips are styled with `.app-filter-chip` / `.app-filter-chip--active`. Because Goals is a subset of Shots, the counts overlap by design. When a filter matches nothing but the match has produced events, the panel reads "No events of this type yet." rather than the empty-match "No events yet."

---

## Score Display

The live score is shown in large `app-gradient-text` (emerald → sky). Both the HUD and goal celebration are derived from `applyEvents()` rather than incremented separately. The celebration folds only the events revealed through that specific goal, so it shows the score immediately after the goal even when several events are revealed at once by skip-ahead playback.

---

## LIVE Badge

When `hasStarted && !isFinished`, a pulsing **LIVE** badge appears in the clock card header. It uses `animate-live-ping` on a small red dot:

```html
<span class="size-2 rounded-full bg-red-400 animate-live-ping" />
LIVE
```

---

## Navigation Guard

```typescript
onBeforeRouteLeave(() => {
  if (hasStarted.value && !isFinished.value) {
    toast.warn({ title: 'Match in progress', description: 'Play through to full time…' })
    return false   // blocks navigation
  }
})
```

While a match is in progress (started but not finished), the player **cannot navigate away** — all route changes are blocked, with a toast explaining why. (It previously blocked silently, which read as a broken link.) The result is not committed until minute 90, so leaving early would abandon it. Once the match is finished, normal navigation resumes.

---

## Lineup Panels

Before kickoff, the Home and Away Lineup panels show the **pre-match preview XI** — resolved server-side by `GET /api/team/:id` (see [tactics.md](tactics.md#lineup-resolution-and-auto-select)). Once a match is under way, they switch to the **live** XI — `liveState.home.onPitch` / `liveState.away.onPitch` — so a substitution moves a player between the Starters and Bench sections in real time, at the minute it's revealed on the clock, not the pre-match lineup. Each panel has two sections:

**Starters** (live `onPitch`, sorted `GK → DF → MF → FW`):
- A **position badge** (color-coded: GK=sky, DF=emerald, MF=amber, FW=rose).
- Player name, coloured by their current match status (see below).
- A stamina bar (`.app-stat-bar-track`/`.app-stat-bar-fill`), reflecting fatigue as of the current minute — see [Fatigue and Stamina](../technical/match-engine.md#fatigue-and-stamina).

**Bench** (everyone else in the squad, same slot order), under a small "Bench" divider. This now includes anyone subbed off during the match, alongside players who never started.

If the team's lineup was auto-selected (no valid saved XI — true for every AI club, and true for the player's own team until they save one from the Dashboard), the panel header shows a small **"Auto"** badge.

---

## Player Status Colouring

Every name in a lineup panel is coloured from the same `liveState` the score is derived from — the state at the currently-revealed minute, not the full pre-computed event list:

| State | Class | Appearance | Condition |
|---|---|---|---|
| On the pitch | `.app-player-on-pitch` | Normal soft text colour | In `liveState[side].onPitch`, no card |
| Booked | `.app-player-booked` | Amber text | In `liveState[side].booked` |
| Sent off | `.app-player-sent-off` | Red text, strikethrough | In `liveState[side].sentOff` |
| Not on the pitch | `.app-player-out` | Muted grey | Not in `onPitch` — on the bench, or subbed off |

A red card always wins over a yellow if both are somehow present. These four classes are defined in `app/assets/css/main.css` (`--app-player-booked`, `--app-player-sent-off`, `--app-player-out` CSS variables) and are shared by both lineup panels.

---

## Responsive Layout

The three panels — Home Lineup, Match Events, Away Lineup — sit in a single CSS grid:

**Desktop (`lg` and above):** one row, three equal columns — `Home Lineup | Match Events | Away Lineup`, left to right, matching source order.

**Mobile/tablet (below `lg`):** two columns, two rows:
```
┌───────────────┬───────────────┐
│  Home Lineup   │  Away Lineup   │   ← row 1: two columns
├───────────────┴───────────────┤
│        Match Events            │   ← row 2: spans both columns
└─────────────────────────────────┘
```
Achieved with a `grid-cols-2 lg:grid-cols-3` grid, `order` utilities placing Home Lineup / Away Lineup / Match Events in that visual order on mobile (source order is Home / Events / Away, so this reflows without a DOM reorder), and `col-span-2 lg:col-span-1` on the Match Events card so it spans the full width only on the two-column mobile layout.

---

## Known Limitations

| Issue | Notes |
|---|---|
| Each segment (a half) is still simulated in one server call, not truly minute-by-minute | A pause mid-segment does change the *next* segment, but nothing the manager does between minute 12 and 13, say, can influence what already happened at minute 12 within the same segment — only what comes after the pause. |
| At most one *drawn* event per minute, but a substitution can share a minute with one | See [match-engine.md](../technical/match-engine.md#event-object-shape) — `match_events.minute` is no longer a unique key within a match. |
| No home advantage | Home/away teams have identical stats bases. |
| Resuming after a refresh mid-pause (not mid-half-time) replays the already-known segment quickly rather than re-pausing exactly where the manager left off | The server only durably remembers "paused at minute X" once an explicit sync happens (a substitution, or reaching a half/full-time boundary) — a bare pause with no changes isn't itself a sync point. A refresh in that narrow window resumes at the furthest minute with recorded events, not necessarily the exact minute the clock showed. |
| Opponent tactics never change mid-match, only substitutions | The CPU reviews its bench (see [CPU Substitutions](../technical/match-engine.md#cpu-substitutions)) but never changes formation. |
| "Territory" in the stats panel is not real possession | The engine models no possession, so the panel shows each side's share of attacking events instead. It's labelled Territory rather than Possession for that reason. |

**Previously listed here, now fixed:**
- ~~An injured player looks identical to a benched or already-substituted one~~ — injured players now render as `.app-player-injured` (rose, italic) and carry a bandage marker, distinct from `.app-player-out`.
- ~~All events are pre-computed before playback starts; pause does not affect server state~~ — the match is simulated in segments, and a pause with a substitution or tactic change genuinely alters the next segment. See [Simulation Lifecycle](#simulation-lifecycle).
- ~~No half-time indication~~ — the clock stops itself at 45' and opens the tactics panel, framed as Half Time.
- ~~Player lineup on screen ≠ actual simulated lineup~~ — the lineup panels now derive from live match state, updating in real time as substitutions happen.
- ~~`yellow`/`red` event type key mismatch~~ — a single `normalizeEventType()` helper is now the only place spelling variants are handled.
- ~~Card events had no player attached, only a team~~ — every event the engine generates now names a specific player (see [match-engine.md](../technical/match-engine.md#player-selection-by-position)).
- ~~No stamina influence on match performance~~ — see [Fatigue and Stamina](../technical/match-engine.md#fatigue-and-stamina).
- ~~Any pause in the second half failed with `400 Match has not started`~~ — the result was being committed (and `matches.state` nulled) as soon as the second half was *simulated*, ~45 seconds before it was watched. Finalisation moved to `POST /api/match/finish`, called when the clock actually reaches 90.
- ~~A batch of substitutions was validated against a frozen snapshot~~ — chaining ("A off, B on" then "B off, C on") was wrongly rejected, and a batch could exceed `MAX_SUBSTITUTIONS`. Validation now folds each swap in before checking the next.
- ~~A failed match request left the page frozen with the spinner up and no explanation~~ — every match call now reports errors as a toast and restores the controls.
- ~~The tactics panel stayed painted over the full-time screen~~ — it is `v-if`d on the same condition as its `open` prop, so it unmounts rather than lingering with stale staged substitutions.
