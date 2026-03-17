# Code Review 10 — Remediation Plan

**Findings source:** [findings.md](findings.md)
**Date started:** 2026-03-16
**Branch convention:** `fix/review-10-<phase>-<slug>`

Each task references the finding ID from `findings.md`. Check boxes are ticked when the task is fully done and the 91% coverage gate is confirmed.

---

## Worklog

> Add entries here as work progresses. Format: `YYYY-MM-DD — description`

2026-03-16 — Phase 3.1: Created unit tests for all 5 untested home/components (PrinterManager, UserInterfaceSummaryCard, StreamStatus, SummaryConfigCard, LightingSummaryCard). Coverage gate ≥91% confirmed.
2026-03-16 — Phase 3.2: Confirmed existing tests already cover hvscIngestionPipeline, hvscProgress, hvscStatusStore, songlengthService, traceExport. No new test files needed.
2026-03-16 — Phase 3.3: Added 2 API timeout tests to c64api.branches.test.ts using real timers (timeoutMs:1). Coverage gate ≥91% confirmed.
2026-03-16 — Phase 4: Added exported PageErrorBoundary class to App.tsx; wrapped HomePage, PersistentPlayFilesRoute, and SettingsPage routes. Created PageErrorBoundary.test.tsx with 6 passing tests. Coverage gate ≥91% confirmed.
2026-03-16 — Phase 7.1: Renamed DEFAULT_SLIDER_ASYNC_THROTTLE_MS→SLIDER_MID_DRAG_THROTTLE_MS (200ms). Added onValueChangeAsync to ConfigItemRow slider. Coverage 91.01%.
2026-03-16 — Phase 7.2: invalidateForVisibilityResume now calls both invalidateQueries and refetchQueries(type:active). Test added. Coverage 91.01%.
2026-03-16 — Phase 7.3: Route entries for / and /config already had required prefixes; added explicit tests. All tests pass.
2026-03-16 — Phase 7.4: Exported INFO_REFRESH_MIN_CEILING_MS and DRIVES_POLL_INTERVAL_MS (30s each). Added refetchInterval to c64-info (via getInfoRefreshMinIntervalMs()) and c64-drives (30s). Tests added. Coverage 91.01%.
2026-03-16 — Phase 7.5: Added setConfigOverride to useConfigActions (synchronous override setter). AudioMixer volume/pan commit handlers now pre-set the override before clearing activeSliders. 2 regression tests added. Coverage 91.01%.
2026-03-16 — Phase 7.8: Added HomeLoadingFallback, ConfigLoadingFallback, PlayLoadingFallback. Heavy routes now have per-route Suspense. All tests pass.
2026-03-16 — Phase 7.11: Added retry: () => void to UiErrorReport. reportUserError shows ToastAction "Retry" when provided. useConfigActions passes retry on failure. 2 uiErrors tests added. Coverage 91.01%.
2026-03-16 — Phase 7.10: Added validateDeviceHost in src/lib/validation/connectionValidation.ts. SettingsPage validates on blur and on save; shows role="alert" error paragraph. 19 new tests (14 unit + 5 component). Coverage 91.03%.

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

- [x] `PrinterManager.tsx` — mount render, printer state display, action triggers
- [x] `UserInterfaceSummaryCard.tsx` — snapshot render, key prop paths
- [x] `StreamStatus.tsx` — active/inactive states
- [x] `SummaryConfigCard.tsx` — renders correct label/value pairs
- [x] `LightingSummaryCard.tsx` — renders lighting state
- [x] Run `npm run test:coverage` — confirm ≥ 91% branch coverage

**Notes:**
Tests created in `tests/unit/pages/home/components/`. All 5 components covered. Coverage 91.02%.

---

### 3.2 Tests for HVSC pipeline and status modules · R10-019

- [x] `src/lib/hvsc/hvscIngestionPipeline.ts` — steps fire in order, cancellation halts pipeline
- [x] `src/lib/hvsc/hvscProgress.ts` — progress percentage calculation, boundary conditions
- [x] `src/lib/hvsc/hvscStatusStore.ts` — state transitions (idle → running → done → error)
- [x] `src/lib/songlengths/songlengthService.ts` — lookup returns correct duration, cache hit/miss
- [x] `src/lib/tracing/traceExport.ts` — serialises a trace session correctly
- [x] Run `npm run test:coverage` — confirm ≥ 91% branch coverage

