# HVSC Workflow Convergence Worklog

## 2026-03-28T00:00:00Z

### Task start and classification

- Classified the task as `CODE_CHANGE` with possible `DOC_PLUS_CODE` follow-up only if validation or operator documentation needs to change after the implementation is verified.
- Confirmed `PLANS.md` and `WORKLOG.md` already exist in the repo and added a dedicated HVSC convergence section rather than replacing prior history.
- Began the mandated read pass across repo guidance, UX, Maestro, HVSC runtime, playlist, Android ingest, existing tests, and `c64scope` playback proof files.

### Initial observations

- Prior repo memory confirms the browser HVSC availability gate may be too broad in web contexts, so current UI affordances cannot be treated as proof of native workflow readiness.
- The required terminal state depends on real Pixel 4 plus real C64U availability; that will be tested explicitly during HIL preflight rather than assumed.

### Next steps

- Finish the required file audit and map the actual HVSC ingestion, browse, metadata, playback, and proof paths before editing code.
# Health Badge Overflow Fix Worklog

## 2026-03-28T11:14:41Z

### Implementation completed

- Inspected the required execution and UI files: `README.md`, `.github/copilot-instructions.md`, `AGENTS.md`, `docs/ux-guidelines.md`, `src/components/UnifiedHealthBadge.tsx`, `src/lib/diagnostics/healthModel.ts`, `src/components/AppBar.tsx`, `tests/unit/components/UnifiedHealthBadge.test.tsx`, `tests/unit/lib/diagnostics/healthModel.test.ts`, `playwright/connectionStatusLayout.spec.ts`, `playwright/layoutOverflow.spec.ts`, `playwright/screenshots.spec.ts`, `playwright/displayProfileViewports.ts`, `src/hooks/useHealthState.ts`, and `playwright/visualSeeds.ts`.
- Refactored `src/lib/diagnostics/healthModel.ts` so one shared badge text contract drives visible leading text, capped counts, and trailing health/problem text; visible counts now cap at `999+` without changing the underlying `problemCount` value.
- Updated `src/components/UnifiedHealthBadge.tsx` to render from the shared formatter contract and added badge-local overflow containment with `min-w-0`, `max-w-full`, `overflow-hidden`, and trailing-span truncation while preserving click behavior and badge markers.
- Added deterministic unit regression coverage in `tests/unit/lib/diagnostics/healthModel.test.ts` and `tests/unit/components/UnifiedHealthBadge.test.tsx` for profile grammar, count capping, offline/not-yet-connected copy, no duplicated count rendering, and overflow safety classes.
- Added shared badge trace seeding in `playwright/visualSeeds.ts`, a targeted `/settings` overflow regression in `playwright/layoutOverflow.spec.ts`, and a header-only screenshot matrix in `playwright/screenshots.spec.ts`.

### Issues encountered and resolved

- `npm run lint` initially failed because `playwright/layoutOverflow.spec.ts` needed Prettier formatting.
- Resolved with `npx prettier --write playwright/layoutOverflow.spec.ts`, then reran lint successfully.

### Commands and results

- `npx vitest run tests/unit/lib/diagnostics/healthModel.test.ts tests/unit/components/UnifiedHealthBadge.test.tsx` — passed (`2` files, `89` tests).
- `npx playwright test playwright/layoutOverflow.spec.ts -g "settings header badge avoids overflow" --reporter=line` — passed (`2` tests).
- `npx playwright test playwright/screenshots.spec.ts -g "capture settings header badge screenshots" --reporter=line` — passed (`1` test).
- `npm run lint` — passed; only pre-existing warnings remain in generated `android/coverage/**` files.
- `npm run test` — passed (`429` files, `4995` tests).
- `npm run test:coverage` — passed; computed global coverage from `coverage/coverage-final.json` after the run: statements `93.48%`, branches `91.02%`, functions `89.71%`, lines `93.48%`.
- `npm run build` — passed.

### Screenshot files written

