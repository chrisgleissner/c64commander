# WORKLOG — C64U Remote variant + Sailfish/Callback 8020 compatibility

> This worklog is re-authored for the C64U Remote / Callback 8020 task on branch
> `feat/introduce-new-variant` (2026-06-18). The previous worklog (an unrelated
> "Prod Hardening 8" run) remains available in git history.

## P0 — Bootstrap & system map (2026-06-18)

### Initial repository facts (from direct inspection)

- `variants/variants.yaml` (schema_version 1) holds `c64commander` (default) and
  the placeholder `c64u-controller`. Both currently declare `platform.{android,ios,web}`.
- `repo.publish_defaults.release` and `.ci` currently list only `c64commander`.
- Per-variant flag overrides live in `variants/feature-flags/<variant>.yaml`:
  - `c64commander.yaml`: `overrides: {}`
  - `c64u-controller.yaml`: `overrides: { hvsc_enabled: { enabled: false } }`
- Base flags: `src/lib/config/feature-flags.yaml`.
- Variant assets: `variants/assets/{c64commander,c64u-controller}/{icon,logo,splash}.png`.
- Key scripts: `scripts/generate-variant.mjs` (42KB), `scripts/compile-feature-flags.mjs`,
  `scripts/sync-brand-assets.mjs`. Root `build` executable (~58KB).
- `package.json`: `variant:generate`, `variant:check`, `feature-flags:compile`,
  `feature-flags:check`, `android:apk` = `cd android && ./gradlew assembleDebug`,
  `cap:*` capacitor scripts. `prebuild` runs variant:generate + feature-flags:compile + notices.
- Capacitor 6.2.1 (android/core/ios/cli); root `capacitor.config.ts` present.

### Decisions / assumptions logged

- Re-authored PLANS.md + WORKLOG.md for this task (prior content preserved in git);
  these are the authoritative plan/log per the brief's startup requirements.
- No Callback 8020 / Sailfish AppSupport device available → all such claims will be
  "designed for / validated against constraints", never "validated on hardware".

### Commands run

- `ls -la`, `ls -R variants`, read variants.yaml + flag override files + package.json.
- Launched 4 Explore agents (variant system, build/CI, feature-flags/routing, app/test harness)
  + 1 research agent (Callback 8020 / Sailfish facts). All returned.

### System map (consolidated from inspection)

**Variant generator** `scripts/generate-variant.mjs` (1135 lines):
- `normalizeVariant` REQUIRES `platform.{android,ios,web}` (lines 222-225) and uniqueness
  checks reference `platform.ios.bundleId` (line 327) — both block Android-only variants.
- Generates: `src/generated/variant.{ts,json}`, `index.html`, `public/manifest.webmanifest`,
  `public/sw.js`, `web/server/src/variant.generated.ts`, android `strings.xml` +
  `ic_launcher_background.xml` + mipmaps/splash, ios xcconfig + storyboard + assets.
- Android color (`ic_launcher_background`, splash bg, maskable bg) is sourced from
  `platform.web.backgroundColor` — an Android-only variant has no web block, so a new
  color source is needed → DECISION: add an optional variant-level `theme:` block
  (`theme_color`/`background_color`); resolved color = `theme ?? platform.web`.
- `android/app/build.gradle` reads `src/generated/variant.json` →
  `platform.android.applicationId` + `exportedFileBasename` (both present for Android-only).
- Runtime access to web/ios fields (the ONLY ones that run inside the Android app):
  - `capacitor.config.ts:13` → `variant.platform.ios.bundleId` (FIX: `?? android.applicationId`).
  - `src/components/StartupLaunchSequence.tsx:36` → `variant.platform.web.backgroundColor`
    (FIX: read resolved `variant.theme.backgroundColor`).
  - `web/server/src/staticAssets.ts` → `platform.web.loginTitle/Heading` — web server only,
    NOT built for the Android-only variant; safe.

**Build/CI** (`build` ~1950-line bash; `.github/workflows/android.yaml` ~1818 lines):
- CI ALREADY has a per-variant matrix: `android-packaging` job fans out over
  `needs.variant-selection.outputs.publish_variants_json` (derived from variants.yaml
  `publish_defaults`). Adding `c64u-remote` to publish_defaults drives both-APK builds.
