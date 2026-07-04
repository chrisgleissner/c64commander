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

| Physical key          | Android keycode      | Semantic action   | Behaviour in app                                                                                                                         |
| --------------------- | -------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| D-pad **Up**          | `DPAD_UP` 19         | `dpadUp`          | Move to previous sibling CTA/group in scope (wraps). On a focused slider thumb: **moves focus** (does not change value).                 |
| D-pad **Down**        | `DPAD_DOWN` 20       | `dpadDown`        | Move to next sibling CTA/group in scope (wraps).                                                                                         |
| D-pad **Left**        | `DPAD_LEFT` 21       | `dpadLeft`        | On a value control (slider/tabs/segmented): **decrement / previous**. Otherwise previous sibling.                                        |
| D-pad **Right**       | `DPAD_RIGHT` 22      | `dpadRight`       | On a value control: **increment / next**. Otherwise next sibling.                                                                        |
| D-pad **OK / Center** | `DPAD_CENTER` 23     | `center`          | **"OK goes in":** descend into the focused group, or activate the focused leaf. On a Select: opens the dropdown.                         |
| **Back / Clear**      | `BACK` 4             | `back`            | **"Back goes out":** dismiss overlay → leave field → ascend group → finally route back. (Capacitor may intercept hardware Back; see §6.) |
| **Call / Send**       | `CALL` 5             | `activate`        | Primary activate of the focused leaf.                                                                                                    |
| **Menu**              | `MENU` 82            | `openMenu`        | Right soft-key "Menu": focused item's context menu, else the **Quick Menu** (jump-to-page / Diagnostics / Switch Device).                |
| **Left soft key**     | `SOFTLEFT` 1         | `softLeft`        | Follows the Back chain (Back/Exit/Close/Done).                                                                                           |
| **Right soft key**    | `SOFTRIGHT` 2        | `softRight`       | Opens current item/scope menu.                                                                                                           |
| **0–9**               | `KEYCODE_0..9` 7–16  | `digit0`–`digit9` | In a text field: T9 entry. Outside a field: **jump to tab 1–6** (Home/Play/Disks/Config/Settings/Docs).                                  |
| **✱ (star)**          | `STAR` 17            | `star`            | In a hostname field: cycle separators `. : - _ /`. Otherwise **open Diagnostics**.                                                       |
| **# (pound)**         | `POUND` 18           | `hash`            | In a text field: toggle T9 mode. Otherwise **open the Device Switcher** (= badge long-press).                                            |
| (desktop equiv.)      | `ESCAPE` 111 / `Esc` | `escape`          | Dismiss overlay / ascend — **never navigates the route** (only Back/soft-left do).                                                       |

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
  Activate (by control kind), right = Menu.
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

Reachability is **complete by construction**: the provider scans the active
scope (topmost dialog/menu/sheet, else the routed page + bottom TabBar) and
discovers every interactive element; `useFocusItem`/`useFocusGroup` only refine
id/order/label/grouping/activation.

---

## 3. Per-page CTA counts (verified on device)

Counts are the number of discoverable interactive elements in the page scope
(excludes the device system bars; includes the 6 persistent TabBar tabs and the
persistent status badge that appear on every page).

| Page     | Route       |     CTAs | Notes                                                                                                                                                                                             |
| -------- | ----------- | -------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home     | `/`         | 113 (+1) | Dashboard: machine actions, quick config, LED, drives, printer, SID mixer, streams, config snapshots. `+1` Remote Input tile behind `remote_input_enabled` (stable, enabled and user-visible by default in C64 Commander; disabled and hidden in C64U Remote per `variants/feature-flags/c64u-remote.yaml`). |
| Settings | `/settings` |  77 (+2) | Connection, devices, display (+2 native Android full-screen toggles), feature flags, network/cache, notifications, dev-mode, build info.                                                          |
| Play     | `/play`     |  32 (+1) | Transport, volume, playback flags, playlist, type filters, HVSC. `+1` Open Controller button, shown only while playing, behind `remote_input_enabled`.                                            |
| Config   | `/config`   |       30 | Search + 22 config-category accordions (each expands to config-item rows).                                                                                                                        |
| Disks    | `/disks`    |       28 | Drive A/B/Soft-IEC controls, disk library.                                                                                                                                                        |
| Docs     | `/docs`     |       18 | 8 doc-section toggles + 3 external links.                                                                                                                                                         |

