# PLANS.md — iOS Telemetry Monitor Lifecycle Fix (Group-4)

## Problem Statement

The iOS telemetry monitor (`ci/telemetry/ios/monitor_ios.sh`) emits exit code 3
whenever the host app process disappears at any time during the monitor's lifetime.
In CI, the monitor continues running after Maestro flows complete. When the app
terminates during teardown (expected behavior), the monitor misclassifies this as
an unexpected crash and emits exit code 3. The release gate then fails.

## Observed Failure Sequence

1. Maestro flows execute successfully against iOS simulator.
2. Maestro step completes; CI proceeds to "Stop iOS telemetry monitor" step.
3. Between Maestro completion and monitor SIGTERM, app process terminates (normal
   iOS simulator teardown).
4. Monitor sampling loop detects `app_pid` is gone → sets `main_disappeared=1`.
5. Monitor receives SIGTERM → exits loop → checks `main_disappeared` → exits 3.
6. Gate step reads exit code 3 on release/tag ref → hard failure.

## Current Monitor Lifecycle Model

```
Monitor starts → sampling loop → [app appears] → [app disappears at any time] → main_disappeared=1
→ SIGTERM → exit check: if main_seen_once && main_disappeared → exit 3
```

The model has no concept of "when" the disappearance occurred relative to Maestro
flow execution. All disappearances are treated equally.

## Corrected Lifecycle Model

Introduce file-based lifecycle signaling between the CI workflow and the monitor:

```
flow-active.flag    → Maestro is executing flows
flow-complete.flag  → Maestro has finished (success or failure)
```

Monitor checks flag state at the moment of disappearance detection:

```
If flow-active.flag exists AND flow-complete.flag does not exist:
    → Crash during active flow → main_disappeared_during_flow=1
Else:
    → Expected teardown → log event, no failure flag
```

## Formal Invariant Definition

```
INVARIANT: exit_code == 3  ⟺  (main_seen_once ∧ main_disappeared_during_flow)
INVARIANT: exit_code == 0  ⟺  ¬main_disappeared_during_flow
```

Where `main_disappeared_during_flow` is true only if the app process disappeared
while `flow-active.flag` existed and `flow-complete.flag` did not exist.

## State Machine Definition

```
STATE_PRE_LAUNCH
    → App PID not yet detected.
    → flow-active.flag may or may not exist.
    → No exit code implications.

STATE_ACTIVE_FLOW
    → flow-active.flag exists, flow-complete.flag does not.
    → App PID must remain stable.
    → PID disappearance → main_disappeared_during_flow=1 → exit 3.

STATE_FLOW_COMPLETED
    → flow-complete.flag exists.
    → App PID disappearance is expected teardown.
    → No failure emitted.

STATE_SHUTDOWN_ALLOWED
    → SIGTERM received, loop exits.
    → Exit code determined by main_disappeared_during_flow.

STATE_TERMINATED
    → Monitor process has exited.
```

Transitions:

```
PRE_LAUNCH → ACTIVE_FLOW          : flow-active.flag created by CI
ACTIVE_FLOW → FLOW_COMPLETED      : flow-complete.flag created by CI
FLOW_COMPLETED → SHUTDOWN_ALLOWED : SIGTERM received
SHUTDOWN_ALLOWED → TERMINATED     : exit 0 or exit 3
```

## Implementation Plan

- [x] 1. Modify `ci/telemetry/ios/monitor_ios.sh`:
   - Add `FLOW_LIFECYCLE_DIR` env var (defaults to `$OUT_DIR`).
   - Define `FLOW_ACTIVE_FLAG` and `FLOW_COMPLETE_FLAG` paths.
   - Add `main_disappeared_during_flow=0` tracking variable.
   - In disappearance detection: check flag files to determine lifecycle state.
   - At exit: use `main_disappeared_during_flow` instead of `main_disappeared`.
   - Update `metadata.json` to include new field.

- [x] 2. Modify `.github/workflows/ios.yaml`:
   - Before Maestro execution: `touch flow-active.flag`.
   - After Maestro completes (regardless of exit status): remove
     `flow-active.flag`, create `flow-complete.flag`.
   - Preserve Maestro exit status propagation.

- [x] 3. Update `ci/telemetry/README.md` failure policy section.

- [x] 4. Add shell test harness: `tests/unit/ci/monitor_ios_lifecycle.test.sh`.

- [x] 5. Add vitest integration: `tests/unit/ci/monitorIosLifecycle.test.ts`.

- [x] 6. Update vitest workflow gate test for new flag expectations.

## Test Plan

1. **Shell test harness** (`tests/unit/ci/monitor_ios_lifecycle.test.sh`):
   - Simulate: PID stable during flow → clean exit (0).
   - Simulate: PID disappearance during active flow → exit 3.
   - Simulate: PID disappearance after flow-complete → exit 0.
   - Simulate: PID never seen → exit 0.

2. **Vitest workflow validation** (`tests/unit/ci/telemetryGateWorkflow.test.ts`):
   - Verify `flow-active.flag` creation before Maestro.
   - Verify `flow-complete.flag` creation after Maestro.
   - Verify existing gate assertions still pass.

3. **Vitest lifecycle validation** (`tests/unit/ci/monitorIosLifecycle.test.ts`):
   - Verify monitor script contains flag-based lifecycle logic.
   - Verify `main_disappeared_during_flow` variable usage.
   - Verify metadata.json schema includes new field.

## Risk Register

| Risk | Mitigation |
|------|------------|
| Flag file not created before Maestro | Flag creation is inline, synchronous, before Maestro cmd |
| Flag file race between monitor sample and flag creation | Atomic `touch`; monitor checks at disappearance time only |
| Maestro fails before creating flow-complete.flag | Explicit capture of Maestro exit status with flag transition before re-exit |
| Monitor SIGTERM arrives before flag check | Flag check is in sampling loop, not in trap handler |
| Backwards incompatibility of metadata.json | New field added alongside existing fields; no removal |

## Verification Criteria

- [x] No Group-4 failures from expected teardown termination.
- [x] Legitimate app crash during active flow still exits 3.
- [x] App termination after flow-complete does not exit 3.
- [x] metadata.json backwards compatible.
- [x] Existing telemetry gate workflow tests pass.
- [x] Shell test harness validates all lifecycle transitions.
- [x] No other telemetry groups regress.
