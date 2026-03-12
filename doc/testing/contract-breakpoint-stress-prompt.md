# Contract Breakpoint Stress Prompt

## Purpose

This prompt is for an implementation LLM that must extend the existing contract harness under `tests/contract` to isolate the request-rate and concurrency breakpoint that makes the C64U control subsystem become unresponsive during repeated SID volume mutations.

This is an extension of the current `STRESS` path, not a second harness.

## Read First

Read these files before changing code:

1. `tests/contract/README.md`
2. `tests/contract/run.ts`
3. `tests/contract/lib/config.ts`
4. `tests/contract/config.schema.json`
5. `tests/contract/lib/health.ts`
6. `tests/contract/lib/restClient.ts`
7. `tests/contract/lib/concurrency.ts`
8. `tests/contract/lib/logging.ts`
9. `tests/contract/scenarios/rest/index.ts`
10. `tests/contract/mockRestServer.ts`
11. `tests/contract/compare.ts`
12. `doc/c64/c64u-config.yaml`

Do not start implementation until you understand how those pieces fit together.

## Current Harness Facts You Must Respect

The current harness is simpler than the draft request implies. Design against the real code, not the imagined architecture.

1. `run.ts` is the single runner. It creates the run directory, the `logs.jsonl` stream, the REST client, the health monitor, and every artifact.
2. Scenario groups currently run sequentially. Concurrency only exists inside specific scenario helpers such as `runConcurrentRequests`.
3. REST requests are not centrally trace-logged today. Most scenarios log only status, latency, and correlation id after the request completes.
4. `STRESS` mode currently changes REST behavior by wrapping requests in `createRestRequest`, which adds retries with random jitter. That is not acceptable for breakpoint forensics unless made deterministic or disabled for the breakpoint profile.
5. Health monitoring is REST-only today. `HealthMonitor` tracks consecutive probe failures and elapsed time since last success. There is no existing ping, FTP, or Telnet health subsystem.
6. The runner always calls `rebootAndRecover` in `finally`. That will hide the real failure mode for a dead device and can waste the forensic window. Breakpoint failure handling must make teardown conditional.
7. Config shape is defined twice: runtime validation in `tests/contract/lib/config.ts` and a checked-in JSON schema in `tests/contract/config.schema.json`. Keep them aligned.
8. Existing artifact generation is built around one run directory containing top-level files such as `logs.jsonl`, `latency-stats.json`, `concurrency.json`, and `conflicts.json`.
9. `compare.ts` only compares latency, cooldowns, and concurrency. New breakpoint artifacts must not break that tool.

## Device-Specific Context

The failure under investigation is a SID volume mutation storm, not a generic REST fuzz pass.

Use the real Audio Mixer item names already present in the repo:

- `Audio Mixer` / `Vol Socket 1`
- `Audio Mixer` / `Vol Socket 2`
- `Audio Mixer` / `Vol UltiSid 1`
- `Audio Mixer` / `Vol UltiSid 2`

These are logical mutation targets backed by the existing config REST routes. Do not invent new device endpoints.

## Objective

Extend the existing `STRESS` execution path so a focused breakpoint profile can:

1. run a deterministic series of stress stages
2. ramp request delay from slow to fast
3. ramp REST concurrency from low to high
4. cycle across a configured SID volume target set
5. capture a complete request trace for the breakpoint run
6. stop quickly when the device becomes unreachable
7. preserve forensic artifacts without auto-recovering the device on failure

## Non-Negotiable Constraints

1. Do not add a second runner or a second logging system.
2. Reuse `run.ts`, `RestClient`, `HealthMonitor`, `Semaphore`, and the existing artifact directory layout.
3. Extend the config model instead of adding ad hoc CLI flags.
4. Keep `logs.jsonl`, `latency-stats.json`, `concurrency.json`, and other existing files valid.
5. Do not duplicate request execution logic inside a new breakpoint-only client.
6. Do not spread full trace logging across scenario bodies. Instrument the shared REST request path instead.
7. Do not keep random retry jitter for breakpoint stages. Exact failure order matters more than masking transient errors.
8. Do not run the entire existing STRESS matrix before the breakpoint profile. When the breakpoint profile is enabled, the run must stay focused on that investigation.

