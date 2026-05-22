# Proof-of-Work Specification

## Why this exists

A verdict in `summary.json` is only worth what the artifacts back up. A prose claim like "the soak passed and the app feels snappy" is, on its own, indistinguishable from a fabrication. This spec defines the minimum machine-checkable evidence that any agent must produce. A reviewer is entitled - and expected - to reject a run that does not satisfy these checks.

## Directory layout

Every run lands in `docs/plans/performance/iteration2/runs/<runId>/`. `<runId>` is a UUIDv4 chosen at start. The directory contains:

```
runs/<runId>/
  preflight.json
  device-info.json
  logcat.txt
  logcat.errors.ndjson         # filtered, one row per error event
  screen.mp4                   # rotated if > 10 min; screen.001.mp4, screen.002.mp4 ...
  steps.ndjson                 # one row per meaningful action
  oracles/
    rest-snapshots/<step-id>.json
    state-refs/<step-id>.json
    c64scope/<step-id>.{json,wav,png}
    screenshots/<step-id>.png
  safety/
    safety-mode-trail.ndjson   # one row per effective-preset change
    c64u-reachability.ndjson   # one row per probe
  timings/
    tap-to-feedback.csv
    page-nav.csv
    diagnostics-open.csv
    saved-device-switch.csv
  audit/
    <auditor-id>.json          # written by auditor agents, optional
  summary.json
```

Files that are not needed for a given run are simply absent (e.g. `c64scope` artifacts are absent when no playback scenario was signal-sensitive).

## File schemas

All schemas are described in JSON-typed prose. Agents must not embellish.

### `preflight.json`

```json
{
  "runId": "uuid",
  "startedAt": "ISO 8601",
  "pixel4Serial": "9B0...",
  "u64": { "probe": "ok|fail", "latencyMs": 27, "raw": "..." },
  "c64u": { "probe": "ok|fail", "latencyMs": 161, "raw": "..." },
  "appVersion": "1.x.y (build n)",
  "autoModeAvailableInUi": true,
  "storedSafetyMode": "AUTO",
  "savedDevices": [
    { "id": "...", "host": "u64", "verifiedProduct": "U64E", "lastResolvedAddress": "192.168.1.13" },
    { "id": "...", "host": "c64u", "verifiedProduct": "C64U", "lastResolvedAddress": "192.168.1.167" }
  ]
}
```

If `c64u.probe == "fail"`, the run is allowed to proceed with `u64`-only scenarios, but `summary.json.verdict` cannot be `pass`.

### `device-info.json`

Snapshot of `c64api` `/v1/info` for `u64` and `c64u`, taken at run start. One JSON object with `u64` and `c64u` keys.

### `logcat.txt`

Raw logcat, filtered to the C64 Commander package. Time window must cover from preflight through to run end.

### `logcat.errors.ndjson`

One row per `E` or `F` level row tagged with the package, plus `am_crash` and `am_anr` markers. Each row:

```json
{ "ts": "ISO 8601", "level": "E|F", "tag": "...", "message": "...", "expected": false }
```

`expected: true` rows are produced by scenarios that deliberately trigger an error (e.g. bad hostname). The agent justifies each `expected: true` row in `summary.json`.

### `steps.ndjson`

One row per meaningful UI action. Schema:

```json
{
  "stepId": "S1-bad-hostname-save",
  "scenarioId": "S1",
  "deviceLeg": "U64|C64U",
  "ctaShape": "TEXT_INPUT_TYPE_AND_BLUR",
  "page": "/settings",
  "ts": "ISO 8601",
  "preconditions": ["..."],
  "action": "type 'not-a-host', then blur",
  "primaryOracle": "saved-devices store delta",
  "fallbackOracle": "UI error toast (expected)",
  "screenshot": "oracles/screenshots/S1-bad-hostname-save.png",
  "expectedOutcome": "error toast visible, store unchanged",
  "actualOutcome": "error toast visible, store unchanged",
  "expected": true,
  "passed": true,
  "durationMs": 412
}
```

The `expected` field marks intentional negative-path actions. `passed` is the agent's claim. Reviewers check it against the captured oracle.

### `oracles/rest-snapshots/<step-id>.json`

Snapshot of any REST endpoint whose change is the primary oracle for the step. Captured pre and post when both matter.

### `oracles/state-refs/<step-id>.json`

`c64bridge` state-ref output when the oracle calls for it. Reserved for gap-fill per `agentic-safety-policy.md`.

### `oracles/c64scope/<step-id>.{json,wav,png}`

`c64scope` evidence for signal-sensitive steps. Each step contributes a session-step recorded via `scope_session.record_step`.

### `oracles/screenshots/<step-id>.png`

A single screenshot, captured after the action. Larger states (mid-drag, etc.) get one screenshot per state with a numeric suffix.

