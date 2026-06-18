# Sailfish OS / Commodore Callback 8020 Android compatibility review

Status: **designed for / validated against Callback 8020 constraints**, with the
testable constraints **validated on a real de-Googled (no-GMS) Android device and
on Linux**. No Callback 8020 hardware and no Sailfish OS AppSupport environment
were available, so nothing here is "validated on real Sailfish/Callback hardware".
Where a claim could only be confirmed on a real Sailfish/Callback device it is
marked as an on-device validation item.

**What was actually validated (this work):** both APKs build and pass metadata +
no-GMS checks; the C64U Remote APK installs, launches, and runs on a **physical
Pixel 4 running a de-Googled Android (no Google Play Services, GMS package count
0)**; both variants coexist (distinct application ids); the app is operable with
**hardware keys only** (d-pad focus navigation); C64U Remote's pruned features are
absent from Home and Settings on-device; the C64U Remote APK ships **only the
INTERNET permission**; and the layout has **no horizontal overflow at 480×640 or
320×480** in a real browser. Reproducible Sailfish-like test tooling is in
[`sailfish-callback-8020-emulation.md`](sailfish-callback-8020-emulation.md).

This document covers (1) the compatibility review of the existing C64 Commander
Capacitor app against Sailfish AppSupport + Callback 8020 constraints, and (2)
the new Android-only **C64U Remote** variant introduced to be a focused, stable,
keypad-operable remote for the Commodore 64 Ultimate / C64U on that device.

---

## 1. Current public source summary (mid-2026)

Researched from GSMArena, Tom's Hardware, TechSpot, heise, Jolla/Sailfish OS
docs, Wikipedia, and the GNOME "dive into Jolla AppSupport" write-up.

**Commodore Callback 8020** — announced by Commodore International Corporation
(2025 brand revival, led by Christian Simpson / "Peri Fractic"). Pre-orders open
2026-06-30 (US$499.99+), shipping targeted Q4 2026. **Not yet shipping; specs
are vendor-stated.**

- Flip phone. **Internal display 3.25", 480×640**; separate 1.77" cover display
  (not an app surface). (Brief baseline said "640×480" — same panel, portrait.)
- **Jolla Sailfish OS + Android AppSupport** (compatibility layer, *not* stock
  Android). Claims "99% of Android apps".
- **No Google Play / no Google services** (except a Maps exception). Browsers and
  social apps blocked at the system level ("patent-pending" + DNS blocking);
  mechanism undisclosed → the **sideload/install path for an arbitrary APK on the
  8020 is unconfirmed**.
- MediaTek Helio G81, 4 GB RAM, 64 GB + microSD (32 GB bundled), 1,550 mAh
  removable battery, 48 MP rear cam, 3.5 mm jack, FM radio, USB-C, **4G LTE (no
  5G)**. Dual-SIM and "VoLTE" are single-source / unconfirmed.
- **Keypad-first, T9-style texting** as deliberate "mindful friction".
  **Touchscreen is disabled by default**; the panel supports touch and apps can
  enable it individually.

**Sailfish OS Android AppSupport** (Jolla) — mature, proprietary compatibility
layer (LXC container since AppSupport 8.1; near-native, not emulation). Must be
licensed/installed/enabled from the Jolla Store.

- Android level **varies by device**; newest (Jolla C2 / Sailfish 5.0
  "Tampella", Feb 2025) = **Android 13 / API 33**. The Callback's AppSupport API
  level is **undocumented/unknown**.
- **No Google Play Services**; microG is opt-in (Settings → Android AppSupport →
  "Allow running microG services"). FCM/Play Integrity/Maps SDK/Play billing/GMS
  location do not work without microG (which covers only a subset).
- APKs install via **Aurora Store, F-Droid, or manual sideload** (Settings →
  System → Untrusted software). Arbitrary APKs are supported but "not guaranteed
  to work"; apps needing an SDK level above the device's AppSupport level may be
  incompatible.
- **WebView** present (AOSP-derived) but **version not separately documented** —
  bounded by the device Android level. **On-device validation item.**
- **Background services restricted/configurable**; weaker than stock Android.
- **Cleartext / localhost loopback / mDNS / `.local` behaviour inside the
  container is not documented → UNKNOWN. On-device validation item.**
