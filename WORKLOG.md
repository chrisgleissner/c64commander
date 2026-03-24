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

## 2026-03-24T11:52:43Z - Review 12 audit kickoff

- Classification for this task: `DOC_ONLY`.
- Mission reset: perform a deep-dive research and audit pass across the current product/repo state, with primary emphasis on diagnostics, real-device behavior, HVSC, and cross-platform consistency.
- Confirmed existing review lineage under `doc/research/review-1` through `review-11`; reserved `review-12` for this run.
- Read current `README.md`, `doc/ux-guidelines.md`, repo memories related to diagnostics/playlists/streaming, and prior review-11 materials.
- Used code exploration to map the diagnostics overlay/state/tracing surfaces, HVSC workflow surfaces, platform-specific plugin entrypoints, and relevant docs/tests.
- Confirmed physical Android device presence with `adb devices -l`: Pixel 4 serial `9B081FFAZ001WX` attached over USB.
- Current working hypothesis: some previously reported gaps may still be present in docs/tests even if code has moved; this run will verify current behavior rather than assume prior findings still apply.
- Next actions: create the new report folder, inspect implementation/test files in detail, launch the app on the Pixel 4, and gather direct diagnostics/HVSC evidence from the real-device path.

## 2026-03-24T12:08:40Z - Review 12 runtime evidence and report synthesis

- Created `doc/research/review-12/review-12.md` and filled the final audit structure with executive summary, scope/method, environment, audited/not-audited areas, issue matrix, findings, fix sequence, and appendix.
- Re-checked multiple prior review-11 themes against current code and confirmed several earlier defects are no longer current: health-state gating, diagnostics action labels, diagnostics list depth, HVSC extraction gating, Android HVSC chunk offset parsing, and iOS HVSC native implementation.
- Verified host-side C64U reachability by both hostname and IP: `http://c64u/v1/info` and `http://192.168.1.167/v1/info` returned matching device metadata.
- Ran focused diagnostics/HVSC Playwright suites and observed a green result (`24 passed`), which is useful as a contrast point because the live browser HVSC path is still misleading.
- Reproduced a live web-runtime issue in the built preview path: the Play page exposed an enabled `Download HVSC` action in a desktop browser, then failed with fetch/CORS errors and a generic failed status instead of presenting HVSC as unsupported in browsers.
- Reproduced a local workflow issue: `npm run dev -- --host 127.0.0.1 --port 4173` failed immediately with `ELOOP: too many symbolic links encountered` on `test-data/sid/hvsc/hvsc`.
- Confirmed internal doc drift: the iOS parity matrix still claims HVSC is shared TypeScript with no native code even though `HvscIngestionPlugin.swift` exists, is registered in `AppDelegate.swift`, and depends on `SWCompression` in `ios/App/Podfile`.
- Confirmed diagnostics doc drift: README/UX docs still describe an older diagnostics flow while the implementation now centers around a unified evidence feed, filter editor, footer tools, and overflow actions.
- Captured Android evidence to the maximum feasible extent despite the device lockscreen blocker. The Pixel 4 remained locked, but logcat still showed app startup and live requests targeting `http://c64u/v1/info` plus additional config endpoints.
- Cleaned up the temporary Vite preview process started for browser runtime inspection.

## 2026-03-24T12:31:00Z - Review 12 follow-up Android audit, diagnostics fix, and validation

- Unlocked the attached Pixel 4 and exercised the live diagnostics sheet directly on-device.
- Captured real-device diagnostics screenshots showing the app reporting `C64U · 127.0.0.1:<ephemeral-port>` and localhost action rows on physical hardware, which points to demo/mock routing being active or insufficiently disclosed during a real-device session.
- Traced that Android finding back to the active connection snapshot used by `DiagnosticsDialog.tsx` and to the explicit demo/mock routing paths in `src/lib/connection/connectionManager.ts`.
- Mapped a concrete web HVSC implementation strategy grounded in the current codebase: add a web-server HVSC proxy with range support, add an IndexedDB-backed HVSC storage layer, reuse `hvscArchiveExtraction.ts` for browser extraction, reuse the existing songlength service, and route web-installed SID playback through `api.playSidUpload()` using blobs from browser storage.
- Fixed a mobile diagnostics usability bug in `src/components/diagnostics/DiagnosticsDialog.tsx` by repositioning the overflow menu so it stays clearly left of the close button instead of overlapping its hit area on small screens.
- Added targeted Playwright regression coverage in `playwright/modalConsistency.spec.ts` for the diagnostics header control separation on a 390x844 viewport.
- Validation after the follow-up code change:
  - Targeted Playwright diagnostics regression passed (`2 passed`).
  - `npm run lint` passed for the changed source files; only pre-existing warnings remain in generated `android/coverage/` files.
  - `npm run build` passed.
  - Isolated unit coverage completed with 91.01% branch coverage.
