# Reliability Remediation Plan (Convergence-First)

Date: 2026-03-06
Source analysis: `doc/testing/investigations/reliability1/analysis.md`
Plan intent: execute fixes for all six reliability issues with machine-verifiable closure.

## 1. Current State

All issues are unresolved.

1. Issue 1 (volume + mute): `NOT_STARTED`
2. Issue 2 (auto-advance): `NOT_STARTED`
3. Issue 3 (stuck highlight): `NOT_STARTED`
4. Issue 4 (HVSC ingestion reliability): `NOT_STARTED`
5. Issue 5 (low-resource stability): `NOT_STARTED`
6. Issue 6 (RAM restore chunking): `NOT_STARTED`

No issue may be marked `DONE` without passing all acceptance checks in this document.

## 2. Required Execution Artifacts

The implementation session must create and maintain:

1. `doc/testing/investigations/reliability1/work-log.md`
2. `doc/testing/investigations/reliability1/convergence-report.md`
3. `doc/testing/investigations/reliability1/convergence-status.json`

`convergence-status.json` schema:

```json
{
  "issue1": { "status": "NOT_STARTED|IN_PROGRESS|DONE", "pre_fix_failure_evidence": [], "post_fix_pass_evidence": [] },
  "issue2": { "status": "NOT_STARTED|IN_PROGRESS|DONE", "pre_fix_failure_evidence": [], "post_fix_pass_evidence": [] },
  "issue3": { "status": "NOT_STARTED|IN_PROGRESS|DONE", "pre_fix_failure_evidence": [], "post_fix_pass_evidence": [] },
  "issue4": { "status": "NOT_STARTED|IN_PROGRESS|DONE", "pre_fix_failure_evidence": [], "post_fix_pass_evidence": [] },
  "issue5": { "status": "NOT_STARTED|IN_PROGRESS|DONE", "pre_fix_failure_evidence": [], "post_fix_pass_evidence": [] },
  "issue6": { "status": "NOT_STARTED|IN_PROGRESS|DONE", "pre_fix_failure_evidence": [], "post_fix_pass_evidence": [] }
}
```

## 3. Mandatory Test Deliverables

Each issue must have at least one deterministic automated test added or upgraded in both:

1. Unit/integration layer (`tests/unit/**` or Android JVM tests when native-only)
2. User-flow layer (`playwright/**` and/or `.maestro/**` for device lifecycle paths)

Required Maestro flows from analysis:

1. `.maestro/edge-volume-mute-race.yaml`
2. `.maestro/edge-auto-advance-lock.yaml`
3. `.maestro/edge-auto-advance-format-matrix.yaml`
4. `.maestro/edge-button-highlight-timeout.yaml`
5. `.maestro/edge-hvsc-ingest-lifecycle.yaml`
6. `.maestro/edge-hvsc-repeat-cancel-resume.yaml`
7. `.maestro/edge-ram-restore-chunked.yaml`

## 4. Issue-by-Issue Acceptance Criteria

### Issue 1: Volume slider + mute convergence

Implementation acceptance:

1. Audio mixer update failures are not silently ignored.
2. Slider/mute writes are ordered so stale writes cannot overwrite newer intent.
3. Final UI state converges to backend-confirmed volume/mute state.

Test acceptance:

1. Race test covers rapid slider movement + mute/unmute interleaving.
2. Failure-injection test validates convergence after `/v1/configs/Audio Mixer` failure.
3. Post-fix test verifies no persistent mute desync.

### Issue 2: Auto-advance reliability

Implementation acceptance:

1. Duration-based auto-advance applies to `sid`, `mod`, `prg`, `crt`, and `disk`.
2. Lock/background resume reconciles overdue transitions.
3. Exactly one transition occurs per due event.

Test acceptance:

1. Format matrix test covers all required categories.
2. Lock/unlock idle test validates overdue reconciliation.
3. Duplicate-transition guard test prevents cascade advances.

### Issue 3: Button highlight never-stuck behavior

