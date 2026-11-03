---
title: Keep the selected stop visible while a restored page settles
author: Christian
date: 2026-11-03
branch: fix/play-keyboard-reachability
id: l-c10504ad
scope: repo
status: active
src: agent
touches:
  - playwright/keypadOnlyNavigation.spec.ts
  - src/hooks/useFocusNavigation.tsx
---

## Decided
Watch the selected default keypad stop briefly after a tab return, so a late layout shift is followed by another visibility check.

## Tried and ruled out
Aligning the stop once during the initial scan was insufficient: the playlist was revealed below the header and then moved upward without another scroll event as the page settled. The same CI build passed locally, so a passing isolated run did not establish that the geometry was safe.

## Watch out
Stop the watch on user input and avoid changing the saved page position unnecessarily. Keep the late-shift regression as well as the original tab-return assertion.

In the code:
- `src/hooks/useFocusNavigation.tsx` attaches the existing layout reveal watch to default-stop selection.
- `playwright/keypadOnlyNavigation.spec.ts` exercises a delayed upward shift after returning to Play.
