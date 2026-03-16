# Code Review 10 — Remediation Plan

**Findings source:** [findings.md](findings.md)
**Date started:** 2026-03-16
**Branch convention:** `fix/review-10-<phase>-<slug>`

Each task references the finding ID from `findings.md`. Check boxes are ticked when the task is fully done and the 91% coverage gate is confirmed.

---

## Worklog

> Add entries here as work progresses. Format: `YYYY-MM-DD — description`

<!-- empty — work not yet started -->

---

## Phase 1 — Quick Wins (Effort S, High Return)

These tasks are small in scope but high in signal value. They can be done independently in any order and serve as warm-up before the larger refactors.

### 1.1 TypeScript config hardening · R10-006, R10-023, R10-025

- [ ] Enable `"strict": true` in `tsconfig.app.json`
- [ ] Enable `"noFallthroughCasesInSwitch": true`
- [ ] Evaluate and remove `"allowJs": true` if no `.js` sources are compiled
- [ ] Run `npx tsc --noEmit` and triage all new errors
- [ ] Fix all implicit-any parameters in `src/` (batch by module)
- [ ] Fix all null-check fallout from `strictNullChecks` being enabled
- [ ] Run `npm run test` — confirm all tests still pass
- [ ] Run `npm run test:coverage` — confirm ≥ 91% branch coverage

**Notes:**
*(add here)*

---

### 1.2 Replace `as any` in tracing and config modules · R10-007, R10-021

- [ ] Add typed event/action interfaces to `src/lib/tracing/` (covering the 5+3 instances in `userInteractionCapture.ts` and `userTrace.ts`)
- [ ] Replace `as any` casts in `src/lib/tracing/traceActionContextStore.ts` (2 instances)
- [ ] Type the `patch` parameter in `hvscIngestionRuntime.ts:82` as `Partial<HvscRuntimeState>` instead of `any`
- [ ] Replace `ConfigBrowserPage.tsx` config-response casts with a typed interface
- [ ] Verify `src/lib/playback/localFileBrowser.ts` — replace or document remaining 2 casts
- [ ] Run `npm run test` and `npm run lint`

**Notes:**
*(add here)*

---

### 1.3 Centralise config value extraction · R10-009

- [ ] Create `src/lib/config/configValueExtractor.ts` with exported `extractConfigValue(raw: unknown): string | number`
- [ ] Write unit tests for `configValueExtractor.ts` covering all 9 probed keys and edge cases (null, array, primitive)
- [ ] Replace the duplicated logic in `src/hooks/useAppConfigState.ts`
- [ ] Replace the duplicated logic in `src/pages/ConfigBrowserPage.tsx`
- [ ] Run `npm run test:coverage` — confirm ≥ 91% branch coverage

**Notes:**
*(add here)*

---

### 1.4 Fix config fetch failure UX · R10-011

- [ ] In `useAppConfigState.ts`, upgrade the `.catch` log level from `debug` to `warn`
- [ ] Propagate fetch failure to a `fetchError` state variable
- [ ] Expose `fetchError` from the hook and render an error notice in `SettingsPage.tsx`
- [ ] Add regression test: mock fetch failure → assert error state is set
- [ ] Run `npm run test:coverage` — confirm ≥ 91% branch coverage

**Notes:**
*(add here)*

---

### 1.5 Replace direct `console.*` with structured logging · R10-013

- [ ] Audit all `console.log/warn/error` calls in `src/` (non-test files)
- [ ] Replace each with `addLog` / `addErrorLog` with appropriate level and context
- [ ] For `fuzzMode.ts` and `NotFound.tsx`, confirm if `console` is intentional (debug/dev only) and wrap in `import.meta.env.DEV` guard or replace
- [ ] Run `npm run lint` — confirm no new warnings

**Notes:**
*(add here)*

---

### 1.6 Fix `useCallback` deps declaration · R10-022

- [ ] In `ConfigBrowserPage.tsx`, add `audioConfiguredRef` to the `applySoloRouting` deps array or document why it is intentionally omitted (refs are stable — add a comment)
- [ ] Run `npm run lint` and `npm run test`

**Notes:**
*(add here)*

---

### 1.7 Extract `yieldToRenderer` helper · R10-010

- [ ] In `HomeDiskManager.tsx`, extract `const yieldToRenderer = () => new Promise<void>((resolve) => setTimeout(resolve, 0))` to a local constant or import from a shared ui-utils module
- [ ] Replace the 5+ raw `await new Promise(...)` occurrences with `await yieldToRenderer()`

**Notes:**
*(add here)*

---

### 1.8 Housekeeping · R10-024, R10-025

- [ ] Audit all TODO/FIXME comments — convert to GitHub issues or remove stale ones
- [ ] Remove `"allowJs": true` from `tsconfig.app.json` if confirmed unused (check: `find src -name "*.js"`)
- [ ] Run `npm run build` to confirm no regressions