- Android apps must install to internal storage; lifecycle differs (Wayland
  windows, DBus notifications, MPRIS media, Wayland text-input).

---

## 2. Device + AppSupport assumptions used in this work

1. AppSupport on the Callback is in the Android 10–13 range; our `minSdk 22` /
   `targetSdk 35` app is within the installable range (`minSdk ≤ device level`).
   `targetSdk 35 > 33` is generally tolerated by AppSupport (targetSdk gates
   behaviour, not installability) but is an on-device validation item.
2. No Google Play Services. The app must run with zero GMS dependency.
3. Touch may be off by default; the app must be fully operable from the physical
   keypad and must not *require* touch or the on-screen keyboard.
4. Local network HTTP to the C64U/Ultimate device must work over cleartext, by
   raw IPv4 first (hostname/mDNS resolution inside AppSupport is unproven).
5. The install path for an unsigned/unknown APK on the 8020 is unconfirmed; we
   produce a normal debug + signable release APK and document that the *install
   channel* (Aurora/F-Droid/sideload/Jolla-certified store) is out of our control.

---

## 3. Feature maturity inventory

Classification of every feature flag / Home surface, from code + the registry
(`src/lib/config/feature-flags.yaml`) + the routing/feature-flag map. C64U Remote
includes `stable-core` only; everything else is excluded by the variant's flag
overlay.

| Feature / flag | Surface | Base default | Maturity | In C64U Remote? |
| --- | --- | --- | --- | --- |
| Core device control (connect, play/pause/stop, reboot, menu, config browse, drives view, system info, audio mixer) | Home / Play / Disks / Config tabs | always on (not flag-gated) | **stable-core** | ✅ included |
| `hvsc_enabled` (HVSC downloads) | Play › Add Items | on | unrelated (internet content) | ❌ excluded |
| `commoserve_enabled` (CommoServe) | Play › Add Items | on | unrelated (internet content) | ❌ excluded |
| `demo_mode_enabled` (simulated device) | Settings / connect | off | stable-supporting, not needed | ❌ excluded |
| `background_execution_enabled` | Play (native FGS scheduling) | on, dev-only | immature for AppSupport (background restricted) | ❌ excluded |
| `lighting_studio_enabled` | Home/Disks/Play/Config | off, dev-only | immature/experimental | ❌ excluded |
| `ram_snapshots_enabled` | Home (Save/Load RAM) | off | immature/experimental | ❌ excluded |
| `home_telnet_reu_snapshot_enabled` | Home (REU save/restore) | off, dev-only | immature (fragile Telnet) | ❌ excluded |
| `home_telnet_config_actions_enabled` | Home (file save/load, Clear Flash) | off | immature (fragile Telnet) | ❌ excluded |
| `home_telnet_drive_actions_enabled` | Home (drive reset, Soft IEC, Drive B) | off | immature (fragile Telnet) | ❌ excluded |
| `home_telnet_printer_actions_enabled` | Home (printer on/flush/reset) | off | immature (fragile Telnet) | ❌ excluded |
| `home_telnet_power_cycle_enabled` | Home (power cycle) | off | immature (fragile Telnet) | ❌ excluded |
| `home_telnet_clear_ram_reboot_enabled` | Home (Reboot Clr Mem) | off | immature (fragile Telnet) | ❌ excluded |

**Why flag overrides are sufficient (no separate route guard needed):** none of
the excluded features owns a whole tab route — they are all rendered conditionally
behind `useFeatureFlag(...)` reads in their host components. Disabling the flag in
the variant overlay removes the feature from navigation, Home cards, action
panels, dialogs, and Settings simultaneously. See §8.

---

## 4. Dependency audit

- **Capacitor 6.2.1** (`@capacitor/{core,android,ios,cli}`), plugins
  `@capacitor/app`, `@capacitor/filesystem`, `@capacitor/share`. None pull Google
  Play Services. `CapacitorHttp` is enabled (native HTTP client) to bypass CORS
  for local device REST; `CapacitorCookies` is disabled.
