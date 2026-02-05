# PLANS.md - UX Consistency Updates

## Goal
Deliver the requested UX consistency changes across diagnostics, config, selection controls, playback transport, and build info.

## Non-goals
- No new features beyond the specified UX changes.
- No redesign of machine control hierarchy (Power Off remains destructive; reset/reboot unchanged).
- No API or data model changes.

## Plan
- [ ] Update diagnostics entries to default-collapsed rows across tabs.
- [ ] Show level/message/timestamp (with truncation) for error/log rows.
- [ ] Apply log level color coding.
- [ ] Strengthen diagnostics active tab styling.
- [ ] Reduce config category row padding.
- [ ] Tighten config header-to-first-control spacing.
- [ ] Bind disk list item count with “Select all”.
- [ ] Replace Build Time placeholder with fixed timestamp.
- [ ] Convert playback transport controls to icon-only, fixed four-slot layout.
- [ ] Verify machine controls hierarchy remains unchanged.

## Verification
- [ ] Diagnostics rows collapsed by default in Errors/Logs/Traces/Actions.
- [ ] Diagnostics rows show level/message/timestamp and truncate safely.
- [ ] Log levels are color-coded in light/dark themes.
- [ ] Diagnostics active tab is visually distinct.
- [ ] Config category density and spacing reduced as specified.
- [ ] Disk list count and Select all appear bound together.
- [ ] Build Time shows “2025-01-01 12:00:00 UTC” when placeholder.
- [ ] Playback transport shows 4 icon-only buttons with correct enabled/disabled states.
- [ ] Machine controls hierarchy preserved.