**Persistent on every page (counted within each page above):**

| CTA                   | Type         | testid                 | Reachable | Interactive        | Notes                                                                |
| --------------------- | ------------ | ---------------------- | --------- | ------------------ | -------------------------------------------------------------------- |
| Status / health badge | button       | `unified-health-badge` | ✅        | ✅ (tap = details) | Tap = details; long-press / keypad `#` / Menu → **Device Switcher**. |
| Tab: Home             | tab (button) | `tab-home`             | ✅        | ✅                 | Persistent bottom TabBar.                                            |
| Tab: Play             | tab (button) | `tab-play`             | ✅        | ✅                 |                                                                      |
| Tab: Disks            | tab (button) | `tab-disks`            | ✅        | ✅                 |                                                                      |
| Tab: Config           | tab (button) | `tab-config`           | ✅        | ✅                 |                                                                      |
| Tab: Settings         | tab (button) | `tab-settings`         | ✅        | ✅                 |                                                                      |
| Tab: Docs             | tab (button) | `tab-docs`             | ✅        | ✅                 | OK on a focused tab switches route (verified).                       |

---

## 4. Page hierarchies

Legend — Type: `button`, `link`, `tab`, `slider`, `select` (Radix `combobox`),
`checkbox` (incl. switches/toggles rendered with `role=checkbox`), `text`,
`number`, `password`, `search`. R = reachable via keypad, I = interactive via
keypad. `[disabled]` marks controls disabled by current state (legitimate, e.g.
not-connected / empty / single-device).

### 4.1 Home (`/`)

- **Header**
  - Status badge — button — `unified-health-badge` — R✅ I✅
  - System info — button (`App … Device … Firmware …`) — `home-system-info` — R✅ I✅ (expands)
- **Quick Actions** (`data-section-label="Quick Actions"` group)
  - Reset — button — R✅ I✅ (confirm dialog)
  - Reboot — button — R✅ I✅ (confirm dialog)
  - Pause / Resume — button (toggles) — R✅ I✅
  - Menu — button — R✅ I✅
  - Save RAM — button — `home-save-ram` — R✅ I✅ _(flag `ram_snapshots_enabled`)_
  - **Save RAM dialog** (`save-ram-dialog`, opened by `home-save-ram`)
    - CPU + RAM Snapshot — button — `save-ram-type-cpu` — R✅ I✅ _(conditional on CPU-snapshot capability; `save-ram-type-list` scope)_
    - Program / BASIC / Screen / REU region presets — buttons — `save-ram-type-{program,basic,screen,reu}` — R✅ I✅
    - Custom ranges toggle — button — `save-ram-type-custom` — R✅ I✅ _(reveals `save-ram-custom-form` scope)_
    - Custom range start/end — text/number — `save-ram-custom-{start,end}-{i}` — R✅ I✅
    - Delete range — button — `save-ram-custom-delete-range-{i}` — R✅ I✅
    - Add range — button — `save-ram-custom-add-range` — R✅ I✅
    - Save custom — button — `save-ram-custom-confirm` — R✅ I✅
  - Load RAM — button — `home-load-ram` — R✅ I✅ _(flag)_
  - Power Off — button (danger) — R✅ I✅ (confirm dialog)
  - Remote Input — button — `home-machine-inline-openRemoteInput` — R✅ I✅ _(flag `remote_input_enabled`; stable, enabled and visible by default in C64 Commander, disabled+hidden in C64U Remote)_ — opens the **Remote Input sheet** (§5)
  - RAM dump folder — button (`...`) — `ram-dump-folder-trigger` — R✅ I✅
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
- **Config actions** (`data-section-label="Config"`)
  - Save/Load (flash) — button — R✅ I✅
  - Reset to default — button (danger) — R✅ I✅
  - Save to App — button — `home-config-save-app` — R✅ I✅
  - Load from App — button — `home-config-load-app` — R✅ I✅ `[disabled: no app configs]`
  - Revert Changes — button — `home-config-revert-changes` — R✅ I✅
  - Manage App Configs — button — `home-config-manage-app` — R✅ I✅ `[disabled: no app configs]`
  - _(flag/telnet)_ Save/Load file, Clear flash — button — R✅ I✅

