# Testing against a Sailfish-OS-/Callback-8020-like environment on Linux

No Commodore Callback 8020 hardware and no Sailfish OS AppSupport environment are
available to this project, and the device is pre-release. This guide describes
the **closest reproducible substitutes on a Linux host** and the tooling added to
this repo to exercise them. Anything not run on a real Sailfish/Callback device
is an **on-device validation item** (see
[`sailfish-callback-8020-android-compatibility.md`](sailfish-callback-8020-android-compatibility.md)).

Sailfish AppSupport is an **LXC container running an AOSP-derived Android that
shares the host kernel, with no Google Play Services**, each app shown as a
Wayland surface, on a **keypad-first, touch-disabled-by-default** device with a
**3.25" / 480×640** screen. We reproduce the properties that affect this app —
no GMS, tiny screen, keypad-only, cleartext LAN — at three layers.

## Layer 1 (fast, every PR): host-only

- **jsdom display-profile contract** — `tests/unit/lib/smallScreenLayout.test.ts`
  asserts 480×640 / 640×480 / 360×480 / 320×480 select the right profile and that
  the compact profile uses fluid, non-overflowing widths.
- **Real-browser overflow** — `playwright/callbackSmallScreen.spec.ts` asserts no
  horizontal overflow at **480×640** and **320×480** across every primary route
  (complements `playwright/layoutOverflow.spec.ts`, which covers the
  compact/medium/expanded display profiles). Run:
  ```bash
  npx playwright test playwright/callbackSmallScreen.spec.ts --project=android-phone
  ```
- **No-GMS static gate** — `npm run apk:no-gms -- <apk>` (and the
  `--verify-metadata` path of `android:apk:all`) parse `aapt2 dump badging` and
  fail if the APK declares a *required* `uses-library`/`uses-feature` for
  `com.google.android.gms` / Firebase / Maps. Unit-tested in
  `tests/unit/scripts/verifyApkNoGms.test.ts`.

## Layer 2 (CI/nightly): AOSP no-GMS emulator

`scripts/sailfish-callback-emulator.sh` creates an emulator configured for the
Callback's constraints:

- **AOSP `default` system image** (no Google services), default **API 33**
  (Android 13 = the newest Sailfish OS 5.0 "Tampella" AppSupport level),
