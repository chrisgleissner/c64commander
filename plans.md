# Maestro CI reliability plan

## Phase 1 - Establish Baseline + CI Parity
- [x] Identify current CI workflow(s) that build APK and run Playwright tests (android-apk.yaml)
- [x] Identify emulator start strategy in CI (none; no Maestro job yet)
- [x] Identify how Maestro is installed/invoked locally (scripts/smoke-android-emulator.sh)
- [x] Define single command for local gating run (scripts/run-maestro-gating.sh)
- [x] Run local gating command on clean emulator and capture timings (passed in ~53s for flows)

## Phase 2 - Deterministic Emulator Bring-up
- [x] Pin API level and system image for CI (android-34 google_apis x86_64)
- [x] Disable emulator animations for deterministic UI timing
- [x] Ensure emulator boot completion before install/run
- [x] Validate emulator boot + install timing within budget (boot+install within 180s timeout locally)

## Phase 3 - Maestro Runner + Diagnostics
- [x] Add CI-friendly runner with adb diagnostics and Maestro JUnit output
- [x] Capture logcat + screenshot on failure
- [x] Build Maestro evidence into test-results/evidence/maestro
- [ ] Confirm Maestro CLI install is stable on CI runners

## Phase 4 - CI Integration With Early Start + Parallelism
- [x] Start emulator early in Android Maestro job (background)
- [x] Build APK while emulator boots
- [x] Run Maestro gating flows with default excludeTags config
- [ ] Confirm CI wall-clock fits ~6 minutes after parallelization

## Phase 5 - Gating Rules (APK depends on Maestro)
- [x] Gate android-packaging job on Maestro success
- [ ] Verify release artifacts only upload when Maestro passes

## Phase 6 - Runtime Budget Enforcement + Hardening
- [ ] Capture CI timing breakdown (boot/build/Maestro)
- [ ] Add optional nightly workflow for non-gating Maestro tags (not blocking)
- [ ] Revisit timeouts after CI data

## Findings + Decisions
- Use default .maestro/config.yaml excludeTags to keep gating subset to smoke-launch and smoke-playback.
- Prefer background emulator start within Maestro job to overlap with npm install + APK build.
- Local failure root cause: app smoke mode config missing + short navigation waits; fixed by writing c64u-smoke.json and adding explicit waits in common-navigation.
- Local build failure root cause: JAVA_HOME pointed to Java 25; runner now pins Java 17 when available.
- Local install failure root cause: versioned APK filename; runner now resolves debug APK dynamically.
