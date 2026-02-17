# PLAN: Cross-Platform CI Telemetry (Android Emulator + iOS Simulator)

## Scope

Implement deterministic low-overhead telemetry for CI runs at a fixed 3-second cadence, covering:
- Android Maestro and Android fuzz lanes (emulator)
- iOS Maestro lanes (simulator)

Deliverables include raw CSV logs, event logs, metadata, deterministic summaries, workflow integration, and artifact upload on success/failure.

## Constraints

- No interactive profilers (Android Studio/Xcode Instruments GUI)
- Low overhead hot loop using lightweight process probes
- Headless CI-compatible
- Stable machine-readable output schema
- Fail loudly on monitor startup errors and empty logs

## Execution Plan (authoritative)

1. [in-progress] Create telemetry subsystem files under `ci/telemetry/`
   - Android monitor script
   - iOS monitor script
   - Deterministic summarizer
   - Telemetry README
2. [pending] Integrate telemetry start/stop and summarization into workflows
   - `.github/workflows/android.yaml`
   - `.github/workflows/ios.yaml`
   - `.github/workflows/fuzz.yaml`
3. [pending] Enforce failure handling
   - monitor startup failure -> fail job
   - empty CSV -> fail job
   - unexpected app PID disappearance -> fail at end (after artifact upload)
4. [pending] Add synthetic example outputs under `docs/telemetry-example/`
5. [pending] Validate with lint/test/coverage/build
6. [pending] Finalize this plan with completion evidence

## Progress Log

- 2026-02-17: Replaced prior unrelated plan with telemetry plan and began implementation.
- 2026-02-17: Updated telemetry cadence defaults to 1s for Android/iOS/Docker(web) and added Android PSS throttling to keep monitoring overhead low.
