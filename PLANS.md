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
