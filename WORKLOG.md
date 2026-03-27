# Screenshot Deduplication Worklog

## Phase 1 - Audit and reproduction

### 2026-03-26T16:50:00Z

- Reclassified the task as `DOC_PLUS_CODE` with no visible UI change. The work affects executable screenshot tooling, tests, and docs.
- Read `README.md`, `.github/copilot-instructions.md`, the existing `PLANS.md`, and the screenshot-related Playwright and script entry points before editing.
- Confirmed the previous `PLANS.md` encoded an invalid git-date regeneration strategy that would force screenshot churn and cannot satisfy the no-op rerun invariant.

### 2026-03-26T17:00:00Z

- Traced the active screenshot flow: `npm run screenshots` -> `scripts/run-screenshots-with-prune.mjs` -> `playwright/screenshots.spec.ts` -> `scripts/revert-identical-pngs.mjs`.
- Confirmed the active dedupe path relies on `scripts/screenshotMetadataDedupe.js`, which only compares git blob ids and tracked duplicate paths.
- Confirmed the image-based fuzzy logic currently exists only in `scripts/diff-screenshots.mjs`, a reporting helper that does not participate in the actual prune path.

### 2026-03-26T17:10:00Z

- Sampled churned screenshots against `HEAD` and found representative cases with identical dimensions and very low grayscale MAE despite differing git blobs.
- This establishes that the current retained churn is not explained by pathing alone; the pipeline is keeping visually unchanged or near-unchanged rerenders because blob equality is too strict for the cleanup step.

## Phase 2 - In progress

### 2026-03-26T17:15:00Z

- Next implementation slice: replace metadata-only prune decisions with a tested pixel-aware comparison layer, then re-verify whether any remaining churn points to missing capture determinism.

## Phase 2 - Determinism and comparison repair

### 2026-03-26T23:20:00Z

- Replaced the metadata-only screenshot dedupe helper with a shared comparison module that decodes PNG pixels, ignores metadata-only byte drift, and uses a narrowly bounded non-AA tolerance.
- Rewired both `playwright/screenshots.spec.ts` and `scripts/revert-identical-pngs.mjs` to use the same comparison core so capture-time cleanup and post-run cleanup no longer diverge.
- Added deterministic Chromium launch flags in `playwright.config.ts` to reduce renderer-driven screenshot drift before cleanup runs.
- Aligned `scripts/diff-screenshots.mjs` with the same comparison model to remove stale MAE-only guidance from the tooling.

## Phase 3 - Tests and validation

### 2026-03-26T23:35:00Z

- Added focused unit coverage for identical pixel content with different PNG bytes, bounded noise, small real text deltas, tracked restore decisions, and prune behavior in a temporary git repository.
- Targeted screenshot dedupe tests now pass: `npx vitest run tests/unit/scripts/screenshotMetadataDedupe.test.ts tests/unit/scripts/screenshotPrunePolicy.test.ts`.
- `npm run lint` passes for the current tree, with existing warnings only from generated Android coverage artifacts.

### 2026-03-27T00:05:00Z

- `npm run test:coverage` reproduced a repo-level coverage writer failure: `ENOENT` while opening `.cov-unit/.tmp/coverage-*.json` after the unit suite had otherwise run.
- Began a second coverage run with `.cov-unit/.tmp` created up front to work around the missing directory and recover the final branch-coverage report without changing app behavior.
