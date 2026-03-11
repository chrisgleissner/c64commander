# Android Button Highlight And Playback Remediation

## Status

- State: complete
- Date: 2026-03-11
- Scope: finish the takeover of the unfinished Android highlight remediation, fix the remaining playback mute regressions, add regression coverage, and produce screenshot evidence.

## Final Outcome

- The shared touch-highlight system now clears pointer-retained focus on app resume instead of relying on the user to defocus manually.
- The Play-page `Change` button no longer stays visually highlighted after the native picker is dismissed.
- `Play` only keeps the allowed persistent highlight while playback is actively running, not while paused.
- `Unmute` now uses the allowed persistent highlight while the app is muted.
- Starting playback from a muted state now restores audible output before the play request completes.
- Pause then resume now restores audible output correctly instead of leaving playback running while still muted.

## Audit Of Prior Work

### Correct prior work kept

- Centralized highlight behavior already existed in [`src/lib/ui/buttonInteraction.ts`](/home/chris/dev/c64/c64commander/src/lib/ui/buttonInteraction.ts).
- The shared 150 ms flash model and stale-flash sweep were already viable.
- Auto-unmute and pause/resume mute logic already existed in the Play-page hooks and could be repaired instead of replaced.

### Incomplete or regressive prior work fixed

- Pointer-originated focus was not reliably cleared after native picker dismissal because app-return paths were incomplete.
- The `Unmute` control was missing the only other allowed persistent highlight.
- The `Play` control stayed persistently highlighted while paused.
- Playback-start unmute failure could be swallowed.
- Pause mute state could be reverted by stale query data during the pause transition.
- The earlier evidence package was incomplete and did not prove the native picker regression was fixed.

## Root Cause

### Stuck button highlight after picker dismissal

- The real defect was retained DOM focus on the tapped button after the native picker returned control to the WebView.
- The shared button logic blurred pointer-focused elements after touch interaction, but that blur was not retried on all Android app-resume paths.
- Returning from the picker could therefore leave the element focused, which kept the button in the blue focus-tinted state.
- This was caused by focus styling plus incomplete focus clearing, not by the temporary flash attribute itself.

### Playback regressions

- Playback start depended on `ensureUnmuted()`, but failure handling did not enforce a fail-fast path.
- Pause/resume used async volume-state reconciliation that could temporarily replay stale pre-pause values into the UI.

## Central Remediation

### Focus lifecycle

- Added pending pointer-focus tracking in [`src/lib/ui/buttonInteraction.ts`](/home/chris/dev/c64/c64commander/src/lib/ui/buttonInteraction.ts).
- Retried pointer-focus clearing on `focus`, `pageshow`, and visible `visibilitychange`.
- Kept the fix centralized and pointer-specific so keyboard focus treatment is not removed indiscriminately.

### Allowed persistent highlights

- Restricted `Play` persistent highlight to `isPlaying && !isPaused` in [`src/pages/playFiles/components/PlaybackControlsCard.tsx`](/home/chris/dev/c64/c64commander/src/pages/playFiles/components/PlaybackControlsCard.tsx).
- Added `data-c64-persistent-active` to the muted-state `Unmute` control in [`src/pages/playFiles/components/VolumeControls.tsx`](/home/chris/dev/c64/c64commander/src/pages/playFiles/components/VolumeControls.tsx).

### Playback mute consistency

- Enforced auto-unmute before play in [`src/pages/playFiles/hooks/usePlaybackController.ts`](/home/chris/dev/c64/c64commander/src/pages/playFiles/hooks/usePlaybackController.ts).
- Added a pause-transition guard in [`src/pages/playFiles/hooks/useVolumeOverride.ts`](/home/chris/dev/c64/c64commander/src/pages/playFiles/hooks/useVolumeOverride.ts) and threaded it through [`src/pages/PlayFilesPage.tsx`](/home/chris/dev/c64/c64commander/src/pages/PlayFilesPage.tsx).

## Clickable Inventory Summary

The codebase was rechecked for shared and page-local button usage. The central highlight system covers the app-wide button surfaces below.

