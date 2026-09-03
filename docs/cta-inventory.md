# CTA Inventory & Keypad Navigation Reference

This document is the **authoritative, maintained inventory of every CTA**
(call-to-action / interactive control) in C64 Commander, organised by page and
hierarchy, together with the keypad / D-pad / T9 mapping used to reach and
operate each one without a touchscreen.

It is the reference checklist for keypad-first devices (D-pad + numeric T9
keypad remotes such as the Commodore _Callback 8020_, and Bluetooth keyboards).
It complements:

- `docs/keyboard-input.md` — the keypad/keyboard/T9 feature design and semantics.
- `docs/features-by-page.md` — the broader user-facing feature surface.

> **MAINTENANCE (mandatory).** Whenever a CTA is added, removed, re-typed,
> re-grouped, or moved to a different page/route, **update this document in the
> same change**. See the rule in `AGENTS.md` ("CTA inventory upkeep"). Counts in
> §3 are a quick tripwire: if a page's interactive-element count changes and this
> file did not, the change is incomplete.
>
> `npm run lint:reference-docs` checks the mechanical half: every `data-testid` on
> an interactive element in `src/pages` or `src/components` has to be mentioned
> here. It reads the abbreviations this document already uses — `a|b|c`, `{a,b}`,
> `<slot>` and `*` — so an entry may keep naming a family in one token. It cannot
> judge keypad reachability, which still needs the §7 device pass.

Last verified on real hardware: **Pixel 4 (Android 16)** against a real **c64u**
(firmware 1.1.0), app `0.8.8-b92e0`, branch `feat/keyboard-input`,
`keypad_input_enabled = on`.

---

## 1. The keypad device model

The device is assumed to have a D-pad + numeric-T9 remote. Its physical keys emit
standard Android key codes; the app's `keypad` input profile
(`src/lib/input/profiles/keypad.ts`, merged over `defaultKeyboard`) normalises
them to **semantic actions** (`src/lib/input/keyEvent.ts`). The exact
`KeyboardEvent` codes an Android WebView surfaces for these keys vary by host,
so each key is bound by several plausible aliases (named code, Arrow/Enter
fallback, and the legacy Android key code).

| Physical key          | Android keycode      | Semantic action   | Behaviour in app                                                                                                                                                                                                                                                  |
| --------------------- | -------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-pad **Up**          | `DPAD_UP` 19         | `dpadUp`          | Move to previous sibling CTA/group in scope (wraps). On a focused slider thumb: **moves focus** (does not change value).                                                                                                                                          |
| D-pad **Down**        | `DPAD_DOWN` 20       | `dpadDown`        | Move to next sibling CTA/group in scope (wraps).                                                                                                                                                                                                                  |
| D-pad **Left**        | `DPAD_LEFT` 21       | `dpadLeft`        | On a value control (slider/tabs/segmented): **decrement / previous**. Otherwise previous sibling.                                                                                                                                                                 |
| D-pad **Right**       | `DPAD_RIGHT` 22      | `dpadRight`       | On a value control: **increment / next**. Otherwise next sibling.                                                                                                                                                                                                 |
| D-pad **OK / Center** | `DPAD_CENTER` 23     | `center`          | **"OK goes in":** descend into the focused group, or activate the focused leaf. On a Select: opens the dropdown.                                                                                                                                                  |
| **Back / Clear**      | `BACK` 4             | `back`            | **"Back goes out":** dismiss overlay → leave field → ascend group → finally route back. (Capacitor may intercept hardware Back; see §6.)                                                                                                                          |
| **Call / Send**       | `CALL` 5             | `activate`        | Primary activate of the focused leaf.                                                                                                                                                                                                                             |
| **Menu**              | `MENU` 82            | `openMenu`        | Right soft-key "Menu": focused item's context menu, else the **Quick Menu** (jump-to-page / Game Mode / Diagnostics / Switch device).                                                                                                                             |
| **Left soft key**     | `SOFTLEFT` 1         | `softLeft`        | Follows the Back chain (Back/Exit/Close/Done).                                                                                                                                                                                                                    |
| **Right soft key**    | `SOFTRIGHT` 2        | `softRight`       | Opens current item/scope menu.                                                                                                                                                                                                                                    |
| **1–9**               | `KEYCODE_1..9` 8–16  | `digit1`–`digit9` | In a text field: T9 entry. Outside a field: **jump to tab 1–6** (Home/Play/Disks/Config/Settings/Docs); **7 opens Search**, on its own listener so it survives `keypad_input_enabled = off`; 8–9 unbound at app level.                                                                                                                                 |
| **0**                 | `KEYCODE_0` 7        | `digit0`          | In a text field: T9 entry. Outside a field: **enter Game Mode** (starts the remembered Watch/Listen and opens the sheet ready to play). Inside the Remote Input sheet it is a joystick direction, which the open-overlay exclusion keeps this shortcut away from. |
| **✱ (star)**          | `STAR` 17            | `star`            | In a hostname field: cycle separators `. : - _ /`. Otherwise **open Diagnostics**.                                                                                                                                                                                |
| **# (pound)**         | `POUND` 18           | `hash`            | In a text field: toggle T9 mode. Otherwise **open the Device Switcher** (= badge long-press).                                                                                                                                                                     |
| (desktop equiv.)      | `ESCAPE` 111 / `Esc` | `escape`          | Dismiss overlay / ascend — **never navigates the route** (only Back/soft-left do).                                                                                                                                                                                |
| **F1**                | —                    | `mediaPlayPause`  | Play / pause the transport, from any page. Bound in the **keypad profile only**, so a desktop keyboard keeps `F1 → softLeft`. Latched across the navigation to Play.                                                                                             |
| **F3**                | —                    | `mediaNext`       | Next tune, from any page. Keypad profile only, so a desktop keyboard keeps `F3 → toggleInputMode`.                                                                                                                                                                |
| **Commodore**         | unknown              | —                 | **Not bound.** Its emitted code is unknown, and a guessed real code would shadow a key that already works. Intended action once known: open Search. See Diagnostics → Key Explorer.                                                                                |

Desktop/Bluetooth-keyboard equivalents (`defaultKeyboard` profile): Arrows =
D-pad, Space = OK/center, Enter = enter, Tab/Shift+Tab = next/previous field,
Backspace = delete, Esc = back, F1/F2 = soft keys, number row + `*`/`#` = T9.

### Persistent affordances while in key-navigation modality

- **Selected-control highlight:** `data-key-selected="true"` on exactly the
  current ring item (a steady ring), only while `keypad_input_enabled` is on and
  modality is `key-navigation`. Touch/click returns to pointer modality and
  clears it the same frame.
- **Guidance bar:** a fixed bar above the TabBar showing the breadcrumb plus the
  contextual soft-key labels — left = Back/Exit, center = Open/Select/Adjust/
  Activate (by control kind), right = Menu. On Home and Play with a device
  connected it also carries the **0 Game Mode** hint, so the shortcut is on screen
  exactly when the user is driving by keys.
- **Group scope outline:** `data-key-scope` dashed outline around the enclosing
  group while the ring is descended inside it.

---

## 2. Navigation model (summary)

- **Up/Down** (and Tab/Shift+Tab) move between sibling CTAs and groups in the
  active scope and wrap.
- **OK/Center/Call** descend into a group (a container with ≥1 enabled child) or
  activate a leaf. A group with a single enabled leaf activates it directly.
- **Back/Esc/left-soft** dismiss the top overlay, then leave a focused field,
  then ascend one group level; only the hardware Back key / left soft key
  navigate the route when the chain is exhausted. **Esc never navigates.**
- **Left/Right** belong to the focused value control (slider, tabs, segmented);
  otherwise they fall back to previous/next sibling.
- **Sliders:** Left/Right adjust the value (the always-on value label and
  `aria-valuenow` update) and coalesce a key-repeat burst into one device write.
- **Dropdowns (Radix Select):** OK opens; while open, the dropdown owns
  Up/Down/typeahead/Enter; Back/Esc closes it without moving the ring beneath.
- **Text fields (T9):** digits/`*`/`#` route through the T9 composer when the
  field is the ring's current item under key-navigation modality; every other
  key passes through.
- **Always-reachable shortcuts:** digits `1`–`6` jump to a tab, `0` enters Game
  Mode, `*` opens Diagnostics and `#` opens the Device Switcher. All four share the
  same exclusions — never in a text field, never inside an open overlay.

Reachability is **complete by construction**: the provider scans the active
scope (topmost dialog/menu/sheet, else the routed page + bottom TabBar) and
discovers every interactive element; `useFocusItem`/`useFocusGroup` only refine
id/order/label/grouping/activation.

---

## 3. Per-page CTA counts (verified on device)

Counts are the number of discoverable interactive elements in the page scope
(excludes the device system bars; includes the 6 persistent TabBar tabs and the
persistent status badge that appear on every page).

