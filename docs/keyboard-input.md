# Keyboard / Keypad / T9 input

C64 Commander is a touch-first app. The optional, default-off experimental
feature **Keypad / T9 input** (`keypad_input_enabled`) makes the app fully
operable — and testable — without a touchscreen, for keypad-first devices (e.g. a
flip phone / D-pad remote) and Bluetooth keyboards. It is purely additive: it
never changes the touch UX.

## 1. Enabling it

Settings → Experimental → **"Keypad / T9 input"**. Off by default on every
variant/platform.

## 2. The Prime Directive and `data-key-selected`

The only new visible affordance is a **persistent selected-control highlight** —
a steady ring (using the `--ring` token) layered on top of the existing
`:focus-visible` / `focus-flash` / ARIA treatment, never replacing it. It is the
DOM attribute `data-key-selected="true"`, present on **exactly** the current
focus-ring item, and **only** when:

> `keypad_input_enabled` is ON **AND** input modality is `key-navigation`.

There are exactly four states:

1. **Flag OFF (default).** DOM/behavior is byte-for-byte identical to a build
   without the feature. No `data-key-selected`, no extra attributes/tabindex, the
   global key listener is detached.
2. **Flag ON, before any recognized key, and during pointer/touch use.** Still
   byte-for-byte identical to the flag-off baseline; modality is `pointer`.
3. **Flag ON, a recognized key takes effect** (focus moved, control activated,
   back handled, layer dismissed, slider value changed, or a T9 composer key
   consumed). Modality becomes `key-navigation`; the current focus-ring item gets
   `data-key-selected`.
4. **Flag ON, key modality, then the user touches/clicks.** Modality returns to
   `pointer` and the highlight is removed the same frame
   (`pointerdown`/`touchstart`, capture phase).

A key that is unrecognized, or recognized but produces no effect, never flips
modality, never shows a highlight, and never calls `preventDefault`.

Implementation: modality lives in an imperative module
(`src/lib/input/inputModality.ts`) and the highlight is toggled directly on the
DOM element by `FocusNavigationProvider` (no React state in the hot path), so it
cannot trigger a re-render loop.

## 3. Supported key families → semantic actions

Physical keys are normalized to **semantic actions**; the authoritative list is
`SEMANTIC_ACTIONS` in `src/lib/input/keyEvent.ts`. Mapping is data-driven in
`src/lib/input/profiles/` (`defaultKeyboard` for desktop/Bluetooth keyboards,
`keypad` merged over it for Android D-pad/numeric keypads). Families:
`digit0`–`digit9`, `star`, `hash`, `dpadUp/Down/Left/Right`, `center`,
`softLeft/Right`, `back`, `delete`, `enter`, `escape`, `nextField`,
`previousField`, `activate`, `openMenu`, `closeMenu`, `toggleInputMode`.

## 4. Key-only operation

- **CTAs:** `dpadUp`/`dpadDown` (Arrow Up/Down) and `previousField`/`nextField`
  (Shift+Tab/Tab) traverse the ring; `center`/`enter`/`activate` (Space/Enter)
  activate the highlighted control.
- **Sliders** (HomeCpuSpeed, Play volume, Config sliders): when the thumb is
  focused, **Left/Right adjust the value** (the always-on value label and
  `aria-valuenow` update) and do **not** move focus; **Up/Down move focus** and do
  **not** change the value. A key-repeat burst coalesces into a single device
  write through the existing `useDeviceBoundSlider` throttle — no separate
  key-repeat write path.
- **Dropdowns** (`ConfigItemRow` Radix `Select`): `center`/`enter` opens it; Radix
  then owns option `Up`/`Down`, typeahead, `Enter` (confirm) and `Escape` (close).
  While open, the global ring does not move underneath it. Keypad `back`
  (Android keyCode 4, which Radix does not recognize) closes it.
