# C64U Failure Boundary Stress Plan

Status: IN_PROGRESS
Date: 2026-03-24
Classification: DOC_PLUS_CODE, CODE_CHANGE
Target device: c64u
Base config: tests/contract/config.stress.matrix.spike.json
Execution rule: all contract execution goes through ./build

## Objective

Correct the contract harness so transient resets and partial outages are classified as `DEGRADED`, only persistent cross-protocol outages are classified as `UNRESPONSIVE`, then continue the real-device stress run until the true unresponsive state is reproduced and replay-verified.

## Correction Scope

- [x] Replace the single-failure health trigger with a failure state machine.
- [x] Add a multi-protocol verifier covering REST `/v1/info`, ICMP ping, FTP connect/NOOP, and optional telnet reachability.
- [x] Require a persistence window before declaring `UNRESPONSIVE`.
- [x] Emit health probe results and state transitions into trace artifacts.
- [x] Fix replay shell generation to include FTP via `lftp` and accept a CLI host override.
- [ ] Re-run the real-device `mixed.burst-and-stor` escalation until persistent `UNRESPONSIVE` is observed for at least 5 seconds.
- [ ] Extract the minimal reproducer and prove replay from a clean device reaches the same persistent state.

## Safety Constraints

- Escalate gradually.
- After every escalation step, run a REST health probe and an independent curl probe.
- Stop escalation immediately after the first verified failure.
- Do not use destructive endpoints.
- Keep all runs deterministic and documented.

## Exit Criteria

- [x] Build helper supports contract runs based on tests/contract/config.stress.matrix.spike.json.
- [x] Baseline real-device contract run completes and records artifacts.
- [x] Full trace captures REST request/response headers, body, and timing plus FTP command/response timing.
- [ ] A failure boundary is observed during controlled escalation.
- [ ] Independent verification shows `curl /v1/info`, `ping`, and FTP all fail together.
- [ ] Failure persists without recovery for at least 5 seconds.
- [ ] Minimal reproducing trace is extracted.
- [ ] Replay reproduces the same persistent cross-protocol failure from a clean state.
- [ ] Replay succeeds at least twice with the same persistent failure signature.

## Phase 0 - False Positive Correction

- [x] Mark the prior ECONNRESET-only result as a false positive.
- [x] Re-scope the plan so transient recovery no longer counts as success.

## Phase 3A - Failure Model Refactor

- [x] Implement `HEALTHY`, `DEGRADED`, and `UNRESPONSIVE` states in the contract harness.
- [x] Record probe timestamps, latency, and protocol-specific failures during the verification window.
- [x] Stop aborting on a single `ECONNRESET` or timeout.

## Phase 3B - Replay Artifact Correction

- [x] Attach FTP upload byte counts to replay requests.
- [x] Generate `device-replay.sh` with `lftp` FTP steps.
- [x] Add `--host` override support at the beginning of the replay shell script.

## Phase 1 - Plan Initialization

- [x] Replace PLANS.md with this execution plan.
- [x] Add any harness capability needed to force contract runs to inherit the spike matrix config via ./build.

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

- [x] Failure boundary confirmed.
- [x] curl verification confirmed.
- [x] Replay run 1 confirmed.
- [x] Replay run 2 confirmed.

## Worklog

### 2026-03-24T00:00:00Z

- Task started.
- Reviewed build helper, contract harness, spike matrix config, replay engine, and instrumentation validation.
- Identified a blocking gap: ./build did not support inheriting a supplied contract config template, so it could not honestly run against tests/contract/config.stress.matrix.spike.json.
- Next action: patch ./build to accept --contract-config, then execute the baseline real-device run immediately.

### 2026-03-24T16:56:34Z

- Executed baseline through `./build --test-contract --c64u-target real --c64u-host c64u --contract-config tests/contract/config.stress.matrix.spike.json`.
- Evidence:
  - `test-results/contract/runs/20260324-165634-STRESS-OFF/trace.jsonl`
  - `test-results/contract/runs/20260324-170038-STRESS-OFF/trace.jsonl`
