# HVSC Workflow Real-Device Execution Plan (2026-03-28T22:02:57+00:00)

## Classification

- `CODE_CHANGE`
- `UI_CHANGE`

## Control State

- Branch: `fix/hvsc-workflow`
- Device serial: `9B081FFAZ001WX`
- Android package: `uk.gleissner.c64commander`
- C64U host: `192.168.1.167`
- Expected ports: HTTP `80`, FTP `21`, Telnet `23`
- Real HIL entrypoint: `npm run hil:evidence` in `c64scope/`

## Authoritative Task List

1. [ ] Verify repo control state and read the current runtime-critical files.
2. [ ] Verify the installed app version on the Pixel 4 and launch the current app build.
3. [ ] Prove Settings shows host, HTTP port, FTP port, and Telnet port, visible and editable, with captured evidence.
4. [ ] Prove Telnet target construction uses bare host plus explicit Telnet port.
5. [ ] Prove Home primary reboot uses REST, not Telnet.
6. [ ] Reproduce on-device health state and capture diagnostics evidence for `TELNET`, `CONFIG`, and the top-right badge.
7. [ ] Fix any remaining runtime defects blocking `TELNET`, `CONFIG`, or `HEALTHY`.
8. [ ] Rebuild, reinstall, and re-verify on the real Pixel 4 after each meaningful fix.
9. [ ] Run the real HVSC download -> ingest -> playlist -> playback flow against the real C64U.
10. [ ] Capture real streamed-audio verification evidence under `artifacts`.
11. [ ] Run the smallest honest validation set for all touched code, including targeted tests and `npm run lint`, `npm run test:coverage`, and `npm run build` if code changes land.
12. [ ] Re-read this plan and `WORKLOG.md`; confirm every acceptance check with current evidence before stopping.

## Acceptance Checks

- [ ] Settings screen shows host, HTTP port, FTP port, and Telnet port, visible and editable.
- [ ] Telnet target is built from bare host plus explicit Telnet port.
- [ ] Home primary reboot uses REST.
- [ ] `TELNET` health check passes.
- [ ] `CONFIG` health check passes.
- [ ] App badge is `HEALTHY`.
- [ ] Real HVSC download completes on the Pixel 4.
- [ ] Real HVSC ingest completes.
- [ ] A real HVSC track is added to playlist.
- [ ] Playback starts on the real C64U.
- [ ] Streamed-audio verification succeeds with captured evidence.
- [ ] Evidence is stored under `artifacts`.
- [ ] `WORKLOG.md` is complete and timestamped throughout the run.
- [ ] Touched-code validation was run honestly.
- [ ] Build is green, or an exact unrelated blocker is proven.

# HVSC Workflow Convergence + Real-Device Validation Plan (2026-03-28 Run 2)

## Current state (verified 2026-03-28T20:30Z)

- Branch: `fix/hvsc-workflow` HEAD `2d6f57b5`
- Device: Pixel 4 serial `9B081FFAZ001WX` running `0.6.5-rc1` (needs fresh build/install)
- C64U: `192.168.1.167` / hostname `c64u`
- `deviceControl.ts` verified: all operations use REST exclusively
- `healthCheckEngine.ts` verified: Telnet probe uses `stripPortFromDeviceHost()` + `getStoredTelnetPort()`
- `SettingsPage.tsx` verified: Telnet port field visible/editable
- Package.json version: `0.6.5-rc1`

## Task list with status

### Phase A – Build and deploy

- [ ] A1: Run `./build --skip-tests --skip-format --install-apk --device-id 9B081FFAZ001WX`
- [ ] A2: Verify `versionCode` advanced and app launched on device

### Phase B – Device verification

- [ ] B1: Screenshot Settings page – confirm Host, HTTP port, FTP port, Telnet port visible
- [ ] B2: Confirm Telnet target = bare host + explicit Telnet port (no double-port)
- [ ] B3: Trigger health check; capture Diagnostics screenshot
- [ ] B4: Confirm TELNET probe passes
- [ ] B5: Confirm CONFIG probe passes (or diagnose failure)
- [ ] B6: Badge reaches HEALTHY

### Phase C – HVSC end-to-end flow (only after badge HEALTHY)

- [ ] C1: Locate c64scope HIL entrypoint
- [ ] C2: Run `AF-HVSC-DOWNLOAD-PLAY-001` HIL case
- [ ] C3: Capture download proof
- [ ] C4: Capture ingest proof
- [ ] C5: Capture playlist addition proof
- [ ] C6: Capture playback proof
- [ ] C7: Capture streamed-audio verification proof

