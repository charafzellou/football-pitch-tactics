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
GET /api/team/:homeTeamId  →  homeTeam (name + full squad)
GET /api/team/:awayTeamId  →  awayTeam (name + full squad)
```

### 2. Start Match (user clicks button)

```
POST /api/match/simulate { matchId: nextMatch.id }
```

The server:
1. Runs `simulateMatch()` — the entire 90-minute simulation completes in microseconds.
2. Persists the result to `matches` and all events to `match_events`.
3. Returns: `{ homeScore, awayScore, events: MatchEvent[] }`.

All 90 minutes of events are now in memory on the client.

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
   - Resolve the player name from `team.squad.find(p => p.id === event.playerId)`.
   - Prepend a `PlaybackEntry` to `eventFeed` (`unshift` → newest at top).
   - If `eventType === 'goal'`, increment the appropriate score.
   - Advance `playbackIndex`.

This means multiple events at the same minute are all surfaced in a single tick.

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

**Icons by event type:**
| `type` | Icon | Color class |
|---|---|---|
| `goal` | `i-lucide-circle-dot` | `text-emerald-400` |
| `yellow` (yellow card) | `i-lucide-square` | `text-amber-400` |
| `red` (red card) | `i-lucide-square` | `text-red-500` |
| `substitution` | `i-lucide-arrow-left-right` | `text-sky-400` |
| (other) | `i-lucide-zap` | `text-white/50` |

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

Both home and away squads are displayed in the side columns. Each player entry shows:
- A **position badge** (color-coded: GK=sky, DEF=emerald, MID=amber, ATT=rose).
- Player name.

This provides context about which players are playing, though the simulation uses the engine's own `selectLineup()` function based on DB positions — not the lineup the player selected on the Dashboard.

---

## Known Limitations

| Issue | Notes |
|---|---|
| Player lineup on screen ≠ actual simulated lineup | The page shows the full squad, not just the 11 selected. The engine selects its own best XI. |
| All events are pre-computed before playback starts | The "live" feel is purely cosmetic — the result is known the instant the player clicks Start. |
| Pause does not affect server state | The server has already returned all events at simulation start. |
| No half-time indication | The clock just counts to 90 continuously. |
| `yellow`/`red` event type key mismatch | The seed `event_type` table uses `'yellow'` and `'red'`, but the `eventIcon()` helper checks for `'yellow_card'` and `'red_card'`. Card icons will fall back to the default zap icon. |