- `docs/img/app/settings/header/badge-compact-healthy.png`
- `docs/img/app/settings/header/badge-compact-degraded-12.png`
- `docs/img/app/settings/header/badge-compact-degraded-999plus.png`
- `docs/img/app/settings/header/badge-compact-unhealthy-12.png`
- `docs/img/app/settings/header/badge-compact-unhealthy-999plus.png`
- `docs/img/app/settings/header/badge-medium-healthy.png`
- `docs/img/app/settings/header/badge-medium-degraded-12.png`
- `docs/img/app/settings/header/badge-medium-degraded-999plus.png`
- `docs/img/app/settings/header/badge-medium-unhealthy-12.png`
- `docs/img/app/settings/header/badge-medium-unhealthy-999plus.png`
- `docs/img/app/settings/header/badge-expanded-healthy.png`
- `docs/img/app/settings/header/badge-expanded-degraded-12.png`
- `docs/img/app/settings/header/badge-expanded-degraded-999plus.png`
- `docs/img/app/settings/header/badge-expanded-unhealthy-12.png`
- `docs/img/app/settings/header/badge-expanded-unhealthy-999plus.png`

## 2026-03-28T10:51:32Z

### Task start and classification

- Classified this task as `UI_CHANGE` and `CODE_CHANGE` because it changes executable header UI behavior, regression coverage, and targeted documentation screenshots.
- Confirmed the active branch already contains unrelated prompt work in `docs/prompts/health-badge-overflow-fix.md`; that file is being left untouched.
- Updated `PLANS.md` with the implementation scope, validation contract, and screenshot boundary before reading the feature files.
- Next step: read the required badge, formatter, test, and screenshot files; then map the smallest possible implementation surface.

# Interstitial, Header, and Density Refactor Worklog

## 2026-03-28T00:35:00Z

### Overlay and scroll containment completed

- Replaced the fixed interstitial z-level model with registration-based overlay depth tracking in `src/components/ui/interstitial-state.tsx` and depth-aware backdrop/surface helpers in `src/components/ui/interstitialStyles.ts`.
- Updated shared dialogs, alert dialogs, app surfaces, and the add-items progress overlay to publish per-layer depth metadata, opacity, and deterministic z-index ordering.
- Moved sticky-shell pages onto a bounded flex column where `PageContainer` owns scrolling and `SwipeNavigationLayer` reserves the fixed tab-bar band instead of relying on per-page bottom padding hacks.
- Migrated the Docs page onto the shared `PageContainer` so every primary tab now follows the same header-to-content-to-tab-bar geometry.

### Validation completed

- `npm run lint` passed. The only reported warnings are pre-existing generated warnings under `android/coverage/**`.
- `npm run build` passed for the runtime code changes.
- `npm run test:e2e` passed with `416 passed` and `1 skipped` after updating stale connection assertions and the viewport validator.
- `npm run maestro:gating` passed after bootstrapping `ANDROID_AVD_HOME` in `scripts/run-maestro-gating.sh`.
- `npm run screenshots` passed with `20 passed`; prune summary was `scanned=128 reverted=0 deleted=0 kept=128`.
- Final `npm run test:coverage` passed with `428` test files and `5010` tests green, plus global coverage at `93.47%` statements and `91.01%` branches.

### Screenshot refresh scope

- The shared shell and overlay changes visibly affected screenshots across the primary page families, so the refreshed documentation images were limited to the impacted folders under `docs/img/app/`: `home`, `play`, `disks`, `config`, `settings`, `docs`, and `diagnostics`.

## 2026-03-27T22:40:00Z

### Overlay and scroll containment audit started

- Classified the task as `UI_CHANGE` and `CODE_CHANGE` because it changes shared executable UI behavior.
- Audited the current shell entry in `src/App.tsx`, swipe-runway layout in `src/components/SwipeNavigationLayer.tsx`, bottom navigation in `src/components/TabBar.tsx`, and shared overlay primitives in `src/components/ui/dialog.tsx`, `sheet.tsx`, and `popover.tsx`.
- Confirmed the current overlay model still uses fixed shared z-levels (`INTERSTITIAL_Z_INDEX.backdrop` and `.surface`) rather than per-depth registration, which cannot satisfy hierarchical dimming for nested overlays.
- Confirmed the shell still mounts the tab bar as a global fixed layer while route content manages most of its own vertical space, which is the likely root cause for content bleeding behind the header and bottom navigation.
- Created `PLANS.md` to lock the implementation scope, detection strategy, and validation contract before code changes.