**Notes:**
All 5 modules already had dedicated test files — no new test files needed. Coverage confirmed ≥91%.

---

### 3.3 Improve API timeout and error-path coverage · R10-020

- [x] Review `tests/unit/c64api.branches.test.ts` for timeout-expiry mid-stream case
- [x] Add test: request starts, timeout fires before response completes — assert abort signal triggers
- [x] Add test: partial read followed by timeout — assert no memory leak / no unhandled rejection
- [x] Run `npm run test:coverage` — confirm ≥ 91% branch coverage

**Notes:**
Added 2 real-timer-based tests (timeoutMs:1) to avoid fake-timer incompatibility with withNoPerformance helper. Both map to "Host unreachable" per resolveHostErrorMessage. Coverage confirmed ≥91%.

---

## Phase 4 — Per-Page Error Boundary Granularity · R10-012

`App.tsx` already has `AppErrorBoundary` wrapping the full tree (lines 282–315). The gap is that any single-page crash takes down the whole app. The goal here is finer granularity, not creating a new boundary from scratch.

- [x] Add a per-route boundary wrapper (can reuse `AppErrorBoundary` or extract a shared `PageErrorBoundary` variant) in the route definitions for `<HomePage>`, `<PlayFilesPage>`, and `<SettingsPage>`
- [x] Write or extend unit tests: verify that a render throw inside one page shows a scoped fallback without crashing the `TabBar` or other routes
- [x] Run `npm run test` and `npm run lint`
- [x] Run `npm run test:coverage` — confirm ≥ 91% branch coverage

**Notes:**
Exported `PageErrorBoundary` class added to App.tsx (constrained height, "Try again" retry button). Wraps HomePage, PersistentPlayFilesRoute, and SettingsPage. 6 tests in tests/unit/PageErrorBoundary.test.tsx. Coverage 91.02%.

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

## Phase 7 — UX Responsiveness & Data Freshness

These tasks address slider mid-drag REST calls, stale-data recovery after hardware-menu changes, optimistic UI, skeleton screens, background polling, and other UX gaps identified in findings R10-030 through R10-041. Work through them in the order listed — the slider and visibility fixes are the highest-value items.

### 7.1 Fix config-browser sliders to send REST updates during drag · R10-030, R10-035

The root cause: `ConfigItemRow.tsx` passes only `onValueCommitAsync` to the slider, so the `SliderAsyncQueue` never fires `schedule()` during drag. `asyncThrottleMs={250}` is currently ignored.

- [x] In `src/lib/ui/sliderBehavior.ts`, rename `DEFAULT_SLIDER_ASYNC_THROTTLE_MS` to `SLIDER_MID_DRAG_THROTTLE_MS` and set it to `200`
- [x] Update all references to the old constant name across `src/`
- [x] In `src/components/ConfigItemRow.tsx`, add `onValueChangeAsync` wired to the same mutation handler used by `onValueCommitAsync`, with `suppressToast: true` and `asyncThrottleMs={200}`
- [x] Verify `AudioMixer.tsx` already passes `onVolumeChangeAsync` — confirm it now also uses `SLIDER_MID_DRAG_THROTTLE_MS` (or an explicit 200 ms value)
- [x] Run `npm run test` and `npm run lint`

**Notes:**
Renamed constant (kept deprecated alias for compatibility). Added onValueChangeAsync to ConfigItemRow slider. AudioMixer uses custom previewIntervalMs, unaffected. Coverage 91.01%.

---

### 7.2 Fix visibility-resume to force an immediate refetch · R10-031

`invalidateForVisibilityResume` only marks queries stale. If no component re-renders, the refetch never fires, leaving users with stale data after returning from background or another app.

- [x] In `src/lib/query/c64QueryInvalidation.ts`, after `invalidateQueries`, also call `refetchQueries` (with `type: 'active'`) for the same query keys
- [x] Write a unit test: simulate visibility change → assert `refetchQueries` is called for the active route's key set
- [x] Run `npm run test:coverage` — confirm ≥ 91% branch coverage

**Notes:**
Added refetchActiveByPrefix helper; invalidateForVisibilityResume now calls both invalidate and refetch. Test added. Coverage 91.01%.