## Required Design

### 1. Config Extension

Add an optional top-level `stressBreakpoint` block to the contract config.

It should be parsed in `tests/contract/lib/config.ts` and described in `tests/contract/config.schema.json`.

Use a shape close to this:

```json
{
  "stressBreakpoint": {
    "scenarioId": "rest.breakpoint.sid-volume",
    "rateRampMs": [2000, 1000, 500, 250, 125, 60, 30, 15],
    "concurrencyRamp": [1, 2, 3, 4, 5],
    "stageDurationMs": 15000,
    "failureDetectionTimeoutMs": 4000,
    "tailRequestCount": 100,
    "targets": [
      { "category": "Audio Mixer", "item": "Vol Socket 1" },
      { "category": "Audio Mixer", "item": "Vol Socket 2" },
      { "category": "Audio Mixer", "item": "Vol UltiSid 1" },
      { "category": "Audio Mixer", "item": "Vol UltiSid 2" }
    ]
  }
}
```

Rules:

1. `stressBreakpoint` only applies when `mode` is `STRESS`.
2. Reuse `concurrency.restMaxInFlight` as the hard cap instead of introducing another top-level concurrency limit.
3. Keep the target set as logical config targets, not synthetic endpoint names.

### 2. Execution Model

Implement breakpoint execution as a focused branch inside the existing runner.

Recommended model:

1. `run.ts` detects `mode === "STRESS"` plus `stressBreakpoint`.
2. The runner executes a deterministic stage plan instead of the normal REST/FTP/mixed scenario sweep.
3. One invocation creates one run directory.
4. All stages write into the same `logs.jsonl` so the full lead-up to failure is preserved in one trace.

Stage ordering must be deterministic. Use:

1. `rateRampMs` outer loop from slowest to fastest
2. `concurrencyRamp` inner loop from lowest to highest
3. target selection cycling in a stable sequence unless randomness is explicitly seeded and logged

Do not create one run directory per stage.

### 3. Scenario

Add a REST scenario for SID volume breakpoint stress.

Suggested id:

- `rest.breakpoint.sid-volume`

Requirements:

1. It must use the existing config REST endpoints, preferably `PUT /v1/configs/{category}/{item}` so every mutation is attributable to one logical target.
2. It must generate valid volume values from the configured item option list.
3. It must cycle through the configured target set while a stage is active.
4. It must respect the shared concurrency limiter instead of spawning uncontrolled promises.

If you need helper extraction, keep it under `tests/contract` and reuse existing primitives. A small helper module is acceptable if it removes duplication.

### 4. Shared Request Trace Capture

Every breakpoint REST request must be logged exactly once through the shared request path.

Implement this by extending `createRestRequest`, `RestClient.request`, or a thin shared wrapper used by all breakpoint calls.

Do not hand-build duplicate logging inside the scenario loop.

Each trace entry must contain at least:

- `timestamp`
- `runId`
- `stageId`
- `requestSequence`
- `attempt`
- `clientId`
- `method`
- `url`
- `headers`
- `params`
- `payload`
- `responseStatus`
- `responseHeaders`
- `responseBody`
- `latencyMs`
- `concurrencyLevel`
- `rateDelayMs`
- `target.category`
- `target.item`

Use `logs.jsonl` for the canonical trace. A new `kind` such as `rest-trace` is fine.

No truncation for this breakpoint profile. If auth is enabled, document clearly that artifacts contain secrets.

### 5. Retry and Backoff Policy

The current STRESS retry path uses random jitter. That makes breakpoint traces harder to reason about.

For `stressBreakpoint`:

1. default to zero retries, or
2. use a fully deterministic retry policy that is explicitly logged per attempt

If retries remain enabled, the trace must record the exact attempt number and wait applied before the next attempt.

### 6. Health and Failure Detection

Extend the existing health abstraction instead of adding scattered checks in the scenario.

Minimum requirement:

1. REST timeout, transport failure, or repeated health probe failure must abort the breakpoint run quickly.

Preferred extension:

1. allow the health monitor to support multiple probe kinds later
2. keep REST as the required probe
3. only add ping if you can do it through the same abstraction and without platform-specific shell hacks leaking into the runner

When failure is detected:

1. stop scheduling new requests immediately
2. allow in-flight requests to settle or time out in a controlled way
3. flush logs
4. write failure artifacts
5. do not attempt automatic recovery before artifacts are preserved

### 7. Teardown Behavior

The existing unconditional `rebootAndRecover` call is wrong for this failure mode.

Change teardown behavior so that:

1. normal SAFE and normal STRESS runs keep their current recovery behavior
2. breakpoint runs that fail health checks skip auto reboot/recovery
3. breakpoint runs that complete cleanly may keep normal recovery behavior

The failure case must leave the device state untouched after artifact preservation so manual investigation or power cycling can happen.

### 8. Artifacts

Keep the existing files and formats intact.

Add only the breakpoint-specific artifacts needed for forensics, for example:

- `breakpoint-stages.json`
- `failure-summary.json`
- `request-trace-tail.json`

Requirements:

1. `failure-summary.json` must describe the exact failing stage and first observed failure.
2. `request-trace-tail.json` must contain at least the last 100 traced requests before abort.
3. New artifacts should also be copied into `test-results/contract/latest/` if that is already done for the run.

`failure-summary.json` should include at least:

- `stageId`
- `rateDelayMs`
- `concurrency`
- `targets`
- `totalRequestsStarted`
- `totalRequestsCompleted`
- `lastSuccessfulRequestSequence`
- `firstFailedRequestSequence`
- `healthStatus`
- `abortReason`

### 9. Compare Tool

Do not break `tests/contract/compare.ts`.

Only extend it if you can do so without changing current outputs for normal runs. It is acceptable for the new breakpoint artifacts to be ignored by the compare tool.

## Testing Requirements

This implementation needs deterministic regression coverage.

Add tests for the new logic at the narrowest useful layers. At minimum cover:

1. config parsing for `stressBreakpoint`
2. stage-plan ordering and validation
3. trace logging shape and request sequence behavior
4. failure-summary generation
5. breakpoint abort behavior when health probes fail
6. teardown behavior proving auto-recovery is skipped after breakpoint failure

Prefer unit tests around extracted helpers plus small integration-style tests using the existing mock server infrastructure.

If needed, extend `tests/contract/mockRestServer.ts` so it can:

1. expose the SID volume items required by the scenario
2. fail after a deterministic request count or latency condition

Do not build a second mock framework.

## Suggested Implementation Order

1. align on the real harness architecture from the required reading
2. extend config parsing and checked-in schema together
3. add a deterministic stage planner
4. add shared breakpoint trace logging in the REST request path
5. add the focused SID volume breakpoint scenario
6. integrate failure handling and conditional teardown in `run.ts`
7. add artifact writers for stage summaries and failure summaries
8. extend mock support only as needed
9. add regression tests
10. run validation

## Validation

Before declaring completion, run the relevant checks for the changed code.

At minimum:

```bash
npm run test
npm run test:coverage
npx tsc -p tests/contract/tsconfig.json
```

If you add targeted tests for the contract harness, report exactly what you ran.

## Completion Criteria

The work is complete when all of the following are true:

1. `STRESS` plus `stressBreakpoint` executes a focused breakpoint run inside the existing harness.
2. request delay and concurrency ramp deterministically across stages.
3. SID volume targets cycle through the configured Audio Mixer items.
4. every breakpoint request is centrally trace-logged without scenario-level duplication.
5. breakpoint failure stops new scheduling quickly and writes forensic artifacts.
6. auto-recovery is skipped for breakpoint failure runs.
7. existing SAFE and non-breakpoint STRESS behavior remains intact.
8. regression tests cover the new branch points.

## Anti-Goals

Do not do any of the following:

1. create `run-breakpoint.ts`
2. create a breakpoint-only REST client
3. add a second JSONL log file when `logs.jsonl` can carry the trace
4. keep nondeterministic jitter in the breakpoint path
5. bury request trace formatting inside the scenario body
6. reboot the device automatically after the breakpoint profile has already determined it is dead
