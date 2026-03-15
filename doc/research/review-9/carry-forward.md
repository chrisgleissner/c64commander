# Review 9 Carry-Forward

## Status Summary

- Current review cycle: `review-9`
- Last remediation update: 2026-03-15

## Items

### R9-001 - Compact keyboard-safe dialog coverage

- Status: resolved
- Evidence: `playwright/displayProfiles.spec.ts` now includes focused-input Compact reduced-height coverage for the selection browser and snapshot manager, in addition to the existing diagnostics dialog coverage.
- Next action: none.

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

- Status: open
- Evidence: Review 9 findings remain valid for `src/pages/home/components/DriveManager.tsx`, `src/pages/home/components/StreamStatus.tsx`, `src/pages/home/DriveCard.tsx`, `src/pages/playFiles/components/PlaybackControlsCard.tsx`, and `src/pages/playFiles/components/VolumeControls.tsx`.
- Next action: replace the remaining `md:` / `sm:` structural layout branches with display-profile-aware helpers and re-audit the Compact and Expanded behavior of those surfaces.

### R9-006 - CTA coverage gaps outside current remediation scope

- Status: open
- Evidence: Review 9 still identifies missing or partial proof for Home machine quick actions, Add disks, Shuffle/Reshuffle, Recurse folders, and Test connection.
- Next action: add deterministic Playwright coverage for those flows and update `doc/ux-interactions.md` to reflect the new coverage state.

### R9-007 - Config row remains measurement-driven instead of profile-driven

- Status: deferred
- Evidence: `src/components/ConfigItemRow.tsx` still relies on `ResizeObserver` and measured adaptive layout instead of consuming the centralized display-profile context directly.
- Next action: revisit only if the measurement-based approach starts diverging from profile tokens or causes Compact/Expanded regressions.

## Open Item Count

- Open: 2
- Deferred: 1
- Blocked: 0
- Resolved: 4
