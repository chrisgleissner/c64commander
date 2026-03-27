# Interactions 1 Verification Notes

## Scope

- Task: close the remaining button-highlight and playback mute/unmute regressions from the prior remediation attempt.
- Date: 2026-03-11

## Scenario A: Play-page Change button after native picker dismissal

- Environment: Pixel 4 handset over adb, Android 16, package `uk.gleissner.c64commander`
- Theme: dark mode
- Expected result:
  - tapping `Change` may show the temporary tap flash
  - opening and dismissing the native picker must not leave the `Change` button visibly focused/highlighted
  - the button must return to its resting state without any extra tap elsewhere
- Observed result before fix:
  - the button could retain focus after picker dismissal and stayed tinted until the user tapped somewhere else
- Observed result after fix:
  - focus is cleared on app resume and the button returns to its resting state automatically
- Associated screenshots:
  - `a1-change-before-open.png`
  - `a2-change-picker-open.png`
  - `a3-change-after-close.png`
  - `a4-change-after-timeout.png`
- Capture note:
  - `a3-change-after-close.png` was captured on the first stable post-dismissal frame available from adb screenshot capture
  - the picker transition is native and immediate, so no separate stable “tap flash while picker is opening” frame was expected beyond the pre-open and picker-open captures

## Scenario B: Starting playback while muted

- Environment: Playwright `android-phone` project against the deterministic mock C64 route
- Theme: default light-theme rendering from the Playwright harness
- Expected result:
  - when the volume button shows `Unmute`, pressing `Play` must clear mute before SID playback begins
  - the `Unmute` persistent highlight must clear once playback starts
- Observed result before fix:
  - starting playback from muted state could leave playback running while the volume state stayed muted
- Observed result after fix:
  - playback start restores the non-muted audio-mixer state before the SID play request completes
  - the button returns from `Unmute` to `Mute`
- Associated screenshots:
  - `b1-start-muted-before-play.png`
  - `b2-start-playback-auto-unmuted.png`
- Capture note:
  - in the deterministic browser harness the transition from muted to active playback completed within the first stable post-click frame, so the evidence uses the pre-click muted state and the first confirmed post-start state

## Scenario C: Pause then resume restores audio

- Environment: Playwright `android-phone` project against the deterministic mock C64 route
- Theme: default light-theme rendering from the Playwright harness
- Expected result:
  - pause may move the UI into the muted state if that is the designed pause behavior
  - resume must restore audible output and clear the `Unmute` persistent highlight
- Observed result before fix:
  - resume could leave playback running while the volume state remained muted
- Observed result after fix:
  - pause moves the button into the persistent `Unmute` state
  - resume clears that state and restores the active SID volumes
- Associated screenshots:
  - `c1-pause-resume-playing-before-pause.png`
  - `c2-pause-resume-paused.png`
  - `c3-pause-resume-muted-state.png`
  - `c4-pause-resume-resumed.png`
  - `c5-pause-resume-audio-restored.png`

## Automated Verification Linked To This Evidence

- `playwright/buttonHighlightProof.spec.ts`
  - `play-page change button clears retained pointer focus when the app regains focus`
- `playwright/playback.part2.spec.ts`
  - `starting playback while muted clears mute before SID playback begins`
  - `pause mutes SID outputs and resume restores them`
- `src/lib/ui/buttonInteraction.test.ts`
  - `clears pending pointer focus when the window regains focus after a picker-like interruption`
- `tests/unit/playFiles/usePlaybackController.test.tsx`
  - `unmutes before starting playback and only then executes the play plan`
  - `fails playback start when unmuting before playback start fails`
- `tests/unit/playFiles/volumeMuteRace.test.ts`
  - `does not revert the UI to unmuted while stale pre-pause values are still in the query cache`
  - `clears the pause guard once the hardware mute state is observed`

## Device Notes

- Android evidence was captured from the installed debug APK on the attached Pixel 4 device.
- Playwright evidence was captured from the deterministic browser harness because it can assert the underlying state transitions frame-by-frame while using the same shared UI logic.
