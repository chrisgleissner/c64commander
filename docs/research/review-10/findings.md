# Code Review 10 — Audit Findings

**Date:** 2026-03-16
**Scope:** Full codebase — `src/`, `tests/`, `playwright/`, `agents/`, config files
**Method:** Automated exploration + static analysis across all source files

---

## Quick Stats

| Metric | Value |
| --- | --- |
| TypeScript/TSX source files | ~439 |
| Total source lines | ~67,500 |
| Unit test files | 279 |
| Playwright spec files | 42 |
| Files over 600 lines | 14 |
| Files over 1,000 lines | 8 |
| `as any` cast sites (src, non-test) | ~26 |
| TODO/FIXME comments | ~12 |

---

## Issue Index

Issues are grouped by category, each tagged with:

- **ID**: `R10-NNN`
- **Severity**: `High` / `Medium` / `Low`
- **Effort**: `S` (< 1 day) · `M` (1–3 days) · `L` (3–7 days) · `XL` (> 1 week)
- **Impact**: maintenance / correctness / performance / testability / type-safety

---

## A — Modularity / File Size

### R10-001 · High · Effort L · Impact: maintainability, testability

`HomeDiskManager.tsx` is 1,981 lines — well above the 600-line split threshold.

The component handles disk mounting, drive configuration, volume management, file selection, and all related UI state. It has at least 47 state references (useState, useRef, useReducer), making it nearly impossible to unit-test individual concerns. The CLAUDE.md 600-line guardrail was crossed ~3× over.

Suggested decomposition:

- `DiskBrowserContainer` — file/directory navigation
- `DiskMountManager` — mount/unmount logic
- `DriveConfigPanel` — per-drive settings
- `useDiskMountState` — shared hook for state

Files: [src/components/disks/HomeDiskManager.tsx](../../src/components/disks/HomeDiskManager.tsx)

---

### R10-002 · High · Effort L · Impact: maintainability, testability

`SettingsPage.tsx` is 1,652 lines with 9+ `useState` calls and 129+ scoped constants.

The page owns every settings concern: connection configuration, HVSC settings, device safety, display profiles, password management. All live in a single component scope. Extracting sections as sub-components each with their own test file would dramatically reduce complexity.

Suggested decomposition:

- `ConnectionSettingsSection`
- `HvscSettingsSection`
- `DeviceSafetySection`
- `DisplayProfileSection`

Files: [src/pages/SettingsPage.tsx](../../src/pages/SettingsPage.tsx)

---

### R10-003 · Medium · Effort M · Impact: maintainability, testability

`useHvscLibrary.ts` (1,031 lines) and `useVolumeOverride.ts` (906 lines) mix data-fetching, state, caching, and business logic.

Both hooks have grown past the 600-line guardrail. The volume hook manages volume state, preview, persistence, and SID muting all in one file. `useHvscLibrary` handles HVSC state, filtering, pagination, and installation status. Business logic should migrate to `src/lib/` and hooks should become thin adapters.

Files:

- [src/pages/playFiles/hooks/useHvscLibrary.ts](../../src/pages/playFiles/hooks/useHvscLibrary.ts)
- [src/pages/playFiles/hooks/useVolumeOverride.ts](../../src/pages/playFiles/hooks/useVolumeOverride.ts)

---

### R10-004 · Medium · Effort M · Impact: maintainability, testability

`usePlaybackController.ts` (843 lines) embeds a state machine in a React hook.

State machine logic (skip, timing, track management, state transitions) is more testable as a plain-function module in `src/lib/playback/`. The hook should delegate to it, reducing its own scope to glue code.

Files: [src/pages/playFiles/hooks/usePlaybackController.ts](../../src/pages/playFiles/hooks/usePlaybackController.ts)

---

### R10-005 · Medium · Effort S · Impact: maintainability

Several files between 500–715 lines are approaching the split threshold.

| File | Lines |
| --- | --- |
| `src/lib/connection/connectionManager.ts` | 715 |
| `src/lib/deviceInteraction/deviceInteractionManager.ts` | 664 |
| `src/pages/ConfigBrowserPage.tsx` | 650 |
| `src/components/ui/sidebar.tsx` | 647 |
| `src/lib/hvsc/hvscDownload.ts` | 607 |
| `src/components/lists/SelectableActionList.tsx` | 576 |
| `src/components/itemSelection/ItemSelectionDialog.tsx` | 548 |
| `src/components/ConfigItemRow.tsx` | 544 |
| `src/pages/playFiles/hooks/useSonglengths.ts` | 517 |
| `src/pages/home/components/AudioMixer.tsx` | 512 |

None require immediate action but should be watched and split when next touched.

---

## B — TypeScript Strictness

### R10-006 · High · Effort M · Impact: type-safety, correctness

`tsconfig.app.json` has TypeScript strict mode disabled across all meaningful checks.

