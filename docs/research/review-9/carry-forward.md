# Review 9 Carry-Forward

## Status Summary

- Current review cycle: `review-9`
- Last remediation update: 2026-03-15

## Items

### R9-001 - Compact keyboard-safe dialog coverage

- Status: open
- Evidence: `playwright/displayProfiles.spec.ts` now includes focused-input Compact reduced-height coverage for the selection browser and snapshot manager, in addition to the existing diagnostics dialog coverage, but the suite still approximates keyboard-open behavior via reduced viewport height instead of asserting a live `visualViewport` contraction.
- Next action: add a follow-up scenario that verifies Compact dialog safety against a real keyboard-open or `visualViewport` change rather than reduced-height emulation alone.

### R9-002 - End-user display-profile documentation gap

- Status: resolved
- Evidence: `README.md` now documents the `Auto`, `Small display`, `Standard display`, and `Large display` profiles plus the profile-specific screenshot folder conventions.
- Next action: none.

### R9-003 - Binary mobile abstraction in sidebar path

- Status: resolved
- Evidence: `src/components/ui/sidebar.tsx` now consumes `useDisplayProfile()` directly and `src/hooks/use-mobile.tsx` was removed.
- Next action: none.

### R9-004 - Shared dialog and selection breakpoint debt

- Status: resolved
- Evidence: `src/components/ui/dialog.tsx`, `src/components/ui/alert-dialog.tsx`, and `src/components/itemSelection/ItemSelectionDialog.tsx` no longer rely on the reviewed `sm:` breakpoint classes for header/footer or selection-browser interstitial/footer layout.
- Next action: none.

### R9-005 - Remaining profile debt in Home and playback subcomponents

- Status: resolved
- Evidence: `src/pages/home/components/DriveManager.tsx`, `src/pages/home/components/StreamStatus.tsx`, `src/pages/home/DriveCard.tsx`, `src/pages/home/dialogs/SnapshotManagerDialog.tsx`, `src/pages/playFiles/components/PlaybackControlsCard.tsx`, `src/pages/playFiles/components/VolumeControls.tsx`, `src/components/lists/SelectableActionList.tsx`, and `src/pages/SettingsPage.tsx` now route the reviewed structural layout branches through display-profile-aware logic instead of raw `sm:` / `md:` breakpoints.
- Next action: none.

### R9-006 - CTA coverage gaps outside current remediation scope

- Status: resolved
- Evidence: `playwright/homeInteractivity.spec.ts`, `playwright/settingsConnection.spec.ts`, and `playwright/playlistControls.spec.ts` now cover Home machine quick actions, confirmed power off, System theme, Refresh connection, and Recurse folders; `docs/ux-interactions.md` was reconciled with the pre-existing Add disks, Shuffle, and Reshuffle coverage already present elsewhere in the suite.
- Next action: none.

### R9-007 - Config row remains measurement-driven instead of profile-driven

- Status: resolved
- Evidence: `src/components/ConfigItemRow.tsx` now consumes `useDisplayProfile()` directly and forces Compact rows to the vertical layout before falling back to measurement for non-Compact adaptation.
- Next action: none.

## Open Item Count

- Open: 1
- Deferred: 0
- Blocked: 0
- Resolved: 6
