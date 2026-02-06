# PLANS.md - UX Consistency Updates

## Goal
Deliver the requested UX consistency changes across diagnostics, config, selection controls, playback transport, and build info.

## Non-goals
- No new features beyond the specified UX changes.
- No redesign of machine control hierarchy (Power Off remains destructive; reset/reboot unchanged).
- No API or data model changes.

## Plan
- [x] Update diagnostics entries to default-collapsed rows across tabs.
- [x] Show level/message/timestamp (with truncation) for error/log rows.
- [x] Apply log level color coding.
- [x] Strengthen diagnostics active tab styling.
- [x] Reduce config category row padding.
- [x] Tighten config header-to-first-control spacing.
- [x] Bind disk list item count with “Select all”.
- [x] Replace Build Time placeholder with fixed timestamp.
- [x] Convert playback transport controls to icon-only, fixed four-slot layout.
- [x] Verify machine controls hierarchy remains unchanged.

## Verification
- [x] Diagnostics rows collapsed by default in Errors/Logs/Traces/Actions.
- [x] Diagnostics rows show level/message/timestamp and truncate safely.
- [x] Log levels are color-coded in light/dark themes.
- [x] Diagnostics active tab is visually distinct.
- [x] Config category density and spacing reduced as specified.
- [x] Disk list count and Select all appear bound together.
- [x] Build Time shows “2025-01-01 12:00:00 UTC” when placeholder.
- [x] Playback transport shows 4 icon-only buttons with correct enabled/disabled states.
- [x] Machine controls hierarchy preserved.

---

# PLANS.md - Green Local + CI Build

## Goal
Get a green local build (unit, Playwright, Maestro, Android) and a green CI build with refreshed screenshots.

## Non-goals
- No feature work beyond fixing tests/builds.
- No refactors unrelated to failures.

## Plan
- [ ] Identify failing commit from CI run 21731474317 and diff against current branch.
- [ ] Run local test suite: unit, Playwright, Maestro, Android JVM.
- [ ] Fix root causes for any failures and update screenshots/traces as required.
- [ ] Re-run full local verification: lint, test, Playwright, Maestro, build.
- [ ] Push changes and confirm CI is green.

## Verification
- [ ] `npm run lint` passes locally.
- [ ] `npm run test` passes locally.
- [ ] `npm run test:e2e` passes locally with updated screenshots/traces.
- [ ] Maestro flows pass locally.
- [ ] `npm run build` passes locally.
- [ ] Android JVM tests pass locally (`cd android && ./gradlew test`).
- [ ] CI run is green with updated screenshots.

---

# PLANS.md - CI Regression Isolation and Forward Reapplication

## Reference Build
- [x] Capture run URL and timestamp: https://github.com/chrisgleissner/c64commander/actions/runs/21730870307 (started 2026-02-05T22:26:30Z, completed 2026-02-05T22:39:38Z)
- [x] Record workflow name and job list: Build Android APK; jobs = Web | Build (coverage), Web | Unit tests (coverage), Android | Tests + Coverage, Android | Maestro gating, Web | Screenshots, Web | E2E (sharded) (1-8), Android | Packaging, Web | Coverage + evidence merge, Release | Attach APK/AAB.

## Last Known Good Commit
- [x] Record commit SHA from reference build: ae5076518cf586235db894e34a158d1f57135daa
- [x] Record commit timestamp: 2026-02-05T22:26:25+00:00

## First Failing Commit
- [x] Identify next commit after last known good: 616dd3c205e9918a75b12215b42d20b118063a20
- [x] Confirm it is the first failing build: Build Android APK run 21731474317 failed for 616dd3c205e9918a75b12215b42d20b118063a20.
- [x] Record failing commit SHA and timestamp: 616dd3c205e9918a75b12215b42d20b118063a20 at 2026-02-05T22:49:18+00:00

## Diff Preservation
- [x] Generate full diff between last known good and current HEAD.
- [x] Save diff to ci-regression-diff.patch (read-only reference).
- [x] Commit diff file.

## Reapplication Steps
- [ ] Reset branch to last known good commit.
- [ ] Reapply changes in smallest logical units.
- [ ] On first failure, rollback the offending change and mark excluded.
- [ ] Continue until all safe changes are reapplied.

## Test Gates
- [ ] Run full unit tests after each reapplication.
- [ ] Record pass/fail status after each step.
- [ ] Stop immediately on first regression.

## Final Verification
- [ ] Run full local test suite (lint, unit, e2e, build, Android JVM).
- [ ] Push branch and confirm CI is green.
- [ ] Create final clean commit with summary and exclusions.
