# PLAN: CI Telemetry Completion (Android + iOS, GitHub-Hosted)

## Current Implementation Status

- Android monitor exists at `ci/telemetry/android/monitor_android.sh` and emits `metrics.csv`, `events.log`, `metadata.json`, `monitor.log`.
- iOS monitor exists at `ci/telemetry/ios/monitor_ios.sh` with the same output schema and file naming.
- Both monitors default to `TELEMETRY_INTERVAL_SEC=1` and sample CPU/RAM with low-overhead process probes.
- CI workflows already start monitors before Maestro and stop them after Maestro in:
  - `.github/workflows/android.yaml`
  - `.github/workflows/ios.yaml`
- Telemetry summary/chart generation and artifact upload are already present.

## Platform-Specific Gaps

### Android (ubuntu-latest, emulator)

- Validate robust PID discovery under CI timing and transient `adb` instability.
- Enforce minimal CSV correctness checks beyond non-empty file (header + multiple samples).
- Confirm monitor lifecycle is resilient when Maestro fails and still exits cleanly after stop signal.

### iOS (macos-latest, simulator)

- Harden app PID discovery fallback when simulator `ps` output format differs across macOS images.
- Enforce minimal CSV correctness checks beyond non-empty file (header + multiple samples).
- Confirm monitor lifecycle remains active through Maestro runtime and only exits at explicit stop.

## CI Integration Gaps

- Guarantee telemetry artifacts are uploaded with `if: always()` before any telemetry gate step that can fail the job.
- Ensure telemetry gates verify:
  - CSV exists
  - CSV has expected header
  - CSV has multiple data rows (not just header)
- Preserve Maestro failure semantics while still collecting and uploading telemetry artifacts.

## Risks

- GitHub runner infra instability (emulator/simulator boot intermittency) can fail jobs independently of telemetry.
- `adb` device enumeration latency may delay PID visibility on first samples.
- `simctl spawn ... ps` output differences can reduce PID detection reliability if not handled defensively.
- If monitor stop is not signaled/awaited correctly, telemetry may terminate late and miss final flush.

## Validation Gates

1. Android telemetry gate (in `android.yaml`):
   - `ci-artifacts/telemetry/android/metrics.csv` exists
   - header matches telemetry CSV schema
   - at least 2 data rows
   - `monitor.exitcode` exists and is acceptable
2. iOS telemetry gate (in `ios.yaml`):
   - `artifacts/ios/_infra/telemetry/metrics.csv` exists
   - header matches telemetry CSV schema
   - at least 2 data rows
   - `monitor.exitcode` exists and is acceptable
3. Artifact upload runs with `if: always()` and includes telemetry outputs even when Maestro fails.

## Execution Steps (Authoritative)

1. [in-progress] Audit current monitor + workflow implementation against required behavior.
2. [pending] Patch Android telemetry lifecycle/gates (if gaps confirmed).
3. [pending] Patch iOS telemetry lifecycle/gates (if gaps confirmed).
4. [pending] Validate with repo-required checks:
   - `npm run test:coverage`
   - `npm run lint`
   - `npm run test`
   - `npm run build`
   - `./build`
5. [pending] If CI remains non-green due infra-only failures, produce residual limitations report with evidence.

## Progress Log

- 2026-02-17: Rebased plan to the telemetry completion objective and confirmed existing monitor/workflow baseline.
