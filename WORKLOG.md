# Release Pipeline, Telemetry, and Bottom-Sheet Worklog

Status: IN_PROGRESS
Date: 2026-03-22

## 2026-03-22T00:00:00Z - Step 1 - Phase 1 analysis

- Decision: Treat this as a combined `DOC_PLUS_CODE`, `CODE_CHANGE`, and `UI_CHANGE` task because it affects CI workflows, runtime versioning, and visible bottom-sheet layout behavior.
- Findings:
  - Version propagation is inconsistent across build paths. `web.yaml` strips `v` from tag refs, while Android and iOS do not. Shared runtime display uses `versionLabel`, which can diverge from the exact injected tag.
  - Android and local build paths still allow fallback to `package.json` or `git describe`, which can leak stale version data into tagged builds when CI injection is incomplete.
  - iOS telemetry monitoring already distinguishes confirmed active-flow disappearance (`exit 3`) from degraded simctl visibility (`exit 4`), but the workflow signals one wide lifecycle window around grouped Maestro execution.
  - Main content clearance uses tab-bar baseline spacing (`calc(5rem + env(safe-area-inset-bottom))`), while bottom sheets only reserve raw safe-area inset, so the sheet contract does not match the main navigation baseline.
- Validation evidence:
  - Read and compared `.github/workflows/android.yaml`, `.github/workflows/ios.yaml`, `.github/workflows/web.yaml`.
  - Read `src/lib/buildVersion.ts`, `vite.config.ts`, `src/lib/buildInfo.ts`, `src/pages/home/components/SystemInfo.tsx`, `android/app/build.gradle`, `ci/telemetry/ios/monitor_ios.sh`, `src/components/ui/app-surface.tsx`, and related unit tests.
- Next step: Implement the shared version/canonical-tag fix, then tighten iOS lifecycle gating, then centralize bottom-sheet clearance in the shared sheet primitive.

## 2026-03-22T00:30:00Z - Step 2 - Diagnostics detail interaction audit

- Decision: Extend the current diagnostics dialog instead of introducing a second diagnostics surface. The repository already contains `HealthCheckDetailView.tsx`, which exposes the exact probe-by-probe detail requested by the user.
- Findings:
  - `DiagnosticsDialog.tsx` currently uses the health-panel chevron only to reveal a latency stub, not the full health detail view.
  - Activity rows are rendered as static cards with no expansion state or affordance gating.
  - `DiagnosticsDialog` receives `healthCheckRunning`, `lastHealthCheckResult`, and `liveHealthCheckProbes`, so the live detail view can be wired without changing overlay ownership.
- Next step: Rewire the health panel to the existing detail view, add tap-to-toggle activity row expansion with hidden no-op affordances, then lock the behavior with diagnostics unit tests.

## 2026-03-22T00:45:00Z - Step 3 - Swipe navigation regression triage

- Decision: Treat the new swipe-navigation request as part of the same UI hardening pass because the app already contains a dedicated swipe runway and ordered tab-route model.
- Findings:
  - The page-order and wrap-around model already exists in `src/lib/navigation/tabRoutes.ts` and `src/lib/navigation/swipeNavigationModel.ts`.
  - The active gesture hook in `src/hooks/useSwipeGesture.ts` only starts gestures for primary left-button interactions, which is overly mouse-centric for touch-origin pointer events.
  - The repository has model-level wrap-around tests, but it lacks a regression that proves real touch-origin page transitions work through the runtime app shell.
- Next step: Relax touch-origin gesture admission without weakening mouse safeguards, then add touch and wrap-around regression tests.

## 2026-03-22T01:05:00Z - Step 4 - Diagnostics screenshot evidence plan

- Decision: Extend the existing Playwright diagnostics screenshot flow instead of adding a second diagnostics-specific screenshot spec. The current gallery already owns diagnostics overview, header, activity, filters, connection, analysis, and tools coverage.
- Findings:
  - The existing diagnostics screenshot run already seeds deterministic analytics and overlay state, so completed health-check detail can be captured without invoking live network behavior.
  - The diagnostics test bridge also supports direct overlay-state injection, which makes it possible to capture an in-flight health-check progress view with stable probe states.
  - The current gallery proves the collapsed activity list, but it does not yet prove expandable-row behavior or the richer header detail now exposed by the diagnostics dialog.
- Next step: Add screenshot outputs for expanded activity detail, second-tap collapse, completed health-check detail, and live health-check progress, then refresh the diagnostics screenshot index.

## 2026-03-22T01:25:00Z - Step 5 - Short-label UX follow-up

- Decision: Keep the diagnostics overlay strictly compact and move explanatory copy into the Docs page.
- Findings:
  - The remaining `Purpose` assertions were only in tests, but the health-check detail and device detail views still carried explanatory sentences that compete with small-screen labels.
  - The Docs page already has a diagnostics section, so the richer explanation for probe order and expanded activity rows can live there without introducing another documentation surface.
  - The screenshot catalog still needs per-type expanded activity evidence for Problems, Actions, Logs, and Traces.
- Next step: Shorten the remaining overlay copy, update tests, extend the screenshot catalog for each expanded activity type, and regenerate the screenshot set.
