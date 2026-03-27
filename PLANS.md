# Screenshot Deduplication Repair Plan

Status: COMPLETE
Date: 2026-03-27
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

## Workset Validation

- `c64-screenshots-proof.oFgWB2` is a local detached git worktree rooted at `/tmp/c64-screenshots-proof.oFgWB2`, not a branch or external repository.
- Its `HEAD` is `36879e9d`, while the active branch `fix/screenshot-deduplication` is now at `626699d5`.
- File-level diff checks for:
  - [`playwright/screenshots.spec.ts`](/home/chris/dev/c64/c64commander/playwright/screenshots.spec.ts)
  - [`scripts/revert-identical-pngs.mjs`](/home/chris/dev/c64/c64commander/scripts/revert-identical-pngs.mjs)
  - [`scripts/diff-screenshots.mjs`](/home/chris/dev/c64/c64commander/scripts/diff-screenshots.mjs)
  - [`scripts/screenshotMetadataDedupe.js`](/home/chris/dev/c64/c64commander/scripts/screenshotMetadataDedupe.js)
    showed no content differences from the active branch copies.
- Decision: `DELETE` / ignore as disposable proof scaffolding. It contains no unique logic that must be merged.

## Root Cause Hypotheses

- The active dedupe path only compares git blob ids, so encoder-level PNG byte drift bypasses cleanup even when the visible image is unchanged.
- `PLANS.md` previously encoded a git-date deletion/regeneration strategy that would force churn by design and is incompatible with the no-op invariant.
- Existing fuzzy logic appears disconnected from the actual prune path, leaving no tested pixel-based decision in the pipeline that currently runs.
- Rendering noise likely remains, but the current failure mode is broader: unchanged-but-not-byte-identical files are retained instead of reverted.
- A preview-build service worker was still registering during screenshot runs, introducing hidden cached state across consecutive runs.
- The remaining churn after service-worker gating appears to be capture-side instability or a stale baseline mismatch, not PNG metadata alone.

## Phased Task List

### Phase 1 - Audit and reproduce

- Map the exact screenshot generation, write, compare, and cleanup flow.
- Measure representative churn against `HEAD` to separate byte-only drift, bounded rendering noise, and real pixel deltas.
- Record the confirmed root causes in `WORKLOG.md`.

### Phase 2 - Deterministic capture hardening

- Audit current capture stabilization in Playwright.
- Add only the missing deterministic controls required for screenshots that still drift for non-semantic reasons.
- Keep capture ordering and encoder behavior explicit and explainable.
- Explicitly disable service-worker registration when test probes are enabled.
- Ensure Home light/dark overview captures are both taken before any section scrolling so they share the same initial viewport state.

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
- If a first clean run still creates screenshots relative to `HEAD`, determine whether those files are stale-but-real baseline mismatches or remaining nondeterministic churn, using file hashes across consecutive reruns.
- When rerunning only a screenshot subset, verify that unrelated screenshot folders stay untouched and record any still-unstable files separately from the intentional refresh set.

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

---

# Lighting Studio ASCII LED Refinement Plan

Status: IN PROGRESS
Date: 2026-03-27
Classification: DOC_PLUS_CODE
Visible UI impact: YES

## Problem Statement

The Lighting Studio device preview still uses hand-authored SVG geometry that does not re-derive its regions from the authoritative ASCII layout. The amended layout introduces a dedicated LED strip semantic region (`_`) that must render as a separate always-white layer and remain completely isolated from case and keyboard lighting controls.

## Authoritative Geometry Source

- Primary source for this task: `doc/image/lighting/C64-layout.txt`
- Current repository mirror of the same layout: `doc/img/lighting/c64-outline.txt`
- Legend:
  - `x` => case region
  - `-` => keyboard regions
  - `_` => LED strip region

## Required Outcomes

- Recompute preview geometry directly from the ASCII layout rather than reusing the previous hard-coded shell and keyboard blocks.
- Extract three semantic region types:
  - case
  - keyboard
  - LED strip
- Keep the LED strip on its own topmost render layer with a fixed white appearance.
- Preserve the current bottom-sheet/dialog behavior and the prior layout consistency work.

## Implementation Plan

### Phase 1 - Geometry extraction

- Add a deterministic ASCII parser that validates row widths and rejects unknown glyphs.
- Classify cells into case, keyboard, and LED regions.
- Merge adjacent cells into stable grouped SVG rects to keep DOM size bounded.
- Derive connected keyboard components so the main block and right-side function-key block remain individually addressable.

### Phase 2 - SVG renderer update

- Replace the hard-coded preview geometry in `LightingStudioDialog` with the parsed layout output.
- Render base colors with the required defaults:
  - case base `#BFBBAF`
  - keyboard base `#111111`
  - LED baseline off-white/white
- Apply lighting overlays only to the case and keyboard layers.
- Keep the LED strip fixed white with optional lightweight static glow only.

### Phase 3 - Regression coverage

- Add focused tests for ASCII region classification.
- Add tests that prove the LED region exists and stays separate from case and keyboard regions.
- Add preview rendering assertions that prove LED fill remains white and unchanged under different case/keyboard colors and intensities.

### Phase 4 - Validation

- Run targeted unit tests for the new parser and Lighting Studio preview.
- Run `npm run test:coverage` and keep global branch coverage at `>= 91%`.
- Run the relevant lint and build validation for the touched React/Vite code.
- Regenerate the Lighting Studio screenshots and verify the LED strip remains white in the captured output.

## Acceptance Criteria

- The preview geometry is derived from the authoritative ASCII layout including the `_` region.
- The LED strip renders in the correct top-right position and remains white regardless of case/keyboard colors.
- Case and keyboard overlays remain independent and continue to respond to their own controls.
- The Lighting Studio remains a dialog/bottom-sheet workflow with no popup regression.
- Tests, coverage, lint, build, and targeted screenshots all pass for the final change set.
