# First-impression sweep for 1.0.7-rc1

This is the durable record of the newcomer and compact-keypad sweep commissioned by
[`../../hil-first-impression-1.0.7-rc1-prompt.md`](../../hil-first-impression-1.0.7-rc1-prompt.md).
It lists what was measured, what was found, what was changed and how each change was verified.
Raw screenshots, geometry dumps and logs are kept out of the repository under
`artifacts/hil-first-impression-1.0.7-rc1/`.

## Rig

| Item | Value |
| --- | --- |
| Base commit | `4e3253015` (main) |
| Phone | Pixel 4, serial `9B081FFAZ001WX`, Android 16 (API 36), WebView 150.0.7871.63 |
| Callback 8020 stand-in | `wm size 480x640`, `wm density 240`: 320 x 427 CSS px at DPR 1.5, `compact` profile |
| System bars at that geometry | status bar 30 CSS px, navigation bar 48 CSS px (C64 Commander); navigation bar hidden in C64U Remote |
| Ultimates | `c64u` (C64 Ultimate, fw 1.2RC, core 1.4F), `u2` (Ultimate-II+L, fw 3.15, in the c64u's cartridge port), `u64` (Ultimate 64 Elite, fw 3.15) |
| Editions | C64 Commander `uk.gleissner.c64commander`, C64U Remote `uk.gleissner.c64uremote`, both debug builds of this branch |
| Media volume | 3 of 25 throughout |
| Automation | droidctl for every phone operation; CDP (`scripts/bughunt-cdp.mjs`) for measurement only |

The Pixel 4 stands in for the Callback 8020, which does not exist on the rig. Results here are
the phone-side results at the 8020's screen geometry and key semantics. They do not prove the
handset's CPU, battery, key matrix or panel readability.

The debug build seeds its saved devices from `VITE_DEBUG_SAVED_DEVICES_JSON` (`c64u`, `u2`), so a
cleared debug install is not a genuinely empty first launch: it starts connected to `c64u`. The
offline first launch below is genuine, because nothing can be reached.

## How the tour was measured

`measure.js` (kept with the artifacts) reads, for each step, the viewport, the safe-area insets,
the caption's rectangle, the spotlight's rectangle and the step's body text. Two figures are
derived:

- **Unobscured share**: the part of the band between the status bar and the navigation bar that
  the caption does not cover. The caption's own padding includes the inset on its edge, so that
  inset is not subtracted twice.
- **Subject visible share**: the part of the spotlight's height inside the free band.

Each step was measured on entry, after 1.8 s and after a further 5.5 s with no input, advancing
with `KEYCODE_DPAD_RIGHT` from droidctl.

## Findings

Severity: **High** blocks a newcomer from the feature; **Medium** misleads or costs them the view
of what they are being shown; **Low** is friction.

| ID | Severity | Journey | Finding | Status |
| --- | --- | --- | --- | --- |
| FI-01 | High | Tour | Caption left 36% of the screen on 12 of 13 steps; on Radio, Last/Recent and Docs the spotlit control was entirely under the caption | Fixed |
| FI-02 | Medium | Tour | Settings step outlined the tab bar instead of the style picker; the machine-control step spotlit a 490 px section taller than the screen | Fixed |
| FI-03 | Medium | Tour | Four steps spotlit a tab icon, which shows where a page is and nothing of what it does | Fixed |
| FI-04 | Medium | Tour | The body folded away after 6 s idle while the user might still be reading; any key brought it back | Fixed |
| FI-05 | Medium | Tour | A held key's repeats walked through the tour and, on the last step, completed it | Fixed |
| FI-06 | Medium | Tour | The app was `aria-hidden` but not inert: a tap in the spotlight reached the control; focus stayed on `<body>` | Fixed |
| FI-07 | Medium | Tour | OK always meant Next, whichever tour button had focus | Fixed |
| FI-08 | Medium | Tour, first song | "No C64 and no network needed" on a fresh install, where every station is disabled until HVSC is downloaded | Fixed |
| FI-09 | Low | Tour | British "colour"; search step said search finds "any" setting (it finds those in its index) | Fixed |
| FI-10 | Medium | Tour | Scrim at 85% hid the page title, so the user could not tell which page they were on | Fixed |
| FI-11 | Medium | Landscape | Side navigation bar covered the tour's Next button and the Docs tab | Fixed |
| FI-12 | High | First song | Compact bottom sheets stood on the navigation bar at full screen height: SID Radio's title and Close were under the status bar | Fixed |
| FI-13 | Medium | First minute | Demo Mode offer's message ran under its buttons | Fixed |
| FI-14 | Low | First minute | Discovery picker's footer wrapped by one pixel, leaving room for one device | Fixed |
| FI-15 | High | Play remotely | Remote Input showed five rows of settings and no joystick | Fixed |
| FI-16 | Medium | First song | HVSC step labels ran together ("DownloadUnpack") | Fixed |
| FI-17 | Medium | First song | An install started from SID Radio ended on Browse HVSC and an empty playlist, not back at the radio | Fixed |
| FI-18 | Low | First song | Preparation sheet said the download starts "when you choose HVSC from Add items" to a user who came from the radio | Fixed |
| FI-19 | Medium | Explore | "Play files" title wrapped; the titles are now Home, Play, Disks, Config, Settings, Docs | Fixed (user request) |
| FI-20 | High | Play remotely | Filtering in the From C64U browser left the list 69 px, less than one row | Fixed |
| FI-21 | Medium | Play remotely | The folder filter matched full paths, so inside `/USB2/Games` "Games" matched everything; a filter typed to find a folder was carried into it | Fixed |
| FI-22 | Low | Play remotely | "0 selected" line and a two-line path took rows from the compact browser's list | Fixed |
| FI-23 | High | Play remotely | Game Mode on the compact screen gave the live picture 0 px while the on-screen joystick showed | Fixed |
| FI-24 | Medium | Device switch | After switching to the U2, twelve U64-only config reads failed and the badge showed a healthy cartridge with 12 problems | Fixed |
| FI-25 | Medium | Enjoy music | With a station running, Clear playlist was undone at once by ten new tunes | Fixed |
| FI-26 | Harness | Release | `merge_gate.mjs`, `release_sweep_hil.mjs`, `hil_cdp.mjs` and both joystick harnesses shelled out to raw adb; the sweep defaulted to driving `u64` and skipped Docs | Fixed |

### FI-01 to FI-10: the tour

Measured at 320 x 427 CSS px with the Pixel's bars (usable band 349 px):

| Step | Before: unobscured | Before: subject visible | After: unobscured | After: subject visible |
| --- | --- | --- | --- | --- |
| Welcome | 0.59 (body already folded) | — | 0.54 | — |
| Search | 0.36 | 1.00 | 0.54 | 1.00 |
| Radio | 0.36 | 0.00 | 0.54 | 1.00 |
| Last / Recent | 0.36 | 0.00 | 0.54 | 1.00 |
| Playlist | 0.36 | tab icon | 0.54 | 1.00 (Add items) |
| Disks | 0.36 | tab icon | 0.54 | 1.00 (drive A) |
| Connection | 0.36 | 1.00 | 0.54 | 1.00 |
| Machine | 0.36 | 0.36 (490 px section) | 0.55 | 1.00 (Reset, Power) |
| Live View | 0.36 | 0.68 | 0.54 | 1.00 |
| Config | 0.36 | tab icon | 0.55 | top of the list |
| Keys | 0.28 | tab icon | 0.55 | 1.00 (tab bar) |
| Docs | 0.36 | 0.00 | 0.54 | 1.00 |
| Settings | 0.36 | tab bar | 0.54 | top of the style list |

Folded (Down key or the panel button) every step leaves 0.70. C64U Remote, which hides the
navigation bar, leaves 0.60 while reading. At Android font scale 1.3 the reading caption leaves
0.27 to 0.46, because text is never shrunk to fit; folded it leaves 0.56 to 0.66 with every subject
in view. That is the explicit reveal mode the acceptance criteria allow for a larger explanation.

Root causes and changes:

- Placement chose top or bottom from the space around the anchor and ignored the caption's height;
  the search resolver then scrolled the anchor to the middle of the screen, under a caption that
  covered the bottom two thirds. `captionPlacement` now picks the edge that leaves more of the
  anchor visible, and `spotlightScrollDelta` scrolls the anchor's own scroll container so it lands
  in the free band, clipped to that container (Home scrolls inside `main.page-shell`, 87–337 px).
  The alignment runs once the anchor has landed and twice more at 450 and 900 ms, with the edge
  held, because opening a Home section animates its height.
- The caption carries the title with an `n/m` counter beside it and a two-line body; every body is
  at most 64 characters and every title at most 20 (`tourCaptionBudget.test.ts`).
- The idle timer is gone. The caption folds only when asked (Up/Down or `tour-toggle-text`) and
  stays folded until asked again.
- Held keys act once. OK presses the focused tour button. Focus moves to Next on open and back on
  close. `#root` is `inert` as well as `aria-hidden` while the tour is open.
- Anchors point at page content. The Radio step's body depends on whether HVSC is installed. A
  step whose anchor never appears on a connected device says why (Live View on a U2).
- The scrim is `bg-background/60`.

### FI-12: compact bottom sheets

Compact sheets added both insets to their padding and were also positioned above the navigation
bar, with `max-h-[100dvh]`. A full-height bottom sheet therefore started 48 px above the screen.
Standard sheets had been fixed for the double padding in `0c3e6b4a4`; compact had not. The compact
usability audit emulated the status bar only, which is why it passed. It now emulates the
navigation bar too, and `compactSheetInsets.spec.ts` measures SID Radio against both bars.

### FI-15 and FI-23: Remote Input and Game Mode on the compact screen

Outside Game Mode the size stepper and the movement style fold behind **Options**, and Listen /
Watch scroll below the joystick. In Game Mode the sheet kept `5rem` below its controls on top of
the navigation bar's inset (`9efdaf22b` kept it "for its edge-anchored controls", which the action
zone already reserves room for), the port switch took a row, and the L-size controls reserved the
rest. Measured with Boulder Dash running: picture 0 px before; 95 px with the joystick shown after;
279 px once a physical key steered and Auto hid the joystick. C64U Remote, whose default hides the
joystick, went straight to a full-screen picture on `0`.

