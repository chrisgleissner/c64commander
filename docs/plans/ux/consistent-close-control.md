# Consistent Close Control

ROLE

You are a senior UI engineer working on the C64 Commander React + Vite + Capacitor app for Android, iOS, and web. Converge every close `×` used to dismiss an interstitial onto one consistent visual and behavioral contract, using the PLAY page `Add items` surface as the reference. Fix the root causes, add regression coverage, and refresh only the affected screenshots.

This repository has strict execution rules. Follow `AGENTS.md` and `.github/copilot-instructions.md` first.

You MUST create and maintain `PLANS.md` and `WORKLOG.md` at the repository root.

- `PLANS.md` is the authoritative execution plan.
- `WORKLOG.md` is a timestamped evidence log of progress, commands, validation, and screenshots produced.

Create both files first, then immediately begin implementation and continue autonomously until the task is complete.

READ FIRST

Read the smallest relevant set before editing:

1. `README.md`
2. `.github/copilot-instructions.md`
3. `AGENTS.md`
4. `docs/ux-guidelines.md`
5. `src/components/ui/modal-close-button.tsx`
6. `src/components/ui/app-surface.tsx`
7. `src/components/ui/dialog.tsx`
8. `src/components/ui/alert-dialog.tsx`
9. `src/components/itemSelection/ItemSelectionDialog.tsx`
10. `src/components/lists/SelectableActionList.tsx`
11. `src/components/disks/HomeDiskManager.tsx`
12. `src/pages/home/dialogs/SnapshotManagerDialog.tsx`
13. `src/pages/home/dialogs/LoadConfigDialog.tsx`
14. `src/pages/home/dialogs/ManageConfigDialog.tsx`
15. `src/components/archive/OnlineArchiveDialog.tsx`
16. `src/components/lighting/LightingStudioDialog.tsx`
17. `src/components/diagnostics/DiagnosticsDialog.tsx`
18. `src/components/diagnostics/LatencyAnalysisPopup.tsx`
19. `src/components/diagnostics/AnalyticPopup.tsx`
20. `tests/unit/components/ui/closeControl.test.tsx`
21. `tests/unit/components/ui/dialog.test.tsx`
22. `tests/unit/components/ui/app-surface.test.tsx`
23. `tests/unit/components/itemSelection/ItemSelectionDialog.test.tsx`
24. `tests/unit/pages/home/dialogs/SnapshotManagerDialog.test.tsx`
25. `tests/unit/pages/home/dialogs/SnapshotManagerDialog.layout.test.tsx`
26. `playwright/itemSelection.spec.ts`
27. `playwright/diskManagement.spec.ts`
28. `playwright/modalConsistency.spec.ts`
29. `playwright/screenshots.spec.ts`

TASK CLASSIFICATION

Classify this as `UI_CHANGE`.

This is a code change with screenshot updates. Follow the minimal screenshot update rule from `.github/copilot-instructions.md`.

AUDIT SCOPE

Treat this close-control audit as exhaustive and re-verify before editing.

Current repository audit:

- There are `33` concrete header close-control usages across `19` source files.
- The shared close glyph already exists as `CloseControl`.
- The reference implementation is the PLAY page `Add items` surface in `src/components/itemSelection/ItemSelectionDialog.tsx`.
- The documented reference screenshots are:
  - `docs/img/app/play/import/01-import-interstitial.png`
  - `docs/img/app/play/import/02-c64u-file-picker.png`

CURRENT CODE REALITY

Ground your work in the existing implementation, not generic assumptions:

- Shared close-control component:
  - `src/components/ui/modal-close-button.tsx`
- Shared header renderers:
  - `src/components/ui/app-surface.tsx`
  - `src/components/ui/dialog.tsx`
  - `src/components/ui/alert-dialog.tsx`
- The current shared close control already uses the plain `×` glyph and a visible keyboard focus ring.
- The current UX contract in `docs/ux-guidelines.md` already requires:
  - one shared header row
  - title left, close right
  - no bespoke close buttons
  - no extra spacer row
  - no header padding overrides per screen

The `Add items` reference is good for two concrete reasons:

- It uses the shared header primitives without bespoke right-padding hacks.
- Both its modal and sheet explicitly prevent Radix open-time auto-focus from landing on the close button:
  - `AppDialogContent onOpenAutoFocus={(e) => e.preventDefault()}`
  - `AppSheetContent onOpenAutoFocus={(e) => e.preventDefault()}`

The current bad behavior splits into two root causes:

1. Open-time focus lands on the close control.
   - Many dialogs and sheets open and immediately focus the close button.
   - Because `CloseControl` has `focus:ring-2 focus:ring-ring focus:ring-offset-2`, screenshots captured right after opening show a blue rectangle around the `×`.
   - This is why screenshots such as `docs/img/app/diagnostics/filters/02-editor.png`, `docs/img/app/disks/collection/01-view-all.png`, `docs/img/app/play/playlist/01-view-all.png`, `docs/img/app/home/dialogs/03-snapshot-manager.png`, `docs/img/app/home/dialogs/01-save-ram-dialog.png`, and `docs/img/app/home/dialogs/04-restore-confirmation.png` show a blue box.
   - This is not a screenshot-harness click artifact. It is open-time focus behavior.

2. Several sheets still use legacy per-screen header padding.
   - Many sheets still inject classes such as `pr-14`, `pr-12`, `pt-3`, `pb-[0.5625rem]`, or other bespoke spacing into `AppSheetHeader`.
   - Those overrides pull the visual action rail away from the title row and make the close control feel detached from the header contract even when the glyph itself is shared.

DISCREPANCY SUMMARY

Use this summary as the implementation target map.

Reference-aligned surfaces to preserve:

- `src/components/itemSelection/ItemSelectionDialog.tsx`
  - source chooser modal
  - source browser sheet
- `src/components/lighting/LightingStudioDialog.tsx`
  - main `Lighting Studio` sheet
- `src/components/DemoModeInterstitial.tsx`
  - good open-time focus behavior

Legacy sheet spacing that must be converged:

- `src/components/lists/SelectableActionList.tsx`
  - generic `View all` sheet
  - affects Playlist and All disks screenshots
- `src/components/disks/HomeDiskManager.tsx`
  - `Mount disk to ...` sheet
- `src/pages/home/dialogs/SnapshotManagerDialog.tsx`
  - `Load RAM` sheet
- `src/pages/home/dialogs/LoadConfigDialog.tsx`
  - `Load from App` sheet
- `src/pages/home/dialogs/ManageConfigDialog.tsx`
  - `Manage App Configs` sheet
- `src/components/archive/OnlineArchiveDialog.tsx`
  - `Online Archive` sheet
- `src/components/lighting/LightingStudioDialog.tsx`
  - `Context Lens` sheet
- `src/components/diagnostics/DiagnosticsDialog.tsx`
  - `Filters`
  - `Config Drift`
  - `Decision state`
- `src/components/diagnostics/LatencyAnalysisPopup.tsx`
  - `Latency filters`

Surfaces with likely autofocus-ring leakage that must stop opening with the close button visibly focused:

- `src/components/lists/SelectableActionList.tsx`
- `src/pages/home/dialogs/SnapshotManagerDialog.tsx`
- `src/components/disks/HomeDiskManager.tsx`
  - mount sheet
  - mount dialog
  - set group
  - rename disk
  - remove disk
  - remove selected disks
- `src/pages/home/dialogs/SaveRamDialog.tsx`
- `src/pages/home/dialogs/RestoreSnapshotDialog.tsx`
- `src/pages/home/dialogs/PowerOffDialog.tsx`
- `src/pages/home/dialogs/SaveConfigDialog.tsx`
- `src/pages/home/dialogs/ClearFlashDialog.tsx`
- `src/pages/home/dialogs/ManageConfigDialog.tsx`
  - rename dialog
  - delete dialog
- `src/pages/home/components/DriveManager.tsx`
  - drive status details dialog
- `src/pages/SettingsPage.tsx`
  - relaxed safety mode confirmation
- `src/components/diagnostics/DiagnosticsDialog.tsx`
  - main diagnostics sheet
  - connection dialog
  - clear diagnostics confirmation
  - filter/config-drift/decision-state sheets
