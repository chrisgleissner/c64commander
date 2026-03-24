# Diagnostics, Navigation, and Health Worklog

Status: IN_PROGRESS
Date: 2026-03-23

## 2026-03-23T00:00:00Z - Classification and scope

- Classification: `DOC_PLUS_CODE`, `CODE_CHANGE`, `UI_CHANGE`
- Objective: resolve diagnostics completeness, diagnostics discoverability, CPU slider flicker, swipe gesture behavior, deep linking, and authoritative health-state consistency.
- Decision: keep changes tightly scoped to existing diagnostics/tracing/navigation subsystems instead of introducing a parallel observability stack.

## 2026-03-23T00:15:00Z - Root cause discovery findings

- REST execution path
  - Primary REST requests are executed in `src/lib/c64api.ts`.
  - Requests call `recordRestRequest()` and `recordRestResponse()` in `src/lib/tracing/traceSession.ts`.
- FTP execution path
  - Primary FTP operations are executed in `src/lib/ftp/ftpClient.ts`.
  - FTP traces are recorded through `recordFtpOperation()` in `src/lib/tracing/traceSession.ts`.
- Diagnostics UI ownership
  - A global owner exists in `src/components/diagnostics/GlobalDiagnosticsOverlay.tsx`.
  - A second, Settings-local diagnostics dialog is rendered in `src/pages/SettingsPage.tsx`.
  - This split ownership is a structural risk for diverging diagnostics behavior.

## 2026-03-23T00:25:00Z - Problem area A/B root causes

- A. Diagnostics capture incomplete
  - `recordRestRequest()` stores `method`, `url`, and `normalizedUrl`, but not parsed `protocol`, `hostname`, `path`, or `query` as first-class fields.
  - `recordRestResponse()` stores `path` loosely and depends on callers to supply it consistently.
  - `recordFtpOperation()` stores `operation` and `path`, but not `hostname` or explicit command/result schema fields required by the task.
  - `buildActionSummaries()` reconstructs action effects from loosely-shaped trace payloads, so missing fields stay missing all the way into the UI.
- B. Diagnostics UI lacks meaningful summaries
  - `DiagnosticsDialog.tsx` currently renders `summary.actionName` and a generic counts string for action rows.
  - The collapsed activity list does not promote hostname/path/latency even when the underlying request/response data exists.

## 2026-03-23T00:35:00Z - Problem area C/F root causes

- C. Diagnostics features not reachable
  - `LatencyAnalysisPopup` and `HealthHistoryPopup` are reachable from `DiagnosticsDialog.tsx`.
  - `ConfigDriftView` and `HeatMapPopup` exist under `src/components/diagnostics/` but are not surfaced from the current diagnostics UI.
  - Current diagnostics entry points are only the Settings button and health badge open request helpers; there is no sections index.
- F. Docs lack navigation clarity and deep links
  - `src/pages/DocsPage.tsx` documents diagnostics conceptually but does not enumerate all diagnostics surfaces or any stable deep-link paths.

## 2026-03-23T00:45:00Z - Problem area D root cause

- D. CPU slider jump-back
  - `src/pages/HomePage.tsx` uses a dedicated `cpuSpeedDraftIndex` local state plus direct interactive writes.
  - The draft state is reset whenever `cpuSpeedValue` changes from config refreshes, which can snap the displayed thumb back mid-interaction.
  - Canonical slider behavior already exists elsewhere: device-backed sliders keep an optimistic local state and gate remote reconciliation while dragging.

## 2026-03-23T00:55:00Z - Problem area E root cause

- E. Swipe navigation delayed/non-authoritative
  - `useSwipeGesture.ts` tracks live drag progress correctly, but commit logic uses a fixed `40px` threshold in `SWIPE_COMMIT_THRESHOLD_PX`.
  - The required behavior is width-relative thresholding (~30% of the container), not a fixed absolute pixel value.
  - `SwipeNavigationLayer.tsx` already separates drag and transition phases, but route-driven deep-link cases are not part of the gesture/diagnostics architecture.

## 2026-03-23T01:05:00Z - Problem area G/H root causes

- G. Health check not authoritative
  - `runHealthCheck()` in `src/lib/diagnostics/healthCheckEngine.ts` produces a complete result and pushes health history, but the latest result is only stored in component state inside `GlobalDiagnosticsOverlay.tsx`.
  - No global store exposes the latest health check result to other UI consumers.
  - CONFIG currently skips with a generic reason when no roundtrip target is found, but that state is not elevated into a single app-wide authority.