```json
"strict": false,
"noUnusedLocals": false,
"noUnusedParameters": false,
"noImplicitAny": false,
"noFallthroughCasesInSwitch": false
```

With `strict: false` and `noImplicitAny: false`, the compiler cannot catch entire classes of bugs: implicit `any` parameters, unchecked nullability, unused variables silently accumulating. These settings mean TypeScript is acting as a transpiler, not a safety net.

Recommended path: enable `strict: true` and address the fallout file-by-file. Estimated fallout: 100–300 compiler errors, mostly null checks and missing parameter types.

Files: [tsconfig.app.json](../../tsconfig.app.json)

---

### R10-007 · Medium · Effort S · Impact: type-safety

`as any` casts: ~26 instances in production source code.

Concentrated in:

- `src/lib/tracing/userInteractionCapture.ts` (5 instances)
- `src/lib/tracing/userTrace.ts` (3 instances)
- `src/lib/c64api.ts` (3 instances)
- `src/lib/tracing/traceActionContextStore.ts` (2 instances)
- `src/pages/ConfigBrowserPage.tsx` (2 instances)
- `src/lib/playback/localFileBrowser.ts` (2 instances)
- Others (single instances)

The tracing module accounts for nearly half of all `as any` usage. Adding proper event/action types to the tracing interfaces would eliminate most of this cluster. The `ConfigBrowserPage.tsx` usage reflects an untyped config API response shape — these should be replaced with a typed `ConfigApiResponse` interface.

Platform detection (`(window as any)?.Capacitor`) is an acceptable exception.

---

### R10-008 · Low · Effort S · Impact: type-safety

Config extraction uses an open-ended fallback chain over `Record<string, any>`.

In `src/hooks/useAppConfigState.ts`, `extractValue` chains 9 property names (`selected`, `value`, `current`, `current_value`, …). This reflects that the C64U API does not return a consistent config schema. The correct fix is to generate or maintain typed interfaces from `docs/c64/c64u-openapi.yaml` rather than probing at runtime.

Files: [src/hooks/useAppConfigState.ts](../../src/hooks/useAppConfigState.ts)

---

## C — Duplication / DRY

### R10-009 · Medium · Effort S · Impact: maintainability

Config value extraction logic is duplicated between `useAppConfigState.ts` and `ConfigBrowserPage.tsx`.

Both files contain similar property-probing logic to extract a scalar value from a deeply-nested, inconsistently-shaped config response. Extracting this to `src/lib/config/configValueExtractor.ts` (a single tested pure function) would centralize the logic and reduce divergence risk.

Files:

- [src/hooks/useAppConfigState.ts](../../src/hooks/useAppConfigState.ts)
- [src/pages/ConfigBrowserPage.tsx](../../src/pages/ConfigBrowserPage.tsx)

---

### R10-010 · Low · Effort S · Impact: readability

`await new Promise((resolve) => setTimeout(resolve, 0))` appears 5+ times in `HomeDiskManager.tsx`.

This tick-yield pattern is used for animation/state synchronisation. A single named helper (`yieldToRenderer()`) in a local utility would make intent explicit and avoid the raw pattern repeating.

Files: [src/components/disks/HomeDiskManager.tsx](../../src/components/disks/HomeDiskManager.tsx)

---

## D — Error Handling

### R10-011 · Medium · Effort S · Impact: UX / correctness

Config fetch failure in `useAppConfigState.ts` is swallowed with a debug log — no UI feedback.

```typescript
fetchAllConfig()
  .then(...)
  .catch((error) => {
    addLog("debug", "Initial config snapshot capture deferred", {
      error: (error as Error).message,
    });
    // error stops here; UI does not reflect a failure state
  })
```

If the initial config fetch fails (device unreachable during load, timeout), the settings page silently renders with defaults. The catch should propagate to a UI error state or at minimum log at WARN level.

Files: [src/hooks/useAppConfigState.ts](../../src/hooks/useAppConfigState.ts)

---

### R10-012 · Low · Effort S · Impact: resilience / UX

`AppErrorBoundary` in `App.tsx` covers the whole tree but is a single coarse catch-all.

`App.tsx` lines 282–315 define an `AppErrorBoundary` class component that wraps the entire `<AppRoutes>` tree. Any render exception in any page causes a full-screen "Something went wrong / Reload" fallback — the whole app goes blank, not just the affected page.

Finer-grained boundaries around individual pages (`PlayFilesPage`, `SettingsPage`, `HomePage`) would allow a crash in one page to show a scoped fallback while other pages stay usable. The infrastructure already exists; the gap is per-page granularity.

---

### R10-013 · Low · Effort S · Impact: diagnostics

Scattered `console.log` / `console.warn` / `console.error` calls in production source bypass structured logging.