### Phase D – Validation and closeout

- [ ] D1: Run `npm run lint && npm run test:coverage && npm run build`
- [ ] D2: Confirm branch coverage ≥ 91%
- [ ] D3: Update WORKLOG.md final entry
- [ ] D4: Verify all acceptance criteria

## Acceptance criteria

1. Settings: Host, HTTP, FTP, Telnet port fields visible and editable
2. Telnet target = bare host + explicit Telnet port
3. Home reboot uses REST (verified by code inspection + trace)
4. TELNET health check passes
5. CONFIG health check passes
6. Badge = HEALTHY
7. HVSC download completes
8. HVSC ingest completes
9. Track added to playlist
10. Playback starts on C64U
11. Streamed-audio verification passes with evidence
12. WORKLOG.md complete and timestamped
13. All touched-code tests pass, coverage ≥ 91%

# HVSC Workflow Convergence Plan

## Classification

- `CODE_CHANGE`
- escalate to `DOC_PLUS_CODE` only if validation or operator docs must change to match the final implementation

## Required Outcome

- Fix the real HVSC workflow so the app uses one reliable ingestion and browse source of truth.
- Preserve HVSC metadata through selection, playlist import, persistence, and playback.
- Strengthen CI-safe regression coverage across web/runtime, playlist scale, and Android-native ingest.
- Attempt real HIL validation on a physical Pixel 4 against a real C64U with `c64scope` audio proof.
- End only in `COMPLETE`, `FAILED`, or `BLOCKED`.

## Execution Plan

1. Read the mandated repo, UX, Maestro, HVSC, playback, playlist, Android, Playwright, and `c64scope` files.
2. Map the current source of truth for HVSC ingest, browse, import, playlist persistence, playback routing, and HIL proof.
3. Identify the concrete root cause(s), especially metadata loss, store divergence, or large-list materialization.
4. Implement the smallest coherent fix in app and native layers.
5. Add dedicated regression coverage for every confirmed bug fixed.
6. Run CI-safe validation: `npm run lint`, `npm run test`, `npm run test:coverage`, `npm run build`, `cd android && ./gradlew test`, plus any focused suites needed while iterating.
7. Run HIL preflight for attached Android hardware and C64U reachability.
8. If preflight passes, execute cold, warm-cache, and large-playlist HIL runs with `c64scope` audio capture and archive artifacts.
9. Record all evidence in `WORKLOG.md` and report the terminal state precisely.

## Open Questions To Resolve During Audit

- Does the JS HVSC browser query the same native-ingested store that Android ingest populates?
- Where do duration, song length, and subsong fields first enter the app model, and where can they be dropped?
- Does the current HVSC browser or playlist flow materialize too much data in memory for large folders or playlists?
- What existing coverage proves only mock/web behavior versus native ingest and true hardware playback?
- Are current HIL primitives sufficient to correlate app-driven playback with captured C64U audio?

# Health Badge Overflow Fix Plan

## Classification

- `UI_CHANGE`
- `CODE_CHANGE`
- documentation asset refresh limited to `docs/img/app/settings/header/`

## Affected Files

- `src/components/UnifiedHealthBadge.tsx`
- `src/lib/diagnostics/healthModel.ts`
- `src/components/AppBar.tsx` only if required for badge shrink behavior
- `tests/unit/components/UnifiedHealthBadge.test.tsx`
- `tests/unit/lib/diagnostics/healthModel.test.ts`
- `playwright/connectionStatusLayout.spec.ts` or `playwright/layoutOverflow.spec.ts`
- `playwright/screenshots.spec.ts`
- `playwright/displayProfileViewports.ts` if existing helpers require extension
- `docs/img/app/settings/header/`
- `WORKLOG.md`

## Implementation Order

1. Read the required repo guidance, badge implementation, shared formatter, tests, and screenshot harness.
2. Confirm the exact badge text contract and the smallest badge-local overflow containment change.
3. Refactor the shared formatter in `healthModel.ts` so visible text rules and count capping live in one place.
4. Update `UnifiedHealthBadge.tsx` to consume the shared formatter contract and add badge-local overflow safety.
5. Touch `AppBar.tsx` only if the current flex row prevents the badge from shrinking.
6. Add deterministic unit regression coverage for formatter output and rendered badge DOM behavior.
7. Add one targeted Playwright overflow regression for the header on `/settings`.
8. Extend the screenshot harness to capture only the settings header badge matrix into `docs/img/app/settings/header/`.
9. Run required validation: `npm run lint`, `npm run test`, `npm run test:coverage`, `npm run build`, targeted Playwright regression, targeted screenshot generation.
10. Update `WORKLOG.md` with evidence, outputs, screenshot paths, and any issues resolved.