### `safety/safety-mode-trail.ndjson`

One row per effective-preset change. Schema:

```json
{
  "ts": "ISO 8601",
  "storedMode": "AUTO",
  "effectiveMode": "CONSERVATIVE",
  "resolvedPreset": "CONSERVATIVE",
  "provisional": false,
  "reason": "auto-c64u",
  "activeDeviceId": "...",
  "activeProduct": "C64U",
  "source": "diagnostics-log"
}
```

For a `pass` verdict, the trail must show:

- exactly one `CONSERVATIVE` row at the start of every `c64u` leg,
- exactly one `BALANCED` row at the start of every `u64` leg,
- no rows tagged `provisional: true` after the first device verification of the run.

### `safety/c64u-reachability.ndjson`

One row per direct REST probe of `c64u`. The agent probes every 30 s during `c64u` legs (see agent prompt). Schema:

```json
{ "ts": "ISO 8601", "probe": "ok|fail", "latencyMs": 33, "raw": "..." }
```

For `pass`, every row during `c64u` legs is `ok`, and the last probe of the run (taken at end-of-soak) is also `ok`.

### `timings/*.csv`

One CSV per signal in the responsiveness budget. Header includes `stepId,deviceLeg,observedMs`. Aggregates (p50/p95) are computed by the reviewer or auditor, not by the actor; the agent only emits raw samples.

### `summary.json`

The final verdict and the index into everything else.

```json
{
  "runId": "uuid",
  "startedAt": "ISO 8601",
  "endedAt": "ISO 8601",
  "verdict": "pass|fail|inconclusive",
  "verdictReason": "short text",
  "scenarios": [
    { "id": "N1", "leg": "U64", "verdict": "pass", "stepCount": 41 },
    { "id": "N1", "leg": "C64U", "verdict": "pass", "stepCount": 41 },
    ...
  ],
  "ctaCoverage": {
    "total": 56,
    "exercised": 56,
    "missing": []
  },
  "responsiveness": {
    "tapToFeedback": { "p50Ms": 110, "p95Ms": 280, "budgetMet": true },
    "pageNav": { "p50Ms": 180, "p95Ms": 420, "budgetMet": true },
    "diagnosticsOpen": { "p50Ms": 220, "p95Ms": 380, "budgetMet": true },
    "savedDeviceSwitch": { "p50Ms": 210, "p95Ms": 470, "budgetMet": true }
  },
  "errors": {
    "totalUnexpected": 0,
    "totalExpected": 1,
    "expectedRows": ["S1-bad-hostname-save"]
  },
  "c64uReachability": {
    "preflight": "ok",
    "endOfRun": "ok",
    "lostMidRun": false
  },
  "safetyTrail": {
    "u64Legs": 7,
    "c64uLegs": 7,
    "balancedRows": 7,
    "conservativeRows": 7,
    "provisionalRowsAfterFirstVerification": 0
  },
  "specConcerns": [],
  "knownBugs": [
    {
      "title": "Slider tick mark misaligned on Audio Mixer",
      "severity": "cosmetic",
      "scenarioId": "C2",
      "steps": ["..."],
      "screenshot": "oracles/screenshots/C2-mixer-1.png"
    }
  ]
}
```

## Acceptance gates a reviewer runs against the artifact set

The reviewer asserts each of the following. Every "no" is a rejection.

1. `preflight.json` exists, both probes are `ok` (or `c64u.probe == fail` is justified and reflected in `summary.json.verdict != pass`).
2. `steps.ndjson` has at least one row for every shape in `cta-inventory.md`. Missing shapes are listed in `summary.json.ctaCoverage.missing`.
3. Every row in `steps.ndjson` references an existing screenshot path and (when applicable) an existing REST/state-ref path.
4. `safety/safety-mode-trail.ndjson` matches the device-switch order. Concretely: every `u64`-leg start has a preceding `BALANCED` row; every `c64u`-leg start has a preceding `CONSERVATIVE` row.
5. `safety/c64u-reachability.ndjson` shows no `fail` row during `c64u` legs, and the final row is `ok`.
6. `logcat.errors.ndjson` has zero rows with `expected: false` (unexpected errors).
7. `timings/*.csv` p50 and p95 are within the budget in `plan.md` for every signal that applies.
8. `summary.json.verdict` matches the artifact evidence. A `pass` verdict in `summary.json` against artifacts that show failures is itself grounds for rejection.

If the artifact set fails any gate, the run is `fail` or `inconclusive` regardless of what `summary.json` claims.

## What is *not* required

- An agent need not write a long prose narrative. The artifact set is the report.
- An agent need not file a PR. Bug filings come from a separate triage step.
- An agent need not run unit tests. Phase D is product validation; unit and integration coverage are run separately during Phase A.
