# S2-GAMEMODE-8020-LANDSCAPE-CONNECT-UNREACHABLE — First-run setup is impossible on a keypad handset in landscape

- ID: S2-GAMEMODE-8020-LANDSCAPE-CONNECT-UNREACHABLE
- Title: "No C64 found" dialog renders its Connect button off-screen in landscape, and the keypad cannot reach it
- Severity: S2
- Priority: P1 — blocks first-run setup on the target device for the C64U Remote edition
- Product area: Device discovery / first-run onboarding
- Route: any (the interstitial is app-wide)
- Overlay/dialog: `DeviceDiscoveryInterstitial`
- Control label: `Connect`
- Input method: injected physical key events (`adb shell input keyevent`), no touch
- Build identity: `0.9.9-rc2-1db2e` (c64u-remote edition, debug)
- Git SHA: `1db2e0e6`
- Pixel 4 identity: `9B081FFAZ001WX`, emulating the Callback 8020 via `wm size 640x480` + `wm density 240`
- Reproduction rate: 1/1, deterministic
- Preconditions: C64U Remote edition; no saved device; app orientation set to Landscape
  (Settings → Appearance → Landscape); network unreachable so discovery finds nothing.

## What happens

At 427x320 CSS (the 8020 in landscape) the discovery dialog's content is 363 px tall in a 320 px
viewport. Measured from the live DOM:

```
viewport height            320
dialog                     y=54  height=254  bottom=308
dialog scrollHeight/client 363 / 253      (so it is scrollable)
button "× Close"           y=65   bottom=105   visible=true
button "Not now"           y=247  bottom=291   visible=true
button "Connect"           y=285  bottom=329   visible=FALSE
```

The only visible action is the dismissive one. The primary action is below the fold.

That alone would be survivable on a touchscreen, because the dialog scrolls. The Callback 8020 has
no touchscreen, and the keypad cannot reach the button:

- 8 × `DPAD_DOWN`: focus never leaves `Not now`.
- `DPAD_UP` / `DPAD_LEFT` / `DPAD_RIGHT`: focus goes to `Close`.
- `TAB`: focus reaches the host/IP input — at y=178, also `visible: false`, **and focus does not
  scroll it into view**.

So the user types their C64's address into a field they cannot see, and can never reach `Connect`.
There is no keyboard-only path to connecting. First-run setup cannot be completed.

Proof of the boundary: to get the app onto a device at all, the button had to be clicked through
CDP (`element.click()`), which bypasses both the viewport and the focus ring. A real user has
neither.

## What is NOT wrong

Checked, so the fix is not aimed at the wrong thing:

- **Portrait is fine.** At 320x427 the same dialog measures `Connect` at y=308–352, `visible: true`,
  and the first `DPAD_DOWN` focuses it. Verified by observation, not inferred.
- **The focus ring is not generally broken.** 22 focus steps down the Settings page in portrait left
  exactly one element reported off-screen, and that was a section container taller than the viewport
  — not a stranded control. This is specific to this dialog's footer.
- **The disconnected state itself is good.** With no network the app shows a clear "No C64 found"
  prompt with a host/IP field rather than a blank or stuck screen.

## Suggested direction

The dialog's footer actions need to stay inside the viewport at 320 px height — e.g. a scrollable
body with a pinned footer, so `Connect` and `Not now` are always on screen — and the focus ring must
be able to reach every control in the dialog regardless of scroll position, scrolling the focused
element into view as it goes.

## Related

- The keypad contract in `REVIEW.md` §5: "Any interactive control stays reachable by keypad / D-pad /
  T9. An unreachable control is a broken control." This is exactly that.
