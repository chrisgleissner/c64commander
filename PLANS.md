# Diagnostics UX Extension Implementation Plan

Status: In progress
Classification: DOC_PLUS_CODE, UI_CHANGE
Specs:

- `doc/diagnostics/diagnostics-ux-redesign.md`
- `doc/diagnostics/diagnostics-ux-extension-1.md`

## Execution Status

| ID  | Task                                                                                      | Phase | Dependencies                          | Status      | Notes                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------- | ----- | ------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | Read required repo rules and diagnostics specs                                            | 1     | none                                  | completed   | `README.md`, `.github/copilot-instructions.md`, `doc/ux-guidelines.md`, redesign spec, extension spec                                     |
| T2  | Map current diagnostics implementation and identify gaps/conflicts                        | 1     | T1                                    | completed   | Identified missing recovery evidence, missing config-drift/config heat-map entry points, partial latency capture, and export/history gaps |
| T3  | Refactor overlay state foundation for strict stack invariants and state restoration       | 1     | T2                                    | completed   | Preserved single analytic popup slot and parent overlay state through popup usage                                                         |
| T4  | Enforce diagnostics overlay + inline disclosure + single analytic popup interaction model | 2     | T3                                    | completed   | Kept config drift as in-overlay secondary detail view and analytic popups above diagnostics only                                          |
| T5  | Implement connection actions region behavior and recovery-first defaults                  | 3     | T4                                    | completed   | `Demo` now enters recovery-first mode; retry and switch remain inline                                                                     |
| T6  | Implement recovery evidence emission for reconnect and target switching                   | 4     | T5                                    | completed   | Added action tracing, REST recovery probes, recovery evidence store, and explicit failure logging                                         |
| T7  | Harden deterministic health-check execution and result recording                          | 5     | T6                                    | completed   | Removed random run ids while retaining strict sequential probe execution                                                                  |
| T8  | Implement latency analysis filters and popup semantics                                    | 6     | T7                                    | completed   | Latency samples now populate from traced REST/FTP responses                                                                               |
| T9  | Implement health history chart behaviors and event overlays                               | 7     | T7                                    | completed   | Added zoom/pan controls and recovery event overlays                                                                                       |
| T10 | Implement secondary detail views for device detail and health-check detail                | 8     | T7                                    | in_progress | Device detail exists; dedicated dense health-check detail view still outstanding                                                          |
| T11 | Complete config drift and shared heat-map behaviors                                       | 9     | T7                                    | completed   | Added config drift entry point and config heat-map entry point using shared popup                                                         |
| T12 | Enrich diagnostics export with recovery and health evidence                               | 10    | T6, T7, T9, T11                       | completed   | Added supplemental export payload with health snapshot, last health check, latency, history, and recovery evidence                        |
| T13 | UX hardening across compact/medium/expanded profiles                                      | 11    | T4, T5, T8, T9, T11                   | in_progress | Diagnostics-specific behavior validated in component tests; screenshot and E2E validation still pending                                   |
| T14 | Add regression tests for all changed flows and modules                                    | 12    | T4, T5, T6, T7, T8, T9, T10, T11, T12 | in_progress | Added diagnostics unit/component regression tests; E2E expansion still pending                                                            |
| T15 | Run validation, inspect screenshots, and close remaining gaps                             | 12    | T14                                   | in_progress | Targeted tests, scoped eslint, scoped prettier, and build passed; full coverage hit unrelated existing disk-manager failures              |

## Phased Plan

### PHASE 1 - Architecture Alignment

- Map existing overlay structure to Chapter 5 interaction layers.
- Map current summary and stream behavior to Chapter 6 summary-first model.
- Identify conflicts in popup ownership, state restoration, recovery context, and evidence persistence.
- Refactor foundations before feature expansion.

### PHASE 2 - Interaction Layer Enforcement

- Implement strict layering model:
  - diagnostics overlay
  - inline disclosure
  - nested analytic popup
- Enforce stack invariants and popup replacement behavior.
- Implement deterministic back/escape/focus restoration.

### PHASE 3 - Connection Actions (Chapter 7, 8)

- Implement `Retry connection` as a direct summary-region action.
- Implement `Switch device` as inline disclosure.
- Enforce validation-first switching, busy states, and inline feedback.
- Preserve overlay, filters, stream, and expanded state during recovery.

### PHASE 4 - Recovery Evidence (Chapter 9)

- Emit `Action` and `Problem` entries for reconnect/switch attempts and failures.
- Map contributors correctly.
- Preserve root-cause continuity for `Investigate now`.

### PHASE 5 - Deterministic Health Check System (Chapter 10, 11)

- Enforce strict sequential probes: `REST -> JIFFY -> RASTER -> CONFIG -> FTP`.
- Keep one recorded pass per trigger with no retries or parallelism.
- Implement and verify skip semantics, full result recording, and latency snapshot capture.
- Ensure CONFIG roundtrip uses preferred targets and records semantic vs transport failures correctly.

### PHASE 6 - Latency Analysis (Chapter 12)

- Implement trailing-window percentile tracking and deterministic filtering.
- Implement nested latency popup with multi-line chart and checkbox filtering.
- Preserve parent overlay state and make empty/sparse states explicit.

### PHASE 7 - Health History (Chapter 13)

- Maintain ring buffer max 500.
- Implement popup visualization with zoom/pan controls.
- Overlay failures, reconnects, switches, and config roundtrip failures when available.

### PHASE 8 - Secondary Detail Views (Chapter 14)

- Implement firmware / FPGA / core / uptime detail view from overall health.
- Present dense health-check result detail without polluting the summary.