## Test Plan

- Unit: expand `tests/unit/lib/diagnostics/healthModel.test.ts` with profile, health-state, and count-capping coverage.
- Unit: expand `tests/unit/components/UnifiedHealthBadge.test.tsx` with DOM assertions for nowrap, overflow containment, text rendering, and click behavior.
- Browser: add one deterministic `/settings` header overflow regression proving no badge, header-row, or page-level horizontal overflow in compact and medium worst cases.
- Validation: run `npm run lint`, `npm run test`, `npm run test:coverage`, and `npm run build`.

## Screenshot Plan

- Use the existing Playwright screenshot harness.
- Capture only the settings header area containing the title and badge.
- Regenerate only `docs/img/app/settings/header/`.
- Cover the required compact, medium, and expanded cases for healthy, degraded, and unhealthy visible outputs, including `999+` capping.

## Completion Checklist

- [x] Shared visible badge formatter caps visible counts at `999+`.
- [x] Compact, medium, and expanded badge outputs match the required grammar.
- [x] Offline and not-yet-connected badge text remains unchanged.
- [x] Badge remains single-line and shrink-safe within the header.
- [x] Regression tests cover formatter, DOM rendering, and browser overflow behavior.
- [x] Targeted header screenshots exist under `docs/img/app/settings/header/`.
- [x] `npm run lint` passes.
- [x] `npm run test` passes.
- [x] `npm run test:coverage` passes with global branch coverage `>= 91%`.
- [x] `npm run build` passes.
- [x] `WORKLOG.md` records inspections, edits, commands, results, and screenshot outputs.

# Overlay And Scroll Containment Plan

## Classification

- `UI_CHANGE`
- `CODE_CHANGE`

## Task Breakdown

1. Audit the shared app shell and all overlay primitives.
2. Introduce a deterministic global overlay stack manager with depth-aware backdrops and badge-safe layering.
3. Move page scrolling into a single bounded app viewport with explicit header and tab-bar offsets.
4. Update shared overlay and layout tests to lock in the new behavior.
5. Regenerate only the screenshots whose rendered output changed.
6. Run the required validation matrix and record evidence.

## Affected Components

- App shell and navigation:
  - `src/App.tsx`
  - `src/components/SwipeNavigationLayer.tsx`
  - `src/components/TabBar.tsx`
  - shared app header component(s)
- Overlay primitives:
  - `src/components/ui/dialog.tsx`
  - `src/components/ui/sheet.tsx`
  - `src/components/ui/alert-dialog.tsx`
  - `src/components/ui/popover.tsx`
  - `src/components/ui/app-surface.tsx`
  - `src/components/ui/interstitial-state.tsx`
  - `src/components/ui/interstitialStyles.ts`
- Pages and page containers that currently own scrolling.
- Regression tests and screenshot capture specs.

## Detection Strategy

1. Enumerate every overlay entry point from the shared primitives and all direct usages.
2. Trace the current z-index and backdrop model to find places where nested overlays reuse a single dim layer.
3. Trace the app shell to find where header and bottom-nav offsets are currently implicit.
4. Search for page-level `overflow`, `min-h-screen`, `h-screen`, `100vh`, `100dvh`, and fixed-position assumptions that can bypass a bounded scroll frame.
5. Use targeted Playwright coverage to prove nested overlay depth and scroll containment on representative flows.

## Verification Steps

1. Unit tests for overlay depth registration, z-index assignment, and backdrop opacity per depth.
2. Unit tests for shared app shell offsets and bounded scroll viewport behavior.
3. Playwright tests for popup-over-sheet, popup-over-popup, and nested modal flows.
4. Playwright screenshot regeneration only for changed surfaces.
5. Validation runs:
   - `npm run lint`
   - `npm run test`
   - `npm run test:coverage`
   - `npm run build`
   - targeted Playwright flows
   - Maestro validation if executable in this environment

# Consistent Close Control Plan

## Classification

- `UI_CHANGE`
- `CODE_CHANGE`

## Close-Control Impact Surface

- Shared primitives:
  - `src/components/ui/modal-close-button.tsx`
  - `src/components/ui/app-surface.tsx`
  - `src/components/ui/dialog.tsx`
  - `src/components/ui/alert-dialog.tsx`
