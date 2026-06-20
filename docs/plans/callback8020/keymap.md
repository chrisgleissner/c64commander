# Keypad / T9 input subsystem

`src/lib/input/` is a self-contained, dependency-free subsystem that lets the
app be operated entirely with physical keys — D-pad, number keypad, soft keys
and a Back key — on the keypad-first **Commodore Callback 8020** (Sailfish OS
Android AppSupport, ~3.25" / 480×640, touch disabled by default).

> Status: **designed for Callback 8020 constraints**. The exact
> `KeyboardEvent` codes the device surfaces through AppSupport are not publicly
> documented, so the device profile binds each hardware key by several
> plausible aliases (named `code`, `Arrow*` fallback, and Android legacy
> `keyCode`). This has **not been validated on real hardware.**

## Design

UI components consume **semantic actions**, never raw key codes. The mapping
from a physical key to a semantic action lives entirely in the keymap and
profiles, colocated with the T9 composer and focus controller — there is no
scattered `onKeyDown` parsing.

```
KeyboardEvent ──normalizeKeyEvent(keymap)──▶ SemanticAction
SemanticAction ──applySemanticAction()────▶ T9 text state   (text fields)
SemanticAction ──FocusController──────────▶ focus / activate (CTAs)
```

### Semantic actions

`digit0`…`digit9`, `star`, `hash`, `dpadUp`, `dpadDown`, `dpadLeft`,
`dpadRight`, `center`, `softLeft`, `softRight`, `back`, `delete`, `enter`,
`escape`, `nextField`, `previousField`, `activate`, `openMenu`, `closeMenu`,
`toggleInputMode`.

### Profiles

| Profile                 | id                | Purpose                                                        |
| ----------------------- | ----------------- | -------------------------------------------------------------- |
| Default keyboard        | `defaultKeyboard` | Desktop/dev — the whole UX is exercisable on a normal keyboard |
| Commodore Callback 8020 | `keypad`          | Physical D-pad + numeric keypad mapping (extends the desktop profile) |

> The keypad profile's code id is **`keypad`** (see `src/lib/input/profiles/`).
> `App.tsx` mounts it via `KEYPAD_FOCUS_PROFILE_ID = "keypad"`; it is the single
> active non-default profile.

`resolveInputProfile(id?)` returns the keymap for an id, falling back to
`defaultKeyboard`. Auto-detection is unreliable inside AppSupport, so the
profile is selected explicitly (`App.tsx` uses `keypad`).

#### Default keyboard mapping

| Key                      | Action                        |
| ------------------------ | ----------------------------- |
| Arrow keys               | `dpadUp/Down/Left/Right`      |
| Space                    | `center`                      |
| Enter / NumpadEnter      | `enter`                       |
| Tab / Shift+Tab          | `nextField` / `previousField` |
| Backspace / Delete       | `delete`                      |
| Escape                   | `escape`                      |
| `0`–`9` / Numpad `0`–`9` | `digit0`–`digit9`             |
| `*` / Numpad `*`         | `star`                        |
| `#`                      | `hash`                        |
| F1 / F2                  | `softLeft` / `softRight`      |
| F3                       | `toggleInputMode`             |
| ContextMenu              | `openMenu`                    |

#### Commodore Callback 8020 mapping (additions over the base)

| Hardware key             | Action                   | Bound via                                  |
| ------------------------ | ------------------------ | ------------------------------------------ |
| D-pad up/down/left/right | `dpadUp/Down/Left/Right` | `Dpad*`, `Arrow*`, keyCode 19–22           |
| D-pad center / OK        | `center`                 | `DpadCenter`, keyCode 23                   |
| Keypad `0`–`9`           | `digit0`–`digit9`        | inherited (`Digit*` / `Numpad*`)           |
| `✱`                      | `star`                   | `Star`, key `*`, keyCode 17                |
| `#`                      | `hash`                   | `Pound`, key `#`, keyCode 18               |
| Left / right soft key    | `softLeft` / `softRight` | `SoftLeft`/`SoftRight`, F1/F2, keyCode 1/2 |
| Back / Clear             | `back`                   | `GoBack`, `BrowserBack`, keyCode 4         |
| Call / Send              | `activate`               | `Call`, keyCode 5                          |
| Menu                     | `openMenu`               | `ContextMenu`, keyCode 82                  |

The multi-tap window is 1000 ms on the device profile (800 ms on desktop).

## T9 composer

A pure, timer-free state machine (`t9.ts`). The caller supplies a `now`
timestamp on every press, so it is fully deterministic and unit-tested.

### Multi-tap table (`multitap` mode, general text)

| Key    | Candidates                                 |
| ------ | ------------------------------------------ |
| `1`    | `.` `,` `?` `!` `-` `_` `:` `/`            |
| `2`    | a b c 2                                    |
| `3`    | d e f 3                                    |
| `4`    | g h i 4                                    |
| `5`    | j k l 5                                    |
| `6`    | m n o 6                                    |
| `7`    | p q r s 7                                  |
| `8`    | t u v 8                                    |
| `9`    | w x y z 9                                  |
| `0`    | (space) 0                                  |
| `star` | toggle case of the pending/last character  |
| `hash` | cycle input mode (`multitap` ↔ `hostname`) |

Repeated presses of the same key within the multi-tap window cycle candidates
in place. A different key — or the window expiring — commits the pending
character and starts a new one. `delete` drops the pending candidate first,
then the previous committed character. D-pad left/right commit, then move the
cursor. `enter`/`center` commit.

### `hostname` mode (optimized for IP / hostname entry)

- **Digits `0`–`9` insert directly** (no multi-tap) — so IP octets are fast and
  the many `1`s in an address are trivial to type.
- **`star`** multi-taps the separator list `. : - _ /` (first tap = `.`).
- **`hash`** switches to `multitap` to type letters, then back.

This is a first-class fallback even when the on-screen keyboard is impractical:
no soft keyboard is required to enter a host or IP.

### Exact keystrokes for the canonical targets

(`★` = `star`; `n·k` = press key `n`, `k` taps, then commit. Proven in
`tests/unit/lib/input/t9.test.ts`.)

| Target              | Mode     | Keystrokes                                                              |
| ------------------- | -------- | ----------------------------------------------------------------------- |
| `192.168.1.13`      | hostname | `1 9 2 ★ 1 6 8 ★ 1 ★ 1 3`                                               |
| `192.168.1.13:8080` | hostname | `… 1 3` then `★★` (star twice → `:`) then `8 0 8 0`                     |
| `c64u`              | multitap | `2·3` (c) `6·4` (6) `4·4` (4) `8·2` (u)                                 |
| `c64u.local`        | multitap | `c64u` then `1·1` (.) `5·3` (l) `6·3` (o) `2·3` (c) `2·1` (a) `5·3` (l) |

## Navigation model — "OK to go in, Back to go out"

Reachability is **complete by construction**: the provider scans the live DOM of
the active scope (the topmost open overlay, else the routed page; the bottom tab
bar is its own scope appended last) and builds the focus ring in reading order
(`src/lib/input/discovery.ts` + `focusDiscovery.ts`). `useFocusItem` /
`useFocusGroup` are optional refinements (stable id, explicit order, group
membership, custom activation, opt-out) — not the gate for reachability.

| Keys                                                    | Meaning                                                                                  |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Up / Down**, D-pad up/down, Tab / Shift+Tab           | Move between CTAs in the current scope (wrap; skip disabled)                              |
| **Center / OK / Enter / Call**                          | **Go in:** descend into a group (a card/section with children), else **activate** a leaf |
| **Back / Escape / Left soft key / hardware Back**       | **Go out:** dismiss overlay → disengage field → ascend the group scope → navigate¹       |
| **Left / Right**                                        | Owned by the focused control (slider value, tabs, segmented); else previous/next sibling |
| **Right soft key / Menu**                               | Open the current item's / scope's context menu (`openMenu`), if any                       |

¹ Only the **hardware Back** key (and the left soft key) navigate the route once
the in-app chain is exhausted; keyboard **Escape never navigates** — it lets the
open overlay's own dismiss handler run. A trivial group (exactly one enabled
leaf) activates that leaf directly instead of forcing a pointless descend.

