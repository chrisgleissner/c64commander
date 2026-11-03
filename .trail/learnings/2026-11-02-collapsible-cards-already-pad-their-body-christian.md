---
title: Collapsible cards already pad their body
author: Christian
date: 2026-11-02
branch: fix/play-keyboard-reachability
id: l-aff24472
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
When moving existing content into `CollapsibleSection`, remove the old wrapper's padding from its children. `CollapsibleSection` already applies responsive horizontal and vertical padding to its body. Keeping the previous padded wrapper nests a second inset and can shrink narrow-screen lists enough to wrap names or inflate rows.

## Tried and ruled out
The card header and its default-open state did not cause the disk row regressions. The failing compact and medium measurements pointed to the content width and row height after wrapping the collection.

## Watch out
A visual card can be structurally correct while making its contents harder to use through duplicate padding. Check child width and row-height contracts on compact and medium screens when moving an existing section into a collapsible card.

In the code:
- `src/components/CollapsibleSection.tsx` owns the responsive body padding (`px-3 py-3` compact, `px-4 py-4` otherwise).
- The disk collection and Play page cards pass unpadded content to that body.
- `playwright/diskNameLayout.spec.ts` locks compact row height and medium title-column width.
