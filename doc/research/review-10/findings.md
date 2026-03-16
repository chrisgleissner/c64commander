# Code Review 10 — Audit Findings

**Date:** 2026-03-16
**Scope:** Full codebase — `src/`, `tests/`, `playwright/`, `agents/`, config files
**Method:** Automated exploration + static analysis across all source files

---

## Quick Stats

| Metric | Value |
|--------|-------|
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
**`HomeDiskManager.tsx` is 1,981 lines — well above the 600-line split threshold**

The component handles disk mounting, drive configuration, volume management, file selection, and all related UI state. It has at least 47 state references (useState, useRef, useReducer), making it nearly impossible to unit-test individual concerns. The CLAUDE.md 600-line guardrail was crossed ~3× over.

Suggested decomposition:
- `DiskBrowserContainer` — file/directory navigation
- `DiskMountManager` — mount/unmount logic
- `DriveConfigPanel` — per-drive settings
- `useDiskMountState` — shared hook for state

Files: [src/components/disks/HomeDiskManager.tsx](../../src/components/disks/HomeDiskManager.tsx)

---

### R10-002 · High · Effort L · Impact: maintainability, testability
**`SettingsPage.tsx` is 1,652 lines with 9+ `useState` calls and 129+ scoped constants**

The page owns every settings concern: connection configuration, HVSC settings, device safety, display profiles, password management. All live in a single component scope. Extracting sections as sub-components each with their own test file would dramatically reduce complexity.

Suggested decomposition:
- `ConnectionSettingsSection`
- `HvscSettingsSection`
- `DeviceSafetySection`
- `DisplayProfileSection`

Files: [src/pages/SettingsPage.tsx](../../src/pages/SettingsPage.tsx)

---

### R10-003 · Medium · Effort M · Impact: maintainability, testability
**`useHvscLibrary.ts` (1,031 lines) and `useVolumeOverride.ts` (906 lines) mix data-fetching, state, caching, and business logic**

Both hooks have grown past the 600-line guardrail. The volume hook manages volume state, preview, persistence, and SID muting all in one file. `useHvscLibrary` handles HVSC state, filtering, pagination, and installation status. Business logic should migrate to `src/lib/` and hooks should become thin adapters.

Files:
- [src/pages/playFiles/hooks/useHvscLibrary.ts](../../src/pages/playFiles/hooks/useHvscLibrary.ts)
- [src/pages/playFiles/hooks/useVolumeOverride.ts](../../src/pages/playFiles/hooks/useVolumeOverride.ts)

---

### R10-004 · Medium · Effort M · Impact: maintainability, testability
**`usePlaybackController.ts` (843 lines) embeds a state machine in a React hook**

State machine logic (skip, timing, track management, state transitions) is more testable as a plain-function module in `src/lib/playback/`. The hook should delegate to it, reducing its own scope to glue code.

Files: [src/pages/playFiles/hooks/usePlaybackController.ts](../../src/pages/playFiles/hooks/usePlaybackController.ts)

---

### R10-005 · Medium · Effort S · Impact: maintainability
**Several files between 500–715 lines are approaching the split threshold**

| File | Lines |
|------|-------|
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
**`tsconfig.app.json` has TypeScript strict mode disabled across all meaningful checks**

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
**`as any` casts: ~26 instances in production source code**

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
**Config extraction uses an open-ended fallback chain over `Record<string, any>`**

In `src/hooks/useAppConfigState.ts`, `extractValue` chains 9 property names (`selected`, `value`, `current`, `current_value`, …). This reflects that the C64U API does not return a consistent config schema. The correct fix is to generate or maintain typed interfaces from `doc/c64/c64u-openapi.yaml` rather than probing at runtime.

Files: [src/hooks/useAppConfigState.ts](../../src/hooks/useAppConfigState.ts)

---

## C — Duplication / DRY

### R10-009 · Medium · Effort S · Impact: maintainability
**Config value extraction logic is duplicated between `useAppConfigState.ts` and `ConfigBrowserPage.tsx`**