| Page     | Route       |                        CTAs | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------- | ----------- | --------------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home     | `/`         |                    117 (+4) | Dashboard: machine actions, quick config, LED, drives, printer, SID mixer, streams, config snapshots. **Screen colors** (`home-video-screen-colors`) was added as the first row of the Quick Config → Video card, taking the page from 113 to 114; it is unconditional and works while disconnected, and the controls of the sheet it opens are an overlay scope counted separately (§4.1). `+1` **Game Mode** tile behind `remote_input_enabled`, first in the Quick Actions grid (§3.2.1 order: safe first, destructive last). `+1` Remote Input tile behind `remote_input_enabled` (stable, enabled and user-visible by default in C64 Commander; disabled and hidden in C64U Remote per `variants/feature-flags/c64u-remote.yaml`). `+2` Content Explorer **Live View** card (`live-view-card`) beneath the quick actions — one Audio toggle (`av-audio-toggle`, `audio_mirror_enabled`) and one Video toggle (`av-video-toggle`, `video_mirror_enabled`) sharing the single app-wide A/V mirror session; both user-visible and non-developer, off by default until the phone stream receiver ships. Mounted only when the device advertises streaming (code-verified — see note below). `+4` the promoted tiles (Radio, Last, Recent, Live) moved into the Quick Actions grid in 0.10.0-rc2 when the "Listen and play" section was removed. `-1` net from folding **Reboot** and **Power Off** into a single **Power** tile: two tiles out, one in. Power Cycle and Reboot (Clr Mem) were already flag-gated and out of this count. The four rows of the Power sheet are an overlay scope counted separately (§4.1). This total is derived from those deltas rather than re-counted on device.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Settings | `/settings` |                    89 (+12) | Connection, devices, display (+2 native Android full-screen toggles), feature flags, network/cache, notifications, dev-mode, build info. Includes the 3 SID chip controls in the SID Radio group (one switch plus a two-button chip choice, §4.5), which are shown whenever on-device playback is on. The Crossfade group gained a fifth length (4 s), taking the page from 80 to 81. `+5` the Text size choice (four buttons) and the Allow-circuit-override checkbox, which gained a `data-testid` when its row became the target, taking it to 86. `+6` Content Explorer **Play and Disk** controls: Search inside disk images (`in_image_search_enabled`), Answer cartridge boot menu (`launch_safety_enabled`, default on) plus its Menu key select and Boot settle input, and Video/Audio stream port inputs (shown when `audio_mirror_enabled` or `video_mirror_enabled`) (code-verified — see note below). `+4` the Game Mode block in **Remote Input**: `settings-joystick-key-layout`, `settings-game-mode-joystick`, `settings-game-mode-on-launch`, and (for a Custom layout) the nine press-to-bind slots `settings-joystick-bind-<slot>` with their `settings-joystick-clear-<slot>` companions. The **Keep device settings after a restart** checkbox (`settings-persist-config-to-flash`) in Device safety is unconditional and takes the page from 86 to 87. The Screen colors select (`settings-vic-palette`) was removed from the Live View streaming block and its controls now live on Home (§4.1); it sat among the mirror-gated stream controls that the `(+N)` tallies above never counted, so its removal changes no number here. `+2` the `demo_mode_enabled` flag (already in the `stable` group) flipped from off to on by default, so the **Automatic Demo Mode** checkbox and a new **Preview Demo Mode** button in the Devices group are now counted for the first time, taking the page from 87 to 89. |
| Play     | `/play`     | 31 (+2, +20 SID Radio, +16) | Transport, volume, playback flags, playlist, type filters, HVSC. Include subfolders moved off this page into the Add items sheet (32 → 31). `+2` the **Game Mode** and Remote Input buttons, shown only while playing, behind `remote_input_enabled`, last in the sheet-actions row. `+20` the seekable progress bar, the **Listen on** group and the **SID Radio** controls, behind `c64u_sid_radio_enabled` / `c64u_local_engine_enabled`. `+16` **Find a tune** (open, search box, per-row play and seed-a-station), the composer and the tune position on the metadata lines, the tune-notes reveal, **Play all N tunes**, and the six sleep-timer choices. The playback settings' own tune list was removed when the credits-line one arrived, so the net count is unchanged by it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Config   | `/config`   |                          30 | Search + 22 config-category accordions (each expands to config-item rows).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Disks    | `/disks`    |                     28 (+1) | Drive A/B/Soft-IEC controls, disk library. `+1` Content Explorer **New disk** button (`new_disk_enabled`); the per-disk **Open (Disk Explorer)…** overflow action (`disk_explorer_enabled`) and the New-disk / Disk-contents dialogs it opens are documented in §4.3/§5 (code-verified — see note below).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Docs     | `/docs`     |                          18 | 8 doc-section toggles + 3 external links.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

> **Content Explorer CTAs — code-verified, not yet hardware-verified.** The six
> flag-gated Content Explorer capabilities (Disk Explorer, In-image search, Launch
> Safety, Audio Mirror, Video Mirror, New disk) contribute the conditional CTAs
> tallied in the `(+N)` columns above and detailed in §4.1/§4.3/§4.5 and §5. They
> were verified against source on branch `feat/content-explorer`; unlike the base
> counts in this section they have **not** yet been enumerated on real hardware.
> Keypad / D-pad reachability for them is derived from each control's type (dialog
> buttons, selects, checkboxes, and number inputs behave like their
> hardware-verified neighbours in §4). The "Last verified on real hardware" header
> above refers to the prior verification pass and is unchanged.

**Persistent on every page (counted within each page above):**

| CTA                   | Type         | testid                 | Reachable | Interactive        | Notes                                                                      |
| --------------------- | ------------ | ---------------------- | --------- | ------------------ | -------------------------------------------------------------------------- |
| Quick menu            | button       | `app-bar-quick-menu`   | ✅        | ✅                 | Opens the **Quick Menu** (§5) — the same dialog the keypad Menu key opens. |
| Status / health badge | button       | `unified-health-badge` | ✅        | ✅ (tap = details) | Tap = details; long-press / keypad `#` / Menu → **Device Switcher**.       |
| Tab: Home             | tab (button) | `tab-home`             | ✅        | ✅                 | Persistent bottom TabBar.                                                  |
| Tab: Play             | tab (button) | `tab-play`             | ✅        | ✅                 |                                                                            |
| Tab: Disks            | tab (button) | `tab-disks`            | ✅        | ✅                 |                                                                            |
| Tab: Config           | tab (button) | `tab-config`           | ✅        | ✅                 |                                                                            |
| Tab: Settings         | tab (button) | `tab-settings`         | ✅        | ✅                 |                                                                            |
| Tab: Docs             | tab (button) | `tab-docs`             | ✅        | ✅                 | OK on a focused tab switches route (verified).                             |

> **Conditional app-bar CTA — A/V mirror live pip** (`av-mirror-live-pip`): a tiny
> indicator that appears in the header next to the status badge on every page **only
> while an A/V mirror stream is live** (Content Explorer). Tapping it stops all
> mirroring. Invisible — and not counted above — when nothing is streaming.

---

## 4. Page hierarchies

Legend — Type: `button`, `link`, `tab`, `slider`, `select` (Radix `combobox`),
`checkbox` (incl. switches/toggles rendered with `role=checkbox`), `text`,
`number`, `password`, `search`. R = reachable via keypad, I = interactive via
keypad. `[disabled]` marks controls disabled by current state (legitimate, e.g.
not-connected / empty / single-device).

### 4.1 Home (`/`)

- **Search field** — button — `home-search-field` — R✅ I✅ — looks like a field, is a
  button: tapping it opens the full-screen search overlay (§5.0) rather than searching in
  place, so results get the whole screen instead of the strip above the keyboard
- **Tour: device steps offer** — `home-tour-device-steps-offer` — R✅ I✅
  `[visible once, after a first connection, when the tour's device steps ran without one]` —
  Show me (`home-tour-device-steps-start`) / dismiss (`home-tour-device-steps-dismiss`)
- **Listen and play** (`home-listen-and-play`) — four tiles, each disabled with its reason
  rather than hidden:
  - Radio — button — `home-tile-action.sid-radio` — R✅ I✅ `[disabled: SID Radio is off in Settings]`
  - Resume — button — `home-tile-action.resume-session` — R✅ I✅ `[disabled: nothing has been played yet]`
  - Recent — button — `home-tile-action.recently-played` — R✅ I✅ `[disabled: nothing has been opened yet]`
  - Live View — button — `home-tile-home.section.live-view` — R✅ I✅ `[disabled: no device, or Live View off]`
- **Connect a C64** (`home-connect-c64`) — button — `home-connect-c64-setup` — R✅ I✅
  `[visible only in the offline arrangement, in place of Quick Actions]`
- **Header**
  - Quick menu — button — `app-bar-quick-menu` — R✅ I✅
  - Status badge — button — `unified-health-badge` — R✅ I✅
  - System info — button (`App … Device … Firmware …`) — `home-system-info` — R✅ I✅ (expands)