- Observation: the unchanged spike config hit an FTP session-setup boundary first, but that path did not yet provide the required `/v1/info` curl failure evidence.
- Harness fixes applied after this step:
  - `./build` now preserves template STRESS mode unless explicitly overridden.
  - Automatic post-run reboot/recovery now respects `allowMachineReset=false`.
  - `./build` now supports `--test-contract-replay` with `--contract-manifest`.

### 2026-03-24T17:02:35Z

- Derived a controlled variant from `tests/contract/config.stress.matrix.spike.json` at `.tmp/contract-configs/spike-mixed-c4.json` with these bounded deltas:
  - `operationIds: ["mixed.burst-and-stor"]`
  - `ftpSessionModes: ["per-request"]`
  - `spikeConcurrency: 4`
  - `spikeCount: 1`
  - `health.endpoint: "/v1/info"`
- Executed via `./build --test-contract --c64u-target real --c64u-host c64u --contract-config .tmp/contract-configs/spike-mixed-c4.json`.
- Independent curl evidence captured during execution:
  - `.tmp/contract-monitor/20260324T170230Z-mixed-c4-curl-info.log`
  - First failure timestamp: `2026-03-24T17:02:35Z`
  - Failure signature: `curl: (56) Recv failure: Connection reset by peer`, `http_code=000`
- Contract evidence captured:
  - Run directory: `test-results/contract/runs/20260324-170235-STRESS-OFF`
  - `DEVICE_UNRESPONSIVE`: abort reason `Error: read ECONNRESET`
  - `matrix-failure-summary.json`: stage `spike-01-mixed.burst-and-stor-cycle1-spike`
  - `matrix-stages.json`: `requestsStarted=12`, `requestsCompleted=10`, `failureCount=10`
  - `trace.jsonl` and `trace.md` present
  - `replay/manifest.json` present
- Boundary characterization from this step:
  - Smallest verified reproducing concurrency in the controlled mixed profile: `4`
  - Protocol mix: repeated REST `GET /v1/version` plus FTP upload setup
  - First user-visible independent failure: `/v1/info` connection reset while the spike stage was active
- Escalation stopped immediately after the first verified failure.

### 2026-03-24T17:05:59Z

- Extracted a smaller replay artifact from the failing run:
  - `test-results/contract/runs/20260324-170235-STRESS-OFF/replay/manifest-minimal.json`
  - Request count: `39`
  - Sequence span: global sequence `1` through `59`
- Cutoff was chosen to include only requests launched through the first failure window.

### 2026-03-24T17:06:23Z

- Replay pass 1 executed through `./build --test-contract-replay --c64u-target real --c64u-host c64u --contract-config .tmp/contract-configs/spike-mixed-c4.json --contract-manifest test-results/contract/runs/20260324-170235-STRESS-OFF/replay/manifest-minimal.json`.
- Independent curl evidence:
  - `.tmp/contract-monitor/20260324T170618Z-replay1-curl-info.log`
  - Same failure signature observed at `2026-03-24T17:06:23Z`: `curl: (56) Recv failure: Connection reset by peer`, `http_code=000`

### 2026-03-24T17:06:53Z

- Replay pass 2 executed with the same command and the same minimal manifest.
- Independent curl evidence:
  - `.tmp/contract-monitor/20260324T170647Z-replay2-curl-info.log`
  - Same failure signature observed at `2026-03-24T17:06:53Z`: `curl: (56) Recv failure: Connection reset by peer`, `http_code=000`

### 2026-03-24T17:15:08Z

- Final recovery check: `curl http://c64u/v1/info` returned `200 OK` again after the second replay-induced reset.
- Validation summary:
  - Focused regression test passed: `tests/contract/lib/breakpoint.test.ts`
  - `npm run test:coverage` exited `0`
  - `npm run build` exited `0`
  - `npm run lint` had no errors in touched files; existing warnings remained in generated `android/coverage` assets