### Next execution slice

- Patch the shared overlay state and styling layer to provide deterministic depth registration and per-level backdrop opacities.
- Patch the shared app shell so scrolling is constrained to a single explicit viewport between the header band and bottom navigation band.

## 2026-03-27T22:15:00Z

### Close control standardization

- App sheets, app dialogs, shared dialogs, and alert dialogs now render one shared plain-glyph `CloseControl` instead of the old wrapped icon button.
- Close controls are injected from the shared header primitives so titles and dismiss controls share one row contract across Diagnostics, Lighting Studio, item selection, and the general dialog surfaces.
- Lighting Studio now opens without a drag handle, collapse toggle, or top spacer, and Diagnostics now renders its overflow menu and close control on the same header row.

### Registration and overlap fixes

- Fixed a real regression where hidden Radix content registered as active interstitial state on page load, which incorrectly suppressed the tab bar and intercepted badge clicks.
- Changed interstitial ownership registration to follow `data-state="open"` on mounted overlay content instead of registering on mount.
- Tightened workflow sheet top clearance to the actual badge band so Diagnostics and Lighting Studio use the intended controlled overlap instead of clearing the full app-header height.

### Validation in progress

- Focused Vitest suites now pass for close-control rendering, tab-bar suppression, and shared interstitial geometry.
- Targeted Playwright regressions now pass for Diagnostics/modal consistency and Lighting Studio after updating stale overlap/layout assertions to the new contract.

## 2026-03-27T21:28:49Z

### Audit and classification

- Classified the task as `DOC_PLUS_CODE` and `UI_CHANGE` because it changes shared overlay primitives, header layout, navigation behavior, docs, tests, and screenshots.
- Audited the current shared surface stack in `src/components/ui/app-surface.tsx`, `src/components/ui/dialog.tsx`, `src/components/ui/alert-dialog.tsx`, `src/components/ui/interstitialStyles.ts`, and `src/components/ui/useCenteredOverlayPosition.ts`.
- Confirmed the current implementation already separates source chooser modal and source browser sheet, so that flow will be preserved rather than rewritten.
- Identified the main contract gaps: backdrops and surfaces currently share the same z-level, the header renders above surfaces instead of below them, safe-area top handling is split between `pt-safe` and token padding, bottom-nav suppression is not globally owned, and progress overlays still use an older badge-floor rule.

### Implementation scope locked

- Locked the active workset to the shared overlay primitives, `AppBar`, `UnifiedHealthBadge`, `TabBar`, `SwipeNavigationLayer`, shared list density primitives, overlay regression tests, UX guidelines, and the impacted screenshot set including Lighting Studio.
- Chose to introduce a global overlay ownership model so header interactivity, nav suppression, and backdrop/surface stacking are driven by one source of truth instead of per-surface conditionals.

---

# Overlay, Header, and Subtitle Standardization Worklog

## 2026-03-27

### Audit and scope

- Classified the task as `DOC_PLUS_CODE` and `UI_CHANGE` because it touches executable UI code, docs, tests, and screenshots.
- Audited shared overlay primitives (`app-surface.tsx`, `dialog.tsx`, `alert-dialog.tsx`, `interstitialStyles.ts`), the shared AppBar, main pages, and the item-selection flow.
- Confirmed some badge-safe-zone logic already existed, then mapped the missing centered-dialog and progress-overlay coverage.

### Shared overlay implementation

- Extended `src/components/ui/interstitialStyles.ts` with explicit badge-safe-zone bounds, centered-overlay layout math, and bounds-aware runtime assertions.
- Added `src/components/ui/useCenteredOverlayPosition.ts` so centered dialogs use the same badge-safe layout contract as sheets.
- Moved `app-surface.tsx`, `dialog.tsx`, `alert-dialog.tsx`, and modal presentation classes onto the shared centered positioning system.