- JS deps are UI/runtime libraries (React 18, Radix UI, TanStack Query, zod,
  framer-motion, fflate/7z-wasm for archives, etc.). **No** Firebase/FCM, Google
  Sign-In, Maps, Play Integrity, billing, or in-app-update SDKs anywhere in
  `package.json`, the Capacitor config, or the Android project.
- Android: `android/variables.gradle` → `minSdk 22`, `compile/targetSdk 35`;
  Java 17. `android/app/build.gradle` adds `org.tukaani:xz` and
  `org.apache.commons:commons-compress` plus an upstream 7-Zip native lib — local
  archive handling, no network/Google dependency.

## 5. Google services audit

**Result: clean.** No GMS/Firebase/FCM/Play-anything in manifest, Gradle,
Capacitor plugins, JS packages, or native code. `AndroidManifest.xml` declares
only `INTERNET`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`,
`WAKE_LOCK`, a `FileProvider`, and a single `BackgroundExecutionService`
(media-playback FGS). The app already installs and runs without Google Play /
Google Play Services, which is the core Callback/AppSupport requirement.

For **C64U Remote** specifically, `background_execution_enabled` is off, so the
foreground service and `WAKE_LOCK`/FGS permissions are unused at runtime. They
remain declared in the shared manifest (Android variant flavors are not used);
this is harmless (an unused permission), and noted as a residual risk.

## 6. WebView + Capacitor risk assessment

- The app is a Capacitor WebView app; it depends on the Android System WebView
  present in AppSupport. **The WebView version on the Callback is unknown.** The
  app targets a Baseline-ish browser feature set (React 18, no bleeding-edge
  APIs) and ships `caniuse`/`baseline-browser-mapping`-aware tooling, but a
  recent-Chromium assumption can't be confirmed without the device.
- Callback's "browser blocking" targets standalone browser/social apps and
  DNS-level web access; it should not affect an app's embedded WebView, but this
  is **unconfirmed** (mechanism undisclosed).
- `server.androidScheme: "http"` + `CapacitorHttp` native client are load-bearing
  for local device REST (CORS bypass), and do not depend on Google or a browser.
- **Severity: high, likelihood: medium** — bucketed as an on-device smoke-test
  item (load app, render Home, issue one REST call to the device). A manual
  checklist is in §11.

## 7. Networking + cleartext HTTP assessment

- `android/app/src/main/res/xml/network_security_config.xml` permits cleartext
  globally (`base-config cleartextTrafficPermitted="true"`) plus named
  domain-configs; `AndroidManifest` sets `usesCleartextTraffic="true"`. Local
  `http://<device-ip>` works on stock Android today (verified historically on a
  Pixel 4 against a u64). **Whether AppSupport honours the same cleartext policy
  and allows LAN access is an on-device validation item.**
- **Raw IPv4 is first-class** for C64U Remote: the host field accepts a raw IP,
  and the new T9 hostname mode is optimized for fast IPv4 entry (see §10). DNS /
  mDNS / `.local` resolution inside AppSupport is unproven, so users should be
  able to type the device IP directly without relying on name resolution.
- C64U Remote needs **no internet** for core functionality — its
  `runtime.endpoints` declares only `device_host: c64u` (the HVSC/CommoServe
  internet endpoints are omitted from the variant entirely).
- Request timeouts/serialization and C64U fragility under concurrent REST are
  handled by the existing device client (shared with C64 Commander).

## 8. Variant + feature-gating design

- A variant may now declare **only `platform.android`** (no `ios`, no `web`):
  `scripts/generate-variant.mjs` makes those blocks optional and adds a
  platform-independent resolved `theme` (`themeColor`/`backgroundColor`). For
  web-capable variants the theme still derives from `platform.web` so existing
  output is byte-identical; an Android-only variant supplies an explicit
  `theme:` block. The generator emits web artifacts (PWA manifest, service
  worker, web-server module, favicons) only for web-capable variants and iOS
  artifacts only for iOS-capable variants; the runtime config, `index.html`
  (Vite entry), and Android resources are always emitted.
- `capacitor.config.ts` falls back to the Android application id when there is no
  iOS block. The single app-runtime read of `platform.web` (the launch screen
  background) now reads the resolved `variant.theme`.
