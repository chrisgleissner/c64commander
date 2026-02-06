# PLANS.md - Critical UX, Playback, Navigation, and FTP Performance Fixes

## Execution Loop
- [x] 1. Establish baseline and failing coverage for A-F.
  - Success criteria:
    - Existing relevant tests are identified and executed.
    - New failing tests are added for each required behavior gap.
    - Baseline failures are reproducible locally.

## A. Diagnostics Overlay Navigation Bug
- [x] 2. Convert diagnostics open behavior to true modal overlay without route changes.
  - Success criteria:
    - Tapping diagnostics activity indicator does not call route navigation.
    - Current route and scroll position remain unchanged while opening diagnostics.
    - Closing diagnostics returns to exact prior page/state.

- [x] 3. Add diagnostics navigation/scroll regression tests.
  - Success criteria:
    - Playwright coverage opens diagnostics from multiple pages and verifies pathname stability.
    - Scroll position before opening equals scroll position after close.

## B. Playback Volume UX and Mute Snapshot Model
- [x] 4. Fix playback volume slider state model and labeling.
  - Success criteria:
    - Slider label is "Playback volume" or "Session volume".
    - Slider reflects effective runtime playback volume and does not snap back during updates.
    - Slider state persists correctly across page navigation and overlays.
    - Volume updates do not modify SID enablement/addressing fields.

- [x] 5. Implement strict mute snapshot restore invariants.
  - Success criteria:
    - Mute captures pre-mute SID state required for exact restoration.
    - Unmute restores exactly the captured pre-mute state.
    - Only affected SID volume entries are changed.

- [x] 6. Add/extend tests for volume + mute invariants.
  - Success criteria:
    - Unit and/or Playwright tests verify exact mute/unmute restoration.
    - Tests verify no SID enablement/addressing corruption from playback volume control.

## C. Catastrophic Playback Auto-Advance Bug
- [x] 7. Refactor auto-advance to deterministic single-shot time-based guards.
  - Success criteria:
    - Auto-advance can fire at most once per track instance.
    - Auto-advance is based only on known/resolved track end time.
    - Polling glitches/transient states do not trigger advancement.

- [x] 8. Enforce user-advance guard + play request serialization.
  - Success criteria:
    - User Next/Previous/select always trigger immediate transition logic.
    - Automatic advancement for prior track is cancelled once user advances.
    - Play requests are serialized/coalesced so only one play transition request is in-flight.

- [x] 9. Add/extend tests for auto-advance and request flood protection.
  - Success criteria:
    - Auto-advance fires exactly once at end.
    - No duplicate/cascading transitions occur.
    - One transition produces one play request sequence.

## D. Playlist Currently Playing Indicator
- [x] 10. Implement confirmed-playback driven row highlight and icon highlight.
  - Success criteria:
    - Entire currently playing row is highlighted.
    - Play icon has secondary highlight.
    - Selection state remains visually distinct from playback state.
    - Only one row can be playback-highlighted.

- [x] 11. Add/extend tests for playback-state-driven highlight updates.
  - Success criteria:
    - Manual play highlights correct row.
    - Next/Previous and auto-advance update highlight correctly.
    - Playback failure clears/updates highlight appropriately.

## E. FTP File Browser Interaction Model
- [x] 12. Redesign item rows: row tap navigates folders, checkbox selects, no Open button.
  - Success criteria:
    - "Open" icon/button is removed.
    - Folder row tap (outside checkbox) navigates.
    - Checkbox selection does not navigate.
    - Folders show folder icon + subtle chevron; files have no chevron.
    - Thin horizontal dividers are rendered between all rows.

- [x] 13. Add/extend tests for FTP browser interactions and affordances.
  - Success criteria:
    - Folder row tap navigates.
    - Folder checkbox selects recursively without navigation.
    - Files select via checkbox and do not navigate.
    - Tests assert no "Open" control remains.

## F. FTP Performance Regression
- [x] 14. Remove/disable costly FTP songlengths discovery/read paths by default and optimize scan flow.
  - Success criteria:
    - No FTP file content reads occur during normal folder add-to-playlist scanning.
    - MD5-based duration lookup is not triggered for FTP sources by default.
    - FTP throttling remains configurable and defaults stay safe/sane.

- [x] 15. Add FTP performance regression tests.
  - Success criteria:
    - Tests verify zero unnecessary `/v1/ftp/read` calls during FTP folder add.
    - Tests verify folder add of tens of files completes within an acceptable bound.

## Final Verification
- [x] 16. Run full validation and finalize plan.
  - Success criteria:
    - `npm run test` passes.
    - `npm run lint` passes.
    - `npm run build` passes.
    - Relevant Playwright specs pass.
    - PLANS.md is fully checked with accurate completion notes.

## Completion Notes
- Verified:
  - `npm run test` -> pass (`118` files, `685` tests)
  - `npm run lint` -> pass
  - `npm run build` -> pass
  - `npm run validate:traces` -> pass
  - Playwright targeted suites for diagnostics, FTP UX/perf, playback, navigation, layout, and UI -> pass (`147/147`)
