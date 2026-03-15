# Review 9 Remediation Plan

Classification: `UI_CHANGE`

Scope: resolve every outstanding Review 9 display-profile issue still present in the repository, keep the review-9 remediation record current while implementing, regenerate affected screenshots, validate the changed UI and tests, then commit, push, and confirm CI passes.

## Required Reading

- [ ] Read `.github/copilot-instructions.md` before editing.
- [ ] Read `AGENTS.md` before editing.
- [ ] Read `doc/display-profiles.md` before editing profile-sensitive surfaces.
- [ ] Read `doc/ux-guidelines.md` before changing visible UI.
- [ ] Read `doc/ux-interactions.md` before changing or adding CTA coverage.
- [ ] Read `doc/architecture.md` before changing shared layout boundaries.
- [ ] Read every document in `doc/research/review-9/` before changing code or docs.

## Work Log Requirement

- [ ] Maintain `doc/research/review-9/remediation-log.md` throughout the implementation.
- [ ] Record every meaningful implementation batch, validation result, screenshot regeneration step, commit, push, and CI result.

## Issue Inventory

### Open Review 9 Issues

- [ ] Tighten Compact outer spacing by reducing Compact page padding 50% without regressing safe-area handling.
- [ ] Preserve a small visible outer inset around Compact diagnostics dialogs so the modal frame and title are not clipped.
- [ ] Capture the full Home page for Compact, Medium, and Expanded profile screenshots instead of viewport-only overviews.
- [ ] Keep Play transport metadata and controls stacked, left-aligned, and full-width in Expanded screenshots.
- [ ] Resolve the remaining documentation and typing review comments in `PLANS.md`, `ItemSelectionDialog.tsx`, `work-log.md`, and `review-9.md`.

## Phase 1 - Issue Revalidation And Planning

- [ ] Re-read the live Review 9 documents and reconcile stale findings against the current codebase.
- [ ] Update this plan as implementation decisions narrow or expand the affected surface.
- [ ] Log the issue inventory and chosen remediation strategy in `doc/research/review-9/remediation-log.md`.

## Phase 2 - Profile Branching Cleanup

- [x] Refactor `src/components/lists/SelectableActionList.tsx` to remove remaining raw breakpoint layout rules.
- [x] Refactor `src/pages/home/components/DriveManager.tsx` to use profile-aware column rules.
- [x] Refactor `src/pages/home/DriveCard.tsx` to guarantee Compact-safe metadata stacking via display-profile context.
- [x] Refactor `src/pages/home/components/StreamStatus.tsx` to replace raw breakpoint editor layout with profile-aware layout.
- [x] Refactor `src/pages/home/dialogs/SnapshotManagerDialog.tsx` to replace raw breakpoint editor layout with profile-aware layout.
- [ ] Refine `src/pages/playFiles/components/PlaybackControlsCard.tsx` so Expanded keeps the transport stack full-width and left-aligned.
- [x] Refactor `src/pages/playFiles/components/VolumeControls.tsx` to replace raw width branching with profile-aware layout.
- [x] Refactor the remaining Settings advanced-controls grid in `src/pages/SettingsPage.tsx` to use display-profile-aware layout.

## Phase 3 - Shared Contract Normalization

- [x] Move quick-action density selection into `src/components/layout/PageContainer.tsx` or another shared profile-aware boundary.
- [x] Update `src/components/QuickActionCard.tsx` to consume shared profile-aware density instead of a caller-owned `compact` prop.
- [x] Update all `QuickActionCard` call sites to remove the obsolete prop contract.
- [x] Refactor `src/components/ConfigItemRow.tsx` to consume display-profile context directly while preserving justified measurement fallbacks.
- [ ] Add or update focused regression tests for the remaining Compact spacing and Expanded transport regressions.

## Phase 4 - Verification And Guardrails

- [x] Audit existing Playwright coverage for Add disks, Shuffle, Reshuffle, Recurse folders, Home quick actions, System theme, and Test connection.
- [x] Add missing deterministic Playwright coverage for any still-uncovered flows.
- [x] Add a repository-enforced guardrail against raw breakpoint logic in the audited display-profile surfaces.
- [x] Update `doc/ux-interactions.md` so the coverage inventory matches the post-remediation reality.

## Phase 5 - Screenshot And Documentation Cleanup

- [x] Rename diagnostics screenshot outputs and README references to remove legacy `*-expanded.png` naming outside profile folders.
- [ ] Regenerate the affected screenshots under `doc/img/`, including the Compact diagnostics modal, Home profile full-page captures, and Play Expanded overview.
- [x] Update `doc/research/review-9/carry-forward.md` to reflect the resolved and remaining status after implementation.
- [ ] Reconcile `doc/research/review-9/work-log.md` and `doc/research/review-9/review-9.md` with the implementation work already completed on this branch.

## Phase 6 - Validation, Commit, Push, CI

- [ ] Run targeted unit and Playwright regression validation while implementing.
- [ ] Run `npm run lint`.
- [ ] Run `npm run test:coverage` and confirm global branch coverage is at least 91%.
- [ ] Run the required E2E validation for the changed surfaces.
- [ ] Run the screenshot regeneration flow.
- [ ] Run `npm run build`.
- [ ] Commit the completed remediation work.
- [ ] Push the branch.
- [ ] Confirm the pushed CI run passes.

## Progress

- Status: In progress. Core Review 9 remediation is implemented; final compact/layout polish, screenshot refresh, and validation remain.
- Started: 2026-03-15
- Work log: `doc/research/review-9/remediation-log.md`
- Last updated: 2026-03-15
