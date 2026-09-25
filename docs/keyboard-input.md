# Keyboard / Keypad / T9 input

C64 Commander is a touch-first app, but **Keyboard and keypad navigation**
(`keypad_input_enabled`) is enabled by default as a user-visible experimental
feature. It makes the app fully operable — and testable — without a touchscreen,
for keypad-first devices (for example a flip phone / D-pad remote) and Bluetooth
keyboards. It is additive: pointer/touch use keeps the normal touch UX.

> The authoritative per-page list of **every CTA** and its keypad / D-pad / T9
> reachability is `docs/cta-inventory.md`. Keep it current with any control
> change (see `AGENTS.md` → "CTA inventory upkeep").

## 1. Enabling it

Settings → Experimental → **Keyboard and keypad navigation**. It is on by
default and can be disabled there.

## 2. The Prime Directive and `data-key-selected`

The only new visible affordance is a **persistent selected-control highlight** —
a steady ring (using the `--ring` token) layered on top of the existing
`:focus-visible` / `focus-flash` / ARIA treatment, never replacing it. It is the
DOM attribute `data-key-selected="true"`, present on **exactly** the current
focus-ring item, and **only** when:

> `keypad_input_enabled` is ON **AND** input modality is `key-navigation`.

There are exactly four states:

1. **Flag OFF.** DOM/behavior is byte-for-byte identical to a build without the
   feature. No `data-key-selected`, no extra attributes/tabindex, the global key
   listener is detached.
2. **Flag ON, before any recognized key.** Still byte-for-byte identical to the
   flag-off baseline; modality is `pointer`. The discovery engine has not started
   either, so there is no `MutationObserver` and no `tabindex` shim (HARD27-039).
   It starts on the first recognized key, on any modality flip to
   `key-navigation`, or at mount if modality is already that — and once started
   it keeps running, so state 4 below is not byte-for-byte baseline.
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
`previousField`, `activate`, `openMenu`, `closeMenu`, `toggleInputMode`,
`openSearch`, `function1`, `function3`, `mediaPlayPause`, `mediaNext`.

### 3.1 Search: `7`, on its own listener

`7` opens the app-wide search overlay. It is **not** served by the keypad shortcut
handler in `useFocusNavigation`, because that handler exists only while
`flags.keypad_input_enabled` is true (`App.tsx` mounts `FocusNavigationProvider`
with `enabled={…}`). Search is how someone finds their way around when the ring
is not doing it for them, so it must not disappear when they turn the ring off.

`SearchKeyListener` (`src/components/search/SearchKeyListener.tsx`) therefore
installs its own capture-phase `keydown` listener, resolves the event through the
keypad profile, and opens search on `digit7` or on `openSearch`. It applies the
same two exclusions the digit shortcuts do — inert inside a text field, inert
while an overlay owns the keys — which now live in one place,
`src/lib/input/eventTargets.ts`, rather than being copied.

`7` is free only while there are six tabs. `SearchKeyListener.test.tsx` asserts
`TAB_ROUTES.length < 7`, so a seventh tab fails the build rather than silently
stealing the search key.

### 3.2 Function keys: neutral first, then context-owned

The keypad profile normalizes F1 and F3 to neutral `function1` and `function3`
actions. It never assigns them directly to Back, Menu, transport, or C64 input.
The active owner decides: normal C64U Remote navigation runs the persisted app
assignment (defaults: F1 Play/Pause and F3 Next tune), while C64 Commander keeps
its route-changing transport shortcuts. A Remote Input C64 surface sends literal
C64 F1/F3. Dialogs, text entry, capture, and View consume them without an app or
C64 action. Non-repeat presses only run one app command; C64U Remote assignments
do not navigate to Play.

### 3.3 The Commodore key is not bound

