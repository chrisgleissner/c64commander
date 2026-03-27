# Screenshot Deduplication Repair Plan

Status: IN PROGRESS
Date: 2026-03-26
Classification: DOC_PLUS_CODE
Visible UI impact: NO

## Problem Statement

The screenshot generation pipeline for `doc/img/app/` is no longer trustworthy. An unchanged rerun is leaving broad screenshot churn, while the current dedupe design is too weak to distinguish encoder or rendering noise from real UI deltas. The pipeline must return to a strict, deterministic state where unchanged reruns leave zero retained screenshot diffs and small real visual changes remain detectable.

## Assumptions

- The authoritative screenshot entry point is the Playwright `@screenshots` suite invoked via `npm run screenshots`.
- `doc/img/app/` tracked at `HEAD` is the baseline that reruns must compare against.
- PNG byte equality is not sufficient because encoder output can differ even when pixels are effectively unchanged.
- Existing repo changes outside this task may be present and must be preserved.

## Invariants

- No-op rerun: two identical reruns from the same commit and environment leave zero retained diffs under `doc/img/app/`.
- High sensitivity: small real UI changes, including short text edits, must remain preserved.
- Explicit bounded tolerance: any tolerated noise must be narrowly defined, justified, and encoded in code and tests.
- Determinism: capture should control obvious sources of nondeterminism before comparison applies any tolerance.
- Net-result: redundant regenerated screenshots must be removed automatically before completion.
- Proof: automated tests must prove unchanged screenshots are eliminated and small real changes survive.

## Current Pipeline Map

- Entry point: `npm run screenshots` -> [`scripts/run-screenshots-with-prune.mjs`](/home/chris/dev/c64/c64commander/scripts/run-screenshots-with-prune.mjs)
- Capture suite: [`playwright/screenshots.spec.ts`](/home/chris/dev/c64/c64commander/playwright/screenshots.spec.ts)
- Post-run cleanup: [`scripts/revert-identical-pngs.mjs`](/home/chris/dev/c64/c64commander/scripts/revert-identical-pngs.mjs)
- Metadata-only dedupe helper: [`scripts/screenshotMetadataDedupe.js`](/home/chris/dev/c64/c64commander/scripts/screenshotMetadataDedupe.js)
- Path exceptions: [`scripts/screenshotPrunePolicy.js`](/home/chris/dev/c64/c64commander/scripts/screenshotPrunePolicy.js)
- Diff aid only: [`scripts/diff-screenshots.mjs`](/home/chris/dev/c64/c64commander/scripts/diff-screenshots.mjs)
- Output root: `doc/img/app/<page>/<state>.png`

## Root Cause Hypotheses

- The active dedupe path only compares git blob ids, so encoder-level PNG byte drift bypasses cleanup even when the visible image is unchanged.
- `PLANS.md` previously encoded a git-date deletion/regeneration strategy that would force churn by design and is incompatible with the no-op invariant.
- Existing fuzzy logic appears disconnected from the actual prune path, leaving no tested pixel-based decision in the pipeline that currently runs.
- Rendering noise likely remains, but the current failure mode is broader: unchanged-but-not-byte-identical files are retained instead of reverted.

## Phased Task List

### Phase 1 - Audit and reproduce

- Map the exact screenshot generation, write, compare, and cleanup flow.
- Measure representative churn against `HEAD` to separate byte-only drift, bounded rendering noise, and real pixel deltas.
- Record the confirmed root causes in `WORKLOG.md`.

### Phase 2 - Deterministic capture hardening

- Audit current capture stabilization in Playwright.
- Add only the missing deterministic controls required for screenshots that still drift for non-semantic reasons.
- Keep capture ordering and encoder behavior explicit and explainable.

### Phase 3 - Comparison and cleanup repair

- Replace or extend the metadata-only dedupe with strict image comparison against the correct baseline path.
- Normalize irrelevant PNG-level differences before comparison.
- Use a narrow threshold model that tolerates bounded rendering noise without hiding small text or layout changes.
- Ensure unchanged tracked screenshots are restored and redundant new screenshots are deleted automatically.

### Phase 4 - Automated coverage

- Add focused unit tests for the comparison/elimination core.
- Cover identical pixels with different PNG bytes, tolerated bounded noise, and preserved small real changes.
- Add a higher-level pipeline test for rerun/no-op behavior where practical.

### Phase 5 - Proof and validation

- Run targeted tests for the changed scripts and screenshot helpers.
- Run `npm run test:coverage` and keep global branch coverage at `>= 91%`.
- Run the screenshot pipeline twice from a stabilized point and prove the second run leaves zero retained screenshot diffs under `doc/img/app/`.

### Phase 6 - Documentation

- Update the relevant docs with the comparison model, thresholds, and debugging guidance.
- Keep the explanation concise and factual.

## Acceptance Criteria

- Root cause is identified and fixed at the actual pipeline layer.
- Unchanged reruns leave zero retained screenshot diffs.
- Small meaningful image changes remain preserved.
- Tolerance is explicit, narrow, justified, and test-covered.
- `PLANS.md` and `WORKLOG.md` reflect the real execution record.
- Relevant docs are updated.
- All touched tests pass.

## Evidence Checklist

- `git status --short` before and after the no-op rerun proof
- Targeted unit test output for screenshot dedupe logic
- `npm run test:coverage` result with branch coverage `>= 91%`
- Screenshot pipeline run 1 summary
- Screenshot pipeline run 2 summary with zero retained `doc/img/app/` diffs
- File references for the final implementation and docs changes
