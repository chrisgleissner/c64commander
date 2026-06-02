# Production Hardening 2 — Research Plan (Device Call Safety & Health-Check Load)

> **Task type:** Research-only. No production code/test/format changes.
> **Deliverable:** `docs/research/stabilization/prod-hardening-2/research.md`
> **Working files:** this `PLANS.md` + `WORKLOG.md` (repurposed from the prior
> device-safety _implementation_ task — that content is preserved in git history;
> these now track the prod-hardening-2 _research_ task).

## Problem Statement

The C64 Ultimate (`C64U`) network listener surface can become indefinitely
unresponsive under rapid/concurrent REST/Telnet/FTP/ping traffic. A
conservative back-off / rate-limiting layer exists (`deviceInteractionManager`,
`configWriteThrottle`, `deviceSafetySettings`), but later responsiveness work
(sliders, CTAs) may bypass it. Separately, health checks may consume scarce
rate-limit capacity and compete with user actions. Converge to a written,
evidence-backed research document.

## Investigation Phases

| Phase | Description                                                       | Status   |
| ----- | ----------------------------------------------------------------- | -------- |
| P0    | Set up PLANS.md / WORKLOG.md; mine prior task artifacts           | complete |
| P1    | Map approved outbound architecture (Objective 1)                  | complete |
| P2    | Enumerate & classify all outgoing device-call sites (Objective 2) | complete |
| P3    | Trace CTAs / UI interactions to outbound calls (Objective 3)      | complete |
| P4    | Slider & high-frequency control analysis (Objective 3)            | complete |
| P5    | Health-check architecture & load analysis (Objective 4)           | complete |
| P6    | Target safe-traffic policy (Objective 5)                          | complete |
| P7    | Prioritized roadmap (Objective 6)                                 | complete |
| P8    | Acceptance criteria (Objective 7)                                 | complete |
| P9    | Gap closure — re-run searches with discovered names               | complete |
| P10   | Write research.md                                                 | complete |
| P11   | Self-audit; verify no code changes remain                         | complete |

## Files / Subsystems Checklist

- [x] `src/lib/deviceInteraction/deviceInteractionManager.ts` (REST/FTP/Telnet scheduler)
- [x] `src/lib/config/deviceSafetySettings.ts` (presets, AUTO resolution)
- [x] `src/lib/config/configWriteThrottle.ts` (serialized config queue)
- [x] `src/lib/deviceInteraction/latestIntentWriteLane.ts` (latest-wins lane)
- [x] `src/lib/deviceInteraction/deviceActivityGate.ts` (write-burst gate)
- [x] `src/lib/deviceInteraction/deviceStateStore.ts`
- [x] `src/lib/deviceInteraction/machineTransitionCoordinator.ts`
- [x] `src/lib/deviceInteraction/restRequestIdentity.ts`
- [x] `src/lib/c64api.ts` + `src/lib/c64api/*` (REST transport)
- [x] `src/lib/ftp/*` (FTP transport)
- [x] `src/lib/telnet/*` (Telnet transport)
- [x] `src/lib/diagnostics/healthCheckEngine.ts` + diagnostics
- [x] `src/lib/connection/connectionManager.ts`
- [x] `src/lib/deviceControl/deviceControl.ts`
- [x] `src/hooks/useSavedDeviceHealthChecks.ts`, `useHealthState.ts`
- [x] `src/hooks/useC64Connection.ts`, `useConnectionState.ts`, `useRefreshControl.tsx`
- [x] `src/hooks/useDeviceBoundSlider.ts`, `useInteractiveConfigWrite.ts`
- [x] `src/lib/query/c64PollingGovernance.ts`
- [x] `src/lib/playback/*` (playback writes)
- [x] `src/lib/appLifecycle.ts`, `src/lib/startup/*`
- [x] UI surfaces: `HomePage`, `home/components/*`, `ConfigItemRow`, `VolumeControls`, devices, diagnostics
- [x] Tests under `tests/unit/**` for scheduler/slider/config/health

## Hypotheses

1. `immediate: true` writes once bypassed `scheduleConfigWrite` (fixed) — verify no
   residual bypass remains and that all config writes route through the queue.
2. Sliders update local UI immediately and coalesce, but some commit/preview paths
   may still emit one device write per change under certain conditions.
3. Health checks (`useSavedDeviceHealthChecks`, `healthCheckEngine`) may issue
   probes that consume scheduler capacity and compete with user actions.
4. Diagnostics/discovery probes carry explicit `bypass*` flags — confirmed
   architectural exception; verify scope and risk.
5. Telnet/FTP helper sessions outside `useTelnetActions`/`ftpClient` may open raw
   sessions outside the scheduler.
6. Playback/volume writes may use `immediate`/burst paths needing verification.

## Convergence Criteria

- ≥30 relevant files inspected (or justify fewer).
- ≥10 outgoing device-call paths classified.
- ≥10 CTA/UI interaction families traced.
- All health-check entry points documented.
- Every confirmed/suspected bypass has a remediation recommendation.
- research.md contains all required sections, evidence vs hypothesis separated,
  open questions, exec summary, roadmap, measurable acceptance criteria.