- **C64U Remote** (`variants/variants.yaml`): `display_name: C64U Remote`,
  `app_id: c64u-remote`, Android `application_id`/`custom_url_scheme:
  uk.gleissner.c64uremote`, `exported_file_basename: c64u-remote`, theme
  `#2F6B8B`, assets under `variants/assets/c64u-remote/`. No iOS/web blocks.
- **Feature pruning** (`variants/feature-flags/c64u-remote.yaml`): every one of
  the 12 flags is set to `{enabled: false, visible_to_user: false}`. The variant
  overlay is merged into the feature definition at build time (baked into
  `src/generated/variant.ts`), *before* any runtime/user override; a flag with
  `visible_to_user: false` is hidden from Settings and is non-editable, so a
  persisted user override / stale local storage **cannot re-enable it**. C64U
  Remote also uses a distinct app id → a separate storage sandbox, so no
  `c64u-controller` (or `c64commander`) state can leak in.
- `repo.publish_defaults.release` and `.ci` now list **both** `c64commander` and
  `c64u-remote`; the default variant remains `c64commander`.

## 9. Build + CI design

- The Android Gradle build already injects `applicationId` and the APK basename
  from `src/generated/variant.json` (`exportedFileBasename`), so each variant's
  APK is deterministically named `"<basename>-<version>[-debug].apk"`.
- New `scripts/build-android-apks.mjs` (`npm run android:apk:all`) builds the
  debug APK for **every** published variant in one run and copies each into
  `artifacts/android-apks/` (the shared Gradle output dir is cleaned between
  variant builds, so collection makes both persist). It logs which variant
  produced which APK and can `--verify-metadata`.
- New `scripts/verify-apk-metadata.mjs` (`npm run apk:metadata`) runs
  `aapt2/aapt dump badging` and asserts the application id + user-visible label.
- CI (`.github/workflows/android.yaml`): the `android-packaging` job already fans
  out over `publish_variants_json` (now both variants). Added steps: **verify APK
  metadata (debug)** and **upload APK artifact (debug)** per variant, so both
  variants' APKs are retained from every Android run (release APK/AAB upload on
  tags is unchanged). `npm run lint` now also runs `lint:stale-names`.

## 10. Physical keypad + T9 input design

New subsystem under `src/lib/input/` (pure, dependency-free, unit-tested):

- `keyEvent.ts` — normalizes browser/Android `KeyboardEvent` (`key`/`code`/
  `keyCode`, `Dpad*`, `Digit*`/`Numpad*`, soft keys, Tab/Backspace/Enter/Escape)
  into a **semantic action** (`digit0..9`, `star`, `hash`, `dpad*`, `center`,
  `softLeft/Right`, `back`, `delete`, `enter`, `escape`, `nextField`,
  `previousField`, `activate`, `openMenu`, `closeMenu`, `toggleInputMode`).
- `keymap.ts` + `profiles/` — the **colocated**, data-driven physical-key →
  semantic-action mapping. Two profiles: `defaultKeyboard` (desktop/dev) and
  `commodoreCallback8020` (keypad); selectable via `resolveInputProfile` (an
  explicit override is provided because auto-detection is unreliable in
  AppSupport).
- `t9.ts` — a pure, timer-free T9 composer (the caller supplies `now`, so
  multi-tap-vs-new-character is decided by elapsed time without timers). Standard
  multi-tap table; a **hostname mode** where digits insert directly and `star`
  multi-taps separators (`.` `:` `-` `_` `/`).
- `focusController.ts` — DOM-free ordered registry for keyboard-only CTA
  traversal/activation (next/previous with wrap, skip-disabled, `activate`).