- `src/components/diagnostics/LatencyAnalysisPopup.tsx`
- `src/components/diagnostics/AnalyticPopup.tsx`
- `src/components/archive/OnlineArchiveDialog.tsx`

Custom-action headers that must still obey the same row contract:

- `src/components/diagnostics/DiagnosticsDialog.tsx`
  - overflow menu must stay on the same right-side action rail, left of the close control
- `src/components/diagnostics/AnalyticPopup.tsx`
  - back link + title + close must remain visually coherent

GOAL

Converge every interstitial close control to the same presentation and opening behavior as the PLAY page `Add items` surfaces.

The user-visible goal is simple:

- no detached top-right close boxes
- no blue rectangle around the close control immediately after opening
- no inconsistent vertical placement
- no bespoke per-screen close styling

NON-NEGOTIABLES

- Do not redesign the app’s modal/sheet system.
- Do not replace the shared `CloseControl` with a new component.
- Do not remove the keyboard-visible focus style from `CloseControl`.
- Do not make the close button unreachable by keyboard.
- Do not restyle the `Add items` reference to match broken screens. Broken screens must converge to the reference.
- Do not add per-screen close-button hacks.
- Do not keep `pr-14`/`pr-12`-style header spacing just to preserve current screenshots.
- Do not regress the diagnostics overflow-menu placement.
- Do not bulk-refresh screenshots outside the affected surfaces.
- Do not use Maestro for this task. Use the existing Playwright path.

TARGET BEHAVIOR

Header row:

- Every interstitial header uses one shared row only.
- The title starts at the left edge of the header content area.
- The close control sits on the right edge of that same row.
- The title and close control share the same visual vertical center.
- When header actions exist, they sit on the same right-side action rail and remain clearly left of the close control.
- There is no extra spacer row above the title.
- There is no fake reserved right column created by bespoke padding hacks.

Close control:

- All interstitial dismissal still uses the shared `CloseControl`.
- The visual control remains a plain `×` glyph.
- The hit target remains at least `40px`.
- The close control must not appear focused immediately on open.
- The close control must still show a visible focus ring when the user reaches it with keyboard navigation.

Open-time focus behavior:

- Opening a dialog or sheet must not visibly focus the close control by default.
- Converge on one deterministic open-focus policy across the interstitial system.
- Prefer a shared central solution over scattered one-off `onOpenAutoFocus` handlers when possible.
- If a central solution is not safe, apply the minimal set of consistent overrides and document exactly why.

IMPLEMENTATION DIRECTION

Converge the system at the shared primitives first, then remove per-screen deviations.

Preferred direction:

1. Keep `CloseControl` as the single close-button implementation.
2. Converge header layout in the shared primitives:
   - `src/components/ui/app-surface.tsx`
   - `src/components/ui/dialog.tsx`
   - `src/components/ui/alert-dialog.tsx`
3. Remove legacy per-screen `AppSheetHeader` spacing overrides unless they are strictly required after the shared fix.
4. Converge open-time focus behavior so newly opened surfaces do not visibly focus the close control.
5. Preserve legitimate action rails using `actions`, not padding hacks.
6. Re-test custom headers such as Diagnostics and AnalyticPopup after the shared fix.

Be especially careful with:

- `SelectableActionList` because it fans out to multiple documented `View all` surfaces.
- `DiagnosticsDialog` because it contains multiple nested interstitials and the overflow menu.
- `SnapshotManagerDialog` because it already has explicit tests for the top-right close button.

Do not touch unrelated page layout, app-bar layout, or tab-bar code.

TEST REQUIREMENTS

You must add or update dedicated regression coverage. Use the existing seams instead of inventing new parallel systems.

1. Shared primitive tests

Update or extend:

- `tests/unit/components/ui/closeControl.test.tsx`
- `tests/unit/components/ui/dialog.test.tsx`
- `tests/unit/components/ui/app-surface.test.tsx`

Required assertions:

- close control remains the shared plain `×` glyph
- visible focus styling still exists for keyboard focus
- header row keeps title and close on the same row
- action rails remain to the left of the close control
- shared header overrides still work where intended