Found in: `HomeDiskManager.tsx`, `useActionTrace.ts`, `NotFound.tsx`, `songlengthService.ts`, `fuzzMode.ts`, and tracing files. The project has a structured logging system (`addLog`, `addErrorLog`); direct `console.*` calls bypass it and don't appear in the diagnostics overlay.

Files: `src/components/disks/HomeDiskManager.tsx`, `src/hooks/useActionTrace.ts`, `src/lib/songlengths/songlengthService.ts`, `src/lib/fuzz/fuzzMode.ts`, tracing files.

---

## E — Performance

### R10-014 · Medium · Effort M · Impact: render performance

`SettingsPage.tsx` uses 9 independent `useState` calls at the top level.

Each state update triggers a full re-render of the 1,652-line component. Grouping related state into a `useReducer` or splitting the page (see R10-002) would reduce cascading re-renders significantly.

Files: [src/pages/SettingsPage.tsx](../../src/pages/SettingsPage.tsx)

---

### R10-015 · Medium · Effort S · Impact: render performance

Missing `useCallback` and `useMemo` on frequently-recreated values in large components.

`HomePage.tsx` and `HomeDiskManager.tsx` pass inline arrow functions and derived values as props to children without memoisation. Where children are `React.memo`-wrapped (or heavy), these recreations force unnecessary renders. Profiling is needed to confirm, but the pattern is present and the components are large enough to matter.

---

### R10-016 · Low · Effort S · Impact: bundle size

`HomeDiskManager.tsx` imports 80+ modules directly, forming a single large chunk.

If lazy-loaded routes are used elsewhere, this component in a synchronously-imported tree inflates the initial bundle. Verifying the chunk assignment in `vite.config.ts` and splitting if needed would help.

---

## F — Test Coverage

### R10-017 · High · Effort S · Impact: dead code removal

`MusicPlayerPage.tsx` (1,068 lines) is unrouted dead code — not imported by `App.tsx`, not reachable by any user.

`App.tsx` lazy-loads eight pages; `MusicPlayerPage` is not among them and has no route entry. `playwright/musicPlayer.spec.ts` is intentionally empty with the comment "MusicPlayerPage is not routed in the app shell." `docs/features-by-page.md` explicitly marks it "Legacy SID/HVSC player component; not mounted by `src/App.tsx`."

The file is 1,068 lines of unreachable code that still incurs maintenance overhead (linting, coverage runs, IDE indexing). It should be deleted unless there is an active plan to re-route it, in which case that plan should be documented and tracked.

Files:

- [src/pages/MusicPlayerPage.tsx](../../src/pages/MusicPlayerPage.tsx) — delete or formally park with a tracking issue
- [playwright/musicPlayer.spec.ts](../../playwright/musicPlayer.spec.ts) — delete alongside the page
- [.github/copilot-instructions.md](../../.github/copilot-instructions.md) — remove stale reference
- [CLAUDE.md](../../CLAUDE.md) — remove stale reference

---

### R10-018 · Medium · Effort M · Impact: regression safety

Several `home/components/` files have no tests.

| Component | Lines | Has Unit Test? |
| --- | --- | --- |
| `PrinterManager.tsx` | ~150 | No |
| `UserInterfaceSummaryCard.tsx` | ~120 | No |
| `StreamStatus.tsx` | ~90 | No |
| `SummaryConfigCard.tsx` | ~130 | No |
| `LightingSummaryCard.tsx` | ~80 | No |

`AudioMixer.tsx` (512 lines) does have a test (`tests/unit/pages/home/AudioMixer.test.tsx`). The untested components are lower-complexity but contribute to coverage gaps.

---

### R10-019 · Low · Effort M · Impact: regression safety

No tests for `songlengthService.ts`, `hvscIngestionPipeline.ts`, `hvscProgress.ts`, `hvscStatusStore.ts`, `playbackRouter.ts` (partial), `traceExport.ts`.

These are important business-logic files. `hvscIngestionPipeline.ts` in particular is a multi-step async operation that is hard to verify only via E2E.

---

### R10-020 · Low · Effort S · Impact: regression safety

Error-path branches in `c64api.ts` are covered by branch tests but timeout edge cases may be thin.

The `c64api.branches.test.ts` and `c64api.ext2.test.ts` files exist and are non-trivial. However, timeout expiry during mid-stream responses and partial-read recovery paths may not be covered.

---

## G — Correctness

### R10-021 · Medium · Effort S · Impact: correctness

`hvscIngestionRuntime.ts:82` patches state through `as any` — bypasses type safety on a state machine transition.

```typescript
ensureNotCancelledWith(runtimeState.cancelTokens, token, (patch) => updateHvscState(patch as any));
```

The `patch` parameter is typed as `any` to silence the compiler. If `updateHvscState` is called with an invalid partial, the runtime state machine could reach an inconsistent state. Properly typing `patch` as `Partial<HvscRuntimeState>` would make invalid patches a compile error.

