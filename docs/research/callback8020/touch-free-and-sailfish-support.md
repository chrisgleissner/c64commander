# Touch-free (keypad) operation and Sailfish OS support

This document explains how C64 Commander supports **devices that have no usable
touchscreen** and how it supports **Sailfish OS** (Android apps running through
Sailfish's Android AppSupport). It is written for the keypad-first **Commodore
Callback 8020** and similar Sailfish devices, but the mechanisms apply to any
hardware-key-driven Android target.

The focused, Android-only **C64U Remote** variant is the build intended for these
devices. C64 Commander (the full variant) shares the same input and compatibility
foundations described here.

> Honesty note on status: the constraints below are **designed for, and where
> possible validated on Linux and a real de-Googled (no-Google-services) Android
> device**. They have **not** been validated on real Sailfish AppSupport or
> Callback 8020 hardware (the device is pre-release). Claims are kept at
> "designed for / validated against constraints"; see
> [Remaining risks](#3-remaining-risks-and-issues) and the deeper
> [compatibility review](sailfish-callback-8020-android-compatibility.md).

---

## 1. Operating without a touchscreen

The Callback 8020 ships with the touchscreen **disabled by default** and is driven
by a physical T9-style keypad. The app must therefore be fully operable with
hardware keys alone, and no text field may depend on the on-screen keyboard. This
is handled by a dedicated, centralized input subsystem rather than ad-hoc key
handlers scattered across the UI.

### 1.1 Semantic input subsystem (`src/lib/input/`)

Raw browser/Android key events are normalized **once** into a small set of
**semantic actions** (`digit0`–`digit9`, `star`, `hash`, `dpadUp/Down/Left/Right`,
`center`, `softLeft/Right`, `back`, `delete`, `enter`, `escape`, `nextField`,
`previousField`, `activate`, `openMenu`, `closeMenu`, `toggleInputMode`). UI code
consumes semantic actions, never raw key codes.

The physical-key → semantic-action mapping lives in **data-driven keymaps** and
**profiles**, colocated with the composer:

- `defaultKeyboard` — a desktop/developer profile so the entire keypad UX can be
  exercised on a normal keyboard (arrows → d-pad, Enter → activate, Tab →
  next field, digits, `*`/`#`, etc.).
- `commodoreCallback8020` — the keypad profile for the target device.

Profiles are selectable via `resolveInputProfile(id)`. Auto-detection is
unreliable inside AppSupport, so an explicit settings/developer override is the
intended selection mechanism.

### 1.2 T9 text entry — no on-screen keyboard required

Text fields accept physical T9 input through a pure, timer-free composer
(`src/lib/input/t9.ts`) bridged into React inputs by `useT9Input`
(`src/hooks/useT9Input.ts`). Two modes:

- **General text (multi-tap):** the standard T9 table (`2`→a/b/c/2, `7`→p/q/r/s/7,
  `0`→space/0, `1`→punctuation, …); repeated presses of the same key cycle
  candidates; a different key (or a pause) commits.
- **Hostname / IP mode (optimized for connection setup):** number keys insert
  digits directly, and `star` multi-taps the separators `.` `:` `-` `_` `/`. This
  makes device addresses fast to enter, e.g. (`★` = star):

  | Target | Keystrokes |
  | --- | --- |
  | `192.168.1.13` | `1 9 2 ★ 1 6 8 ★ 1 ★ 1 3` |
  | `192.168.1.13:8080` | …`1 3` then `★★` (→ `:`) then `8 0 8 0` |
  | `c64u` | multitap: `2·3`(c) `6·4`(6) `4·4`(4) `8·2`(u) |
  | `c64u.local` | `c64u` then `1·1`(.) `5·3`(l) `6·3`(o) `2·3`(c) `2·1`(a) `5·3`(l) |

It is wired into the device **name** field (multi-tap) and the device **host/IP**
field (hostname mode) of the connection editor, so a device address can be entered
on the keypad with no soft keyboard. Full mapping: [`keymap.md`](keymap.md).

### 1.3 Hardware-key navigation and CTAs

The app uses standard focusable controls (native buttons, Radix components), which
are reachable by `nextField`/`previousField` (Tab / d-pad) and activatable by
`center`/`enter`. `back` has deterministic behaviour (close dialog → leave menu →
leave field → navigate back). A DOM-free `FocusController`
(`src/lib/input/focusController.ts`) provides deterministic, wrap-around,
skip-disabled traversal for keypad-only contexts that need explicit ordering.

**Validated:** keypad-only operability (d-pad navigation reaching focusable
elements, no taps) was confirmed on a physical device via
`scripts/android-keypad-smoke.sh`. Exhaustive per-CTA registration through the
`FocusController` is incremental and tracked as a follow-up.

### 1.4 Using it

- Build the focused device build: `npm run android:apk:all` produces the **C64U
  Remote** APK (`uk.gleissner.c64uremote`).
- On a desktop/emulator, the `defaultKeyboard` profile lets you drive everything
  from a normal keyboard.
- Drive a real device with hardware keys via `adb shell input keyevent` — keycode
  table and a one-command smoke test are in
  [`sailfish-callback-8020-emulation.md`](sailfish-callback-8020-emulation.md).

---

## 2. Sailfish OS support

Sailfish OS runs Android apps through **AppSupport**, an AOSP-derived Android
adapted to run in an LXC container that shares the host kernel — **not** stock
Android, and **without Google services**. The app is built to the constraints this
imposes.

### 2.1 How the app meets the AppSupport constraints

| AppSupport constraint | How the app addresses it |
| --- | --- |
| **No Google Play Services** (microG only, opt-in) | The app has **zero** GMS/Firebase/FCM/Maps/Play dependency (audited in Gradle, manifest, Capacitor plugins, and JS deps). A static gate (`npm run apk:no-gms`) fails the build on any required GMS `uses-library`/`uses-feature`. Verified building + launching on a de-Googled device with 0 GMS packages. |
| **No Google Play Store** (sideload / Aurora / F-Droid) | Standard installable debug APK plus a signable release APK/AAB; no Play-only APIs (no in-app updates, no Play Integrity). |
| **Touchscreen off by default; keypad-first** | The full keypad / T9 input subsystem in §1; no touch-only or soft-keyboard-only path for core operation. |
| **Background services restricted** | C64U Remote disables background execution entirely; its APK therefore declares **only the `INTERNET` permission** (the foreground-service and wake-lock permissions are stripped via a variant-specific manifest). |
| **Local, cleartext device access** | `usesCleartextTraffic="true"` + a network-security config permit `http://<device-ip>`; **raw IPv4 entry is first-class** and the T9 hostname mode is optimized for it, so the app does not depend on mDNS/`.local` name resolution (which is unreliable in a container). No internet is required for core function — C64U Remote declares only the local `device_host` endpoint. |
| **Small screen (3.25", 480×640)** | Responsive display profiles with fluid widths on the smallest screens; verified with no horizontal overflow at 480×640 and 320×480 in a real browser. |
| **WebView via AppSupport** | Capacitor WebView app using a conservative, broadly-supported feature set; CapacitorHttp bypasses CORS for local device REST. |

### 2.2 The C64U Remote variant

`C64U Remote` (`uk.gleissner.c64uremote`) is the **Android-only**, focused build
for these devices. It excludes internet-content integrations (HVSC, CommoServe),
experimental/immature features (lighting studio, RAM/REU snapshots, the
Telnet-dependent Home actions), and background execution — these are removed from
navigation, Home, dialogs, **and Settings**, and cannot be re-enabled by a user
override or stale local storage. It produces no iOS or web artifacts. Full design:
the [compatibility review](sailfish-callback-8020-android-compatibility.md).

### 2.3 Installing on a Sailfish device

1. Ensure **AppSupport** is installed, licensed, and enabled (Jolla Store).
2. Allow sideloading if needed: **Settings ▸ System ▸ Untrusted software ▸ Allow
   untrusted software**, then install the APK; or use **Aurora Store** / **F-Droid**
   (both work without Google services).
3. Optional: enable **microG** (Settings ▸ Android AppSupport) — not required by
   this app.

> The Callback 8020 reportedly adds a "patent-pending" restriction on installing
> browser/social apps; the exact sideload policy for arbitrary apps on that device
> is **undisclosed** and is an on-device item (see below).

### 2.4 Testing against a Sailfish-like environment

No real Sailfish device is required to exercise the testable constraints. See
[`sailfish-callback-8020-emulation.md`](sailfish-callback-8020-emulation.md)
for a three-layer approach: host-only checks (jsdom + real-browser layout +
no-GMS), an **AOSP no-GMS, 480×640, touch-disabled emulator**
(`scripts/sailfish-callback-emulator.sh`), and **Waydroid VANILLA** — the closest
analog to AppSupport (also an LXC, no-Google Android sharing the host kernel).

---

## 3. Remaining risks and issues

Kept conservative and solution-oriented. The genuinely open items can only be
*confirmed* on real Sailfish AppSupport / Callback 8020 hardware; each already has
a mitigation in place and a concrete step to close it.

| Area | Status | Mitigation in place | Step to fully close |
| --- | --- | --- | --- |
| AppSupport **WebView** version/behaviour | Open (device-gated) | Conservative WebView feature set; app launches, renders, and runs on a real de-Googled Android WebView | Run the install + render + one-REST-call smoke on AppSupport (or Waydroid VANILLA) |
| **Cleartext / LAN / mDNS** inside the AppSupport container | Open (device-gated) | Cleartext permitted; **raw-IPv4 first-class**, no reliance on mDNS/`.local` | Confirm a live cleartext REST call to the device from AppSupport/Waydroid |
| **Sideload / install policy** on the Callback 8020 | Open (vendor-undisclosed) | Standard installable + signable APK/AAB; no Play-only requirements | Confirm the install channel (sideload / Aurora / F-Droid / store) when the device ships |
| `targetSdk 35` vs AppSupport API (≤ 33) | Low (behavioural, not install-blocking) | App runs on a higher API (36) already; mock emulator targets API 33 | Spot-check behaviour on an API-33 AOSP image / AppSupport |
| **Physical-keypad T9** key codes on the real device | Low | `commodoreCallback8020` profile + composer tests + adb keypad smoke; mapping is data-driven and easy to tune | Capture real key events on the device and adjust the profile if needed |
| Exhaustive per-CTA keypad registration | Low (enhancement) | Native focus + default keymap already make controls keyboard-operable; `FocusController` available | Register remaining primary CTAs explicitly where deterministic ordering helps |

Resolved during this work (no longer risks): unused foreground-service/wake-lock
permissions in C64U Remote (now INTERNET-only), small-screen horizontal overflow
(no overflow at 480×640 / 320×480), and no-Google-services dependency (statically
gated and validated on a no-GMS device).

---

## See also

- [Sailfish OS / Callback 8020 Android compatibility review](sailfish-callback-8020-android-compatibility.md) — deep audit, feature inventory, and full risk table.
- [Sailfish-like emulation & testing](sailfish-callback-8020-emulation.md) — Waydroid, AOSP no-GMS emulator, keypad smoke, no-GMS checks.
- [Keymap reference](keymap.md) — semantic actions, the T9 tables, and the input profiles.