Both files contain similar property-probing logic to extract a scalar value from a deeply-nested, inconsistently-shaped config response. Extracting this to `src/lib/config/configValueExtractor.ts` (a single tested pure function) would centralize the logic and reduce divergence risk.

Files:
- [src/hooks/useAppConfigState.ts](../../src/hooks/useAppConfigState.ts)
- [src/pages/ConfigBrowserPage.tsx](../../src/pages/ConfigBrowserPage.tsx)

---

### R10-010 · Low · Effort S · Impact: readability
**`await new Promise((resolve) => setTimeout(resolve, 0))` appears 5+ times in `HomeDiskManager.tsx`**

This tick-yield pattern is used for animation/state synchronisation. A single named helper (`yieldToRenderer()`) in a local utility would make intent explicit and avoid the raw pattern repeating.

Files: [src/components/disks/HomeDiskManager.tsx](../../src/components/disks/HomeDiskManager.tsx)

---

## D — Error Handling

### R10-011 · Medium · Effort S · Impact: UX / correctness
**Config fetch failure in `useAppConfigState.ts` is swallowed with a debug log — no UI feedback**

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

**`AppErrorBoundary` in `App.tsx` covers the whole tree but is a single coarse catch-all**

`App.tsx` lines 282–315 define an `AppErrorBoundary` class component that wraps the entire `<AppRoutes>` tree. Any render exception in any page causes a full-screen "Something went wrong / Reload" fallback — the whole app goes blank, not just the affected page.

Finer-grained boundaries around individual pages (`PlayFilesPage`, `SettingsPage`, `HomePage`) would allow a crash in one page to show a scoped fallback while other pages stay usable. The infrastructure already exists; the gap is per-page granularity.

---

### R10-013 · Low · Effort S · Impact: diagnostics
**Scattered `console.log` / `console.warn` / `console.error` calls in production source**

Found in: `HomeDiskManager.tsx`, `useActionTrace.ts`, `NotFound.tsx`, `songlengthService.ts`, `fuzzMode.ts`, and tracing files. The project has a structured logging system (`addLog`, `addErrorLog`); direct `console.*` calls bypass it and don't appear in the diagnostics overlay.

Files: `src/components/disks/HomeDiskManager.tsx`, `src/hooks/useActionTrace.ts`, `src/lib/songlengths/songlengthService.ts`, `src/lib/fuzz/fuzzMode.ts`, tracing files.

---

## E — Performance

### R10-014 · Medium · Effort M · Impact: render performance
**`SettingsPage.tsx` uses 9 independent `useState` calls at the top level**

Each state update triggers a full re-render of the 1,652-line component. Grouping related state into a `useReducer` or splitting the page (see R10-002) would reduce cascading re-renders significantly.

Files: [src/pages/SettingsPage.tsx](../../src/pages/SettingsPage.tsx)

---

### R10-015 · Medium · Effort S · Impact: render performance
**Missing `useCallback` and `useMemo` on frequently-recreated values in large components**

`HomePage.tsx` and `HomeDiskManager.tsx` pass inline arrow functions and derived values as props to children without memoisation. Where children are `React.memo`-wrapped (or heavy), these recreations force unnecessary renders. Profiling is needed to confirm, but the pattern is present and the components are large enough to matter.

---

### R10-016 · Low · Effort S · Impact: bundle size
**`HomeDiskManager.tsx` imports 80+ modules directly, forming a single large chunk**

If lazy-loaded routes are used elsewhere, this component in a synchronously-imported tree inflates the initial bundle. Verifying the chunk assignment in `vite.config.ts` and splitting if needed would help.

---

## F — Test Coverage

### R10-017 · High · Effort S · Impact: dead code removal
**`MusicPlayerPage.tsx` (1,068 lines) is unrouted dead code — not imported by `App.tsx`, not reachable by any user**

`App.tsx` lazy-loads eight pages; `MusicPlayerPage` is not among them and has no route entry. `playwright/musicPlayer.spec.ts` is intentionally empty with the comment "MusicPlayerPage is not routed in the app shell." `doc/features-by-page.md` explicitly marks it "Legacy SID/HVSC player component; not mounted by `src/App.tsx`."

