# S5 — The hardware Back key does nothing, so a keypad user cannot leave a card

- Severity: S1
- Priority: P1
- Product area: Keypad navigation
- Route: Home (and every other ordinary page)
- Control: the handset's physical Back key
- Build identity: `1.0.5-rc1-6ba84`, package `uk.gleissner.c64uremote`
- Geometry: `wm size 480x640`, `wm density 240` — 320 x 426.7 CSS px at DPR 1.5, `compact` profile
- Pixel 4 identity: `9B081FFAZ001WX`
- Target identity: `c64u`, `192.168.1.146`
- First reproduced UTC: `2026-09-19T09:4xZ`
- Reproduction rate: 4/4 presses, every time

## Previous behaviour

Capacitor delivers Android's Back key to a `backButton` listener rather than to the WebView. The
only listener the app registered was in `InterstitialStateProvider`, and only while
`backDismissActive` was true — that is, while an interstitial or a back-dismissible popover was
open. On an ordinary page there was no listener at all.

## The defect

On Home, four consecutive `KEYCODE_BACK` presses changed nothing: the ring selection stayed on
`Pause`, no overlay opened or closed, the route did not change, and the app stayed in the
foreground. A `keydown` listener installed in the page recorded **no event at all** for
`KEYCODE_BACK`. `KEYCODE_ESCAPE`, by contrast, arrived as `{key:"Escape", code:"", keyCode:27}` and
correctly ascended from a card's child back to the card.

Two separate things were wrong, and each alone is enough to break the key:

1. No listener, so no event reached the page outside an interstitial.
2. The event the app synthesises for this key carries no key code (`{key:"Escape", code:"",
   keyCode:0}`). That matches none of the keymap's declared back bindings, so
   `normalizeKeyEvent` resolved it to `null` and `handleKeyDown` returned at its "no binding"
   branch before reaching the dispatch that performs the ascend. Dispatching that exact event into
   the page by hand confirmed it: `defaultPrevented` stayed false and the selection did not move.

The consequence for the 8020 user is that OK descends into a card and nothing climbs back out. A
card's ring wraps inside itself, so after one OK press on Home the rest of the page — CPU & RAM,
Ports, Video, Audio, Lighting, Drives, Printers, Streams, Config, System info — could not be
reached at all without leaving the route with a digit and starting again. The keypad guidance bar
read "Back — Exit" throughout.

The automated sweep measured the size of it: `tools/hil/keypad_reachability.mjs --routes 1` reported
30 unreachable controls on Home before the fix and 4 after it, with the remaining 3 of those 4
being a harness id defect and 1 a separate product defect (see
`S5-KEYPAD-SYSTEM-INFO-NOT-IN-RING.md`).

## The implemented change

`installDeviceBackButton` registers one `backButton` listener for the whole app, from the keypad
provider, and dispatches the `Escape` keydown the navigation handler already knows how to read.
`handleKeyDown` resolves an event `isDeviceBackKey` recognises to the `escape` action, so it
reaches the dispatch and runs the existing back/ascend chain. The interstitial provider's own
listener is gone: two listeners dispatched two Escapes and dismissed one layer too many.

Nothing else changed about what Back does when the app has nothing to dismiss or ascend from: the
dispatch reports the key unhandled, exactly as before, so the key still does not leave the app.

## How the change was verified

On the handset, with the branch installed: Down, Down, Down, OK descends from `home-quick-actions`
to `home-tile-home.section.live-view`; `KEYCODE_BACK` returns the selection to
`home-quick-actions`; a further Down continues the top-level ring to `live-view-card`. The app
stays foregrounded throughout.

`tests/unit/lib/input/deviceBackButton.test.ts` covers the listener: one registration, an Escape
keydown with the shape `isDeviceBackKey` recognises, removal on uninstall, removal of a handle that
arrives after uninstall, and a logged warning when registration fails. Removing
`src/lib/input/deviceBackButton.ts` fails the suite outright.
`tests/unit/hooks/useFocusNavigation.test.tsx` covers the ascend on that event shape; reverting the
whole of `src/hooks/useFocusNavigation.tsx` fails it with the selection left on the card's child.

## What a user does differently now

They press Back and come out of the card they opened, instead of being stuck in it.
