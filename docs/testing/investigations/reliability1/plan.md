# Reliability Remediation Convergence Plan (Session 2)

Date: 2026-03-06
Scope: Implement and verify fixes for Issues 1-6 from `analysis.md`
Primary reference: `docs/testing/investigations/reliability1/analysis.md`

## 1. Goal

Close every reliability issue in `analysis.md` with fail-closed convergence:

1. Reproduce deterministically with automated tests.
2. Implement fix.
3. Prove fix with issue-specific tests.
4. Prove no regressions with full gates.

Completion is blocked unless all issue gates and global gates pass.

## 2. Mandatory Artifacts

Create and maintain these two documents during execution:

1. `docs/testing/investigations/reliability1/execution-log.md`
2. `docs/testing/investigations/reliability1/convergence-report.md`

`execution-log.md` must include timestamped actions and command results.
`convergence-report.md` must include one section per issue (`Issue 1` ... `Issue 6`) with:

1. Root cause fixed.
2. Tests added/updated.
3. Reproduction test result before fix (failing).
4. Verification result after fix (passing).
5. Remaining risks (or `none`).

## 3. Global Hard Gates

All of these must pass before completion:

1. `npm run lint`
2. `npm run test`
3. `npm run build`
4. `npm run test:coverage`
5. `node scripts/check-coverage-threshold.mjs` with branch minimum 90%
6. `npm run test:e2e`
7. If Playwright trace semantics changed: `npm run validate:traces`
8. If Playwright evidence changed: `npm run validate:evidence`
9. If Maestro flows changed and Android runtime is available: `npm run maestro:gating`

No skipped tests and no suppressed warnings.

## 4. Issue Closure Matrix (All Required)

Each issue is `DONE` only if all listed acceptance checks are satisfied.

### Issue 1: Volume slider + mute desync

Status: `TODO`
Required implementation outcomes:

1. Volume/mute write failures are surfaced (throw or explicit failure result).
2. Last-write-wins ordering is enforced for slider + mute/unmute races.
3. UI state converges to confirmed backend state after writes.

Required automated tests:

1. Race test covering rapid slider + mute/unmute interleaving.
2. Failure-injection test for `/v1/configs/Audio Mixer`.
3. Post-failure convergence test proving no stuck mute state.

### Issue 2: Auto-advance under lock/background

Status: `TODO`
Required implementation outcomes:

1. Duration-based auto-advance applies to non-song formats (`prg`, `crt`, `disk`).
2. Due-state reconciliation works after lock/background/idle resume.
3. Exactly-one transition behavior enforced (no cascades).

Required automated tests:

1. `sid`/`mod`/`prg`/`crt` matrix auto-advance tests.
2. Lock/unlock overdue reconciliation test.
3. Duplicate-advance prevention test.

### Issue 3: Stuck highlight state

Status: `TODO`
Required implementation outcomes:

1. Highlight has bounded max age.
2. Highlight sweep runs on visibility/focus resume and route transition.
3. `persistent-active` usage is restricted to true long-running actions.

Required automated tests:

1. Highlight clears after heavy-task delay.
2. Highlight clears after lock/unlock resume.
3. Persistent-active controls remain explicit and intentional.

### Issue 4: HVSC download + ingestion reliability

Status: `TODO`
Required implementation outcomes:

1. Non-native ingestion avoids full archive + full extracted-file materialization.
2. Cancellation and resume checkpoints are deterministic.
3. Background/navigation transitions do not strand ingestion state.

Required automated tests:

1. Streaming/iterative processing behavior test.
2. Deterministic cancel-at-checkpoint test.
3. Navigation/lock lifecycle continuation test.

### Issue 5: Low-resource stability

Status: `TODO`
Required implementation outcomes:

1. Peak memory and burst allocations are reduced on low-resource paths.
2. Heavy loops are chunked/yielding where required.
3. Low-resource adaptation affects workload, not only UI animation.

Required automated tests:

1. Low-resource ingest stress test.
2. Repeated ingest/cancel/resume stability test.
3. No-crash terminal-state test (`ready` or `cancelled`) across cycles.

### Issue 6: RAM dump/restore chunking and resilience

Status: `TODO`
Required implementation outcomes:

1. Restore writes are chunked (default 4-8 KiB; not 64 KiB single write).
2. Retry logic is chunk-level with resume checkpointing.
3. Timeout policy is chunk-aware and robust under delay.

Required automated tests:

1. Chunk-count assertion test for full-image restore.
2. Mid-transfer failure and resume test.
3. End-to-end roundtrip integrity test.

## 5. Required Maestro Deliverables

Add these flows (or equivalent with same assertions/tags):

1. `.maestro/edge-volume-mute-race.yaml`
2. `.maestro/edge-auto-advance-lock.yaml`
3. `.maestro/edge-auto-advance-format-matrix.yaml`
4. `.maestro/edge-button-highlight-timeout.yaml`
5. `.maestro/edge-hvsc-ingest-lifecycle.yaml`
6. `.maestro/edge-hvsc-repeat-cancel-resume.yaml`
7. `.maestro/edge-ram-restore-chunked.yaml`

Tag requirements:

1. Reliability edge flows must include `edge`.
2. HVSC-specific flows must include `hvsc`.
3. Device-required flows must include `device`.
4. Long-running flows must include `slow`.

## 6. Execution Order (Strict)

1. Baseline gate run and evidence capture.
2. Issue 6 (critical hardware stability risk).
3. Issues 4 and 5 together (shared memory/perf pathways).
4. Issue 2 (core playback progression reliability).
5. Issue 1 (control-state convergence).
6. Issue 3 (UI consistency cleanup).
7. Maestro reliability flows and gating integration.
8. Final global hard gates and convergence report finalization.

## 7. Autonomous Verification Protocol

The implementing LLM must run and record these checks:

1. `rg -n "^### Issue [1-6]:" docs/testing/investigations/reliability1/plan.md`
2. `rg -n "^## Issue [1-6]$" docs/testing/investigations/reliability1/convergence-report.md`
3. `test -f docs/testing/investigations/reliability1/execution-log.md`
4. `test -f docs/testing/investigations/reliability1/convergence-report.md`
5. `npm run lint`
6. `npm run test`
7. `npm run build`
8. `npm run test:coverage`
9. `node scripts/check-coverage-threshold.mjs`
10. `npm run test:e2e`

If any command fails, session state is `NOT CONVERGED`.

## 8. Definition of Done

The session is complete only when all conditions are true:

1. Issues 1-6 are each marked `DONE` in `convergence-report.md`.
2. Each issue has explicit test evidence before and after the fix.
3. Global hard gates pass.
4. Branch coverage is at least 90%.
5. No silent exception handling is introduced.
6. No open reliability TODO remains in changed code.