`keymap.ts` requires an exact `code`, `key` or `keyCode`, and `keyEvent.ts`
matches exactly. There is no wildcard and no placeholder that later becomes the
right value, and binding a **guessed** real code is worse than binding nothing:
a wrong guess shadows a key that already works. The intended action is recorded
— the Commodore key opens search, a second door beside `7` — so once someone
reads its real code off hardware with the Key Explorer (§5.1), binding it is one
row in a keymap override file (§3.4), and later in `profiles/keypad.ts` once it
is confirmed.

**Nothing may be bound to `keyCode: 0`.** `useFocusNavigation` recognises the
Android hardware Back button as `key === "Escape" && code === "" && keyCode === 0`,
so such a binding would silently steal Back on every handset.
`transportBindings.test.ts` asserts no profile has one, and the override file
schema rejects one.

### 3.4 Keymap override files: per-handset bindings without a rebuild

The built-in profiles are TypeScript and stay the tested defaults. On Android,
the app also reads every `*.json` file in `keymaps/` inside its private files
directory (`/data/data/<package>/files/keymaps/`, Capacitor `Directory.Data`)
at startup, and again when **Reload keymap files** is pressed in the Key
Explorer. No rebuild or reinstall is needed. The loader is
`src/lib/input/keymapOverrideFiles.ts`; the schema is
`src/lib/input/keymapOverrideSchema.ts`.

```json
{
  "schema": 1,
  "match": { "manufacturer": "Acme", "model": "K100" },
  "extends": "keypad",
  "bindings": [
    { "keyCode": 142, "action": "openSearch" },
    { "key": "F1", "action": "function1" }
  ],
  "timing": { "multiTapTimeoutMs": 1000 }
}
```

- `match` is optional. Without it the file applies to every handset. With it,
  each named field must equal the handset's Android `Build.MANUFACTURER` /
  `Build.MODEL`, compared case-insensitively. The Key Explorer shows both values
  for the handset in hand.
- `extends` names the built-in profile the bindings go in front of: `keypad`
  (the default, and the only profile the app mounts) or `defaultKeyboard`.
- Each binding needs at least one of `code`, `key` or a positive `keyCode`, plus
  one of the semantic actions listed above. `shift`, `alt` and `ctrl` are
  optional modifiers. Matching is first-match-wins, so a file binding shadows a
  built-in binding for the same key.
- Files without `match` are applied first and device-specific files after them,
  each group in file-name order, so a device file shadows a generic one.
- A file that is not valid JSON, fails the schema, or cannot be read is skipped
  as a whole, logged at WARN, and listed with its reason in the Key Explorer. A
  file for another handset is listed as skipped for that reason.

To try a binding on a handset, write the file with droidctl's
`droid_app.write_app_file` (`relativePath: "keymaps/acme-k100.json"`). Without
droidctl, the equivalent is:

```bash
adb push acme-k100.json /data/local/tmp/
adb shell run-as uk.gleissner.c64commander mkdir -p files/keymaps
adb shell run-as uk.gleissner.c64commander cp /data/local/tmp/acme-k100.json files/keymaps/
```

Both need a debuggable build, because they go through `run-as`. Then open
**Diagnostics → Key Explorer**, press **Reload keymap files**, and press the key to see what it now resolves to.

## 4. Key-only operation

- **Reachability:** the provider scans the active scope (topmost dialog/menu/
  sheet, otherwise the routed page plus the bottom TabBar) and discovers every
  interactive element. `useFocusItem` and `useFocusGroup` only refine id/order,
  labels, grouping, custom activation, or opt-out.
- **Groups:** labelled sections (`data-section-label`), app dialogs/sheets, and
  explicit `data-focus-group` / `useFocusGroup` containers become groups. Up/Down
  traverse sibling CTAs/groups; **OK goes in**, **Back exits**. Groups with one
  enabled leaf activate that leaf directly.
- **CTAs:** `dpadUp`/`dpadDown` (Arrow Up/Down) and `previousField`/`nextField`
  (Shift+Tab/Tab) traverse the current scope; `center`/`enter`/`activate`
  (Space/Enter/Call) descend into a group or activate the highlighted leaf.