- **Quick Actions** (`data-section-label="Quick Actions"` group — listed in RING ORDER, which
  follows the DOM: frequent and safe first, destructive last in increasing severity)
  - Live — button — `home-tile-home.section.live-view` — R✅ I✅ _(flag `live_view_enabled`; needs a connected, streaming-capable device)_ — opens the **Live View** card
  - Game Mode — button — `home-machine-inline-openGameMode` — R✅ I✅ _(flag `remote_input_enabled`; disabled while disconnected)_ — starts the remembered picture/sound and opens the **Remote Input sheet** in Game Mode (§5)
  - Input — button — `home-machine-inline-openRemoteInput` — R✅ I✅ _(flag `remote_input_enabled`; stable, enabled and visible by default in C64 Commander, disabled+hidden in C64U Remote)_ — opens the **Remote Input sheet** (§5)
  - Radio — button — `home-tile-action.sid-radio` — R✅ I✅ _(app setting `sid_radio_enabled`)_ — needs no C64
  - Last — button — `home-tile-action.resume-session` — R✅ I✅ _(needs a restorable playback session)_ — needs no C64
  - Recent — button — `home-tile-action.recently-played` — R✅ I✅ _(disabled while the list is empty)_ — needs no C64
  - Menu — button — R✅ I✅
  - Pause / Resume — button (toggles) — R✅ I✅
  - Save REU memory — button — `home-machine-inline-saveReuMemory` — R✅ I✅ _(flag `home_telnet_reu_snapshot_enabled`)_
  - Backup — button — `home-save-ram` — R✅ I✅ _(flag `ram_snapshots_enabled`)_
  - **Backup dialog** (`save-ram-dialog`, opened by `home-save-ram`)
    - CPU + RAM snapshot — button — `save-ram-type-cpu` — R✅ I✅ _(conditional on CPU-snapshot capability; `save-ram-type-list` scope)_
    - Program / BASIC / Screen / REU region presets — buttons — `save-ram-type-{program,basic,screen,reu}` — R✅ I✅
    - Custom ranges toggle — button — `save-ram-type-custom` — R✅ I✅ _(reveals `save-ram-custom-form` scope)_
    - Custom range start/end — text/number — `save-ram-custom-{start,end}-{i}` — R✅ I✅
    - Delete range — button — `save-ram-custom-delete-range-{i}` — R✅ I✅
    - Add range — button — `save-ram-custom-add-range` — R✅ I✅
    - Save custom — button — `save-ram-custom-confirm` — R✅ I✅
    - RAM folder — button (`...`) — `ram-dump-folder-trigger` — R✅ I✅ — where the snapshot is written; at the foot of this dialog, not a Quick Action of its own
  - Restore — button — `home-load-ram` — R✅ I✅ _(flag)_ — opens the **Snapshot Manager** sheet (`snapshot-manager-dialog`)
    - Filter snapshots — text — `snapshot-filter-input` — R✅ I✅
    - Type filters — buttons — `snapshot-filter-type-<type>` — R✅ I✅
    - Snapshot row — button — `snapshot-row` — R✅ I✅ (restores; carries its own delete and rename)
    - RAM folder — button (`...`) — `ram-dump-folder-trigger` — R✅ I✅ — the same control as in Backup, at the end of the list
  - Reset — button (danger) — R✅ I✅ (confirm dialog) — keeps a tile of its own; it is among the most-reached controls in the app
  - Power — button (danger) — `home-power-actions` — R✅ I✅ — opens the **Power sheet** (`home-power-sheet`); disabled only when every row inside it is
  - **Power sheet** (`home-power-sheet`, opened by `home-power-actions`) — rows in increasing severity, each keeping the confirmation it had as a tile
    - Reboot — button — `home-power-action-reboot` — R✅ I✅ (confirm dialog)
    - Reboot (Clr Mem) — button — `home-power-action-rebootClearMemory` — R✅ I✅ (confirm dialog) _(flag `home_telnet_clear_ram_reboot_enabled`)_
    - Power Cycle — button — `home-power-action-power-cycle` — R✅ I✅ (confirm dialog) _(flag `home_telnet_power_cycle_enabled`; conditional on device capability)_
    - Power Off — button — `home-power-action-power-off` — R✅ I✅ (its own `Confirm power off` dialog)
- **Quick Config → CPU & RAM** (`home-cpu-summary`)
  - Turbo Control — select — `home-cpu-turbo-control` — R✅ I✅ (verified: opens Off/Manual/C64U Turbo Registers/TurboEnable Bit)
  - CPU Speed — slider — `home-cpu-speed-slider` — R✅ I✅ **(verified end-to-end: keypad Right 1→4 reflected in c64u firmware; Left restored)**
  - Badline Timing — checkbox — `home-cpu-badline-timing` — R✅ I✅
  - SuperCPU Detect — checkbox — `home-cpu-supercpu-detect` — R✅ I✅
  - RAM Expansion — select — `quickconfig-ram-expansion` — R✅ I✅
  - RAM Size (REU) — select — `quickconfig-ram-size` — R✅ I✅ _(conditional on RAM Expansion)_
- **Quick Config → Ports** (`home-ports-summary`)
  - Joystick Input — select — `home-joystick-swapper` — R✅ I✅
  - Serial Bus Mode — select — `home-serial-bus-mode` — R✅ I✅
  - Cartridge Preference — select — `home-cartridge-preference` — R✅ I✅
  - User Port Power — checkbox — `home-user-port-power` — R✅ I✅
