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

Each team's stats are recomputed **every minute** from whoever is currently on the pitch:

```
avgSkill = Σ effectiveSkill(p.skillLevel, stamina[p.id]) / 11   ← fixed 11, not onPitch.length
attack   = avgSkill + tactic.modifiers.attack
defence  = avgSkill + tactic.modifiers.defence
```

Fatigue is folded in via `effectiveSkill`, and the divisor is a fixed eleven so a red card or an unreplaced injury genuinely costs the side. See [match-engine.md § Team Stats](../technical/match-engine.md#phase-2--team-stats-calculateteamstats).

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
- Selection is **silent on success** — the marker appearing on the pitch is the feedback. Only a *blocked* tap raises a toast ("Cannot select that player") carrying the specific reason, e.g. "Midfielders slots are full" or "Teamsheet already full".
- Changing formation invalidates the slot limits, so it **asks first** via `AppConfirmModal` and then clears the XI with an undoable toast ("Formation set to 4-3-3 — the previous teamsheet was cleared"). It only asks when there is actually something to lose.

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
| Unavailable | "Unavailable" (ghost/outline) | lineup full, position full, unknown position, or injured |
| Injured | Blocked, reason `"Injured for {n} more matches"` | `player.injuredMatches > 0` **and** a fit player is still available for their line — checked before every other rule, so an injured player never shows a slot-based reason instead |

**Low stamina never blocks selection.** A tired player is still pickable — just weaker in the engine's `effectiveSkill` calculation — so a squad can never be locked out of naming eleven players. Only `injuredMatches > 0` does that; see [match-engine.md § Injuries](../technical/match-engine.md#injuries). The squad table marks an injured row with a red `Injured · {n}` badge and muted text, the same treatment the Team page uses for stamina.

**Injury stops blocking once it would deadlock the teamsheet.** Every formation needs exactly one goalkeeper, so a club whose keepers are all injured could never satisfy the slot counts **Go to Matchday** is gated on, in any formation — a permanent lockout. So an injured player becomes selectable as soon as the fit players in their slot no longer cover what the formation asks for; the injured warning still shows, they are simply no longer blocked when they are the only option. If the squad is short in a slot outright and *no* formation can be filled, the dashboard offers **Field an emergency XI**, which hands selection to `autoSelectLineup()` — the same fallback described below for CPU clubs.

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

All AI teams have `tactics = NULL` in the initial seed data. They always simulate with the default 4-4-2 formation, and never change it — mid-match or between matches. AI tactic variety is not implemented.

---

## Lineup Resolution and Auto-Select

Every team that enters a match — human or AI — resolves to an XI through the same shared function, `resolveLineup()` in `frontend/shared/lineup.ts`:

1. **Saved lineup, if valid.** If `teams.lineup` names exactly 11 players still present in the squad **and none of them are currently injured**, that XI starts. (A player sold, or injured, since the lineup was saved silently invalidates it the same way — the saved list won't resolve to 11, and auto-selection takes over instead of erroring.)
2. **Auto-selected, otherwise.** `autoSelectLineup()` fills the tactic's formation slots (`GK`, `DF`, `MF`, `FW`) with the squad's highest-`skillLevel` **fit** players in each slot — anyone with `injuredMatches > 0` is skipped first. If the squad is short in some slot, the shortfall is filled with the best remaining outfield players; a spare goalkeeper is used only as a last resort, and an injured player is only ever included if there's no other way to reach eleven — fielding someone carrying a knock is bad, but fielding nine is worse.

**Every AI-controlled club is always auto-selected**, since only the player's own team currently has a "save lineup" UI. The player's team is auto-selected too, until they visit the Dashboard and save an XI — the very first match of a new save, before the lineup builder has been touched, is auto-selected for both sides.

**Reusability by design:** `autoSelectLineup()` takes a squad and a formation and returns an XI — it has no dependency on which team it's for. The Dashboard's **Auto-pick best XI** button and its **Field an emergency XI** fallback both call it for the player's own team, so the human and CPU paths share one implementation rather than two that can drift.

**Where this shows up:**
- `GET /api/team/:id` resolves and returns `startingXi` (array of ids), `bench` (array of ids), and `lineupAutoSelected` (boolean) alongside the raw squad — see [api-routes.md](../technical/api-routes.md).
- The Matchday lineup panels render exactly `startingXi`/`bench` from that response, and show an "Auto" badge when `lineupAutoSelected` is true. See [matchday.md](matchday.md).
- The match engine (`kickOff()`) calls the same `resolveLineup()` internally, so the XI shown in the Matchday preview and the XI that actually kicks off are guaranteed to match (barring a lineup change made between page load and kickoff, which the engine's own resolution call — not the preview — has final say over). Once the match is under way, the *live* XI can differ from this initial resolution — see below.

---

## Mid-Match Tactical Changes

Everything above resolves the lineup a team **starts** with. During the match itself, the player's own team can change both the XI (substitutions) and the formation from `MatchTacticsPanel`, at any pause or at the forced half-time break — see [matchday.md](matchday.md#tactical-pauses-and-half-time) for the UI and `POST /api/match/changes` in [api-routes.md](../technical/api-routes.md) for the endpoint.

Rules, enforced identically client-side (`substitutionError()`, greying out illegal choices) and server-side (the same function, returning a `400` if a request somehow gets through anyway):

- Up to **5 substitutions** per team per match (`MAX_SUBSTITUTIONS` in `shared/match-state.ts`).
- A substituted-off player cannot return to the pitch later in the match.
- A player who was already injured before kickoff never appears on the in-match bench either — `kickOff()` filters them out the same way `autoSelectLineup` does before the match.
- An injury **during** the match is itself treated as a substitution waiting to happen: the injured player counts as a legal "outgoing" choice (they're already off the pitch) until someone comes on for them, or the manager chooses to play on short — see [Injury Pauses](matchday.md#injury-pauses).
- A formation change takes effect from the next simulated minute onward — it does not retroactively change anything already played, and (like the pre-match tactic picker) does not force a lineup reshuffle to fit new slot counts; `calculateTeamStats` just applies the new tactic's modifiers to whoever is currently on the pitch.

**AI-controlled teams manage their own bench** — see [match-engine.md](../technical/match-engine.md#cpu-substitutions) — but never change formation mid-match. An injury is the one thing that makes them act outside their scheduled review minutes: they replace an injured player immediately rather than waiting.

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
