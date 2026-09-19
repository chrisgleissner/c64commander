# S6 — The one-press transport shortcut never fires on the handset

- Severity: S2
- Priority: P2
- Product area: Keypad input
- Route: every route; the shortcut is global
- Control: the handset's F1 and F3 soft keys (`mediaPlayPause`, `mediaNext`)
- Build identity: `1.0.5-rc1-81a3b`, package `uk.gleissner.c64uremote`
- Reproduction rate: 3/3 presses

## Previous behaviour

`src/lib/input/profiles/keypad.ts` declared `{ code: "F1", action: "mediaPlayPause" }` and
`{ code: "F3", action: "mediaNext" }`. `discriminatorMatches` compares `event.code` when a binding
carries one.

## The defect

Those keys reach the WebView with an empty `code`. Measured on the rig with a `keydown` listener in
the page: F1 arrives as `{key:"F1", code:"", keyCode:112}`, F2 as `{key:"F2", code:"",
keyCode:113}`, F3 as `{key:"F3", code:"", keyCode:114}`. A `code` discriminator therefore matched
nothing and neither shortcut fired: pressing F1 on Home with a playlist loaded left the transport
untouched for twelve seconds.

This is the same shape as the Back key defect in this hunt — a binding expressed in terms of a
field the handset does not populate — and it costs the user the same way. Starting the current tune
is the thing they come home for, and the app declares a one-press way to do it that does nothing.

The existing test could not catch it. Its `press()` helper set `key` and `code` to the same string,
so a `code` binding and a `key` binding matched alike.

## The implemented change

Both bindings match on `key`, which the handset does populate with the same name. That is not a
guess at what the device might send — the profile's own comment warns against guessing a code — it
is what a `keydown` listener recorded from the device.

## How the change was verified

`tests/unit/lib/input/transportBindings.test.ts` gained a case that presses the keys the way the
handset sends them, with `code: ""` and the real key codes. Reverting the whole of
`src/lib/input/profiles/keypad.ts` fails it with `expected undefined to be 'mediaPlayPause'`.

## A neighbouring binding this does not settle

`{ keyCode: 82, action: "openMenu" }` also produced no event at all on this rig: `KEYCODE_MENU`
never reached the page. On the Pixel 4 that is expected — it has no menu key and the system
consumes the injected event — so nothing here says whether the Callback's own Menu soft key
delivers it. It is recorded, not fixed.

## What a user does differently now

They press one key to start or pause the tune, from whatever page they are on.