- **Sliders** (HomeCpuSpeed, Play volume, Config sliders): when the thumb is
  focused, **Left/Right adjust the value** (the always-on value label and
  `aria-valuenow` update) and do **not** move focus; **Up/Down move focus** and do
  **not** change the value. A key-repeat burst coalesces into a single device
  write through the existing `useDeviceBoundSlider` throttle — no separate
  key-repeat write path.
- **Dropdowns** (`ConfigItemRow` Radix `Select`): `center`/`enter` opens it; Radix
  then owns option `Up`/`Down`, typeahead, `Enter` (confirm) and `Escape` (close).
  While open, the global ring does not move underneath it. The Android Back key,
  which the app delivers as an Escape keydown at the focused element, closes it.
- **Text fields (T9):** attach `useT9Input` to an `<input>`. Digit keys, `*`, and
  `#` are routed through the multi-tap / hostname composer; every other key
  (Backspace, arrows, Enter, Tab, letters) passes through untouched. Hostname
  fields use hostname mode (digits insert directly; `*` cycles separators
  `. : - _ /`); name fields use multi-tap. `#`/`toggleInputMode` switches mode.
  When numeric-keypad T9 is active and the field has key-navigation modality, a
  small `T9 Hostname` / `T9 Multitap` indicator appears.
- **Back / `navigate(-1)`:** the back chain is deterministic — dismiss overlay →
  leave field → ascend group → route back, or on the first route of the session
  send the app to the background. Keyboard **Escape never navigates**; only the
  hardware Back key and left soft key navigate when the chain is exhausted.
- **Guidance bar:** while key-navigation modality is active, a fixed bar above
  the TabBar (at the screen edge while a dialog or sheet hides the TabBar) shows
  the current breadcrumb plus Back/OK labels, and Menu where the focused control
  has a menu of its own. Dialogs and sheets are placed above it. It clears in
  the same frame as the highlight when the user touches/clicks.
- **Soft keys/Menu:** left soft key follows the back chain; right soft key/Menu
  opens the current item or scope's context menu when one exists, otherwise the
  keypad **Quick Menu**.
- **Always-reachable shortcuts (outside a text field):** digits **1–6** jump
  straight to the six tabs (Home/Play/Disks/Config/Settings/Docs); **✱** opens
  Diagnostics; **#** opens the Device Switcher (the keypad equivalent of
  long-pressing the status badge); the **Menu** key opens the Quick Menu when the
  focused item has no context menu. Inside a text field these keys belong to T9.
  Wired by the app shell via `FocusNavigationProvider`'s `shortcuts` prop and the
  `src/lib/input/keypadCommands.ts` event bus; see `docs/cta-inventory.md` §1.

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

### 5.1 Key Explorer

**Diagnostics → Key Explorer** answers "what does this key actually send?" For
each key pressed it reports the `key`, `code` and `keyCode` the WebView
delivered, and the semantic action the keypad profile resolves it to — or that it
resolves to nothing. The last ten are kept and can be copied as text. It also
shows the handset's manufacturer and model, which keymap override files were
applied or skipped and why, and a **Reload keymap files** button (§3.4).

It cannot reuse the diagnostics above, for three reasons that all apply at once:
they emit only when debug logging is on; events on editable targets are
deliberately never logged; and an event inside an open overlay returns before
diagnostics are emitted, which is exactly where this panel sits. It therefore
installs its own capture-phase listener, **active only while the panel is open**.

## 6. Privacy

Diagnostics intentionally do **not** record any field text or the T9 buffer (only
lengths/indices), and never raw host/IP values. Structure that could carry
sensitive values sits under keys the existing recursive export redactor
sanitizes (`host`/`hostname`/`ip`/`address`, `password`/`token`/…). The global
handler skips editable targets, so typed characters are never captured.

The Key Explorer records **key identity only**. A printable character is replaced
by its shape — `<character>`, `<digit>`, `<space>` — before it is stored, so
nothing anyone typed can reach a report they are about to attach to a bug. A
named key such as `Escape` or `F1` is kept as it is, because that name is the
answer the panel exists to give.

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
