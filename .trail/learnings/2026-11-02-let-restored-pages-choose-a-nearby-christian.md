---
title: Let restored pages choose a nearby focus stop before revealing defaults
author: Christian
date: 2026-11-02
branch: fix/play-keyboard-reachability
id: l-8667416c
scope: repo
status: active
src: agent
touches:
  - docs/cta-inventory.md
  - docs/img/app/config/01-categories.png
  - docs/img/app/config/profiles/compact/01-overview.png
  - docs/img/app/config/profiles/expanded/01-overview.png
  - docs/img/app/config/profiles/medium/01-overview.png
  - docs/img/app/config/profiles/small/01-overview.png
  - docs/img/app/config/sections/01-memory-roms.png
  - docs/img/app/config/sections/02-turbo-boost.png
  - docs/img/app/config/sections/03-video-setup.png
  - docs/img/app/config/sections/04-audio-mixer.png
---

## Decided
During a keypad tab jump, defer scan-driven focus scrolling while the destination settles. Let the default-stop follower inspect the restored page position first, then select and reveal the nearest usable stop. A stop that intersects the visible area but is clipped by up to 24 px beneath the sticky app bar can be revealed with a small scroll, so it should count as visible during restoration.

## Tried and ruled out
Removing the pre-jump focus reset did not restore the page position. Instrumenting the follower showed the scroll position had correctly returned, but the first visible control began a few pixels under the sticky header. The strict full-visibility check found no stop and revealed the page default at the top. Allowing the small header overlap kept the saved position and exposed the selected control.

## Watch out
The issue is easy to miss in a single screen or with an isolated scan. Keep a regression that leaves Play scrolled down, jumps away and back with keypad digits, checks the selected control against app chrome, and verifies the saved offset on phone and tablet.

In the code: `src/hooks/useFocusNavigation.tsx` skips `focusRingElement` from `onSelectionMovedByScan` while `DefaultStopFollower.isFollowing()` is true. `src/lib/input/defaultStopFollower.ts` permits the 24 px overlap and reveals the selected stop. Coverage lives in `tests/unit/lib/input/defaultStopFollower.test.ts` and the tab-return test in `playwright/keypadOnlyNavigation.spec.ts`.