The file is 1,068 lines of unreachable code that still incurs maintenance overhead (linting, coverage runs, IDE indexing). It should be deleted unless there is an active plan to re-route it, in which case that plan should be documented and tracked.

Files:
- [src/pages/MusicPlayerPage.tsx](../../src/pages/MusicPlayerPage.tsx) — delete or formally park with a tracking issue
- [playwright/musicPlayer.spec.ts](../../playwright/musicPlayer.spec.ts) — delete alongside the page
- [.github/copilot-instructions.md](../../.github/copilot-instructions.md) — remove stale reference
- [CLAUDE.md](../../CLAUDE.md) — remove stale reference

---

### R10-018 · Medium · Effort M · Impact: regression safety
**Several `home/components/` files have no tests**

| Component | Lines | Has Unit Test? |
|-----------|-------|----------------|
| `PrinterManager.tsx` | ~150 | No |
| `UserInterfaceSummaryCard.tsx` | ~120 | No |
| `StreamStatus.tsx` | ~90 | No |
| `SummaryConfigCard.tsx` | ~130 | No |
| `LightingSummaryCard.tsx` | ~80 | No |

`AudioMixer.tsx` (512 lines) does have a test (`tests/unit/pages/home/AudioMixer.test.tsx`). The untested components are lower-complexity but contribute to coverage gaps.

---

### R10-019 · Low · Effort M · Impact: regression safety
**No tests for `songlengthService.ts`, `hvscIngestionPipeline.ts`, `hvscProgress.ts`, `hvscStatusStore.ts`, `playbackRouter.ts` (partial), `traceExport.ts`**

These are important business-logic files. `hvscIngestionPipeline.ts` in particular is a multi-step async operation that is hard to verify only via E2E.

---

### R10-020 · Low · Effort S · Impact: regression safety
**Error-path branches in `c64api.ts` are covered by branch tests but timeout edge cases may be thin**

The `c64api.branches.test.ts` and `c64api.ext2.test.ts` files exist and are non-trivial. However, timeout expiry during mid-stream responses and partial-read recovery paths may not be covered.

---

## G — Correctness

### R10-021 · Medium · Effort S · Impact: correctness
**`hvscIngestionRuntime.ts:82` patches state through `as any` — bypasses type safety on a state machine transition**

```typescript
ensureNotCancelledWith(runtimeState.cancelTokens, token, (patch) => updateHvscState(patch as any));
```

The `patch` parameter is typed as `any` to silence the compiler. If `updateHvscState` is called with an invalid partial, the runtime state machine could reach an inconsistent state. Properly typing `patch` as `Partial<HvscRuntimeState>` would make invalid patches a compile error.

Files: [src/lib/hvsc/hvscIngestionRuntime.ts](../../src/lib/hvsc/hvscIngestionRuntime.ts)

---

### R10-022 · Low · Effort S · Impact: correctness
**`ConfigBrowserPage.tsx` — `audioConfiguredRef` used inside `useCallback` but not included in the dependency array**

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
**`noFallthroughCasesInSwitch: false` allows accidental switch fallthrough to silently pass the compiler**

Combined with `strict: false`, this means any switch statement that accidentally falls through (missing `break` or `return`) compiles cleanly. This is a source of hard-to-trace bugs in state machines and routing logic.

Files: [tsconfig.app.json](../../tsconfig.app.json)

---

## H — Dead Code

### R10-026 · High · Effort S · Impact: dead code removal

**`src/hooks/useFileLibrary.ts` — exported hook with zero consumers anywhere in the codebase**

`useFileLibrary` manages a file-library state with localStorage persistence keyed to a device ID. Exhaustive search across all of `src/`, `tests/`, and `playwright/` finds no imports of this hook outside its own definition file. The `tests/unit/fileLibrary.test.ts` file that might seem related actually imports from `src/lib/playback/fileLibraryUtils.ts` and `fileLibraryTypes.ts` — an entirely separate module. The hook itself has no test.

