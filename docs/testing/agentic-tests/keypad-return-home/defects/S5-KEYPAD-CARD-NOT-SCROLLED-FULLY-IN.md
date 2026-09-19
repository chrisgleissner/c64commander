# S5 — A selected card that fits the screen is left with part of it under the tab bar

- Severity: S3
- Priority: P3
- Product area: Keypad navigation
- Route: Home (the Streams card); the rule applies to every ring stop
- Build identity: `1.0.5-rc1-74010`, package `uk.gleissner.c64uremote`
- Geometry: 320 x 426.7 CSS px, `compact` profile
- Reproduction rate: 2/2 automated sweeps of Home, plus a hand measurement

## Previous behaviour

`focusRingElement` aligned every ring stop with `element.scrollIntoView({ block: "nearest" })`. The
element carries `keypad-scroll-anchor`, whose `scroll-margin-top` and `scroll-margin-bottom`
reserve space for the app bar above and the guidance and tab bars below.

## The defect

`block: "nearest"` performs the smallest scroll that brings the element into view, and it does
nothing at all once the element's top is on screen. A card taller than the visible area but shorter
than the area the app reserves therefore stays half shown.

Measured on the handset with `home-stream-status` selected: height 262 px, top 196, bottom 458,
viewport 427, `scroll-margin-top` 117 px, `scroll-margin-bottom` 21 px. The area the app reserves
for it is 289 px, so the card fits — and 31 px of it sat below the viewport, under the tab bar.

`tools/hil/keypad_reachability.mjs --routes 1` reports it as the only off-screen stop on Home, in
two consecutive runs.

## The implemented change

`resolveRingScrollAlignment` decides between `end` and `nearest` from the element's own geometry: a
stop that fits the reserved area and extends past it is aligned to its end, so `scroll-margin-bottom`
places it above the bars. A stop taller than the reserved area keeps `nearest`, because it cannot be
shown whole and aligning its end would push its first rows above the app bar — the user descends
into it to see the rest.

## How the change was verified

`tests/unit/lib/input/ringScroll.test.ts` covers the four cases with the measured handset numbers:
the Streams card (`end`), the 413 px Lighting card that cannot fit (`nearest`), a stop already
inside the reserved area (`nearest`), and a short stop hidden behind the bottom bars (`end`).
Removing `src/lib/input/ringScroll.ts` fails the suite outright.

## What a user does differently now

They see the whole of the card the ring has moved to, instead of its last rows disappearing under
the tab bar.