- `npm run android:apk` = `cd android && ./gradlew assembleDebug` (one variant per run).
- APK output name from gradle: `${exportedFileBasename}-${versionName}${-debug?}.apk`
  → deterministic + distinguishable per variant.
- minSdk 22, compile/target 35, JDK 17. Capacitor plugins: app, filesystem, share +
  CapacitorHttp (CORS bypass). NO Firebase/FCM/GMS anywhere.
- Manifest perms: INTERNET, FOREGROUND_SERVICE, FOREGROUND_SERVICE_MEDIA_PLAYBACK, WAKE_LOCK.
  `usesCleartextTraffic=true` + `res/xml/network_security_config.xml` base cleartext true.
- Metadata helpers exist: `verify-android-apk-lzma2.sh`, `validate-release-artifact.mjs`
  (no label/app-id badging check yet → add one).

**Feature flags**: base `src/lib/config/feature-flags.yaml` (12 flags, 2 groups). Override
schema supports `enabled`/`visible_to_user`/`developer_only`. Resolution
(`src/lib/config/featureFlags.ts`): variant override baked into `variant.ts` is merged into
the definition BEFORE user overrides; a flag with `visible_to_user:false` is hidden from
normal Settings and non-editable → user/localStorage CANNOT re-enable it. No route-level
gating exists, but no DISABLED feature owns a whole tab route — all are component-gated via
`useFeatureFlag`, so flag overrides fully remove them from nav/home/actions/settings.
→ DECISION: c64u-remote.yaml sets `{enabled:false, visible_to_user:false}` for ALL 12 flags.

**Text input**: hostname/IP entry = `src/components/devices/SavedDeviceEditorFields.tsx`
(host field is a plain shadcn `<Input>`, no T9). Ports use `inputMode="numeric"`.
Keyboard handling is scattered (`onKeyDown` in ~10 components); NO centralized input module
→ new `src/lib/input/` subsystem (delegated to fork).

**App/layout**: display profiles `src/lib/displayProfiles.ts` — compact ≤360, medium
361-599, expanded ≥600. Callback internal display is 480×640 portrait → 480-wide = medium,
640-wide (landscape) = expanded. CSS safe-area + `--app-tab-bar-frame-height` in index.css.
Tests: vitest projects `unit-jsdom` + `unit-node`; 591 unit files / ~6859 cases;
`tests/setup.ts` has `__setFeatureFlagTestState`. No tsc script; typecheck via build/eslint.

## P1 — Callback 8020 / Sailfish facts verified (2026-06-18)