Files: [src/lib/hvsc/hvscIngestionRuntime.ts](../../src/lib/hvsc/hvscIngestionRuntime.ts)

---

### R10-022 · Low · Effort S · Impact: correctness

`ConfigBrowserPage.tsx` — `audioConfiguredRef` used inside `useCallback` but not included in the dependency array.

```typescript
const applySoloRouting = useCallback(
  async (soloItem: string | null, configuredOverride?: ConfigListItem[]) => {
    const configured = configuredOverride ?? audioConfiguredRef.current; // ref read
    // ...
  },
  [] // audioConfiguredRef not listed — stale-closure risk is low (refs don't change),
     // but ESLint exhaustive-deps would flag this
);
```

Refs themselves are stable so the closure is not stale, but an ESLint `exhaustive-deps` rule would flag this, and it creates a misleading deps declaration.

Files: [src/pages/ConfigBrowserPage.tsx](../../src/pages/ConfigBrowserPage.tsx)

---

### R10-023 · Low · Effort S · Impact: correctness

`noFallthroughCasesInSwitch: false` allows accidental switch fallthrough to silently pass the compiler.

Combined with `strict: false`, this means any switch statement that accidentally falls through (missing `break` or `return`) compiles cleanly. This is a source of hard-to-trace bugs in state machines and routing logic.

Files: [tsconfig.app.json](../../tsconfig.app.json)

---

## H — Dead Code

### R10-026 · High · Effort S · Impact: dead code removal

`src/hooks/useFileLibrary.ts` — exported hook with zero consumers anywhere in the codebase.

`useFileLibrary` manages a file-library state with localStorage persistence keyed to a device ID. Exhaustive search across all of `src/`, `tests/`, and `playwright/` finds no imports of this hook outside its own definition file. The `tests/unit/fileLibrary.test.ts` file that might seem related actually imports from `src/lib/playback/fileLibraryUtils.ts` and `fileLibraryTypes.ts` — an entirely separate module. The hook itself has no test.

Files: [src/hooks/useFileLibrary.ts](../../src/hooks/useFileLibrary.ts)

---

### R10-027 · High · Effort S · Impact: dead code removal

`src/components/ConnectionBadge.tsx` — exported component with zero consumers anywhere in the codebase.

`ConnectionBadge` renders an animated connection-status badge (Wifi/WifiOff icons, compact or full mode). Exhaustive search across `src/`, `tests/`, and `playwright/` finds no imports of this component outside its own file. The active component that serves this UI role is `ConnectivityIndicator.tsx` (used in `AppBar`).

Files: [src/components/ConnectionBadge.tsx](../../src/components/ConnectionBadge.tsx)

---

### R10-028 · Medium · Effort S · Impact: dead code removal

`src/hooks/useSidPlayer.tsx` — functionally deprecated hook that will become fully dead when `MusicPlayerPage.tsx` is removed.

`useSidPlayer.tsx` carries an explicit `@deprecated` comment: "Prefer the unified playback engine used by the Play Files page. This provider is only kept for test/coverage probes and legacy experiments." Its sole active consumer in the routed application is `MusicPlayerPage.tsx` (which is itself unrouted — see R10-017). In `App.tsx`, `SidPlayerProvider` is conditionally rendered only when coverage probes are enabled, wrapping the full `<AppRoutes>` tree — but no routed component calls `useSidPlayer()`, so the context is created and never consumed.

Deleting `MusicPlayerPage.tsx` (R10-017) makes `useSidPlayer.tsx` and its test (`tests/unit/hooks/useSidPlayer.test.tsx`) also candidates for removal. They should be deleted in the same pass.

Files:

- [src/hooks/useSidPlayer.tsx](../../src/hooks/useSidPlayer.tsx)
- [tests/unit/hooks/useSidPlayer.test.tsx](../../tests/unit/hooks/useSidPlayer.test.tsx) — remove alongside
- [src/App.tsx](../../src/App.tsx) — remove the `SidPlayerProvider` conditional wrapper (lines 163–175)

---

### R10-029 · Medium · Effort S · Impact: dead code removal

Five orphaned scripts in `scripts/` — one-off experiments with no active automation path.

Each script was confirmed to have no entry in `package.json` scripts, no reference in any `.github/workflows/` file, and no import from any active script. Contents confirm a one-off or experimental origin:

| Script | Nature | Evidence |
| --- | --- | --- |
| `scripts/test_ram_ts.mjs` | One-off debug | Self-described: "test script that mimics the TypeScript RAM operations exactly … helps identify if there's a bug in the TypeScript implementation" |
| `scripts/inventory-ctas.mjs` | One-off UI scan | Scans React components for CTAs; no consuming workflow |
| `scripts/merge-files.mjs` | Ad-hoc file concatenator | Almost certainly an LLM context-feeding aid with no project automation role |
| `scripts/cleanup-old-evidence.sh` | One-off format migration | Removes old "flat format" evidence directories; the migration has long since completed |
| `scripts/hvsc_filename_frequency.py` | One-off analysis | Frequency analysis of HVSC filenames; no automation path, no consuming workflow |