### Subtitle removal and header standardization

- Removed visible AppBar subtitle rendering and standardized the header row around a shared left-title/right-badge layout.
- Removed page subtitle usage from Home, Play Files, Disks, Config Browser, Settings, and Docs.
- Simplified item-selection labels from `Select items from X` to `From X`, shortened `Local Device` to `Local`, and removed the visible `Path:` prefix.
- Repositioned the add-items progress overlay below the badge band.
- Increased the Home logo size substantially while preserving shared header alignment.
- Removed remaining visible helper-subtitle lines from interactive Settings controls.

### Regression updates

- Updated unit tests covering AppBar layout, item selection, Home header behavior, ItemSelectionView path labeling, and overlay safe-zone assertions.
- Updated Playwright expectations for source-button labels, import-flow headings, and source path rendering.

### Documentation

- Updated `docs/ux-guidelines.md` with the badge-safe overlay contract, the no-visible-subtitles rule, and the shared header layout standard.

### Validation completed

- Ran `npm run lint` successfully; only pre-existing warnings remain in generated Android coverage report files.
- Ran `npm run test:coverage` after the final dialog-hook fix and confirmed `91.04%` global branch coverage.
- Ran `npm run build` successfully.
- Regenerated the targeted screenshot set for Home, Play, Play import flow, Disks, Config, Settings, and Docs, including their profile/section images produced by the corresponding screenshot specs.
- Fixed a late-ref centered-dialog regression discovered during screenshot validation and added a dedicated regression test for the delayed ref-attachment path in `useCenteredOverlayPosition`.

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
- Restored `docs/img/app` and reran only the Home-focused screenshot tests; the resulting screenshot diffs were confined to `docs/img/app/home/**`, which is consistent with the requested Home-only refresh plus concurrent Home button work on the branch.

### 2026-03-27T09:00:00Z

- A repeated Home-only rerun still changed a subset of Home PNG hashes (`home/dialogs/04-restore-confirmation.png`, `home/interactions/01-toggle.png`, `home/sections/04-printers-to-sid.png`, `home/sections/05-sid-to-config.png`, `home/sid/01-reset-post-silence.png`), so Home determinism is not fully resolved yet.
- Concurrent branch activity is still present in Home/telnet files (`src/hooks/useTelnetActions.ts`, `src/lib/telnet/telnetClient.ts`, related tests), so the current screenshot hash drift cannot yet be treated as a final no-op rerun proof.

## Lighting Studio ASCII LED refinement

### 2026-03-27T10:05:00Z

- Reclassified the new task as `DOC_PLUS_CODE` and `UI_CHANGE` because it touches executable preview code, visible Lighting Studio output, screenshots, and planning records.
- Confirmed the current Lighting Studio device preview is still hard-coded inside `src/components/lighting/LightingStudioDialog.tsx` rather than derived from the ASCII layout.
- Verified the amended authoritative geometry already exists in the repository at `src/assets/lighting/c64-layout.txt`, and measured the new grid as `67 x 15` with the LED strip at row `2`, columns `58-59`.

### 2026-03-27T10:10:00Z

- Mapped the active validation surfaces before editing: the preview unit tests in `tests/unit/components/lighting/LightingStudioDialog.preview.test.tsx`, the broader dialog tests in `tests/unit/components/lighting/LightingStudioDialog.test.tsx`, the interactive Playwright checks in `playwright/lightingStudio.spec.ts`, and the screenshot capture in `playwright/screenshots.spec.ts`.
- Confirmed that the existing tests only cover presence/layout of the old hard-coded blocks and do not currently prove ASCII classification or LED color isolation.
- Began the implementation phase to replace the hard-coded geometry with parsed ASCII-backed SVG layers while preserving the current dialog/bottom-sheet behavior.

### 2026-03-27T10:35:00Z

- Added `src/assets/lighting/c64-layout.txt` as the authoritative ASCII source consumed by the app-side preview parser.
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