Files: [src/hooks/useFileLibrary.ts](../../src/hooks/useFileLibrary.ts)

---

### R10-027 · High · Effort S · Impact: dead code removal

**`src/components/ConnectionBadge.tsx` — exported component with zero consumers anywhere in the codebase**

`ConnectionBadge` renders an animated connection-status badge (Wifi/WifiOff icons, compact or full mode). Exhaustive search across `src/`, `tests/`, and `playwright/` finds no imports of this component outside its own file. The active component that serves this UI role is `ConnectivityIndicator.tsx` (used in `AppBar`).

Files: [src/components/ConnectionBadge.tsx](../../src/components/ConnectionBadge.tsx)

---

### R10-028 · Medium · Effort S · Impact: dead code removal

**`src/hooks/useSidPlayer.tsx` — functionally deprecated hook that will become fully dead when `MusicPlayerPage.tsx` is removed**

`useSidPlayer.tsx` carries an explicit `@deprecated` comment: "Prefer the unified playback engine used by the Play Files page. This provider is only kept for test/coverage probes and legacy experiments." Its sole active consumer in the routed application is `MusicPlayerPage.tsx` (which is itself unrouted — see R10-017). In `App.tsx`, `SidPlayerProvider` is conditionally rendered only when coverage probes are enabled, wrapping the full `<AppRoutes>` tree — but no routed component calls `useSidPlayer()`, so the context is created and never consumed.

Deleting `MusicPlayerPage.tsx` (R10-017) makes `useSidPlayer.tsx` and its test (`tests/unit/hooks/useSidPlayer.test.tsx`) also candidates for removal. They should be deleted in the same pass.

Files:

- [src/hooks/useSidPlayer.tsx](../../src/hooks/useSidPlayer.tsx)
- [tests/unit/hooks/useSidPlayer.test.tsx](../../tests/unit/hooks/useSidPlayer.test.tsx) — remove alongside
- [src/App.tsx](../../src/App.tsx) — remove the `SidPlayerProvider` conditional wrapper (lines 163–175)

---

### R10-029 · Medium · Effort S · Impact: dead code removal

**Five orphaned scripts in `scripts/` — one-off experiments with no active automation path**

Each script was confirmed to have no entry in `package.json` scripts, no reference in any `.github/workflows/` file, and no import from any active script. Contents confirm a one-off or experimental origin:

| Script | Nature | Evidence |
| --- | --- | --- |
| `scripts/test_ram_ts.mjs` | One-off debug | Self-described: "test script that mimics the TypeScript RAM operations exactly … helps identify if there's a bug in the TypeScript implementation" |
| `scripts/inventory-ctas.mjs` | One-off UI scan | Scans React components for CTAs; no consuming workflow |
| `scripts/merge-files.mjs` | Ad-hoc file concatenator | Documented as a manual CLI tool; almost certainly an LLM context-feeding aid with no project automation role |
| `scripts/cleanup-old-evidence.sh` | One-off format migration | Removes old "flat format" evidence directories; the migration has long since completed |
| `scripts/hvsc_filename_frequency.py` | One-off analysis | Frequency analysis of HVSC filenames; no automation path, no consuming workflow |

**Caveats:** `scripts/run-maestro.sh` is NOT in this list — it is documented in `doc/testing/maestro.md`. `scripts/report-coverage.mjs` is NOT in this list — it is documented in `doc/code-coverage.md` as a useful manual tool. `scripts/diff-screenshots.mjs`, `scripts/measure-mock-timing-profile.mjs`, and `scripts/manual-play-sid.sh/.ts` are also NOT in this list — they are legitimate developer investigation tools even without CI automation.

---

## I — Code Style / Minor Issues

### R10-024 · Low · Effort S · Impact: readability

**TODO/FIXME comments present in production source without tracking issues**

Found in 10+ files including tracing modules and `HomeDiskManager.tsx`. These should either be actioned, converted to tracked issues, or removed.

---

### R10-025 · Low · Effort S · Impact: maintainability