Implementation acceptance:

1. Highlight has an enforced maximum age.
2. Resume hooks (`visibilitychange`/focus/navigation) sweep stale highlights.
3. Persistent-active semantics only apply to true long-running controls.

Test acceptance:

1. Heavy-load test verifies highlight clears after resumed event loop.
2. Lock/unlock test verifies highlight clears after app resume.
3. Persistent-active usage test verifies non-long-running controls do not persist.

### Issue 4: HVSC ingestion robustness

Implementation acceptance:

1. Non-native path avoids full archive and full extracted-list materialization.
2. Cancellation checkpoints are deterministic and recoverable.
3. Background/navigation transitions do not strand ingest state.

Test acceptance:

1. Streaming extraction behavior test proves incremental processing.
2. Deterministic cancellation test proves terminal `cancelled` state.
3. Resume test proves progress continues to `ready` or fails with explicit error.

### Issue 5: Low-resource stability

Implementation acceptance:

1. Memory-intensive operations are bounded for low-resource profiles.
2. Long synchronous loops are chunked/yielding where needed.
3. Low-resource mode affects workload strategy, not just animation.

Test acceptance:

1. Repeated ingest/cancel cycles complete without crash.
2. Stress test validates monotonic progress stages under low-resource profile.
3. Terminal-state assertion confirms `ready` or explicit `cancelled`.

### Issue 6: RAM restore chunking and retry policy

Implementation acceptance:

1. Restore uses chunked writes (no single 64 KiB write).
2. Retry policy is chunk-level with checkpoint resume.
3. Timeout policy is chunk-aware and resilient under delay.

Test acceptance:

1. Chunk-count test verifies multiple writes for full restore.
2. Fault-injection test verifies chunk retry and resume behavior.
3. Roundtrip integrity test confirms restored RAM matches input image.

## 5. Convergence Protocol (Fail-Closed)

The implementation session must execute this sequence:

1. Add/update deterministic failing tests for one issue.
2. Run targeted tests and capture failing evidence in `work-log.md`.
3. Implement fix.
4. Re-run targeted tests and capture passing evidence.
5. Update `convergence-status.json` issue state.
6. Repeat for Issues 1-6.
7. Run final global gates.

If any gate fails, status remains `NOT CONVERGED`.

## 6. Global Verification Gates

All commands must pass:

1. `npm run lint`
2. `npm run test`
3. `npm run build`
4. `npm run test:coverage`
5. `node scripts/check-coverage-threshold.mjs`
6. `npm run test:e2e`
7. If traces changed: `npm run validate:traces`
8. If Playwright evidence changed: `npm run validate:evidence`
9. If Maestro changed and runtime available: `npm run maestro:gating`

Coverage gate:

1. Branch coverage must be `>= 90%`.

## 7. Automatic Verification Checklist

These checks must succeed before marking complete:

1. `test -f doc/testing/investigations/reliability1/reliability-remediation-plan.md`
2. `test -f doc/testing/investigations/reliability1/work-log.md`
3. `test -f doc/testing/investigations/reliability1/convergence-report.md`
4. `test -f doc/testing/investigations/reliability1/convergence-status.json`
5. `node -e "const s=require('./doc/testing/investigations/reliability1/convergence-status.json'); const keys=['issue1','issue2','issue3','issue4','issue5','issue6']; for (const k of keys) { if (!s[k] || s[k].status!=='DONE') process.exit(1); }"`
6. `rg -n '^## Issue [1-6]$' doc/testing/investigations/reliability1/convergence-report.md`
7. `rg -n 'pre_fix_failure_evidence|post_fix_pass_evidence' doc/testing/investigations/reliability1/convergence-report.md`

## 8. Definition of Done

Done means all conditions are true:

1. Issues 1-6 are `DONE` in `convergence-status.json`.
2. `convergence-report.md` includes acceptance evidence for every issue.
3. `work-log.md` contains timestamped command/results trail.
4. All global verification gates pass.
5. No silent exception swallowing introduced.