- H. Global device status diverges from health check
  - `useHealthState()` computes health entirely from recent trace activity plus connection state in `src/hooks/useHealthState.ts`.
  - `UnifiedHealthBadge` consumes `useHealthState()`, while `DiagnosticsDialog` separately shows `lastHealthCheckResult` from overlay-local state.
  - Result: after a successful health check, the diagnostics header can show one state while the global badge still reflects stale or unrelated trace-derived degradation.

## 2026-03-23T01:15:00Z - Routing/deep-link findings

- `tabIndexForPath()` in `src/lib/navigation/tabRoutes.ts` only recognizes tab routes and existing tab sub-routes.
- `/diagnostics/*` currently resolves to no tab slot and would fall through to not-found.
- The swipe shell can support diagnostics deep links by mapping `/diagnostics/*` into the Settings slot while keeping diagnostics ownership global and route-aware.

## 2026-03-23T01:25:00Z - Planned implementation direction

- Unify diagnostics ownership around the global overlay.
- Extend trace payloads through centralized diagnostics event builders rather than patching UI strings.
- Add route-aware diagnostics section state and visible section entry points.
- Promote the latest health check result into a shared authoritative store consumed by `useHealthState()` and diagnostics UI.
- Replace the CPU slider’s draft-state reset behavior with the canonical optimistic slider model.

## 2026-03-23T01:30:00Z - Validation plan

- Targeted unit tests
  - trace session event completeness
  - diagnostics dialog summaries/discoverability
  - swipe navigation threshold and route behavior
  - health/global-state consistency
- Required repo validation for code changes
  - `npm run lint`
  - `npm run test:coverage`
  - `npm run build`

## 2026-03-24T00:00:00Z - Contract harness trace/matrix/replay delivery

- Classification: `DOC_PLUS_CODE`, `CODE_CHANGE`
- Implemented a forensic recorder for the contract harness with structured REST and FTP trace entries, incremental JSONL output, grouped markdown summaries, and replay-manifest generation.
- Added structured matrix execution for `stress`, `soak`, and `spike` profiles, including reusable stage planning, FTP session pooling, stage-tagged tracing, and CLI `--test-type` override support.
- Added deterministic replay via `tests/contract/replay.ts`, including dry-run schedule output, REST/FTP preflight checks, and replay-run artifact generation.
- Added device-unresponsive outcome handling with `meta.json` outcome tracking, `DEVICE_UNRESPONSIVE` sentinel emission, and exit code `2` for aborted runs.
- Preserved the legacy breakpoint artifact contract while extracting shared stage execution primitives for reuse.
- Validation completed with `npx tsc -p tests/contract/tsconfig.json`, `npm run lint`, `npm run test:coverage` at 91% branch coverage, trace-enabled SAFE mock runs, trace-disabled SAFE mock runs, matrix quick and soak-override mock runs, simulated device-unresponsive mock runs, breakpoint regression runs, and replay dry-run verification.
- Added `tests/contract/instrumentation-validation.md` to capture the concrete run IDs, artifact inventories, redaction proof, replay sample output, and regression evidence.

## 2026-03-24T18:03:34Z - Contract failure-classification correction

- Classification: `DOC_PLUS_CODE`, `CODE_CHANGE`
- Corrected the contract harness failure model so it now distinguishes `HEALTHY`, `DEGRADED`, and `UNRESPONSIVE` instead of treating a single `ECONNRESET` as terminal.
- Added a multi-protocol verification monitor in `tests/contract/lib/health.ts` that checks REST `/v1/info`, ICMP ping, FTP connect/NOOP, and telnet reachability, then requires a 5-second persistence window before classifying `UNRESPONSIVE`.
- Wired health probe batches and state transitions into `logs.jsonl` and `trace.jsonl`, and updated matrix, breakpoint, and replay execution paths to stop only on verified persistent unresponsiveness.
- Corrected replay artifact generation in `tests/contract/lib/traceWriter.ts` so FTP uploads carry byte counts and `device-replay.sh` now replays FTP steps through `lftp`.
- Added CLI replay overrides at script start: `--host <hostname>` now defaults to `c64u`, and `--password <password>` overrides `DEVICE_PASSWORD` when needed.
- Added focused regression coverage in `tests/contract/lib/health.test.ts` and updated replay writer assertions.
- Commands run:
  - `npx tsc -p tests/contract/tsconfig.json`
  - `npx vitest run tests/contract/lib/health.test.ts tests/contract/lib/traceWriter.test.ts tests/contract/lib/breakpointRunner.test.ts tests/contract/lib/replayEngine.test.ts tests/contract/lib/stressMatrix.test.ts tests/contract/lib/restRequest.test.ts tests/contract/lib/config.test.ts tests/contract/lib/breakpoint.test.ts`
- Observation: the refactor and focused contract regression suite are green locally; the next unresolved step is the real-device rerun needed to prove a persistent cross-protocol unresponsive state and replay it from a clean device.