`FocusController` (`focusController.ts`) keeps the ordered registry;
`NavigationController` (`focusNavigation.ts`) maps semantic actions onto it and
owns the dismissible-layer stack + the engaged-field flag. Disabled items are
skipped during navigation and refuse activation, so a destructive CTA can never
be reached or triggered by accident while disabled.

## Selected-control highlight + context guidance bar

While the keypad flag is on **and** input modality is `key-navigation`:

- the current ring item carries `data-key-selected` (a persistent high-contrast
  outline) and, when descended, the enclosing group carries `data-key-scope`;
- a fixed **context guidance bar** (`src/components/input/KeypadGuidanceBar.tsx`)
  shows the scope breadcrumb and labels the soft keys —
  **Back/Exit/Close/Done** · **Open/Edit/Select/Toggle/Adjust/Activate** ·
  **Menu** — derived from the pure `resolveGuidanceLabels` (`guidance.ts`).

Both clear the instant a pointer/touch is used (modality flips to `pointer`), and
neither exists at all when the flag is off — the app is byte-for-byte baseline.

### T9 mode indicator

When the numeric-keypad T9 composer is active on a focused field, a small,
modality/flag-gated indicator shows the current mode (`multitap` ↔ `hostname`,
toggled with `#`). Literal digit/letter typing is the default; T9 is keypad-only.