- Shared UI: [`src/components/ui/button.tsx`](/home/chris/dev/c64/c64commander/src/components/ui/button.tsx), [`src/components/TabBar.tsx`](/home/chris/dev/c64/c64commander/src/components/TabBar.tsx), [`src/components/QuickActionCard.tsx`](/home/chris/dev/c64/c64commander/src/components/QuickActionCard.tsx), [`src/components/itemSelection/ItemSelectionView.tsx`](/home/chris/dev/c64/c64commander/src/components/itemSelection/ItemSelectionView.tsx)
- Home: [`src/pages/HomePage.tsx`](/home/chris/dev/c64/c64commander/src/pages/HomePage.tsx), [`src/pages/home/components/MachineControls.tsx`](/home/chris/dev/c64/c64commander/src/pages/home/components/MachineControls.tsx), [`src/pages/home/components/PrinterManager.tsx`](/home/chris/dev/c64/c64commander/src/pages/home/components/PrinterManager.tsx)
- Play: [`src/pages/PlayFilesPage.tsx`](/home/chris/dev/c64/c64commander/src/pages/PlayFilesPage.tsx), [`src/pages/playFiles/components/PlaybackControlsCard.tsx`](/home/chris/dev/c64/c64commander/src/pages/playFiles/components/PlaybackControlsCard.tsx), [`src/pages/playFiles/components/VolumeControls.tsx`](/home/chris/dev/c64/c64commander/src/pages/playFiles/components/VolumeControls.tsx), [`src/pages/playFiles/components/PlaybackSettingsPanel.tsx`](/home/chris/dev/c64/c64commander/src/pages/playFiles/components/PlaybackSettingsPanel.tsx), [`src/pages/playFiles/components/PlaylistPanel.tsx`](/home/chris/dev/c64/c64commander/src/pages/playFiles/components/PlaylistPanel.tsx)
- Remaining routes: [`src/pages/DisksPage.tsx`](/home/chris/dev/c64/c64commander/src/pages/DisksPage.tsx), [`src/pages/ConfigBrowserPage.tsx`](/home/chris/dev/c64/c64commander/src/pages/ConfigBrowserPage.tsx), [`src/pages/SettingsPage.tsx`](/home/chris/dev/c64/c64commander/src/pages/SettingsPage.tsx), [`src/pages/DocsPage.tsx`](/home/chris/dev/c64/c64commander/src/pages/DocsPage.tsx)

## Files Changed And Why

- [`src/lib/ui/buttonInteraction.ts`](/home/chris/dev/c64/c64commander/src/lib/ui/buttonInteraction.ts): central focus-clear retry logic for app resume after picker-like interruptions
- [`src/lib/ui/buttonInteraction.test.ts`](/home/chris/dev/c64/c64commander/src/lib/ui/buttonInteraction.test.ts): regression test for app-regain-focus clearing
- [`src/pages/playFiles/components/PlaybackControlsCard.tsx`](/home/chris/dev/c64/c64commander/src/pages/playFiles/components/PlaybackControlsCard.tsx): `Play` persistent highlight restricted to active playback
- [`src/pages/playFiles/components/PlaybackControlsCard.test.tsx`](/home/chris/dev/c64/c64commander/src/pages/playFiles/components/PlaybackControlsCard.test.tsx): pause-state highlight regression coverage
- [`src/pages/playFiles/components/VolumeControls.tsx`](/home/chris/dev/c64/c64commander/src/pages/playFiles/components/VolumeControls.tsx): muted-state `Unmute` persistent highlight
- [`src/pages/playFiles/components/VolumeControls.test.tsx`](/home/chris/dev/c64/c64commander/src/pages/playFiles/components/VolumeControls.test.tsx): persistent-highlight coverage for `Unmute`
- [`src/pages/playFiles/hooks/usePlaybackController.ts`](/home/chris/dev/c64/c64commander/src/pages/playFiles/hooks/usePlaybackController.ts): fail-fast auto-unmute on play and pause-transition tracking
- [`src/pages/playFiles/hooks/useVolumeOverride.ts`](/home/chris/dev/c64/c64commander/src/pages/playFiles/hooks/useVolumeOverride.ts): stale-query guard for pause/resume mute reconciliation
- [`src/pages/PlayFilesPage.tsx`](/home/chris/dev/c64/c64commander/src/pages/PlayFilesPage.tsx): pause-transition ref wiring
- [`tests/unit/playFiles/usePlaybackController.test.tsx`](/home/chris/dev/c64/c64commander/tests/unit/playFiles/usePlaybackController.test.tsx): start-while-muted regression coverage
- [`tests/unit/playFiles/volumeMuteRace.test.ts`](/home/chris/dev/c64/c64commander/tests/unit/playFiles/volumeMuteRace.test.ts): pause/resume stale-state race coverage
- [`playwright/buttonHighlightProof.spec.ts`](/home/chris/dev/c64/c64commander/playwright/buttonHighlightProof.spec.ts): picker-return focus regression coverage
- [`playwright/playback.part2.spec.ts`](/home/chris/dev/c64/c64commander/playwright/playback.part2.spec.ts): play-start auto-unmute and pause/resume audible-output coverage
- [`playwright/playback.spec.ts`](/home/chris/dev/c64/c64commander/playwright/playback.spec.ts): deterministic reconciliation test updated to match the current non-interval resume behavior
- [`doc/testing/investigations/interactions1/verification-notes.md`](/home/chris/dev/c64/c64commander/doc/testing/investigations/interactions1/verification-notes.md): scenario-to-screenshot mapping and capture notes

