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

## Phase 4 - Determinism follow-up

### 2026-03-27T08:15:00Z

- Validated `/tmp/c64-screenshots-proof.oFgWB2` as a detached local git worktree, not a separate repository or branch.
- Compared the proof worktree copies of `playwright/screenshots.spec.ts`, `scripts/revert-identical-pngs.mjs`, `scripts/diff-screenshots.mjs`, and `scripts/screenshotMetadataDedupe.js` against the active branch and found no content differences.
- Classified the proof worktree as disposable proof scaffolding with no unique logic to merge.

### 2026-03-27T08:20:00Z

- Identified that the preview-build service worker still registered during Playwright screenshot runs because test probes did not suppress registration.
- Patched `src/lib/startup/serviceWorkerRegistration.ts` to disable service-worker registration when `VITE_ENABLE_TEST_PROBES=1` or the browser-side probe flag is enabled.
- Added a regression test in `tests/unit/startup/serviceWorkerRegistration.test.ts` and verified it with `npx vitest run tests/unit/startup/serviceWorkerRegistration.test.ts`.

### 2026-03-27T08:35:00Z

- Re-ran the screenshot subset for Home, Config, and Docs twice from a clean tree.
- The second subset rerun changed only `docs/img/app/home/00-overview-light.png`; the previously changing Config and Docs samples stayed byte-stable.
- This confirms the service worker was one real nondeterminism source, but the full screenshot pipeline still has at least one remaining unstable capture surface.

### 2026-03-27T08:50:00Z

- Tightened `waitForStableRender()` so screenshot capture now waits for the swipe-navigation runway to leave `transitioning`, then requires repeated stable active-slot geometry/scroll samples before capture.
- The stricter settling exposed that the canonical Home screenshot selector was relying on impossible stale pairings from a pre-settled layout, so `playwright/homeScreenshotLayout.ts` was updated to choose canonical slices monotonically with explicit fallbacks for tall Home sections.
- Added a regression case in `tests/unit/playwright/homeScreenshotLayout.test.ts` for the settled Home slice pattern and verified it with `npx vitest run tests/unit/playwright/homeScreenshotLayout.test.ts`.

### 2026-03-27T08:55:00Z

- Fixed the Home overview capture order so `home/01-overview-dark.png` is taken before any Home section scrolling, preserving the same initial viewport/state as `home/00-overview-light.png`.
- Restored `doc/img/app` and reran only the Home-focused screenshot tests; the resulting screenshot diffs were confined to `docs/img/app/home/**`, which is consistent with the requested Home-only refresh plus concurrent Home button work on the branch.

### 2026-03-27T09:00:00Z

- A repeated Home-only rerun still changed a subset of Home PNG hashes (`home/dialogs/04-restore-confirmation.png`, `home/interactions/01-toggle.png`, `home/sections/04-printers-to-sid.png`, `home/sections/05-sid-to-config.png`, `home/sid/01-reset-post-silence.png`), so Home determinism is not fully resolved yet.
- Concurrent branch activity is still present in Home/telnet files (`src/hooks/useTelnetActions.ts`, `src/lib/telnet/telnetClient.ts`, related tests), so the current screenshot hash drift cannot yet be treated as a final no-op rerun proof.

## Lighting Studio ASCII LED refinement

### 2026-03-27T10:05:00Z

- Reclassified the new task as `DOC_PLUS_CODE` and `UI_CHANGE` because it touches executable preview code, visible Lighting Studio output, screenshots, and planning records.
- Confirmed the current Lighting Studio device preview is still hard-coded inside `src/components/lighting/LightingStudioDialog.tsx` rather than derived from the ASCII layout.
- Verified the amended authoritative geometry already exists in the repository as `docs/img/lighting/c64-outline.txt`, and measured the new grid as `67 x 15` with the LED strip at row `2`, columns `58-59`.

### 2026-03-27T10:10:00Z

