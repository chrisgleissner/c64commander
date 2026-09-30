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

## Adversarial checks

- Both seek entry points update elapsed state after calculating the delta from
  the previous position; doing this in the opposite order would erase the delta.
- A forward/backward paused sequence retains the time played by earlier tunes.
- The played clock remains frozen while paused, and existing playing-seek tests
  continue to cover the wall-clock branch.
- The scrub target is cleared on rejection, and the next gesture is accepted.
- The compact-screen size test renders a valid generated SID with real local
  emulation. It measures geometry rather than asserting a CSS class. Removing
  the target-size repair caused a 32px failure; restoring it passed.
- No device request pattern, native bridge, capability gate, secret handling or
  focus order is changed. The increased hit target retains the existing pointer
  and arrow-key handlers.

GitHub's Kilo review service could not run because its account has insufficient
credits. It supplied no code findings. This document records the manual review;
the unavailable service is not represented as a successful review.

## Validation status

Full release validation and the nine-stage hardware merge gate are in progress.
Results will be recorded before merge and tagging.
