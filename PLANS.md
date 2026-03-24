# C64U Failure Boundary Stress Plan

Status: IN_PROGRESS
Date: 2026-03-24
Classification: DOC_PLUS_CODE, CODE_CHANGE
Target device: c64u
Base config: tests/contract/config.stress.matrix.spike.json
Execution rule: all contract execution goes through ./build

## Objective

Identify the smallest reproducible stress boundary that transitions the C64 Ultimate from normal responses into a verified failure state, capture the full trace, and prove deterministic replay from a clean state.

## Safety Constraints

- Escalate gradually.
- After every escalation step, run a REST health probe and an independent curl probe.
- Stop escalation immediately after the first verified failure.
- Do not use destructive endpoints.
- Keep all runs deterministic and documented.

## Exit Criteria

- [ ] Build helper supports contract runs based on tests/contract/config.stress.matrix.spike.json.
- [ ] Baseline real-device contract run completes and records artifacts.
- [ ] Full trace captures REST request/response headers, body, and timing plus FTP command/response timing.
- [ ] A failure boundary is observed during controlled escalation.
- [ ] Independent verification with `curl http://c64u/v1/info` shows the same failure condition.
- [ ] Minimal reproducing trace is extracted.
- [ ] Replay reproduces the failure from a clean state.
- [ ] Replay succeeds at least twice with the same failure signature.

## Phase 1 - Plan Initialization

- [x] Replace PLANS.md with this execution plan.
- [ ] Add any harness capability needed to force contract runs to inherit the spike matrix config via ./build.

## Phase 2 - Baseline Validation

Command:

```bash
./build --test-contract --c64u-target real --c64u-host c64u --contract-config tests/contract/config.stress.matrix.spike.json
```

Expected evidence:

- Healthy device at start
- Contract artifacts under `test-results/contract/runs/RUN_ID`
- Baseline trace and latency data captured

## Phase 3 - Trace Hardening

Acceptance checks:

- trace.jsonl present
- replay/manifest.json present
- REST entries include method, URL, headers, body, latency
- FTP entries include command, response, session ID, latency

## Phase 4 - Controlled Escalation

Escalation ladder:

1. Baseline spike config unchanged: concurrency 10, delay 0 ms, duration 5000 ms, count 5.
2. If no failure, increase spikeConcurrency to 12.
3. If no failure, increase spikeConcurrency to 14.
4. If no failure, keep concurrency 14 and reduce failure detection tolerance only for observation, not load increase.
5. If still no failure, add a reproducible config variant interleaving sensitive REST operations already covered by the matrix operation set.

Rules per step:

- Run one step at a time.
- Record exact config delta.
- Run independent curl probe after the step.
- Stop on first verified failure.

## Phase 5 - Failure Detection

Failure definition:

- Contract harness aborts with device-unresponsive outcome, timeout, or repeated failure.
- Independent `curl http://c64u/v1/info` also times out or fails consistently.

Record on failure:

- Last successful step
- First failing step
- First failing interaction or stage
- Last successful health probe
- First failing curl probe

## Phase 6 - Trace Extraction

Artifacts to preserve:

- Full run trace
- matrix-failure-summary.json or equivalent
- Minimal replay manifest
- Request tail around the first failure

## Phase 7 - Replay

Replay process:

1. Start from a clean, healthy device state.
2. Replay the minimal manifest.
3. Verify the same endpoint failure occurs.
4. Repeat once more.

## Phase 8 - Validation

- [ ] Failure boundary confirmed.
- [ ] curl verification confirmed.
- [ ] Replay run 1 confirmed.
- [ ] Replay run 2 confirmed.

## Worklog

### 2026-03-24T00:00:00Z

- Task started.
- Reviewed build helper, contract harness, spike matrix config, replay engine, and instrumentation validation.
- Identified a blocking gap: ./build did not support inheriting a supplied contract config template, so it could not honestly run against tests/contract/config.stress.matrix.spike.json.
- Next action: patch ./build to accept --contract-config, then execute the baseline real-device run immediately.