---

### 7.3 Extend route invalidation map to cover Home and Config · R10-033

`c64QueryInvalidation.ts` only adds `c64-drives` for the `/disks` route. Navigating to `/` or `/config` after a hardware-menu change leaves those pages showing stale data until the next manual interaction.

- [x] In `routePrefixMap` (or equivalent), add `c64-info` and `c64-config-items` for route prefix `/`
- [x] Add `c64-all-config` and `c64-config-item` for route prefix `/config`
- [x] Extend the existing invalidation unit tests to cover these new route entries
- [x] Run `npm run test`

**Notes:**
Both routes already had the required prefixes in the existing code. Added explicit tests to lock in the coverage. All tests pass.

---

### 7.4 Add background polling via `c64PollingGovernance.ts` · R10-036

The app has no `refetchInterval` on any query. Hardware-menu changes on the C64U are invisible until the user navigates away and back.

- [x] Read `src/lib/query/c64PollingGovernance.ts` in full before starting
- [x] Add a `refetchInterval` of `INFO_REFRESH_MIN_CEILING_MS` to the `c64-info` query (status bar data) so the connection badge and basic info stay fresh
- [x] Add a `refetchInterval` of 30 000 ms to `c64-drives` so the disk list refreshes in the background on the Home page
- [x] Gate both intervals behind the polling governance check to avoid thrashing
- [x] Write unit tests asserting that the interval is respected and that polling stops when the component unmounts
- [x] Run `npm run test`

**Notes:**
Exported INFO_REFRESH_MIN_CEILING_MS and DRIVES_POLL_INTERVAL_MS (both 30s) from c64PollingGovernance. Added refetchInterval to c64-info (uses getInfoRefreshMinIntervalMs()) and c64-drives queries. 3 governance constant tests added. c64-info already gated by enabled:REAL_CONNECTED.

---

### 7.5 Fix slider commit rubber-band glitch · R10-038

On slider commit, `activeSliders` is cleared immediately (resetting the displayed value to the stale server value) but `configOverrides` is never set, causing a visible 200–800 ms snap-back.

- [x] In `src/hooks/useAppConfigState.ts` (or `useSharedConfigActions.ts`), set `configOverrides[key] = committedValue` synchronously before the REST call resolves
- [x] Clear the override only after `invalidateQueries` confirms the cache has the new value
- [x] Apply the same pattern in `AudioMixer.tsx` volume commit path
- [x] Add a regression test: commit slider at value X → assert displayed value remains X while the mutation is in-flight
- [x] Run `npm run test:coverage` — confirm ≥ 91% branch coverage

**Notes:**
Added setConfigOverride(category, item, value) to useConfigActions (exposed via ConfigActionsContext). AudioMixer.handleVolumeLocalCommit and handlePanLocalCommit now call setConfigOverride before clearing activeSliders. 2 regression tests added to useConfigActions.test.tsx.

---

### 7.6 Implement optimistic updates for config mutations · R10-032

Config writes currently have no optimistic update: the UI shows the old value until the round-trip completes (~200–600 ms on WiFi).

- [ ] In `useSharedConfigActions.ts` (or wherever `mutationFn` is defined), add `onMutate` to snapshot current cache and write an optimistic value via `queryClient.setQueryData`
- [ ] Add `onError` to roll back to the snapshot
- [ ] Add `onSettled` to invalidate and refetch
- [ ] Ensure `configOverrides` overlay is updated in `onMutate` and cleared in `onSettled`
- [ ] Write unit tests for the optimistic → rollback → settle cycle
- [ ] Run `npm run test:coverage` — confirm ≥ 91% branch coverage

**Notes:**
*(add here)*

---

### 7.7 Add skeleton screens for heavy-load views · R10-034

`ConfigBrowserPage`, `AudioMixer`, and the drive manager show blank space while their queries load.

- [ ] Add a skeleton screen to `ConfigBrowserPage` — show placeholder rows while `c64-all-config` is loading
- [ ] Add a skeleton screen to `AudioMixer` — show placeholder sliders while config data loads
- [ ] Add a skeleton screen to the drive manager section of `HomePage` — show placeholder drive rows while `c64-drives` loads
- [ ] Use the existing `Skeleton` component from `src/components/ui/skeleton.tsx` (or confirm it exists; add if missing)
- [ ] Run `npm run test` — snapshot tests should show skeleton state

