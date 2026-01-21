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