Note: `scripts/run-maestro.sh` is documented in `docs/testing/maestro.md`. `scripts/report-coverage.mjs` is documented in `docs/code-coverage.md` as a useful manual tool. `scripts/diff-screenshots.mjs`, `scripts/measure-mock-timing-profile.mjs`, and `scripts/manual-play-sid.sh/.ts` are legitimate developer investigation tools even without CI automation. None of those are flagged here.

---

## I — Code Style / Minor Issues

### R10-024 · Low · Effort S · Impact: readability

TODO/FIXME comments present in production source without tracking issues.

Found in 10+ files including tracing modules and `HomeDiskManager.tsx`. These should either be actioned, converted to tracked issues, or removed.

---

### R10-025 · Low · Effort S · Impact: maintainability

`allowJs: true` in `tsconfig.app.json` enables JS compilation but the codebase appears all-TypeScript.

If no `.js` files are intentionally compiled, disabling this removes one category of potential type escape.

Files: [tsconfig.app.json](../../tsconfig.app.json)

---

## J — UX Responsiveness & Data Freshness

Methodology: source-code audit of slider wiring, React Query configuration, cache invalidation paths, mutation patterns, and loading state implementations. All line numbers verified against current source.

---

### R10-030 · High · Effort S · Impact: real-time feedback

Config Browser sliders only send REST on release — mid-drag updates are missing.

`ConfigItemRow.tsx` wires sliders with `asyncThrottleMs={250}` and `onValueCommitAsync` only. The `onValueChangeAsync` prop is never passed. Because the slider's async queue only fires `schedule()` when `onValueChangeAsync` is present, the 250 ms throttle has no effect during drag — the REST call happens exclusively on pointer-up.

This affects every slider in `ConfigBrowserPage` (Audio Mixer category, SID addresses, volume levels, LED strip brightness, etc.). The user drags a slider and hears/sees no hardware response until they let go.

What already works correctly:

- `AudioMixer.tsx` (Home page SID cards) — passes both `onVolumeChangeAsync` and `onVolumeCommitAsync`; sends REST every 120 ms while dragging ✓
- `LightingSummaryCard.tsx` (Home page) — passes `onValueChangeAsync`; sends mid-drag REST at 120 ms ✓
- `useVolumeOverride.ts` (Play page) — has its own preview-interval gate, sends during drag ✓

Fix: add `onValueChangeAsync` to the `<Slider>` in `ConfigItemRow.tsx`, wired to the same handler as `onValueCommitAsync` but with `suppressToast: true`. The existing 250 ms `asyncThrottleMs` is already a reasonable config-browser rate.

Files:

- [src/components/ConfigItemRow.tsx](../../src/components/ConfigItemRow.tsx) — line 464–466, add `onValueChangeAsync`
- [src/lib/ui/sliderBehavior.ts](../../src/lib/ui/sliderBehavior.ts) — `DEFAULT_SLIDER_ASYNC_THROTTLE_MS = 120` (consider raising to 200 globally)

---

### R10-031 · High · Effort S · Impact: data freshness

`refetchOnWindowFocus` is globally disabled — returning to the app after using the C64U hardware menu shows stale data.

`App.tsx:52` sets `refetchOnWindowFocus: false` on the global `QueryClient`. The visibility-resume invalidation (`invalidateForVisibilityResume`) fires on `visibilitychange` but only marks queries stale — it does not force an immediate refetch. The next mount triggers the actual fetch.

With `staleTime` at 30–60 s for config categories and items, a user who opens the C64U hardware menu, changes a value, then switches back to C64 Commander will see the old value for up to 60 seconds with no indication it may be stale.

Verified stale times:

| Query key | staleTime |
| --- | --- |
| `c64-info` | 30 s |
| `c64-categories` | 60 s |
| `c64-category` | 30 s |
| `c64-config-items` | 30 s |
| `c64-all-config` | 30 s |
| `c64-config-item` | 30 s |
| `c64-drives` | 10 s |

Fix: in `invalidateForVisibilityResume`, after invalidating by prefix, call `queryClient.refetchQueries` for the same prefixes so the refetch is immediate rather than deferred to next mount.

Files:

- [src/lib/query/c64QueryInvalidation.ts](../../src/lib/query/c64QueryInvalidation.ts) — `invalidateForVisibilityResume` (line 73)

---

### R10-032 · High · Effort M · Impact: perceived performance

No optimistic updates — every config write forces the user to wait for a full REST round-trip before the UI reflects the change.

Confirmed after reading all mutation sites:

- `ConfigBrowserPage.tsx` `handleValueChange()` — awaits `setConfig.mutateAsync()`, then invalidates; UI stays at old value during the round-trip.
- `AudioMixer.tsx` `handleVolumeAsyncChange()` — calls `updateConfigValue()` without local state update; the slider's own `activeSliders` map tracks drag position locally, but the server-backed displayed value is stale until the query refetches.
- `ConfigBrowserPage.tsx` solo/batch/reset mutations — no optimistic path at all.

The existing `configOverrides` mechanism in `useSharedConfigActions` / `useAppConfigState` already provides a write-pending overlay for reads. This is the correct abstraction; it just needs to be populated before the REST call completes and cleared on settlement.

Pattern to apply: on mutation start, write the intended value into `configOverrides`; on mutation success, clear the override and let the invalidated query fill in; on mutation error, clear the override and show the toast.

Files:

- [src/hooks/useAppConfigState.ts](../../src/hooks/useAppConfigState.ts) — `configOverrides` map
- [src/pages/home/hooks/useConfigActions.ts](../../src/pages/home/hooks/useConfigActions.ts) — `updateConfigValue`
- [src/pages/ConfigBrowserPage.tsx](../../src/pages/ConfigBrowserPage.tsx) — `handleValueChange`, solo, batch, reset

---

### R10-033 · Medium · Effort S · Impact: data freshness

Drive state `staleTime` is 10 s, but mount/eject mutations do not trigger immediate `c64-drives` invalidation on the Home or Config Browser pages.

`c64-drives` staleTime is 10 s, the most aggressive in the app. However, when the user mounts or ejects a disk from the Disks page and then navigates to the Home page (or vice versa), the drive status shown in the Home page drive cards may lag until the next stale expiry. The route invalidation map in `c64QueryInvalidation.ts` invalidates `c64-drives` for the `/disks` route, but not for `/` (Home) or `/config`.

Files:

- [src/lib/query/c64QueryInvalidation.ts](../../src/lib/query/c64QueryInvalidation.ts) — `routePrefixMap`

---

### R10-034 · Medium · Effort S · Impact: perceived performance

Spinner-only loading states cause layout shifts and give a blank-page feel on first visit — no skeleton screens exist.

All loading states use `<Loader2 className="animate-spin" />` centred in empty space. On initial connection or after cache expiry, `ConfigBrowserPage`, `HomePage` sections, and `DisksPage` show spinners with no content structure. Skeleton screens (shimmer placeholders matching the shape of the real content) would let the user see the page structure immediately and reduce perceived load time.

Files:

- [src/pages/ConfigBrowserPage.tsx](../../src/pages/ConfigBrowserPage.tsx) — lines 622–625, 513–516
- [src/pages/home/components/AudioMixer.tsx](../../src/pages/home/components/AudioMixer.tsx)
- [src/pages/home/components/DriveManager.tsx](../../src/pages/home/components/DriveManager.tsx)

---

### R10-035 · Medium · Effort S · Impact: real-time feedback

Slider throttle rates are inconsistent across the app: 120 ms (AudioMixer, Lighting), 250 ms (Config Browser), independent preview-interval gate (PlayFiles volume).

`DEFAULT_SLIDER_ASYNC_THROTTLE_MS = 120` in `sliderBehavior.ts`. `ConfigItemRow.tsx` overrides to 250 ms. `useVolumeOverride.ts` bypasses the slider queue entirely with its own `previewIntervalMs` gate (configurable, default 200 ms). There is no single source of truth for "how often should we send REST updates during a drag?" The three different rates create inconsistent feel. Setting `DEFAULT_SLIDER_ASYNC_THROTTLE_MS = 200` and aligning `ConfigItemRow` and `useVolumeOverride` to the same constant would enforce consistency at the target rate.

Files:

- [src/lib/ui/sliderBehavior.ts](../../src/lib/ui/sliderBehavior.ts) — `DEFAULT_SLIDER_ASYNC_THROTTLE_MS`
- [src/components/ConfigItemRow.tsx](../../src/components/ConfigItemRow.tsx) — `asyncThrottleMs={250}`
- [src/pages/playFiles/hooks/useVolumeOverride.ts](../../src/pages/playFiles/hooks/useVolumeOverride.ts) — `previewIntervalMs`

---

### R10-036 · Medium · Effort M · Impact: real-time feedback

No background polling for hardware-menu-driven changes — the app has no mechanism to detect C64U state changes that happen outside its own actions.

The app has no `refetchInterval` on any query. It relies entirely on: user navigating to a route (route-change invalidation), app regaining tab focus (visibility-resume invalidation), or stale time expiring on next mount. If the user changes a setting via the C64U's hardware menu while C64 Commander is open and in the foreground, nothing triggers a refetch until they navigate away and back, or background and reopen the app.

