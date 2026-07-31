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
The frontend normalises various position string formats to the four canonical values `GK | DF | MF | FW`:

```typescript
function normalizePosition(position: string): 'GK' | 'DF' | 'MF' | 'FW' | null {
  // 'GOALKEEPER' | 'GK'                     → 'GK'
  // 'DEFENDER'   | 'DEF' | 'DF'             → 'DF'
  // 'MIDFIELDER' | 'MID' | 'MF'             → 'MF'
  // 'FORWARD'    | 'ATTACKER' | 'ATT' | 'FW' → 'FW'
  // anything else                            → null
}
```

Players with an unrecognised position string (returns `null`) cannot be selected and show `"Unknown position"` on hover.

### Selection State
Each player in the squad table can be:
| State | Button label | Condition |
|---|---|---|
| Selected | "Selected" (success/soft) | `player.id` is in `selectedPlayers` |
| Selectable | "Select" (primary/solid) | slot available for their position |
| Unavailable | "Unavailable" (ghost/outline) | lineup full, position full, or unknown position |

---

## Saving Tactics

When the player clicks **Go to Matchday**, the selected tactic is persisted:

```
PUT /api/team/:teamId/tactics  { tactics: "4-3-3" }
```

This writes `teams.tactics = '4-3-3'` so that when the match simulation runs server-side, it reads the team's saved tactic from the DB. If a team has `tactics = NULL`, the engine uses `TACTICS[0]` (4-4-2) as the default.

---

## AI Team Tactics

All AI teams have `tactics = NULL` in the initial seed data. They always simulate with the default 4-4-2 formation. Implementing AI tactic variety is listed in `TASKS.md` task #18.

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