**Notes:**
*(add here)*

---

### 1.9 Delete isolated dead source files · R10-026, R10-027, R10-029

These are standalone files with zero consumers — no cascade effects.

- [ ] Delete `src/hooks/useFileLibrary.ts` (unused hook, no consumers anywhere — confirmed by exhaustive search)
- [ ] Delete `src/components/ConnectionBadge.tsx` (unused component, superseded by `ConnectivityIndicator.tsx`)
- [ ] Delete `scripts/test_ram_ts.mjs` (self-described one-off debug script)
- [ ] Delete `scripts/inventory-ctas.mjs` (one-off CTA inventory, no automation path)
- [ ] Delete `scripts/merge-files.mjs` (ad-hoc file concatenator, no automation path)
- [ ] Delete `scripts/cleanup-old-evidence.sh` (one-off evidence format migration, already completed)
- [ ] Delete `scripts/hvsc_filename_frequency.py` (one-off HVSC filename analysis, no automation path)
- [ ] Run `npm run build` and `npm run test` — confirm nothing breaks

**Notes:**
*(add here)*

---

## Phase 2 — Dead Code Removal (Cascade)

These deletions have dependencies on each other or require confirming intent before removing.

### 2.1 Delete `MusicPlayerPage.tsx` and its cascade · R10-017, R10-028

`MusicPlayerPage.tsx` is not imported by `App.tsx`, has no route, and is explicitly documented as a legacy unrouted component. `useSidPlayer.tsx` is deprecated and its only real consumer is this unrouted page; the `SidPlayerProvider` wrapper in `App.tsx` creates context that nothing in the routed app consumes.

- [ ] Confirm no active plan exists to re-route `MusicPlayerPage` (check open issues / PR queue)
- [ ] Delete `src/pages/MusicPlayerPage.tsx`
- [ ] Delete `playwright/musicPlayer.spec.ts`
- [ ] Delete `src/hooks/useSidPlayer.tsx`
- [ ] Delete `tests/unit/hooks/useSidPlayer.test.tsx`
- [ ] In `src/App.tsx`, remove the `SidPlayerProvider` conditional wrapper (lines 163–175) and the `import { SidPlayerProvider }` line
- [ ] Remove stale references to `MusicPlayerPage` and `useSidPlayer` from `.github/copilot-instructions.md`
- [ ] Remove stale references from `CLAUDE.md`
- [ ] Run `npm run build` and `npm run test` — confirm nothing breaks
- [ ] Run `npm run test:coverage` — confirm ≥ 91% branch coverage (coverage should improve)

**Notes:**
*(add here)*

---

## Phase 3 — Test Coverage Uplift

These tasks address the most impactful gaps in unit-test coverage. Work here in parallel where contributors are available.

### 3.1 Unit tests for untested `home/components/` · R10-018

- [ ] `PrinterManager.tsx` — mount render, printer state display, action triggers
- [ ] `UserInterfaceSummaryCard.tsx` — snapshot render, key prop paths
- [ ] `StreamStatus.tsx` — active/inactive states
- [ ] `SummaryConfigCard.tsx` — renders correct label/value pairs
- [ ] `LightingSummaryCard.tsx` — renders lighting state
- [ ] Run `npm run test:coverage` — confirm ≥ 91% branch coverage

**Notes:**
*(add here)*

---

### 3.2 Tests for HVSC pipeline and status modules · R10-019

- [ ] `src/lib/hvsc/hvscIngestionPipeline.ts` — steps fire in order, cancellation halts pipeline
- [ ] `src/lib/hvsc/hvscProgress.ts` — progress percentage calculation, boundary conditions
- [ ] `src/lib/hvsc/hvscStatusStore.ts` — state transitions (idle → running → done → error)
- [ ] `src/lib/songlengths/songlengthService.ts` — lookup returns correct duration, cache hit/miss
- [ ] `src/lib/tracing/traceExport.ts` — serialises a trace session correctly
- [ ] Run `npm run test:coverage` — confirm ≥ 91% branch coverage

**Notes:**
*(add here)*

---

### 3.3 Improve API timeout and error-path coverage · R10-020

- [ ] Review `tests/unit/c64api.branches.test.ts` for timeout-expiry mid-stream case
- [ ] Add test: request starts, timeout fires before response completes — assert abort signal triggers
- [ ] Add test: partial read followed by timeout — assert no memory leak / no unhandled rejection
- [ ] Run `npm run test:coverage` — confirm ≥ 91% branch coverage

**Notes:**
*(add here)*

---

## Phase 4 — Per-Page Error Boundary Granularity · R10-012

`App.tsx` already has `AppErrorBoundary` wrapping the full tree (lines 282–315). The gap is that any single-page crash takes down the whole app. The goal here is finer granularity, not creating a new boundary from scratch.