### 4.2 Play (`/play`)

- Transport: Previous / Play / Pause / Next — button — `playlist-prev|play|pause|next` — R✅ I✅ `[disabled: no playlist loaded, playlist loading, or no previous/next item in the current repeat/shuffle traversal]`
- Mute — button — `volume-mute` — R✅ I✅ `[disabled]`
- Volume — slider — R✅ I✅ `[disabled]`
- Recurse / Shuffle / Repeat — checkbox — `playback-recurse|shuffle|repeat` — R✅ I✅
- Reshuffle — button — `playlist-reshuffle` — R✅ I✅ `[disabled]`
- Duration — slider — R✅ I✅
- Duration override — text — `duration-input` (`mm:ss`) — R✅ I✅ ; Change — button — R✅ I✅
- Add items to playlist — button — `add-items-to-playlist` — R✅ I✅ (opens picker)
- Filter files — text — `list-filter-input` — R✅ I✅
- Type filters: SID / MOD / PRG / CRT / Disk — checkbox — `playlist-type-*` — R✅ I✅
- Select all — button — `playlist-list-toggle-select-all` — R✅ I✅
- HVSC: Download / Ingest / Reindex / Reset — button — R✅ I✅ _(flag `hvsc_enabled`)_
- Open Controller — button — `play-open-controller` — R✅ I✅ _(flag `remote_input_enabled`; visible only while `isPlaying`)_ — opens the **Remote Input sheet** (§5)

### 4.3 Disks (`/disks`)

Per drive (A / B / Soft-IEC):

- Status toggle (ON/OFF) — button — `drive-status-toggle-*` — R✅ I✅
- Mount disk / select directory — button — `drive-mount-toggle-*` — R✅ I✅
- Bus ID — select — `drive-bus-select-*` — R✅ I✅
- Drive Type — select — `drive-type-select-*` — R✅ I✅ _(A/B)_
- Soft-IEC default path — button — `drive-default-path-select-soft-iec` — R✅ I✅
- Reset — button — `drive-reset-*` — R✅ I✅
- Power (Turn On/Off) — button — `drive-power-toggle-*` — R✅ I✅

Disk library: Add disks — button — R✅ I✅ ; Filter disks — text — `list-filter-input` — R✅ I✅ ; Select all — button — `disk-list-toggle-select-all` — R✅ I✅ `[disabled: empty]`.

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

- **Display**: Theme (Auto/Light/Dark) — segmented buttons — R✅ I✅ ; Display
  profile (Small/Standard/Large/Auto) — segmented — R✅ I✅ ; Orientation
  (Portrait/Landscape/Auto) — segmented — R✅ I✅
- **Full screen** _(native Android only)_ — checkbox ×2 — Hide status bar
  (`settings-hide-status-bar`) / Hide navigation bar
  (`settings-hide-navigation-bar`) — R✅ I✅ ; default per build variant
  (`variant.runtime.default_hide_*`; `c64u-remote` ships both on)
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
  R✅ I✅ `[visible when a discovered device requires a network password]`
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
- **Notifications**: visibility — select — R✅ I✅ ; duration — slider — R✅ I✅
- **Build/info**: REST API docs — link — `settings-about-rest-api-docs` — R✅ I✅
  (`c64u-remote`: C64U User Guide — link — `settings-about-c64u-user-guide`
  — R✅ I✅) ; Open Source Licenses — button — R✅ I✅ (sub-route
  `/settings/open-source-licenses`)

### 4.6 Docs (`/docs`)

- Section toggles: Getting Started, Home, Play Files, Disks & Drives, Swapping
  Disks, Config, Settings, Diagnostics — button — `docs-toggle-*` — R✅ I✅
