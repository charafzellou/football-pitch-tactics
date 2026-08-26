# Testing

Unit tests for the parts of the app that are plain TypeScript logic: `server/core/*` (game rules), `shared/*` (rules the client and server both run) and `app/utils/*` (client-side pure helpers). Run with `bun run test`, or `bun run test:coverage` for a coverage report. Wired into GitHub Actions CI — see [CI](#ci).

---

## Scope, and why it stops where it does

This suite is **unit tests of pure functions**, deliberately. There is no database test fixture, no component test harness, and no end-to-end runner in this project yet. That draws a hard line through the codebase:

| In scope | Out of scope |
|---|---|
| `server/core/economy.ts`, `contracts.ts`, `loans.ts`, `calendar.ts`, `tactics.ts`, `progression.ts`, `match-engine.ts` — pure functions of numbers in, numbers out | `server/core/save.ts`, `season.ts`, `market.ts`, `board.ts`, `matchday.ts`, `matchday-ai.ts`, `finance.ts`, `news.ts`, `sponsors.ts`, `stadium.ts`, `projection.ts`, `results-server.ts`, `match-session.ts` — every function opens a `db.transaction()` or reads `db` directly |
| `server/core/standings.ts`'s `byLeaguePosition` (the sort comparator) | `server/core/standings.ts`'s `computeStandings` (queries `db`) |
| `server/core/insolvency.ts`'s `stageFor` (the escalation rule) | `server/core/insolvency.ts`'s `settleInsolvency`/`forceSale` (query and mutate `db`) |
| `shared/lineup.ts`, `progression.ts`, `finance.ts`, `match-state.ts` — no DB dependency by construction (that's *why* they live in `shared/`, see [architecture.md](architecture.md)) | — |
| `app/utils/format.ts`, `results.ts`, `match-events.ts`, and `table.ts`'s `positionSortingFn` | `app/utils/table.ts`'s `sortableHeader` (renders a Vue component via `h()`), `theme-definitions.ts`/`themes.ts` (build-time config tables, no logic) |
| — | Every `server/api/**` route handler, every Vue page/component/composable |

The DB-coupled half of `server/core` is not untested in an absolute sense — `frontend/scripts/verify-economy.ts` and `verify-multi-save.ts` already exercise most of it end-to-end against a real seeded database (see [database-schema.md](database-schema.md) and the multi-tenancy work that produced `verify-multi-save.ts`). It's untested *by this suite specifically*, because a unit test needs a unit: a function you can call with plain arguments and get a plain return value back, no transaction required. `settleInsolvency(gameRow, input)` doesn't have that shape — it mutates three tables and posts to a news feed. Closing that gap needs an integration-test layer (a disposable in-memory or temp-file SQLite database, seeded per test), not more unit tests, and is genuinely deferred work — not an oversight. See [Known gaps](#known-gaps--future-work).

Route handlers and Vue components are excluded for a different reason: they're thin glue (`readBody` → call a `server/core` function → return JSON; a `useFetch()` call → template) with the actual logic living one layer down in the modules this suite does cover. Testing them meaningfully needs either a running Nitro instance (route handlers) or a component-mount harness like `@vue/test-utils` (Vue files) — both real, addable pieces of infrastructure, just not built yet.

---

## Running the suite

```bash
cd frontend
bun run test              # run once
bun run test:watch        # re-run on file change
bun run test:coverage     # run once, with a coverage report
```

Coverage output goes to `frontend/coverage/` (git-ignored) — open `coverage/index.html` for the interactive report, or read the terminal summary `test:coverage` prints.

## Conventions

- **Colocated, not a separate `test/` tree.** `server/core/economy.ts` is tested by `server/core/economy.test.ts` sitting right next to it — matches how this codebase organises everything else (no existing `tests/` directory to mirror), and means a file and its test move together. The `test/` directory that does exist holds only shared test infrastructure (`test/stubs/components.ts`), not test files themselves.
- **Vitest**, not Jest — chosen for native ESM/TypeScript support with no transpilation config of its own, and because it already understands Vite path aliases the same way Nuxt's build does.
- **`vitest.config.ts` resolves `#shared` and `#components` by hand.** Both are Nuxt auto-import aliases that only exist inside a running Nuxt instance. `#shared` is pointed straight at `./shared`; `#components` is pointed at `test/stubs/components.ts`, a one-export stub (`app/utils/table.ts` imports `UButton` from it at module load time, but no test here calls the renderer that actually uses it). See `vitest.config.ts`'s own header comment for the full reasoning.
- **No network, no filesystem, no `Math.random()` mocking by default.** Where a function's output is genuinely randomised (`developSkill`, `initialPotential`, `marketValueFor`'s jitter, the whole match engine), tests either assert an invariant that holds for *any* draw (bounds, "never exceeds potential") or sample many draws and compare averages — see `server/core/progression.test.ts` and `match-engine.test.ts` for the pattern. `shouldRetire` is the one place a test stubs `Math.random()` directly (`vi.spyOn`), because its two edge cases (age below the floor, age at the forced-retirement ceiling) are deterministic regardless of the roll and a stub is the clearest way to say that.
- **A failing test that turns out to be a bad assumption gets fixed in the test, not worked around.** Two examples from writing this suite: `wageExpectation`'s "prestige discount" turned out to be a discount on the *premium over the base wage*, not on the total wage (a bigger club's base wage is itself higher, so total demand isn't lower) — the test was rewritten to compare ratios. `match-state.ts`'s half-time stamina recovery only fires when a single `advanceMinute` call skips *over* minute 45 (`state.minute < 45 && minute > 45`); the match engine steps one minute at a time, so in practice it never fires during a live match. That's flagged below as a real, live gap — see [Known gaps](#known-gaps--future-work) — not silently patched over, since fixing simulation behaviour wasn't the assignment.

## Coverage thresholds

`vitest.config.ts`'s `coverage.thresholds` are set a little below the real numbers this suite currently produces, as a floor against regression — not aspirational targets:

| Metric | Threshold | Actual (at last measurement) |
|---|---|---|
| Statements | 80% | 84.1% |
| Branches | 70% | 75.4% |
| Functions | 78% | 82.0% |
| Lines | 80% | 84.3% |

Only within the `coverage.include`/`coverage.exclude` scope described above — a repo-wide "84% coverage" claim would be misleading given the DB-coupled half of `server/core` and every route handler are excluded from the denominator entirely, not counted as 0%. Raise these numbers deliberately as real coverage improves; don't raise them to make a red CI run green without adding the tests that justify it.

---

## CI

`.github/workflows/ci.yml` runs on every push and PR to `main`/`dev`, four parallel jobs:

| Job | What it does | Blocking? |
|---|---|---|
| `lint` | `bun run lint` (ESLint + Prettier) | **No** — see below |
| `typecheck` | `nuxt prepare` then `tsc --noEmit` against both the server and app project references | Yes |
| `test` | `bun run test:coverage`; uploads the HTML/lcov report as a build artifact | Yes — fails on a test failure *or* a coverage threshold miss |
| `build` | `bun run build` — a full production Nitro build | Yes |

**Lint is intentionally non-blocking** (`continue-on-error: true`), not because linting doesn't matter but because this repo's ESLint config currently fails on roughly 5,900 pre-existing formatting violations across the whole tree — including `.nuxt/` build output and `eslint.config.mjs` itself — none of which are related to the testing work that added this CI pipeline. Wiring lint in as a blocking gate on day one would make every future PR red for a backlog nobody touched. It still runs, so the signal is visible in every CI run; `continue-on-error` should come off once that backlog is cleared.

---

## Known gaps / future work

Recorded here rather than left implicit, so "we have tests now" doesn't quietly become "we have all the tests we need":

1. **No integration tests against a real database.** The DB-coupled half of `server/core` (season rollover, transfer settlement, board/insolvency consequences, the whole save lifecycle) is exercised by `frontend/scripts/verify-economy.ts` and `verify-multi-save.ts` as manually-run headless scripts, not by an automated test suite. Turning those into `describe`/`it` blocks that spin up a disposable SQLite file per test (or per suite) is the highest-value next step — it would directly cover the modules `coverage.exclude` currently carves out.
2. **No route-handler tests.** Every `server/api/**/*.ts` file is untested. A lightweight approach — importing the handler function directly and calling it with a mocked H3 `event` — would catch request/response-shape regressions without needing a running server.
3. **No component or page tests.** Nothing in `app/components/`, `app/pages/`, or `app/composables/` is tested. `@vue/test-utils` plus `@vue/happy-dom` (or `jsdom`) would be the natural addition, mounted through Vitest.
4. **No end-to-end tests.** Nothing drives a real browser against a running instance of the app. Playwright is the natural choice given Nuxt's own tooling recommends it, but this is meaningfully more infrastructure than the other three gaps and should wait until they're closed.
5. **`match-state.ts`'s half-time stamina recovery does not fire during normal play**, discovered while writing `shared/match-state.test.ts` (see the "conventions" note above). `advanceMinute`'s cross-45 check (`state.minute < 45 && minute > 45`) can only be satisfied by a call that skips straight over minute 45 in one step; `simulateSegment` in `server/core/match-engine.ts` calls it once per minute, so the condition is never met in the actual simulation loop. This is a real, live gameplay bug the test suite surfaced — not something this task fixed, since changing simulation behaviour wasn't in scope, but it should be triaged.
