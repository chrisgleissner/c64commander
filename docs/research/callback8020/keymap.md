<!--
  C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
  Copyright (C) 2026 Christian Gleissner
  Licensed under the GNU General Public License v3.0 or later.
-->

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

| Profile                 | id                      | Purpose                                                        |
| ----------------------- | ----------------------- | -------------------------------------------------------------- |
| Default keyboard        | `defaultKeyboard`       | Desktop/dev — the whole UX is exercisable on a normal keyboard |
| Commodore Callback 8020 | `commodoreCallback8020` | Physical keypad mapping (extends the desktop profile)          |

`resolveInputProfile(id?)` returns the keymap for an id, falling back to
`defaultKeyboard`. Auto-detection is unreliable inside AppSupport, so the
profile is selectable via a settings/developer override.

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

## Focus controller

`FocusController` (`focusController.ts`) keeps an ordered registry of
activatable items. `dpadDown`/`nextField` → `focusNext()`,
`dpadUp`/`previousField` → `focusPrevious()` (both wrap and skip disabled
items), and `center`/`enter`/`activate` → `activateCurrent()`. Disabled items
are skipped during navigation and refuse activation, so a destructive CTA can
never be reached or triggered by accident while disabled.
