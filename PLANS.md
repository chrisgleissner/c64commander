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
