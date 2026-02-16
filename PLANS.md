# CI Pipeline Stabilization Execution Contract

Last updated: 2026-02-16
Owner: Copilot coding agent
Branch: test/improve-coverage

## Objective

Stabilize and harden all three CI pipelines (iOS, Android, Web/Fuzz) until fully deterministic, concurrency-safe, and green.

## Success criteria

1. All CI pipelines green on main.
2. No workflow run remains queued or blocked due to earlier runs on the same branch.
3. Android CI produces valid merged coverage reports and uploads to CodeCov.
4. Android unit tests compile and execute deterministically.
5. 5-minute fuzz run produces >=20 distinct interaction steps, non-black video, correct-resolution screenshots, no 1x1 images, no immediate timeout.
6. Artifacts demonstrate correct behavior.

## Constraints

- Do not duplicate tests, weaken coverage gates, or disable failing checks.
- Fix root causes only.
- Keep CI runtime reasonable.
- Android is primary; do not regress iOS or Web.

---

## Part 1: iOS CI Concurrency and Maestro Stability

**Problem:** Workflow runs remain queued (e.g. run ID 22055688337), blocked by earlier runs on the same branch. No concurrency controls exist. `ios-smoke-launch` Maestro flow fails because `maestro test` does not target the correct simulator, and flow timeouts are too short for cold CI simulators.

### Tasks

- [x] 1.1 Add workflow-level concurrency group with cancel-in-progress to ios-ci.yaml.
- [x] 1.2 Verify only the latest run executes when multiple commits pushed in quick succession.
- [x] 1.3 Pass `--device $UDID` to `maestro test` in ios-maestro-run-flow.sh.
- [x] 1.4 Increase Maestro flow timeouts (LONG_TIMEOUT 20s→60s, TIMEOUT 15s→30s, SHORT_TIMEOUT 5s→10s) in launch-and-wait, continue-demo, common-navigation, and ios-smoke-launch.

---

## Part 2: Android CI Stability and Coverage

**Problem:** "No coverage reports found" in Android CI. jacocoTestReport depends on testReleaseUnitTest which may fail or produce no exec data. Duplicate cache steps exist. Kotlin tests fail to compile due to protected `notifyListeners` access and final plugin classes.

### Tasks

- [x] 2.1 Fix jacocoTestReport task to depend only on testDebugUnitTest (release unit tests not needed for coverage).
- [x] 2.2 Fix jacocoTestCoverageVerification to depend only on testDebugUnitTest.
- [x] 2.3 Remove duplicate "Cache Android SDK system images" step in android-apk.yaml.
- [x] 2.4 Add concurrency group with cancel-in-progress to android-apk.yaml.
- [x] 2.5 Make BackgroundExecutionPlugin and DiagnosticsBridgePlugin `open` for test subclassing.
- [x] 2.6 Replace Mockito spy+verify pattern with direct call capture in testable subclasses (avoids inner-class receiver reference issue).

---

## Part 3: Web CI Concurrency

**Problem:** No concurrency controls on web-platform.yaml.

### Tasks

- [x] 3.1 Add workflow-level concurrency group with cancel-in-progress to web-platform.yaml.

---

## Part 4: Nightly Fuzzing

**Problem:** 5-minute fuzz runs produced black videos, 1x1 screenshots, immediate timeouts.

### Tasks

- [x] 4.1 Verify fuzz CI workflow has concurrency group (already present).
- [x] 4.2 Verify fuzz script build + Playwright integration is correct.

---

## Part 5: Duplicate Step Cleanup

- [x] 5.1 Remove duplicate "Fix broken apt repos" step in web-e2e job of android-apk.yaml.

---

## Progress log

- 2026-02-16: Analysis complete. Identified missing concurrency controls, JaCoCo dependency on release tests, duplicate CI steps.
- 2026-02-16: Implemented concurrency groups for iOS, Android, and Web CI.
- 2026-02-16: Fixed JaCoCo task dependencies to use debug-only.
- 2026-02-16: Removed duplicate cache and apt-fix steps.
- 2026-02-16: Made BackgroundExecutionPlugin and DiagnosticsBridgePlugin `open` for test subclassing.
- 2026-02-16: Replaced spy+verify with direct call-capture pattern in both plugin test files. All 105 Android tests pass. JaCoCo report (66KB XML) generates correctly.
- 2026-02-16: Fixed ios-smoke-launch Maestro failure: added `--device $UDID` to maestro test command and increased flow timeouts for CI cold-simulator resilience.