### PHASE 9 - Config Drift + Heat Maps (Chapter 15)

- Implement runtime vs persisted drift diff view.
- Reuse one shared heat-map system for `REST`, `FTP`, and `CONFIG`.
- Support count vs latency mode and cell-detail overlay.

### PHASE 10 - Export Enrichment (Chapter 16)

- Extend existing export paths with recovery evidence, latency stats, history, and drift.
- Keep filtered export aligned with current stream filters.

### PHASE 11 - UX Hardening

- Validate recovery vs investigation clarity.
- Ensure visible health and connectivity at all times.
- Enforce one clear path to root cause and compact-safe layout behavior.

### PHASE 12 - Testing + Verification

- Add unit, integration, and E2E tests for all specified diagnostics flows.
- Refresh only the screenshot subset made inaccurate by visible UI changes.
- Run full required validation and resolve all failures before completion.

## Deterministic Dependency Graph

- Foundation:
  - T1 -> T2 -> T3 -> T4
- Recovery:
  - T4 -> T5 -> T6
- Health system:
  - T6 -> T7
- Analytics:
  - T7 -> T8
  - T7 -> T9
  - T7 -> T10
  - T7 -> T11
- Export:
  - T6 + T7 + T9 + T11 -> T12
- Hardening and validation:
  - T4 + T5 + T8 + T9 + T11 -> T13
  - T4..T12 -> T14 -> T15

## Impact Map

- UI:
  - `src/components/diagnostics/`
- Diagnostics domain logic:
  - `src/lib/diagnostics/`
- Hooks / overlay integration:
  - `src/hooks/`
  - overlay invocation state and connection state integration
- Tests:
  - `src/**/*.test.ts?(x)`
  - `playwright/`
- Docs and evidence:
  - `PLANS.md`
  - screenshot folders under `doc/img/` only if visible documented diagnostics UI changed and existing images become inaccurate

## Risk Register

| Risk                                                                                        | Impact | Mitigation                                                                                            | Status    |
| ------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------- | --------- |
| Existing diagnostics test changes in worktree conflict with implementation                  | Medium | Read before editing touched files, avoid reverting unrelated changes, patch narrowly                  | active    |
| Popup layering may already violate Chapter 5 focus/back invariants                          | High   | Centralize popup ownership and preserve invoker refs/overlay state                                    | active    |
| Recovery actions currently succeed/fail without emitting diagnostics evidence               | High   | Add explicit evidence recording and regression tests before final validation                          | mitigated |
| Health-check engine currently uses non-deterministic run ids and may mis-attribute failures | High   | Remove randomness from recorded output where required and align contributor mapping/tests             | mitigated |
| Latency/history/heat-map views may not preserve parent overlay context                      | High   | Keep popup-local state separate and verify with component/E2E tests                                   | active    |
| UI overflow on compact layouts                                                              | High   | Run targeted layout tests and screenshot checks for diagnostics surfaces                              | active    |
| Export schema drift from new diagnostics payloads                                           | Medium | Extend export tests and verify filtered/share-all behavior                                            | active    |
| Full repo coverage and CI are blocked by unrelated existing disk-manager timeout failures   | High   | Record blocker honestly and keep diagnostics slice validation separate until upstream tests are fixed | active    |

## Verification Strategy

- Unit and integration:
  - diagnostics domain logic (`healthCheckEngine`, `latencyTracker`, `healthHistory`, `configDrift`, `heatMapData`, export helpers)
  - diagnostics component tests for layering, recovery flows, filters, and state restoration
- E2E:
  - diagnostics overlay open/close and back behavior
  - retry connection and switch device flows
  - latency popup filters and reset
  - heat map popup and cell detail
  - config drift view
  - health history popup
- Layout verification:
  - compact, medium, expanded diagnostics surfaces
  - no mid-word wrap, clipped labels, or viewport overflow
- Required command validation before completion:
  - `npm run lint`
  - `npm run test`
  - `npm run test:coverage`
  - `npm run build`
  - `npm run test:e2e`
- Screenshot verification:
  - update only the minimal diagnostics screenshot subset if the visible documented diagnostics UI changed

## Completion Criteria

- All extension chapters 5 through 17 implemented with no known gaps.
- Stack invariants, summary-first ordering, and recovery flows conform to spec.
- Deterministic health-check behavior with no retries, no parallelism, and explicit skip reasons.
- Recovery and failure paths emit diagnosable evidence and no silent failures remain.
- Filters, scroll position, and expanded rows persist across recovery, popup open/close, and device switching.
- Unit + integration + E2E coverage added for recovery, health checks, popup layering, latency filters, heat maps, and config drift.
- New/changed diagnostics modules meet the requested high coverage and repo-wide branch coverage is at least 91%.
- Required validation is green.

## Current Validation Snapshot

- Passed:
  - targeted Vitest diagnostics suites for dialog, connection-actions behavior, recovery-evidence store, latency tracker, health history, health check engine, config drift, and heat-map data
  - scoped `eslint` on changed diagnostics files
  - scoped `prettier --check` on changed files
  - `npm run build`
- In progress / blocked:
  - `npm run test:coverage` exposed unrelated existing timeouts in `tests/unit/components/disks/HomeDiskManager.branches.test.tsx` and `tests/unit/components/disks/HomeDiskManager.dialogs.test.tsx`
  - full repo `npm run lint` did not return a clean terminal completion in this environment; replaced with successful scoped eslint plus scoped prettier checks
  - `npm run test:e2e` not run yet
  - diagnostics screenshots not refreshed
