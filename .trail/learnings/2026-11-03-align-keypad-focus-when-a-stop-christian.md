---
title: Align keypad focus when a stop is clipped by sticky chrome
author: Christian
date: 2026-11-03
branch: fix/play-keyboard-reachability
id: l-ef916612
scope: repo
status: active
src: agent
touches:
  - src/lib/input/ringScroll.ts
  - tests/unit/lib/input/ringScroll.test.ts
  - playwright/keypadOnlyNavigation.spec.ts
---

## Decided
When a selected stop begins above the scrollport's reserved top edge, explicitly align its start even when its bottom already fits. `scrollIntoView({ block: "nearest" })` can leave a partly clipped stop under the sticky app bar after a restored tab jump.

## Tried and ruled out
The 24 px allowance in `DefaultStopFollower` lets the restored page select a nearby stop, but that allowance alone does not guarantee the selected stop is visible. The ring alignment helper also has to handle top-margin overflow; adding the regression first made the missing case fail as `nearest` instead of `start`.

## Watch out
Keep the compact Play tab-return E2E: a playlist card can fit the reserved area while starting above its top edge, and the saved scroll position must remain close to where the user left it.

In the code: `src/lib/input/ringScroll.ts` (`resolveRingScrollAlignment`); unit coverage in `tests/unit/lib/input/ringScroll.test.ts`; compact tab-return regression in `playwright/keypadOnlyNavigation.spec.ts`.