Component wiring: `src/hooks/useT9Input.ts` bridges the composer onto any
controlled input; `SavedDeviceEditorFields` (device name + host/IP) uses it
(host = hostname mode, name = multi-tap). It intercepts digit/star/hash and
leaves Backspace/arrows/Enter/Tab native (the adapter is append-oriented and
doesn't track the DOM caret), so it is a non-intrusive fallback.

**Exact keystrokes (proven in tests):**

- `192.168.1.13` — hostname mode: `1 9 2 ★ 1 6 8 ★ 1 ★ 1 3` (★ = star → `.`).
- `192.168.1.13:8080` — …`1 3` then `★★` (two stars → `:`) then `8 0 8 0`.
- `c64u` — multitap: `2·3`(c) `6·4`(6) `4·4`(4) `8·2`(u) (`n·k` = key n, k taps).
- `c64u.local` — multitap: `c64u` `1·1`(.) `5·3`(l) `6·3`(o) `2·3`(c) `2·1`(a) `5·3`(l).

Full mapping in `docs/keymap.md`.

**CTA / keyboard-only operation:** the app uses standard focusable elements
(native buttons, Radix controls) which are Tab-focusable and Enter/Space
activatable; the default profile maps `Tab→nextField`, `Enter→enter`,
`Space→center`, arrows→`dpad*`. The `FocusController` provides a deterministic
ordering model for keypad-only contexts that need it. Note: this work delivers
the input foundation, the hostname/IP fallback, and tested focus traversal logic;
exhaustively re-registering every CTA in the app through `FocusController` is
incremental and not required for native keyboard operability.

## 11. Test plan + evidence

Automated (all green locally — see the build-command evidence in `WORKLOG.md`):

- Variant schema accepts an Android-only variant; rejects a missing `android`
  block; rejects an Android-only variant with no `theme`/`web`
  (`tests/unit/scripts/variantAndroidOnly.test.ts`).
- Real `variants.yaml`: `c64u-remote` has display name exactly `C64U Remote`,
  app id `uk.gleissner.c64uremote`, no iOS/web, theme present; publish defaults
  include both variants; no `c64u-controller` variant.
- Real `c64u-remote.yaml`: all 12 flags resolve `enabled:false` +
  `visible_to_user:false`; HVSC/CommoServe + every experimental flag disabled;
  baked into the variant selection.
- Compiling `c64u-remote` emits no web/iOS artifacts (manifest/sw/web-server/
  xcconfig absent) and writes Android `strings.xml` with label `C64U Remote` /
  package `uk.gleissner.c64uremote`.
- T9 composer (`tests/unit/lib/input/*`, 47 tests) + the React adapter
  (`tests/unit/hooks/useT9Input.test.tsx`) + integration
  (`SavedDeviceEditorFields.t9.test.tsx`): IPv4/hostname/port entry, multi-tap
  cycling + timeout, mode switching, focus traversal — all without a soft
  keyboard.
- Small-screen layout contract (`tests/unit/lib/smallScreenLayout.test.ts`):
  480/640/360/320 widths select the right display profile; the smallest profile
  uses fluid (non-overflowing) widths and a ≤2-column action grid.
- APK metadata parser (`tests/unit/scripts/verifyApkMetadata.test.ts`) +
  stale-name guard (`tests/unit/scripts/checkStaleVariantNames.test.ts`).

APK build evidence (local, Android SDK + Gradle 9.5.1 + aapt2 + Java 21):

| Variant | Application id | Label | APK | Size |
| --- | --- | --- | --- | --- |
| c64commander | uk.gleissner.c64commander | C64 Commander | `artifacts/android-apks/c64commander-<ver>-debug.apk` | ~14.7 MB |
| c64u-remote | uk.gleissner.c64uremote | C64U Remote | `artifacts/android-apks/c64u-remote-<ver>-debug.apk` | ~14.7 MB |

Both built from a single `npm run android:apk:all --verify-metadata`; metadata
verified via `aapt2 dump badging` (label + application id match the variant).

**Validated on a physical de-Googled Pixel 4 (Android, no Google Play Services,
GMS package count 0) — evidence in `artifacts/android-apks/validation/`:**

1. ✅ Both APKs install and **coexist** (`uk.gleissner.c64commander` +
   `uk.gleissner.c64uremote`); both launch; the C64U Remote app bar shows exactly
   **"C64U Remote"** (screenshot `c64u-remote-launch.png`).
2. ✅ C64U Remote **pruned features absent on-device**: no HVSC, CommoServe, or
   Online Archive sections in Settings (uiautomator node count 0); no
   lighting/RAM/REU/Telnet action panels on Home; no feature-flag toggles.
3. ✅ **No Google Play Services**: static no-GMS gate passes for both APKs; the
   target has 0 GMS packages; launch produces no `GooglePlayServicesNotAvailable`
   / `SERVICE_MISSING` / fatal logcat errors.
4. ✅ **Keypad-only operability**: after driving d-pad + number keys (no taps), a
   focusable element is focused (`scripts/android-keypad-smoke.sh` PASS).
5. ✅ **Minimal permissions**: the C64U Remote APK declares only `INTERNET`
   (`aapt2 dump permissions`); the full C64 Commander APK retains the
   foreground-service/wake-lock permissions.

**Covered by automated tests rather than on-device adb (WebView inputs are not
focusable from the adb shell):** T9 hostname/IP entry without the soft keyboard —
`tests/unit/components/devices/SavedDeviceEditorFields.t9.test.tsx` drives the
real component with hardware-key events and asserts `192.168.1.13` is entered.

**Still requires a real Sailfish/Callback device (on-device validation items):**
install + run on Sailfish AppSupport; AppSupport's WebView version/behaviour; a
live REST call over cleartext inside the AppSupport container; mDNS/`.local`
behaviour; the Callback's locked-down launcher / sideload policy; keypad T9 on the
physical keypad. Only after these should the wording move from "designed for" to
"validated on Sailfish/Callback". Reproducible substitutes (Waydroid VANILLA, an
AOSP no-GMS 480×640 emulator) are documented in
[`sailfish-callback-8020-emulation.md`](sailfish-callback-8020-emulation.md).

---

## 12. Remaining risks

| Area | Finding | Impact | Variant affected | Severity | Evidence | Mitigation | Remaining risk | Est. effort |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AppSupport WebView | WebView version on the Callback is undocumented | App may hit an unsupported WebView feature | both | High | §1, §6; AppSupport docs | Conservative feature set; **app launches + renders + runs cleanly on a real de-Googled Android WebView (Pixel 4)** | Sailfish AppSupport's specific WebView still unverified | 0.5d to run + triage on AppSupport |
| Local networking | Cleartext + LAN + mDNS/`.local` behaviour inside AppSupport unknown | Device discovery/connection could fail | both | High | §7; `network_security_config.xml`; Jolla docs silent | Raw IPv4 first-class + T9 hostname mode; no internet needed | mDNS may not resolve in container | 0.5–1d if a fallback resolver is needed |
| Install path | 8020 sideload policy for unknown APKs undisclosed | C64U Remote may not be installable by users on the 8020 | c64u-remote | High | §1 (TechSpot/heise) | Produce standard debug + signable release APK/AAB; document Aurora/F-Droid/sideload | Distribution channel out of our control | external |
| targetSdk vs AppSupport | `targetSdk 35` may exceed device AppSupport API (≤33) | Behavioural quirks (not install failure) | both | Medium | `android/variables.gradle`; §1 | targetSdk gates behaviour, not install; monitor on-device | Unverified | 0.5d if a downshift is needed |
| Touch-off default | Callback ships with touch disabled | Touch-only flows would be unreachable | both | Medium→Low | §1 (heise); §11 | T9 + keypad subsystem; hostname/IP without soft keyboard; **keypad-only d-pad operability validated on the Pixel 4** | Full per-CTA FocusController registration is incremental; physical-keypad T9 unverified | 2–4d for exhaustive CTA registration |
| Shared manifest perms | FGS/`WAKE_LOCK` previously declared but unused in C64U Remote | Broader permission set than needed | c64u-remote | **RESOLVED** | §5; verified via `aapt2 dump permissions` | Variant-driven manifest swap: C64U Remote now ships **only INTERNET**; full app keeps FGS/WAKE_LOCK (parity test `androidManifestParity.test.ts`) | none | done |
| Small-screen pixel overflow | jsdom can't measure layout | A specific screen could overflow at 320–480 px | both | **RESOLVED** | `playwright/callbackSmallScreen.spec.ts` | **Real-browser test asserts no horizontal overflow at 480×640 and 320×480 across all primary routes (passing)** | none | done |
| Background lifecycle | AppSupport restricts background services | Background playback unreliable | c64commander only | Low | §1, §5 | C64U Remote disables background execution entirely | Affects full app only | n/a for c64u-remote |

Severity = impact if it occurs; the three High items are all "cannot be proven
without the device", not known defects.