- Reference-aligned surfaces to preserve:
  - `src/components/itemSelection/ItemSelectionDialog.tsx`
  - `src/components/lighting/LightingStudioDialog.tsx`
  - `src/components/DemoModeInterstitial.tsx`
- Legacy sheet/header spacing to converge:
  - `src/components/lists/SelectableActionList.tsx`
  - `src/components/disks/HomeDiskManager.tsx`
  - `src/pages/home/dialogs/SnapshotManagerDialog.tsx`
  - `src/pages/home/dialogs/LoadConfigDialog.tsx`
  - `src/pages/home/dialogs/ManageConfigDialog.tsx`
  - `src/components/archive/OnlineArchiveDialog.tsx`
  - `src/components/lighting/LightingStudioDialog.tsx`
  - `src/components/diagnostics/DiagnosticsDialog.tsx`
  - `src/components/diagnostics/LatencyAnalysisPopup.tsx`
  - `src/components/diagnostics/AnalyticPopup.tsx`
- Representative autofocus leakage surfaces to verify after the shared fix:
  - `src/components/lists/SelectableActionList.tsx`
  - `src/components/disks/HomeDiskManager.tsx`
  - `src/pages/home/dialogs/SnapshotManagerDialog.tsx`
  - `src/pages/home/dialogs/ManageConfigDialog.tsx`
  - `src/pages/home/dialogs/SaveRamDialog.tsx`
  - `src/pages/home/dialogs/RestoreSnapshotDialog.tsx`
  - `src/pages/home/dialogs/PowerOffDialog.tsx`
  - `src/pages/home/dialogs/SaveConfigDialog.tsx`
  - `src/pages/home/dialogs/ClearFlashDialog.tsx`
  - `src/pages/home/components/DriveManager.tsx`
  - `src/pages/SettingsPage.tsx`
  - `src/components/archive/OnlineArchiveDialog.tsx`
  - `src/components/diagnostics/DiagnosticsDialog.tsx`
  - `src/components/diagnostics/LatencyAnalysisPopup.tsx`
  - `src/components/diagnostics/AnalyticPopup.tsx`
- Regression files:
  - `tests/unit/components/ui/closeControl.test.tsx`
  - `tests/unit/components/ui/dialog.test.tsx`
  - `tests/unit/components/ui/app-surface.test.tsx`
  - `tests/unit/components/itemSelection/ItemSelectionDialog.test.tsx`
  - `tests/unit/pages/home/dialogs/SnapshotManagerDialog.test.tsx`
  - `tests/unit/pages/home/dialogs/SnapshotManagerDialog.layout.test.tsx`
  - `playwright/modalConsistency.spec.ts`
  - `playwright/itemSelection.spec.ts`
  - `playwright/diskManagement.spec.ts`
  - `playwright/screenshots.spec.ts`
- Screenshot targets under `docs/img/app/`:
  - `disks/collection/01-view-all.png`
  - `play/playlist/01-view-all.png`
  - `home/dialogs/01-save-ram-dialog.png`
  - `home/dialogs/03-snapshot-manager.png`
  - `home/dialogs/04-restore-confirmation.png`
  - `home/dialogs/08-lighting-context-lens-medium.png`
  - `diagnostics/filters/02-editor.png`
  - plus any additional close-control screenshots proven inaccurate after the audit

## Implementation Order

1. Centralize open-time focus handling in the shared dialog/sheet primitives so newly opened interstitials do not visibly autofocus the close control.
2. Keep `CloseControl` as the single shared dismiss control and preserve its plain `×` glyph plus keyboard-visible focus ring.
3. Converge shared header-row structure in the shared primitives so titles, actions, and close controls stay on one row.
4. Remove legacy per-screen `AppSheetHeader` spacing overrides where the shared header contract now covers the layout.
5. Re-verify custom action rails, especially Diagnostics overflow actions and AnalyticPopup back-link layouts.
6. Add narrow regression coverage at primitive, surface, and browser levels.
7. Refresh only the affected screenshots through the existing Playwright screenshot harness.
8. Run the required validation matrix and record the evidence in `WORKLOG.md`.

## Test Plan

- Unit:
  - verify the close control remains the shared plain `×` glyph and still exposes visible focus-ring classes
  - verify shared headers keep title/actions/close on one row and action rails stay left of the close control
  - verify shared header overrides still work
  - verify the `Add items` reference surfaces retain their current structure
  - verify Snapshot Manager still dismisses from the top-right close control and keeps stable header layout after spacing cleanup
