---
title: Keep the shared search field outside collapsible cards
author: Christian
date: 2026-11-03
branch: fix/play-keyboard-reachability
id: l-5da6d5f8
scope: repo
status: active
src: agent
touches:
  - ".prettierignore"
  - docs/img/app/home/01-overview-dark.png
  - docs/img/app/sid-player/profiles/compact/02-playing-playlist.png
  - docs/img/app/sid-player/profiles/medium/02-playing-playlist.png
  - playwright/playKeyboardReachability.spec.ts
  - src/pages/home/components/HomeSearchField.tsx
  - src/pages/playFiles/components/PlayListeningShortcuts.tsx
  - tests/unit/pages/HomePage.test.tsx
  - tests/unit/pages/playFiles/PlayListeningShortcuts.test.tsx
---

## Decided
Keep the shared Search field standalone on Home and at the top of Play in SID Player mode because it is a primary entry point that should remain immediately visible and behave consistently across surfaces and themes.

## Tried and ruled out
A fixed Home wrapper paired with a collapsible Play wrapper still made the shared entry point look and behave differently, so keeping the field unwrapped on both surfaces is the clearest invariant.

## Watch out
A caller can still place this component inside a card even when the component itself is unwrapped. Assert that the Home and SID Player field has no `data-section-scope` ancestor, and refresh the Home dark and SID Player manual screenshots if this layout changes.

In the code:
- `src/pages/home/components/HomeSearchField.tsx` renders the field without a card wrapper.
- `src/pages/playFiles/components/PlayListeningShortcuts.tsx` places the same field before the SID Player listening card.
- `tests/unit/pages/HomePage.test.tsx`, `tests/unit/pages/playFiles/PlayListeningShortcuts.test.tsx`, and `playwright/playKeyboardReachability.spec.ts` lock the standalone behavior.
