# iOS CI Startup Delay + Maestro False-Negative Investigation Plan

## Scope

Investigate and fix severe iOS startup delay and premature Maestro assertion failure in `ios-secure-storage-persist` with deterministic, structured evidence.

## Authoritative Goals

1. Emit deterministic timing traces with millisecond precision for each iOS Maestro flow.
2. Capture raw streams required for root-cause analysis:
   - Maestro raw debug output
   - iOS unified log stream
   - simulator diagnostics
   - app debug payloads
   - accessibility snapshot(s)
3. Diagnose and fix:
   - startup delay bottleneck
   - false `Home` assertion in `ios-secure-storage-persist`
4. Keep iOS-only scope; no Android behavior changes.

## Required Event Timeline

Per flow, emit chronologically ordered events in:

- `artifacts/ios/<flow>/timing-trace.json`

Required event types:

- `simulator.boot.start`
- `simulator.boot.ready`
- `app.install.start`
- `app.install.end`
- `maestro.flow.start`
- `maestro.command.first_sent`
- `maestro.lookup.first`
- `maestro.assertion.evaluated`
- `app.process.first_spawn`
- `app.uiwindow.first_created`
- `app.uiwindow.first_visible`
- `app.frame.first_rendered`
- `app.accessibility.first_available`

## Hypotheses Matrix (A–J)

| ID | Hypothesis | Status | Evidence | Notes |
| --- | --- | --- | --- | --- |
| A | Simulator boot delay | IN_PROGRESS | pending instrumentation | Capture boot start/ready in workflow + trace |
| B | App cold start regression | IN_PROGRESS | pending instrumentation | App startup markers via native logs |
| C | Metal/GPU scaler driver issue | IN_PROGRESS | pending instrumentation | Capture scaler warnings + correlate with startup lag |
| D | Accessibility tree delayed | IN_PROGRESS | pending instrumentation | Capture hierarchy snapshots and first available timestamp |
| E | Maestro timeout too short | CONFIRMED | static flow analysis | `ios-open-play-add-items` waits `Home` with `TIMEOUT=30000` and 3 retries (~90s + overhead), consistent with ~1m48 failure |
| F | Maestro/app sync incorrect | IN_PROGRESS | pending instrumentation | Compare `maestro.flow.start` vs app readiness markers |
| G | Secure storage blocks main thread | IN_PROGRESS | pending instrumentation | Compare first launch vs relaunch timing in secure-storage flow |
| H | CI runner performance regression | IN_PROGRESS | pending instrumentation | Compare stage durations from traces |
| I | Video recording interference | IN_PROGRESS | pending instrumentation | Capture with explicit video start marker and correlate |
| J | Capacitor plugin blocks launch | IN_PROGRESS | pending instrumentation | Capture native startup sequence markers |

## Implementation Tasks

1. Add iOS CI-safe timing event collector in `scripts/ci/ios-maestro-run-flow.sh`.
2. Emit app startup lifecycle markers from iOS native code.
3. Capture raw Maestro debug logs and parse first command/lookup/assertion timestamps.
4. Capture iOS unified log stream per flow and extract app process/UI events.
5. Capture accessibility snapshots (at least at failure and post-flow).
6. Fix `ios-secure-storage-persist` synchronization based on evidence (not blind timeout growth).
7. Preserve existing artifact paths; add stable `timing-trace.json` per flow.
8. Validate lint/tests/build/coverage.

## Evidence Contract

Each `timing-trace.json` must be:

- deterministic ordering
- millisecond timestamps
- stable schema
- machine-readable and CI-safe

Schema:

```json
{
  "flow": "ios-secure-storage-persist",
  "group": "group-3",
  "events": [
    {
      "tsMs": 0,
      "type": "maestro.flow.start",
      "source": "maestro",
      "details": {}
    }
  ]
}
```

## Progress Log

- 2026-02-16: Replaced prior optimization-only plan with this incident plan.
- 2026-02-16: Hypothesis E marked CONFIRMED by deterministic flow timeout analysis.
- 2026-02-16: Instrumentation and fixes in progress.

## Exit Criteria

- `ios-secure-storage-persist` passes reliably in CI.
- `timing-trace.json` is present and valid for each flow.
- Hypotheses matrix updated to CONFIRMED/REJECTED with evidence.
- CI pipeline green with artifacts containing required raw streams.