**`allowJs: true` in `tsconfig.app.json` enables JS compilation but the codebase appears all-TypeScript**

If no `.js` files are intentionally compiled, disabling this removes one category of potential type escape.

Files: [tsconfig.app.json](../../tsconfig.app.json)

---

## Priority Matrix

| ID | Title | Severity | Effort | Impact Area |
|----|-------|----------|--------|-------------|
| R10-001 | `HomeDiskManager.tsx` 1,981 lines — split required | High | L | Maintainability, testability |
| R10-002 | `SettingsPage.tsx` 1,652 lines — split required | High | L | Maintainability, testability |
| R10-006 | TypeScript strict mode disabled | High | M | Type-safety, correctness |
| R10-003 | `useHvscLibrary` / `useVolumeOverride` oversized | Medium | M | Maintainability |
| R10-004 | `usePlaybackController` state machine in hook | Medium | M | Maintainability, testability |
| R10-007 | `as any` in tracing and config modules | Medium | S | Type-safety |
| R10-009 | Config extraction logic duplicated | Medium | S | DRY |
| R10-011 | Config fetch failure silently swallowed | Medium | S | UX, correctness |
| R10-012 | `AppErrorBoundary` is coarse — no per-page boundaries | Low | S | Resilience |
| R10-014 | 9 `useState` in `SettingsPage` causes re-renders | Medium | M | Performance |
| R10-015 | Missing `useCallback`/`useMemo` in large components | Medium | S | Performance |
| R10-017 | `MusicPlayerPage.tsx` is unrouted dead code — delete | High | S | Dead code removal |
| R10-026 | `useFileLibrary.ts` — unused hook, zero consumers | High | S | Dead code removal |
| R10-027 | `ConnectionBadge.tsx` — unused component, zero consumers | High | S | Dead code removal |
| R10-018 | `home/components/` gap — untested components | Medium | M | Regression safety |
| R10-021 | HVSC state patch uses `as any` | Medium | S | Correctness |
| R10-028 | `useSidPlayer.tsx` — deprecated, dead after R10-017 | Medium | S | Dead code removal |
| R10-029 | Five orphaned one-off scripts in `scripts/` | Medium | S | Dead code removal |
| R10-005 | Files approaching 600-line threshold | Medium | S | Maintainability (watch) |
| R10-008 | Config API shape relies on runtime probing | Low | M | Type-safety |
| R10-010 | `setTimeout(resolve, 0)` repeated 5× | Low | S | Readability |
| R10-013 | `console.*` in production bypasses structured logs | Low | S | Diagnostics |
| R10-016 | `HomeDiskManager` inflates bundle chunk | Low | S | Bundle size |
| R10-019 | Missing tests for HVSC pipeline/status modules | Low | M | Regression safety |
| R10-020 | API timeout edge cases may have thin test coverage | Low | S | Correctness |
| R10-022 | Ref read outside `useCallback` deps | Low | S | Correctness |
| R10-023 | `noFallthroughCasesInSwitch: false` | Low | S | Correctness |
| R10-024 | TODO/FIXME without tracking | Low | S | Housekeeping |
| R10-025 | `allowJs: true` likely unused | Low | S | Config hygiene |

---

## What Is Already Good

- **Zero silent catch blocks** — all caught exceptions are logged or rethrown. The CLAUDE.md exception rule is respected.
- **No deprecated React patterns** — no class components, legacy context, or `findDOMNode`.
- **Excellent import hygiene** — consistent ordering, no detected circular dependencies, well-formed barrel files.
- **No commented-out code** — no dead comment blocks; the "delete, don't comment" convention is followed.
- **Strong E2E coverage** — 42 Playwright specs with golden trace assertions cover end-to-end user flows well.
- **Good chunk splitting** — `vite.config.ts` has sensible `manualChunks` for vendor libraries.
- **Thorough structured logging** — `addLog`/`addErrorLog` with context throughout core modules.
- **Async safety** — `isMounted` guards and cleanup in `useEffect` calls are consistently present.
- **Clear project conventions** — formatting, commit style, test naming, and module structure are consistent.