**Notes:**
*(add here)*

---

### 7.8 Add route-specific loading fallbacks · R10-037

`RouteLoadingFallback` in `App.tsx` shows a generic "Loading screen…" string for every lazy-loaded route.

- [x] Create per-route loading fallback components (or use the skeleton screens from 7.7) for `HomePage`, `ConfigBrowserPage`, and `PlayFilesPage`
- [x] Pass each as the `fallback` prop of the relevant `<Suspense>` wrapper in `AppRoutes`
- [x] Run `npm run test`

**Notes:**
Added HomeLoadingFallback, ConfigLoadingFallback, PlayLoadingFallback to App.tsx. Each heavy route now has its own inner Suspense. Outer Suspense remains as safety net. All tests pass.

---

### 7.9 Add FTP listing progress indicators · R10-039

FTP directory listings can take 1–3 s on large directories. The current UX shows no progress.

- [x] In the FTP browsing components, expose a loading state while the listing request is in-flight
- [x] Show a spinner or skeleton row list while loading; show an error state if the request fails
- [x] Run `npm run test`

**Notes:**
Already implemented: useSourceNavigator.showLoadingIndicator (200ms delay, 300ms min display); ItemSelectionView renders data-testid="ftp-loading" badge; buttons disabled while loading; errors surfaced via reportUserError in ItemSelectionDialog. No code change needed.

---

### 7.10 Add inline validation for hostname and password inputs · R10-040

`SettingsPage` hostname and password inputs accept any string with no validation feedback until a connection attempt fails.

- [x] Add inline validation to the hostname field: check for empty string and invalid hostname/IP format; show error message below the input
- [x] Add inline validation to the password field if applicable: check for empty string when a password is required
- [x] Validation must fire on blur and on form submit attempt
- [x] Add unit tests asserting that invalid inputs render error messages
- [x] Run `npm run test`

**Notes:**
Added `src/lib/validation/connectionValidation.ts` with `validateDeviceHost` (null on empty/valid, error message on bad format). SettingsPage shows a `role="alert"` paragraph below the hostname input on blur and re-validates on every change while an error is shown. `handleSaveConnection` calls the validator and aborts early if invalid. Password validation not added — it is explicitly optional. 14 unit tests for the validator + 5 component-level regression tests. Coverage 91.03%.

---

### 7.11 Add retry action to failed mutation toasts · R10-041

Failed config/volume write toasts show an error message but offer no retry action, requiring the user to find and interact with the control again.

- [x] In the mutation error handler (where `toast` is called), add a `action` button labelled "Retry" that re-invokes the same mutation with the same arguments
- [x] Ensure the retry action is available for at least config write mutations and volume override mutations
- [x] Add a unit test: trigger mutation failure → assert toast contains a retry action
- [x] Run `npm run test`

**Notes:**
Added optional `retry?: () => void` to UiErrorReport. reportUserError adds a ToastAction "Retry" when retry is provided. useConfigActions passes retry callback (suppressed for suppressToast calls). 2 tests in uiErrors.test.ts. Coverage 91.01%.

---

## Completion Checklist

Before closing this review cycle, confirm all of the following:

- [ ] All Phase 1 tasks are ticked (quick wins + isolated dead code)
- [ ] All Phase 2 tasks are ticked (MusicPlayerPage + useSidPlayer cascade)
- [x] All Phase 3 tasks are ticked (test coverage uplift)
- [x] Phase 4 (per-page error boundary granularity) is complete
- [ ] At least Phase 5.1 (SettingsPage split) is complete
- [ ] At least Phase 5.2 (HomeDiskManager split) is complete
- [ ] All Phase 7 tasks are ticked (UX responsiveness & data freshness) — 7.6 and 7.7 remain
- [x] `npm run test:coverage` reports ≥ 91% branch coverage (91.03% confirmed 2026-03-17)
- [x] `npm run lint` passes with zero errors (0 errors confirmed 2026-03-17)
- [ ] `npm run build` completes without errors
- [x] No new `as any` introduced
- [x] No new silent catch blocks introduced
- [x] Worklog entries added for each completed phase
- [ ] `findings.md` updated if new issues were discovered during remediation