- **480×640 @ 240 dpi** (~3.25"), 4 GB RAM,
- `hw.touchScreen=no`, `hw.dPad=yes`, `hw.keyboard=yes`, `hw.mainKeys=yes` to model
  the keypad-first / touch-disabled device.

```bash
scripts/sailfish-callback-emulator.sh create     # installs the AOSP image if needed, applies the profile
scripts/sailfish-callback-emulator.sh start      # headless, software rendering (no /dev/kvm needed; slow cold boot)
npm run android:apk:all                          # build both APKs
scripts/android-keypad-smoke.sh <emulator-serial> artifacts/android-apks/c64u-remote-*.apk uk.gleissner.c64uremote
scripts/sailfish-callback-emulator.sh stop
```

Config is overridable via env (`CALLBACK_API_LEVEL`, `CALLBACK_SCREEN_W/H`,
`CALLBACK_DENSITY`, `CALLBACK_IMAGE_TYPE`, …); `… config` prints the resolved
profile. Without `/dev/kvm` the emulator runs under SwiftShader (CPU) and cold
boots take minutes — budget generous timeouts in CI.

### Keypad-only / touch-free smoke (`scripts/android-keypad-smoke.sh`)

Runs the same checks on **any** adb target (the emulator above **or** a physical
de-Googled device such as the Pixel 4): (1) no hard GMS dependency, (2) install +
launch to a RESUMED activity, (3) drive the app with **hardware keys only** (no
taps) and confirm a focusable element, (4) no GMS/fatal logcat errors; it saves a
screenshot. Relevant `adb shell input keyevent` codes:

| Action | code | Action | code | Action | code |
| --- | --- | --- | --- | --- | --- |
| DPAD_UP | 19 | DPAD_DOWN | 20 | DPAD_LEFT | 21 |
| DPAD_RIGHT | 22 | DPAD_CENTER | 23 | BACK | 4 |
| 0 | 7 | 1–9 | 8–16 | STAR `*` | 17 |
| POUND `#` | 18 | DEL | 67 | ENTER | 66 |

(`adb shell input text "a%sb"` types text with `%s` = space.) These drive the T9
hostname/IP entry without the on-screen keyboard.

## Layer 3 (deepest analog): Waydroid + the physical Pixel 4

**Waydroid** is the closest functional analog to Sailfish AppSupport: also an
**LXC container sharing the host kernel**, AOSP-based, each app a Wayland surface.
With the **VANILLA** image it has **no Google services** — matching Sailfish.

A self-contained harness automates this: **`scripts/waydroid-smoke.sh`** (and
`npm run test:waydroid:preflight` / `npm run test:waydroid`). It brings up a
headless compositor, starts the Waydroid session, `adb`-connects to the
container, and runs the keypad/no-GMS smoke against the C64U Remote APK.

```bash
scripts/waydroid-smoke.sh preflight     # report prerequisites (never fails the build)
sudo scripts/waydroid-smoke.sh setup    # one-time: load binder, install waydroid + a compositor,
                                         #           `waydroid init -s VANILLA`, start the container
scripts/waydroid-smoke.sh run           # start session + adb-connect + smoke C64U Remote
scripts/waydroid-smoke.sh teardown
```

It is deliberately **easy to disable** if it proves unstable: set
`WAYDROID_SMOKE_DISABLE=1` (every subcommand then exits 0), and the CI job
([`.github/workflows/waydroid-smoke.yaml`](../../../.github/workflows/waydroid-smoke.yaml))
is **opt-in** (`workflow_dispatch` + a weekly schedule) and `continue-on-error`,
so it never blocks the main pipeline — delete that one file to retire it entirely.

**Headless compositor:** the harness uses `weston --backend=headless` when
present, otherwise falls back to **`kwin_wayland --virtual`** (KDE, offscreen
framebuffer) under `dbus-run-session` — so no full desktop session is required.

Requirements: kernel **binder** (`/dev/binder*`; mainline 6.x ships the
`binder_linux` module — `sudo modprobe binder_linux`), a Wayland compositor
(weston or kwin_wayland), and root to install Waydroid and start the container.
**Caveats:** mDNS/`.local` does not resolve through the container bridge (use a
raw IP); ARM-only APKs need native-bridge translation on x86 (our debug APK ships
an x86_64 ABI, so it installs natively); headless is community-tier. Waydroid does
**not** reproduce the Callback's API level, its T9 IME, or Jolla host integration
— treat a pass as indicative, not device-validated.

**Physical Pixel 4 (de-Googled, no GMS)** — the most realistic check available
here for cleartext-LAN + keypad-only behaviour on a real, Google-less Android.
Used for the device validation recorded in the compatibility doc.

## Local networking / cleartext

The app uses `http://<device-ip>` on the LAN; `usesCleartextTraffic="true"` +
`res/xml/network_security_config.xml` permit it. From an **emulator** reach a host
mock server via the special loopback alias **`10.0.2.2`** (or `adb reverse`); from
**Waydroid/Pixel 4** use the host's real LAN IP. **Do not rely on mDNS/`.local`
discovery** in any container — keep the manual raw-IP entry path (the T9 hostname
mode is optimized for it).

## What this does and does not prove

These layers validate **no-GMS install/launch/run, small-screen layout,
keypad-only operability, cleartext LAN, and minimal permissions** on Linux. They
do **not** prove behaviour on Sailfish AppSupport's exact WebView, container
networking, lifecycle, or the Callback's locked-down launcher / sideload policy.
Those remain on-device validation items until real Sailfish/Callback hardware is
available.
