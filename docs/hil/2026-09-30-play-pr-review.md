# Playback repair: adversarial review and release validation

PR: https://github.com/chrisgleissner/c64commander/pull/446

The review uses `REVIEW.md` from the base branch. Scope is paused seek clock
updates, the seek target size, Both screen-off audio, cartridge unloading,
paused Stop mixer restoration, the coverage collector, their regression tests
and documentation. The earlier bug-bash report remains a historical record of its partial hardware run.

## Resolved review finding

### src/pages/playFiles/hooks/usePlaybackController.ts

- **Warning — resolved**, scrub-release catch near line 2380: a rejected seek was
  logged at DEBUG with only its message. Log at WARN with the full error stack,
  target seconds and playlist item identifier. The new regression failed before
  this repair, passes afterwards, and also checks that rejection releases the
  scrub state so a subsequent seek is accepted.

### playwright/withCoverage.ts and playwright/playback.part2.spec.ts

- **Warning — resolved**, collection near line 40: returning the complete coverage
  object through CDP stalled the instrumented WebView for 11–12 seconds while
  playback requests were pending. Serialize to JSON in the browser and transfer
  the string, preserving all counters. Collection failures now rethrow with the
  test name and original cause. Two focused regressions failed against the
  previous helper in an isolated worktree; all four pass with the repair.
- **Warning — resolved**, remote disk test near line 1060: confirming one disk
  already launches it. The test redundantly launched it again and checked only
  request arrival. It now verifies the Play confirm label, a successful mount
  response, completed playback and exactly one PUT mount.
- The three affected instrumented tests (remote mount, rapid Next, Previous/Next)
  failed in the initial full run and pass after the collection/launch repair.

### src/lib/streams/avMirrorBackgroundPolicy.ts

- **Bug — resolved**, hidden transition: Both playlist playback stopped its mirror
  audio on screen-off despite having a foreground service and media controls.
  A 35-second microphone recording captured a 22.7-second gap while the playback
  clock continued. Preserve audio only when a remote playlist is active, the
  listener selected Both, the machine is running and background execution is
  active. Standalone Live View and paused sessions retain stop-on-hide behavior.
- Video still stops on hide. Retained playlist audio is excluded from restore
  state so a Stop while hidden cannot restart it on wake. Two focused tests
  failed before the fix. Default installation tests cover each ownership guard.
  On the repaired Pixel build, the repeated 35-second microphone recording
  measured 100% tone presence, a 0ms gap and +0.5 cents through 23 seconds
  screen-off (Android reported Dozing). An earlier repaired-build recording
  captured a 450ms startup gap before sleep; the repeated measurement began
  after playback settled. Neither run showed the original screen-off stop.
- Visibility-handler rejections now log the operation, original error and stack;
  restore error logs retain full stacks and handle native string rejections.

### src/pages/playFiles/hooks/usePlaybackController.ts — cartridge Stop

- **Bug — resolved**, Stop used a machine reset for cartridges. An 8KiB probe
  wrote `CRT!` to RAM on boot and then looped. Clearing that marker and pressing
  Stop caused it to write the marker again while the UI reported stopped.
  Reboot cartridges on explicit Stop, as disks already do, to unload their
  temporary mapping. Playing and paused regression cases both failed before
  the repair. On the repaired Pixel build, the marker remained zero after
  Stop from both playing and paused cartridges, confirming that the program
  did not boot again. Automatic program duration remains independent of
  explicit Stop.

### src/pages/playFiles/hooks/usePlaybackController.ts — paused Stop mixer cleanup

- **Bug — resolved**, paused Stop resumed the CPU without restoring the
  pause-mute snapshot. The repaired cartridge Stop exposed master volume still
  OFF on hardware. Restore an existing snapshot after machine Stop; keep Stop
  running if resume fails, and log failed restores with original error text
  and full stack. A microphone check and direct stream capture then exposed
  about 180ms of tune replay when restoration preceded reset. Keeping the
  resumed CPU muted until reset/reboot finishes prevents that replay.
  Five file-type regressions failed before the repair. A U2 session without a
  snapshot performs no mixer query. Error and native string paths verify that
  cartridge unloading still runs despite a failed resume or restore. On the
  final combined Pixel build, paused cartridge Stop left the RAM marker zero
  and restored the actual C64U master mixer from OFF to its original 0 dB.

### src/pages/playFiles/components/PlaybackControlsCard.tsx — seek haptic diagnostics

- **Warning — resolved**, the optional vibration helper swallowed exceptions.
  Failed vibration now logs WARN with duration, original error and full available
  stack, while the hold-to-seek gesture continues. Error and native string cases
  both failed without logging; all 33 control-card tests pass with the repair.
  Missing vibration support remains optional and causes no exception.

## Adversarial checks

- Both seek entry points update elapsed state after calculating the delta from
  the previous position; doing this in the opposite order would erase the delta.
- A forward/backward paused sequence retains the time played by earlier tunes.
- The played clock remains frozen while paused, and existing playing-seek tests
  continue to cover the wall-clock branch.
- The scrub target is cleared on rejection, and the next gesture is accepted.
  Native string rejections retain their text without inventing a stack; this
  meaningful error-path regression also closes the two partial patch lines.
- The compact-screen size test renders a valid generated SID with real local
  emulation. It measures geometry rather than asserting a CSS class. Removing
  the target-size repair caused a 32px failure; restoring it passed.
- The seek changes retain the existing pointer and arrow-key handlers. The
  background policy preserves the existing U64-family capability gating and
  stops video while hidden; no new device endpoint or config write is introduced.

GitHub's Kilo review service could not run because its account has insufficient
credits. It supplied no code findings. This document records the manual review;
the unavailable service is not represented as a successful review.

## Release validation

The full release suites, changed-line coverage, nine-stage hardware merge gate
and Pixel deployment identity are recorded in the PR validation comment before
merge and tagging. GitHub workflow results are attached to that PR. The earlier
bug-bash report describes its own session and is not a release sign-off.