A lightweight polling strategy — e.g., `refetchInterval: 15_000` on `c64-info` only, used as a heartbeat — would detect firmware/state changes without hammering the device. The `c64PollingGovernance.ts` module already has the infrastructure (`INFO_REFRESH_MIN_FLOOR_MS`, `INFO_REFRESH_MIN_CEILING_MS`) to rate-limit this safely. Extending the governance to emit periodic invalidations for the active route's queries would give near-real-time consistency without a permanent firehose.

Files:

- [src/hooks/useC64Connection.ts](../../src/hooks/useC64Connection.ts) — `staleTime: 30000` on `c64-info` (line 96)
- [src/lib/query/c64PollingGovernance.ts](../../src/lib/query/c64PollingGovernance.ts)
- [src/lib/query/c64QueryInvalidation.ts](../../src/lib/query/c64QueryInvalidation.ts)

---

### R10-037 · Medium · Effort S · Impact: perceived performance

Route transition fallback is a generic "Loading screen…" string — no route-specific skeleton or context.

`App.tsx:89–93` defines `RouteLoadingFallback` as a centred grey text label. Every lazy-loaded page shows this during first load. A route-aware fallback that renders the correct page skeleton (e.g., tab bar + header + shimmer cards for Home; tab bar + header + shimmer list for Config) would eliminate the blank-page flash on first navigation.

Files:

- [src/App.tsx](../../src/App.tsx) — `RouteLoadingFallback` (lines 89–93)

---

### R10-038 · Medium · Effort S · Impact: perceived performance

`configOverrides` write-pending overlay is not applied during the async commit phase of slider drags — hardware feedback lags behind the drag position.

When a user drags a slider in `AudioMixer.tsx`, `handleVolumeAsyncChange` fires every 120 ms and calls `updateConfigValue()`. The local `activeSliders` map keeps the slider's visual position correct. However, when the user releases (commit), the REST call fires and the slider briefly snaps back to the old server value while the query refetch is in flight — because `configOverrides` is not set, and `activeSliders` is cleared on commit.

The visible glitch is: drag to new value → release → slider jumps back to old value → REST completes → query refetches → slider settles at new value. This creates a 200–800 ms rubber-band effect depending on network latency.

Fix: on `onValueCommitAsync`, write the intended value into `configOverrides` immediately (before the REST call resolves) and clear it only after the query cache is updated.

Files:

- [src/pages/home/components/AudioMixer.tsx](../../src/pages/home/components/AudioMixer.tsx) — `handleVolumeAsyncCommit` / `handlePanAsyncCommit`
- [src/pages/home/hooks/useConfigActions.ts](../../src/pages/home/hooks/useConfigActions.ts) — `updateConfigValue`

---

### R10-039 · Low · Effort S · Impact: perceived performance

FTP directory listing has no visible progress indication during the fetch.

FTP listings are used in the file browser (source navigation for Local/C64U sources). The native FTP client can take several seconds on initial connection or large directories. No progress bar, skeleton list, or spinner is shown specifically during FTP listing — only whatever generic loading state the parent component renders.

A simple "Fetching directory…" spinner with the current path shown, or a skeleton list matching the expected item height, would substantially reduce perceived wait.

Files: `src/lib/ftp/` (client), source navigation components that consume directory listings.

---

### R10-040 · Low · Effort S · Impact: UX polish

Text inputs in SettingsPage (hostname, password) have no inline validation before the save action.

The hostname/password fields update local state on every keystroke and the save is deferred to a button press — which is correct. However, there is no inline validation feedback (e.g., "invalid hostname format", "password too short") shown before the user commits. The user learns of an error only after the REST call fails and a toast appears.

Adding Zod or a simple regex check on `onChange` and showing an inline helper text (not a toast) would make the feedback loop immediate.

Files: [src/pages/SettingsPage.tsx](../../src/pages/SettingsPage.tsx) — hostname and password input sections.

---

### R10-041 · Low · Effort S · Impact: UX polish

Failed mutations show a toast but offer no retry action.

When a REST call fails (e.g., network blip, device timeout), `reportUserError()` fires a destructive toast that disappears after ~4 seconds. There is no "Retry" button in the toast and no way to re-submit the failed action from the UI.

For mutations that are safe to retry (config value updates, volume changes), adding a retry callback to the toast action would remove the need to re-perform the gesture.

Files:

- [src/lib/uiErrors.ts](../../src/lib/uiErrors.ts) — `reportUserError`
- Consumer mutation sites in `ConfigBrowserPage.tsx`, `AudioMixer.tsx`, `useConfigActions.ts`

---

## Priority Matrix

