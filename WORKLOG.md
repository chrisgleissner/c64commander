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