### FI-24: the U2 badge after a device switch

`useDeviceConfigOptionDomains` asks for the category list first and skips categories a device does
not list. During the switch that list read failed with "Device not ready for requests", so the hook
read each of Home's twelve U64 items from the cartridge, without declaring a 404 as expected. Each
404 was logged as an error and counted on the badge. The reads now pass `__c64uExpectedMissing`,
as `getConfigItems` already does. A cold launch against the U2 never showed it, because the first
visit had recorded the twelve items as absent for that device.

### FI-26: HIL harnesses

`tools/hil/droidctl_device.mjs` runs droidctl in process and is the only way the harnesses reach
the phone. It picks an explicit serial, else the only physical device, else the only `9B0` Pixel,
and refuses anything ambiguous. `release_sweep_hil.mjs` requires `--hosts` and visits Docs.

## Journeys

PASS means the newcomer outcome was reached on the device by keys alone unless the row says
otherwise. Timings are wall-clock on the Pixel.

| Journey | Edition / device | Result | Notes |
| --- | --- | --- | --- |
| First minute, reachable device | Commander / c64u | PASS | Seeded debug device; tour offered ~6 s after launch, focus on Next |
| First minute, offline | Commander / none | PASS after FI-13 | Demo Mode offer, Down Down OK continues, tour follows |
| First minute, discovery with no saved device | Commander | See below | Needs a non-seeded build; LAN discovery would probe the u64 |
| Tour, all 13 steps, keys only | Commander, Remote / c64u | PASS | Geometry tables above; light theme, landscape and font scale 1.3 checked |
| First SID song from a fresh install | Commander / c64u | PASS | Radio → Install HVSC → ready in 71 s (80 MB at 13–14 MB/s, then indexing) → Open SID Radio → Chill / Ambient: first tune after ~2.5 s, +11.8 dB in 300–6000 Hz against stopped |
| Change a setting | Commander / c64u | PASS | 7, "led", Enter, OK, Down, OK: LedStrip Mode Rainbow → Rainbow Sparkle, read back over REST, kept after leaving and returning, restored |
| Play remotely | Commander / c64u | PASS after FI-20..23 | Boulder Dash from `/USB2/Games` by keys, loaded from drive A, Game Mode picture live at PAL 45–50 fps; joystick response is asserted at the CIA by the gate's `input` stage |
| Play remotely | Remote / c64u | PASS | `0` from Home: full-screen picture, joystick hidden |
| Device switch c64u → u2 → c64u | Commander | PASS after FI-24 | U2: Live tile disabled "No streaming", Game opens Remote Input with the machine:input explanation, no `/v1/streams` or `machine:input` requests, badge healthy |
| Enjoy music, clear while a station runs | Commander / c64u | PASS after FI-25 | |
| u64 rows | — | Blocked | The u64 was taken for Software IEC work by another session during this sweep |

## Revert checks

Every regression test named in the commits was run against the production code with the fix
reverted and failed there, then passed with the fix restored. The tour's 12 new driver tests and
both new Playwright tour tests were run against `main`'s tour implementation.
