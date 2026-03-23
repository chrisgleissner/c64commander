# Release Pipeline, Telemetry, and Bottom-Sheet Worklog

Status: IN_PROGRESS
Date: 2026-03-22 (updated 2026-03-23)

## 2026-03-23T00:00:00Z - Deterministic Git Versioning — Phase 1 (Analysis)

- Classification: `CODE_CHANGE` (affects build scripts, vite.config, playwright test)
- Findings:
  - All generated files are already gitignored; no pathspec exclusion needed.
  - `src/version.ts` does not yet exist (not tracked); it will be generated and gitignored.
  - Current `vite.config.ts` uses `git describe --dirty --always` which is correct for all-tracked-files dirty detection, but uses a 3-char SHA suffix via `shortenGitId` — spec requires 5.
  - Current test `resolveExpectedVersion()` accepts 8-char SHA suffix and arbitrary suffixes — spec requires strict 5-char lowercase hex or no suffix.
  - `prebuild` only runs `notices:generate`; the version script must run before it.
  - CI builds set `VITE_APP_VERSION` (web/android) which bypasses the version label derivation entirely and uses the exact tag — this path is correct and unchanged.
  - Decision: introduce `scripts/resolve-version.sh`, gitignore `src/version.ts`, add script to `prebuild`, update vite.config.ts local path to prefer generated label, tighten playwright test to strict exact-match assertions.

## 2026-03-23T00:15:00Z - Deterministic Git Versioning — Phase 2-8 (Implementation)

- Created `scripts/resolve-version.sh` with:
  - `git describe --tags --abbrev=0` for tag
  - `git rev-parse --short=5 HEAD` for 5-char SHA
  - `git diff --quiet HEAD --` for dirty detection (tracked files only)
  - Guards: fail if no tag, fail if `src/version.ts` is tracked
  - Generates `src/version.ts` and prints version to stdout
- Updated `.gitignore` to add `src/version.ts`
- Updated `package.json` `prebuild`: prepend `bash scripts/resolve-version.sh &&`
- Updated `vite.config.ts`: added `readGeneratedVersionLabel()` that reads `src/version.ts`, used as primary version label for local builds (CI path unchanged)
- Updated `playwright/ui.spec.ts` `resolveExpectedVersion()` to mirror script logic; updated assertion to strict exact text match
- Ran `npm run lint && npm run test && npm run build` — all pass

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

## 2026-03-22T02:10:00Z - Step 6 - Diagnostics evidence hardening

- Decision: Treat the diagnostics action screenshot and trace redaction as one integrity fix. The screenshot must reflect the same stored trace shape the app uses in production, including partial secret masking and binary preview limits.
- Findings:
  - The action-expanded UI already renders request headers, response headers, request body, response body, payload previews, status, and latency.
  - The deterministic diagnostics seed did not yet include those richer request/response fields for the POST snapshot action, so the screenshot could not prove the documented behavior.
  - Secret masking was still full-value replacement in redaction tests, and FTP trace payloads were not being redacted before persistence.
  - Binary payload previews were centrally capped below the newly requested 256-byte requirement.
- Next step: Switch secret masking to first-3-character partial redaction, extend trace-session redaction to FTP payloads and preview regeneration for sensitive structured payloads, enrich the seeded POST/FTP diagnostics evidence, prune obsolete diagnostics activity screenshots, and rerun focused tests plus screenshot generation.

## 2026-03-22T16:10:00Z - Step 7 - Diagnostics log evidence and problem coverage

- Decision: Treat the misleading log screenshots as a product bug, not just a screenshot-seed defect. The diagnostics list must render canonical app log lines and expand into exception-aware detail with stack traces, and the Problems view must aggregate failures from both logs and trace events.
- Findings:
  - Log rows were rendering only `message` plus raw `details` JSON, which hid the log level and any exception metadata in the collapsed list.
  - Expanded log detail reused raw JSON rather than a debugger-friendly view with level, message, exception type, and stack trace.
  - The screenshot trace seeding path was not waiting for `c64u-traces-updated`, which made the Problems gallery prone to omitting trace-derived failures.
- Next step: Render canonical log lines in the diagnostics list, add exception-aware expanded detail, make trace seeding deterministic, reseed screenshots with realistic DEBUG/INFO/WARN/ERROR samples plus stack traces, and rerun diagnostics screenshots and regression tests.