2. Surface-level regression tests

Update or add narrow tests for the most failure-prone surfaces:

- `tests/unit/components/itemSelection/ItemSelectionDialog.test.tsx`
  - reference surfaces remain unchanged
- `tests/unit/pages/home/dialogs/SnapshotManagerDialog.test.tsx`
  - close button still dismisses
- `tests/unit/pages/home/dialogs/SnapshotManagerDialog.layout.test.tsx`
  - header layout remains stable after removing spacing hacks

3. Browser-level regression

Update the smallest honest Playwright coverage, likely:

- `playwright/modalConsistency.spec.ts`
- `playwright/itemSelection.spec.ts`
- `playwright/diskManagement.spec.ts`

Required browser assertions:

- representative sheets and dialogs do not open with the close button visibly focused
- representative headers keep title and close on the same row
- Diagnostics overflow menu remains left of the close control
- representative surfaces still expose exactly one close button

4. Screenshot root-cause regression

Add one Playwright assertion that proves the blue rectangle issue is fixed because the close control is not auto-focused on open.

Do not settle for a visual-only workaround.
Prove the focus state is correct.

SCREENSHOT REQUIREMENTS

Use the existing screenshot harness in `playwright/screenshots.spec.ts`.

Do not write a standalone screenshot script.

Refresh only the screenshots whose visible output changes. At minimum, expect the following existing files to need replacement:

- `docs/img/app/disks/collection/01-view-all.png`
- `docs/img/app/play/playlist/01-view-all.png`
- `docs/img/app/home/dialogs/01-save-ram-dialog.png`
- `docs/img/app/home/dialogs/03-snapshot-manager.png`
- `docs/img/app/home/dialogs/04-restore-confirmation.png`
- `docs/img/app/home/dialogs/08-lighting-context-lens-medium.png`
- `docs/img/app/diagnostics/filters/02-editor.png`

Also update any additional screenshot that still shows:

- a blue focus rectangle around the close control
- a detached close-control box
- header-row misalignment relative to the `Add items` reference

Do not refresh the entire screenshot corpus.

VALIDATION

Before completion, run the smallest honest validation set required by repo policy for this UI code change:

- `npm run lint`
- `npm run test`
- `npm run test:coverage`
- `npm run build`
- targeted Playwright covering:
  - modal/header close-control regressions
  - the screenshot generation path you touched

Coverage is mandatory:

- global branch coverage must remain `>= 91%`

If tests or build fail, fix the root cause. Do not skip.

PLAN AND WORKLOG REQUIREMENTS

`PLANS.md` must include:

- task classification
- full close-control impact surface
- implementation order
- test plan
- screenshot plan
- completion checklist

`WORKLOG.md` must include timestamped entries for:

- files inspected
- edits made
- commands run
- test results
- coverage result
- screenshot files written
- any issue encountered and resolution

EXECUTION MODEL

1. Create `PLANS.md`.
2. Create `WORKLOG.md`.
3. Read the required files.
4. Re-verify the full close-control surface inventory.
5. Fix the shared primitive/header/focus causes first.
6. Remove per-screen spacing hacks where the shared fix makes them unnecessary.
7. Add or update regression tests.
8. Refresh only the affected screenshots.
9. Run required validation.
10. Update `WORKLOG.md` with evidence and final results.
11. Stop only when all acceptance criteria are satisfied.

ACCEPTANCE CRITERIA

The task is complete only when:

- every interstitial close `×` visibly matches the `Add items` reference contract
- no representative dialog or sheet opens with the close control visibly focused
- blue rectangles around close controls disappear from refreshed screenshots unless the close control is intentionally keyboard-focused during the capture
- title and close control share one stable header row across dialogs and sheets
- legacy per-screen header padding hacks are removed or reduced to the smallest justified set
- Diagnostics action rails still behave correctly
- one shared close-control contract remains in place
- regression tests pass
- `npm run test:coverage` passes with branch coverage `>= 91%`
- build passes
- only the necessary screenshots under `docs/img/` are refreshed
- `PLANS.md` and `WORKLOG.md` document the work and evidence

BEGIN NOW.