- **Quick Config → Video** (`home-video-summary`)
  - Screen colors — button — `home-video-screen-colors` — R✅ I✅ — first in the card, because it is the one row here people actually change; opens the **Screen colors sheet** (below) _(needs no device connection: the app's own palette is a local rendering choice, so the row stays usable while the rest of the card is disabled. The 16-swatch strip beneath it, `home-video-screen-colors-preview`, is display-only)_
  - **Screen colors sheet** (`screen-colors-*`, opened by `home-video-screen-colors`)
    - Show on: Local / Remote / Both — button ×3 — `screen-colors-local` / `screen-colors-remote` / `screen-colors-both` — R✅ I✅ _(group `screen-colors-target`; the same shape as the Play page's **Listen on**. Local paints this device's Live View only, Remote changes what the C64 itself draws, Both does each; `screen-colors-target-hint` states which, display-only. Laid out as an equal-width three-column grid rather than a wrapping row, so it holds one line on the compact profile — the column there is 262 CSS px and three wrapping buttons need 305; the origin icons are omitted because a third of that row cannot fit icon plus label)_
    - Follow the C64 — button — `screen-colors-follow-device` — R✅ I✅ _(Live View paints whatever palette the machine is set to, so the phone and the television match)_
    - Per-palette choice — button ×N — `screen-colors-palette-<id>` — R✅ I✅ `[the row being applied is disabled while its upload is in flight]` — the nine bundled VICE palettes (`cool`, `default`, `inverted`, `monochrome`, `muted`, `neonblast`, `night`, `vibrant`, `warm`), plus one row per `.vpl` already installed on the connected machine (`screen-colors-device-palettes`), read from the device's own preset list
    - Close — button — `screen-colors-close` — R✅ I✅
    - _The two halves are different things. The app's palette is **render-only**: the video stream carries 4-bit colour indices, so it cannot change what the device sent. Applying to the C64 uploads a `.vpl` into `/flash/data` and writes the `U64 Specific Settings` / `Palette Definition` config item, which changes the machine's own output on HDMI and analog, so the television changes too. Whether that survives a power cycle depends on **Keep device settings after a restart** in Settings (§4.5); `screen-colors-install-note` says so on the Remote and Both targets._
  - Video Mode — select — `home-video-mode` — R✅ I✅
  - HDMI Resolution — select — `home-video-hdmi-resolution` — R✅ I✅
  - HDMI Scan Lines — checkbox — `home-video-scanlines` — R✅ I✅
  - Analog — select — `home-video-analog` — R✅ I✅
  - Digital — select — `home-video-digital` — R✅ I✅
- **Quick Config → User Interface**
  - Overlay — select — `home-user-interface-overlay` — R✅ I✅
  - WASD/Cursors — select — `home-user-interface-wasd-cursors` — R✅ I✅
  - Color Scheme — select — `home-user-interface-color-scheme` — R✅ I✅
- **LED — Case Light / Keyboard Light** _(flag `lighting_studio_enabled`)_
  - Mode / Music Detect / Pattern / Color / Tint / SID select — select/checkbox — `home-led-*`, `home-keyboard-lighting-*` — R✅ I✅ when the live config item exists; unsupported live-spec items render disabled as "Not available".
  - Color slider, Intensity slider — slider ×2 each — R✅ I✅ when the live config item exists; unsupported live-spec items render disabled as "Not available".
- **Drives** (`data-section-label="Drives"`) — per drive A / B / Soft-IEC:
  - Reset — button — `home-drives-reset` — R✅ I✅
  - Power toggle (ON/OFF) — button — `home-drive-toggle-*` — R✅ I✅
  - Mount / path — button — `home-drive-mounted-*` — R✅ I✅
  - Bus ID — select — `home-drive-bus-*` — R✅ I✅
  - Drive Type — select — `home-drive-type-*` — R✅ I✅
  - Status (OK) — button — `home-drive-status-*` — R✅ I✅ (status dialog)
- **Printer** (`data-section-label="Printers"`)
  - Reset — button — `home-printer-reset` — R✅ I✅
  - Power toggle — button — `home-printer-toggle` — R✅ I✅
  - Bus — select — `home-printer-bus` — R✅ I✅
- **SID / Audio mixer** (`data-section-label="SID"`) — per socket/UltiSID:
  - Reset — button — `home-sid-reset` — R✅ I✅
  - Master volume — slider — `home-sid-volume-master` — R✅ I✅ when the live `Vol Master` item exists.
  - Enable toggle — button — `home-sid-toggle-*` — R✅ I✅
  - Type / Address / Shaping ×N — select — `home-sid-type-*`, `home-sid-address-*`, `home-sid-shaping-*` — R✅ I✅
  - Volume, Pan — slider ×2 — R✅ I✅
- **Streams** (`home-stream-status`) — per VIC / Audio / Debug:
  - Edit target — button — `home-stream-edit-toggle-*` — R✅ I✅
  - Start — button — `home-stream-start-*` — R✅ I✅
  - Stop — button — `home-stream-stop-*` — R✅ I✅
  - (edit mode) endpoint — text — `home-stream-endpoint-*` — R✅ I✅
  - _Live View precedence:_ while Live View is receiving a feed (VIC↔video, Audio↔audio) that row goes **read-only** — edit/start/stop are hidden/disabled, replaced by a `home-stream-liveview-badge-*` chip + `home-stream-liveview-note-*` explanation (display-only); controls return when Live View stops.
- **Live View** (`live-view-card`) _(Content Explorer A/V Mirror; mounted only when the device advertises streaming and `audio_mirror_enabled` or `video_mirror_enabled` is on)_
  - Audio — Listen / Listening toggle — button — `av-audio-toggle` — R✅ I✅ _(flag `audio_mirror_enabled`; controls the shared app-wide session; the live dot is display-only)_
  - Video — Watch / Watching toggle — button — `av-video-toggle` — R✅ I✅ _(flag `video_mirror_enabled`; the check-preview canvas and fps badge are display-only)_
  - Expand / collapse preview — button — `live-view-expand` — R✅ I✅ _(shown only while a video stream is active; toggles the check preview between check and immersive size)_
  - Stats — expand/collapse toggle — `stream-stats-toggle` — R✅ I✅ _(reveals the telemetry grid + the controls below; diagnostic)_
    - Frame-rate mode — segmented buttons ×4 — `stream-stats-mode-auto` / `-100` / `-50` / `-25` — R✅ I✅ _(user max presented rate; the governor may still demote below it)_
    - History window — segmented buttons — `stream-stats-window-{label}` (e.g. `1m`/`5m`/`15m`/Session) — R✅ I✅ _(selects the downsampled history span; display grid otherwise)_
    - Export diagnostics — button — `stream-stats-export` — R✅ I✅
  - **A/V measurement** (`av-sync-panel`) _(power-user diagnostic; two independently collapsible sections, both collapsed by default)_
    - A/V Sync section — expand/collapse — `av-sync-toggle` — R✅ I✅ ; inside: Run test — button — `av-sync-run` — R✅ I✅ ; Reset all A/V measurements — icon button — `av-sync-reset` — R✅ I✅ ; Stop — button — `av-sync-stop` — R✅ I✅ `[visible when a test program is running on the device]`
    - Tap latency section — expand/collapse — `av-sync-lat-toggle` — R✅ I✅ ; inside: Load — button — `av-sync-key-load` — R✅ I✅ ; Send SPACE — button — `av-sync-press` — R✅ I✅ ; Stop — button — `av-sync-stop` (shared with the A/V Sync section) `[visible when a test program is running]`
    - Tone & colour ladder section — expand/collapse — `av-tone-ladder-toggle` — R✅ I✅ ; inside: Run test — button — `av-tone-ladder-run` — R✅ I✅ `[disabled while listening]` ; Reset — button — `av-tone-ladder-reset` — R✅ I✅ `[disabled: no result yet, or a run in progress]` — plays a known C3→C4→C3 scale on the C64, stepping the screen background through all 16 VIC colours in unison with the notes, and grades the sound and picture that reach this device (pitch Δ in cents, note-length Δ, silence floor in dBFS against the EBU R128 gate, A/V offset graded per ITU-R BT.1359-1, per-note table with colour swatches)
- **Config actions** (`data-section-label="Config"`)
  - Save/Load (flash) — button — R✅ I✅
  - Reset to default — button (danger) — R✅ I✅
  - Save to app — button — `home-config-save-app` — R✅ I✅
  - Load from app — button — `home-config-load-app` — R✅ I✅ `[disabled: no app configs]`
  - Revert Changes — button — `home-config-revert-changes` — R✅ I✅
  - Manage app configs — button — `home-config-manage-app` — R✅ I✅ `[disabled: no app configs]`
  - _(flag/telnet)_ Save/Load file, Clear flash — button — R✅ I✅

### 4.2 Play (`/play`)

- Transport: Previous / Play / Pause / Next — button — `playlist-prev|play|pause|next` — R✅ I✅ `[disabled: no playlist loaded, playlist loading, or no previous/next item in the current repeat/shuffle traversal]`
- Now playing: where the queue comes from — `now-playing-source` — the first row of the card, present
  in both states and the same height in both (`data-station-active`); a running station renders
  `sid-radio-chip` inside it, otherwise `now-playing-source-idle` names the playlist
- Now playing: title — `playback-current-title` (title only; the ranking actions sit opposite it and
  do not move when a long title truncates)
- Now playing, two lines: author · released — `playback-current-credits`; SID model · clock · tune position · length — `playback-current-facts`
- Mute — button — `volume-mute` — R✅ I✅ `[disabled]` (icon-only; the accessible name carries the
  state, and on the on-device route it attenuates the samples rather than the device's volume)
- Volume — slider — R✅ I✅ `[disabled]` — shares one row with Mute and the dB readout (`volume-row`);
  the former `volume-caption` label is gone, the readout is fixed-width so the row cannot reflow
- Shuffle / Repeat — checkbox — `playback-shuffle|playback-repeat` — R✅ I✅ — **not rendered** while
  a SID Radio station drives the queue. A station owns the play order, so these are
  mode-inapplicable rather than temporarily unavailable. They return with their stored values when
  the station stops — nothing is mutated while they are hidden.
- Reshuffle — button — `playlist-reshuffle` — R✅ I✅ `[disabled]` — likewise **not rendered** during
  a station. The row that holds all three is dropped with them, so a station leaves no empty or
  greyed row behind.
- Duration — slider — R✅ I✅
- Duration override — text — `duration-input` (`mm:ss`) — R✅ I✅ ; Change — button — R✅ I✅
- Add items to playlist — button — `add-items-to-playlist` — R✅ I✅ (opens picker)
- Include subfolders — checkbox — `playback-recurse` — R✅ I✅ — in the **Add items** sheet
  (`add-items-folder-options`), not on the Play page: it decides what selecting a folder means, so it
  is shown while folders are being chosen and at no other time. Rendered only once a source is open
  and only where folder selection is allowed.
- Filter files — text — `list-filter-input` — R✅ I✅
- Type filters: SID / MOD / PRG / CRT / Disk — checkbox — `playlist-type-*` — R✅ I✅
- Select all — button — `playlist-list-toggle-select-all` — R✅ I✅
- HVSC: Download / Ingest / Reindex / Reset — button — R✅ I✅ _(flag `hvsc_enabled`)_
- Game Mode — button — `play-open-game-mode` — R✅ I✅ _(flag `remote_input_enabled`; visible only while `isPlaying`)_ — starts the remembered picture/sound and opens the **Remote Input sheet** in Game Mode (§5). **Leads** Remote Input for a `prg`/`crt`/`disk` item (overwhelmingly likely to be a game) and **follows** it for a `sid`/`mod` item.
- Remote Input — button — `play-open-controller` — R✅ I✅ _(flag `remote_input_enabled`; visible only while `isPlaying`)_ — opens the **Remote Input sheet** (§5). Both controller actions sit in the sheet-actions row **after** SID Radio and Liked Tunes: all of them open a sheet, and the two station actions are about what plays next while these leave the music behind.
- Progress bar (seek) — button — `playback-progress-seek` — R✅ I✅ — tap or drag to jump within the tune; **also operable without a pointer**: `ArrowLeft`/`ArrowRight` step ±2%. Rendered only for audio this device renders (see _Listen on_ below); on the C64 route the bar is a plain indicator (`playback-progress`) and not focusable, because the machine plays the SID on its own chip and cannot be scrubbed.
- Previous / Next **held** — scrub — same `playlist-prev|next` buttons — R✅ I✅ — a hold scrubs the current tune instead of changing track (local playback only); a tap still skips.

**Listen on** — group `playback-engine-toggle` _(flag `c64u_local_engine_enabled`; SID items only)_ — an equal-width grid, three columns normally and two while **Both** is hidden, so the row holds one line on the compact profile; no origin icons, because a third of that row cannot fit icon plus label.

Listed below in the order they are rendered and walked by the focus ring.

- Local — button — `playback-engine-local` — R✅ I✅
- Remote — button — `playback-engine-c64` — R✅ I✅ — labelled `Remote`, **not** the connected device's name; the header already says which machine is attached, and the wording matches Remote Input
- Both — button — `playback-listen-both` — R✅ I✅ — **hidden**, not disabled, when the C64's audio cannot reach this device (flags `live_view_enabled` + `audio_mirror_enabled`, and not latched-failed)

**SID Radio** _(flag `c64u_sid_radio_enabled`)_

- Start a station from the current tune — button — `sid-radio-start` — R✅ I✅ _(shown for a playing SID)_
- Open the station launcher — button — `sid-radio-launcher` — R✅ I✅ ; sheet `sid-radio-launcher-sheet`
  - Style stations — button — `sid-radio-style-<bit>` (0–8) — R✅ I✅ `[disabled: the export left this style with no tracks — see size `sid-radio-style-<bit>-size`]`
  - Based on my likes — checkbox — `sid-radio-likes-toggle` — R✅ I✅
  - My taste — button — `sid-radio-taste` — R✅ I✅ `[disabled: not enough rankings yet — see hint `sid-radio-taste-hint`]`
  - Surprise me — button — `sid-radio-surprise` — R✅ I✅
- Stop the station — button — `sid-radio-stop` — R✅ I✅ — labelled "Stop", on the source row at the
  top of the Now Playing card, beside the station it ends
- Station chip — button — `sid-radio-chip-toggle` — R✅ I✅ _(expands `sid-radio-chip`; `sid-radio-why` explains the pick)_
- Liked tunes — button — `sid-radio-liked-tunes-open` — R✅ I✅
- Rank the current tune: ✕ / ♥ — button — `now-playing-notforme` / `now-playing-like` — R✅ I✅
  _(group `now-playing-ranking`; flag `c64u_sid_ranking_enabled`)_ — right-aligned on the title row
  in that order, so the outermost control is the harmless one; both are 44 px outline buttons, the
  same size and chrome as the transport
- Find a tune — button — `hvsc-search-open` — R✅ I✅ ; sheet `hvsc-search-sheet`
  - Search box — text — `hvsc-search-input` — R✅ I✅
  - Play a result — button — `hvsc-search-play` (per row `hvsc-search-row`) — R✅ I✅ — while a
    station is running this is an interruption: the station keeps its place and carries on
  - Start a station from a result — button — `hvsc-search-start-station` — R✅ I✅ _(per row; hidden
    where the similarity corpus does not know the tune, so it cannot be offered and then fail)_
  - Recently played — rows `recently-played-row` — R✅ I✅ _(shown on an empty query)_
- More like this — button — `sid-radio-start` — see above; available while a station is already
  running, which is when it is most wanted

**The tune's own line** _(what the file and the archive say about what is playing)_

- Composer — button — `playback-current-composer` — R✅ I✅ — the author segment of the credits
  line; opens **Find a tune** pre-filled with that name
- Which tune — button — `playback-current-tunes` — R✅ I✅ — the tune-position segment, printed `1/19`; opens the
  **Tunes in this file** sheet (`tune-list-sheet`), one row per tune (`tune-list-row`) carrying its
  number, its STIL name where there is one and its length where the archive knows it. Shown only
  for a file holding more than one tune. This is the **only** control for choosing a tune: a plain
  list in the playback settings offered the same choice from below the fold without the names or
  the lengths, and two buttons both reading the same tune position made neither addressable by name. The
  pieces inside a SID file are called **tunes** throughout, on screen and in the manual; "subsong"
  is the file format's word and is not used in the interface.
- Tune notes — button — `tune-notes` — R✅ I✅ — the whole note is the target, not only the
  `tune-notes-toggle` label; present only when the note is longer than the two lines shown
- Play all N tunes — button — `play-all-tunes` — R✅ I✅ _(shown for a file with more than one tune;
  withdrawn once they are all queued)_

**Sleep timer** _(with the playback settings: a decision about the session, not about a file)_

- Off / This tune / 15m / 30m / 45m / 60m — buttons — `sleep-timer-off`, `sleep-timer-after-tune`,
  `sleep-timer-m15`, `sleep-timer-m30`, `sleep-timer-m45`, `sleep-timer-m60` — R✅ I✅ — state is
  always stated in `sleep-timer-state`; **This tune** `[disabled: nothing is playing]`

### 4.3 Disks (`/disks`)

Per drive (A / B / Soft-IEC):

- Status toggle (ON/OFF) — button — `drive-status-toggle-*` — R✅ I✅
- Mount disk / select directory — button — `drive-mount-toggle-*` — R✅ I✅
- Bus ID — select — `drive-bus-select-*` — R✅ I✅
- Drive Type — select — `drive-type-select-*` — R✅ I✅ _(A/B)_
- Soft-IEC default path — button — `drive-default-path-select-soft-iec` — R✅ I✅
- Reset — button — `drive-reset-*` — R✅ I✅
- Power (Turn On/Off) — button — `drive-power-toggle-*` — R✅ I✅

Disk library: New disk — button — `new-disk-open` — R✅ I✅ _(flag `new_disk_enabled`; opens the **New disk dialog**, §5)_ ; Add disks — button — R✅ I✅ ; Filter disks — text — `list-filter-input` — R✅ I✅ ; Select all — button — `disk-list-toggle-select-all` — R✅ I✅ `[disabled: empty]`.

Per-disk overflow menu (Set group / Rename / Remove) additionally gains, behind `disk_explorer_enabled`: Open (Disk Explorer)… — action — R✅ I✅ `[only for .d64/.d71/.d81/.dnp rows]` — opens the **Disk contents dialog** (§5).

Mount disk sheet: Available disks list — filter text — `list-filter-input` — R✅ I✅ ; Mount disk row action — button — R✅ I✅ ; Add disks — button — `mount-sheet-add-disks` — R✅ I✅ `[visible when library empty]`; Add disks source picker Local / C64U / CommoServe — buttons — `import-option-*` — R✅ I✅.

### 4.4 Config (`/config`)

- Search categories — search/text — R✅ I✅
- 22 category accordions — button — `config-category-<slug>` — R✅ I✅
  (Audio Mixer, Speaker Mixer, SID Sockets, UltiSID, SID Addressing, U64
  Specific, C64 & Cartridge, ARMSID 1/2, SoftIEC, Printer, Network, Ethernet,
  WiFi, Tape, LED Strip, Keyboard Lighting, Drive A/B, Data Streams, Modem, User
  Interface). Each expands to `ConfigItemRow`s whose control is a select / slider
  / checkbox / text per item; Audio Mixer adds Reset + per-SID Solo; Clock adds
  Sync Clock; every category adds Refresh.

### 4.5 Settings (`/settings`)

The page is a set of **collapsible sections** (`settings-section-<id>` with
`settings-section-toggle-<id>`, `data-open`, and a `data-section-label` that makes each one a
focus group). Closed, a section is one line naming what it decides; open, it holds exactly the
controls listed below — nothing was removed, and nothing moved between sections. **Connection**
opens on a first visit; every other section starts closed, and which are open is remembered in
`c64u_settings_open_sections`. For the keypad this adds one ring level: Up/Down walks the
section headers, **OK descends** into a section, **Back** leaves it — the same rule the rest of
the app follows.

Sections, in page order: `appearance`, `connection`, `diagnostics`, `play-and-disk`,
`feature-group-stable`, `feature-group-experimental`, `sid-radio`, `hvsc`, `online-archive`,
`device-safety`, `notifications`, `about`. Every block on the page is one of these — there is no
always-expanded card left. The two feature-flag chapters carry an "N/M on" badge, so how many
flags are set is readable without opening them.

Making SID Radio a chapter also unblocked the keypad: its minimum-song-length number input was a
top-level ring stop, and Up/Down on a number input changes its value, so the ring could not get
past it to anything below.

- **Display**: Theme (Auto/Light/Dark) — segmented buttons — R✅ I✅ ; Text size
  (Default/Large/Larger/Largest) — segmented — `settings-text-size` group with
  `settings-text-size-default|large|larger|largest` — R✅ I✅ ; Display
  profile (Small/Standard/Large/Auto) — segmented — R✅ I✅ ; Orientation
  (Portrait/Landscape/Auto) — segmented — R✅ I✅
- **Full screen** _(native Android only)_ — checkbox ×2 — Hide status bar
  (`settings-hide-status-bar`) / Hide navigation bar
  (`settings-hide-navigation-bar`) — R✅ I✅ ; default per build variant
  (`variant.runtime.default_hide_*`; `c64u-remote` ships both on)
- **Device safety**: Allow circuit override — checkbox —
  `settings-allow-circuit-override` — R✅ I✅ ; the whole row is the target, so the
  label activates it as well as the box ; Keep device settings after a restart —
  checkbox — `settings-persist-config-to-flash` — R✅ I✅ _(default off: a device
  setting changed from the app reaches the C64 straight away but is not written to
  its flash, so a power cycle brings back what the C64 had saved. When on, the app
  saves to flash once config writes have settled, so one slider drag costs one
  flash write. Enabling it reveals the warning block
  `settings-persist-config-to-flash-warning`, which is display-only and explains
  the hold-RESTORE-at-power-up recovery)_
- **Devices**: Add device — button — `settings-add-device` — R✅ I✅ ; Delete
  device — button — `settings-delete-device` — R✅ I✅ `[disabled: single device]`
  ; device row — button — `settings-device-row-*` — R✅ I✅ ; host — text —
  `settings-device-host` — R✅ I✅ (T9 hostname) ; HTTP/FTP/Telnet ports — text —
  `settings-device-http|ftp|telnet` — R✅ I✅ ; password — password — R✅ I✅ ;
  device-editor reachability hint — status panel —
  `settings-device-reachability-suggestion` — R✅ I✅
  `[visible after save with an unreachable hostname that resolves on the LAN]` ;
  device-editor use suggested address — button —
  `settings-device-use-suggested-address` — R✅ I✅
  `[visible with the reachability hint; registered in the host field focus group]` ;
  Save & Connect / Refresh connection / Discover devices
  (`settings-discover-devices`) — button — R✅ I✅ ; discovered device Use —
  button — `settings-use-discovered-device-*` — R✅ I✅ `[visible after scan]` ;
  discovered-device password — password/button — `settings-device-password-*` —
  R✅ I✅ `[visible when a discovered device requires a network password]` ;
  Automatic Demo Mode — checkbox — `demo-mode-enabled` — R✅ I✅ (default on:
  offers the built-in simulated device when real-device discovery fails) ;
  Preview Demo Mode — button — `settings-preview-demo-mode` — R✅ I✅ `[visible
  while not already in Demo Mode; switches to the simulated device immediately,
  even with a real C64U connected]`
- **Diagnostics** — button — `diagnostics-open-dialog` — R✅ I✅
- **Feature flags** — checkbox — `feature-flag-*` (incl.
  `feature-flag-keypad_input_enabled`) — R✅ I✅ (`c64u-remote`: RAM snapshots
  and keypad ship on; background execution, HVSC, and Home Telnet
  config/drive/printer/power actions are visible toggles; developer-only flags
  remain hidden)
- **Network/cache**: HVSC base URL / update interval, archive host/client/agent
  overrides — text/number — `hvsc-base-url`, `hvsc-update-check-interval`,
  `archive-*-override` — R✅ I✅ ; Open archive browser — button —
  `open-online-archive` — R✅ I✅ ; many device-safety number inputs — number — R✅ I✅
- **Disk autostart** — select — R✅ I✅
- **Play and Disk** _(Content Explorer)_: Search inside disk images — checkbox —
  `settings-search-inside-disks` — R✅ I✅ _(flag `in_image_search_enabled`)_ ;
  Answer cartridge boot menu after reset — checkbox — `settings-boot-menu-answer`
  — R✅ I✅ _(flag `launch_safety_enabled`, default on, so visible by default)_ —
  when checked reveals Menu key — select — `settings-boot-menu-key` — R✅ I✅ and
  Boot settle (ms) — number — `settings-boot-settle` — R✅ I✅ ; Video stream port
  / Audio stream port — number ×2 — `settings-stream-video-port` /
  `settings-stream-audio-port` — R✅ I✅ ; Audio network buffer (ms) — number —
  `settings-stream-network-buffer` — R✅ I✅ ; Fast video (native assembly) —
  switch — `settings-stream-native-assembly` — R✅ I✅ _(default on; native VIC
  frame assembly, A/B / escape-hatch toggle — native builds only)_ ; Input
  priority (instant joystick) — switch — `settings-stream-input-priority` —
  R✅ I✅ _(default on; sheds video briefly while the user is actively driving so
  joystick/keyboard/mouse input reaches the C64 instantly)_ ; Show video standard
  and frame rate — switch — `settings-stream-video-badges` — R✅ I✅ _(default on;
  draws the "PAL 50 fps" readout over the picture in both the Home Live View
  preview and the immersive Remote Input view; off leaves the picture clear)_ ;
  Low-latency audio
  (native) — switch — `settings-stream-native-audio` — R✅ I✅ _(default on; plays
  Live View audio through a native low-latency track — Android only)_ ; Audio
  streaming route — select — `settings-stream-audio-route` — R✅ I✅ _(default
  Dynamic; firmware wifi=true — Wi‑Fi for audio-only, Ethernet with video, or
  Always Wi‑Fi / Always Ethernet)_
  `[developer-mode only — firmware wifi=true not yet in released firmware; the session forces Ethernet unless dev mode is on]`
- **Remote Input** _(the Game Mode block, then autofire)_: Joystick keys — select —
  `settings-joystick-key-layout` — R✅ I✅ _(Diamond (8-centred) / Classic T9 /
  Custom; per-variant default from `variant.runtime.defaultJoystickKeyLayout`)_ ;
  per-slot press-to-bind — button ×9 — `settings-joystick-bind-<slot>` (slots
  `up|upRight|right|downRight|down|downLeft|left|upLeft|fire`) with
  `settings-joystick-clear-<slot>` — R✅ I✅ `[shown only for the Custom layout;
capture is by PRESSING the key, which is the only route that works with no
touchscreen. A reserved action (✱/Menu, #, Back) is refused with
settings-joystick-bind-rejection naming what the key already does]` ;
  On-screen joystick in Game mode — select — `settings-game-mode-joystick` — R✅ I✅
  _(Auto / Visible / Hidden; per-variant default from
  `variant.runtime.defaultGameModeJoystick` — `hidden` on c64u-remote, which has no
  touchscreen. **Auto** waits for a physical key that steers the GAME, not the app-wide
  input modality. The stored values were renamed from `always`/`never`; both spellings
  are read, only the new ones are written)_ ;
  Enter Game Mode when a game starts — checkbox — `settings-game-mode-on-launch` —
  R✅ I✅ _(per-variant default from `variant.runtime.defaultGameModeOnLaunch`)_ ;
  Show Autofire button — checkbox — `settings-show-autofire` — R✅ I✅ ; Autofire
  rate — slider — `settings-autofire-rate-slider` — R✅ I✅ `[disabled while the
Autofire button is hidden]`
- **SID Radio** (`settings-sid-radio`): Shortest tune to play — number input —
  `settings-sid-radio-min-seconds-input` (`settings-sid-radio-min-seconds`) — R✅ I✅
  _(always shown: SID Radio reached GA, so what a station will offer is a listener's
  setting, not a developer one)_ ; Clear my rankings — button —
  `settings-clear-rankings` — R✅ I✅ ; Enable SID Radio — checkbox —
  `settings-sid-radio-enabled` — R✅ I✅ `[developer-mode only]` ; Show ♥/✕ ranking —
  checkbox — `settings-sid-ranking-enabled` — R✅ I✅ `[developer-mode only; shown only
when SID Radio is on]` ;
  On-device playback engine — checkbox — `settings-local-engine-enabled` — R✅ I✅
  `[developer-mode only]` ;
  SID emulation — button group — `settings-sid-engine-residfp|sidlite`
  (`settings-sid-engine`) — R✅ I✅ _(on-device engine only)_ ; SID chip
  (`settings-sid-chip`): Match my Commodore 64 — checkbox —
  `settings-sid-chip-from-device` — R✅ I✅ _(default on; reads the chip from the
  connected Ultimate and remembers it)_ ; fallback chip — button group —
  `settings-sid-chip-6581|8580` — R✅ I✅ _(used when the switch above is off or no
  machine has been read)_ ; Crossfade — button
  group — `settings-crossfade-0|600|1500|3000|4000` (`settings-crossfade`) — R✅ I✅
  `[disabled: Listen on is not Local — two tunes cannot sound at once on the C64's
single chip]` ; C64 ROMs (`settings-local-engine-roms`): Fetch from device —
  button — `settings-roms-fetch` — R✅ I✅ ; Remove — button —
  `settings-roms-remove` — R✅ I✅ `[disabled: no ROMs stored]`
- **Notifications**: visibility — select — R✅ I✅ ; duration — slider — R✅ I✅
- **Build/info**: Take the tour — button — `settings-about-take-the-tour` — R✅ I✅ ;
  REST API docs — link — `settings-about-rest-api-docs` — R✅ I✅
  (`c64u-remote`: C64U User Guide — link — `settings-about-c64u-user-guide`
  — R✅ I✅) ; Open source licenses — button — R✅ I✅ (sub-route
  `/settings/open-source-licenses`)

### 4.6 Docs (`/docs`)

- Take the tour — card `docs-tour-card`, button `docs-tour-start` — R✅ I✅ — first on the page
- Section toggles: Getting Started, Home, Play files, Disks & Drives, Swapping
  Disks, Config, Settings, Diagnostics — button — `docs-toggle-*` — R✅ I✅
- External links: Ultimate Documentation, REST API Reference, Ultimate 64
  Official Site — link — `docs-external-resource-*` — R✅ I✅
  (`c64u-remote`: card hidden — its only external link, the C64U User Guide,
  is already reachable from Settings → About, see §4.5 above)

---

## 5. Overlays / dialogs (transient scopes)

### 5.0 Search overlay (`search-overlay`)

Opened by three doors — the Home field, the Quick Menu's top entry
(`keypad-quick-menu-search`), and the `7` key — all of which reach one component.

- Search box — text — `search-input` — R✅ I✅ — a `combobox` over
  `#search-results-listbox`. **The overlay owns its own keys and skips the focus ring**
  (`data-key-nav-skip` on the root and on the list): Up/Down move
  `aria-activedescendant` while DOM focus STAYS in the field, Enter activates the active
  row, Escape and Back close. The ring's own Up/Down inside a dialog move real DOM focus,
  which would take the user out of the field on the first press.
- Close — button — `search-close` — R✅ I✅
- Result row — `search-result-<entry id>` — R✅ I✅ — `role="option"`, at least 44 px, with
  the group folded into its accessible name. A row whose requirements are unmet is
  `aria-disabled` and carries the reason; activating it goes to the setting that would
  enable it.
- More in a group — button — `search-more-<group>` — R✅ I✅ `[at most five rows per group]`
- Promoted chips (empty query) — `search-chip-<entry id>` — R✅ I✅
- Recent searches (empty query) — `search-recent` — R✅ I✅
- Empty state — `search-empty`, with `search-empty-play` — R✅ I✅

### 5.0.1 Tour overlay (`tour-overlay`)

- Skip / Back / Next — buttons — `tour-skip` / `tour-back` / `tour-next` — R✅ I✅ — all 44 px.
  Keypad: Left/Right are Back/Next, OK is Next, Back skips.
- `tour-progress` says `Step n of 8`; `tour-spotlight` is the union of the step's anchors,
  and `data-tour-degraded="true"` marks a step that could not reach one.

### 5.0.2 Key Explorer (`key-explorer-popup`)

Under Diagnostics (`open-key-explorer-screen`). Copy as text — `key-explorer-copy` — R✅ I✅ ;
Clear — `key-explorer-clear` — R✅ I✅. Records key identity only, never a typed character.

When an app dialog / sheet / Radix menu opens, it becomes the active scope and
its controls are discovered the same way (Up/Down within, OK activates, Back/Esc
closes). Examples: machine-action confirmations (Reset/Reboot/Power Off),
config Save/Load/Manage, RAM snapshot manager, song selector, drive-status
details, item/disk pickers, Diagnostics dialog, Open source licenses page.

**Diagnostics dialog — connection card** (opened from the connectivity badge on any page):
Run health check — button — `run-health-check` — R✅ I✅ ; Use the simulated device — button —
`use-simulated-device-action` — R✅ I✅ `[visible only while the app reports itself offline or has
not connected yet, and the demo_mode_enabled flag is on]`. It is the way into Demo Mode for a user
who dismissed the offer or turned Automatic Demo Mode off; the other two are that offer's
**Continue in Demo Mode** and **Preview Demo Mode** in Settings → Devices.

**Demo Mode dialog** (`demo-interstitial-*`, a modal decision interstitial shown at
most once per session, on both automatic routes into Demo Mode — a failed probe, and a
platform that reports no network at all — while the `demo_mode_enabled` flag and the
Demo Mode setting are both on): explanation — text — `demo-interstitial-message` —
display only ; attempted hostname — text — `demo-interstitial-hostname` — display only
`[not shown with no network]` ; C64U hostname / IP — text input —
`demo-interstitial-host-input` — R✅ I✅ `[not shown with no network]` ; host error —
text — `demo-interstitial-host-error` — display only `[only after a rejected hostname]`
; Retry connection / Try again — button — `demo-interstitial-retry` — R✅ I✅ (the label
reads "Try again" with no network) ; Save & retry — button —
`demo-interstitial-save-retry` — R✅ I✅ `[not shown with no network]` ; Continue in Demo
Mode — button — `demo-interstitial-continue` — R✅ I✅.

With no network the dialog drops the hostname field, its error line and Save & retry:
neither editing a hostname nor re-saving one can make a device reachable until a network
comes back, so the only decisions left are to continue or to try again. The route to
real hardware also stays in **Settings → Device → Connection**.

**Automatic device discovery dialog** (`startup-discovered-device-*`, shown after
startup/resume discovery completes while no configured device is reachable):
Use — button — `startup-use-discovered-device-*` — R✅ I✅ ; Save — button —
`startup-save-discovered-device-*` — R✅ I✅ ; password entry — password/buttons
— `startup-device-password-*` — R✅ I✅ `[only for password-protected devices]` ;
manual host/IP — text input — `startup-manual-device-host-input` — R✅ I✅
`[when discovery finds no devices]` ; manual Connect — button —
`startup-manual-device-connect` — R✅ I✅ `[when discovery finds no devices]` ;
Open Settings — button — `startup-device-discovery-open-settings` — R✅ I✅ ;
Not now / Close — buttons — `startup-device-discovery-dismiss`,
`startup-device-discovery-close` — R✅ I✅.

**New disk dialog** (`new-disk-*`, Content Explorer, behind `new_disk_enabled`;
opened from the Disks library's "New disk" button): Type — select — `new-disk-type`
— R✅ I✅ ; File name — text — `new-disk-name` — R✅ I✅ ; Disk label — text —
`new-disk-label` — R✅ I✅ ; Tracks — number — `new-disk-tracks` — R✅ I✅
`[visible for D64/DNP types only]` ; Storage folder — text — `new-disk-folder` —
R✅ I✅ ; Cancel — button — R✅ I✅ ; Create & mount — button — `new-disk-create`
— R✅ I✅ `[disabled until a non-empty file name is entered / while creating]`.
Selecting the D64 or DNP type reveals the Tracks field; a successful create adds
the image to the library and mounts it to drive A.

**Disk contents dialog** (`disk-contents-*` / `disk-entry-*`, Content Explorer,
behind `disk_explorer_enabled`; opened from a disk row's "Open (Disk Explorer)…"
action): per directory entry `disk-entry-<i>` — Run — button —
`disk-entry-run-<i>` — R✅ I✅ ; Load — button — `disk-entry-load-<i>` — R✅ I✅ ;
Mount & Load — button — `disk-entry-mount-<i>` — R✅ I✅
`[all three shown only for launchable closed PRG entries, and disabled for the row
currently launching; non-PRG / unclosed (splat) rows show a reason instead of
buttons]`.

**Remote Input sheet** (`remote-input-sheet`, HARD12-017, behind
`remote_input_enabled`; opened from Home's **Remote Input** or **Game Mode** tile,
Play's **Remote Input** or **Game Mode** button, the `0` key, the Quick Menu's Game
Mode entry, or automatically when a game is launched with that setting on): a Radix
`[role=dialog]` sheet, so it is a normal keypad-navigable overlay scope like any
other (Up/Down/OK, Back closes) — **except** while **Joystick** output mode is
selected, physical D-pad/T9 digit key presses are read directly by the sheet to
drive the joystick relay instead of moving focus (the app's global keypad
navigation already excludes any key event targeted inside an open
`[role=dialog]`, so this is a scoped reinterpretation, not a new capture
mechanism). Touch and the on-screen keyboard/quick-keys buttons remain
ordinary focus-ring CTAs in both output modes.

- Output mode toggle: Joystick / Type — buttons — `remote-input-mode-joystick`,
  `remote-input-mode-type` — R✅ I✅ ; Joystick disabled with an inline hint on
  devices/firmware without `machine:input` (kernal-fallback tier); hidden in
  Game mode. Pinned in a non-scrolling chrome region at the top of the sheet
  (outside the scrollable body) so it is always visible, with Release All
  right-aligned on the same row (see below)
- Connection indicator — status text — `remote-input-connection-indicator` —
  not interactive
- Held joystick inputs — `data-held-joystick` on the sheet root — not interactive
  _(what the transport is currently asked to hold, comma-separated and sorted. A direction
  stuck on the real C64 is this feature's worst failure, so the answer is on the surface
  rather than only in a log)_
- Control size stepper (Joystick mode only) — decrease/increase buttons + label
  — `remote-input-size-decrease`, `remote-input-size-increase`,
  `remote-input-size-label` — R✅ I✅ (M/L/XL/XXL, persisted; scales the
  joystick action controls, not the Type-tab keyboard, which sizes itself from
  measured space)
- Game mode toggle (Joystick mode, joystick-capable tier only) — button —
  `remote-input-immersive-toggle` — R✅ I✅ — ENTERING starts the remembered
  Watch/Listen feeds and collapses ALL remaining chrome in one action (there is no
  separate Hide-controls step); leaving restores it. Auto-exits if the tier
  downgrades mid-session. One testid, two placements: the way IN sits on the
  size-stepper row and reads "Game mode" ("Game" on the compact display profile);
  the way OUT rides the Game mode heading row (`remote-input-game-mode-title`),
  right-aligned, reads "Exit", and carries the accessible name "Exit game mode"
- Orientation override (inside Game mode) — buttons —
  `remote-input-rotation-override` (group), `remote-input-rotation-{auto,0,90,270}`
  — R✅ I✅ _(pins the picture rotation and the key permutation for this session;
  `data-rotation` / `data-source` on the group carry the resolved state)_
- Hide joystick / Show joystick (inside Game mode, only while the picture is live) —
  button — `remote-input-joystick-visibility-toggle` — R✅ I✅ _(the explicit ask that
  outranks both the setting and the **Auto** guess, for the rest of this Game Mode
  session; `data-joystick` on `remote-input-sheet` carries the resolved
  visible/hidden state. Distinct from the floating `remote-input-restore-chrome`
  handle, which brings back this toolbar rather than the joystick)_
- Picture-off panel (inside Game mode) — container —
  `remote-input-no-picture-panel` — R✅ I✅ _(shown in the joystick's place when the
  joystick is explicitly Hidden and the picture is off, so the sheet is never blank:
  it names why the screen is empty and carries the Watch/Listen toggles and the
  QuickKeysBar, both reachable from a keypad. Not shown while the setting is Auto,
  which keeps the joystick in that case)_
- Show controls handle — button — `remote-input-restore-chrome` — R✅ I✅ _(the
  floating top-center "Controls" pull-down that restores the chrome; the ONLY
  affordance shown in collapsed Game mode; the restored chrome puts itself away
  again after the same idle period the mirror controls use)_
- Quick-keys + Live View overlay (inside Game mode) — container —
  `remote-input-quick-keys-toggle` — R✅ I✅ via the `#` key _(carries the
  QuickKeysBar and the Watch/Listen toggles over the bottom of the picture; `#`
  shows and hides it, and it auto-hides on the same idle timer — this is what makes
  Watch reachable with the controls hidden and no touchscreen)_
- **A/V mirror controls** (`remote-input-mirror-controls`) _(Content Explorer
  A/V Mirror; pinned in the sheet chrome when `audio_mirror_enabled` or
  `video_mirror_enabled` is on and the device advertises streaming; shares the
  single app-wide session with Home's Live View)_
  - Audio toggle — button — `av-audio-toggle` — R✅ I✅ _(flag `audio_mirror_enabled`)_
  - Video toggle — button — `av-video-toggle` — R✅ I✅ _(flag `video_mirror_enabled`)_
- **Immersive screen mirror** (`av-mirror-immersive`) _(mounts above the input
  controls when a video stream is on; the maximised zoom/pan surface for
  keypad-driven devices — 06-av-mirror-ux §7)_
  - Mode banner — status chip — `av-mirror-mode-chip` — not interactive (the
    glanceable view-lock signal; reads "C64" while driving the machine and "View"
    while adjusting it, with the full "Driving C64" / "Adjusting view" as its
    accessible name. Shares one status row along the top of the picture with the
    video standard and frame rate, so the row reads e.g. `C64 … PAL 50 fps`)
  - Zoom out / Zoom in / Fit — buttons — `av-immersive-zoom-out`,
    `av-immersive-zoom-in`, `av-immersive-fit` — R✅ I✅
  - Follow motion — toggle button — `av-immersive-follow` — R✅ I✅ (off by default)
  - Lock on — press and hold the picture — no testid of its own (the gesture is on
    `av-mirror-immersive-stage`); while following with nothing locked, the hint
    `av-immersive-lock-hint` says so
  - Lock on, no touchscreen — in view-lock Adjust mode the D-pad pans the picture
    under a fixed crosshair (`av-immersive-lock-aim`) and the OK / D-pad-centre key
    confirms what is under it, or releases an existing lock. Turns following on by
    itself, so it is one key rather than two. `0`/`5` keep Fit
  - Lock state — chip and release button — `av-immersive-lock-status` — R✅ I✅ —
    reports "Locked on" / "Looking…" / "Lost it" and releases the lock when tapped
  - Lock marker — `av-immersive-lock-reticle` — not interactive (four corner
    brackets around the tracked object; Settings → Remote Input → Game Mode →
    "Mark what the view is following", `settings-follow-marker`, on by default)
  - Fit / Done view-lock — toggle button — `av-immersive-mode-toggle` — R✅ I✅
    — flips physical-key ownership between relaying to the C64 and adjusting the
    view; also reachable via the `*`/Menu physical key and auto-reverts after idle
  - Minimap — draggable viewport rectangle — `av-mirror-minimap` /
    `av-mirror-minimap-viewport` — pointer-drag to reposition (shown once zoomed in)
  - The picture itself — pinch to zoom, drag to pan, double-tap to zoom-to-point
    (touch on the mirror is always view-control, never relayed)
- **Joystick mode:**
  - Port swap — switch (one-tap toggle, same directness as Autofire) —
    `remote-input-port-switch` — R✅ I✅ (default Port 2; label shows the
    current port; docked on the left rail in both standard and Game mode)
  - Movement style toggle: Stick / D-Pad / Swipe — buttons —
    `remote-input-movement-style-{stick,dpad,swipe}` — R✅ I✅ (default Stick;
    switching style never itself releases a held direction)
  - **Stick style** — relative thumbstick — pointer-only zone —
    `remote-input-stick-zone` — touch only (see below for the physical
    equivalent)
  - **D-Pad style** (`remote-input-virtual-dpad`) — discrete 8-way
    tap-and-hold buttons — `remote-input-dpad-{up,down,left,right,up-left,
up-right,down-left,down-right}` — R✅ I✅ (touch only)
  - **Swipe style** (`remote-input-swipe-pad`) — a large free-drag surface;
    dragging steers the joystick live along the drawn path (same 8-way live
    resolution as the Stick, no fixed knob) and releases the instant the finger
    lifts — sustained, not a one-shot tap — touch only. Shows a drag dot
    (`remote-input-swipe-dot`) while dragging.
  - Fire — button (press-and-hold) — `remote-input-fire-button` — R✅ I✅
  - Autofire — switch + label — `remote-input-autofire-switch` — R✅ I✅
    (standard horizontal Switch+label row, matching the Port toggle; in a card
    above FIRE with the rate slider beneath, in both standard and Game mode for
    extra thumb clearance)
  - Autofire rate — slider — `remote-input-autofire-rate-slider` — R✅ I✅
    (1–10/s, default 5, persisted; also settable from Settings → Play and Disk)
  - **Physical D-pad / regular keyboard cursor keys / T9, while Joystick mode
    is active** (not focus-ring CTAs — raw relay, works regardless of the
    selected touch movement style above): hardware D-pad Up/Down/Left/Right
    and a regular keyboard's Arrow keys (same underlying semantic-action
    keymap) → joystick direction; keypad 2/4/6/8 → direction (1/3/7/9 →
    diagonals); keypad 5/0 or D-pad center/select → fire. Held while the
    physical key is held; released on key-up.
- **Type mode — on-screen C64 keyboard** (`remote-input-type-keyboard`, the
  primary Type surface) — buttons `remote-input-key-<name>` (e.g.
  `remote-input-key-a`, `remote-input-key-return`) — R✅ I✅ for every key.
  Compact/medium profiles render a high-value deck
  (`remote-input-keyboard-deck`: cursor pad `remote-input-cursor-pad-group` +
  immediate RETURN/SPACE `remote-input-keyboard-immediate`, then f 1–f 8
  `remote-input-keyboard-function` — always two rows f 1–f 4/f 5–f 8 (compact and
  medium) — then the larger high-value special keys directly below: CLR/HOME/INST/DEL
  `remote-input-keyboard-edit` and the system keys `remote-input-keyboard-system`
  split into two rows RUN/STOP·SHIFT-LOCK·RESTORE / C=·CTRL·SHIFT), then the
  alphanumeric/symbol grid (`remote-input-keyboard-grid`), and finally a bottom
  row `remote-input-keyboard-bottom-row` of SHIFT · wide SPACE · RETURN
  (`remote-input-key-shift-bottom`, `remote-input-key-space-bottom`,
  `remote-input-key-return-bottom`) so SHIFT, SPACE and RETURN each appear twice
  (top/system + bottom). Function keys are printed lower-case with a space (`f 1`,
  `f 3` …) exactly as on the C64 keycaps, and the odd/unshifted ones (f 1/f 3/f 5/f 7)
  carry a slightly darker "function-primary" tint that sets them apart from the
  shifted f 2/f 4/f 6/f 8. Ordinary typing keys 0-9/A-Z carry a distinct
  "character" colour, SHIFT and SHIFT LOCK a distinct high-visibility "shift"
  colour applied consistently wherever they appear. RESTORE is spelled in full on
  compact and medium (there is room); only the dense expanded profile abbreviates
  it to `REST.` (full "Restore" accessible label preserved). Every grid row
  is a contiguous slice of exactly one physical C64 row (segment invariant — no
  split QWERTY rows, no horizontal scrolling); the deck and grid share one scroll
  container (`remote-input-keyboard-scroll`) so the whole keyboard scrolls as a
  unit on short viewports; the expanded profile renders the physical C64 rows
  directly in `remote-input-keyboard-grid` with the function-key cluster
  alongside. The cursor-pad keys
  (`remote-input-key-cursor-{up,down,left,right}`) auto-repeat while held by
  touch (initial delay then a brisk repeat, like C64 hardware); a keypad/
  focus-ring activation still emits a single cursor move (R✅ I✅ preserved)
  - One-shot SHIFT / CTRL / C= (Commodore) latches — buttons —
    `remote-input-key-shift`, `remote-input-key-ctrl`,
    `remote-input-key-commodore` — R✅ I✅ (apply to exactly the next key,
    then auto-clear); CTRL/C= `[disabled: kernal-fallback tier — no
PETSCII/keyboard-buffer equivalent for these modifiers]`
  - SHIFT LOCK — button (persistent latch, separate from the one-shot SHIFT
    above) — `remote-input-key-shift-lock` — R✅ I✅ — stays applied to every
    key until toggled off
  - RUN/STOP, RESTORE, C=, CTRL — buttons — `remote-input-key-run-stop`,
    `remote-input-key-restore`, `remote-input-key-commodore`,
    `remote-input-key-ctrl` — R✅ I✅ `[shown but disabled on the
kernal-fallback tier — no keyboard-buffer equivalent; a plain-language footer
`remote-input-modifier-unavailable-hint` and per-key tooltip explain "not
available on this device", with no REST/firmware jargon]`
  - F1–F8 — buttons — `remote-input-key-f{1..8}` — R✅ I✅
- **Standard Joystick mode only — quick-keys bar**
  (`remote-input-quick-keys-bar`): a fixed five-row deck mirroring the physical
  C64 clusters — **row 1** RUN/STOP · CTRL · SPACE · RETURN, **row 2** f 1 · f 2 ·
  f 3 · f 4, **row 3** f 5 · f 6 · f 7 · f 8, **row 4** cursor ← ↑ ↓ →, **row 5**
  C= · SHIFT · SPACE · SHIFT. RUN/STOP keeps the caution-styled solid double
  border in the theme's warning colour (matching the Keys tab) and, though it
  shares row 1 with RETURN, CTRL and SPACE always sit between them so a wide
  RETURN tap can never halt the program. Function keys are printed lower-case
  (`f 1` …) with the odd ones f 1/f 3/f 5/f 7 tinted, and both SHIFTs carry the
  shared primary-blue "shift" colour. SPACE and SHIFT
  each appear as two distinct keys (`remote-input-key-space` /
  `remote-input-key-space-bottom`, `remote-input-key-shift-left` /
  `remote-input-key-shift-right`). On the compact display profile RUN/STOP is
  printed `RSTOP` (and, on the Keys tab, RESTORE is printed `RSTR`), because at
  320 CSS px the full names are wider than the keys that carry them; both keep
  their full accessible names on every profile. — buttons —
  `remote-input-key-{run-stop,ctrl,space,return,f1,f2,f3,f4,f5,f6,f7,f8,cursor-up,cursor-down,cursor-left,cursor-right,commodore,shift-left,space-bottom,shift-right}`
  — R✅ I✅ (hidden in Game mode and Type mode). The modifier keys (RUN/STOP,
  CTRL, C=, both SHIFTs) have no kernal-buffer equivalent so are `[disabled off
the full machine:input tier]`; SPACE/RETURN/f-keys/cursors also work on the
  kernal-fallback tier and only disable on `auth-required` (password needed).
- **Standard Joystick mode and Type mode only — pinned top-right action**
  - Safety — Release All (panic button) — button (destructive) —
    `remote-input-panic-button` — R✅ I✅ — releases every held input regardless
    of tracked state; right-aligned in the pinned chrome row, to the right of
    the Joystick/Keys toggle (moved here from the old footer)
- **Close**: the sheet's top-right X (`remote-input-close`) is the sole Close
  affordance (the duplicate footer Close was removed). Closing — via the X or
  Android Back — releases all held inputs
- **Joystick Game mode only**: Release All is intentionally hidden (no-look
  play); dismissal is via the sheet header X or the `remote-input-immersive-toggle`
  "Exit" control, both of which release all held inputs. Both live in the
  chrome, which Game Mode collapses — the floating `remote-input-restore-chrome`
  handle (touch) or the Back key (any input) is the way out

**Quick Menu** (`keypad-quick-menu`): a keypad-navigable list, opened either by
the Menu key (when the focused item has no context menu) or by the app bar's
`app-bar-quick-menu` button, which is on every page.

What it holds depends on how it was opened. From the keypad it lists jump-to-page
(×6), and each entry names the key that reaches it directly — `1`–`6` for the
pages, `0` for Game Mode, `✱` for Diagnostics, `#` for Switch device — which puts
those shortcuts somewhere they can be discovered without reading the manual. From
the app-bar button the page jumps are omitted: a reader who tapped it is holding
a touchscreen and has the TabBar in front of them.

Always present: Game Mode (flag `remote_input_enabled`), Diagnostics, Switch
device (when >1 saved device), and — on a page that has collapsible cards —
`keypad-quick-menu-sections-expand` and `keypad-quick-menu-sections-collapse`
(both always listed, so the one you want is always in the same place; whichever
would do nothing is disabled) and
`keypad-quick-menu-section-descriptions` (show or hide the one-line description
under each card title).

Per-entry testids `keypad-quick-menu-tab-<label>`, `keypad-quick-menu-game-mode`,
`keypad-quick-menu-diagnostics`, `keypad-quick-menu-switch-device`,
`keypad-quick-menu-sections-expand`, `keypad-quick-menu-sections-collapse`,
`keypad-quick-menu-section-descriptions`.

---

## 6. Known findings / limitations (as of last verification)

**Resolved on this branch:**

1. **Coarse grouping / "needless descending" (Home) — FIXED.** A
   `[data-section-label]` container is promoted to a focus group only when it is
   the innermost one, so an outer wrapper (e.g. `Quick Config`) no longer
   swallows a whole card; progression is page → card → control.
2. **Viewport follows focus — FIXED.** `focusRingElement` reserves scroll-margin
   for the fixed header (top) and the guidance bar + tab bar (bottom) so the
   focused control is always fully revealed.
3. **Device Switcher keypad path — ADDED.** Keypad `#` (and Menu → Quick Menu →
   Switch device) opens the device switcher, equivalent to long-pressing the
   status badge. (Still requires ≥2 saved devices to do anything.)

**Open:**

4. **Long-press census.** Long-press is used in exactly two places: the status
   badge (→ device switcher; now also keypad `#`) and the Diagnostics device line
   (long-press → connection _edit_; tap → _view_). The Diagnostics-line _edit_
   gesture still has no keypad equivalent.
5. **Hardware Back** may be intercepted by Capacitor before reaching the WebView
   key handler; Esc (`escape`) reliably dismisses overlays / ascends without
   navigating.

---

## 7. How this inventory was verified

- Real device: Pixel 4 `9B081FFAZ001WX`, app foreground, connected to c64u.
- Keys injected as real OS key events via `adb shell input keyevent <code>`
  (the same codes the device is assumed to emit).
- Per-page CTA enumeration via the WebView DevTools (CDP): the active focus
  scope is scanned for interactive elements (role/label/testid/disabled/
  key-selected). Re-run this enumeration after UI changes to refresh §3/§4.
- Slider correctness cross-checked against the c64u firmware
  (`CPU Speed` read back as `4` after three keypad Right presses, then restored
  to `1`).
