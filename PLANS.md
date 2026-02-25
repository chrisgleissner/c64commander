# iOS CI Telemetry Reliability Plan

## 1) Observations about current telemetry gate failure
- The iOS telemetry gate fails release flows when monitor exit code is `3`, emitting: `app process disappearance/restart detected on release flow`.
- `events.log` is referenced in failure messaging but needs deterministic failure-path artifact exposure.
- Telemetry monitor and per-group artifact upload already exist, but explicit failure-only diagnostics packaging should be strengthened to cover telemetry-gate and earlier-step failures.

## 2) Hypothesized root causes
- **Simulator memory pressure (Jetsam):** app process can be terminated/restarted under constrained CI runner conditions.
- **Simulator reset during archive/test transition:** simulator lifecycle disruptions may look like unexpected process disappearance.
- **App crash in release configuration:** true crash/regression should still fail the gate.
- **Telemetry false positive during expected lifecycle transition:** transient simulator instability around boot or runtime readiness can trigger monitor exit code `3`.

## 3) Artifact exposure strategy
- Add explicit `if: failure()` upload step(s) in iOS workflow for telemetry failure diagnostics.
- Ensure failure artifacts include:
  - `artifacts/ios/_infra/telemetry/events.log`
  - telemetry monitor logs/exit code
  - xcodebuild logs (where relevant)
  - simulator diagnostics (if available)
- Keep per-group `if: always()` artifact uploads intact and add dedicated failure-focused diagnostics to guarantee post-failure visibility.

## 4) Resilience hardening strategy
- Keep strict telemetry invariants (no gate suppression).
- Harden simulator boot/readiness handling with deterministic retry around `simctl bootstatus` before failing.
- Collect simulator diagnostics on failure to aid root-cause triage without changing pass/fail semantics.

## 5) Validation plan
- Add/update unit assertions for workflow policy in `tests/unit/ci/telemetryGateWorkflow.test.ts`.
- Run targeted unit test for workflow assertions.
- Run lint and build checks relevant to modified files.

## 6) Risk assessment
- **Risk:** extra diagnostics steps can add small runtime overhead.
  - **Mitigation:** run diagnostics and failure uploads only under `if: failure()`.
- **Risk:** larger artifact payloads.
  - **Mitigation:** scope uploads to infra logs and telemetry paths only.
- **Risk:** masking real failures.
  - **Mitigation:** preserve non-zero telemetry gate exit behavior and re-emit failures unchanged.
