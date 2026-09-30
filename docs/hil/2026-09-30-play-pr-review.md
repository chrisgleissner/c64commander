# Playback repair: adversarial review and release validation

PR: https://github.com/chrisgleissner/c64commander/pull/446

The review uses `REVIEW.md` from the base branch. Scope is paused seek clock
updates, the seek target size, their regression tests and documentation. The
earlier bug-bash report remains a historical record of its partial hardware run.

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
- No device request pattern, native bridge, capability gate, secret handling or
  focus order is changed. The increased hit target retains the existing pointer
  and arrow-key handlers.

GitHub's Kilo review service could not run because its account has insufficient
credits. It supplied no code findings. This document records the manual review;
the unavailable service is not represented as a successful review.

## Release validation

The full release suites, changed-line coverage, nine-stage hardware merge gate
and Pixel deployment identity are recorded in the PR validation comment before
merge and tagging. GitHub workflow results are attached to that PR. The earlier
bug-bash report describes its own session and is not a release sign-off.
