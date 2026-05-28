# Prod-Hardening-5 Analysis Plan

Authoritative execution plan for the prod-hardening-5 analysis-and-prompt-generation
pass.

This pass is **DOC_ONLY**. No production code edits. Only files under
`docs/research/stabilization/prod-hardening-5/` may be created or modified.

The analysis pass is complete. The implementation pass should append to
`PLANS.md` and `WORKLOG.md` rather than overwrite them.

## Phases

### Phase 1 — Orientation
- [x] Establish baseline (branch, HEAD, status).
- [x] Create `PLANS.md` and `WORKLOG.md`.
- [x] Read required documents in order.
- [x] Read prior hardening prompt/result documents.
- [x] Capture features-by-page contract.

### Phase 2 — Static repository scans
- [x] Device-call boundary scan (REST/FTP/Telnet/native).
- [x] Gateway and scheduler scan (withRestInteraction etc.).
- [x] High-frequency interaction scan (sliders, listeners, timers).
- [x] Exception and logging scan.
- [x] State persistence and stale-result scan.
- [x] Native and lifecycle scan.

### Phase 3 — Prior-hardening ledger
- [x] Extract findings from prod-hardening-1.
- [x] Extract findings from prod-hardening-2.
- [x] Extract findings from prod-hardening-3.
- [x] Extract findings from prod-hardening-4.
- [x] Verify each finding against current code/tests.
- [x] Classify into the issue-ledger taxonomy.

### Phase 4 — Feature-surface audit
- [x] Map each page in `docs/features-by-page.md` to risks.
- [x] Identify high-frequency interactions and long-running operations.
- [x] Identify cancellation/supersession/staleness risks.

### Phase 5 — Risk synthesis & prompt assembly
- [x] Sort candidate findings by deterministic priority.
- [x] Drop findings lacking current evidence.
- [x] Write `research.md` with executive summary, baseline, scans, findings.
- [x] Write `test-matrix.md` mapping each task to deterministic proofs.
- [x] Write `prompt.md` (starts with `ROLE`).
- [x] Write `results.md`.

### Phase 6 — Self-check
- [x] Verify cross-document consistency.
- [x] Verify no task bypasses safety controls.
- [x] Verify no task claims unproven hardware validation.
- [x] Verify `git diff` only touches prod-hardening-5 directory (verified at end).

## Assumptions

- Current repository tree is source of truth.
- The three modified files in the worktree are concurrent LLM work, left as-is per
  CLAUDE.md "Mandatory handling of concurrent changes". They are recorded in
  WORKLOG.md and addressed by PH5-01 in the implementation prompt.
- Hardware availability checked at session start: `u64` reachable, `c64u`
  unreachable (consistent with documented flakiness), Pixel 4 attached.

## Blockers

- `c64u` host returns connection reset; no app-side defect implied. Noted for the
  implementation pass.

## Acceptance criteria

- All termination criteria from the analysis prompt satisfied.
- Every task in `prompt.md` carries a traceable evidence anchor in `research.md` /
  `issue-ledger.md` / `feature-audit.md`.
- Every task in `prompt.md` has a deterministic test plan in `test-matrix.md`.

## Output checklist

- [x] `PLANS.md`
- [x] `WORKLOG.md`
- [x] `issue-ledger.md`
- [x] `feature-audit.md`
- [x] `research.md`
- [x] `test-matrix.md`
- [x] `prompt.md`
- [x] `results.md`

## Selected PH5 task list (final)

1. PH5-01-CONCURRENT-WORKTREE-LANDING (Low, process).
2. PH5-04-IMPORT-CANCEL-GENERATION (Medium).
3. PH5-05-NATIVE-LISTENER-ONCE-PROOF (Low).
4. PH5-06-IDB-CONSOLE-WARN-ROUTING (Low).

Items rejected or deferred are documented in `research.md` §5.

---

## 2026-05-28 implementation pass (CODE_CHANGE)

This pass is **CODE_CHANGE** with deterministic regression tests, lint, build,
coverage, and Android/device validation evidence required by repository policy.

### Current phase

- [x] Re-read required PH5 docs, PH4 contract docs, and architecture docs.
- [x] Inspect concurrent worktree edits and run the mandated PH5-01 targeted tests.
- [x] Land PH5-01 as part of the PH5 change boundary because the targeted tests are green.
- [x] Implement PH5-04 switch-aware import cancellation for Play and Disks.
- [x] Add deterministic PH5-04 tests for Play import, Disk import, and saved-device-switch event publication.
- [x] Add deterministic PH5-05 runtime listener-once proof for `PlayFilesPage`.
- [x] Implement PH5-06 IndexedDB warn routing through `addLog("warn", ...)`.
- [x] Reconcile touched-area tests that assumed the pre-PH5 `addDisks(...)` two-argument contract.
- [ ] Run full validation (`npm run test`, `npm run lint`, `npm run build`, `npm run test:coverage`, patch coverage check).
- [ ] Re-probe `u64` then `c64u`, build/deploy APK, validate on Pixel 4, and update `results.md` / `pr-desc.md`.

### Acceptance criteria for the implementation pass

- PH5-01 concurrent edits stay landed only if the mandated targeted tests remain green.
- PH5-04 prevents any post-switch playlist/disk-library mutation and treats switch cancellation as a clean cancellation.
- PH5-05 proves one native listener registration across playback churn and one removal on unmount.
- PH5-06 eliminates the five raw IndexedDB `console.warn(...)` calls while preserving structured details.
- No regression to any PH1-PH4 guarantee documented in `research.md` §7.
