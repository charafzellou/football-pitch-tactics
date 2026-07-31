# CSS Styling System

The app uses **Tailwind CSS v4** configured via the CSS-first `@theme` approach — no `tailwind.config.js`. All theming lives in `frontend/app/assets/css/main.css`.

---

## File Structure

```
main.css
├── @import "tailwindcss"          ← Tailwind v4 base + utilities
├── @import "@nuxt/ui"             ← Nuxt UI component styles
├── @theme static { ... }          ← Custom color tokens + animation tokens
├── @keyframes { ... }             ← Animation definitions
├── @layer base { :root { ... } }  ← CSS custom properties (--app-*, --ui-*)
├── @layer base { body { ... } }   ← Global body styles
└── @layer components { ... }      ← Named CSS component classes
```

---

## Tailwind v4 Theme Tokens

Defined in `@theme static`. All values here become Tailwind utility classes automatically.

### Green Color Override
The default Tailwind green palette is replaced with Nuxt's custom green scale, used for the `emerald` primary colour theme:

```css
--color-green-50:  #effdf5
--color-green-400: #00dc82   /* primary emerald accent */
--color-green-500: #00c16a
...
--color-green-950: #052e16
```

### Animation Tokens
These become `animate-*` Tailwind utility classes:

| Token | Value | Class | Usage |
|---|---|---|---|
| `--animate-fade-in-up` | `fadeInUp 0.5s ease-out both` | `animate-fade-in-up` | Page section entry (hero, cards) |
| `--animate-slide-in-left` | `slideInLeft 0.35s ease-out both` | `animate-slide-in-left` | Match event feed items |
| `--animate-live-ping` | `livePing 1.4s ease-in-out infinite` | `animate-live-ping` | Pulsing LIVE dot on matchday |
| `--animate-shimmer` | `shimmer 2.4s linear infinite` | `animate-shimmer` | Loading shimmer (reserved) |

---

## CSS Custom Properties (`:root`)

All app-specific CSS variables are declared in `@layer base :root`. They are consumed by the `@layer components` classes and inline `style` attributes in templates.

### Shell (page background gradient)
```
--app-shell-from: #07121a   (darkest top-left)
--app-shell-via:  #0b1722   (centre)
--app-shell-to:   #132432   (lightest bottom-right)
```
Applied to `body` and `.app-shell` as `linear-gradient(135deg, from, via, to)`.

### Surfaces
```
--app-surface:        rgba(15, 23, 35, 0.94)    ← main cards
--app-surface-subtle: rgba(20, 32, 45, 0.94)    ← secondary cards
--app-surface-muted:  rgba(28, 41, 56, 0.96)    ← metric cards, inputs
--app-surface-border: rgba(148, 163, 184, 0.18) ← card/input borders
```

### Topbar
```
--app-topbar:        rgba(4, 10, 16, 0.97)    ← sticky header bg
--app-topbar-panel:  rgba(8, 18, 27, 0.99)    ← mobile dropdown
--app-topbar-border: rgba(148, 163, 184, 0.14)
--app-topbar-text:   #f8fafc
--app-topbar-muted:  rgba(167, 243, 208, 0.8)  ← kicker (green tint)
--app-topbar-link:   rgba(226, 232, 240, 0.9)
--app-topbar-hover:  rgba(255, 255, 255, 0.12)
```

### Text
```
--app-text:        #f8fafc   ← primary (near white)
--app-text-soft:   #dbe7f4   ← secondary
--app-text-muted:  #94a3b8   ← captions, labels
--app-text-kicker: #9fb3c8   ← section kicker labels
```

### Status Badges
```
--app-badge-success-bg:    rgba(16, 185, 129, 0.18)
--app-badge-success-text:  #a7f3d0
--app-badge-warning-bg:    rgba(245, 158, 11, 0.2)
--app-badge-warning-text:  #fde68a
--app-badge-selection-bg:  rgba(34, 197, 94, 0.18)
--app-badge-selection-text:#bbf7d0
```

### Pitch
```
--app-pitch-from:      rgba(52, 211, 153, 0.12)  ← top gradient (translucent green)
--app-pitch-via:       #0d6048                    ← mid green
--app-pitch-to:        #08131d                    ← dark bottom
--app-pitch-card:      rgba(255, 255, 255, 0.12)  ← player card bg
--app-pitch-card-hover:rgba(255, 255, 255, 0.18)
--app-pitch-slot:      rgba(8, 15, 23, 0.36)      ← empty slot bg
--app-pitch-text:      #f8fafc
--app-pitch-muted:     rgba(220, 252, 231, 0.84)
--app-pitch-faint:     rgba(226, 232, 240, 0.66)
```

### Nuxt UI Variables
The `--ui-*` variables are consumed by Nuxt UI components:

```
--ui-bg:               #0f1722   ← base background
--ui-bg-muted:         #172231
--ui-bg-elevated:      #1d2b3c   ← card backgrounds (UCard variant: subtle)
--ui-bg-accented:      #243547
--ui-bg-inverted:      #f8fafc
--ui-text:             #e5edf7
--ui-text-dimmed:      #8ba0b5
--ui-text-muted:       #9bb1c7
--ui-text-toned:       #bfd0e0
--ui-text-highlighted: #f8fafc
--ui-text-inverted:    #08111b
--ui-border:           rgba(148, 163, 184, 0.2)
--ui-border-muted:     rgba(148, 163, 184, 0.12)
--ui-border-accented:  rgba(148, 163, 184, 0.3)
--ui-border-inverted:  #08111b
```

---

## Component Classes (`@layer components`)

Named semantic classes that compose Tailwind utilities + CSS variables. Use these in templates instead of inline Tailwind chains.

### Layout
| Class | Purpose | Key styles |
|---|---|---|
| `.app-shell` | Full-page wrapper | `min-h-screen`, background gradient |
| `.app-topbar` | Sticky top navbar | `backdrop-blur`, topbar bg/border |
| `.app-topbar-panel` | Mobile menu dropdown | topbar-panel bg/border |
| `.app-topbar-kicker` | Brand sub-label | `topbar-muted` color |
| `.app-topbar-link` | Nav link | `topbar-link` color + hover |

### Typography
| Class | Purpose | Key styles |
|---|---|---|
| `.app-page-title` | `h1` on each page | `text-2xl font-bold sm:text-3xl` |
| `.app-kicker` | Small section label above headings | `text-xs uppercase tracking-[0.2em]` + kicker color |
| `.app-muted-text` | Secondary/description text | `text-muted` color |

### Cards & Surfaces
| Class | Purpose | Key styles |
|---|---|---|
| `.app-surface` | Primary card | `rounded-3xl border backdrop-blur`, surface bg/border, deep shadow |
| `.app-surface-subtle` | Secondary card | `rounded-2xl border`, surface-subtle bg |
| `.app-table-shell` | Table wrapper | `overflow-x-auto rounded-3xl`, surface bg |
| `.app-metric-card` | Stat display tile | `rounded-2xl border p-4`, surface-muted bg |
| `.app-card-root` | Applied to all `UCard` roots via `app.config.ts` | `rounded-3xl overflow-hidden` |
| `.app-card-header` | Applied to `UCard` header slot | `p-5 font-semibold sm:px-6` |
| `.app-card-body` | Applied to `UCard` body slot | `p-5 sm:p-6` |
| `.app-card-footer` | Applied to `UCard` footer slot | `p-5 sm:px-6` |

### Form Controls
| Class | Purpose | Key styles |
|---|---|---|
| `.app-control` | Native `<select>` dark styling | `rounded-xl border px-3 py-2 text-sm`, surface-muted bg |

### Status Pills
| Class | Purpose | Key styles |
|---|---|---|
| `.app-status-pill` | Base pill | `rounded-full px-3 py-1 text-xs font-semibold` |
| `.app-status-pill--success` | "Lineup ready" | success badge colours |
| `.app-status-pill--warning` | "Incomplete lineup" | warning badge colours |
| `.app-selection-pill` | "Selected" badge on player rows | `rounded-full px-2 text-[11px]`, selection colours |

### Pitch
| Class | Purpose | Key styles |
|---|---|---|
| `.app-pitch-board` | Green pitch backdrop | `rounded-4xl`, pitch gradient bg, inset white border |
| `.app-pitch-player` | Filled player card on pitch | glass-style card, `hover:-translate-y-0.5` |
| `.app-pitch-slot` | Empty slot on pitch | dashed border, slot bg |
| `.app-pitch-muted` | Muted text inside pitch | pitch-muted color |
| `.app-pitch-faint` | Very muted text inside pitch | pitch-faint color |

### Gradient & Progress
| Class | Purpose | Key styles |
|---|---|---|
| `.app-gradient-text` | Emerald→sky gradient headline | `bg-clip-text text-transparent`, gradient background |
| `.app-stat-bar-track` | Background track of a progress bar | `h-1.5 rounded-full`, muted bg |
| `.app-stat-bar-fill` | Coloured fill of a progress bar | `h-full rounded-full`, `transition-all duration-500`, emerald gradient |

---

## Keyframe Animations

```css
fadeInUp:      opacity 0→1, translateY 16px→0  (0.5s ease-out)
slideInLeft:   opacity 0→1, translateX -12px→0 (0.35s ease-out)
livePing:      scale 1→1.3→1, opacity 1→0.6→1  (1.4s infinite)
shimmer:       background-position sweep        (2.4s linear infinite)
```

---

## Usage Patterns in Templates

**Prefer CSS component classes over raw Tailwind chains:**
```html
<!-- ✅ Good -->
<div class="app-surface">...</div>

<!-- ❌ Avoid (harder to maintain) -->
<div class="rounded-3xl border shadow-sm backdrop-blur bg-[rgba(15,23,35,0.94)] border-[rgba(148,163,184,0.18)]">...</div>
```

**Use `style` for one-off CSS variable values:**
```html
<span style="color: var(--app-text-muted)">...</span>
```

**Use Tailwind utilities for spacing/sizing:**
```html
<div class="app-metric-card mt-4 sm:col-span-2">
```
