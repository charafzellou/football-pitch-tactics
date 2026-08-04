# Matchday

The matchday page (`/matchday`) is the core gameplay experience. It simulates a football match as a minute-by-minute live feed with a virtual clock.

---

## Prerequisites

Before the player can start a matchday:

1. An active save must exist (enforced by global middleware).
2. The player must have a valid 11-player lineup selected and a tactic chosen (enforced by the Dashboard's **Go to Matchday** button, which calls `PUT /api/team/:id/tactics` and only navigates if `lineupIsComplete === true`).
3. There must be an unplayed fixture for the player's team (the page reads `GET /api/schedule` on mount; if the schedule is empty, the match info section shows nothing).

---

## Page States

The matchday page has five distinct states, controlled by `hasStarted`, `playing`, `isFinished`, and `loadingMatch`:

| State | `hasStarted` | `playing` | `isFinished` | `loadingMatch` | UI shown |
|---|---|---|---|---|---|
| Pre-match | `false` | `false` | `false` | `false` | **Start Match** button |
| Loading | `false` | `false` | `false` | `true` | Spinner on Start button |
| Playing | `true` | `true` | `false` | `false` | **Pause** button |
| Paused | `true` | `false` | `false` | `false` | **Resume** button |
| Finished | `true` | `false` | `true` | `false` | **End Match** button |

---

## Simulation Lifecycle

### 1. Pre-match setup (on mount)
```
GET /api/schedule  →  nextMatch (first unplayed fixture)
GET /api/team/:homeTeamId  →  homeTeam (name, full squad, startingXi, bench, lineupAutoSelected)
GET /api/team/:awayTeamId  →  awayTeam (name, full squad, startingXi, bench, lineupAutoSelected)
```

`startingXi`/`bench` are already resolved server-side (saved lineup if valid, otherwise auto-selected) — the page does not re-derive a lineup itself. See [tactics.md](tactics.md#lineup-resolution-and-auto-select) for the resolution rules.

### 2. Start Match (user clicks button)

```
POST /api/match/simulate { matchId: nextMatch.id }
```

The server:
1. Runs `simulateMatch()` — the entire 90-minute simulation completes in microseconds.
2. Persists the result to `matches` and all events (each with a `playerId`) to `match_events`.
3. Returns: `{ homeScore, awayScore, events: MatchEvent[], homeLineup: number[], awayLineup: number[] }`.

All 90 minutes of events are now in memory on the client. `homeLineup`/`awayLineup` are the player ids the engine actually fielded — the client adopts them (`homeStartingXi`/`awayStartingXi`), replacing the pre-match preview, so the lineup panels are guaranteed to reflect the XI that was simulated even in the rare case a lineup changed between page load and kickoff.

### 3. Playback loop

Once the simulation response arrives:
```
hasStarted = true
playing    = true
```

A `setInterval` fires every **1000 ms** (1 second = 1 in-game minute), calling `tickOnce()`.

### 4. `tickOnce()` — the heart of the playback

On each tick:
1. Check if `currentMinute >= 90` → stop interval, `isFinished = true`, return.
2. Increment `currentMinute` by 1.
3. While the next event in `events[playbackIndex]` has `minute <= currentMinute`:
   - Resolve the team name from `homeTeam.id` or `awayTeam.id`.
   - Resolve the player name from `team.squad.find(p => p.id === event.playerId)`. Every generated event has a `playerId` now (see [match-engine.md](../technical/match-engine.md)), so this reliably finds a name — it previously could not for card events, which only carried a `teamId`.
   - Prepend a `PlaybackEntry` to `eventFeed` (`unshift` → newest at top).
   - If `eventType === 'goal'`, increment the appropriate score.
   - Advance `playbackIndex`.

This means multiple events at the same minute are all surfaced in a single tick.

`playbackIndex` also drives the lineup panels' player colouring (see [Player Status Colouring](#player-status-colouring) below): `revealedEvents` is `events.slice(0, playbackIndex)`, so a card only colours a player once its minute has actually played out on the clock — not the instant the simulation result arrives.

### 5. Pause / Resume

**Pause:** Clears the interval. `playing = false`. The clock freezes.

**Resume:** Restarts the interval from `currentMinute`. No state is lost.

### 6. Full time

When `currentMinute` reaches 90:
- Clock stops.
- `isFinished = true`.
- **End Match** button appears (navigates to `/game`).

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

A realistic match generates ~63 events, dominated by crosses (21.5) and fouls (15.5), so the feed carries filter chips. All events are always stored in `match_events` — the filter is display-only.

| Chip | Shows |
|---|---|
| **All** (default) | Every event |
| Goals | `goal` |
| Shots | `goal`, `shot_on_target`, `shot` |
| Cards | `yellow`, `red` |
| Fouls | `foul`, `offside`, `injury` |

Chips are styled with `.app-filter-chip` / `.app-filter-chip--active`. Because Goals is a subset of Shots, the counts overlap by design. When a filter matches nothing but the match has produced events, the panel reads "No events of this type yet." rather than the empty-match "No events yet."

---

## Score Display

The live score is shown in large `app-gradient-text` (emerald → sky). It updates immediately when a goal event is processed in `tickOnce()`:

```
homeScore += 1   when event.teamId === homeTeam.id && event.eventType === 'goal'
awayScore += 1   when event.teamId === awayTeam.id && event.eventType === 'goal'
```

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
  if (hasStarted.value && !isFinished.value)
    return false   // blocks navigation
})
```

While a match is in progress (started but not finished), the player **cannot navigate away** — all route changes are blocked. This prevents data corruption (the match has already been persisted by the server, but `game.currentDate` may not have advanced yet in the client's mental model). Once the match is finished, normal navigation resumes.

---

## Lineup Panels

The Home and Away Lineup panels show the **starting XI**, not the full squad — resolved server-side by `GET /api/team/:id` (see [tactics.md](tactics.md#lineup-resolution-and-auto-select)). Each panel has two sections:

**Starters** (`startingXi`, in `GK → DF → MF → FW` order):
- A **position badge** (color-coded: GK=sky, DF=emerald, MF=amber, FW=rose).
- Player name, coloured by their current match status (see below).

**Bench** (everything else in the squad, same slot order), under a small "Bench" divider. Bench players use a slightly dimmed position badge and start out in the same muted grey as an unused player.

If the team's lineup was auto-selected (no valid saved XI — true for every AI club, and true for the player's own team until they save one from the Dashboard), the panel header shows a small **"Auto"** badge.

---

## Player Status Colouring

Every name in a lineup panel is coloured based on events that have actually played out on the clock so far (`revealedEvents`, driven by `playbackIndex` — see [`tickOnce()`](#4-tickonce--the-heart-of-the-playback) above), not the full pre-computed event list:

| State | Class | Appearance | Condition |
|---|---|---|---|
| On the pitch | `.app-player-on-pitch` | Normal soft text colour | Default state for a starter with no card and not substituted |
| Booked | `.app-player-booked` | Amber text | Player has a revealed `yellow` event and no `red` |
| Sent off | `.app-player-sent-off` | Red text, strikethrough | Player has a revealed `red` event |
| Not on the pitch | `.app-player-out` | Muted grey | Player is on the bench, or was substituted off (a revealed `substitution` event) |

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
| All events are pre-computed before playback starts | The "live" feel is purely cosmetic — the result is known the instant the player clicks Start. |
| Pause does not affect server state | The server has already returned all events at simulation start. |
| No half-time indication | The clock just counts to 90 continuously. |
| At most one event per minute | A deliberate constraint of the engine, not a display limit — see [match-engine.md](../technical/match-engine.md#one-draw-per-minute). Real matches can cluster several events into one minute. |
| No stamina influence on match performance, no home advantage | See [match-engine.md](../technical/match-engine.md#known-limitations--history) for the full list of engine-level gaps. |

**Previously listed here, now fixed:**
- ~~Player lineup on screen ≠ actual simulated lineup~~ — the page now shows the resolved starting XI (saved or auto-selected), matching what the engine actually simulates.
- ~~`yellow`/`red` event type key mismatch~~ — a single `normalizeEventType()` helper is now the only place spelling variants are handled.
- ~~Card events had no player attached, only a team~~ — every event the engine generates now names a specific player (see [match-engine.md](../technical/match-engine.md#player-selection-by-position)).