| ID | Title | Severity | Effort | Impact Area |
| --- | --- | --- | --- | --- |
| R10-001 | `HomeDiskManager.tsx` 1,981 lines — split required | High | L | Maintainability, testability |
| R10-002 | `SettingsPage.tsx` 1,652 lines — split required | High | L | Maintainability, testability |
| R10-006 | TypeScript strict mode disabled | High | M | Type-safety, correctness |
| R10-017 | `MusicPlayerPage.tsx` is unrouted dead code — delete | High | S | Dead code removal |
| R10-026 | `useFileLibrary.ts` — unused hook, zero consumers | High | S | Dead code removal |
| R10-027 | `ConnectionBadge.tsx` — unused component, zero consumers | High | S | Dead code removal |
| R10-030 | Config Browser sliders only send REST on release | High | S | Real-time feedback |
| R10-031 | Visibility resume does not force immediate refetch | High | S | Data freshness |
| R10-032 | No optimistic updates on config writes | High | M | Perceived performance |
| R10-003 | `useHvscLibrary` / `useVolumeOverride` oversized | Medium | M | Maintainability |
| R10-004 | `usePlaybackController` state machine in hook | Medium | M | Maintainability, testability |
| R10-007 | `as any` in tracing and config modules | Medium | S | Type-safety |
| R10-009 | Config extraction logic duplicated | Medium | S | DRY |
| R10-011 | Config fetch failure silently swallowed | Medium | S | UX, correctness |
| R10-014 | 9 `useState` in `SettingsPage` causes re-renders | Medium | M | Performance |
| R10-015 | Missing `useCallback`/`useMemo` in large components | Medium | S | Performance |
| R10-018 | `home/components/` gap — untested components | Medium | M | Regression safety |
| R10-021 | HVSC state patch uses `as any` | Medium | S | Correctness |
| R10-028 | `useSidPlayer.tsx` — deprecated, dead after R10-017 | Medium | S | Dead code removal |
| R10-029 | Five orphaned one-off scripts in `scripts/` | Medium | S | Dead code removal |
| R10-033 | Mount/eject does not invalidate Home drive cards | Medium | S | Data freshness |
| R10-034 | Spinner-only loading — no skeleton screens | Medium | S | Perceived performance |
| R10-035 | Inconsistent slider throttle rates across app | Medium | S | Real-time feedback |
| R10-036 | No background polling for hardware-menu changes | Medium | M | Real-time feedback |
| R10-037 | Generic route fallback — no per-page skeleton | Medium | S | Perceived performance |
| R10-038 | Slider commit causes rubber-band glitch | Medium | S | Perceived performance |
| R10-005 | Files approaching 600-line threshold | Medium | S | Maintainability (watch) |
| R10-008 | Config API shape relies on runtime probing | Low | M | Type-safety |
| R10-010 | `setTimeout(resolve, 0)` repeated 5× | Low | S | Readability |
| R10-012 | `AppErrorBoundary` is coarse — no per-page boundaries | Low | S | Resilience |
| R10-013 | `console.*` in production bypasses structured logs | Low | S | Diagnostics |
| R10-016 | `HomeDiskManager` inflates bundle chunk | Low | S | Bundle size |
| R10-019 | Missing tests for HVSC pipeline/status modules | Low | M | Regression safety |
| R10-020 | API timeout edge cases may have thin test coverage | Low | S | Correctness |
| R10-022 | Ref read outside `useCallback` deps | Low | S | Correctness |
| R10-023 | `noFallthroughCasesInSwitch: false` | Low | S | Correctness |
| R10-024 | TODO/FIXME without tracking | Low | S | Housekeeping |
| R10-025 | `allowJs: true` likely unused | Low | S | Config hygiene |
| R10-039 | FTP listing has no progress indication | Low | S | Perceived performance |
| R10-040 | No inline validation on hostname/password inputs | Low | S | UX polish |
| R10-041 | Failed mutations offer no retry action | Low | S | UX polish |

---

## What Is Already Good

- **Zero silent catch blocks** — all caught exceptions are logged or rethrown. The CLAUDE.md exception rule is respected.
- **Slider async infrastructure is solid** — `AudioMixer.tsx` and `LightingSummaryCard.tsx` already send mid-drag REST updates; the throttle queue in `sliderBehavior.ts` is well-designed.
- **`useVolumeOverride.ts` has industry-leading async safety** — preview-interval gate, isMounted guards, pending-write confirmation, hardware-sync conflict detection.
- **No deprecated React patterns** — no class components, legacy context, or `findDOMNode`.
- **Excellent import hygiene** — consistent ordering, no detected circular dependencies, well-formed barrel files.
- **No commented-out code** — no dead comment blocks; the "delete, don't comment" convention is followed.
- **Strong E2E coverage** — 42 Playwright specs with golden trace assertions cover end-to-end user flows well.
- **Good chunk splitting** — `vite.config.ts` has sensible `manualChunks` for vendor libraries.
- **Thorough structured logging** — `addLog`/`addErrorLog` with context throughout core modules.
- **Async safety** — `isMounted` guards and cleanup in `useEffect` calls are consistently present.
- **Clear project conventions** — formatting, commit style, test naming, and module structure are consistent.