## Regression Coverage Added Or Updated

- [`src/lib/ui/buttonInteraction.test.ts`](/home/chris/dev/c64/c64commander/src/lib/ui/buttonInteraction.test.ts): `clears pending pointer focus when the window regains focus after a picker-like interruption`
- [`src/pages/playFiles/components/VolumeControls.test.tsx`](/home/chris/dev/c64/c64commander/src/pages/playFiles/components/VolumeControls.test.tsx): muted `Unmute` button persists and clears correctly
- [`src/pages/playFiles/components/PlaybackControlsCard.test.tsx`](/home/chris/dev/c64/c64commander/src/pages/playFiles/components/PlaybackControlsCard.test.tsx): `Play` persistent highlight clears while paused
- [`tests/unit/playFiles/usePlaybackController.test.tsx`](/home/chris/dev/c64/c64commander/tests/unit/playFiles/usePlaybackController.test.tsx): start-while-muted unmute ordering and fail-fast failure handling
- [`tests/unit/playFiles/volumeMuteRace.test.ts`](/home/chris/dev/c64/c64commander/tests/unit/playFiles/volumeMuteRace.test.ts): pause-transition stale-query guard
- [`playwright/buttonHighlightProof.spec.ts`](/home/chris/dev/c64/c64commander/playwright/buttonHighlightProof.spec.ts): native-picker-equivalent focus regression
- [`playwright/playback.part2.spec.ts`](/home/chris/dev/c64/c64commander/playwright/playback.part2.spec.ts): muted-start and pause/resume audible-output flows

## Tests Run

- `npx vitest run src/lib/ui/buttonInteraction.test.ts src/pages/playFiles/components/PlaybackControlsCard.test.tsx src/pages/playFiles/components/VolumeControls.test.tsx tests/unit/playFiles/usePlaybackController.test.tsx tests/unit/playFiles/volumeMuteRace.test.ts`
- `npx playwright test playwright/buttonHighlightProof.spec.ts --grep "change button clears retained pointer focus|standard button flash|rapid repeated taps|play button stays highlighted"`
- `npx playwright test playwright/playback.part2.spec.ts --grep "starting playback while muted clears mute before SID playback begins|pause mutes SID outputs and resume restores them"`
- `npm run test:coverage`
- `npm run lint`
- `npm run build`
- `./build --skip-install`

## Coverage And Build Result

- `npm run test:coverage` passed with global branch coverage above the required 90% threshold.
- `./build --skip-install` completed successfully, including the web build, unit tests, Playwright suite, Android JVM tests, and debug APK build.
- Debug APK verified at [`android/app/build/outputs/apk/debug/c64commander-0.1.0-debug.apk`](/home/chris/dev/c64/c64commander/android/app/build/outputs/apk/debug/c64commander-0.1.0-debug.apk) and installed onto the attached Pixel 4 device.

## Evidence Package

Stored under [`doc/testing/investigations/interactions1`](/home/chris/dev/c64/c64commander/doc/testing/investigations/interactions1):

- `a1-change-before-open.png`
- `a2-change-picker-open.png`
- `a3-change-after-close.png`
- `a4-change-after-timeout.png`
- `b1-start-muted-before-play.png`
- `b2-start-playback-auto-unmuted.png`
- `c1-pause-resume-playing-before-pause.png`
- `c2-pause-resume-paused.png`
- `c3-pause-resume-muted-state.png`
- `c4-pause-resume-resumed.png`
- `c5-pause-resume-audio-restored.png`
- `verification-notes.md`

## Verification Checklist

- [x] No button remains highlighted only because it retained focus after picker dismissal
- [x] `Change` button regression reproduced and proven fixed
- [x] Tap flash remains centrally controlled by the shared interaction layer
- [x] `Play` stays highlighted only while actively playing
- [x] `Unmute` stays highlighted while muted
- [x] Starting playback from muted state restores audible output state
- [x] Pause then resume restores audible output state
- [x] Automated regression coverage updated
- [x] Screenshots stored in `doc/testing/investigations/interactions1`
- [x] Verification notes stored beside the screenshots

## Remaining Risks

- No known unresolved defects remain for this task.
- The native picker transition is immediate, so an isolated frame of the transient tap flash during picker launch is not a stable artifact to capture. That gap is covered by the shared interaction unit test and Playwright regression harness.

## Work Log

- 2026-03-11: Audited the prior remediation and re-established the real root cause.
- 2026-03-11: Fixed the shared pointer-focus lifecycle in the central interaction layer.
- 2026-03-11: Repaired the allowed persistent-highlight exceptions on the Play page.
- 2026-03-11: Fixed muted-start and pause/resume audible-output regressions.
- 2026-03-11: Added regression coverage across unit, component, and Playwright layers.
- 2026-03-11: Captured Android and Playwright evidence under `doc/testing/investigations/interactions1`.