- Browser:
  - verify representative dialogs and sheets do not open with the close control focused
  - verify representative surfaces expose exactly one close button
  - verify Diagnostics overflow remains left of the close control on the shared action rail
  - verify title and close stay aligned on representative headers
- Required validation:
  - `npm run lint`
  - `npm run test`
  - `npm run test:coverage`
  - `npm run build`
  - targeted Playwright close-control regressions
  - targeted Playwright screenshot generation for the affected assets

## Screenshot Plan

- Use `playwright/screenshots.spec.ts`; do not add a separate screenshot script.
- Refresh only the close-control screenshots whose visible output changes.
- Start with:
  - `docs/img/app/disks/collection/01-view-all.png`
  - `docs/img/app/play/playlist/01-view-all.png`
  - `docs/img/app/home/dialogs/01-save-ram-dialog.png`
  - `docs/img/app/home/dialogs/03-snapshot-manager.png`
  - `docs/img/app/home/dialogs/04-restore-confirmation.png`
  - `docs/img/app/home/dialogs/08-lighting-context-lens-medium.png`
  - `docs/img/app/diagnostics/filters/02-editor.png`
- Expand only if another existing screenshot still shows a close-focus ring, detached close rail, or row misalignment after the code fix.

## Completion Checklist

- [x] Shared primitives apply one deterministic open-focus policy that avoids close-button autofocus on open.
- [x] `CloseControl` remains the shared plain `×` dismiss control with visible keyboard focus styling.
- [x] Header title, actions, and close control share one stable row across dialogs and sheets.
- [x] Legacy per-screen header padding hacks are removed or reduced to the smallest justified set.
- [x] Diagnostics overflow and AnalyticPopup custom header actions still align correctly.
- [x] Regression tests cover the fixed behavior at unit and browser levels.
- [x] Only the necessary screenshots under `docs/img/app/` are refreshed.
- [x] `npm run lint` passes.
- [x] `npm run test` passes.
- [x] `npm run test:coverage` passes with global branch coverage `>= 91%`.
- [x] `npm run build` passes.
- [x] `WORKLOG.md` records inspections, edits, commands, results, and screenshot outputs.

## New TODOs

### TODO: FIX SAFE AREA / STATUS BAR OVERLAP (REAL DEVICE REGRESSION)

Problem:

- On a physical Pixel 4 device, the Android system status bar overlaps the app header.
- This does not happen in emulator screenshots.
- The footer behaves correctly.

Reference:

- `docs/img/devices/pixel4/home_v0.7.0.png`

Constraints:

- Do not reintroduce the previously removed header-padding workaround.
- The fix must be systemic and platform-correct.
- The result must work across Android, iOS, and Web.

Required actions:

1. Analyze Capacitor safe-area handling and viewport configuration.
2. Identify why the top inset is ignored while the bottom inset works.
3. Implement correct safe-area handling using platform-native insets.
4. Ensure the header always sits fully below the system status bar.

Validation:

- Compare real-device and emulator screenshots.
- Produce before/after evidence.

Acceptance criteria:

- Zero overlap on all platforms.
- No hack-based padding.
- Consistent behavior across compact, standard, and expanded profiles.

### TODO: FIX HEALTH CHECK INCOMPLETE EXECUTION (TELNET + CONFIG)

Observed diagnostics:

TELNET:

- Status: Timeout
- Message: `TELNET timed out after 2000ms`
- Duration: `2000ms`

CONFIG:

- Status: Cancelled
- Message: `No suitable config roundtrip target available`

Summary:

- Result: `Degraded`
- Total duration: `2631ms`
- Latency: `p50 68ms`, `p90 88ms`, `p99 2076ms`

Problem:

- The TELNET check executes but fails systematically.
- The CONFIG check is skipped entirely.

Required actions:

1. Trace the health-check execution path end-to-end.
2. Ensure TELNET:
   - uses the correct host (`c64u`)
   - uses the correct protocol and timeout handling
   - produces an actionable result instead of a silent timeout
3. Ensure CONFIG:
   - is not skipped
   - has a valid roundtrip target
   - executes real validation

Validation:

- Run against the real device (`c64u`), not only mocks.
- Capture traces showing request and response.

Acceptance criteria:

- No skipped checks.
- No silent failures.
- Diagnostics reflect the real system state.

