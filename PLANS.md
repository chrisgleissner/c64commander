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

Expected flow:
1. `Start Android telemetry monitor` starts `ci/telemetry/android/monitor_android.sh` with output at `ci-artifacts/telemetry/android/metrics.csv`.
2. Maestro runs (`scripts/run-maestro-gating.sh`).
3. Monitor is stopped.
4. Summary step reads telemetry under `ci-artifacts/telemetry/**/metrics.csv`.
5. Gate step enforces header + row count + monitor exit code.

Observed failure:
- `telemetry summary: no telemetry samples in inputs`
- `telemetry gate failed: expected multiple data rows, found 0`

Most likely causes in this pipeline:
- Monitor started successfully but app process never sampled during Maestro window (header-only CSV).
- Gate lacks preflight diagnostics and hard evidence when rows are zero.
- Summary step does not print per-input row diagnostics when no records exist.
- No explicit warm-up to guarantee app process visibility soon after monitor startup.

## 3) Design Constraints

- Deterministic telemetry paths under `ci-artifacts/telemetry/android`.
- No implicit working-directory assumptions.
- No silent fallback when telemetry is truly missing.
- Fail fast on genuine missing telemetry with actionable diagnostics.
- Emit debug diagnostics (file list, row counts, monitor logs/events tail) before gate failure.

## 4) Implementation Plan

- Workflow hardening (`android.yaml`):
  - Add telemetry preflight validation step after monitor start to launch app and wait for first telemetry rows.
  - Add explicit telemetry diagnostics step (ls/wc/head/tail) before summary and gate.
  - Keep gate strict but enrich failures with monitor/events diagnostics.
  - Ensure summary uses deterministic explicit input env `TELEMETRY_INPUT_CSVS`.

- Monitor hardening (`monitor_android.sh`):
  - Track and persist sample row count in metadata for gate debugging.
  - Keep deterministic CSV schema and output path.

- Summary hardening (`summarize_metrics.py`):
  - On empty records, print input CSV row counts and file names before exiting.
  - Keep failure semantics (still fails for truly empty samples).

- Validation checks:
  - Ensure monitor PID + child PID + exitcode files are present where expected.
  - Ensure metrics CSV has header and >1 data row before strict gate pass.

## 5) Test Strategy

- Local script-level validation:
  - Run Python summary with synthetic telemetry CSV and verify summary output.
  - Run summary with header-only CSV and verify enhanced diagnostics output.
- CI YAML validation by dry inspection and targeted grep for paths/steps.
- Regression protection:
  - Keep strict gate thresholds; improve only determinism and diagnostics.

## 6) Risk Register

- Parallel/overlapping monitor runs overwriting telemetry files.
- Emulator startup timing race before app process appears.
- Path differences across runners (Linux/macOS) if relative paths drift.
- Artifact upload missing key files if paths change.

Mitigations:
- Deterministic fixed paths.
- Early preflight app launch + telemetry row wait.
- Explicit per-file diagnostics before gate.
- Keep `if: always()` artifact upload and include telemetry dir recursively.
