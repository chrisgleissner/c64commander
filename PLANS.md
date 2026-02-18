# PLAN: CI Telemetry Completion (Android + iOS, GitHub-Hosted)

## Current Telemetry Implementation Status

- Android monitor is active at `ci/telemetry/android/monitor_android.sh` and uses 1 Hz sampling via `TELEMETRY_INTERVAL_SEC=1`.
- iOS monitor is active at `ci/telemetry/ios/monitor_ios.sh` and uses 1 Hz sampling via `TELEMETRY_INTERVAL_SEC=1`.
- Both monitors write the existing output set and file naming:
  - `metrics.csv`
  - `events.log`
  - `metadata.json`
  - `monitor.log`
- Android CI telemetry lifecycle is wired in `.github/workflows/android.yaml`:
  - start before Maestro
  - stop after Maestro with `if: always()`
  - upload telemetry artifacts with `if: always()`
  - enforce CSV/header/row-count/exitcode gates
- iOS CI telemetry lifecycle is wired in `.github/workflows/ios.yaml`:
  - start before Maestro
  - stop after Maestro with `if: always()`
  - upload telemetry artifacts with `if: always()`
  - enforce CSV/header/row-count/exitcode gates

## Platform-Specific Gaps (Audit Findings and Closure)

### Android (ubuntu-latest, emulator)

- Closed: Maestro exit code is now preserved in `.github/workflows/android.yaml`.
- Closed: PID detection now uses `pidof` plus `/proc/*/cmdline` fallback.
- Closed: transient adb empty reads are retried; short misses no longer immediately mark process disappearance.

### iOS (macos-latest, simulator)

- Closed: simulator PID discovery now adds `simctl launchctl list` fallback.
- Closed: CPU/RSS per-process sampling is explicitly host-level (`ps`) on macOS.
- Closed: fallback to host process list is non-sticky; each sample still retries simulator process listing first.

## CI Integration Gaps

- No open telemetry integration gap remains in workflow wiring.
- `runs-on` for iOS jobs is now `macos-latest` to match GitHub-hosted runner requirement.

## Risks

- Emulator/simulator boot instability on GitHub-hosted runners can fail jobs independently of telemetry.
- `adb` and `simctl` transient command failures can create short sampling gaps.
- macOS image differences can change simulator process-list output formatting.

## Validation Gates

1. Android telemetry gate:
   - `ci-artifacts/telemetry/android/metrics.csv` exists
   - header matches expected schema
   - file has header + multiple data rows
   - `ci-artifacts/telemetry/android/monitor.exitcode` exists and is acceptable
2. iOS telemetry gate:
   - `artifacts/ios/_infra/telemetry/metrics.csv` exists
   - header matches expected schema
   - file has header + multiple data rows
   - `artifacts/ios/_infra/telemetry/monitor.exitcode` exists and is acceptable
3. Artifact upload:
   - upload step runs with `if: always()`
   - telemetry files are included even if Maestro fails

## Authoritative Execution Steps

1. [completed] Audit monitor/workflow implementation and identify concrete gaps.
2. [completed] Patch Android monitor + workflow for PID robustness and Maestro exit-code preservation.
3. [completed] Patch iOS monitor + workflow for robust `simctl` PID detection and host-level 1 Hz CPU/RSS sampling.
4. [completed] Re-validate telemetry gates and artifact behavior in workflows.
5. [completed] Run required local checks before completion:
   - `npm run test:coverage`
   - `npm run lint`
   - `npm run test`
   - `npm run build`
   - `./build`
6. [completed] Blocker handling path prepared; no local infrastructure blocker encountered.

## Progress Log

- 2026-02-17: Completed telemetry audit; identified Android exit-code masking and iOS PID/sampling robustness gaps.
- 2026-02-18: Implemented Android PID/read robustness and preserved Maestro exit code.
- 2026-02-18: Implemented iOS `simctl` PID fallback and host-level per-process CPU/RSS sampling.
- 2026-02-18: Switched iOS workflow jobs to `macos-latest`.
- 2026-02-18: Verified required local gates:
  - `npm run test:coverage` passed with branch coverage 82.01%.
  - `npm run lint` passed.
  - `npm run test` passed.
  - `npm run build` passed.
  - `./build` passed.