- External links: Ultimate Documentation, REST API Reference, Ultimate 64
  Official Site — link — `docs-external-resource-*` — R✅ I✅
  (`c64u-remote`: single C64U User Guide link —
  `docs-external-resource-c64u-user-guide` — R✅ I✅)

---

## 5. Overlays / dialogs (transient scopes)

When an app dialog / sheet / Radix menu opens, it becomes the active scope and
its controls are discovered the same way (Up/Down within, OK activates, Back/Esc
closes). Examples: machine-action confirmations (Reset/Reboot/Power Off),
config Save/Load/Manage, RAM snapshot manager, song selector, drive-status
details, item/disk pickers, Diagnostics dialog, Open Source Licenses page.

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

**Remote Input sheet** (`remote-input-sheet`, HARD12-017, behind
`remote_input_enabled`; opened from Home's "Remote Input" tile or Play's "Open
Controller" button): a Radix
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
  Game mode
- Connection indicator — status text — `remote-input-connection-indicator` —
  not interactive
- Control size stepper (Joystick mode only) — decrease/increase buttons + label
  — `remote-input-size-decrease`, `remote-input-size-increase`,
  `remote-input-size-label` — R✅ I✅ (M/L/XL/XXL, persisted; scales the
  joystick action controls, not the Type-tab keyboard, which sizes itself from
  measured space)
- Game mode toggle (Joystick mode, joystick-capable tier only) — button —
  `remote-input-immersive-toggle` — R✅ I✅ — enters/exits the stripped,
  edge-anchored no-look layout; auto-exits if the tier downgrades mid-session
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
  - Autofire — switch — `remote-input-autofire-switch` — R✅ I✅ (rendered in
    a separate pill above FIRE in both standard and Game mode for extra thumb
    clearance)
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
  immediate RETURN/SPACE `remote-input-keyboard-immediate`, then
  CLR/HOME/INS/DEL `remote-input-keyboard-edit`, F1–F8
  `remote-input-keyboard-function`, and RUN/STOP/RESTORE/C=/CTRL/SHIFT
  `remote-input-keyboard-system`) above the alphanumeric/symbol grid
  (`remote-input-keyboard-grid`), with the deck AND grid together in one scroll
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
  - RUN/STOP, RESTORE — buttons — `remote-input-key-run-stop`,
    `remote-input-key-restore` — R✅ I✅ `[RESTORE unavailable on the
kernal-fallback tier — no keyboard-buffer byte; still shown, no-ops]`
  - F1 / F3 / F5 / F7 — buttons — `remote-input-key-f{1,3,5,7}` — R✅ I✅
- **Standard Joystick mode only — quick-keys bar**
  (`remote-input-quick-keys-bar`): SPACE, RETURN, RUN/STOP, F1/F3/F5/F7, cursor
  Up/Down/Left/Right — buttons — `remote-input-key-{space,return,run-stop,f1,f3,f5,f7,cursor-up,cursor-down,cursor-left,cursor-right}`
  — R✅ I✅ (hidden in Game mode and Type mode)
- **Standard Joystick mode and Type mode only — footer actions**
  - Safety — Release All (panic button) — button (destructive) —
    `remote-input-panic-button` — R✅ I✅ — releases every held/latched input
    regardless of tracked state
  - Exit — button — `remote-input-exit-button` — R✅ I✅ ; Android Back also
    exits (closes the sheet and releases all held inputs)
- **Joystick Game mode only**: no footer actions; dismissal is via the sheet
  header close button or the `remote-input-immersive-toggle` "Exit game mode"
  control

**Keypad Quick Menu** (`keypad-quick-menu`, opened by the Menu key when the
focused item has no context menu): a keypad-navigable list of jump-to-page (×6),
Diagnostics, and Switch Device (when >1 saved device). Per-entry testids
`keypad-quick-menu-tab-<label>`, `keypad-quick-menu-diagnostics`,
`keypad-quick-menu-switch-device`.

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
   Switch Device) opens the device switcher, equivalent to long-pressing the
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
