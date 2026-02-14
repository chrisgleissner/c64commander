# Production Readiness Remediation Plan (feat/iOS-PORT)

## 1. Purpose

This plan operationalizes `doc/research/production-readiness-audit.md` into an implementation sequence for an autonomous LLM.

Primary target: Android MVP production readiness.
Secondary target: iOS structure and portability risk reduction.

This is a fix-and-verify plan with a strict bias toward automated validation. Manual retesting is optional and non-blocking.

## 2. Non-Negotiable Execution Rules

- Fix findings in priority order unless a dependency requires reordering.
- Do not suppress failures with skipped tests, weakened assertions, or silent catches.
- Every code change must add or strengthen automated tests in the same phase.
- Every critical-flow fix must be guarded at at least two levels where possible (unit + integration/native/E2E).
- Keep Android as release gate; keep iOS as forward-looking quality gate.
- Follow `.github/copilot-instructions.md` and `AGENTS.md` constraints.
- If trace semantics change, update golden traces under `playwright/fixtures/traces/golden`.

## 3. Definition of Done

All conditions must be satisfied:

1. All High-severity findings from audit priorities 1-3 are fixed and covered by automated tests.
2. Medium findings 4-10 are either fixed with tests or explicitly documented as accepted risk with rationale and owner.
3. No silent exception handling remains in touched code paths.
4. Android background playback reliability is CI-gated, including lock-screen/background scenarios.
5. HVSC ingest and playback failure paths are covered by deterministic automated tests.
6. Full required CI and local validation suite passes.

## 4. Required Automated Gates (Must Become Blocking)

Treat these as required checks for Android production readiness:

1. `npm run lint`
2. `npm run test`
3. `npm run build`
4. `npm run test:e2e` (or project-equivalent Playwright CI command)
5. Android JVM tests: `cd android && ./gradlew test`
6. Android emulator integration suite under `tests/android-emulator`
7. Maestro Android smoke suite including lock/background flow
8. Maestro HVSC flow(s) currently excluded by default
9. Golden trace validation job (if trace assertions exist in CI)

If CI runtime is too high, split into parallel jobs but keep all gates required for merge.

## 5. Priority-to-Workstream Mapping

- P1 High: Background service restart/lifetime safety (`BackgroundExecutionService.kt`)
- P2 High: Lock-screen/background flow not CI-enforced (`.maestro/config.yaml`, `scripts/run-maestro-gating.sh`)
- P3 High: Session restore does not rehydrate native due-time (`usePlaybackPersistence.ts`, `PlayFilesPage.tsx`)
- P4 Medium-High: Source navigation stale result race (`useSourceNavigator.ts`)
- P5 Medium: Config write queue swallows errors (`configWriteThrottle.ts`)
- P6 Medium: Inconsistent observability (`hvscStateStore.ts`, `hvscStatusStore.ts`, source adapters)
- P7 Medium: Song length propagation best-effort behavior lacks reliability contract (`playbackRouter.ts`, playback controller)
- P8 Medium: HVSC ingest memory pressure hotspots (`hvscDownload.ts`, `hvscArchiveExtraction.ts`)
- P9 Medium: Missing Android native background service tests (`android/app/src/test/java`, emulator specs)
- P10 Medium: iOS parity gaps (background plugin no-op, capabilities)
- P11 Low-Medium: Empty catches in Gradle
- P12 Low: Oversized files and modularity risk

## 6. Multi-Step Remediation Plan

## Step 0. Baseline and Safety Harness

Goal: Establish deterministic baseline before any behavioral change.

Actions:

1. Run all currently available tests and record pass/fail baseline.
2. Capture current CI matrix and classify jobs as required vs informational.
3. Add/refresh a single production-readiness tracking doc section that maps each audit priority to a test artifact.

Mandatory test outputs:

1. Local command transcript summary with failing suites listed.
2. CI baseline status snapshot.

Exit criteria:

1. Known-red list documented.
2. No code behavior changed yet.

## Step 1. Enforce Critical CI Gates First (Test Infrastructure)

Goal: Prevent future regressions while fixes are implemented.

Actions:

1. Make lock/background Maestro flow part of default Android gating.
2. Include HVSC Maestro smoke flow(s) in required Android path.
3. Ensure failing lock/HVSC flows fail CI decisively.
4. Keep iOS jobs non-blocking if policy requires, but publish artifacts and results.

Mandatory test additions/changes:

1. CI assertions that explicitly verify required flow execution, not only pass count.
2. Optional: add a small script check that fails if `.maestro/config.yaml` excludes critical tags.

Exit criteria:

1. CI cannot pass if lock-screen or HVSC gating is skipped.

## Step 2. Fix High Blocker: Android Background Service Lifetime Safety

Goal: Remove sticky/wakelock lifetime drift and make service behavior deterministic.

Primary modules:

1. `android/app/src/main/java/uk/gleissner/c64commander/BackgroundExecutionService.kt`
2. `android/app/src/main/java/uk/gleissner/c64commander/BackgroundExecutionPlugin.kt`
3. `src/lib/native/backgroundExecution.ts`
4. `src/pages/PlayFilesPage.tsx`

Actions:

1. Define explicit service lifecycle contract for idle, active playback, and restart states.
2. Bound wake lock/service lifetime with deterministic stop conditions.
3. Validate restart semantics after process death and after user stop events.
4. Align JS-native start/stop transitions to avoid orphan service states.

Mandatory tests:

1. New Android JVM tests for service start/stop/restart and wake lock release.
2. New Android emulator scenario: playback starts, app backgrounds, screen lock, service survives only while required.
3. New emulator/maestro scenario: playback stopped, service fully terminates, no persistent notification/wakelock drift.

Exit criteria:

1. Native service lifecycle is test-verified under restart and stop conditions.
2. No flaky results across repeated test runs.

## Step 3. Fix High Blocker: Restored Session Must Rehydrate Native Due-Time

Goal: Ensure deterministic auto-advance after app/process restore in background conditions.

Primary modules:

1. `src/pages/playFiles/hooks/usePlaybackPersistence.ts`
2. `src/pages/PlayFilesPage.tsx`
3. `src/pages/playFiles/hooks/usePlaybackController.ts`
4. `src/lib/native/backgroundExecutionManager.ts`

Actions:

1. Rehydrate native due-time whenever restored session contains an active due guard.
2. Ensure track-instance guard and due-time are restored atomically.
3. Validate restore path for foreground, background, and lock-screen states.

Mandatory tests:

1. Unit tests for restore path: saved due-time -> native rearm call expected.
2. Integration test around `PlayFilesPage` restore effect and native manager interactions.
3. Emulator/maestro regression: kill app mid-track, relaunch, lock device, verify deterministic next-track transition.

Exit criteria:

1. Restore path deterministically schedules/clears native due-time with no stale state.

## Step 4. Fix High Blocker: Locked-Screen Reliability Must Be Continuously Verified

Goal: Turn lock-screen playback reliability from ad-hoc to continuously enforced.

Primary modules:

1. `.maestro/smoke-background-execution.yaml`
2. `.maestro/config.yaml`
3. `scripts/run-maestro-gating.sh`
4. `tests/android-emulator/specs/*` (expand scope)

Actions:

1. Add explicit lock/unlock assertions for playback continuity and correct auto-advance.
2. Add negative-path checks for network interruption during locked playback.
3. Ensure flows are resilient but strict (avoid optional taps masking real failures).

Mandatory tests:

1. Required Maestro lock-screen flow in CI.
2. At least one emulator test for lock/unlock + connectivity disruption.
3. Retry/flakiness budget rule: if a test requires retries, investigate root cause before merge.

Exit criteria:

1. Lock-screen scenarios run by default and block release regressions.

## Step 5. Fix Medium-High: Source Navigation Race and Async Stale Writes

Goal: Prevent out-of-order async results from mutating active UI state.

Primary modules:

1. `src/lib/sourceNavigation/useSourceNavigator.ts`
2. Related adapters used in async loads

Actions:

1. Gate all async state writes by active request token/session.
2. Ensure loading indicator and entries/path updates are controlled by same token.
3. Validate cancellation and rapid navigation churn behavior.

Mandatory tests:

1. Unit tests simulating out-of-order promise resolution.
2. UI integration tests for rapid folder switches and back/forward navigation.
3. Regression test proving stale responses cannot overwrite newer state.

Exit criteria:

1. Deterministic navigation state under concurrent async responses.

## Step 6. Fix Medium: Error Propagation and Structured Observability

Goal: Eliminate hidden failures and make production root-cause analysis reliable.

Primary modules:

1. `src/lib/config/configWriteThrottle.ts`
2. `src/lib/hvsc/hvscStateStore.ts`
3. `src/lib/hvsc/hvscStatusStore.ts`
4. `src/lib/sourceNavigation/ftpSourceAdapter.ts`
5. `src/lib/sourceNavigation/localSourcesStore.ts`
6. `android/app/build.gradle`

Actions:

1. Replace swallowed errors with rethrow or structured WARN/ERROR logging.
2. Standardize logging envelopes so source kind (`local`, `ultimate`, `hvsc`) is always present.
3. Add context fields for operation, identifiers/paths, and stack traces.

Mandatory tests:

1. Unit tests asserting errors are surfaced/logged in config throttle path.
2. Unit tests for store/adapters verifying log emission on failure paths.
3. Build-script sanity check if practical for Gradle catch behavior.

Exit criteria:

1. No silent catch patterns in touched areas.
2. Failures are diagnosable from logs alone.

## Step 7. Fix Medium: Song Length Propagation Reliability Contract

Goal: Make duration propagation behavior explicit, deterministic, and test-guarded.

Primary modules:

1. `src/lib/playback/playbackRouter.ts`
2. `src/pages/playFiles/hooks/usePlaybackController.ts`
3. `src/lib/c64api.ts`

Actions:

1. Define expected outcomes for duration-available and duration-unavailable paths.
2. Validate fallback semantics under FTP/SSL failure without hidden drift.
3. Add observability events for propagation success/fallback.

Mandatory tests:

1. Unit matrix covering all source kinds and duration states.
2. Integration tests asserting next-track timing behavior remains deterministic across fallback paths.
3. Golden trace updates if endpoint/event semantics change.

Exit criteria:

1. Duration propagation behavior is explicit and regression-guarded.

## Step 8. Fix Medium: HVSC Ingestion Resource Pressure and Failure Resilience

Goal: Reduce OOM/pressure risk and validate crash-safe ingest behavior.

Primary modules:

1. `src/lib/hvsc/hvscDownload.ts`
2. `src/lib/hvsc/hvscArchiveExtraction.ts`
3. `src/lib/hvsc/hvscIngestionRuntime.ts`
4. `src/lib/hvsc/hvscFilesystem.ts`

Actions:

1. Reduce peak memory pressure in archive read/extract stages.
2. Validate idempotent restart behavior under interrupted download/extract/ingest.
3. Verify cleanup logic for partial artifacts and marker integrity.
4. Validate bounded retries and deterministic cancellation semantics.

Mandatory tests:

1. Unit tests for ENOSPC/IO failure paths and partial-cache cleanup.
2. Unit/integration tests for cancel-restart idempotency.
3. Android-targeted stress test job (can be nightly) for large archive ingestion.
4. Maestro HVSC flow promoted to required gate for release branches.

Exit criteria:

1. Ingestion is deterministic across interruption/restart scenarios.
2. Resource pressure regressions are test-detectable.

## Step 9. Expand Android Native and Emulator Coverage (Cross-Cutting)

Goal: Close platform blind spots by testing native lifecycle behavior directly.

Actions:

1. Add Android JVM tests for background execution plugin/service contracts.
2. Expand emulator suite beyond connection smoke:
   - Playback start/stop
   - App background/foreground
   - Screen lock/unlock
   - Network interruption and recovery
   - Process kill/restore with playback session
3. Add artifact/log assertions to diagnose flaky failures quickly.

Exit criteria:

1. Android-native lifecycle is represented in automated tests, not only JS/unit coverage.

## Step 10. iOS Forward-Looking Hardening (Non-Blocking for Android MVP)

Goal: Reduce divergence risk while preserving Android-first release policy.

Primary modules:

1. `ios/App/App/NativePlugins.swift`
2. `ios/App/App/Info.plist`
3. `ios/App/App/AppDelegate.swift`
4. `.github/workflows/ios-ci.yaml`

Actions:

1. Document explicit behavior parity matrix: Android vs iOS for background playback.
2. Add lightweight iOS smoke assertions to detect accidental regressions.
3. Keep iOS CI artifacts actionable even when jobs are informational.

Mandatory tests:

1. iOS smoke pipeline remains green for currently supported capabilities.
2. If background capability is introduced later, add dedicated lock/background tests before enabling parity claims.

Exit criteria:

1. iOS divergence is intentional, documented, and continuously visible.

## Step 11. Large-File Refactor Risk Reduction (Low Priority)

Goal: Reduce regression probability in oversized high-churn modules.

Primary modules:

1. `src/pages/SettingsPage.tsx`
2. `src/components/disks/HomeDiskManager.tsx`
3. `src/lib/c64api.ts`
4. `src/pages/PlayFilesPage.tsx`

Actions:

1. Refactor opportunistically when touching these files for critical fixes.
2. Split by responsibility with behavior-preserving tests first.

Mandatory tests:

1. Characterization tests before refactor.
2. No coverage regression after split.

Exit criteria:

1. Module boundaries are clearer and behavior remains stable.

## 7. Automated Test Strategy (Heavy Coverage Focus)

Adopt this minimum pyramid for all critical playback/HVSC work:

1. Unit (fast, exhaustive branch/path coverage)
2. Integration (React hooks/page orchestration and plugin boundary mocks)
3. Native/JVM (Android service/plugin lifecycle behavior)
4. Emulator/Maestro (realistic lock/background/device-lifecycle scenarios)
5. Playwright trace regression where UI/API trace semantics are relevant

Coverage policy for critical modules:

- Raise effective coverage target for critical files to >=90% lines/branches.
- Require explicit failure-path tests for every catch/fallback branch.
- Require deterministic-timer tests for due-time and auto-advance logic.

Critical scenario matrix that must be automated:

1. HVSC download interrupted then resumed/retried
2. HVSC extract failure + cleanup
3. HVSC ingest cancelled then restarted
4. Playback while app backgrounded + locked screen
5. Process kill during playback + restore + auto-advance
6. FTP failure during duration propagation
7. REST transient failure and bounded retries
8. Rapid source navigation with stale async responses
9. Button press visual state remains transient only

## 8. CI Quality Controls for Test Reliability

1. Enforce no-merge on skipped critical tests.
2. Quarantine policy is allowed only for non-critical tests and requires issue link + SLA.
3. Track flaky test rate per suite and fail if it exceeds agreed threshold.
4. Persist diagnostic artifacts for failing runs:
   - Maestro videos/screenshots/logs
   - Android logcat
   - Playwright traces
5. Add a periodic stress/nightly lane for HVSC ingestion and background playback soak tests.

## 9. Execution Order and Dependencies

Use this order:

1. Step 0 -> Step 1 (gating first)
2. Step 2 -> Step 3 -> Step 4 (all High blockers)
3. Step 5 -> Step 6 -> Step 7 -> Step 8 -> Step 9 (Medium reliability and coverage)
4. Step 10 (iOS forward-looking)
5. Step 11 (low-priority modularity)

Do not start Medium/Low remediation until all High blockers are fixed and passing required gates.

## 10. Per-Step Completion Checklist (For the Implementing LLM)

For each step, do all items before moving on:

1. Implement code change.
2. Add or update automated tests for success and failure paths.
3. Run targeted suite(s) plus impacted broader suite.
4. Update docs reflecting current behavior.
5. Record evidence in commit/PR notes:
   - What changed
   - Which risks are closed
   - Which tests prove closure
   - Remaining risks

## 11. Final Release Readiness Validation

Run and require pass:

1. `npm run lint`
2. `npm run test`
3. `npm run build`
4. `npm run test:e2e`
5. `cd android && ./gradlew test`
6. Android emulator suite
7. Required Maestro suite including lock/background + HVSC

Then produce a final readiness report with:

1. Closed findings by priority
2. Remaining accepted risks with rationale
3. Test evidence links/artifacts
4. Explicit Android go/no-go recommendation