### TODO: FIX POWER CYCLE FAILURE (REAL TELNET RESPONSE PARSING)

Observed error:

`Power cycle failed`

`Item 'Power & Reset' not found. Available:
[SD SD Card No media,
 Flash Internal Memory Ready,
 Temp RAM Disk Ready,
 USB1 Verbaltqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqk Ready,
 xPower & Reset x,
 xBuilt-in Drive A x,
 xBuilt-in Drive B x,
 xSoftware IEC x,
 xPrinter x,
 xConfiguration x,
 xStreams x,
 xDeveloper x,
 xReturn to Main Menu x,
 mqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqj]`

Key observations:

- Menu items are present but wrapped in `x ... x` markers.
- Output contains noise:
  - repeated `q` characters
  - malformed borders such as `mqqq...`
  - malformed content such as `Verbaltqqq...`
- The parser fails to detect `Power & Reset` even though it is present.

Problem:

- The Telnet parser assumes clean or mock-formatted output.
- Real-device output contains control-character or PETSCII-style artifacts, border-drawing noise, and repeated malformed characters.
- Matching is too strict and fails against the real output.

Required actions:

1. Capture raw Telnet output from the real device (`c64u`).
2. Compare it with the mock responses used in tests.
3. Identify the parser assumptions that break:
   - exact string matching
   - formatting dependencies
4. Rewrite the parser so it:
   - ignores border and noise characters
   - normalizes text before matching
   - detects menu entries semantically instead of by exact formatting
   - tolerates repeated or malformed characters
5. Ensure the navigation path detects and selects `Power & Reset` reliably.

Validation:

- Execute Power Cycle successfully on real hardware.
- Capture the full trace:
  - raw Telnet output
  - normalized representation
  - selection steps

Testing:

- Add cases for:
  - real-device noisy output
  - clean mock output
  - corrupted or partial output

Acceptance criteria:

- Power Cycle works on real hardware.
- The parser is robust against noisy output.
- Error messages remain clean and bounded.

### TODO: FIX HOME DEVICE CONTROL ROUTING AND MENU TOGGLE

Classification:

- `CODE_CHANGE`
- `UI_CHANGE`

Objective:

- Replace the current split Home-page machine control routing with one authoritative control layer.
- Eliminate invalid Telnet usage for reboot and power cycle.
- Make the Menu quick action behave as a strict open/close toggle without drift.

Required implementation:

1. Introduce `src/lib/deviceControl/deviceControl.ts` as the single orchestration layer for:

- `toggleMenu()`
- `rebootKeepRam()`
- `rebootFull()`
- `powerCycle()`

2. Route Home-page quick actions and overflow actions through that layer only.
3. Keep REST first for:

- Menu toggle
- Reboot (Keep RAM)
- Full Reboot

4. Remove Telnet routing for:

- `powerCycle`
- `rebootClearMemory`
- `rebootKeepMemory`

5. Leave Telnet only for actions that still require it, such as REU/config file flows.
6. Emit structured diagnostics logging for each control operation including:

- operation
- transport
- endpoint or command
- request/response payload or error context

Validation criteria:

- Menu toggle path performs a deterministic alternating open/close request sequence in tests for 10 consecutive invocations.
- Primary Reboot calls REST-only full reboot orchestration and never invokes Telnet.
- Overflow Reboot (Keep RAM) calls REST reboot only and never invokes Telnet.
- Power Cycle no longer invokes Telnet anywhere in the Home control path.
- Regression tests fail if these operations are re-routed back to Telnet.
- `npm run lint`, `npm run test`, `npm run test:coverage`, and `npm run build` pass.

Execution order:

1. Add authoritative device control module.
2. Cut Home-page quick actions and overflow actions over to the module.
3. Add targeted unit regressions for routing, sequencing, and toggle determinism.
4. Run targeted tests while iterating, then full required validation.
5. Record evidence in `WORKLOG.md`.

Current status:

- Steps 1 through 3 are complete.
- Focused regression coverage is complete for the new control layer and Home-page routing.
- `npm run lint` and `npm run build` passed after the implementation.
- Repo-wide `npm run test` and `npm run test:coverage` are currently blocked by an unrelated existing failure in `tests/unit/lib/native/safeArea.test.ts` on this branch.

## Global Execution Rules For New TODOs

- Do not assume completion based on existing code or files.
- Every fix must include traces, logs, and screenshots when visually relevant.
- Prefer real-device validation over mocks.
- Maintain minimal, non-invasive changes.
- Do not regress existing functionality.
