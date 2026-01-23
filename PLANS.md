# Playwright Evidence Plan

Status: In progress. No item may be checked off until tests pass with evidence artifacts and CI uploads are verified.

## A) Remote browsing remembers last path + root shortcut

- [ ] Audit UX and state persistence
- [ ] Fix regressions
- [ ] Add/confirm E2E test coverage
- [ ] Add ordered screenshots per step
- [ ] Assert path persistence + root navigation

## B) Local add returns to correct page

- [ ] Audit add-items flow (Play + Disks)
- [ ] Fix regressions
- [ ] Add/confirm E2E test coverage
- [ ] Add ordered screenshots per step
- [ ] Assert post-add landing page

## C) UI never exceeds viewport width

- [ ] Audit long-path rendering
- [ ] Fix regressions
- [ ] Add/confirm E2E test coverage
- [ ] Add ordered screenshots per step
- [ ] Assert no horizontal overflow

## D) Single close button in Mount overlay

- [ ] Audit dialog markup
- [ ] Fix regressions
- [ ] Add/confirm E2E test coverage
- [ ] Add ordered screenshots per step
- [ ] Assert single close control

## E) Reset/Refresh icons at top of config groups

- [ ] Audit DOM order and layout
- [ ] Fix regressions
- [ ] Add/confirm E2E test coverage
- [ ] Add ordered screenshots per step
- [ ] Assert action buttons above list

## F) Playlist parity with Disks list

- [ ] Audit selection controls and labels
- [ ] Fix regressions
- [ ] Add/confirm E2E test coverage
- [ ] Add ordered screenshots per step
- [ ] Assert select-all/remove-selected parity

## G) Consolidated reusable list component

- [ ] Audit shared component usage
- [ ] Fix regressions
- [ ] Add/confirm E2E test coverage
- [ ] Add ordered screenshots per step
- [ ] Assert Play/Mount actions + view-all behavior

## H) Playback controls professional and stable

- [ ] Audit control states and layout
- [ ] Fix regressions
- [ ] Add/confirm E2E test coverage
- [ ] Add ordered screenshots per step
- [ ] Assert no positional shifts, correct enable/disable

## Evidence + CI

- [ ] Validate evidence folders locally
- [ ] Validate evidence folders in CI
- [ ] Confirm playwright-evidence artifact download
- [ ] Confirm playwright-report artifact download

---

# Production Release Blockers (Jan 2026)

Status: In progress. All three issues must be fully resolved with tests, evidence screenshots, and green CI before completion.

## 1) Local device add-items flow (Android picker)

- [ ] Trace add-items flow for local sources (Play + Disks) and identify where progress overlay is attached
- [ ] Ensure Android picker results treat selected folder as root and recurse all subfolders
- [ ] Ensure interstitial is skipped and destination page shows progress overlay
- [ ] Ensure overlay shows real scanning progress and closes on completion
- [ ] Add Playwright E2E for local add flow with deep folder structure
- [ ] Capture required screenshots: before, overlay during scan, after items added

## 2) Horizontal overflow / unusable UI

- [ ] Audit all file-name rendering surfaces (browsers, playlists, disks, disk volumes, lists/grids)
- [ ] Constrain widths and apply wrap/ellipsis consistently across components
- [ ] Ensure CTAs remain within viewport on all orientations
- [ ] Expand overflow Playwright coverage to cover long names in all relevant views

## 3) Disk groups: visibility, selection, auto-grouping

- [ ] Restore group label + color beneath each grouped disk in all views
- [ ] Add context menu flow to pick existing group or create inline
- [ ] Implement auto-grouping on scan for shared prefixes (case-insensitive, trailing nums/letters)
- [ ] Add unit tests for prefix grouping heuristics
- [ ] Add E2E coverage for group visibility + assignment + auto-grouping