- Mapped the active validation surfaces before editing: the preview unit tests in `tests/unit/components/lighting/LightingStudioDialog.preview.test.tsx`, the broader dialog tests in `tests/unit/components/lighting/LightingStudioDialog.test.tsx`, the interactive Playwright checks in `playwright/lightingStudio.spec.ts`, and the screenshot capture in `playwright/screenshots.spec.ts`.
- Confirmed that the existing tests only cover presence/layout of the old hard-coded blocks and do not currently prove ASCII classification or LED color isolation.
- Began the implementation phase to replace the hard-coded geometry with parsed ASCII-backed SVG layers while preserving the current dialog/bottom-sheet behavior.

### 2026-03-27T10:35:00Z

- Added `docs/image/lighting/C64-layout.txt` as the authoritative ASCII source consumed by the app-side preview parser, while preserving the existing mirror file under `docs/img/lighting/c64-outline.txt`.
- Introduced `src/lib/lighting/c64PreviewLayout.ts` to validate the ASCII layout, classify `case`, `keyboard`, and `led` cells, merge them into bounded SVG rect groups, and expose the main keyboard block, function-key block, and LED strip as deterministic geometry.
- Replaced the Lighting Studio preview’s hand-drawn shell geometry in `src/components/lighting/LightingStudioDialog.tsx` with ASCII-derived case, keyboard, and LED layers.
- Implemented the fixed LED isolation rule in the renderer: the LED layer stays topmost, uses a constant white fill and lightweight static glow, and does not depend on case or keyboard colors or intensities.

### 2026-03-27T10:55:00Z

- Added regression coverage for the new parser in `tests/unit/lib/lighting/c64PreviewLayout.test.ts`, including the authoritative `67 x 15` geometry, the LED strip bounds at row `2`, columns `58-59`, single-keyboard-component fallback behavior, and malformed-layout guards.
- Extended `tests/unit/components/lighting/LightingStudioDialog.preview.test.tsx` and `tests/unit/components/lighting/LightingStudioDialog.test.tsx` to prove LED presence and color isolation in the rendered SVG.
- Updated `playwright/lightingStudio.spec.ts` to assert that the LED strip is visible and remains `#F5F5F5` in the medium dialog layout.

### 2026-03-27T11:15:00Z

- Focused unit coverage passed for the new parser and preview tests.
- Targeted browser validation passed: `npx playwright test playwright/lightingStudio.spec.ts --reporter=line`.
- Targeted screenshot regeneration passed: `npx playwright test playwright/screenshots.spec.ts -g "capture lighting studio screenshot" --reporter=line`.
- The targeted screenshot refresh changed `docs/img/app/home/dialogs/06-lighting-studio-compose-medium.png` and re-captured `docs/img/app/home/dialogs/08-lighting-context-lens-medium.png`; the compose screenshot visibly shows the LED strip in white above the green keyboard lighting.

### 2026-03-27T11:30:00Z

- `npm run test` passed: `420` test files, `4954` tests.
- `npm run test:coverage` passed with global coverage `93.42%` statements and `91.02%` branches, clearing the repository branch gate.
- `npm run build` passed.
- `npm run lint` passed with only pre-existing warnings from generated `android/coverage/**` files about unused eslint-disable directives; there were no lint errors in the source tree.

### 2026-03-27T09:10:00Z

- Investigated the unexpected non-overview Home PNGs by diffing working-tree images against `HEAD` with `node scripts/diff-screenshots.mjs` and spot-checking exported `HEAD` vs working-tree image pairs under `.tmp/head-vs-work/`.
- Confirmed the non-overview Home files were not prune misses: they contained real visual deltas such as changed dialog contents, different section framing, and different scroll positions.
- Restored all non-`overview` Home screenshot paths to `HEAD` so the remaining screenshot refresh set matches the current task scope: only `home/*overview*.png` variants remain modified.