- No production code changes in the working tree.

## Open Uncertainties (running)

- Whether native (Capacitor) Telnet/FTP bridges can emit traffic outside JS gateways.
- Whether any `fetch`/`XMLHttpRequest` exists that does not route through `C64API`.
- Exact health-check cadence and overlap across startup/reconnect/device-switch.

## prod-hardening-5 Fix Plan Addendum

This addendum records the later prod-hardening-5 fix plan without replacing the
existing production-hardening-2 plan above.

### Current Repository State

- Branch: `fix/prod-hardening`.
- Initial worktree state before the prod-hardening-5 edits:
  - Modified: `package-lock.json`.
  - Untracked: `docs/research/stabilization/prod-hardening-5/evidence/`, `s33-resume-sm.png`, `s34-sm.png`.
- Those pre-existing changes were treated as unrelated and preserved.
- Change classification: `DOC_PLUS_CODE` and `UI_CHANGE`.
- Initial prod-hardening-5 HIL used `c64u` only. PR convergence deploy validation followed the current repository preference order and used `u64` after `c64u` REST reset connections.

### Assumptions

- The prod-hardening-5 HIL observations are authoritative unless source/tests prove a finding is already fixed.
- Stale-device and superseded-request behavior can be covered deterministically with mocks or local test doubles.
- Destructive HIL validation must open and cancel confirmations only; it must not confirm Reset, Reboot, Power Cycle, or similar actions on a live device.
- Existing unrelated evidence files and lockfile changes may belong to concurrent work and must not be reverted.

### Findings Being Fixed

1. Abort, cancellation, and stale/superseded request paths are misclassified as malformed JSON or selected-device API failures.
2. Diagnostics modal does not intercept Android Back before router navigation.
3. Destructive Home machine actions lack consistent confirmation.
4. Evidence screenshots are not consistently downscaled for LLM/review consumption.

### Impact Map

- Source files: `src/lib/c64api.ts`, `src/lib/c64api/requestRuntime.ts`, shared interstitial state, Home machine controls, and the new confirmation dialog.
- Tests: Vitest coverage for API, diagnostics/back handling, MachineControls/Home, and the HIL screenshot helper; focused Playwright Home interactivity.
- Scripts/docs: `scripts/hil-screenshot-evidence.mjs` and `docs/research/stabilization/prod-hardening-5/`.
- Runtime platforms: web and Android. iOS CI-only remains affected only through shared React behavior.
- Screenshot docs under `docs/img/`: no broad refresh planned; this task adds review evidence tooling rather than documented app screenshots.

### Implementation Phases

| Phase | Description                                                                   | Status      |
| ----- | ----------------------------------------------------------------------------- | ----------- |
| 1     | Baseline, repo instructions, UX guidance, test discovery, and HIL constraints | complete    |
| 2     | Abort/supersede classification fix and regression tests                       | complete    |
| 3     | Modal Android Back handling and regression tests                              | complete    |
| 4     | Destructive-action confirmations and regression tests                         | complete    |
| 5     | Evidence capture hardening and documentation                                  | complete    |
| 6     | Full validation, Android APK deploy, and initial `c64u` HIL validation        | complete    |
| 7     | PR review convergence updates                                                 | in progress |

### Completion Checklist

- [x] Abort/body-read cancellation no longer reports malformed JSON.
- [x] Genuine malformed JSON still reports malformed JSON.
- [x] Superseded stale-device requests do not create selected-device ERROR problems.
- [x] Diagnostics modal consumes Android Back before route navigation.
- [x] Destructive Home actions require confirmation.
- [x] Cancel and Back from confirmation never execute destructive commands.
- [x] Screenshot/evidence helpers create downscaled review-safe images.
- [x] Regression tests pass.
- [x] Coverage validation passes: global branch coverage 91.70%; local changed executable statement coverage 378/378.
- [x] Android build is installed on Pixel 4 and HIL validation is complete.
- [x] Final `u64` health probe succeeds.
- [x] `docs/research/stabilization/prod-hardening-5/fix-summary.md` exists and is suitable for PR review.
- [ ] PR review comments are answered and resolved.
- [ ] CI checks are green after the PR convergence follow-up commit.

### Current Status