Research agent (sourced: GSMArena, Tom's Hardware, TechSpot, heise, Jolla/Sailfish docs,
Wikipedia, GNOME blog). Corrections/confirmations vs the brief's baseline:
- Display is **480×640** (3.25") — confirm; brief said "640×480" (same panel, portrait).
  Plus a 1.77" external cover display (not an app surface).
- Sailfish OS + **Android AppSupport** (LXC container since 8.1; not emulation). Newest
  (Jolla C2 / Sailfish 5.0 "Tampella", Feb 2025) = **Android 13 / API 33**; varies by device;
  Callback's AppSupport API level is **unconfirmed**. Our minSdk 22 ≤ 33 → compatible range.
- **No Google Play / no GMS**; microG is opt-in. **WebView present (AOSP-derived) but version
  unverified** → high-severity on-device validation item for a Capacitor WebView app.
- **Background services restricted/configurable** in AppSupport → reinforces disabling
  background_execution in c64u-remote.
- **Cleartext/localhost/mDNS/.local behavior inside AppSupport = UNKNOWN** → raw IPv4 must be
  first-class; document as on-device validation item.
- **Touch disabled by default**, apps may enable; **T9 keypad-first**. Browser/social blocked
  at system level ("patent-pending" + DNS). **Sideload path on the 8020 unconfirmed.**
- Status: **announced, pre-order 2026-06-30, ships Q4 2026** — NOT shipping; specs are
  vendor-stated. → All compatibility claims stay "designed for / validated against
  constraints", never "validated on hardware".

## Implementation (P3+) — in progress

- Delegated the T9/hardware-key input subsystem (`src/lib/input/**` + tests) to a fork.
- Proceeding with the variant/build/feature-flag spine directly.

## P3–P12 — implementation evidence (2026-06-18)

### Files changed / added

Modified: `.github/workflows/android.yaml`, `.gitignore`, `README.md`,
`capacitor.config.ts`, `package.json`, `scripts/generate-variant.mjs`,
`src/components/StartupLaunchSequence.tsx`,
`src/components/devices/SavedDeviceEditorFields.tsx`, `src/generated/variant.{ts,json}`,
`web/server/src/variant.generated.ts`, `variants/variants.yaml`,
`docs/research/variants/variant-spec.md` (historical migration note),
test fixtures `tests/unit/{fuzz/fuzzMode,scripts/generateVariant,scripts/syncBrandAssets}.test.ts`
(renamed c64u-controller→c64u-remote), `tests/unit/scripts/releaseVersionMetadata.test.ts`
(pre-existing prettier nit fixed).
Renamed: `variants/assets/c64u-controller/` → `variants/assets/c64u-remote/`,
`variants/feature-flags/c64u-controller.yaml` → `…/c64u-remote.yaml` (rewritten).
Added: `docs/research/callback8020/sailfish-callback-8020-android-compatibility.md`, `docs/research/callback8020/keymap.md`,
`src/lib/input/**` (keyEvent, keymap, t9, focusController, profiles, index),
`src/hooks/useT9Input.ts`, `scripts/{build-android-apks,verify-apk-metadata,check-stale-variant-names}.mjs`,
and 6 new test files (+ 4 input-subsystem test files from the fork).

### Generator changes (P3)

- `platform.ios`/`platform.web` optional; new resolved `theme` block (derives from
  `platform.web` when absent → c64commander web/android/iOS outputs byte-identical;
  only `variant.{ts,json}` + web-server module gained `theme`). bundle_id uniqueness
  guarded; web artifacts (manifest/sw/web-server/public icons) only for web-capable
  variants; iOS artifacts only for iOS-capable variants. capacitor.config + the one
  app-runtime `platform.web` read now use the optional-safe fallback / `variant.theme`.

### Commands + results

- `node scripts/generate-variant.mjs` (default) — OK; `npm run variant:check` — OK;
  `npm run feature-flags:check` — OK.
- c64u-remote selection smoke: displayName "C64U Remote", appId/basename `c64u-remote`,
  `uk.gleissner.c64uremote`, no ios/web, theme `#2F6B8B`, endpoints `{device_host:c64u}`,
  all 12 flags `{enabled:false, visible_to_user:false}`, publishVariants
  `[c64commander, c64u-remote]`; generated files = index.html + variant.{ts,json} only.
- `node scripts/check-stale-variant-names.mjs` — "no stale c64u-controller naming".
- **Both APKs built** via `node scripts/build-android-apks.mjs --target ci --verify-metadata`
  (Android SDK + Gradle 9.5.1 + aapt2 + Java 21), collected in `artifacts/android-apks/`:
  - `c64commander-0.8.8-rc2-61020-debug.apk` — app id `uk.gleissner.c64commander`, label `C64 Commander` (~14.7 MB)
  - `c64u-remote-0.8.8-rc2-61020-debug.apk` — app id `uk.gleissner.c64uremote`, label `C64U Remote` (~14.7 MB)
  - metadata verified via `aapt2 dump badging` (label + application id assertions pass).
- `npm run lint` — **exit 0** (format:check:ts, eslint, display-profiles, bundle-budgets,
  stale-names, variant:check, feature-flags:check all green) on a clean tree.
- `npm run test` (full unit suite) — **6941 passed**, 601 files. 83 new tests added across
  10 files (input subsystem 47; variant/metadata/stale/layout/T9-hook/integration 36).

### Known pre-existing, unrelated failure

`tests/unit/scripts/releaseVersionMetadata.test.ts` fails locally: it asserts
`package.json` version (`0.8.8-rc1`) == latest git tag (`0.8.8-rc2`). Not caused by this
work — the version line is untouched, it fails in isolation, and the test falls back to
`package.json` when tags are unavailable (so it passes in CI's shallow clone). Resolving it
is a release-version bump owned by the maintainer; intentionally excluded from this feature PR.

### Validation NOT performed (no hardware available)

No Commodore Callback 8020 device and no Sailfish OS AppSupport environment were available,
so nothing was validated on real hardware or on AppSupport. The compatibility doc keeps all
such claims as "designed for / validated against constraints" and lists the on-device
validation items (WebView version, cleartext/LAN/mDNS in AppSupport, install path,
side-by-side install + keypad operation). The manual checklist is in §11 of the doc.

## Continuation phase — substitute device/Sailfish-mock validation (2026-06-18)

Goal: close the validation gaps with the closest Linux substitutes + research-backed
best practices, and finish the remaining follow-ups.

### Version bump (fixes the previously pre-existing failure)
- `package.json` + `package-lock.json` (both version fields) bumped `0.8.8-rc1` → `0.8.8-rc2`
  to match the latest git tag. `releaseVersionMetadata.test.ts` now passes.

### Permission scoping for C64U Remote (was a Low risk → RESOLVED)
- build.gradle reads `background_execution_enabled` from variant.json and swaps the main
  manifest: full `AndroidManifest.xml` vs new `AndroidManifest.no-background.xml` (drops the
  FGS service + FOREGROUND_SERVICE/FOREGROUND_SERVICE_MEDIA_PLAYBACK/WAKE_LOCK; keeps INTERNET).
  Build log confirms per-variant selection. Parity guarded by
  `tests/unit/scripts/androidManifestParity.test.ts`.
- `aapt2 dump permissions` evidence: c64commander = INTERNET+FOREGROUND_SERVICE+
  FOREGROUND_SERVICE_MEDIA_PLAYBACK+WAKE_LOCK; **c64u-remote = INTERNET only**.

### Settings pruning extended (HVSC + Online Archive/CommoServe cards)
- `SettingsPage.tsx`: the HVSC and Online Archive cards are now gated on
  `flags.hvsc_enabled` / `flags.commoserve_enabled`. Tests added (65/65 SettingsPage tests
  pass; harness defaults flags on so c64commander still shows them; c64u-remote hides them).

### No-GMS verification
- `scripts/verify-apk-no-gms.mjs` (+ `npm run apk:no-gms`, wired into `android:apk:all
  --verify-metadata`) statically asserts no required GMS/Firebase/Maps uses-library/feature.
  Unit-tested. **Both APKs pass** (`has no hard Google Play Services dependency`).

### Sailfish-like mock-env tooling (research-backed; see docs/testing/...)
- `scripts/sailfish-callback-emulator.sh`: AOSP no-GMS AVD, API 33 (= newest AppSupport),
  480×640@240dpi, touchScreen=no/dPad=yes — `config` dry-run verified.
- `scripts/android-keypad-smoke.sh`: no-GMS + install/launch + keypad-only + logcat smoke,
  runnable on the emulator or a real device.
- `docs/research/callback8020/sailfish-callback-8020-emulation.md`: 3-layer strategy (Playwright /
  AOSP emulator / Waydroid VANILLA + Pixel 4) with exact commands + caveats.

### Real-browser small-screen layout (was Low risk → RESOLVED)
- `playwright/callbackSmallScreen.spec.ts`: **no horizontal overflow at 480×640 and 320×480**
  across all 6 primary routes — `2 passed` in real Chromium.

### Device validation on a physical de-Googled Pixel 4 (Android, GMS packages = 0)
Evidence saved under `artifacts/android-apks/validation/`:
- Both APKs installed and **coexist** (uk.gleissner.c64commander + uk.gleissner.c64uremote).
- C64U Remote launches; app bar shows exactly **"C64U Remote"** (screenshot).
- **No GMS**: 0 GMS packages on target; no GooglePlayServicesNotAvailable / SERVICE_MISSING /
  fatal logcat after launch.
- **Keypad-only**: `scripts/android-keypad-smoke.sh ... uk.gleissner.c64uremote` → PASS
  (focusable element focused after d-pad navigation).
- **Pruned on-device**: c64u-remote Settings has 0 HVSC/CommoServe/Online Archive nodes
  (uiautomator); Home has no lighting/RAM/REU/Telnet panels.
- T9 hostname/IP entry: WebView inputs are not focusable from the adb shell (zero bounds),
  so precise on-device T9 entry is covered by the component integration test
  (`SavedDeviceEditorFields.t9.test.tsx` enters `192.168.1.13`); on-device keypad
  operability is confirmed by the smoke above.

### Still genuinely external
- Real Sailfish AppSupport / Callback 8020 hardware (pre-release). The emulation doc gives
  the closest substitutes (Waydroid VANILLA, AOSP no-GMS 480×640 emulator) to run when a
  binder-capable kernel + Wayland host (or the device) is available.


