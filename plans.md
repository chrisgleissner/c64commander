# Disks UX Consistency + Screenshots-only Build Plan

## 1) Baseline
- [ ] Capture current Play/Disks UI behavior (button labels, filter placement).
- [ ] Identify current tests that cover Play/Disks headers and import flows.
- [ ] Record local-build.sh current screenshots/test flow and help output.

## 2) Tests first (red)
- [ ] Add/update Playwright assertions for Play/Disks button labels, filter placement, and import flow.
- [ ] Add coverage to ensure non-matching items are removed (no dimming) in Play/Disks lists.
- [ ] Add structural layout consistency assertion between Play and Disks.

## 3) UI consistency fixes
- [ ] Keep Play primary button label as “Add items” / “Add more items” (amended requirement).
- [ ] Update Disks primary button label to “Add disks”.
- [ ] Move Disks filter input under list header (no filter under page header).
- [ ] Ensure Disks uses Play-style list header layout without file type toggles.
- [ ] Remove dimming: hide non-matching items in Play/Disks lists.

## 4) Screenshots-only build mode
- [ ] Add --screenshots-only option to local-build.sh (no tests, no APK).
- [ ] Ensure screenshots-only validates build artifacts or builds web assets.
- [ ] Update --help output with new option semantics.
- [ ] Document usage in README.md or doc/developer.md.

## 5) Verification
- [ ] Run targeted Playwright test(s) for Play/Disks header/layout assertions.
- [ ] Run ./local-build.sh --screenshots-only.
- [ ] Run ./local-build.sh --screenshots to ensure legacy behavior unchanged.
- [ ] Mark all items complete only when verified green.