- [ ] Add a per-route boundary wrapper (can reuse `AppErrorBoundary` or extract a shared `PageErrorBoundary` variant) in the route definitions for `<HomePage>`, `<PlayFilesPage>`, and `<SettingsPage>`
- [ ] Write or extend unit tests: verify that a render throw inside one page shows a scoped fallback without crashing the `TabBar` or other routes
- [ ] Run `npm run test` and `npm run lint`
- [ ] Run `npm run test:coverage` — confirm ≥ 91% branch coverage

**Notes:**
*(add here)*

---

## Phase 5 — Component Refactoring

These are the highest-effort tasks and should be tackled one component at a time, with full test runs between each.

### 5.1 Split `SettingsPage.tsx` · R10-002, R10-014

- [ ] Read `SettingsPage.tsx` in full before starting
- [ ] Identify 4–5 logical sections and their state dependencies
- [ ] Extract `ConnectionSettingsSection` component + tests
- [ ] Extract `HvscSettingsSection` component + tests
- [ ] Extract `DeviceSafetySection` component + tests
- [ ] Extract `DisplayProfileSection` component + tests
- [ ] Reduce top-level `useState` calls to ≤ 3 by moving state into sections or a `useReducer`
- [ ] Confirm `SettingsPage.tsx` drops below 400 lines
- [ ] Run full test suite + coverage gate

**Notes:**
*(add here)*

---

### 5.2 Split `HomeDiskManager.tsx` · R10-001, R10-015

- [ ] Read `HomeDiskManager.tsx` in full before starting
- [ ] Map state variables to concerns (mount, browse, volume, drive config)
- [ ] Extract `useDiskMountState` hook + tests
- [ ] Extract `DiskBrowserContainer` component + tests
- [ ] Extract `DiskMountManager` component + tests
- [ ] Extract `DriveConfigPanel` component + tests
- [ ] Confirm `HomeDiskManager.tsx` drops below 400 lines
- [ ] Add `useCallback`/`useMemo` where appropriate on child props
- [ ] Run full test suite + coverage gate

**Notes:**
*(add here)*

---

### 5.3 Refactor `usePlaybackController.ts` · R10-004

- [ ] Read the hook in full — identify pure state-machine transitions
- [ ] Extract state machine to `src/lib/playback/playbackStateMachine.ts`
- [ ] Write unit tests for the state machine in isolation
- [ ] Update `usePlaybackController.ts` to delegate to the state machine
- [ ] Confirm hook drops below 400 lines
- [ ] Run full test suite + coverage gate

**Notes:**
*(add here)*

---

### 5.4 Split `useHvscLibrary.ts` and `useVolumeOverride.ts` · R10-003

- [ ] Read both hooks in full
- [ ] Extract HVSC filtering/pagination logic from `useHvscLibrary.ts` to `src/lib/hvsc/hvscFilterUtils.ts` + tests
- [ ] Extract HVSC installation status queries to a sub-hook
- [ ] Extract volume/SID-mute business logic from `useVolumeOverride.ts` to `src/lib/playback/volumeControl.ts` + tests
- [ ] Confirm both hooks drop below 500 lines
- [ ] Run full test suite + coverage gate

**Notes:**
*(add here)*

---

## Phase 6 — Performance Profiling

- [ ] Profile `HomePage` and `SettingsPage` renders with React DevTools Profiler
- [ ] Identify top-3 most expensive re-renders (record results in worklog)
- [ ] Add `useMemo` to expensive computed values in the affected components
- [ ] Add `useCallback` to event handlers passed to `React.memo` children
- [ ] Verify bundle chunk assignments in `vite.config.ts` — confirm `HomeDiskManager` is in a reasonable chunk after the Phase 5 split
- [ ] Run `npm run build` — check reported chunk sizes vs. baseline
- [ ] Document findings in worklog

**Notes:**
*(add here)*

---

## Completion Checklist

Before closing this review cycle, confirm all of the following:

- [ ] All Phase 1 tasks are ticked (quick wins + isolated dead code)
- [ ] All Phase 2 tasks are ticked (MusicPlayerPage + useSidPlayer cascade)
- [ ] All Phase 3 tasks are ticked (test coverage uplift)
- [ ] Phase 4 (per-page error boundary granularity) is complete
- [ ] At least Phase 5.1 (SettingsPage split) is complete
- [ ] At least Phase 5.2 (HomeDiskManager split) is complete
- [ ] `npm run test:coverage` reports ≥ 91% branch coverage
- [ ] `npm run lint` passes with zero errors
- [ ] `npm run build` completes without errors
- [ ] No new `as any` introduced
- [ ] No new silent catch blocks introduced
- [ ] Worklog entries added for each completed phase
- [ ] `findings.md` updated if new issues were discovered during remediation