- API cancellation/supersede handling has been patched.
- Shared interstitial Android Back handling has been patched and is being tightened to keep one listener for an active interstitial period.
- Home destructive machine action confirmations have been added for Reset, Reboot, Reboot (Clr Mem), and Power Cycle.
- HIL evidence screenshot helper and usage note have been added; invalid review dimensions now fail fast before resize.
- Targeted Vitest regression tests, full unit tests, lint, coverage, focused Playwright, web build, Capacitor sync, and Android APK build pass for PR convergence.
- Latest APK `android/app/build/outputs/apk/debug/c64commander-0.7.9-rc1-debug.apk` was installed on Pixel 4 `9B081FFAZ001WX` with versionCode `1986`, versionName `0.7.9-rc1`.
- Initial implementation HIL passed with selected device `debug-c64u` at `192.168.1.167`:
  - app showed `HEALTHY`, device `c64u`, firmware `1.1.0`;
  - Diagnostics opened from the health badge; Android Back closed it; route stayed `/`;
  - Reset confirmation opened and Cancel closed it without a machine request;
  - Reboot confirmation opened and Cancel closed it without a machine request;
  - Android Back closed a Reset confirmation without route navigation or a machine request;
  - final `curl -sS --max-time 4 http://c64u/v1/info` succeeded with product `C64 Ultimate`, hostname `c64u`, unique id `5D4E12`, and no errors.
- PR convergence HIL used selected device `debug-u64` / host `u64` because `u64` was reachable and `c64u` reset REST connections:
  - app showed `HEALTHY`, device `u64`, firmware `3.14e`;
  - Reset confirmation opened and Cancel closed it without a machine request;
  - Android Back closed a Reset confirmation without route navigation or a machine request;
  - Diagnostics opened from the health badge and Android Back closed it without route navigation;
  - final `curl -sS --max-time 4 http://u64/v1/info` succeeded with hostname `u64`, unique id `38C1BA`, and no errors.

## PR 270 / PR 271 Merge-Ready Convergence Plan

- Classification: `DOC_PLUS_CODE`
- Scope: fold dependency PR `#271` into `#270`, address all actionable PR feedback on `#270`, fix local and GitHub CI failures, update PR metadata, close `#271`, and leave `#270` merge-ready without opening a new PR.

- [x] Capture current PR 270 and PR 271 metadata.
- [x] Check out PR 270 branch.
- [x] Fetch PR 271 head.
- [x] Merge or cherry-pick PR 271 into PR 270.
- [x] Resolve conflicts, if any.
- [x] Run dependency install and lockfile validation.
- [x] Run local tests and builds.
- [x] Fetch all PR 270 comments, review threads, and reviews.
- [x] Address every unresolved or still-relevant comment.
- [x] Resolve review threads using `gh`.
- [x] Update PR 270 body to mention that PR 271 has been folded in.
- [x] Close PR 271 with a clear comment once folded and verified.
- [x] Push PR 270 updates.
- [x] Track CI for the latest PR 270 head commit.
- [ ] Fix CI failures until green.
- [ ] Final merge-readiness verification.

Current follow-up scope on PR 270 head `cabd14409b094dd739b417e5fcf6f74014bc99fb`:

- [x] Diagnose failing Android workflow shard jobs from run `26807848021`.
- [x] Reproduce shard-3 / shard-9 / shard-12 failures locally from targeted Playwright specs.
- [x] Stabilize the affected Playwright assertions with minimal scope.
- [x] Re-run targeted Playwright specs locally.
- [x] Re-run `npm run build`.
- [x] Re-run `npm run test:coverage` and confirm global branch coverage remains >= `91%`.
- [x] Reinstall latest built APK on the attached Pixel 4 and launch the app.
- [x] Commit and push the CI-follow-up fixes to PR 270.
- [x] Diagnose the remaining shard-9 rerun failure on head `1496beea4480a1d535992d86df467032970a3190`.
- [x] Harden the `homeInteractivity` stream and mobile-control assertions with minimal scope.
- [x] Stress-run the `homeInteractivity` stream start/stop test on `android-phone`.
- [x] Re-run the affected `homeInteractivity` Android-phone cases locally.
- [x] Re-run `npm run test:coverage` after the second stabilization and confirm global branch coverage remains >= `91%`.
- [x] Diagnose the remaining shard-9 CI failures on head `cabd14409b094dd739b417e5fcf6f74014bc99fb`.
- [x] Remove the reload-based telnet-flag setup that fought the storage-reset init script.
- [x] Route telnet-flag enabling through the Settings tab using SPA navigation.
- [x] Make the stream start/stop test self-heal the audio endpoint when CI leaves it at `—:11001`.
- [x] Stress-run the three affected Android-phone `homeInteractivity` cases across repeated iterations.
- [x] Re-run `npm run test:coverage` after the third stabilization and confirm global branch coverage remains >= `91%`.
- [x] Diagnose the remaining shard-3 / shard-9 follow-up failures on head `716d0c746ddaf498386b309639cdab8b11681ac6`.
- [x] Wait for the audio stream controls to re-enable after endpoint repair before clicking Start.
- [x] Make the scanline soak assert the expected checkbox UI state before checking the mock device state.
- [x] Stress-run the remaining `structuredInteractionSoak` Android-phone case across repeated iterations in isolation.
- [x] Re-run `./gradlew testDebugUnitTest jacocoTestReport` locally to verify the Android unit-test path still passes.
- [x] Re-run `npm run test:coverage` and confirm global branch coverage remains >= `91%`.
- [x] Commit and push the latest shard-3 / shard-9 follow-up fix to PR 270.
- [ ] Track the new PR 270 head checks until all required GitHub checks are green.
