# Tactics

Tactics define the formation and attack/defence modifiers for a team. They are the core strategic decision the player makes before each matchday.

---

## Available Formations

Defined in `frontend/server/core/tactics.ts` and served by `GET /api/tactics`.

| Name | Formation | Attack Modifier | Defence Modifier | Style |
|---|---|---|---|---|
| `4-4-2` | 1 GK, 4 DF, 4 MF, 2 FW | +0 | +0 | Balanced |
| `4-5-1` | 1 GK, 4 DF, 5 MF, 1 FW | −1 | +1 | Defensive |
| `4-3-3` | 1 GK, 4 DF, 3 MF, 3 FW | +1 | −1 | Attacking |
| `3-5-2` | 1 GK, 3 DF, 5 MF, 2 FW | +1 | −2 | High risk |

---

## Formation Notation

The formation string `X-Y-Z` refers to Defenders–Midfielders–Forwards. The goalkeeper is always 1. The engine uses:

```typescript
formation: { GK: 1, DF: 4, MF: 4, FW: 2 }
```

The total always sums to **11 players**.

---

## How Modifiers Work

After lineup selection, each team's stats are:

```
avgSkill = average(lineup.skillLevel)
attack   = avgSkill + tactic.modifiers.attack
defence  = avgSkill + tactic.modifiers.defence
```

These stats feed directly into the match engine's attack-chance calculation. The modifiers are small (−2 to +1) relative to the skill scale (50–99), so formation choice has a noticeable but not overwhelming effect.

**Example:** If two equal squads both average skill 75:
- Team A playing 4-3-3: attack = 76, defence = 74
- Team B playing 4-5-1: attack = 74, defence = 76
- Team A will generate slightly more shot opportunities; Team B will convert fewer of Team A's shots.

---

## Lineup Builder Rules

The lineup builder on the Dashboard enforces these rules:

### Slot Limits
Each formation defines how many players of each position can be selected:
- Selecting a player for a position that is already full shows a toast: `"{position} full"`.
- Changing formation clears the entire current lineup (toast: `"Lineup reset"`).

### Total Players
- Exactly 11 players must be selected.
- `lineupIsComplete = true` only when all position slots are exactly full AND total = 11.

### Position Normalisation
`normalizePosition()` — defined once in `frontend/shared/lineup.ts` and imported by both the client and the match engine — maps every position string format to the four canonical values `GK | DF | MF | FW`:

```typescript
function normalizePosition(position: string): 'GK' | 'DF' | 'MF' | 'FW' | null {
  // 'GOALKEEPER' | 'GK'                     → 'GK'
  // 'DEFENDER'   | 'DEF' | 'DF'             → 'DF'
  // 'MIDFIELDER' | 'MID' | 'MF'             → 'MF'
  // 'FORWARD'    | 'ATTACKER' | 'ATT' | 'FW' → 'FW'
  // anything else                            → null
}
```

Players with an unrecognised position string (returns `null`) cannot be selected and show `"Unknown position"` on hover. Because this lives in `shared/`, the same rule governs which pool a player falls into during match-engine auto-selection — see [match-engine.md](../technical/match-engine.md).

### Selection State
Each player in the squad table can be:
| State | Button label | Condition |
|---|---|---|
| Selected | "Selected" (success/soft) | `player.id` is in `selectedPlayers` |
| Selectable | "Select" (primary/solid) | slot available for their position |
| Unavailable | "Unavailable" (ghost/outline) | lineup full, position full, or unknown position |

---

## Saving Tactics and Lineup

When the player clicks **Go to Matchday**, both the selected tactic and the selected starting XI are persisted, in sequence:

```
PUT /api/team/:teamId/tactics  { tactics: "4-3-3" }
PUT /api/team/:teamId/lineup   { lineup: [12, 45, 78, ...] }   // exactly 11 player ids
```

This writes `teams.tactics = '4-3-3'` and `teams.lineup = "[12,45,78,...]"`, so that when the match simulation runs server-side it reads both the team's saved tactic and its saved XI from the DB — the engine no longer re-derives a lineup for the player's team, it plays with exactly what was picked on the Dashboard. If a team has `tactics = NULL`, the engine uses the default 4-4-2. If either save request fails, the client shows an error toast and does **not** navigate to `/matchday`, so the player is never sent into a match with a stale or partially-saved team sheet.

`PUT /api/team/:teamId/lineup` validates the payload before writing: it must resolve to exactly 11 distinct player ids that belong to the team's current squad, or the request is rejected with `400`. Sending an empty/invalid body instead clears the saved lineup (`teams.lineup = NULL`), handing the team back to auto-selection.

A saved lineup is only ever used if it's still valid at read time — see [Lineup Resolution and Auto-Select](#lineup-resolution-and-auto-select) below.

---

## AI Team Tactics

All AI teams have `tactics = NULL` in the initial seed data. They always simulate with the default 4-4-2 formation. Implementing AI tactic variety is listed in `TASKS.md` task #18.

---

## Lineup Resolution and Auto-Select

Every team that enters a match — human or AI — resolves to an XI through the same shared function, `resolveLineup()` in `frontend/shared/lineup.ts`:

1. **Saved lineup, if valid.** If `teams.lineup` names exactly 11 players still present in the squad, that XI starts. (A player sold since the lineup was saved silently invalidates it — the saved list won't resolve to 11, and auto-selection takes over instead of erroring.)
2. **Auto-selected, otherwise.** `autoSelectLineup()` fills the tactic's formation slots (`GK`, `DF`, `MF`, `FW`) with the squad's highest-`skillLevel` players in each slot. If the squad is short in some slot, the shortfall is filled with the best remaining outfield players — a spare goalkeeper is used only as a last resort, so a squad with too few defenders doesn't end up fielding three keepers.

**Every AI-controlled club is always auto-selected**, since only the player's own team currently has a "save lineup" UI. The player's team is auto-selected too, until they visit the Dashboard and save an XI — the very first match of a new save, before the lineup builder has been touched, is auto-selected for both sides.

**Reusability by design:** `autoSelectLineup()` takes a squad and a formation and returns an XI — it has no dependency on which team it's for. This is the same function a future "Auto-select" button on the Dashboard's lineup builder would call for the player's own team; the logic already lives in one place rather than being duplicated when that button is added.

**Where this shows up:**
- `GET /api/team/:id` resolves and returns `startingXi` (array of ids), `bench` (array of ids), and `lineupAutoSelected` (boolean) alongside the raw squad — see [api-routes.md](../technical/api-routes.md).
- The Matchday lineup panels render exactly `startingXi`/`bench` from that response, and show an "Auto" badge when `lineupAutoSelected` is true. See [matchday.md](matchday.md).
- The match engine (`simulateMatch()`) calls the same `resolveLineup()` internally, so the XI shown in the Matchday preview and the XI that actually plays are guaranteed to match (barring a lineup change made between page load and kickoff, which the engine's own resolution call — not the preview — has final say over).

---

## Pitch Visualisation

The Dashboard renders the lineup as a football pitch diagram. Rows are ordered from the player's goal outward:

```
[ Forward Line    ] ← FW slots
[ Midfield Line   ] ← MF slots
[ Defensive Line  ] ← DF slots
[ Goalkeeper      ] ← GK slot (always 1)
```

Each slot is either:
- A **player card** (glass-style, shows initials, OVR, STA) — clicking removes the player.
- An **empty slot** (dashed border with position label) — prompts the player to select from the table below.

The pitch has decorative SVG-like elements drawn with absolute-positioned `<div>` elements: outer field border, centre line, centre circle, penalty areas at top and bottom.
