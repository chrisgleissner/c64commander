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

> ## FIXED (2026-08-22) — verified on the device at 427x320
>
> Two causes, both fixed. **Layout:** the manual-entry form had no height bound or scroll
> container, and `Connect` lived inside it, so it was pushed below the fold. `Connect` now sits in
> the `DialogFooter`, outside that scroll container, tied to the form by `form=`; it renders at
> y=247 `visible: true` where it used to be at y=285-329 and invisible. **Focus:** a focused
> single-line text field swallowed every navigation key, and inside an overlay Back/Escape belong
> to the dialog while the global ring is deliberately inert, so the autofocused host field was a
> dead end. `Up`/`Down` now step the overlay's own tab order out of a single-line field.
>
> End-to-end on the handset: the app autofocuses the host field, one `DPAD_DOWN` moves to
> `Connect` (visible), `OK` submits, and the attempt reports "Host unreachable" — correct, the
> phone's Wi-Fi was off. Regression tests in `tests/unit/hooks/useFocusNavigation.test.tsx`;
> removing the production change makes two of them fail.

## How it was diagnosed — what changed, and what was still wrong after the first attempt

**Fixed (layout).** The candidates branch of this dialog was bounded and scrollable
(`max-h-[min(26rem,60vh)] overflow-y-auto`); the manual-entry form holding `Connect` had **no
height bound and no scroll container**, so on a short viewport it simply overflowed. The form now
carries the same treatment its sibling already had. Re-measured on the device at 427x320:

- the form now scrolls (`scrollHeight` 208 > `clientHeight` 192)
- the host input is **visible when focused** (y=165), where before it was at y=178 and
  `visible: false` with no way to bring it into view
- `Connect` measures y=269, bottom 313 inside a 320 viewport, and **TAB now focuses it, visible** —
  before, it sat at y=285-329 and could not be focused or seen at all

**Still wrong (focus ring).** `Connect` is **not in the d-pad ring order**, even though it is a
plain enabled `<button>`, is inside the resolved dialog scope, and appears in the ring's own
discovered set in correct DOM order (close, host input, connect, dismiss). Measured:

- from the host input, `DPAD_DOWN` is **consumed by the text field** — it scrolls the panel
  (y 165 → 125 → 85 → 45) instead of advancing focus
- `DPAD_RIGHT` from the input jumps straight to `Not now`, skipping `Connect`
- from `Not now`, `DPAD_UP` goes to `Close`, again skipping `Connect`
- only `TAB` reaches it

A Callback 8020 is d-pad and keypad; it has no Tab key. So for the target device this is **still
blocking**, and the remaining work is in the focus ring, not the layout.

## Suggested direction

The dialog's footer actions need to stay inside the viewport at 320 px height — e.g. a scrollable
body with a pinned footer, so `Connect` and `Not now` are always on screen — and the focus ring must
be able to reach every control in the dialog regardless of scroll position, scrolling the focused
element into view as it goes.

## Related

- The keypad contract in `REVIEW.md` §5: "Any interactive control stays reachable by keypad / D-pad /
  T9. An unreachable control is a broken control." This is exactly that.
