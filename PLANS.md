# Android Maestro Telemetry Gate Recovery Plan

## 1) Scope

In scope:
- `.github/workflows/android.yaml` Android Maestro job telemetry lifecycle.
- `ci/telemetry/android/monitor_android.sh` telemetry production.
- `ci/telemetry/summarize_metrics.py` telemetry summary diagnostics behavior.
- Android Maestro telemetry gate step and pre-gate validation in CI.

Explicitly out of scope:
- iOS telemetry workflow and monitor.
- Web workflow, fuzz workflow, release packaging logic unrelated to Android Maestro telemetry.
- Unrelated test coverage work.

## 2) Current Failure Analysis

### Observed CI evidence (run #22520419499)
- `main_seen_once=0` — monitor never detected the app process
- `sample_rows: 0` — zero telemetry data rows collected
- Monitor ran for 48 seconds (timestamps 1772280813→1772280861)
- Events log: only `monitor_started` and `monitor_stopped` — no process detection events

### Root cause
The telemetry preflight (added in commit 919d357) attempts `am start` on the
app package **before** the APK is installed on the emulator. The workflow
sequence was:

1. Build APK (file exists on disk but not installed on emulator)
2. Start telemetry monitor (background)
3. **Preflight `am start`** → fails silently because package is not installed
4. Wait 45s for CSV data rows → times out
5. `exit 1` kills the step **before `run-maestro-gating.sh` runs**
6. Maestro never executes; app never launches on emulator
7. Monitor produces 0 samples

The `run-maestro-gating.sh` script (called at step 5 in the intended flow)
handles APK installation, app configuration, and Maestro execution — but
the premature `exit 1` prevents it from ever running.

### Contributing factor: PID resolution robustness
The monitor uses `pidof` as primary PID resolution and `/proc` cmdline scan
as fallback. Neither `ps -A` grep nor `dumpsys` is tried. On some emulator
images, `pidof` may return empty even when the process is running.

## 3) Design Constraints

- Deterministic telemetry paths under `ci-artifacts/telemetry/android`.
- No implicit working-directory assumptions.
- No silent fallback when telemetry is truly missing.
- Fail fast on genuine missing telemetry with actionable diagnostics.
- Preflight must be non-fatal: if priming fails, Maestro must still run.
- APK must be installed before any `am start` attempt.

## 4) Implementation Plan

- **Workflow fix** (`android.yaml`):
  - Split preflight into a separate "Install APK and prime telemetry" step
  - Install APK on emulator *before* attempting app launch
  - Use `am start -W` for synchronous launch confirmation
  - Make telemetry priming non-fatal (warning, not error) so Maestro always runs
  - Keep Maestro step clean (no preflight logic)

- **Monitor hardening** (`monitor_android.sh`):
  - Add `ps -A` grep as intermediate PID resolution fallback
  - Preserve existing `pidof` + `/proc` cmdline scan fallbacks

- **Diagnostics** (preserved from prior commit):
  - Dedicated telemetry input diagnostics step
  - Explicit `TELEMETRY_INPUT_CSVS` for deterministic summary input
  - Rich gate failure output with metadata.json dump

## 5) Test Strategy

- Validate workflow YAML correctness via grep-based workflow test
- Validate monitor shell syntax with `bash -n`
- Run existing telemetryGateWorkflow.test.ts
- Verify lint, build, and test suite pass

## 6) Risk Register

- Emulator startup timing: mitigated by dedicated boot-wait step (existing)
- APK install race: mitigated by explicit install-and-verify before priming
- PID resolution: mitigated by three-method fallback chain (pidof → ps -A → /proc)
- Preflight app crash: mitigated by non-fatal priming (warning, not exit)
- Maestro force-stop/clear: expected; monitor captures both primed and Maestro sessions

## 7) Completion Criteria

- [ ] android-maestro workflow passes in CI
- [ ] metrics.csv contains >= 2 data rows
- [ ] metadata.json shows `main_seen_once: 1` and `sample_rows >= 2`
- [ ] Telemetry gate passes
- [ ] All Android jobs green