- **Text fields (T9):** attach `useT9Input` to an `<input>`. Digit keys, `*`, and
  `#` are routed through the multi-tap / hostname composer; every other key
  (Backspace, arrows, Enter, Tab, letters) passes through untouched. Hostname
  fields use hostname mode (digits insert directly; `*` cycles separators
  `. : - _ /`); name fields use multi-tap. `#`/`toggleInputMode` switches mode.
- **Back / `navigate(-1)`:** the `back`/`escape` chain is deterministic —
  close popup → leave menu → leave field → **router back** (`navigate(-1)`). With
  the flag on, an exhausted back navigates the router back; this is intentional
  keypad behavior.

## 5. Diagnostics

Key-event diagnostics help a maintainer calibrate real-device mappings from an
exported bundle. They are emitted via `addLog('debug', 'key-input', …)` and are
**off unless debug logging is on** (Settings → debug logging; localStorage
`c64u_debug_logging_enabled`). The hot keydown path allocates nothing when off
(it cheap-checks the flag before building the details object).

What is logged:

- The global handler logs **recognized** navigation/activation/back keys and
  **unmapped** keys (`normalizedAction: null`, with an `ignoredReason` so a
  binding can be added from the export). It never sees editable targets, so it
  never logs typed text.
- `useT9Input` logs **only** composer-consumed keys (`digit*`/`star`/`hash`/
  `toggleInputMode`).

Each entry carries: `category`, `timestamp`, `route`, `activeElement`
(`tagName`/`role`/`ariaLabel`/`dataTestId`/`inputType`), `selectedControlId`,
`rawEvent` (`type`/`key`/`code`/`keyCode`/`which`/`location`/`repeat`/
`isComposing`/modifiers), `normalizedAction`, `keyFamily`, `handled`,
`ignoredReason`, `preventDefaultApplied`, `keypadEnabled`, `modality`, and — for
T9 — `t9State` with **lengths/indices only**.

## 6. Privacy

Diagnostics intentionally do **not** record any field text or the T9 buffer (only
lengths/indices), and never raw host/IP values. Structure that could carry
sensitive values sits under keys the existing recursive export redactor
sanitizes (`host`/`hostname`/`ip`/`address`, `password`/`token`/…). The global
handler skips editable targets, so typed characters are never captured.

## 7. Test procedures

- **Bluetooth keyboard:** enable the flag, then use Arrow keys (focus), Space/
  Enter (activate), Tab/Shift+Tab (next/previous field), Left/Right on a focused
  slider (value), Escape (back), and the number row + `*`/`#` in a host field.
- **ADB keyevents:** `scripts/android-keypad-smoke.sh <serial> <apk> <package>`
  drives the full keypad surface with hardware keys only — keycodes:
  `20` DPAD_DOWN, `19` DPAD_UP, `22` DPAD_RIGHT, `21` DPAD_LEFT, `23` DPAD_CENTER,
  `66` ENTER, `67` DEL, `8`/`9`/`10`/`16` digits 1/2/3/9, `17` STAR, `18` POUND —
  and captures a `uiautomator` dump + screenshot of where focus landed. It cannot
  flip the localStorage flag, so the highlight only renders when the flag is
  already on.
- **Maestro:** `.maestro/keypad-input-smoke.yaml` (tags `device`, `keypad`) toggles
  the flag and proves touch still works; it does not inject D-pad/Star (use the
  adb harness for that). **CI does not gate this flow.**
- **CI proof:** `playwright/keypadInput.spec.ts` (run by `npm run test:e2e`) is the
  authoritative, CI-enforced functional proof of all four Prime-Directive states,
  both hazards (slider Left/Right vs Up/Down; dropdown option-nav vs the ring),
  T9 host entry, and diagnostics gating.

## 8. Known limitations

- A Bluetooth keyboard is **not** equivalent to a flip-phone keypad; mappings are
  validated for both profiles, but real flip-phone certification needs real
  hardware.
- The keypad Maestro flow is **local/device-only** and not CI-gated (keypad needs
  special key injection that would bloat the CI Maestro budget).
- The ADB smoke script drives OS-level keys but cannot toggle the in-app
  localStorage flag, so its highlight evidence requires the flag pre-enabled.
