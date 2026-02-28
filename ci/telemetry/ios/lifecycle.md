# iOS Telemetry Monitor Lifecycle — Group-4 Fix

## Problem

The iOS telemetry monitor (`ci/telemetry/ios/monitor_ios.sh`) emits exit code 3
whenever the host app process disappears at any time during the monitor's lifetime.
In CI, the monitor continues running after Maestro flows complete. When the app
terminates during teardown, the monitor misclassifies this as an unexpected crash.

## Lifecycle Signaling

Flag files in the telemetry output directory signal flow state:

- `flow-active.flag` — created before Maestro execution begins.
- `flow-complete.flag` — created after Maestro finishes (pass or fail).
  `flow-active.flag` is removed at the same time.

The monitor checks these flags at the moment a process disappearance is detected.

## State Machine

```
STATE_PRE_LAUNCH      → App PID not yet detected.
STATE_ACTIVE_FLOW     → flow-active.flag exists, flow-complete.flag does not.
                        PID disappearance → exit 3.
STATE_FLOW_COMPLETED  → flow-complete.flag exists.
                        PID disappearance is expected teardown → exit 0.
STATE_SHUTDOWN_ALLOWED → SIGTERM received, loop exits.
STATE_TERMINATED      → Monitor process has exited.
```

## Invariants

```
exit_code == 3  ⟺  (main_seen_once ∧ main_disappeared_during_flow)
exit_code == 0  ⟺  ¬main_disappeared_during_flow
```
