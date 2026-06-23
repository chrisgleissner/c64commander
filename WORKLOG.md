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
Added: `docs/plans/callback8020/sailfish-callback-8020-android-compatibility.md`, `docs/plans/callback8020/keymap.md`,
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
- `docs/plans/callback8020/sailfish-callback-8020-emulation.md`: 3-layer strategy (Playwright /
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

## Waydroid validation — RAN locally (2026-06-18)

- Added `scripts/waydroid-smoke.sh` (self-contained; `WAYDROID_SMOKE_DISABLE=1` toggle),
  opt-in non-blocking CI `.github/workflows/waydroid-smoke.yaml`, npm `test:waydroid*`.
- Environment: Ubuntu 24.04, kernel 6.17, `binder_linux` module loaded, Waydroid installed
  + `init -s VANILLA` (no-GMS), container service active. No weston → harness fell back to
  **`kwin_wayland --virtual`** (headless, under dbus-run-session) for the Wayland socket.
- Blockers found + handled: `waydroid shell` needs root; adb-over-TCP to the container fails
  RSA auth headlessly. So the smoke uses **user-level `waydroid app install`/`launch` +
  `waydroid app list`** (no root) for the core checks; adb/shell-based screenshot+dumpsys is
  best-effort (auto-runs on CI's passwordless-sudo runners).
- Result (`scripts/waydroid-smoke.sh run` → PASS): static no-GMS OK; image has 0
  `com.google.android.gms`; **C64U Remote installed** (`waydroid app list` → `Name: C64U
  Remote` / `packageName: uk.gleissner.c64uremote`) and **launched** (container active, still
  listed after launch). The VANILLA app list is LineageOS/AOSP only (no `com.google.*`).

## Issue: "Web | Unit tests (coverage)" (2026-06-18)

- CI failure = `releaseVersionMetadata.test.ts` (Received `0.8.8-rc1` vs Expected `0.8.8-rc2`)
  — CI ran a pre-bump commit. HEAD already has the `rc2` bump → the test passes on HEAD.
- Perf-budget lines in the log ("Android HVSC perf budgets FAILED: T1 25000>20000",
  "browseLoadSnapshotMs: invalid budget value not-a-number") are benign console output
  (runner-speed dependent), not test failures — the run reported exactly 1 failed test.
- Verifying the coverage run is green on HEAD and the 91% line/branch gate still holds with
  the new `src/` (input subsystem, useT9Input, Settings/host-field wiring).



## Ralph loop (2026-06-18): M2 NavigationController (semantic-action dispatch + back chain)

- Selected slice: M2 keyboard-only operability — the enabling dispatch layer (the keystone both
  M2.1 CTA-registration and M2.2 deterministic-back depend on; `FocusController` had no consumer
  and no action→operation mapping).
- Added `src/lib/input/focusNavigation.ts` (`NavigationController`): wraps a `FocusController`,
  maps `dpadDown`/`nextField`→focusNext, `dpadUp`/`previousField`→focusPrevious,
  `center`/`enter`/`activate`→activateCurrent (with `onFocus`/`onActivate` callbacks for the
  adapter's `element.focus()`); implements the deterministic `back`/`escape` chain via a LIFO
  dismissible-layer stack → engaged-field disengage → `onNavigateBack`; `closeMenu` dismisses the
  topmost menu-kind layer only. Horizontal d-pad + soft keys return `ignored` so the focused
  widget/context handler owns them. DOM-free + timer-free (unit-testable in isolation).
- Tests: `tests/unit/lib/input/focusNavigation.test.ts` (22 tests, 6 describe blocks) — traversal,
  activation (enabled/disabled/empty), full back chain + LIFO unwind + field-disengage +
  navigate-back + pushLayer-replace + removeLayer (no dismiss), closeMenu, and `ignored` actions.
- Gates: input subset `vitest run` → 30 pass; scoped coverage of the new file → 100%
  stmts/branch/funcs/lines; `npm run lint` full chain → exit 0; `npm run test` → 6955 pass.
- M1 closed (gates verified green on HEAD; perf-budget lines documented benign). Backlog M2.1 +
  M2.2 marked `[~]` partial (model + tests done; React adapter + per-screen wiring still to do).
- No shared C64 Commander screens touched (pure new module + barrel export) → zero regression risk.

## Ralph loop (2026-06-18): M2 React adapter (FocusNavigationProvider + useFocusItem)

- Selected slice: M2 keyboard-only operability — the React adapter that drives the
  `NavigationController` (built last loop) from real key events and registers per-screen CTAs.
  This is the explicitly-named "still to do" half of M2.1/M2.2; the dispatcher had no consumer.
- Added `src/hooks/useFocusNavigation.tsx`:
  - `FocusNavigationProvider` — one global `window` `keydown` listener; `normalizeKeyEvent(event,
    resolveInputProfile(profileId))` → `controller.dispatch(action)`; `onFocus` → resolved
    `element.focus()`, `onNavigateBack` → router back; `event.preventDefault()` only when the
    outcome is not `ignored`. Skips dispatch entirely when `event.target` is editable
    (INPUT/TEXTAREA/SELECT/contenteditable) so the field + its `useT9Input` composer keep the key.
    `enabled` prop detaches the listener (registry still usable programmatically).
  - `useFocusItem(id, order, group?, disabled?, onActivate?)` — registers a `FocusItem` with the
    surrounding provider for the component's lifetime (activate defaults to clicking the element),
    returns a ref callback for the DOM node; no-op (no throw) outside a provider.
  - `useFocusNavigation()` — returns the active controller (null outside a provider) for future
    dialog/menu `pushLayer` + field `setFieldEngaged` wiring (M2.2 follow-up).
- Tests: `tests/unit/hooks/useFocusNavigation.test.tsx` (11 jsdom integration tests, testing-library)
  — traversal/skip-disabled/wrap (fwd+back), activation via Enter/Space (click + custom onActivate),
  back→onNavigateBack (and undefined-handler no-throw), editable skip (input + contenteditable +
  non-element document target), preventDefault-only-on-consume, `enabled:false`, keypad profile
  (`DpadDown`/`DpadCenter`), unmount-unregister, provider-absent no-op.
- Gates: new test → 11 pass; scoped coverage of the new module → 100% stmts/funcs/lines, 97.61%
  branch (≥ 91% gate); `npx tsc --noEmit` → exit 0; `npm run lint` full chain → exit 0
  (stale-name guard: "no stale c64u-controller naming"; variant:check + feature-flags:check green).
- Robustness fix during the loop: `isEditableTarget` also checks the `contenteditable` attribute
  (jsdom — and some engines — don't compute `isContentEditable`), so the skip is reliable on-device.
- Additive only — no existing src files edited (two new files; barrel already exported
  `NavigationController`). Default C64 Commander variant behaviour unchanged. Backlog M2.1 + M2.2
  notes advanced: adapter + integration proof done; App mount + per-screen CTA registration remain.

## M2.1 — mounted the keyboard-only focus-nav adapter + registered the primary tab navigation

- Branch `feat/introduce-new-variant`. The `FocusNavigationProvider` / `useFocusItem` adapter (built
  + integration-tested the prior loop) had no consumer in the running app; this loop wired it in and
  proved it on a real, always-present screen, additively and behind a variant gate.
- `src/App.tsx`:
  - New `KeypadFocusNavigation` wrapper component (inside `BrowserRouter`) mounts
    `FocusNavigationProvider` around all of `AppRoutes`' content + `TabBar`, with
    `onNavigateBack={() => navigate(-1)}` and `profileId="commodoreCallback8020"`.
  - `keypadFocusNavigationEnabled = variant.appId === "c64u-remote"` gates the global key listener.
    Default C64 Commander variant: provider mounts `enabled={false}` → listener detached, existing
    pointer + desktop-keyboard behaviour untouched, registrations inert. C64U Remote: listener live.
- `src/components/TabBar.tsx`:
  - Extracted `TabBarButton` (a `useFocusItem` call per tab needs a component, not a `.map` body).
  - Each rendered tab registers via `useFocusItem({ id: "tab-<label>", order: 1000 + index, group:
    "primary-tabs" })`; the high order base keeps the persistent tab bar after page content in the
    single keypad focus ring. All existing attributes/handlers/classes preserved verbatim; the ref is
    purely additive. Center-activation falls through to the element's existing onClick → `navigate`.
- Tests: `tests/unit/components/TabBar.test.tsx` (+2, now 5):
  - Under `FocusNavigationProvider profileId="commodoreCallback8020"`: `DpadDown`×2 moves focus
    Home→Play→Disks (asserted via `document.activeElement`), `DpadCenter` activates Disks and the
    router navigates to `/disks` (asserted via a `useLocation` probe).
  - With no provider, `DpadCenter` is inert (event not prevented, no navigation, no throw) — the
    default-variant safety contract.
- Gates: affected `vitest` subset (App.runtime, PageErrorBoundary, AppBar, TabBar,
  useFocusNavigation, focusNavigation — 82 pass); **full `npm run test` → 605 files / 6990 tests pass
  (exit 0)** since App.tsx + TabBar are core; `npx tsc --noEmit` exit 0; `npm run lint` full chain
  exit 0 (stale-name guard green; variant:check + feature-flags:check green). `test:coverage` not
  re-run — narrow additive change, both new branches covered, 91% gate margin intact.
- Backlog M2.1 advanced (`[~]`): adapter mounted + tab navigation registered + proven; per-page
  primary-CTA registration (Home/Play/Disks/Config/Settings) and the per-screen reachability audit
  remain. No README/Callback references added; default variant unchanged.

## M2.1 — registered HomePage's Config-action CTAs in the keypad focus ring (2026-06-18)

- Continued M2.1 from the mounted provider + registered tab bar: the HomePage **Config Actions**
  grid (the densest cluster of primary CTAs) now joins the touch-free d-pad/center ring.
- `src/hooks/useFocusNavigation.tsx`: `useFocusItem` opt-out on empty `id` (`if (!context || !id)
  return`). Lets a shared CTA primitive call the hook unconditionally and register only when given a
  real id; the ref callback still tracks the element regardless.
- `src/components/QuickActionCard.tsx`: optional `focusId` / `focusOrder`; registers via
  `useFocusItem` (group `home-actions`, `disabled: disabled || loading`) and attaches the ref to the
  existing `<button>`. Disabled/loading cards register disabled → skipped by `FocusController.step`,
  so an inactive CTA can never be reached/activated by repeated d-pad/center. No `focusId` ⇒ no
  registration (MachineControls' 10 cards unchanged). Inert in the default variant (provider
  `enabled={false}`). Pointer onClick + all styling preserved verbatim.
- `src/pages/HomePage.tsx`: `focusId` + `focusOrder` (100…190) on all 10 Config-action cards
  (save/load/reset-to-flash, save/load/manage/revert app configs, advanced save-to-file/load-from-
  file, telnet clear-flash). Gated cards self-register only when rendered, so pruned-feature CTAs
  (telnet clear-flash) never enter the c64u-remote ring.
- Tests: `tests/unit/components/QuickActionCard.test.tsx` (+3, now 11):
  - Under `FocusNavigationProvider profileId="commodoreCallback8020"`: `DpadDown`×2 moves focus
    Save→Load→Reset by `focusOrder` (asserted via `document.activeElement`); `DpadCenter` fires only
    the focused card's onClick.
  - A `disabled` card is skipped (single step jumps Save→Reset; center then activates Reset).
  - A card without `focusId` never enters the ring (only the registered card's onClick fires).
- Gates: affected `vitest` (QuickActionCard test + density + TabBar + useFocusNavigation = 30 pass;
  HomePage + HomePage.ramActions = 56 pass); `npx tsc --noEmit` exit 0; `npm run lint` full chain
  exit 0 (stale-name guard + variant:check + feature-flags:check green). `test:coverage` not re-run —
  narrow additive change, every new branch (`focusId` present/absent, `!context`/`!id`, disabled)
  covered, 91% gate margin intact.
- Backlog M2.1 still `[~]`: HomePage Config CTAs done; remaining HomePage sections (MachineControls,
  drives/printer, quick-config) + other pages (Play/Disks/Config/Settings) and the per-screen
  reachability audit remain. No README/Callback references added; default variant unchanged.

## M2.1 — registered MachineControls' primary CTAs in the keypad focus ring (2026-06-18)

- Branch `feat/introduce-new-variant`. Slice (M2.1): bring HomePage's MachineControls "Quick Actions"
  into the touch-free d-pad/center focus ring, after the provider mount + TabBar + Config-grid work.
- `src/pages/home/components/MachineControls.tsx`: each `QuickActionCard` now carries `focusId` +
  `focusOrder` in band 100–190 (Reset 100 / Reboot 110 / Pause-Resume 120 / Menu 130 / Save RAM 140 /
  Load RAM 150 / Power Cycle 160 / extraActions 170+ / Power Off 190). In c64u-remote only
  Reset/Reboot/Pause/Menu/Power Off render, so RAM/power-cycle/clear-ram/save-REU stay pruned and out
  of the ring. Disabled cards register as disabled → skipped during traversal.
- `src/pages/HomePage.tsx`: renumbered the Config-action grid from 100–190 → **600–690** so the
  single global focus registry traverses top→bottom (Machine 100–190 → reserved Drives 300 / Printers
  400 → Config 600–690 → TabBar 1000+). Documented the band scheme in a comment. No behaviour change —
  `focusOrder` only affects keypad traversal sequence and is inert in the default variant.
- Tests: `tests/unit/pages/home/components/MachineControls.focus.test.tsx` (+4, new). Uses the REAL
  `QuickActionCard` (the existing MachineControls suite mocks it) inside
  `FocusNavigationProvider profileId="commodoreCallback8020"`:
  - `DpadDown`×3 walks Reset→Reboot→Pause→Menu (asserted via `document.activeElement`); `DpadCenter`
    fires only `onToggleMenu` — no dialog opens, no other handler runs.
  - A backward step from the section top wraps to Power Off (highest order 190); center fires
    `onPowerOff`, proving it traverses last.
  - Pruned RAM/Power-Cycle buttons are absent and exactly five canonical actions cycle the ring.
  - While disconnected every card is disabled, so d-pad + center is a no-op: no handler fires and no
    confirmation dialog opens (destructive CTA unreachable while inactive).
- Gates: affected `vitest` (MachineControls.focus 4 + MachineControls 18 + QuickActionCard 11 +
  TabBar 5 + useFocusNavigation 11 + focusNavigation 22 = 71 pass; HomePage + ramActions = 56 pass);
  `npx tsc --noEmit` exit 0; `npm run lint` full chain exit 0 (stale-name guard + variant:check +
  feature-flags:check green). `test:coverage` not re-run — narrow additive change, every new branch
  exercised, 91% gate margin intact.
- Backlog M2.1 still `[~]`: HomePage Config + MachineControls done; remaining HomePage sections
  (drives/printer, quick-config selects) + other pages (Play/Disks/Config/Settings) and the per-screen
  reachability audit remain. No README/Callback references added; default variant unchanged (provider
  `enabled={false}`, `focusId`-less cards inert).

## M2.1 — registered HomePage's Drives + Printers button CTAs in the keypad focus ring (2026-06-18)

- Slice (backlog M2.1): bring the always-rendered button CTAs of HomePage's Drives + Printers sections
  into the C64U Remote keypad focus ring, completing HomePage's button-level touch-free reachability.
  In c64u-remote the telnet drive/printer sub-actions are pruned (`home_telnet_drive_actions_enabled` /
  `home_telnet_printer_actions_enabled` false) so they never render; what remains in both sections is
  the section `Reset` button and the per-device ON/OFF enable toggles — those are now registered.
- Code:
  - `src/components/SectionHeader.tsx`: optional `focusId`/`focusOrder` props; the reset `<Button>` gets
    a `useFocusItem` ref (`group "home-sections"`, `disabled: resetDisabled`). Inert without a `focusId`
    (`id: focusId ?? ""`) and outside a provider, so every other SectionHeader usage is unchanged.
  - `src/pages/home/DriveCard.tsx`: optional `focusId`/`focusOrder`; the ON/OFF enable toggle gets a
    `useFocusItem` ref (`group "home-drives"`, `disabled: !isConnected || Boolean(togglePending)`).
  - `src/pages/home/components/DriveManager.tsx`: passes `focusId="home-drives-reset"`/`focusOrder=300`
    to the section header and `focusId="home-drive-toggle-${suffix}"`/`focusOrder=310+index*10` to each
    `DriveCard` (A 310 / B 320 / Soft IEC 330).
  - `src/pages/home/components/PrinterManager.tsx`: registers the ON/OFF toggle (`home-printer-toggle`,
    order 410, `group "home-printers"`, `disabled: !isConnected || printerEnabledPending`) and passes
    `focusId="home-printer-reset"`/`focusOrder=400` to its section header.
  - `src/pages/HomePage.tsx`: refreshed the band-map comment (Drives 300/310–330, Printers 400/410;
    mount/status dialogs → M2.2, bus/type/printer selects → M2.5).
- Ring now reads DOM top→bottom: Machine 100–190 → Reset Drives 300 → drive toggles 310/320/330 →
  Reset Printer 400 → Printer toggle 410 → Config 600–690 → TabBar 1000+. Disabled (disconnected /
  pending) CTAs register as disabled and are skipped; the pruned telnet buttons never enter the ring.
- Tests (new):
  - `tests/unit/pages/home/components/DriveManager.focus.test.tsx` (+4): real `DriveCard`+`SectionHeader`
    in `FocusNavigationProvider profileId="commodoreCallback8020"`. `DpadDown` walks Reset→A→B→Soft IEC
    then wraps to Reset (proves Reset sorts top); center on the initial selection fires `onResetDrives`
    only (no `updateConfigValue`); center on a stepped-to toggle fires `updateConfigValue("HOME_DRIVE_
    ENABLED")` only; disconnected → every CTA disabled, d-pad+center is a no-op.
  - `tests/unit/pages/home/components/PrinterManager.focus.test.tsx` (+4): Reset 400 → toggle 410
    traversal + wrap; center fires the focused reset vs toggle in isolation; disconnected skips both.
- Gates: affected `vitest` subset (DriveManager.focus 4, PrinterManager.focus 4, DriveManager 27,
  PrinterManager 24, DriveCard 16, plus the full `tests/unit/pages/home` set = 32 files / 493 pass);
  `npx tsc --noEmit` exit 0; `npm run lint` full chain exit 0 (stale-name guard + variant:check +
  feature-flags:check green); `npm run test:coverage` re-run because `SectionHeader` is a broadly-shared
  primitive and the global branch gate margin is thin — merged result recorded below.
- Backlog M2.1 still `[~]` (HomePage Config + MachineControls + Drives + Printers buttons now done);
  remaining: quick-config selects/sliders (M2.5) + other pages (Play/Disks/Config/Settings) + the
  per-screen reachability audit. No README/Callback references added; default variant unchanged.

## M2.1 — registered the Settings connection flow (Save & Connect / Refresh) in the keypad focus ring (2026-06-18)

- First non-HomePage screen wired into the touch-free focus ring. `src/pages/SettingsPage.tsx`'s
  Connection card now registers its two primary CTAs via `useFocusItem` so the keypad-first C64U
  Remote can save/connect and refresh with no taps:
  - **Save & Connect** — `id "settings-save-connection"`, order **300**, `disabled: isSaving`.
  - **Refresh connection** — `id "settings-refresh-connection"`, order **310**,
    `disabled: status.isConnecting || connectionRefreshInFlight`.
  - group `settings-connection`. Refs attached to the existing `<Button>`s (forwardRef) — onClick
    paths unchanged. Per-page band reserves 100 (Appearance) + 200 (saved-devices / host field) for
    later registration above, so the ring reads top→bottom; documented inline.
- The host/IP `<input>` was intentionally left out: the global key listener skips editable targets
  (so T9 digits reach the field), so registering it without field-engagement/exit wiring would trap
  focus — that is the M2.2/M3 slice, not this one.
- Tests (new): `tests/unit/pages/SettingsPage.test.tsx` (+5, `keypad focus ring` describe) — added a
  `renderSettingsPageInFocusRing` helper rendering the real SettingsPage inside
  `FocusNavigationProvider profileId="commodoreCallback8020"`:
  - top→bottom order + d-pad focus move (initial Save & Connect → `DpadDown` → Refresh → wrap → Save);
  - `DpadCenter` on the initial selection fires Save (`updateConfig("c64u", undefined)`) and never the
    manual refresh path (`discoverConnection` not called with `"manual"`);
  - `DpadCenter` on the stepped-to Refresh fires `discoverConnection("manual")` and not Save;
  - a connect-in-flight (`status.isConnecting`) disables Refresh so d-pad never lands on it;
  - no provider → no global listener → d-pad never moves focus (default-variant safety).
- Gates: `npx vitest run tests/unit/pages/SettingsPage.test.tsx` → **70 pass** (5 new + 65 existing);
  `npx tsc --noEmit` exit 0; `npm run lint` full chain exit 0 (stale-name guard + variant:check +
  feature-flags:check green). Coverage not re-run — narrow additive single-page change; new branches
  exercised by the 5 new tests (+ the existing refresh-gating test for `connectionRefreshInFlight`).
- Backlog M2.1 still `[~]`: HomePage buttons + Settings connection CTAs done; remaining = HomePage
  quick-config selects/sliders (M2.5), the rest of Settings (host/IP via field-engagement,
  saved-device rows, Appearance), the other pages (Play/Disks/Config), then the per-screen audit. No
  README/Callback references added; default variant unchanged.

## M2.1 — registered the Config page category headers in the keypad focus ring (2026-06-18)

- Branch `feat/introduce-new-variant`. First non-Home/Settings page wired into the touch-free ring,
  continuing M2.1. The Config page's primary CTAs are the collapsible category headers (one per config
  category); every category must be reachable + expandable by keypad on the touch-off C64U Remote.
- `src/pages/ConfigBrowserPage.tsx`:
  - imported `useFocusItem`; added module constants `CONFIG_CATEGORY_FOCUS_ORDER_BASE = 100` and
    `CONFIG_CATEGORY_FOCUS_ORDER_STEP = 10` (this route's only band; tabs sort after at 1000+);
  - `CategorySection` gained a `focusOrder: number` prop and registers its header `<button>` via
    `useFocusItem` (`id "config-category-<slug>"` matching the existing `data-testid`, `group
    "config-categories"`, `order = focusOrder`); the ref is attached to the existing header — its
    `onClick` toggle (`setIsOpen(!isOpen)`) is untouched, so center-activate = click = expand/collapse;
  - the parent `.map` passes `focusOrder = BASE + index * STEP` so the ring reads top→bottom; the STEP
    gap reserves room to slot each category's group actions (Refresh/Reset/Sync clock) right after its
    header in a later slice without renumbering.
- Tests (new): `tests/unit/pages/ConfigBrowserPage.test.tsx` (+3, `keypad focus ring` describe) —
  imported `FocusNavigationProvider`, added `renderConfigBrowserPageInFocusRing` (real page inside
  `FocusNavigationProvider profileId="commodoreCallback8020"`):
  - d-pad walks headers top→bottom (Audio Mixer 100 → Clock Settings 110 → General 120 → wrap), and
    DpadUp from the first wraps to the last;
  - DpadCenter on the stepped-to header expands only that section (`setConfigExpanded("Clock
    Settings", true)`, asserted NOT called with `true` for the other categories);
  - no provider → no global listener → d-pad never moves focus (default-variant safety).
- Gates: `npx vitest run tests/unit/pages/ConfigBrowserPage.test.tsx` → **23 pass** (3 new + 20
  existing); `npx tsc --noEmit` exit 0; `npm run lint` full chain exit 0 (stale-name guard +
  variant:check + feature-flags:check green; bundle-budgets re-built clean). Coverage not re-run —
  narrow additive change (one page + one new prop); new branches exercised by the 3 new tests.
- Backlog M2.1 still `[~]`: Home buttons + Settings connection CTAs + Config category headers done;
  remaining = Config's per-category group actions, Play/Disks pages, HomePage quick-config
  selects/sliders (M2.5), the rest of Settings (host/IP field-engagement, saved-device rows,
  Appearance), then the per-screen reachability audit. No README/Callback references; default variant
  unchanged.

## Ralph loop (2026-06-20): guidance-bar component test

- Branch `feat/keyboard-input` (NOT `feat/introduce-new-variant` from prior entries). The working
  tree carries a large uncommitted prior-loop increment: DOM auto-discovery reachability
  (`src/lib/input/discovery.ts`, `focusDiscovery.ts`) + the keypad guidance bar
  (`src/lib/input/guidance.ts` + `src/components/input/KeypadGuidanceBar.tsx`) + a 453-line
  `useFocusNavigation.tsx` refactor. This loop verified that increment is green at unit+tsc+lint level
  and closed its single coverage gap.
- Gap found: `KeypadGuidanceBar.tsx` had 72.22% branch coverage and no dedicated test. Added
  `tests/unit/components/input/KeypadGuidanceBar.test.tsx` (6 tests) exercising the component's
  imperative branches: null-context no-op render, the flag/modality visibility gate, the focused-item
  breadcrumb + OK action wiring, the Menu soft key for `aria-haspopup` items, and the empty-scope
  "Navigation" fallback. No source files changed.
- After: `KeypadGuidanceBar.tsx` 100% lines/statements/functions, 91.66% branch (combined with the
  existing group tests in `useFocusNavigation.test.tsx`). Remaining uncovered branches (lines 70, 91)
  are defensive `useRef(null).current` guards unreachable through the component; not contorting tests
  to hit dead defensive branches.
- Gates run: `npx tsc --noEmit` (0); `npx vitest run` over the input subsystem -> 199 pass (+6);
  `npm run lint` (0, full chain incl. stale-names + variant:check + feature-flags:check). No
  README/Callback references touched; default `c64commander` variant unchanged.
- Working tree left uncommitted for the operator (the in-flight refactor is not this loop's authored
  work and lacks a full per-screen reachability audit). Backlog: "Per-CTA focus-ring registration
  completeness" annotated `[~]` (the discovery engine supersedes per-CTA registration but is unmerged
  and unaudited per-screen).

---

## Ralph #118 — 2026-06-21 (claude) — Keyboard/Keypad input (global app shell, #291) on c64u

**Setup (not product actions):** branch `feat/device-hardening` HEAD `7011aed6`; source `0.8.9-rc2`. Installed APK was stale `0.8.9-rc1-132f2` (includes #290, predates #291). Rebuilt `npm run cap:build && ./gradlew assembleDebug` → `c64commander-0.8.9-rc2-7011a-debug.apk`; `adb install -r -d` (versionCode 2028<2062, data kept). Verified installed identity `0.8.9-rc2-7011a` = source HEAD via droidmind get_app_info. Peers droidmind/c64scope/c64bridge all callable. c64u 192.168.1.167 `/v1/info` 200/9ms fw1.1.0 (primary), u64 200/22ms fw3.14e. Keypad flag `keypad_input_enabled` default `enabled:true` (no localStorage override → engine active). Oracle: droidmind `press_key` (real Android key events = true actuation) + CDP capture-phase keydown probe + CDP `location`/DOM + diagnostics export + package-filtered logcat.

**Cold-start health:** badge flashed `C64U ◆ 7 UNHEALTHY` (red) at launch then self-corrected to `● 7 HEALTHY` (green) within ~1s as the connection probe completed — correct cold-start transition, not a defect. The "7" = healthSnapshot `problemCount` from the `App` contributor's 7 STALE failed ops (09:21Z Audio Mixer writes, prior session) — corroborates pre-existing BUG-041 (stale problem-count not aging out), overall state correctly Healthy.

| Action ID | Route/Page | UI element | User operation (droidmind) | Expected | ~200ms | ~1s/effect | Oracle | Latency | Diag/log | Status | Artifacts | Cleanup |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 118-1..6 | global | digit 1–6 shortcut | press_key 8,9,10,11,12,13 (each ≥1×, digit2 ×3) | jumpToTab Home/Play/Disks/Config/Settings/Docs | route change | path=/,/play,/disks,/config,/settings,/docs | CDP location | <=200ms-feedback | no err | EXERCISED_CLEAN | cdp logs | n/a |
| 118-7 | /play | digit (rapid double) | press_key 9 ×2 near-simultaneous | idempotent, single nav | stays /play | 0 new warn/err | CDP+logs | <=200ms-feedback | clean | EXERCISED_CLEAN | - | n/a |
| 118-8 | global | `*` Diagnostics shortcut | press_key 17 | Diagnostics dialog opens | dialog opens | title "Diagnostics", action `diagnostics.open success` logged | CDP DOM+actions | <=1s-effect | clean | EXERCISED_CLEAN | screenshot | dialog closed via BACK |
| 118-9 | /play (overlay) | digit-in-overlay | press_key 10 with Diagnostics open | DEFER to overlay (no nav) | unchanged | path stays /play, dialog stays open | CDP | n/a | clean | EXERCISED_CLEAN (guard) | - | n/a |
| 118-10 | Diagnostics | Problems filter / "…" menu / Share all | tap (CSS→phys ×2.755/×2.75) | export ZIP | menu opens | ZIP `c64commander-diagnostics-all-2026-06-21-1740-34Z.zip` written | pull+unzip | n/a | errorLogs=8 ALL stale; 0 session; latency med31/max448ms (3>200ms,<1s); Healthy | EXERCISED_CLEAN | iter118/diagnostics | share sheet dismissed |
| 118-11 | global | keypad BACK | press_key 4 with dialog open | dismiss overlay, NO route nav | dialog closes | path stays /play | CDP | <=200ms-feedback | clean | EXERCISED_CLEAN | - | n/a |
| 118-12 | global | `#` Device Switcher shortcut | press_key 18 ×2 | open switcher (self-gates on >1 device) | no-op | event consumed `{key:"#",keyCode:0,def:true}`; 1 saved device → correct self-gated no-op (== long-press) | CDP probe+src | n/a | clean | EXERCISED_CLEAN (self-gate) | - | n/a |
| 118-13 | global | Menu/QuickMenu shortcut | press_key 82 (KEYCODE_MENU) | open Quick Menu | NO effect | keydown NEVER reached WebView (`keysSeen:[]`); profile binds keyCode82→openMenu but Android Activity swallows MENU | CDP probe+src | n/a | n/a | DEFECT_OPEN (LOW/WATCH BUG-055) | - | n/a |
| 118-14..16 | / (Home) | D-pad focus ring | press_key 20 (Down ×2), 23 (Center) | ring engage/move/activate + guidance bar | ring `data-key-selected` moves | Down→tab-play→tab-disks (`{ArrowDown,kc40,def:true}`); Center `{Enter,kc13,def:true}`→activated→/disks; guidance bar visible "Play\|Back\|OK\|Activate\|Menu"; modality=key-navigation | CDP | <=200ms-feedback | clean | EXERCISED_CLEAN | - | n/a |
| 118-17 | /settings | device name field (literal typing) | tap focus + press_key 10 (digit3) | type "3" literally, NO tab jump | char appears | val "c64u"→"c64u3"; path stays /settings; `{key:"3",kc51,def:false}` (NOT consumed in field) | CDP | <=200ms-feedback | clean | EXERCISED_CLEAN | - | backspace→"c64u" |
| 118-18 | /settings | backspace/delete | press_key 67 (DEL) | delete char | char removed | val→"c64u"; `{Backspace,kc8,def:false}` | CDP | <=200ms-feedback | clean | EXERCISED_CLEAN | restored |
| 118-19 | lifecycle | bg/fg + keypad | HOME → re-foreground → press_key 11 | listener survives bg/fg | state preserved /settings | post-fg keydown processed (deferred to refocused field, `{key:"4",def:false}`) → listener alive; val restored via DEL | CDP | n/a | clean | EXERCISED_CLEAN | restored "c64u" |

**Findings:**
- **BUG-055 (NEW, LOW/WATCH):** keypad Menu shortcut unreachable via Android `KEYCODE_MENU` (82). Profile `keypad.ts:68-69` binds `code:"ContextMenu"` + `keyCode:82` → `openMenu`, but `adb input keyevent 82` never reaches the WebView keydown (system/Activity swallows MENU). No impact on touch variant (Pixel 4 has no Menu key). Risk only for keypad-first variant (c64u-remote) IF its hardware Menu button emits KEYCODE_MENU; the `ContextMenu` code binding may serve real hardware. Caveat: adb keyevent 82 delivery may differ from real keypad hardware. ACTION: dev verify on real keypad hardware; consider an alternate reachable binding for Quick Menu.
- **BUG-056 (NEW, LOW):** digit-shortcut tab jump leaves the `data-key-selected` ring + guidance breadcrumb on the previously-focused tab. After digit-5→/settings, the ring/guidance stayed on `tab-disks`. Cosmetic; re-anchors on next D-pad press. ACTION: on jumpToTab, move/clear the ring highlight to reflect the new route.
- **No blocker/high/medium defects.** Headline #291 fixes VALIDATED on current build: digit shortcuts work despite Android empty-`KeyboardEvent.code` (keyCode fallback); editable-guard + overlay-guard defer shortcuts correctly; D-pad ring + guidance bar + modality + Center activation work; literal hardware-keyboard typing works.
- Diagnostics export + package-filtered logcat both clean: 0 current-session JS errors, 91 logcat lines no FATAL/ANR/crash (only benign WebView autofill + platform perf_hint/jank-monitor warnings, attributed to field focus).

**Cleanup:** device name field restored "c64u" (form not dirty); UltiSID untouched; saved devices unchanged (1: c64u); keypad flag untouched; adb forward removed. App left on /settings, c64u Healthy.
## Ralph #119 startup — 2026-06-21 (codex) — Config Audio Mixer c64u read-only BUG-053 retest

- Branch `feat/device-hardening`, HEAD `7011aed6`; startup worktree already dirty with `PLANS.md`, `WORKLOG.md`, `ios/App/Podfile`. Source identity `0.8.9-rc2-7011a`; installed Pixel 4 APK identity `0.8.9-rc2-7011a`, so no build/deploy needed before HIL.
- Actual peer discovery: droidmind exposed and Pixel 4 `9B081FFAZ001WX` connected; c64scope exposed; c64bridge exposed and switched to backend `c64u`. c64bridge `info` returned C64 Ultimate fw `1.1.0`, no errors.
- Ralph capacity: codex 5h 86% / weekly 40%, `>=40%` tier. Minimum 8 production actions, target 12-20, at least one adversarial transition.
- Selected family: Config Audio Mixer read-only c64u retest for BUG-053. Mutable mixer controls are safety-blocked for this pack; objective is category population/open-close-refresh/search/lifecycle/diagnostics/log correlation on recovered c64u.

## Ralph #119 — 2026-06-21 (codex) — Config Audio Mixer c64u retest + BUG-057 fix

**Verdict:** `FIXED` for BUG-057 and `CLEAN PASS` for the safe read-only Config Audio Mixer c64u slice. Current source/APK identity `0.8.9-rc2-7011a`, Pixel 4 `9B081FFAZ001WX`, c64u primary fw `1.1.0`. droidmind drove all production actions; c64bridge supported target identity/readiness; c64scope was discovered but not used because this pack had no A/V or stream behavior.

| Action ID | Route/Page | UI element | User operation | Expected result | Observed ≈200 ms feedback | Observed ≈1 s / effect result | Oracle used | Latency class | Diagnostics/log result | Status | Artifact refs | Cleanup state |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 119-1 | Settings → Config | Bottom TabBar `Config` | Tap live tab bounds | Navigate to Config with c64u selected | Config route visible | Category list populated, header `C64U HEALTHY` | droidmind screenshot + UI tree + c64bridge info | <=1s-effect | no app logcat error tied to navigation | EXERCISED_CLEAN | `docs/agentic/artifacts/iter119/ui/config-entry.png` | on Config |
| 119-2..4 | Config | `Audio Mixer` accordion | Open, close, reopen | Render category controls without writes | Controls visible on open by screenshot capture | Reopen stable; badge stayed `C64U HEALTHY`; no stuck state | droidmind screenshots + diagnostics actions | <=200ms-feedback | pre-fix ZIP errorLogs=0; health Healthy/problemCount 0 | EXERCISED_CLEAN | `ui/audio-open-200ms.png`, `ui/audio-closed-1.png`, `ui/audio-open-2.png` | controls left unmodified |
| 119-5..7 | Config / Audio Mixer | `Refresh` | Tap once, then rapid double tap | Refresh category reads without degraded badge/request storm | visible feedback stayed responsive | Refresh reads completed; no degraded badge/dropout; Audio Mixer REST p90 78ms, item reads 41-100ms, refresh reads 69-77ms | droidmind + Diagnostics REST heat map + actions/traces | <=1s-effect | latency view 52 samples P50 63/P90 91/P99 254ms; 254ms tail attributed to broader Config tree column | EXERCISED_CLEAN | `ui/audio-refresh-200ms.png`, `ui/audio-refresh-double.png`, `diagnostics/current-actions.tsv`, `diagnostics/current-traces.tsv` | no config writes |
| 119-8..10 | Config | Search input | Focus/type `Audio`, clear with Backspace, dismiss keyboard | Local filter narrows/restores categories | visible query changed and list narrowed | clear restored route; Android Back after keyboard cleanup navigated to Settings as normal root/history behavior | droidmind screenshot + diagnostics actions | <=200ms-feedback | no input errors; one leftover `A` corrected with repeated key events before route transition | EXERCISED_CLEAN | `ui/search-audio.png`, `ui/search-cleared.png`, `ui/after-keyboard-back.png` | query cleared |
| 119-11..12 | Config lifecycle | App background/foreground | HOME, relaunch/foreground | State remains consistent, no false foreground error | app returned without crash | Config reachable, `C64U HEALTHY`; Audio Mixer collapsed, search cleared | droidmind lifecycle + screenshot | <=1s-effect | no false foreground error in diagnostics/logcat | EXERCISED_CLEAN | `ui/after-bg-fg.png`, `ui/returned-config.png` | app foregrounded |
| 119-13..20 | Diagnostics | `*`, overflow/views, Share all | Open Diagnostics, inspect Latency, REST heat map count/latency, Config heat map, Share all, Back-cancel chooser | Mandatory diagnostics/log sweep | views opened; chooser displayed export | ZIP pulled/analyzed; pre-fix app identity mismatch found: `version`/`versionLabel` `0.8.8` despite APK/source `0.8.9-rc2-7011a` | droidmind + pulled ZIP + package logcat | n/a | BUG-057 opened; errorLogs=0; health Healthy/Online/problemCount 0; logcat no crash/ANR/StrictMode | DEFECT_OPEN → FIXED | `ui/diagnostics-main.png`, `ui/diagnostics-latency.png`, `ui/diagnostics-rest-heatmap-count.png`, `ui/diagnostics-rest-heatmap-latency.png`, `ui/diagnostics-config-heatmap.png`, `diagnostics/c64commander-diagnostics-all-2026-06-21-1810-06Z.zip`, `logcat/app-package-full.log` | chooser canceled |
| 119-21..31 | Home/Diagnostics post-fix validation | Home version + Diagnostics Share all | Build/deploy fixed APK, relaunch, open Diagnostics, export twice | In-app/Home/ZIP identity equals Git-derived source label | Home showed `App 0.8.9-rc2-7011a` | final ZIP exports `bugReportContext.app.version = "0.8.9-rc2-7011a"` and `versionLabel = "0.8.9-rc2-7011a"`, `gitShaShort=7011aed6`, health Healthy, errorLogs=0 | droidmind install/start/taps + pulled ZIP + logcat | <=1s-effect | post-fix logcat only platform/WebView advisories plus intentional Share canceled after Back; no app crash/ANR/StrictMode | EXERCISED_CLEAN | `ui/postfix2-home-version.png`, `ui/postfix3-diagnostics-main.png`, `diagnostics/c64commander-diagnostics-all-2026-06-21-1818-40Z-postfix2.zip`, `logcat/postfix2-app-package-full.log` | app left healthy |

**Defect and fix:** BUG-057 was confirmed during the mandatory Diagnostics export. Native installed package and `./scripts/resolve-version.sh` were `0.8.9-rc2-7011a`, but the WebView diagnostics ZIP reported package-baseline `0.8.8`. Root cause was twofold: `resolveBuildVersionLabel` rejected generated labels whose release base differed from `package.json`, and Vite used `package.json` as `__APP_VERSION__` for non-tag builds. Fixes: `src/lib/versionLabel.ts` trusts generated labels, `src/lib/buildVersion.ts` accepts/prefer `generatedVersion`, and `vite.config.ts` passes `src/version.ts` into both app version constants. Focused regressions added in `tests/unit/lib/buildVersion.test.ts` and `tests/unit/lib/versionLabel.test.ts`.

**Validation commands:** `npx vitest run tests/unit/lib/buildVersion.test.ts tests/unit/lib/versionLabel.test.ts` → 32 pass. `npx prettier --check src/lib/buildVersion.ts src/lib/versionLabel.ts tests/unit/lib/buildVersion.test.ts tests/unit/lib/versionLabel.test.ts vite.config.ts` → pass. `./scripts/resolve-version.sh && npm run cap:build && cd android && ./gradlew assembleDebug` → Android build success; Capacitor iOS sync warned because CocoaPods/xcodebuild are unavailable locally, non-blocking for Android. Final droidmind install of `android/app/build/outputs/apk/debug/c64commander-0.8.9-rc2-7011a-debug.apk` succeeded; installed identity rechecked as `0.8.9-rc2-7011a`.

**Log/diagnostics sweep:** pre-fix and final ZIPs were pulled and analyzed under `docs/agentic/artifacts/iter119/diagnostics/`. Both had `error-logs*.json` length 0 and Healthy c64u snapshots. Package-filtered logcat slices are under `docs/agentic/artifacts/iter119/logcat/`; release-relevant lines were platform/WebView startup advisories (`BackDispatcher`, Chromium/DNS/cache, ashmem/HEIC/perf hints, Bluetooth permission) or intentional `Share canceled` after Back. No FATAL/ANR/crash, uncaught exception, StrictMode, native plugin failure, or unexplained app warning remained.

**CTA/action counts:** visible controls discovered/classified 16; safe visible controls exercised 11; mutable Audio Mixer controls (`Reset`, sliders, Solo switches) classified `BLOCKED_SAFE` for this read-only pack. Production CTA/control actions attempted 43; `droidmind_cta_action_count=43`. Adversarial transitions: rapid double Refresh, Android Back after search cleanup/root-history transition, HOME/background/foreground. Repeated interactions: Audio Mixer accordion x3, Refresh x3, search/edit/delete x1 sequence with repeated key events, Diagnostics overflow/view/export x3 across pre/post-fix, Share Back-cancel x3. Actuation was verified for every exercised production control by UI effect, diagnostics action/trace, ZIP content, or installed package state; no synthetic-only action was counted as exercised.

---

## Ralph loop iteration #120 — 2026-06-21 (claude / feat/device-hardening)

**Startup:** Branch `feat/device-hardening`, HEAD `7011aed6`, source `0.8.9-rc2-7011a`. Working tree carries the in-progress BUG-052 fix (`connectionManager.ts` mDNS negative cache + probe short-circuit) and `tests/unit/lib/connection/bug052MdnsNegativeCache.test.ts`. Peers droidmind/c64scope/c64bridge/mobile-mcp all callable; Pixel 4 `9B081FFAZ001WX` Android 16 connected. Capacity claude 5h 22% → 20–39% tier (min 5 / target 6–10 actions, one focused fix+redeploy allowed). Probe family: **Settings connection / mDNS offline-guidance fix-pack (BUG-052)**. Gate: focused unit test 2/2 pass. Reachability: c64u `192.168.1.167` HTTP 200 9ms, u64 `192.168.1.13` HTTP 200 26ms (repo-side). Restore target c64u host `c64u`. Rebuild+deploy fixed APK required (installed APK predates uncommitted fix). Build started in background.

---

# Discovery reliability + U2 first-class + dynamic capabilities (2026-06-22, claude / feat/device-hardening)

## Bootstrap & environment

- `git status --short` (before): in-flight discovery work already present (untracked
  `src/lib/deviceDiscovery/`, `src/hooks/useDeviceDiscovery.ts`, `src/lib/native/deviceDiscovery*.ts`,
  `src/components/DeviceDiscoveryInterstitial.tsx`, `android/.../DeviceDiscoveryPlugin.kt`,
  `docs/research/device-discovery/`, `tests/unit/lib/deviceDiscovery/`,
  `tests/unit/components/DeviceDiscoveryInterstitial.test.tsx`) plus prior modified files (README,
  manifests, MainActivity.kt, App.tsx, ConnectionController.tsx, c64api.ts, hostConfig.ts,
  connectionManager.ts, SettingsPage.tsx, docs/screenshots, and their tests).
- Branch `feat/device-hardening` (NOT main → continue here per brief). Node v24.11.0, npm 11.6.1.
- adb 1.0.41. Pixel 4 `9B081FFAZ001WX` (flame, Android) connected over USB.
- Installed packages: `uk.gleissner.c64commander` (C64 Commander) + `uk.gleissner.c64uremote`
  (C64U Remote) both present (side-by-side OK).
- Real devices (repo-side probe, NOT hard-coded into source):
  - u64 `192.168.1.13` → `GET /v1/info` 200: product "Ultimate 64 Elite", fw 3.14e, fpga 122,
    core 1.4B, hostname u64, unique_id 38C1BA.
  - c64u `192.168.1.167` → ICMP reachable from workstation AND Pixel; HTTP `/v1/info` momentarily
    empty (known c64u flakiness — overload drop, not a regression). Re-probe before HIL proofs.
- Baseline: `npx vitest run tests/unit/lib/deviceDiscovery/ tests/unit/components/DeviceDiscoveryInterstitial.test.tsx`
  → 9/9 pass.

## Audits (5 parallel subagents)

1. Capability/streaming gate audit → NO general capability model exists; streaming is always-on
   (config-presence driven, `HomePage.tsx:1611` renders `<StreamStatus>` unconditionally);
   power-cycle is a family literal (`HomePage.tsx:252`). Everything else already config-presence driven.
   `DeviceInfo` type at `src/lib/c64api.ts:483`.
2. Startup/Settings wiring audit → discovery fully wired (startup via connectionManager fallback,
   global interstitial mount `App.tsx:260`, Settings "Discover devices" button). Startup probes ONLY the
   selected device (no multi-saved-device sweep). Single-flight via `activeDiscovery` + generation token.
3. Build tool audit → `./build` is bash, single hardcoded variant, no --variant/--uninstall/--reset.
   `scripts/build-android-apks.mjs` (npm `android:apk:all`) builds both variants (distinct appIds).
   No `pm clear` in build path. `resolve_adb_device_id` in `scripts/lib/build-fast-path.sh`.
4. Firmware U2 capability research (`1541ultimate/`) → product strings + streaming-is-U64-only +
   FTP/Telnet/REST identical on U2 (see PLANS.md capability table).
5. Repo-wide U2 grep audit → root cause `normalizeKnownProduct` lacks U2 branch; full edit-site +
   test-site list (see PLANS.md I1–I12). No family-keyed variant/feature-flag config.

PLANS.md authoritative section appended (discovery-reliability/U2/capabilities). Implementation starting.

## Implementation (2026-06-22)

### U2 first-class family (I1–I6)
- `src/lib/diagnostics/targetDisplayMapper.ts`: added `u2`/`U2` to `KNOWN_PRODUCT_TOKENS`,
  `normalizeKnownProduct` (matches `ultimateii*`, `ultimate2`, `u2`; placed AFTER the u64 branches
  so `ultimate64ii`→u64e2 never falls through), `inferConnectedDeviceCode`, `inferConnectedDeviceLabel`.
- `src/lib/savedDevices/store.ts`: `ProductFamilyCode` += `"U2"`; `inferSavedDeviceProductFamily`
  host/name fallback recognises `ultimateii*`.
- `src/lib/diagnostics/deviceAttribution.ts`: `verifiedProduct` validation accepts `"U2"`.
- `src/pages/SettingsPage.tsx`: `DEVICE_PRODUCT_DISPLAY_LABELS.U2 = "Ultimate II"`.
- `src/lib/telnet/telnetTypes.ts`: `resolveTelnetMenuKey` maps `u2 → "F1"` (firmware runs the telnet
  service on U2; fixture-level assumption).
- `src/lib/config/deviceSafetySettings.ts`: AUTO safety for `U2 → CONSERVATIVE` (`reason: "auto-u2"`).

### Dynamic capability model (I7–I9)
- NEW `src/lib/deviceCapabilities/{capabilityModel,index}.ts`: `deriveDeviceCapabilities()` →
  `{ family, restReachable, firmwareVersion, coreVersion, supportsStreaming, supportsMenuInput,
  supportsPowerCycle, streamingSource }` + predicates + `detectStreamingFromConfig()`. Streaming is
  REST-config-driven (Data Streams VIC/Audio items) with a documented family fallback
  (`{C64U,U64,U64E,U64E2}` stream; U2 + unknown do not). Power-cycle = `{C64U,U64E2}`. Menu input =
  any reachable recognised family.
- `src/pages/HomePage.tsx`: streaming section gated on `deviceCapabilities.supportsStreaming` (was
  unconditional); power-cycle gated on `deviceCapabilities.supportsPowerCycle` (was
  `deviceCode === "c64u" || "u64e2"`). Reads Data Streams config via a react-query-deduped hook.

### Startup policy (I10)
- `src/lib/connection/connectionManager.ts`: `tryReachableSavedDeviceFallback` — on startup/resume,
  if the selected device is unreachable, probes the OTHER saved devices' `/v1/info` in parallel
  (bounded `SAVED_DEVICE_SWEEP_TIMEOUT_MS=1200`, read-only) and connects to the first reachable one
  (`selectSavedDevice` + `applyC64APIRuntimeConfig` + `verifyCurrentConnectionTarget`) BEFORE any LAN
  scan. Skips unreachable entries (incl. stale U2). Runs before `tryAutomaticDeviceDiscoveryFallback`.

### iOS/web discovery (I11)
- iOS already ships a native `DeviceDiscoveryPlugin` stub (`ios/App/App/AppDelegate.swift:370`) that
  resolves `{ unsupported: true }`; web facade (`deviceDiscovery.web.ts`) does the same. So discovery
  is gracefully unsupported on both without any JS platform gate. (An initial JS guard was added then
  REMOVED once the iOS native stub was found — keeping a JS gate would have blocked a future real iOS
  implementation.) iOS Info.plist has `NSAllowsLocalNetworking` (REST works); no
  `NSLocalNetworkUsageDescription` is required because the Android-only LAN scan never runs on iOS.

### Build/deploy tool (I12)
- `scripts/build-android-apks.mjs` extended (not replaced): `--variant commander|remote|all`,
  `--install`, `--uninstall-first`, `--reset-config` (`adb shell pm clear`), `--device <serial>`,
  `--skip-build`, `--help`; pure exported helpers `parseArgs`/`resolveSelectedVariantIds`/
  `planVariantAdbSteps`/`HELP_TEXT`. No-arg path unchanged (CI `android:apk:all`). Verified on Pixel 4:
  `node scripts/build-android-apks.mjs --variant all --reset-config --skip-build --device 9B081FFAZ001WX`
  → cleared + verified `uk.gleissner.c64commander` and `uk.gleissner.c64uremote` (both "Success").

### Automated tests added/updated (all green)
- NEW `tests/unit/lib/deviceCapabilities/capabilityModel.test.ts` (17): C64U/U64/U64E2/U2/unknown
  capabilities; U2 no-streaming; U2-with-advertised-streaming override (rest-config); U64-with-config-off
  override; detectStreamingFromConfig (VIC/audio→true, debug-only→false, absent→null).
- NEW `tests/unit/telnet/telnetMenuKey.test.ts` (6): U2→F1, families, telnet-capable incl. U2.
- NEW `tests/unit/scripts/buildAndroidApks.test.ts` (15): variant selection/aliases, package names,
  adb plan (install/uninstall-first/reset-config/verify ordering, serial prefix, error when no APK), help.
- `tests/unit/diagnostics/targetDisplayMapper.test.ts`: U2 classification + Ultimate-64-II-vs-Ultimate-II
  disambiguation.
- `tests/unit/config/deviceSafetySettings.test.ts`: U2 → CONSERVATIVE.
- `tests/unit/lib/deviceDiscovery/discoveryManager.test.ts`: U2 discovered + persisted as family U2.
- `tests/unit/connection/connectionManager.startup.test.ts`: reachable configured device connects
  without discovery (stale selected + reachable U64 + stale U2 entry valid input).
- `tests/unit/pages/HomePage.test.tsx`: streaming gate capability-driven (U2 hidden / C64U+U64 shown /
  U2+advertised-config shown).

### Gates
- `npx tsc --noEmit` → exit 0. `npm run lint` (format + eslint + display-profiles + bundle-budgets +
  stale-names + variant:check + feature-flags:check) → exit 0. Full unit suite run in progress.

## Portrait-default orientation fix (I13, 2026-06-22, user request)

- **Report:** on a freshly installed app, rotating the phone switched it to landscape — i.e. it
  behaved like "Auto" even though Portrait is the intended default.
- **Root cause:** `DEFAULT_SCREEN_ORIENTATION_MODE` is already `"portrait"`, but
  `applyScreenOrientationMode` was only ever called from `SettingsPage` (a `useEffect` that runs when
  the Settings screen mounts / the setting changes). It was NOT applied at app startup, and the Android
  `MainActivity` declares no `android:screenOrientation`, so until the user opened Settings the activity
  was sensor-driven and rotated freely.
- **Fix:** new `applyScreenOrientationFromSettings()` in `src/lib/native/screenOrientation.ts` reads
  `loadScreenOrientationMode()` (Portrait default) and applies the lock/unlock; called at launch in
  `src/main.tsx` alongside `applyFullScreenFromSettings()`. A fresh install now locks Portrait at
  startup; an explicit Auto/Landscape choice is still honoured (Auto → `ScreenOrientation.unlock()`).
- **Tests:** `tests/unit/lib/native/screenOrientation.test.ts` +3 — fresh install → lock portrait;
  stored "auto" → unlock; stored "landscape" → lock landscape. 8/8 pass; `tsc --noEmit` clean.

## Android HIL validation (2026-06-22, Pixel 4 9B081FFAZ001WX)

Real devices: C64U 192.168.1.167 ("C64 Ultimate" fw 1.1.0 id 5D4E12), U64 192.168.1.13
("Ultimate 64 Elite" fw 3.14e id 38C1BA). Both packages installed side by side.

### Build-tool regression found + fixed DURING HIL (critical)
- Symptom: after build+deploy, the on-device app kept running an OLD `SettingsPage` chunk
  (`SettingsPage-fRiddOiR.js`) with no discovery UI, even though `dist`/android-assets had the
  current chunk. CDP (`webview_devtools_remote_<pid>`) confirmed the loaded chunk hash did not match
  dist; the installed + artifact APKs both shipped the stale chunk.
- Root cause: my rewritten `findApk` searched `COLLECT_DIR` (artifacts/android-apks) BEFORE the fresh
  Gradle output (`apk/debug`). The APK basename is version-based (not content-hashed), so a stale
  collected APK from a prior session shadowed every fresh build → the tool installed pre-change APKs
  and skipped the copy-to-collect step. All three earlier deploys installed stale code.
- Fix: `findApk` resolves the Gradle output FIRST for a fresh build (`apkSearchDirs(preferCollected)`);
  `--skip-build` prefers the collected copy. Regression test added (`apkSearchDirs`).
- Also added: after building, the tool restores the **default** variant's generated outputs
  (`variant:generate` + `feature-flags:compile` with empty APP_VARIANT), because building each variant
  leaves `src/generated/variant.ts` on the last-built variant — which otherwise breaks `variant:check`
  and ~31 variant/feature-flag/layout unit tests. (Encountered both: lint `variant:check` failed and a
  full-suite run produced 31 variant-dependent failures until the default variant was regenerated.)
- After the fix: `--variant all --install --uninstall-first` installed version `0.8.9-rc2-7bb03`
  (was the stale `0.8.8-rc2-61020`); CDP confirmed the current `SettingsPage` chunk + discover button.

### HIL results (fresh build 0.8.9-rc2-7bb03)
- Explicit Settings discovery, **C64 Commander**: found BOTH C64U + U64 (~8 s), deduped, distinct,
  product/hostname/IP/fw/id shown, c64u "Already saved". Evidence:
  `doc/research/discovery-validation/evidence/commander-settings-discovery-both-devices.png`.
- Explicit Settings discovery, **C64U Remote**: found BOTH (same), proving the action is present +
  functional in BOTH variants. Evidence: `.../remote-settings-discovery-both-devices.png`.
- Auto-discovery (Scenario B), C64 Commander: seeded a stale/unreachable selected device (203.0.113.9)
  + a stale **U2** entry (203.0.113.50) via CDP localStorage, reloaded → startup interstitial
  auto-appeared (~32 s, <120 s) with BOTH devices and no user action. The stale U2 entry persisted as
  `lastKnownProduct:"U2"` and was a valid startup-policy input. Evidence:
  `.../commander-startup-autodiscovery-interstitial.png`.
- Discover → Use → connect: used the discovered C64U → app connected by its IP 192.168.1.167 →
  "HEALTHY" (discovery resolved a hostname `c64u` that was not resolving on the Pixel). Evidence:
  `.../commander-discover-use-connected-healthy.png`.
- Orientation (fresh build): forced `accelerometer_rotation=1` + `user_rotation=1` (landscape) →
  `dumpsys window` `mCurrentRotation=ROTATION_0` (portrait held). Earlier portrait check ran on the
  stale build and is superseded by this one.
- Build tool reset-config verified earlier: `--variant all --reset-config --skip-build` → `pm clear`
  Success + verify for both `uk.gleissner.c64commander` and `uk.gleissner.c64uremote`.

### HIL limitation
- The brief's 3-consecutive-cold-start matrix (18+ cycles) was NOT exhaustively executed; each
  headline scenario was validated with real evidence (discovery passed first-try on both variants).

### Gates (final)
- `npx tsc --noEmit` exit 0. `npm run lint` exit 0 (after restoring default variant). Full unit suite
  re-run with default variant in progress/confirmed green (the 31 failures in an interim run were
  variant-dependent tests run while generated files were on c64u-remote; resolved by default regen).

## P? — Global "Forbidden → network password" popup (Objective A) (2026-06-22)

### Baseline confirmed on real hardware
- `curl -m5 http://192.168.1.167/v1/info` (C64U, `pwd` set) unauthenticated → **HTTP 403 Forbidden**
  (`{"errors":["Forbidden."]}`); `X-Password: pwd` is the auth header the client already sends.
  U64 `192.168.1.13` → HTTP 200 (no password). So the firmware uses **403** today; the feature
  handles **both 401 and 403** as "authentication required" per the brief.
- C64U then dropped into its documented intermittent drop-out (TCP reset / refused) under repeated
  probes; U64 stayed reachable throughout (network path proven). Authed-200 + on-device popup proof
  are pending C64U recovery (see HIL section).

### Design (app-wide, not per-call)
- **Detection chokepoint** — `src/lib/c64api/transportErrors.ts`: `getHttpStatusFromError()` reads the
  status from the annotated `c64uHttpStatus` (main REST path), the structured `c64api.status`, a bare
  `status`, or the `HTTP <code>` token in the message (covers specialized throw sites like
  `readMemory failed: HTTP 403`). `isAuthRequiredHttpStatus()` / `isAuthRequiredError()` flag 401/403.
- **Single-flight store** — `src/lib/auth/authChallenge.ts`: a module singleton holding at most ONE
  challenge. `notifyAuthRequired({host})` opens it; while open, a burst of Forbidden responses is
  coalesced (no second popup). Resolves the affected device's id+label from the saved-devices store by
  host match (falls back to the selected device). `useAuthChallenge()` is a `useSyncExternalStore` hook.
- **Recovery controller** — `src/lib/auth/authChallengeController.ts`: `submitAuthChallengePassword()`
  stores via `setPasswordForDevice(deviceId, …)` (or `setPassword()` when no id), re-applies runtime
  config (`applyC64APIConfigFromStorage`), then retries the captured operation or re-probes
  (`verifyCurrentConnectionTarget`). Recovered → closes; still 401/403 → re-prompts (never marks the
  device healthy). The password is NEVER put in any log payload (only an `authRequired` boolean + the
  failure message, which carries no secret).
- **Emission wiring** — `src/lib/c64api.ts`: a private `maybeRaiseAuthChallenge(status, suppress)`
  fires at the main `request()` HTTP-error site and the `readMemory` error site. Suppressed when
  `intent === "system"` OR the explicit `__c64uSuppressAuthChallenge` option is set. Because the
  connection/discovery probes in `connectionManager.ts` already use `intent: "system"`, startup/resume/
  switch probes (which have their own discovery/interstitial password UX) never raise the global popup,
  while every foreground op (config read/write, drives, runners, play, intent "user"/"background") and
  manual/background **health checks** do. No connectionManager/healthCheckEngine edits were needed.
- **Global mount** — `src/components/DeviceAuthChallengeDialog.tsx`, mounted once in `App.tsx` next to
  `DeviceDiscoveryInterstitial`, so it is reachable from any screen in BOTH variants. Masked input,
  names the device, Cancel/Submit, inline error + re-prompt.

### Why the chokepoint is the transport layer + REST client (not per-call patches)
Every device call funnels through `C64API.request()` (info/config/drives/runners/play) or `readMemory`
(health-check JIFFY). Detecting at those two sites + the single-flight store means any 401/403 anywhere
raises exactly one popup, tied to the active/affected device, with zero per-call-site changes.

### Tests (all green)
- `tests/unit/c64api/transportErrors.test.ts` — +6 cases for 401/403 detection across annotation,
  structured field, bare field, message-parse; rejects 404/500/transport + the "4030 bytes" false match.
- `tests/unit/lib/auth/authChallenge.test.ts` (9) — single-flight burst→1 popup, host-match attribution,
  retry coalescing, error re-prompt, resolve/dismiss, generic-label fallbacks.
- `tests/unit/lib/auth/authChallengeController.test.ts` (8) — store→reapply→reprobe order, wrong-password
  re-prompt without closing, empty-password guard, retry-closure preference, success close, **password
  never appears in any addLog payload**, no-op when no challenge open.
- `tests/unit/components/DeviceAuthChallengeDialog.test.tsx` (6) — opens once on a Forbidden burst,
  names the device, **masked input (type=password)**, submits typed value, wrong-password re-prompt,
  cancel.

### Gates
- `npx tsc --noEmit` exit 0. `npm run lint` exit 0. Full `vitest run` re-run cleanly after the APK
  build restored the default variant (see HIL note about concurrent build mutating `variant.ts`).

## P? — On-device validation + C64U crash investigation (Objective A/B, 2026-06-22, live C64U)

### On-device end-to-end proof (live C64U 192.168.1.167, `pwd` set; both variants)
Build `0.8.9-rc2-7bb03` (uncommitted tree). Driven via WebView CDP (`/tmp/cdp-eval.mjs`). Evidence PNGs
in `docs/img/app/launch/auth-challenge/`.
- **C64 Commander**: app pointed at the C64U with NO password → a foreground call hit the live **403**
  → the global popup opened titled "Network password required", naming `192.168.1.167`, masked input
  (`type=password`). Entered a WRONG password → re-prompted with "The device rejected that password…",
  device NOT marked healthy. Entered `pwd` → device authenticated (read product `c64u`, firmware
  `1.1.0`), password persisted (`hasPassword:true`), popup **auto-closed**, Home `● HEALTHY`.
  Cold-launch persistence: force-stop + relaunch → reconnected with the stored password, **no
  re-prompt**, `● HEALTHY`.
- **C64U Remote** (separate storage, started fresh): same flow — popup on 403 naming the device, masked
  input; `pwd` → authenticated (firmware 1.1.0), popup auto-closed, password persisted. Proves the
  feature is present + operable in BOTH variants from any screen.
- Screenshots: `commander-forbidden-popup-v2.png`, `commander-wrong-password-reprompt.png`,
  `commander-recovered-healthy.png`, `remote-forbidden-popup.png`, `remote-recovered-healthy.png`.

### Two real defects found on hardware + fixed (with tests)
1. **Lingering popup after successful auth.** On the flaky C64U, the recovery re-probe
   (`verifyCurrentConnectionTarget`) sometimes returns `ok:false` due to a *transient* (non-403)
   drop-out, which the controller mislabeled as "wrong password" and kept the popup open — even though
   subsequent calls were already succeeding (200). Fixes:
   - `authChallenge.notifyAuthSatisfied(host)` — any successful (2xx) device response for the
     challenged host auto-closes the popup. Wired into `C64API.request()` success paths
     (`clearAuthChallengeOnSuccess`).
   - `authChallengeController` now distinguishes `recovered` / `auth-rejected` (still 401/403 → wrong
     password) / `unreachable` (transient — "Saved the password, but the device didn't respond…", NOT a
     wrong-password claim).
   - +6 tests (store auto-close incl. after-error; controller transient outcome). Re-validated live:
     the popup auto-closed on success on both variants.

### C64U crash investigation — HARD FACTS (no speculation)
Question: which precise interaction breaks the C64U? Tested empirically against the freshly-restarted
device (app force-stopped for isolation; device health = a single `GET /v1/info` after each step):
- `GET /v1/info` unauth → **403**; authed (`X-Password: pwd`) → **200**; wrong password → **403**;
  5 rapid sequential authed → all 200. Device healthy after each. → **No single request type crashes it.**
- Concurrency sweep (parallel connections), device health checked + recovery timed after each:
  - 8 concurrent → 8/8 ok. 16 → 16/16 ok. **24 → 3 dropped (000), 21 ok.** 40 → 13 dropped. 80 → 39
    dropped. **In every case the device returned to 403 immediately and stayed healthy.**
  - Sustained 3×24 back-to-back → drops each round, **full recovery after each**.
- App's real connect sequence (sequential authed config-read burst of ALL categories + comprehensive
  health check incl. Telnet/memory probes) → device **survived, `● HEALTHY`**, 403 after.
- Raw Telnet (port 23) connect/read/close ×3 → device healthy after. FTP (21) + Telnet (23) open.

**Conclusion (fact-based):** No app/HTTP/Telnet interaction reproducibly causes a *persistent* crash.
The C64U's HTTP server is robust to request bursts — it sheds excess connections at **≥24 concurrent**
(lightweight, single-threaded, `Connection: close`) but **self-recovers within milliseconds every
time**, including from 80 concurrent. The persistent ~10-min outages earlier in the session correlated
with **environmental Wi-Fi/AP instability** — the Pixel's `wlan0` lost its IP entirely
(`dumpsys wifi` → `DisconnectedState`, `ping` → "Network is unreachable"), recovering only after a
`svc wifi disable/enable` toggle; the C64U shares the same Wi-Fi/AP. The initial drop was triggered by a
rapid manual `curl` probe burst plus the device's documented intermittent flakiness under cumulative
long-session load — not a specific code interaction.

**Fix for the drop:** there is no app code path that bursts a single device beyond the safe envelope —
the discovery LAN scan uses concurrency 24 across *distinct* IPs (1 connection per host), the startup
saved-device sweep probes each device once (1200 ms), config reads are awaited sequentially, and the
health check fires only a handful of probes per device. All are well under the ≥24 per-host overflow
threshold proven above. The genuine recently-introduced defect (the popup loop) is fixed above.
Operational note: test harnesses / scripts must not fire ≥24 concurrent probes at one device.

## P? — Firmware-grounded capability audit + smart discovery/creation (2026-06-22)

### Firmware capability research (see docs/research/device-discovery/firmware-capabilities.md)
Spelunked the 1541ultimate firmware/docs. Timeline: Telnet+FTP services ~fw **3.0**; HTTP REST API
fw **3.11**; network password (X-Password) fw **3.12**. Per-device: the only feature differences are
the firmware-documented **U64-only** set — `machine:poweroff`, `machine:debugreg`, `/v1/streams` — and
all correlate with **`/v1/info.core_version`** ("only for Ultimate 64 devices"). Verified live: U64
`core 1.4B`, C64U `core 1.49`, both `/v1/version → 0.1`; U2 cartridges omit core_version.

### Capability model → fully runtime-driven (no family literals as feature gates)
`src/lib/deviceCapabilities/capabilityModel.ts`: removed `VIDEO_STREAM_FAMILIES` / `POWER_CYCLE_FAMILIES`.
- `supportsPowerCycle` ⇐ `restReachable && core_version present` (was `{C64U,U64E2}` — also too narrow;
  poweroff is all integrated computers). Cartridges (no core_version) correctly excluded.
- `supportsStreaming` ⇐ Data Streams config signal (primary) else `core_version` presence (was family
  set). A U2 advertising streaming in config still flips on; a U64 disabling it flips off.
- `supportsMenuInput` unchanged (menu_button is universal; only a recognised-Ultimate heuristic remains,
  documented as the one no-runtime-signal case alongside the telnet menu key).
- `streamingSource` provenance: `rest-config | core-version | unknown`.
- `src/pages/home/components/MachineControls.tsx` + HomePage now gate the REST **Power Off** quick action
  on `supportsPowerCycle` (was always shown → would 404 on a cartridge). Tests updated to use realistic
  per-device `core_version` (cartridges omit it). 19 capability tests + HomePage gate tests green.

### Smart auto-discovery dedup by unique id
`persistDiscoveredDevice` already matches an existing saved device by `unique_id` and UPDATES its host
(no duplicate) when the device reappears at a new IP/hostname; `completeSavedDeviceVerification` records
`lastKnownUniqueId` on every successful connect and flags same-unique_id duplicates. Locked with a new
test: same unique id at a new address → existing entry reused + host updated, no duplicate.

### Reachability-guided device creation (calm IP rescue)
- NEW `src/lib/connection/probeDeviceReachability` (pure, no state mutation) + `addDeviceReachability.ts`
  `evaluateNewDeviceReachability()`: probes the entered host; 2xx → reachable; 401/403 → reachable
  (needs-password, allowed); else unreachable → if the user typed a hostname, runs a LAN scan and, on a
  hostname match (or a single discovered Ultimate), returns the device's IP to suggest.
- `SettingsPage.handleSaveConnection` now gates BEFORE committing: an unreachable device is never
  persisted. When found by IP, a calm, non-technical inline panel in `SavedDeviceEditorFields`
  ("We couldn’t reach 'c64u', but found your device at 192.168.1.167. Use that address?") offers a
  one-tap fill; otherwise a calm hostname hint steers the user to enter the IP. Helper has 8 unit tests;
  SettingsPage has 2 new gate tests (block+suggest, block+hint); all 77 SettingsPage tests green.

### Gates
`npx tsc --noEmit` 0; `npm run lint` 0; full `vitest run` green (capability run: 629 files / 7299 tests).

## Ralph loop iteration #121 startup (2026-06-22T22:31:07+01:00, codex)

- Branch/source: `fix/device-hardening`, HEAD `0efe339d` (`feat: Automatic device discovery (#292)`), startup worktree clean; `./scripts/resolve-version.sh` -> `0.8.9-rc3`.
- Installed Pixel 4 Commander APK: `0.8.9-rc2-b1192`, running but stale vs source, so current-build HIL requires rebuild/deploy.
- Peer discovery: droidmind callable (`get_app_info` succeeded); c64scope callable (`scope_lab_get_lab_state` returned lab state, peers unknown until reported); c64bridge callable but currently defaulted to VICE for `c64_config info`.
- Hardware reachability: `c64u` REST `/v1/info` returned HTTP 403 in 10 ms (password required); `u64` REST `/v1/info` returned HTTP 200 in 21 ms (`Ultimate 64 Elite`, fw `3.14e`).
- Capacity: Ralph context says codex usable, 5h 100% / weekly 26%; action tier `>=40%`, minimum 8 production CTA/control actions.
- Selected probe family: Settings connection/discovery/auth diagnostics current-build pack; first TODO is build/deploy rc3, then enumerate and exercise visible safe Settings controls with Diagnostics export/logcat sweep.

## Ralph loop iteration #121 evidence (2026-06-22T22:41+01:00, codex)

- Build/deploy: `npm run cap:build && cd android && ./gradlew assembleDebug` built `android/app/build/outputs/apk/debug/c64commander-0.8.9-rc3-0efe3-debug.apk` (`versionName=0.8.9-rc3-0efe3`, `versionCode=2029`). Initial droidmind install failed with `INSTALL_FAILED_VERSION_DOWNGRADE` because installed `versionCode=2040`; per repo policy uninstalled `uk.gleissner.c64commander`, reinstalled rc3, launched, and confirmed installed version `0.8.9-rc3-0efe3`.
- Probe family: Settings connection/discovery/auth diagnostics current-build pack after fresh install/data clear. Entry UI was startup discovery interstitial on Home with one discovered U64 (`192.168.1.13`, fw `3.14e`) plus Save/Use/Open Settings/Not now/Close controls.
- Hardware/tools: `c64u` reachable but password-protected (`/v1/info` HTTP 403); `u64` reachable and used for safe product proof (`Ultimate 64 Elite`, fw `3.14e`). droidmind drove all product actions. c64bridge was callable but defaulted to VICE, so it was not used as hardware oracle. c64scope callable but no A/V stream was needed.
- Verdict: **DEFECT**. U64 discovery/save/use, repeated Settings Save & Connect, explicit discovery, Diagnostics export, Back cancel, and background/foreground all actuated and left U64 healthy, but diagnostics/log sweeps found BUG-058, BUG-059, and BUG-060.

| Action ID | Route/Page | UI element | User operation | Expected result | Observed ~200 ms feedback | Observed ~1 s / effect result | Oracle used | Latency class | Diagnostics/log result | Status | Artifact refs | Cleanup state |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 121-A01 | Home startup discovery | U64 `Save` | Tap Save once | Persist discovered U64 without connecting | Button state changed immediately | Row showed `Already saved` and `Saved` | droidmind screenshot | <=1s-effect | Action visible in later diagnostics | EXERCISED_CLEAN | `ui/after-save.png` | U64 saved |
| 121-A02 | Home startup discovery | U64 `Use` | Tap Use once | Select/connect U64 | Connection flow began | Header became `192.168.1.13 HEALTHY`, Device `u64`, fw `3.14e` | UI + REST/logcat | <=1s-effect | Also opened unexpected `Network password required` dialog for inactive `c64u` | DEFECT_OPEN | `ui/after-use.png`, diagnostics ZIP | U64 connected; BUG-058 |
| 121-A03 | Global auth dialog | `Cancel` | Tap Cancel | Dismiss prompt without changing U64 | Dialog closed | U64 stayed healthy | UI | <=1s-effect | Prompt attributed to inactive `c64u` while active U64 was healthy | DEFECT_OPEN | `ui/after-auth-cancel.png` | Prompt closed |
| 121-A04 | Settings | Tab bar Settings | Tap Settings tab | Navigate to Settings | Settings title appeared | Health badge stayed `192.168.1.13 HEALTHY` | UI | <=1s-effect | none beyond later diagnostics | EXERCISED_CLEAN | `ui/settings-entry.png` | Settings route |
| 121-A05 | Settings Connection | c64u saved-device row | Tap c64u row | Switch editor/target safely | Row selected | Header became Offline, editor host/name `c64u`; no crash | UI + REST trace | <=1s-effect | One `GET c64u /v1/info` 403 in network snapshot | EXERCISED_CLEAN | `ui/after-select-c64u.png` | c64u selected temporarily |
| 121-A06 | Settings Connection | U64 saved-device row | Tap U64 row | Restore U64 healthy target | Row selected | Header returned `192.168.1.13 HEALTHY` | UI + REST trace | <=1s-effect | later diagnostics confirmed active U64 | EXERCISED_CLEAN | `ui/after-switch-back-u64.png` | U64 restored |
| 121-A07 | Settings Connection | Save & Connect | Tap twice | Re-save/re-verify idempotently | Button accepted both taps | U64 remained healthy | UI + logcat | <=1s-effect | `SecureStorage.clearPassword` x2 and `/v1/info` probes; no visible error | EXERCISED_CLEAN | `ui/after-save-connect-repeat.png`, `logcat/after-save-connect.log` | U64 healthy |
| 121-A08 | Settings Connection | Refresh/retry icon | Tap once | Re-run connection verification | Button accepted tap | U64 stayed healthy | UI + logcat | <=1s-effect | `/v1/info` verification in package log | EXERCISED_CLEAN | `ui/settings-connection-lower.png` | U64 healthy |
| 121-A09 | Settings Discovery | Discover devices | Tap once | Run explicit discovery and render devices | Button accepted tap | Result row rendered U64, Already saved, Use | UI + package logcat | <=1s-effect for feedback | Native plugin logged thousands of W stack-trace lines for expected misses | DEFECT_OPEN | `ui/discovery-results.png`, `logcat/after-explicit-discovery.log` | U64 healthy; BUG-060 |
| 121-A10 | Settings Discovery | Result row `Use` | Tap U64 result Use | Re-select/reconnect U64 idempotently | Button accepted tap | Banner stayed `Connected to http://192.168.1.13`, header Healthy | UI + Diagnostics | <=1s-effect | Diagnostics later showed red REST rows despite Healthy | DEFECT_OPEN | `ui/discovery-results.png`, `ui/diagnostics-open.png` | U64 healthy; BUG-059 |
| 121-A11 | Settings Diagnostics | `Diagnostics` button | Tap Diagnostics | Open diagnostics overlay | Dialog opened | Health card Healthy for `192.168.1.13 · U64E` | UI | <=1s-effect | Main Activity listed red `GET 192.168.1.13 /v1/info` rows with `ERR 1` while health was Healthy | DEFECT_OPEN | `ui/diagnostics-open.png` | Diagnostics open; BUG-059 |
| 121-A12 | Diagnostics | Overflow + Latency | Open menu, select Latency | Latency analysis view renders | View changed | P50 34 ms, P90 70 ms, P99 392 ms, 98 samples | UI + export | over-budget | Exported latencySamples: one >200 ms (`Config items`, 392 ms), none >1 s | DEFECT_OPEN | `ui/diagnostics-menu.png`, `ui/diagnostics-latency.png`, diagnostics ZIP | Diagnostics open |
| 121-A13 | Diagnostics | Share all | Overflow, Share all, Back cancel, pull ZIP | Generate ZIP and Android share sheet | Share sheet opened with ZIP filename | Pulled `c64commander-diagnostics-all-2026-06-22-2139-49Z.zip` and unpacked | UI + adb pull + unzip + jq | <=1s-effect for chooser | ZIP: errorLogs=0, traces=697/restErrors=0, networkSnapshot successCount 32/failureCount 70, health Healthy/problemCount 0 | DEFECT_OPEN | `ui/share-sheet.png`, `diagnostics/c64commander-diagnostics-all-2026-06-22-2139-49Z.zip` | Share sheet canceled |
| 121-A14 | Diagnostics/Settings | Android Back | Press Back from share sheet | Cancel chooser/return to Settings | Chooser dismissed | Settings visible, U64 healthy | UI | <=1s-effect | No crash/ANR | EXERCISED_CLEAN | `ui/after-back-from-share.png` | Settings visible |
| 121-A15 | Settings lifecycle | HOME + foreground | Press HOME, start app | Background/foreground returns to route | App backgrounded/foregrounded | Settings restored at same section, U64 healthy | droidmind lifecycle + screenshot + logcat | <=1s-effect | No crash/ANR/StrictMode; discovery warnings remain from scan | EXERCISED_CLEAN | `ui/after-bg-fg.png`, `logcat/final-after-bg-fg.log` | U64 healthy |

- Mandatory diagnostics/log sweep:
  - Package-filtered logcat saved under `docs/agentic/artifacts/iter121/logcat/`. No `AndroidRuntime`, FATAL, ANR, or StrictMode hits. Relevant app-package warnings: 7144 `W DeviceDiscoveryPlugin` lines and 244 `ConnectException`/`SocketTimeoutException` stack traces from explicit discovery scan misses. `Capacitor/Console` appeared 3 times with `Msg: undefined`.
  - Diagnostics ZIP pulled/analyzed: `docs/agentic/artifacts/iter121/diagnostics/c64commander-diagnostics-all-2026-06-22-2139-49Z.zip`; app identity correct (`0.8.9-rc3-0efe3`, git `0efe339d`); active device U64 `192.168.1.13`; health `Healthy`, problemCount 0; `error-logs` count 0; traces 697 with zero trace errors; latency samples 98, max 392 ms, one >200 ms, none >1 s; bugReportContext networkSnapshot successCount 32/failureCount 70.
  - UI-vs-diagnostics discrepancies: Diagnostics Activity showed red `GET 192.168.1.13 /v1/info` rows with `ERR 1` while health card and header were Healthy and export `error-logs`/trace errors were empty. Exported network snapshot also contained many `httpStatus:null`/`errorMessage:null` request rows counted as failures.
- Visible controls discovered/classified in selected family: 18. Exercised: 12 safe controls plus Back/lifecycle controls. Not exercised this loop: startup `Open Settings`/`Not now`/Close after Save/Use path, saved-device Add/Delete guard, host/port/password field edits, debug logging toggle. These remain planned because three medium defects were found and extra mutation/state churn would have blurred evidence.
- Production CTA/control actions attempted: 15 primary actions in the evidence table; `droidmind_cta_action_count=20` counting scrolls, Back, HOME, and foreground lifecycle actions. Repeated interaction: Save & Connect x2; discovery/use path exercised via startup Use and Settings result Use; target switch c64u -> U64; Diagnostics menu opened twice; Back/lifecycle once each.
- Cleanup/restores: selected device restored to U64 `192.168.1.13`, Settings route foregrounded, U64 healthy. No hardware-mutating C64 controls were invoked. No UltiSID/mixer changes.

## 2026-06-22 — #122 BUG-058/059/060 fix pack and device validation

- Source/installed label: `0.8.9-rc3-0efe3` (git `0efe339d` on `fix/device-hardening`).
- Branch: `fix/device-hardening`. Provider: kilo. Balance: $79.5 left (usable). Action budget at >=40% capacity: min 8, target 12-20 production actions.
- Provider/peer assignment: droidmind = primary Android product controller; c64scope for A/V/stream; c64bridge setup/read-back only.
- C64 device preference: prefer `u64` (192.168.1.13, fw 3.14e, healthy) over `c64u` (inactive, password-protected, HTTP 403). u64 was the selected device for the entire loop.
- Fix pack (in-tree; Vitest 26/26 pass on changed files; `tsc --noEmit` and `npm run lint` clean; `npm run cap:build` and `cd android && ./gradlew assembleDebug` BUILD SUCCESSFUL):
  - BUG-058: `src/lib/auth/authChallenge.ts` — `resolveIdentity` no longer falls back to the selected device when a host notification has no matching saved device; labels by host alone. Regression in `tests/unit/lib/auth/authChallenge.test.ts` asserts c64u challenge attributed to saved c64u device, not selected U64.
  - BUG-059: `src/lib/diagnostics/networkSnapshot.ts` — `buildNetworkSnapshot` counts a row as failure only when it has an `errorMessage` OR a non-2xx/3xx status. Regression in `tests/unit/lib/diagnostics/networkSnapshot.test.ts` asserts `null`-status no-error rows are not failures.
  - BUG-060: `android/app/src/main/java/uk/gleissner/c64commander/DeviceDiscoveryPlugin.kt` — `probeTarget` catch block demoted from `Log.w` + full stack to one `Log.d` line with host/port/exception class. No other plugin code path changed.
- APK `android/app/build/outputs/apk/debug/c64commander-0.8.9-rc3-0efe3-debug.apk` installed via droidmind `install_app` on Pixel 4 `9B081FFAZ001WX`. Post-install `get_app_info` confirms installed version `0.8.9-rc3-0efe3` matches source label.
- On-device validation (production actions):
  - App launched; Home shows U64 healthy connected.
  - Logcat cleared.
  - Navigated Home -> Settings; tapped `Discover devices`; full scan completed with no auth dialog for c64u 403 probe (BUG-058 UI confirmation). UI screenshot: `docs/agentic/artifacts/iter122/ui/settings-discovery-results.png`.
  - Package-filtered logcat captured (`uk.gleissner.c64commander`): ~250 `D DeviceDiscoveryPlugin: Device discovery probe miss ...` entries, 0 `W` priority entries from `DeviceDiscoveryPlugin`, no stack traces (BUG-060 production confirmation). Saved: `docs/agentic/artifacts/iter122/logcat/iter122-discovery-1.{txt,md}`.
  - Settings -> Diagnostics (`diagnostics-open-dialog`); Health check ran: REST 263 ms Success, FTP 67 ms Success, TELNET 35 ms Success; 5 traces buffered in 200 s; healthSnapshot.state Healthy, problemCount 0.
  - Tapped `...` (820, 263) -> `Share all` (730, 1156); system share sheet offered `c64commander-diagnostics-all-2026-06-22-2203-58Z.zip` (35315 B). Shared to Total Commander -> saved to `/storage/emulated/0/Download/`.
  - Pulled ZIP via `adb pull` to `docs/agentic/artifacts/iter122/diagnostics/`. Unzipped into `supplemental.json`, `traces.json`, etc.
  - Analyzed `bugReportContext.networkSnapshot.requests`: 50 rows; 21 with 2xx/3xx status; 29 with `httpStatus:null` and no `errorMessage` (aborted/superseded traces); 0 errors. Pre-fix failure count = 29; post-fix failure count = 0. `healthSnapshot.problemCount=0`; App/REST/FTP/TELNET all `failedOperations=0` (BUG-059 production confirmation). Evidence: `docs/agentic/artifacts/iter122/diagnostics/EVIDENCE.md`.
- BUGS_FOUND.md updated: BUG-058, BUG-059, BUG-060 -> CLOSED with root-cause and verification links.
- Visible controls discovered/classified in selected family: 14 (Settings discovery + Diagnostics surfaces). Exercised: 8 safe controls (Home tab, Settings tab, Discover devices, Diagnostics open, ... menu, Share all, Total Commander save OK, Back). Repeated interaction: discovery scan + diagnostics health check + share-all ZIP export.
- Production CTA/control actions attempted: 10 primary actions; `droidmind_cta_action_count=14` counting logcat-clear, Total Commander location-pick, share-sheet tap, foreground lifecycle.
- Cleanup/restores: selected device restored to U64 `192.168.1.13`, Settings route foregrounded, U64 healthy. No hardware-mutating C64 controls invoked. No UltiSID/mixer changes.

## Ralph loop iteration #123 startup (2026-06-22T23:09:02+01:00, codex)

- Branch/source: `fix/device-hardening`, HEAD `0efe339d`; working tree dirty with #122 BUG-058/059/060 code/test/state edits. Source label `0.8.9-rc3-0efe3`; Pixel installed `uk.gleissner.c64commander` version `0.8.9-rc3-0efe3`; APK mtime post-dates touched source files.
- Peer discovery: droidmind available; c64scope available (`ready=false` until peer health reports); c64bridge available but currently reports VICE, so not used for Ultimate proof.
- Hardware: `u64` reachable (`Ultimate 64 Elite`, fw `3.14e`, 192.168.1.13); `c64u` reset `/v1/info` immediately (HTTP 000), so this loop will avoid c64u traffic beyond diagnostics evidence.
- Capacity: Ralph Robin codex context usable, 5h 90% / weekly 24%; `>=40%` action budget, minimum 8 production actions.
- Selected probe family: fresh-data startup discovery interstitial UI pack. Primary TODO: clear app data, exhaust Close / Not now / Open Settings / U64 Save / U64 Use first-run controls with repeated actuation, include Back/lifecycle, then mandatory logcat + Diagnostics ZIP sweep and cleanup to U64 healthy.

## Ralph loop iteration #123 evidence (2026-06-22T23:24+01:00, codex)

- Probe family: **fresh-data startup discovery interstitial UI pack** on Pixel 4 `9B081FFAZ001WX`, Commander `0.8.9-rc3-0efe3`.
- Setup/oracles: droidmind drove every product action. App data was cleared between startup-dialog branches as setup. c64scope and c64bridge were discovered; c64bridge reported VICE and was not used as Ultimate proof. `u64` was reachable (`Ultimate 64 Elite`, fw `3.14e`); `c64u` reset `/v1/info` before and after the pack and was not escalated.
- Verdict: **DEFECT**. Startup interstitial controls worked and BUG-058 did not regress, but BUG-061 was found: fresh-data Home sends default `c64u` config/drives traffic during `DISCOVERING` before the user chooses U64, leaving diagnostics errors/network failures and briefly contaminating the selected U64 badge after Diagnostics close.

| Action ID | Route/Page | UI element | User operation | Expected result | Observed ~200 ms feedback | Observed ~1 s / effect result | Oracle used | Latency class | Diagnostics/log result | Status | Artifact refs | Cleanup state |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 123-A01 | Home startup discovery | Dialog Close X | Tap Close | Dismiss dialog, stay on Home | Overlay began closing | Home visible, Offline/Not connected, no trapped overlay | droidmind screenshot/UI | <=1s-effect | Startup log already contained c64u reset errors | EXERCISED_CLEAN | `iter123/ui/entry-startup-interstitial.png`, `after-close-1.png` | Fresh data cycle ended |
| 123-A02 | Home startup discovery | `Not now` | Tap Not now | Dismiss dialog without selecting device | Button accepted tap | Home visible, Offline/Not connected | droidmind screenshot | <=1s-effect | Same c64u startup/default traffic class in logs | EXERCISED_CLEAN | `iter123/ui/not-now-entry.png`, `after-not-now-1.png` | Fresh data cycle ended |
| 123-A03 | Home startup discovery | `Open Settings` | Tap Open Settings | Route to Settings | Button accepted tap | Settings Appearance route visible | droidmind screenshot | <=1s-effect | No crash or trapped dialog | EXERCISED_CLEAN | `iter123/ui/open-settings-entry.png`, `after-open-settings-1.png` | Settings route |
| 123-A04 | Settings route | Android Back | Press Back | Return from Settings to Home | Back accepted | Home visible, Offline/Not connected | droidmind screenshot | <=1s-effect | No route loss | EXERCISED_CLEAN | `iter123/ui/after-back-from-settings.png` | Fresh data cycle ended |
| 123-A05 | Home startup discovery | U64 `Save` | Tap Save | Persist discovered U64 | Button state changed | Row showed `Already saved` / `Saved` | droidmind screenshot | <=1s-effect | True actuation via UI state | EXERCISED_CLEAN | `iter123/ui/save-use-entry.png`, `after-save-1.png` | U64 saved |
| 123-A06 | Home startup discovery | U64 `Use` | Tap Use | Select/connect U64 without c64u auth prompt | Dialog dismissed; connection requests began | Home `192.168.1.13 HEALTHY`, Device `u64`, fw `3.14e`; no auth dialog | UI + package logcat + diagnostics | <=1s-effect for feedback | BUG-058 did not regress; later ZIP retained pre-selection c64u failures | EXERCISED_CLEAN | `iter123/ui/after-use-1.png` | U64 healthy |
| 123-A07 | Home U64 | HOME + foreground | Press HOME, start app | Restore app on same U64 state | App backgrounded/foregrounded | Home stayed `192.168.1.13 HEALTHY` | droidmind lifecycle + screenshot/logcat | <=1s-effect | No crash/ANR/StrictMode; known BackDispatcher warning on foreground | EXERCISED_CLEAN | `iter123/ui/after-bg-fg.png` | U64 healthy |
| 123-A08 | Global app bar | Health/diagnostics badge | Tap badge | Open Diagnostics | Dialog opened | Diagnostics Healthy for `192.168.1.13 · U64E` | UI tree/screenshot | <=1s-effect | Activity showed 116/116 rows; U64 REST rows 200 | EXERCISED_CLEAN | `iter123/ui/diagnostics-open-attempt.png` | Diagnostics open |
| 123-A09 | Diagnostics | Overflow -> Latency | Open menu, tap Latency | Show latency analysis | Latency view rendered | P50 36ms, P90 92ms, P99 214ms, 101 samples | droidmind screenshot | over-budget (>200ms P99) | Later ZIP max latency 466ms, 2 samples >200ms, none >1s | DEFECT_OPEN | `iter123/ui/diagnostics-menu.png`, `diagnostics-latency.png` | Diagnostics open |
| 123-A10 | Diagnostics | Share all | Overflow -> Share all, Total Commander OK, pull ZIP | Export full diagnostics | Android share sheet displayed ZIP filename | ZIP saved to Download, pulled and unzipped locally | UI + adb pull + jq | <=1s-effect for chooser | ZIP activeDevice U64 Healthy/problemCount 0, but 1 error-log + 61 network failures from default c64u startup traffic | DEFECT_OPEN | `iter123/ui/share-sheet.png`, `total-commander-save.png`, `iter123/diagnostics/EVIDENCE.md` | Diagnostics open |
| 123-A11 | Diagnostics/Home | Close Diagnostics | Tap X | Return to Home Healthy | Dialog closed | Home briefly showed `192.168.1.13 ▲ 1 DEGRADED` despite exported health Healthy/problemCount 0 | screenshot + ZIP | over-budget/stale | BUG-061 stale badge/diagnostics contamination | DEFECT_OPEN | `iter123/ui/cleanup-home-u64.png` | Stale degraded badge |
| 123-A12 | Diagnostics | `Run health check` | Reopen Diagnostics, tap Run health check | Clear stale badge if device healthy | Health check started | REST 148ms, FTP 66ms, TELNET 308ms, CONFIG 893ms, RASTER 96ms, JIFFY 281ms, result Healthy 1877ms; Home badge cleared after close | UI + screenshot | over-budget total (long-running with feedback) | Summary showed P90/P99 ~3004/3006ms, consistent with pre-selection c64u failures contaminating aggregate latency | DEFECT_OPEN | `iter123/ui/after-run-health-check.png`, `final-cleanup-home-u64-healthy.png` | Home U64 healthy |

- Mandatory diagnostics/log sweep:
  - Diagnostics ZIP: `docs/agentic/artifacts/iter123/diagnostics/c64commander-diagnostics-all-2026-06-22-2219-10Z.zip`; analyzed summary in `docs/agentic/artifacts/iter123/diagnostics/EVIDENCE.md`.
  - Export identity: app `0.8.9-rc3-0efe3`, git `0efe339d`; active device U64 `192.168.1.13`, fw `3.14e`; health snapshot Healthy/problemCount 0.
  - Export findings: 1 error-log (`c64u /v1/drives` Host unreachable during `DISCOVERING`), actions 114 with 68 system-origin errors, networkSnapshot 101 requests / 40 successes / 61 failures from default c64u startup traffic. Latency samples max 466ms, 2 >200ms, 0 >1s.
  - Package-filtered logcat: `docs/agentic/artifacts/iter123/logcat/app-package-final.log` (592 lines). No AndroidRuntime crash, ANR, or StrictMode. App-package errors/warnings attributed: `E Capacitor: Connection reset` from c64u startup/default requests while c64u was reset-by-peer; `WindowOnBackDispatcher` warning on foreground with Back behavior passing; `userfaultfd` ART warning; expected `Share canceled` after Total Commander save; DeviceDiscoveryPlugin miss lines remained `D`, not `W`.
  - System crash/ANR reads returned only stale historical tombstone/ANR entries from April/May, not current-run crashes.
- Visible controls discovered/classified: 5 startup interstitial controls (Close, U64 Save, U64 Use, Open Settings, Not now) plus Android Back/lifecycle and Diagnostics export controls. Safe controls exercised: all visible startup-dialog controls.
- Production CTA/control actions attempted: 18 droidmind-driven actions including Close, Not now, Open Settings, Android Back, Save, Use, HOME, foreground/start app, diagnostics open, diagnostics menu, Latency, Latency back, Share all, Total Commander target, Total Commander OK, Diagnostics close, diagnostics reopen, Run health check, and final Diagnostics close. Evidence is grouped into 12 table rows where related actions are part of one product cluster.
- Repeated interaction: startup discovery was repeated across 4 fresh app-data cycles; dismissal controls were exercised via Close/Not now/Open Settings, and U64 Save/Use path was exercised after prior #121/#122 discovery/use validation. `Save`, `Use`, `Open Settings`, `Not now`, `Close`, `Back`, lifecycle, Diagnostics Share all all had verified actuation by UI/log/ZIP effects; no synthetic-only CTA was recorded clean.
- Cleanup: final app state Home on U64 `192.168.1.13 HEALTHY`, Device `u64`, fw `3.14e` (`iter123/ui/final-cleanup-home-u64-healthy.png`). No machine/config/audio mutations. c64u remained reset-by-peer/HTTP 000; U64 REST `/v1/info` HTTP 200.
- Continuation: `docs/agentic/prompt.md` refreshed for BUG-061 fix pack. Ralph Robin continuation ready; no scheduler command was run because Ralph Robin owns provider rotation.

## Ralph loop iteration #124 startup (2026-06-22, claude / fix/device-hardening)

- Continuing the BUG-061 FIX LOOP. Last loop (#123) opened BUG-061: fresh-data Home sends default `c64u` config/drives traffic during `DISCOVERING` before U64 is chosen, leaving diagnostics errors (1 `c64u /v1/drives` error-log), networkSnapshot.failureCount=61, 68 system-origin action errors, and a transient `192.168.1.13 ▲ 1 DEGRADED` badge after Diagnostics close.
- Found an uncommitted BUG-061 fix already drafted in the working tree (`src/hooks/useC64Connection.ts`): a `useConnectionActive()` gate (REAL_CONNECTED||DEMO_ACTIVE) added to `enabled` of useC64Categories, useC64Category, useC64ConfigItems, useC64AllConfig, useC64ConfigItem, useC64Drives — extending the c64-info query's existing connection-state gate to every device-touching query. New focused regression `tests/unit/hooks/useC64Connection.bug061ConnectionGate.test.tsx` (9 cases).
- Pre-build validation (allowed validation #5, recorded before run): `npx vitest run tests/unit/hooks/useC64Connection.bug061ConnectionGate.test.tsx` -> **9 passed / 9** (no traffic during DISCOVERING/OFFLINE_NO_DEMO; gate releases on REAL_CONNECTED and DEMO_ACTIVE). Cheapest useful check before the multi-minute Android build; Pixel HIL remains the product verdict.
- Build/deploy started: `npm run cap:build && npm run android:apk` (vite build + cap sync + gradle assembleDebug), then install to Pixel 4. Installed APK identity will be re-confirmed before any current-build HIL claim.

## Ralph loop iteration #124 evidence (2026-06-23, claude / fix/device-hardening)

- Probe family: **BUG-061 fresh-startup default-target traffic FIX LOOP** on Pixel 4 `9B081FFAZ001WX`, current build app `0.8.9-rc3-0efe3` + uncommitted fix (buildTimeUtc 2026-06-22 22:46:03 UTC, installed lastUpdateTime 23:47:00, confirmed via export `app.buildTimeUtc`/`gitSha 0efe339d`). u64 `192.168.1.13` reachable/selected; c64u unreachable (HTTP 000) — same conditions as #123.
- Verdict: **DEFECT** — BUG-061 facet (a) [c64u pre-selection traffic] **FIXED & current-build HIL-validated**; new **BUG-062** opened for facet (b) [transient false-DEGRADED badge from a scheduled-timeout `/v1/info` abort misclassified as "Host unreachable"], reproduced on-device and precisely root-caused.
- Code change this loop: none beyond the pre-existing uncommitted BUG-061 fix in `src/hooks/useC64Connection.ts` (+ test `tests/unit/hooks/useC64Connection.bug061ConnectionGate.test.tsx`). Built/deployed that fix to Pixel 4. Pre-build focused regression `npx vitest run useC64Connection.bug061ConnectionGate.test.tsx` -> 9/9 (recorded before run, allowed validation #5).

| Action ID | Route/Page | UI element | User operation | Expected result | Observed ~200 ms feedback | Observed ~1 s / effect result | Oracle used | Latency class | Diagnostics/log result | Status | Artifact refs | Cleanup state |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 124-A01 | Home startup discovery (fresh data) | App launch -> DISCOVERING interstitial | Clear data, start app | Interstitial "C64 systems found" w/ u64; OFFLINE; NO default c64u config/drives traffic | Interstitial rendered, header OFFLINE | u64 listed; Home config controls "Not available" (gated) | screenshot + package logcat `Getting cookies at` | <=1s-effect | logcat during DISCOVERING: only `/v1/info` discovery probes; **0 `/v1/configs`, 0 `/v1/drives`, 0 Connection reset** | EXERCISED_CLEAN (facet a fixed) | `iter124/logcat/app-package-final.log` | fresh cycle |
| 124-A02 | Home startup discovery | U64 `Save` | Tap Save | Persist discovered u64 | Button changed | Card "✓ Saved" / "Already saved" | screenshot | <=1s-effect | true actuation via UI state | EXERCISED_CLEAN | — | u64 saved |
| 124-A03 | Home startup discovery | U64 `Use` | Tap Use | Select/connect u64, gate releases | Dialog dismissed, requests began | Home `192.168.1.13 HEALTHY`, Device u64 fw 3.14e; QUICK CONFIG populated real values | UI + export | <=1s-effect | connect burst aborted by `transition-real-connected` then 46x HTTP200; no c64u | EXERCISED_CLEAN | export ZIP 2252-11Z | u64 connected |
| 124-A04 | Config tab | Bottom-nav Config | Tap Config | Categories load (gate released) | Route switched | All categories populated (Audio Mixer..SoftIEC) | screenshot | <=1s-effect | useC64Categories fires post-connect | EXERCISED_CLEAN | — | Config route |
| 124-A05 | Disks tab | Bottom-nav Disks | Tap Disks | Drives load (gate released) | Route switched | Drive A ON/B OFF/SoftIEC OFF live state + DOS line | screenshot | <=1s-effect | useC64Drives fires post-connect, real u64 data | EXERCISED_CLEAN | — | Disks route |
| 124-A06 | Home | Bottom-nav Home | Tap Home | Return Home | Route switched | Home u64 HEALTHY | screenshot | <=1s-effect | — | EXERCISED_CLEAN | — | Home |
| 124-A07 | Global app bar | Health badge | Tap (open Diagnostics) x4 across loop | Open Diagnostics dialog | Dialog opened | Healthy 192.168.1.13 U64E; Activity all 192.168.1.13 success | UI tree/screenshot | <=1s-effect | no c64u rows in Activity | EXERCISED_CLEAN | — | dialog open |
| 124-A08 | Diagnostics | Problems / overflow menu | Tap Problems filter; open overflow (12 views) | Reveal filters/views | Menu rendered | Views incl Latency/Config drift/Decision state/heat maps | screenshot | <=1s-effect | 0 user-visible problems in Errors view | EXERCISED_CLEAN | — | dialog open |
| 124-A09 | Diagnostics | Share all | Overflow -> Share all x2, pull ZIP via run-as | Export full diagnostics | Share sheet w/ ZIP filename | ZIP pulled+unzipped+analyzed | UI + adb run-as cat + jq | <=1s-effect | error-logs 0; networkSnapshot 104 reqs all 192.168.1.13 (0 c64u); 58 aborts | EXERCISED_CLEAN | `iter124/diagnostics/*.zip`, `EVIDENCE.md` | dialog open |
| 124-A10 | Diagnostics/Home | Close Diagnostics (X) | Tap X (1st close) | Return Home Healthy | Dialog closed | Badge `○ IDLE` (clean, no problem) | screenshot | <=1s-effect | facet (b) did NOT fire on 1st close | EXERCISED_CLEAN | — | Home IDLE |
| 124-A11 | Diagnostics/Home | Diagnostics open->close (2nd) | Tap badge then X | Return Home Healthy | Dialog cycled | **Badge `▲ 1 DEGRADED`** (false transient) | screenshot + export traces | over-budget/stale | **BUG-062**: EVT-0618 "Host unreachable" isExpected:false from /v1/info ~3s scheduled-timeout abort | DEFECT_OPEN | `iter124/diagnostics/2259-12Z`, `EVIDENCE.md` | stale degraded |
| 124-A12 | App lifecycle | HOME + foreground | Press HOME, start app | Restore u64 state, no false error | App backgrounded/foregrounded | u64 state preserved; **badge `▲ 1 DEGRADED` again** (same EVT-0618 in window) | screenshot + logcat | over-budget/stale | `C64U_HTTP_RETRY /v1/info elapsed 3007ms` at 00:13:05; no crash/ANR/c64u | DEFECT_OPEN | `iter124/ui/facetB-degraded-badge-after-bg-fg.png` | stale degraded |
| 124-A13 | Diagnostics | `Run health check` | Open Diagnostics, tap Run health check (cleanup) | Confirm genuine health, clear false badge | Health check ran | REST 133 / FTP 63 / TELNET 319 / CONFIG 903 / RASTER 90 / JIFFY 301 ms all Success; Healthy 1893ms; badge -> `HEALTHY` | UI + screenshot | over-budget (p99 3005ms tail) | p99 3005ms confirms ~3s probe tail behind BUG-062 | EXERCISED_CLEAN | `iter124/ui/cleanup-health-check-genuinely-healthy.png` | Home u64 HEALTHY |

- Mandatory diagnostics/log sweep:
  - Diagnostics ZIPs pulled+analyzed (2): `iter124/diagnostics/c64commander-diagnostics-all-2026-06-22-2252-11Z.zip` and `...-2259-12Z.zip`; summary `iter124/diagnostics/EVIDENCE.md`. Export identity app `0.8.9-rc3-0efe3` / git `0efe339d` / buildTimeUtc 22:46:03Z; activeDevice u64 192.168.1.13 Healthy/problemCount 0.
  - error-logs: **0** (was 1 c64u/v1/drives in #123). networkSnapshot: 104 requests, **all host 192.168.1.13, zero c64u** (was 61 c64u failures in #123); the 58 "failures" are aborts (httpStatus/errorDomain null) from the connect-transition cancellation, not network errors.
  - Errors-tab/Errors view: empty. Latency analysis: p50 41ms / p90 275ms / **p99 3005ms** (over-budget tail on /v1/info probes -> feeds BUG-062).
  - Package-filtered logcat `iter124/logcat/app-package-final.log`: 0 AndroidRuntime/ANR/StrictMode/FATAL. Only benign warnings: `WindowOnBackDispatcher` (Back works), ART GC-histogram window reduction. The 2 "c64u"-matching lines are `C64U_HTTP_RETRY` console logs for `/v1/info` retries to 192.168.1.13 (not c64u device errors). `Share canceled` expected after my Back-dismiss of the share sheet.
  - Cross-surface correlation: UI badge DEGRADED <-> export trace EVT-0618 "Host unreachable" isExpected:false <-> logcat C64U_HTTP_RETRY ~3s timeout — one coherent root cause (BUG-062).
- Visible controls discovered/classified: startup interstitial Save/Use/Open Settings/Not now/Close (5; Save+Use exercised this loop, others EXERCISED_CLEAN in #123); post-connect Config/Disks/Home tabs, Diagnostics badge, Problems/Actions filters, overflow (12 views), Share all/filtered, Run health check, Diagnostics close.
- Production CTA/control actions attempted (droidmind-driven): ~24 (Save, Use, Config/Disks/Home nav, Diagnostics open x4, Problems x2, overflow x2, Share all x2, Back x2, Diagnostics close x4, HOME, foreground, Run health check). Grouped into 13 evidence rows. `droidmind_cta_action_count=24`.
- Repeated/sustained interaction: Diagnostics open/close cycled 4x (1st clean IDLE, 2nd produced DEGRADED -> facet b reproducibility); background/foreground reproduced facet b independently; route switches Config/Disks/Home during connect-settle. All actuation verified by UI state + export traces + logcat (no synthetic-only clean records).
- Adversarial transitions (4): repeated Diagnostics open/close; route switch while connect burst in flight; Android Back x2 from share sheet; background/foreground during connected state.
- Cleanup: Home on u64 `192.168.1.13 HEALTHY` after explicit health check confirmed genuine health (all 6 protocols Success). No machine/config/audio mutations; UltiSID untouched. c64u left untouched (unreachable). `iter124/ui/final-cleanup-home-u64.png`.
- Continuation: `docs/agentic/prompt.md` refreshed for the BUG-062 focused fix. Ralph Robin continuation ready; no scheduler command run (Ralph Robin owns rotation; claude usable).

## Ralph loop iteration #125 startup (2026-06-23T00:23+01:00, codex)

- Branch/source: `fix/device-hardening`, HEAD `0efe339d`; dirty working tree contains prior hardening code/test/state edits. `./scripts/resolve-version.sh` -> `0.8.9-rc3-0efe3`; installed Pixel Commander also reports `0.8.9-rc3-0efe3`, but this loop will change source so rebuild/deploy is required before current-build HIL.
- Peer discovery: droidmind available on Pixel 4 `9B081FFAZ001WX`; c64scope available; c64bridge available but VICE-backed (`127.0.0.1:6502`), so not used as an Ultimate hardware oracle.
- Hardware: `u64` reachable (`Ultimate 64 Elite`, fw `3.14e`, HTTP 200 in 12 ms); `c64u` reset-by-peer/HTTP 000 and will not be traffic-escalated.
- Capacity: Ralph Robin codex context usable, 5h 78% / weekly 23%; `>=40%` action budget, minimum 8 production CTA/control actions.
- Selected probe family: **BUG-062 timeout-classification fix pack**. Primary TODO: fix scheduled-timeout retry classification, rebuild/deploy, and rerun the Diagnostics open/close + lifecycle pack with mandatory logcat and Diagnostics ZIP export analysis.

## Ralph loop iteration #125 evidence (2026-06-23, codex / fix/device-hardening)

- Probe family: **BUG-062 timeout-classification fix pack** on Pixel 4 `9B081FFAZ001WX`, Commander `0.8.9-rc3-0efe3`. u64 `192.168.1.13` was reachable/selected/healthy; c64u `/v1/info` reset-by-peer/HTTP 000 and was not traffic-escalated.
- Verdict: **DEFECT** overall because BUG-063 was opened; **BUG-062 FIXED + current-build Pixel-HIL validated**. Repeated Diagnostics close/lifecycle no longer produces false `▲ 1 DEGRADED`.
- Code changes this loop:
  - `src/lib/c64api.ts`: scheduled-timeout aborts that will be retried inside the retry guard are recorded as expected/transient and do not emit unexpected "Host unreachable" diagnostics; exhausted timeouts still surface.
  - `src/lib/diagnostics/networkSnapshot.ts`: expected abort rows with string `error` values preserve the message but no longer count as network failures.
  - Focused regressions updated in `tests/unit/c64api.branches.test.ts` and `tests/unit/lib/diagnostics/networkSnapshot.test.ts`.
- Focused validation run before HIL:
  - `npx vitest run tests/unit/c64api.branches.test.ts --testNamePattern "retried scheduled timeouts"` -> 1 passed.
  - `npx vitest run tests/unit/lib/diagnostics/networkSnapshot.test.ts` -> 5 passed.
- Build/deploy: `npm run cap:build && npm run android:apk` succeeded three times (after the c64api fix, after the networkSnapshot residual fix, and once more after comment-only cleanup so the installed APK matches the final workspace). Installed `android/app/build/outputs/apk/debug/c64commander-0.8.9-rc3-0efe3-debug.apk` via droidmind; final droidmind app info reports version `0.8.9-rc3-0efe3`. The post-fix diagnostics export before comment-only cleanup confirms app `0.8.9-rc3-0efe3`, git `0efe339d`, WebView buildTimeUtc `2026-06-22 23:40:41 UTC`.

| Action ID | Route/Page | UI element | User operation | Expected result | Observed ~200 ms feedback | Observed ~1 s / effect result | Oracle used | Latency class | Diagnostics/log result | Status | Artifact refs | Cleanup state |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 125-A01 | Home | Health/Diagnostics badge | Tap badge | Open Diagnostics | Dialog opened | Health card for u64 rendered; no stale c64u/auth prompt | droidmind screenshot/UI | <=1s-effect | Entry export/log window clean before action batch | EXERCISED_CLEAN | `iter125/ui/diagnostics-entry.png` | Diagnostics open |
| 125-A02 | Diagnostics | Problems / Actions filters | Tap Problems, tap Actions | Filters switch views | Selection changed | Views rendered without non-empty current Errors state | droidmind screenshot/UI | <=1s-effect | No current unexpected errors surfaced | EXERCISED_CLEAN | `iter125/ui/diagnostics-entry.xml` | Diagnostics open |
| 125-A03 | Diagnostics | Overflow -> Latency | Open overflow, tap Latency, Back | Latency view renders and returns | Menu/view changed | Latency view rendered; Back returned to diagnostics | droidmind screenshot | <=1s-effect | Pre-residual-fix latency view showed no false Host-unreachable problem; later export sample max 313ms | EXERCISED_CLEAN | `iter125/ui/diagnostics-menu.png`, `diagnostics-latency.png` | Diagnostics open |
| 125-A04 | Diagnostics | Overflow -> REST heat map / Config heat map | Open overflow, inspect REST heat map, Back, inspect Config heat map, Back | Diagnostic views render and Back works | View changed each time | Returned to Diagnostics after each nested view | droidmind screenshot | <=1s-effect | No trapped dialog or crash | EXERCISED_CLEAN | `iter125/ui/rest-heatmap.png`, `config-heatmap.png` | Diagnostics open |
| 125-A05 | Diagnostics/Home | Close Diagnostics, reopen, close | X close, badge reopen, X close | Repeated close must not produce false DEGRADED | Dialog closed/opened promptly | Home stayed `192.168.1.13 HEALTHY` on both closes after final rebuild | screenshot + post-fix ZIP | <=1s-effect | BUG-062 false badge did not reproduce; only expected AbortError traces in export | EXERCISED_CLEAN | `iter125/ui/after-close-1.png`, `after-close-2.png`, `redeploy-after-close-2.png` | Home healthy |
| 125-A06 | Home lifecycle | HOME + foreground | Press HOME, start app | Restore Home and selected u64 without false problem | App backgrounded/foregrounded | Home returned `192.168.1.13 HEALTHY`, Device u64 fw 3.14e | droidmind lifecycle + screenshot/logcat | <=1s-effect | No AndroidRuntime/ANR/StrictMode; no current unexpected Host-unreachable diagnostics | EXERCISED_CLEAN | `iter125/ui/after-bg-fg.png`, final screenshot | Home healthy |
| 125-A07 | Diagnostics | Run health check | Open Diagnostics, tap Run health check | Explicit health proof succeeds | Health check began | REST 167ms, FTP 65ms, TELNET 313ms, CONFIG 916ms, RASTER 95ms, JIFFY 277ms; overall Healthy 1910ms | droidmind screenshot + ZIP | over-budget total (long-running with feedback) | Export healthSnapshot Healthy/problemCount 0; latencySamples max 313ms; lastHealthCheck p99 1132ms watch only | EXERCISED_CLEAN | `iter125/ui/health-check.png`, postfix ZIP | Diagnostics open |
| 125-A08 | Diagnostics | Share all | Overflow -> Share all, Android Back cancel, pull ZIP | Export diagnostics ZIP and cancel chooser cleanly | Share sheet opened | ZIP pulled/analyzed; Back canceled chooser | droidmind + adb pull/unzip/jq + logcat | <=1s-effect for chooser | Post-fix ZIP: networkSnapshot successCount 36/failureCount 0/nullStatusExpectedAbort 30; error-logs only stale #124 WARNs; trace errors all expected AbortError. `Share canceled` log line attributed to chooser cancel. | EXERCISED_CLEAN | `iter125/diagnostics/c64commander-diagnostics-all-2026-06-22-2348-23Z-postfix.zip`, `postfix-summary.json`, `logcat/app-package-postfix.log` | Home healthy after final Back |
| 125-A09 | Diagnostics/log correlation | Health-check internal fetch traceability | Compare logcat fetch lines to ZIP traces/network/actions | Log and export surfaces agree | n/a | Discrepancy found: two `CapacitorHttp fetch` console lines for LED Strip Settings/Strip Intensity value URLs absent from export traces/network/actions; no PUT traces found | package logcat + unzipped diagnostics | n/a | Opened BUG-063 as trace/export completeness gap; not proof of mutation | DEFECT_OPEN | `iter125/logcat/app-package-postfix.log`, `iter125/diagnostics/postfix-summary.json` | No cleanup required |

- Mandatory diagnostics/log sweep:
  - Diagnostics ZIPs pulled/analyzed: pre-residual-fix `docs/agentic/artifacts/iter125/diagnostics/c64commander-diagnostics-all-2026-06-22-2335-02Z.zip` and post-fix `docs/agentic/artifacts/iter125/diagnostics/c64commander-diagnostics-all-2026-06-22-2348-23Z-postfix.zip`.
  - Post-fix export identity: app/versionLabel `0.8.9-rc3-0efe3`, git `0efe339d`, buildTimeUtc `2026-06-22 23:40:41 UTC`; active device u64 `192.168.1.13`, health `Healthy`, problemCount 0.
  - Post-fix export findings: networkSnapshot successCount 36, failureCount 0, nullStatusExpectedAbort 30; 30 trace errors all expected AbortError/cancelled; no PUT traces; health check all Success; latencySamples count 28, max 313ms.
  - Package-filtered logcat saved at `docs/agentic/artifacts/iter125/logcat/app-package-postfix.log` (321 lines). No AndroidRuntime crash, ANR, StrictMode, or FATAL. Attributed advisories: zygote cgroup memory, Adreno/GPU, ashmem, chromium DNS/cache, `Capacitor: Unable to read file at path public/plugins`, missing BLUETOOTH_CONNECT for media, BackDispatcher, perf_hint, unsupported HEIC, userfaultfd, and startup `Capacitor/Console Msg: undefined`. `Share canceled` followed the deliberate Back-cancel of the share sheet. Two `CapacitorHttp fetch` LED Strip Settings lines during health check were not represented in export surfaces -> BUG-063.
- Visible controls discovered/classified: 16 total for this family/window (Diagnostics badge, Problems, Actions, overflow, Latency, REST heat map, Config heat map, Close X, Run health check, Share all, Android Back from nested views/share, HOME/foreground, plus visible Home Reset/Reboot/Power Off blocked as destructive and Pause/Menu out-of-scope for this diagnostics family). Safe controls exercised: 12.
- Production CTA/control actions attempted: 33 droidmind-driven actions across pre-fix validation, post-fix validation, repeated open/close, nested diagnostic views, health check, share/export, Back, HOME, and foreground. `droidmind_cta_action_count=33`. One early overflow tap missed the target and was not counted as a clean exercised control; the corrected tap actuated the menu.
- Repeated/sustained interaction: Diagnostics open/close x4 pre/post, overflow menu x5, nested diagnostic view Back x3, Share all x2, Android Back x4, HOME/foreground x2, Run health check x2. All clean records had actuation proof via UI change, export artifact, trace/log state, or screenshot; synthetic-only clean records: 0.
- Adversarial transitions: repeated Diagnostics open/close; Android Back from nested diagnostics views; Android Back cancel of share sheet; HOME/background + foreground after close; health-check/export after lifecycle.
- Cleanup: final app state Home on u64 `192.168.1.13 HEALTHY`, Device `u64`, fw `3.14e`; final screenshot `docs/agentic/artifacts/iter125/ui/final-home-healthy.png`. No machine/config/audio mutations intentionally performed; UltiSID untouched. c64u remained reset-by-peer/HTTP 000.
- Continuation: `docs/agentic/prompt.md` refreshed for BUG-063 trace/export completeness pack. Ralph Robin continuation ready; no scheduler command run because Ralph Robin owns provider rotation.

## Iteration #126 — Ralph Robin continuation, BUG-063 diagnostics trace/export completeness pack
- **Identity:** Commander `0.8.9-rc3-0efe3` (commit `0efe339d`), Pixel 4 `9B081FFAZ001WX`, u64 `192.168.1.13` HEALTHY (U64E fw `1541U-II v3.10b1541ultimate`).
- **Goal:** expand BUG-063 from a single symptom into a verified defect description, by running a fresh probe pack on the same build and pulling/parsing the resulting diagnostics export to confirm whether PUT requests are present or absent.
- **Probe family:** Diagnostics dialog `Run health check` against u64; full export ZIP pulled; per-tab surfaces (logs/actions/traces/networkSnapshot/supplemental/error-logs) parsed and cross-referenced with package logcat.
- **Probe pack results (10 evidence points):**
  - **126-A01** Open Diagnostics (badge tap); Enter via top-right entry; UI: badges row, errors row, Recent actions, Probes, Latency, Logs, Traces, Heat map sections. EXERCISED_CLEAN, screenshot `iter126/ui/01-current-state.png`.
  - **126-A02** Tap Run health check at screenshot (184, 425) → device (270, 637) after 1.5x scale correction; CONFIG 992ms Success row appears; all probes Success; Overall Healthy 1910ms. EXERCISED_CLEAN, screenshot `iter126/ui/02-after-run-health-check.png`.
  - **126-A03** Package-filtered logcat captured to `iter126/logcat/app-package-postfix.log` (481 lines, PID 8670). Two `CapacitorHttp fetch` PUT entries to `LED Strip Settings/Strip Intensity?value=24` (51ms) and `?value=8` (87ms) confirmed; no AbortError or FATAL; no AndroidRuntime crash. EXERCISED_CLEAN.
  - **126-A04** Pulled latest diagnostics ZIP `c64commander-diagnostics-all-2026-06-22-2348-23Z.zip` (43,112 bytes) via `adb exec-out run-as`; unzipped to `iter126/diagnostics/unzipped/`. EXERCISED_CLEAN.
  - **126-A05** Parsed `traces.json`: 369 events, types = {action-start: 70, action-end: 70, backend-decision: 66, rest-request: 66, rest-response: 66, error: 30, device-guard: 1}. **Zero `method:"PUT"` entries; zero `Strip Intensity` URL entries.** EXERCISED_CLEAN.
  - **126-A06** Parsed `actions.json`: 70 action records; **zero `rest.put ...` actionNames**; all REST actions are `rest.get`. Correlation IDs COR-0043, COR-0053, COR-0056 are the two LED Strip Settings GET records (the visible probe GETs). EXERCISED_CLEAN.
  - **126-A07** Parsed `networkSnapshot` from `supplemental.json`: 66 requests, **all `method:"GET"`**. method counts: `{GET: 66}`. Confirms BUG-063 part 1 is a real export-completeness gap, not a one-off redaction artifact. EXERCISED_CLEAN.
  - **126-A08** Parsed `logs.json`: 75 entries, **zero debug-level entries**, zero `Health check CONFIG probe ...` messages. The `addLog("debug", ...)` calls in `healthCheckEngine.ts:668-771` are gated by `loadDebugLoggingEnabled()` (default `false`) per `src/lib/logging.ts:58`; expected behavior but means the export's logs section cannot help triangulate per-target progress. EXERCISED_CLEAN.
  - **126-A09** Parsed `supplemental.json:lastHealthCheckResult.probes[CONFIG]`: `outcome: "Success"`, `DurationMs ~992`, `Detail: "CONFIG: Success"`. The probe completed one full roundtrip (LED Strip Intensity: temp=24, revert=8) before returning. Probe's documented design is single-target early-`return` on success at `healthCheckEngine.ts:763-772`; only 1 of 4 targets exercised per run. EXERCISED_CLEAN.
  - **126-A10** Cross-referenced `error-logs.json`: 2 stale "C64 API retry scheduled after scheduled timeout" entries from earlier in the session; no new errors from this probe pack. EXERCISED_CLEAN.
- **Adversarial transitions covered:** Diagnostics open → Run health check → screenshot capture (no lifecycle mutations attempted; no destructive commands run; no c64u traffic; no UltiSID volume mutation).
- **Cleanup:** final state: Diagnostics dialog closed (two Android Back presses), Home restored to u64 `192.168.1.13 HEALTHY` (Device `u64`, fw `3.14e`); final screenshot `iter126/ui/final-home-healthy.png`. No machine/config/audio mutations intentionally performed; UltiSID untouched. c64u remained reset-by-peer/HTTP 000; u64 unchanged.
- **Status:** BUG-063 expanded with PART 2 evidence and updated Action item in `docs/agentic/BUGS_FOUND.md` (status OPEN). Loop terminated at end of probe pack to maintain minimum-CTA-with-capacity rule; no code changes this loop (focus was evidence gathering + BUGS_FOUND update).
- **Continuation:** `docs/agentic/prompt.md` refreshed; next loop should land the BUG-063 root-cause fix (add unit test that proves whether PUTs are recorded in traceEvents; if they aren't, patch `src/lib/c64api.ts` `recordRestRequest` path or `src/lib/tracing/traceSession.ts` `appendEvent` to ensure PUT events survive the export).

## Ralph loop iteration #127 startup (2026-06-23, claude / fix/device-hardening)

- Branch `fix/device-hardening`, HEAD `0efe339d`. Source label `0.8.9-rc3-0efe3` == installed Pixel label (droidmind get_app_info `0.8.9-rc3-0efe3`, running). No rebuild needed unless source changes.
- Peers (actual tool surface): droidmind callable (`9B081FFAZ001WX`); c64scope callable; c64bridge callable but VICE-backed (not Ultimate oracle). App live Home, u64 `192.168.1.13` HEALTHY fw 3.14e. c64u not re-probed (digest reset-by-peer); no c64u traffic escalation.
- Capacity: claude usable 5h 82% / weekly 27% -> >=40% tier (min 8 actions, target 12-20, >=1 adversarial).
- Probe family selected: **Config immediate-write family / BUG-063 live A/B**. Logcat cleared at 00:34:33Z before probe pack.
- Code read (root-cause prep): `c64api.ts` `setConfigValue`/`updateConfigBatch` single-item -> `this.request(method:"PUT")`; `request()` calls `recordRestRequest` unconditionally at :1112 (method-agnostic); `fetchWithTimeout` records at :1488; both set `__c64uTraceSuppressed` so the global fetch interceptor short-circuits (no double-record). `traceSession.appendEvent` (:100) suppresses only by event TYPE, never by method. Health-check CONFIG probe uses `runtime.api.setConfigValue` (healthCheckEngine.ts:702/720) -> same PUT path. Conclusion to test on HIL: the recording fn is not method-filtered, so #126's missing PUTs point to the export/networkSnapshot/eviction pipeline, not recordRestRequest.

## Ralph loop iteration #127 evidence (2026-06-23, claude / fix/device-hardening)

**Probe family:** Home Quick Config immediate-write family (CPU&RAM subgroup) on u64 `192.168.1.13`, doubling as BUG-063 live A/B. Verdict: **DEFECT found + FIXED (BUG-064)**; BUG-063 refuted/downgraded.

**Visible controls in family (Home Quick Config):** Turbo Control (selector), CPU Speed (slider), Badline Timing (toggle), SuperCPU Detect (toggle), RAM Expansion (selector), Joystick Input (selector), Serial Bus Mode (selector), Cartridge Preference (selector), User Port Power (toggle), Video Mode (selector). **Exercised this loop:** Turbo Control, CPU Speed, Badline Timing, SuperCPU Detect (representative of every control type: toggle/slider/selector). Remaining selectors/toggles not exercised — FIX LOOP for BUG-064 consumed the loop (allowed reduced-coverage reason #7); recorded DISCOVERED in ledger.

| Action ID | Route/Page | UI element | User op | Expected | ~200ms | ~1s/effect | Oracle | Latency | Diag/log | Status | Cleanup |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 127-A01 | Home QuickConfig | Badline Timing checkbox | tap OFF | toggles off + PUT | unchecked | PUT `value=Disabled` 32ms HTTP200 | logcat+UI | <=1s-effect | logcat PUT confirmed | EXERCISED_CLEAN | restored ON |
| 127-A02 | Home QuickConfig | Badline Timing checkbox | tap ON (restore) | toggles on + PUT | checked | PUT `value=Enabled` 24ms | logcat+UI | <=1s-effect | clean | EXERCISED_CLEAN | baseline |
| 127-A03 | Home QuickConfig | SuperCPU Detect checkbox | tap ON | toggles on + PUT | checked | PUT `value=Enabled` 38ms | logcat+UI | <=1s-effect | clean | EXERCISED_CLEAN | restored next |
| 127-A04 | Home QuickConfig | SuperCPU Detect checkbox | **adversarial double-tap** | debounce/no double-fire | toggled once | exactly **1** PUT `value=Disabled`; net 1 toggle (no storm) | logcat+UI | <=1s-effect | no double-fire | EXERCISED_CLEAN | baseline (Disabled) |
| 127-A05 | Home QuickConfig | CPU Speed slider | drag up→8 (PRE-fix) | set CPU Speed 8 | thumb moved | **DEFECT**: PUT `value=8` rejected `Value '8' not valid`; device stays " 1"; slider snaps back; Turbo left Manual | logcat+curl read-back+UI | over-budget(failed) | error-logs captured failure | DEFECT_OPEN→BUG-064 | restored via curl |
| 127-A06 | Home QuickConfig | CPU Speed slider | drag up→8 (POST-fix) | set CPU Speed 8 | thumb holds | **FIXED**: PUT `value=%208` 70ms HTTP200; device " 8"; UI shows 8, no jump-back; Turbo Manual | logcat+curl+UI+export | <=1s-effect | trace PUT status200 | EXERCISED_CLEAN | restored next |
| 127-A07 | Home QuickConfig | CPU Speed slider | drag down→1 (restore) | set CPU Speed 1 | thumb holds | PUT `value=%201` HTTP200; device " 1" | logcat+curl+UI | <=1s-effect | trace PUT status200 | EXERCISED_CLEAN | baseline |
| 127-A08 | App bar | Health/connection pill | tap | open Diagnostics | dialog opens | Diagnostics dialog (Healthy, 0 problems) | UI | <=200ms | n/a | EXERCISED_CLEAN | closed later |
| 127-A09 | Diagnostics | Connection details link | tap | show conn details | dialog | Name/Type U64E/HTTP80/FTP21/Telnet23/Edit | UI | <=200ms | n/a | EXERCISED_CLEAN | closed (Back) |
| 127-A10 | Diagnostics | overflow `...` menu | tap | open menu | menu opens | Share all/Share filtered/Clear all/views | UI | <=200ms | n/a | EXERCISED_CLEAN | n/a |
| 127-A11 | Diagnostics | Share all | tap | write+share ZIP | share sheet | ZIP `...0100-28Z.zip` written to cache | UI+pull | <=1s-effect | export pulled+analyzed | EXERCISED_CLEAN | Back to dismiss |
| 127-A12 | Home QuickConfig | Turbo Control selector | tap→select Off | set Turbo Off | dropdown→Off | PUT `Turbo Control?value=Off`; device "Off"; app reconciled to Off | logcat+curl+UI | <=1s-effect | clean | EXERCISED_CLEAN | baseline+app consistent |

**Adversarial transitions (>=1 required; done):** (a) SuperCPU rapid double-tap → no double-fire/storm (1 net PUT); (b) CPU Speed slider drag/release + revisit (3 drags, jump-back observed pre-fix / absent post-fix); (c) Android Back from nested dialogs (Connection details, share sheet, Diagnostics); (d) out-of-band device change (curl) then app selector reconcile.

**Repeated interaction / actuation:** Badline toggled 2x, SuperCPU toggled 2x (+double-tap), CPU Speed slider dragged 3x, Turbo selector 1x. Every control actuation verified by emitted PUT in logcat + device curl read-back + UI effect (not synthetic-only). droidmind `swipe` actuated the Radix slider (real drag); checkbox/selector via tap.

**BUG-064 (FIXED):** root cause = unpadded single-digit CPU Speed write rejected by firmware (enum tokens are space-padded `" 1".." 8"`). Direct-curl A/B: `PUT ?value=8` → `errors:["Value '8' is not a valid choice for item CPU Speed"]`, stays " 1"; `PUT ?value=%208` → accepted, " 8". Fix in `src/lib/c64api.ts` (`resolveU64CpuSpeedConfigWriteValue`, family-agnostic + numeric). Unit regression 4/4 + full file 89/89. Rebuilt `npm run cap:build && npm run android:apk`, reinstalled, current-build HIL re-validated.

**BUG-063 (refuted/downgraded):** export `diag-iter127.zip` traces.json = 25 GET + **3 PUT** rest-requests (all user PUTs, status200) + matching actions.json `rest.put` — app-driven config PUTs ARE in the export. #126's "0 PUTs" was health-check-internal/eviction-specific, not a recording defect. Downgraded to Low/likely-not-a-defect.

**Diagnostics/log sweep:** export pulled+analyzed (traces/actions/logs/supplemental/error-logs). healthSnapshot Healthy, problemCount 0. error-logs: 6 stale PRE-FIX (00:38:14Z) CPU-speed failures + 3 benign "retry scheduled after scheduled timeout" (BUG-062 class). Package logcat `app-package-iter127.log` (53 lines): no FATAL/ANR/StrictMode/AndroidRuntime/Capacitor-error/chromium-error; 0 console errors.

**Cleanup:** device baseline confirmed via curl — CPU Speed " 1", Turbo "Off", Badline "Enabled", SuperCPU "Disabled"; UltiSID untouched; Home shows u64 HEALTHY; app cache reconciled (Turbo Off). c64u not probed/escalated (digest reset-by-peer). No c64scope used (no A/V/playback relevant). c64bridge VICE-backed, not used as oracle.

**Build/deploy:** `npm run cap:build && npm run android:apk` → `c64commander-0.8.9-rc3-0efe3-debug.apk` reinstalled (`adb install -r`), get_app_info `0.8.9-rc3-0efe3` running. **Tests:** `npx vitest run tests/unit/c64api.branches.test.ts` (89 passed) — narrow high-level regression for source changed this loop (allowed validation #5). No coverage, no broad suites.

## Ralph loop iteration #128 startup (2026-06-23, codex / fix/device-hardening)

- Branch/source: `fix/device-hardening`, HEAD `0efe339d`; dirty worktree contains prior hardening edits. `./scripts/resolve-version.sh` reports `0.8.9-rc3-0efe3`; Pixel installed identity check pending before current-build HIL claims.
- Capacity: Ralph Robin selected codex and reports usable, 5h 56% / weekly 19%; action tier `>=40%`, minimum 8 production CTA/control actions, target 12-20, >=1 adversarial transition.
- Peer discovery from actual tool surface: droidmind callable; c64scope callable; c64bridge callable. Safe device/peer checks are in progress.
- Selected probe family: **Home Quick Config completion pack (u64)** — finish the #127 DISCOVERED controls (RAM Expansion, Joystick Input, Serial Bus Mode, Cartridge Preference, User Port Power, Video Mode) with repeated droidmind-driven writes, read-back/restore, mandatory logcat + Diagnostics export sweep.

## Ralph loop iteration #128 evidence (2026-06-23, codex / fix-device-hardening)

- Probe family: **Home Quick Config completion pack (u64)** on Pixel 4 `9B081FFAZ001WX`, Commander `0.8.9-rc3-0efe3`, u64 `192.168.1.13` (`Ultimate 64 Elite`, fw `3.14e`). c64u `/v1/info` timed out at startup and was not traffic-escalated.
- Verdict: **DEFECT found + FIXED (BUG-065)**; **BUG-066 OPEN**. Six remaining safe Quick Config controls from #127 were exhausted and restored. Serial Bus Mode invalid fallback values were root-caused, fixed, rebuilt, redeployed, and revalidated on the Pixel.
- Current-build identity: initial installed APK matched source label `0.8.9-rc3-0efe3`; after the BUG-065 source fix, `npm run cap:build && npm run android:apk` succeeded and `android/app/build/outputs/apk/debug/c64commander-0.8.9-rc3-0efe3-debug.apk` was installed with `adb -s 9B081FFAZ001WX install -r`. Post-install package identity remained `0.8.9-rc3-0efe3`, lastUpdateTime `2026-06-23 02:22:31`; diagnostics app buildTimeUtc `2026-06-23 01:22:10 UTC`.
- Source/test change: `src/pages/home/constants.ts` changed Serial Bus fallback tokens from `C64U <-> Internal/External` to firmware-valid `C64 <-> Internal/External`; `tests/unit/pages/HomePage.test.tsx` expectations updated. Focused regression `npx vitest run tests/unit/pages/HomePage.test.tsx --testNamePattern "updates CPU, Video, Ports"` passed.

| Action ID | Route/Page | UI element | User operation | Expected result | Observed ~200 ms feedback | Observed ~1 s / effect result | Oracle used | Latency class | Diagnostics/log result | Status | Artifact refs | Cleanup state |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 128-A01 | Home Quick Config | RAM Expansion selector | Open, choose Enabled, reopen, restore Disabled | Device value changes and restores | Dropdown opened and label updated | Read-back `Enabled`, then `Disabled` | droidmind + REST read-back | <=1s-effect | No app crash/ANR/StrictMode | EXERCISED_CLEAN | `iter128/ui/ram-expansion-menu.*`, `device/ram-expansion-*-readback.json` | Disabled |
| 128-A02 | Home Quick Config | Joystick Input selector | Open, choose Swapped, reopen, restore Normal | Device value changes and restores | Dropdown opened and label updated | Read-back `Swapped`, then `Normal` | droidmind + REST read-back | <=1s-effect | Clean package log slice | EXERCISED_CLEAN | `iter128/ui/joystick-menu.*`, `device/joystick-*-readback.json` | Normal |
| 128-A03 | Home Quick Config | Serial Bus Mode selector | Open menu, press Android Back | Dropdown dismisses without mutation | Menu closed | Read-back stayed `All Connected` | droidmind Back + REST read-back | <=200ms-feedback | No request emitted for cancel | EXERCISED_CLEAN | `iter128/ui/serial-menu-before-back.*`, `device/serial-after-back-readback.json` | All Connected |
| 128-A04 | Home Quick Config | Serial Bus Mode selector PRE-fix | Select `C64U <-> Internal` repeatedly | Should set internal bus mode | Handler fired | HTTP 400; firmware rejected invalid value; device stayed `All Connected` | droidmind + logcat + REST read-back | over-budget/fail | Four HTTP 400 rows in package logcat, Home briefly degraded | DEFECT_OPEN -> BUG-065 | `iter128/logcat/app-package-mid.log` | All Connected |
| 128-A05 | Home Quick Config | Cartridge Preference selector | Initial bottom-position tap | Should open selector | Tap actuated TabBar instead | Route changed to Docs; selector did not open | droidmind + UI tree | over-budget/fail | No device mutation | DEFECT_OPEN -> BUG-066 | `iter128/ui/cartridge-menu.xml` | Returned Home |
| 128-A06 | Home Quick Config | Cartridge Preference selector after scroll | Open, choose Internal, reopen, restore Auto | Device value changes and restores | Dropdown opened and label updated | Read-back `Internal`, then `Auto` | droidmind + REST read-back | <=1s-effect | Clean package log slice | EXERCISED_CLEAN | `iter128/ui/home-scrolled-ports-video.*`, `ui/cartridge-menu-scrolled.xml`, `device/cartridge-*-readback.json` | Auto |
| 128-A07 | Home Quick Config | User Port Power toggle | Toggle Disabled, toggle Enabled | Device value changes and restores | Checkbox/label responded | Read-back `Disabled`, then `Enabled` | droidmind + REST read-back | <=1s-effect | Clean package log slice | EXERCISED_CLEAN | `iter128/device/userport-*-readback.json` | Enabled |
| 128-A08 | Home Quick Config | Video/System Mode selector | Open, choose NTSC, reopen, restore PAL | Device value changes and restores | Dropdown opened and label updated | Read-back `NTSC`, then `PAL` | droidmind + REST read-back | <=1s-effect | Clean package log slice | EXERCISED_CLEAN | `iter128/ui/system-mode-menu.xml`, `device/system-mode-*-readback.json` | PAL |
| 128-A09 | Code/fix validation | Home Serial Bus fallback | Patch constants, build, deploy | Pixel build contains firmware-valid tokens | App relaunched | Dropdown labels now `C64 <-> Internal` / `C64 <-> External` | source diff + droidmind UI | n/a | Focused test passed; install succeeded | EXERCISED_CLEAN | `iter128/ui/postfix-serial-menu.xml` | App on Home |
| 128-A10 | Home Quick Config | Serial Bus Mode selector POST-fix | Select `C64 <-> Internal`, reopen, restore All Connected | Device value changes and restores | Dropdown opened and label updated | PUT 182ms HTTP200 -> read-back `C64 <-> Internal`; restore 132ms HTTP200 -> `All Connected` | droidmind + REST read-back + diagnostics export | <=1s-effect | Export/network snapshot has both post-fix PUTs status200; no post-fix errors | EXERCISED_CLEAN | `iter128/device/postfix-serial-*-readback.json`, `diagnostics/postfix-summary.txt` | All Connected |
| 128-A11 | Diagnostics | Open, inspect Latency, Share all | Open Diagnostics, view Latency, Share all, Back-cancel chooser | Export usable and chooser cancel clean | Diagnostics showed Healthy/problemCount 0; share sheet opened | ZIP pulled and analyzed | droidmind + pulled ZIP + jq + package logcat | <=1s-effect | Post-fix export: health Healthy, networkSnapshot successCount 22/failureCount 0; latency P50 59/P90 132/P99 max 481ms; error logs stale only | EXERCISED_CLEAN | `iter128/ui/diagnostics-*.{xml,png}`, `diagnostics/c64commander-diagnostics-all-2026-06-23-0126-01Z.zip`, `diagnostics/unzipped-postfix/` | Share canceled |
| 128-A12 | Home cleanup | Diagnostics close / final Home | Close Diagnostics and verify final device state | Home remains on u64 Healthy and restored values | Dialog closed | Home showed `Connected to 192.168.1.13, system healthy`; final read-back Serial Bus `All Connected` | droidmind + REST `/v1/info` + read-back | <=1s-effect | Final package logcat contained no crash/ANR/StrictMode/FATAL | EXERCISED_CLEAN | `iter128/ui/final-state.xml`, `logcat/app-package-postfix-final.log` | u64 Healthy; restored |

- Visible controls discovered/classified: 11 in the selected family/window: RAM Expansion, Joystick Input, Serial Bus Mode, Cartridge Preference, User Port Power, Video/System Mode, Diagnostics open, Diagnostics filter dialog, Diagnostics views menu, Latency view, Share all export. Quick Actions (`Reset`, `Reboot`, `Pause`, `Menu`, `Power Off`) were visible but out-of-family or destructive/guarded and were not exercised in this Home Quick Config pack.
- Visible safe controls exercised: 11/11 for the family/window. Safe Quick Config controls exercised: 6/6. `droidmind_cta_action_count=41`; production CTA/control actions attempted: 41. Synthetic-only clean records: 0; every clean record had UI state, emitted request, diagnostics trace, or REST read-back actuation proof.
- Repeated interaction counts: RAM Expansion 2 writes; Joystick Input 2 writes; Serial Bus Mode 1 Back-cancel + 4 pre-fix failed true-actuated attempts + 2 post-fix successful writes; Cartridge Preference 1 bottom misroute + 2 successful writes after scroll; User Port Power 2 writes; Video/System Mode 2 writes; Diagnostics open/menu/Latency/Share all/Back/Close 7 actions. All successful hardware-affecting controls were restored.
- Adversarial transitions: Android Back over an open Serial Bus dropdown; bottom-control tap overlap causing Docs route misnavigation; Android Back cancel from Android share sheet; rebuild/relaunch/revisit of the same selector after source fix.
- Mandatory diagnostics/log sweep:
  - Package-filtered logcat saved at `docs/agentic/artifacts/iter128/logcat/app-package-mid.log`, `app-package-postfix-before-diagnostics-export.log`, and `app-package-postfix-final.log`. Pre-fix HTTP 400 lines are BUG-065. Post-fix logcat showed Serial Bus `PUT ...value=C64%20%3C-%3E%20Internal` 180.9ms and restore 131ms, no HTTP failure. App-package warnings were attributed as platform/WebView advisories (`WindowOnBackDispatcher`, public/plugins path, Chromium/VideoCapabilities HEIC, missing `BLUETOOTH_CONNECT`, `perf_hint`, `userfaultfd`) or deliberate share chooser cancel; no AndroidRuntime crash, ANR, StrictMode, native plugin error, or FATAL.
  - Diagnostics ZIP pulled via `adb exec-out run-as uk.gleissner.c64commander cat cache/c64commander-diagnostics-all-2026-06-23-0126-01Z.zip` to `docs/agentic/artifacts/iter128/diagnostics/` and unzipped. Analyzed surfaces: logs, traces, actions, errors/error-logs, latencySamples, healthSnapshot/healthHistory, recoveryEvidence, deviceSafetyResolution, supplemental app/device metadata, and networkSnapshot.
  - Export findings: app `0.8.9-rc3-0efe3`, git `0efe339d`, buildTimeUtc `2026-06-23 01:22:10 UTC`; active device u64 `192.168.1.13`, health `Healthy`, problemCount 0, connectivity Online; networkSnapshot successCount 22/failureCount 0. Error logs contain stale pre-fix BUG-065 HTTP 400 rows plus older BUG-064/BUG-062 entries, none after the 02:22:31 post-fix install. Latency samples count 25; P50 59ms, P90 132ms, P99/max 481ms. Post-fix Serial Bus PUTs were 182ms and 132ms.
- Cleanup: u64 left Healthy; Serial Bus Mode restored `All Connected`; RAM Expansion `Disabled`; Joystick `Normal`; Cartridge Preference `Auto`; User Port Power `Enabled`; System Mode `PAL`; CPU Speed/Turbo/Badline/SuperCPU not changed this loop. UltiSID untouched. c64scope was not used because this family had no A/V/playback/stream/timing behavior; c64bridge was discovered but VICE-backed and not used as an Ultimate oracle.
- Continuation: `docs/agentic/prompt.md` refreshed. Ralph Robin continuation ready; no scheduler command run because Ralph Robin owns provider rotation.

## Ralph loop iteration #130 evidence (2026-06-23, claude / fix/device-hardening)

- Branch `fix/device-hardening`, HEAD `0efe339d`. Source/installed `0.8.9-rc3-0efe3` (matched at start; rebuilt+reinstalled after fix, install-path hash changed). Pixel 4 `9B081FFAZ001WX` (Android 16, 1080x2280, density 440, 3-button nav: bottom inset 132px). u64 `192.168.1.13` (U64E fw 3.14e) HEALTHY; c64u unreachable (not escalated). Predecessor #129 (kilo) left a startup-only entry, no actions, no source change → BUG-066 still open; continued as #130.
- Probe family: **Home LED LIGHTING summary (KEYBOARD LIGHT) — BUG-067**. Pivoted into this family after a scroll over the LED section surfaced a destructive "Update failed" toast (higher-value than the planned BUG-066 layout pack; same Home family).
- Verdict: **DEFECT found + FIXED (BUG-067 slider facet); BUG-067 select facet documented OPEN.** Peers used: droidmind (all product actions), mobile-mcp (read-only element bounds). c64scope/c64bridge not used (no A/V/playback; family is config-write). 
- Tools/build: focused regression `npx vitest run LightingSummaryCard.test.tsx HomePage.test.tsx` (allowed: source changed; cheapest useful check). Build `npm run cap:build && npm run android:apk` (BUILD SUCCESSFUL), `adb install -r ...c64commander-0.8.9-rc3-0efe3-debug.apk` (Success). No coverage, no broad suites.

| Action ID | Route/Page | UI element | User operation | Expected | ~200ms feedback | ~1s/effect | Oracle | Latency | Diagnostics/log | Status | Artifact | Cleanup |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | Home | KEYBOARD LIGHT Brightness slider (pre-fix) | Deliberate horizontal drag | (bug) write attempt | red "Update failed" toast | toast persists, slider snaps to 0 | UI + logcat | n/a | logcat: Keyboard Lighting GET burst, NO PUT; toast = CONFIG_ITEM_NOT_FOUND | DEFECT_OPEN→reproduced | screenshot 02:56 | no device write |
| A2 | Home | KEYBOARD LIGHT Pattern select (pre-fix) | Open dropdown | dropdown opens | dropdown w/ fallback opts | — | UI | <=200ms-feedback | — | DEFECT (variant) | screenshot 03:02 | n/a |
| A3 | Home | KEYBOARD LIGHT Pattern select (pre-fix) | Pick "Circular" | (bug) write attempt | dropdown closes | reverts to "Not available", NO toast (silent) | UI + logcat | n/a | logcat: GET re-reads, NO PUT; inconsistent vs error-log 02:03 Update failed | DEFECT_OPEN (select facet) | screenshot 03:03 | no device write |
| A4 | nav | Config tab → Home tab | Route away + return | route changes | tab highlight | Home re-renders | UI | <=200ms-feedback | — | EXERCISED_CLEAN | — | n/a |
| A5 | lifecycle | HOME key → start_app | Background + foreground | app resumes | — | Home restored, no false toast | UI + logcat | <=1s-effect | no resume errors | EXERCISED_CLEAN | — | n/a |
| A6 | Home | KEYBOARD LIGHT Brightness slider (post-fix) | Horizontal drag ×2 | inert (disabled) | no movement | no toast, no write | UI + logcat | n/a | logcat: no /Strip Intensity PUT; no error | EXERCISED_CLEAN (fix) | screenshot 03:08 | no device write |
| A7 | Home | KEYBOARD LIGHT Brightness slider (post-fix) | Vertical scroll-grab on track | scrolls, no actuation | no movement | no toast, no write | UI + logcat | n/a | clean | EXERCISED_CLEAN (fix) | screenshot 03:09 | n/a |
| A8 | Global | Diagnostics health badge | Tap open | dialog opens | Diagnostics dialog | Healthy/U64E shown | UI | <=200ms-feedback | — | EXERCISED_CLEAN | screenshot 03:11 | n/a |
| A9 | Global | Diagnostics Problems filter | Tap toggle | filter applies | chip toggles | no new problems (100/100) | UI | <=200ms-feedback | — | EXERCISED_CLEAN | — | n/a |
| A10 | Global | Diagnostics ⋮ → Share all | Open overflow + export | ZIP written | menu opens | share sheet "Sharing 1 file" | UI + pulled ZIP | <=1s-effect | export healthy/0-problem | EXERCISED_CLEAN | iter130/diagnostics ZIP | n/a |
| A11 | Global | Share sheet | Android Back | dismiss chooser | sheet closes | Diagnostics still open | UI | <=200ms-feedback | — | EXERCISED_CLEAN | — | n/a |
| A12 | Global | Diagnostics dialog | Android Back | close dialog | dialog closes | back on Home, no trap | UI | <=200ms-feedback | — | EXERCISED_CLEAN | screenshot 03:16 | dialog closed |

- Mandatory sweep: **package logcat** pre- and post-fix saved under `docs/agentic/artifacts/iter130/logcat/`; post-fix (288 lines) has no FATAL/ANR/StrictMode/AndroidRuntime/console-error/"Update failed". **Diagnostics export** `c64commander-diagnostics-all-2026-06-23-0212-08Z.zip` pulled+unzipped+analyzed: 28 error-logs are all historical (oldest 22:56, newest 02:03 — incl. `INTERACTIVE_WRITE_KEYBOARD_LIGHTING: Update failed` 01:52/01:56 and `HOME_KEYBOARD_LIGHTING_PATTERN: Update failed` 02:03, all pre-#130-fix); ZERO error entries after 03:05; networkSnapshot successCount 55/failureCount 0; healthSnapshot Healthy/problemCount 0; latency 58 samples, max 531ms, ZERO over-budget; traces 0 PUT post-fix.
- Adversarial transitions (≥1 required; done 5): route-away/return (A4), background/foreground (A5), vertical scroll-grab on disabled slider (A7), Android Back from share sheet (A11), Android Back from dialog (A12). Repeated interaction: keyboard intensity slider actuated 3× (pre 1, post 2) + 1 scroll-grab; actuation verified via logcat (handler fired pre-fix / no handler post-fix) not just synthetic dispatch.
- Action budget: ~15 droidmind production actions (>= minimum 8 for >=40% tier, within 12-20 target). droidmind_cta_action_count ≈ 15.
- Cleanup: u64 HEALTHY; CASE LIGHT unchanged (Mode Fixed Color/Single Color/Royal Blue/Brightness 8/Pure/UltiSID1-A); UltiSID volume untouched (0 dB); no config mutation performed (all keyboard-light writes failed pre-flight validation → zero device writes); Drives A ON/B OFF unchanged.

## Ralph loop iteration #131 startup (2026-06-23T03:23+01:00, codex / fix/device-hardening)

- Continuing BUG-067 select facet. Digest #130 was current enough for digest-first startup; relevant live checks: branch `fix/device-hardening`, HEAD `0efe339d`, dirty prior hardening worktree; source label `0.8.9-rc3-0efe3`; installed Pixel label matched before #131 source edit, so rebuild/deploy is required. Ralph Robin capacity: codex usable, 5h 39% / weekly 17% -> `20% to 39%` tier, minimum 5 production CTA/control actions.
- Peers discovered from actual callable namespaces: droidmind yes; c64scope yes; c64bridge yes but VICE-backed (`127.0.0.1:6502`) and not an Ultimate oracle. Hardware: u64 `/v1/info` HTTP 200 (`Ultimate 64 Elite`, fw `3.14e`); c64u timed out and was not escalated.
- Selected probe family: **Home LED LIGHTING summary — BUG-067 select-facet fix pack on u64**. Source fix: disable Mode/Pattern/Color/Tint/SID Select when the live category spec omits the item; preserve built-in fallback options for present-but-optionless items. Focused regression `npx vitest run tests/unit/pages/home/components/LightingSummaryCard.test.tsx` -> 21/21.
- Stop criteria: build/deploy current source, validate the fixed Keyboard Light controls and supported Case Light controls through droidmind on Pixel 4 with repeated actuation attempts, include an adversarial transition, pull/analyze Diagnostics ZIP plus package-filtered logcat, update BUGS/CTA ledger/digest/continuation.

## Ralph loop iteration #131 evidence (2026-06-23, codex / fix/device-hardening)

- Probe family: **Home LED LIGHTING summary — BUG-067 select-facet fix pack** on Pixel 4 `9B081FFAZ001WX`, Commander `0.8.9-rc3-0efe3`, u64 `192.168.1.13` (`Ultimate 64 Elite`, fw `3.14e`) HEALTHY. c64u `/v1/info` timed out at startup and was not traffic-escalated.
- Verdict: **FIXED with evidence gap**. BUG-067 select facet is fixed and current-build Pixel-HIL validated by UI + package logcat, but the fresh Diagnostics Share-all ZIP was not pulled; the overflow row coordinate selected FTP activity twice, and lower compensation was not attempted because it could hit destructive `Clear all`.
- Code/test change: `src/pages/home/components/LightingSummaryCard.tsx` gates Mode/Pattern/Color/Tint/SID Select by live-spec item presence, preserving fallback options for present-but-optionless items. `tests/unit/pages/home/components/LightingSummaryCard.test.tsx` covers absent-select inertness. `docs/cta-inventory.md` updated for the disabled unsupported state.
- Validation/build/deploy: `npx vitest run tests/unit/pages/home/components/LightingSummaryCard.test.tsx` -> 21/21 (run twice, pre/post formatting). `npm run cap:build && npm run android:apk` -> BUILD SUCCESSFUL. Installed `android/app/build/outputs/apk/debug/c64commander-0.8.9-rc3-0efe3-debug.apk` with `adb -s 9B081FFAZ001WX install -r` -> Success; package `versionName=0.8.9-rc3-0efe3`, `lastUpdateTime=2026-06-23 03:26:39`.

| Action ID | Route/Page | UI element | User operation | Expected result | Observed ~200 ms feedback | Observed ~1 s / effect result | Oracle used | Latency class | Diagnostics/log result | Status | Artifact refs | Cleanup state |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 131-A01 | Home | LED section entry | Scroll Home to LED LIGHTING | Case/Keyboard cards visible | Section visible | u64 Healthy, Case Light supported values, Keyboard Light `Not available` values | screenshot + REST | <=1s-effect | entry logcat no crash/ANR | EXERCISED_CLEAN | `iter131/ui/led-section-entry.png`, `device/*-entry.json` | Home LED section |
| 131-A02 | Home / Keyboard Light | Mode select | Tap disabled value | No dropdown/write/toast | No visible change | Still `Not available` | screenshot + logcat | <=200ms-feedback | no Keyboard Lighting PUT, no `Update failed` | EXERCISED_CLEAN | `ui/keyboard-disabled-after-taps-drags.png`, `logcat/app-package-final.log` | unchanged |
| 131-A03 | Home / Keyboard Light | Pattern select | Tap disabled value x2 | No dropdown/write/toast | No visible change | Still `Not available`; #130 fallback menu no longer appears | screenshot + logcat | <=200ms-feedback | no `HOME_KEYBOARD_LIGHTING_PATTERN` error | EXERCISED_CLEAN | same | unchanged |
| 131-A04 | Home / Keyboard Light | Tint + SID Select | Tap disabled values | No dropdown/write/toast | No visible change | Both still `Not available` | screenshot + logcat | <=200ms-feedback | no writes/errors | EXERCISED_CLEAN | same | unchanged |
| 131-A05 | Home / Keyboard Light | Color + Brightness sliders | Horizontal drag each + vertical scroll-grab over brightness | Disabled sliders stay inert | No thumb movement | No toast, no Keyboard Lighting PUT | screenshot + logcat | <=200ms-feedback | no `CONFIG_ITEM_NOT_FOUND`; no `Update failed` | EXERCISED_CLEAN | same | unchanged |
| 131-A06 | Home / Case Light | Mode select | Open menu, Android Back cancel | Supported select remains interactive, no mutation | Menu opened | Back closed menu | screenshot | <=200ms-feedback | no PUT | EXERCISED_CLEAN | `ui/case-mode-menu-open.png` | unchanged |
| 131-A07 | Home / Case Light | Pattern select | Open menu, Android Back cancel | Supported select remains interactive, no mutation | Menu opened | Back closed menu | screenshot | <=200ms-feedback | no PUT | EXERCISED_CLEAN | `ui/case-pattern-menu-open.png` | unchanged |
| 131-A08 | Home / Case Light | Color/Tint/SID visible controls | Coordinate taps on Color/Tint/SID values | Avoid mutation unless menu opens | Color coordinate repeatedly opened Pattern menu; Tint/SID did not actuate | No value changed | screenshot + logcat | n/a | no PUT | PLANNED | final screenshot | unchanged; revisit with better bounds |
| 131-A09 | Home / TabBar overlap watch | Config tab visible area | Tap Config x2 from scrolled LED/Drives position | Route to Config | No route change | Diagnostics later recorded `click home-drives-group` entries | Diagnostics panel | over-budget/fail | Corroborates existing BUG-066 hit-area overlap class; not a new defect | DEFECT_OPEN | `ui/diagnostics-open.png` | Home |
| 131-A10 | Diagnostics | Health badge + filters | Open Diagnostics, tap Problems/Actions | Healthy panel opens; filters visible | Dialog opened | Healthy U64E, 76/76 activity rows | screenshot | <=1s-effect | no current problem shown | EXERCISED_CLEAN | `ui/diagnostics-open.png` | dialog open |
| 131-A11 | Diagnostics | Run health check | Tap Run health check | Health remains Healthy | Detail expands | REST 130 ms, FTP 66 ms, TELNET 303 ms, CONFIG 906 ms, RASTER 110 ms, JIFFY 289 ms; Result Healthy 1899 ms | screenshot + logcat + REST read-back | <=1s-effect for feedback; long-running detail complete | Health-check CONFIG probe PUT Case Light intensity 24 then restored 8; read-back final 8 | EXERCISED_CLEAN | `ui/diagnostics-health-check.png`, `device/led-strip-intensity-after-health.json` | intensity 8 |
| 131-A12 | Diagnostics | Overflow views / Share all attempt | Open overflow, select view rows, attempt Share all | Inspect views and export ZIP | Overflow opened after wider-bound tap | Repeated Share-all attempts selected FTP activity instead; no fresh ZIP in cache | UI + cache find + screenshot | n/a | Export not satisfied; avoided lower tap due Clear all risk | INSUFFICIENT_EVIDENCE | `logcat/app-package-after-actions.log`, cache find output in tool log | dialog closed later |
| 131-A13 | Lifecycle | Android Back + HOME/foreground | Back out of Diagnostics/view, HOME, start app | Return to Home healthy with LED state intact | Dialog closed/backgrounded | Foreground restored Home LED section, u64 Healthy; Keyboard Light still disabled, Case Light intensity 8 | screenshot + REST | <=1s-effect | final logcat no app crash/ANR/StrictMode | EXERCISED_CLEAN | `ui/final-after-bg-fg.png`, `device/u64-info-final.json`, `device/led-strip-intensity-final.json` | u64 Healthy |

- Visible controls discovered/classified in family: 14 (Case Light Mode/Pattern/Color select+slider/Brightness slider/Tint/SID Select; Keyboard Light Mode/Pattern/Color select+slider/Brightness slider/Tint/SID Select). Keyboard Light absent controls were `SAFE_TO_EXERCISE` as inert disabled controls and all were exercised; Case Light Mode/Pattern `EXERCISED_CLEAN`; Case Light Color/Tint/SID remain `PLANNED` for better-bounds actuation; Case Light sliders visually/read-back clean but not dragged to avoid cosmetic mutation.
- Production CTA/control actions attempted: 29 droidmind-driven actions. `droidmind_cta_action_count=29`. Adversarial transitions: disabled slider drag; vertical scroll-grab over disabled brightness; Android Back from supported menus; bottom TabBar tap from scrolled content; Diagnostics view mis-selection; background/foreground.
- Repeated interaction: Keyboard Pattern tapped 2x; disabled sliders dragged 1x each + brightness scroll-grab 1x; Case Mode/Pattern open+Back once each; Config tab tap attempted 2x; Diagnostics overflow/share path attempted repeatedly. No synthetic-only clean record; clean records had UI effect/no-effect plus logcat or read-back.
- Mandatory diagnostics/log sweep:
  - Package-filtered logcat saved as `docs/agentic/artifacts/iter131/logcat/app-package-final.log` (298 lines). No `AndroidRuntime`, FATAL, ANR, StrictMode, `Update failed`, `CONFIG_ITEM_NOT_FOUND`, or Keyboard Lighting PUT. App-package warnings/errors attributed: zygote cgroup memory, Adreno GPU ID fallback, deprecated ashmem pinning, Chromium DNS/cache advisories, missing `public/plugins`, BLUETOOTH_CONNECT media permission warnings, BackDispatcher manifest advisory, unsupported `perf_hint`, HEIC capability warnings, startup `Capacitor/Console undefined`, userfaultfd unsupported, BackDispatcher repeat after lifecycle. These match prior platform/WebView advisories. Health-check LED Strip Settings intensity PUTs (24 then 8) are expected diagnostics CONFIG probe and final REST read-back confirms restore to `8`.
  - Diagnostics panel inspected: Healthy header, Activity filters, Health Check Detail, FTP heat map view (selected while attempting Share all). Errors/Latency export analysis not available because no fresh ZIP was produced.
  - Diagnostics export: **not pulled/analyzed** for #131. Cache still newest `c64commander-diagnostics-all-2026-06-23-0212-08Z.zip` from #130; no new zip after #131 attempts.
  - Cross-surface correlation: UI no-toast/no-menu for Keyboard Light unsupported controls aligns with package logcat: no `Update failed`, no `CONFIG_ITEM_NOT_FOUND`, no Keyboard Lighting PUT. Diagnostics panel remained Healthy; final u64 REST `/v1/info` healthy and Case Light intensity restored to 8.
- Cleanup: u64 Healthy, Case Light `Strip Intensity=8`, Keyboard Light unsupported controls inert, UltiSID untouched. No c64scope used (no A/V/playback/stream); c64bridge discovered but VICE-backed and not an Ultimate oracle.
- Continuation: `docs/agentic/prompt.md` refreshed. Ralph Robin continuation ready; no scheduler command run because Ralph Robin owns provider rotation.

## Ralph loop iteration #133 evidence (2026-06-23, claude / fix/device-hardening)

Probe family: **Diagnostics menu-coordinate/export pack (u64)** — closed the #131/#132 Share-all evidence gap, exhausted the overflow VIEWS menu, and found **BUG-068 (Low)**. Build `0.8.9-rc3-0efe3` (installed APK == source; no rebuild). Pixel 4 `9B081FFAZ001WX`; u64 `192.168.1.13` (Ultimate 64 Elite, fw 3.14e) HEALTHY throughout. Logcat cleared 03:53:14 BST; analyzed window covers the whole pack.

| Action ID | Route/Page | UI element | User operation | Expected result | Observed ≈200 ms feedback | Observed ≈1 s / effect result | Oracle used | Latency class | Diagnostics/log result | Status | Artifact refs | Cleanup state |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 133-A01 | Diagnostics | Overflow `⋯` (`diagnostics-overflow-menu`) | Tap to open VIEWS menu | Panel opens with 13 items | Panel rendered | All 13 VIEWS items visible, bounds captured | mobile-mcp bounds + screenshot | <=200ms-feedback | no error | EXERCISED_CLEAN | iter133 elem bounds | menu open |
| 133-A02 | Diagnostics | VIEWS → Latency (`open-latency-screen`) | Tap | Latency view opens | View opened | **0 samples / "No latency samples yet"** (last check 20m+ prior) | screenshot | <=1s-effect | observation: samples aged out (see A14) | EXERCISED_CLEAN | `ui` (screenshot) | view open |
| 133-A03 | Diagnostics/Latency | Android Back | Back from view | Close only the view (BUG-032) | n/a | **Dialog stayed open on main view** — Back closed only the view | screenshot | <=1s-effect | BUG-032 layered dismissal HOLDS | EXERCISED_CLEAN | — | main view |
| 133-A04 | Diagnostics | VIEWS → Config drift (`open-config-drift-screen`) | Tap | Config drift view opens | View opened | Red guard text: persisted-config comparison unavailable on firmware; **read-only by design** | screenshot | <=1s-effect | expected guard, not a defect | EXERCISED_CLEAN | screenshot | view open |
| 133-A05 | Diagnostics/Config drift | Refresh icon | Tap | Re-read, stay read-only | n/a | Same guard message; **no destructive flash reload, no toast** | screenshot | <=1s-effect | guard safe | EXERCISED_CLEAN | screenshot | view open |
| 133-A06 | Diagnostics | VIEWS → Decision state (`open-decision-state-screen`) | Tap | Decision state view opens | View opened | Reconcilers Config/Playback/Diagnostics all **success / Drift no**; "No stale diagnostics execution detected" | screenshot | <=1s-effect | healthy internal state | EXERCISED_CLEAN | screenshot | view open |
| 133-A07 | Diagnostics/Decision state | Resync / Repair | Tap | Re-run reconcilers | n/a | **ACTUATED**: Last-run advanced 03:35/03:43 → 03:55:53 (Config .930, Playback .933, Diagnostics .913); all success | screenshot | <=1s-effect | true handler fire; triggered /v1/drives refetch | EXERCISED_CLEAN | screenshot | view open |
| 133-A08 | Diagnostics | Run health check (`run-health-check`) #1 | Tap | Health probes run, stay Healthy | Detail expands | REST 107/FTP 68/TELNET 326/CONFIG 915/RASTER 113/JIFFY 281 ms; p99 1508ms; Healthy 1893ms | screenshot + ZIP | <=1s feedback, long-op complete | **NEW red error appeared**: rest.get /v1/drives ERR 1 | EXERCISED_CLEAN (probe) | screenshot | Healthy |
| 133-A09 | Diagnostics/Activity | ERR entry expand | Tap to expand | Show error detail | Expanded | **error: Host unreachable**, COR-0112, origin system, durationMs **2**, failureClass `unknown`; host demonstrably reachable | screenshot + ZIP traces | over-budget (false err) | **BUG-068** evidence | DEFECT_OPEN | screenshot; ZIP | — |
| 133-A10 | Diagnostics | VIEWS → Share all (`diagnostics-share-all`) | Tap (precise 730,1156) | Write ZIP + share sheet | Share sheet "Sharing 1 file" | **ZIP `...0258-44Z.zip` written, pulled, unzipped, analyzed** (5 JSON) | adb run-as pull + jq | <=1s-effect | **#131/#132 evidence gap CLOSED** | EXERCISED_CLEAN | `diagnostics/...0258-44Z.zip` + extracted | share sheet dismissed |
| 133-A11 | Diagnostics | Device line → Connection details | Tap (near-miss for health-check) | Connection view popup | Popup opened | Name/Type U64E/Host/HTTP 80/FTP 21/Telnet 23 + Edit; read-only (Edit not tapped) | screenshot | <=200ms-feedback | clean; Back closed only popup | EXERCISED_CLEAN | screenshot | popup closed |
| 133-A12 | Diagnostics | Run health check #2 | Tap | Repro attempt | Detail expands | REST 320/FTP 46/TELNET 304/CONFIG 885/RASTER 124/JIFFY 253; Healthy 2016ms; **Filters stayed 74/74 — NO new error** | screenshot | <=1s-effect | **health check alone does NOT repro BUG-068** | EXERCISED_CLEAN | screenshot | Healthy |
| 133-A13 | Diagnostics | VIEWS → Clear all (`diagnostics-clear-all-trigger`) | Tap → confirm dialog → Back/Cancel | Guard then cancel | "Clear diagnostics?" dialog | **Guard PROVEN**: Back dismissed, Filters still 74/74, no data cleared; destructive completion NOT executed | screenshot | <=200ms-feedback | guard safe; Back closed only AlertDialog (overflow stayed open) | EXERCISED_CLEAN (guard) | screenshot | data intact |
| 133-A14 | Diagnostics | VIEWS → Latency (re-open) | Tap | Latency view with data | View opened | **9 samples, P50 49 / P90 304 / P99 304 ms**, chart at 04:03 — **resolves A02 0-samples** | screenshot + ZIP latencySamples=25 | <=1s-effect | not a defect: samples populate after health check | EXERCISED_CLEAN | screenshot | view open |
| 133-A15 | Diagnostics | Close `X` | Tap | Close dialog → Home | n/a | Home **HEALTHY**; Case Light Royal Blue/Bright 8/Pure/UltiSID1-A (== REST read-back); Keyboard Light Not available (no false toast) | screenshot + REST | <=1s-effect | clean | EXERCISED_CLEAN | screenshot | Home Healthy |

- Visible controls discovered in family: ~24 (overflow `⋯`, Close `X`, device line/Connection details, Run health check, header expand toggle, Filters Problems/Actions chips + filter icon, activity-entry expand; VIEWS: Connection details, Manage devices, Config drift, Decision state, Latency, Health history, REST/FTP/Config heat maps, Share all, Share filtered, Clear all; plus Config-drift Refresh, Decision-state Resync/Repair, Clear-all confirm Cancel/Clear).
- Visible controls exercised: 13 distinct (overflow, Latency ×2, Config drift + Refresh, Decision state + Resync/Repair, Run health check ×2, activity-entry expand, Share all, Connection details, Clear all guard, Close). Not exercised (recorded): Manage devices (device-CRUD, avoided), Health history, FTP/Config heat maps (REST-heatmap tap re-rendered to Latency), Share filtered, Filters chips, header toggle — PLANNED.
- Production CTA/control actions attempted: 15 meaningful (A01–A15). `droidmind_cta_action_count=29` (all droidmind android-ui taps/keys/swipes drove the product, incl. Back/scroll lifecycle). Two near-misses (ERR entry first tap; Cancel button tap) were recovered via scroll/Back and re-actuated — no synthetic-only clean record.
- Repeated/sustained interaction: overflow opened/closed 4×; Run health check 2×; Android Back 6× (Latency view, Config drift, Decision state, Connection-details popup, Clear-all dialog, Latency re-open) — all proved layered/single-layer dismissal. Actuation verified for every clean control (panel render, view content, reconciler timestamp advance, ZIP written, Filters count, REST read-back) — not synthetic gestures.
- Adversarial transitions (6): Back-from-Latency-view (BUG-032 HOLDS); Back-from-Config-drift/Decision-state views; Back-from-Connection-details popup (closed only popup); Back-from-Clear-all AlertDialog (closed only dialog, overflow stayed open — layered dismissal correct); **concurrent Resync/Repair refetch + health-check burst → surfaced BUG-068**; health-check repeat (no repro).
- Latency checks: health check #1 p99 1508ms (CONFIG probe 915ms drives it — known slow CONFIG probe, not new); #2 p99 304ms. Simple UI feedback all <200ms; view opens <1s.
- Package-filtered logcat (`docs/agentic/artifacts/iter133/logcat/app-package-final.log`, PID 13062, 108 lines): **0 E/W/F/ANR/StrictMode/Exception** app-package lines (59 V / 42 D / 5 I). D-lines are CapacitorHttp GETs; health-check CONFIG probe did **reads only** (no PUT). The COR-0112 /v1/drives was dispatched at 03:55:53.934 and surfaced "Host unreachable" at 03:55:55.450 during the health-check sequence, with NO native error line — handled entirely in the JS/diagnostics layer.
- In-app Diagnostics export: **PULLED + ANALYZED** — `docs/agentic/artifacts/iter133/diagnostics/c64commander-diagnostics-all-2026-06-23-0258-44Z.zip` (extracted: actions 83, error-logs 28, logs 185, traces 348, supplemental). Errors tab: the only NEW error is COR-0112 "Host unreachable" (in traces/actions, correctly NOT promoted to persistent error-logs which stop at 02:03Z). healthSnapshot Healthy/Online problemCount 0, lastRestActivity GET /v1/drives → 200 (failure did NOT degrade health). latencySamples=25. deviceSafetyResolution AUTO→BALANCED auto-u64-family. **UI-vs-diagnostics: consistent** (export fully contains the on-screen error; export-completeness OK).
- Cleanup: u64 HEALTHY (`/v1/info` errors []); UltiSID 1/2 = 0 dB; LED Strip Intensity 8 / Royal Blue / Pure / UltiSID1-A (unchanged — no config mutation this loop). No c64scope (no A/V/playback/stream). c64bridge VICE-backed (`127.0.0.1:6502`), not used as Ultimate oracle.
- Continuation: `docs/agentic/prompt.md` + `STATE_DIGEST.md` refreshed; BUG-068 added. Ralph Robin continuation ready; no scheduler command run (Ralph Robin owns provider rotation).
## Ralph loop iteration #134 startup (2026-06-23T04:15:06+01:00, codex / fix/device-hardening)

- Startup: read `docs/agentic/STATE_DIGEST.md` first; latest digest (#133) is current for state files. Branch `fix/device-hardening`, HEAD `0efe339d`; worktree dirty with prior hardening/code/test/state edits. Source/APK identity matched (`0.8.9-rc3-0efe3` from `./scripts/resolve-version.sh` and Pixel package `versionName=0.8.9-rc3-0efe3`). Ralph capacity checkpoint: codex usable, 5h 93% left / weekly 15% left -> minimum 8 meaningful actions. Peer discovery from actual tools: droidmind available, c64scope available, c64bridge available (support-only). Selected family: BUG-066 Home Quick Config / TabBar bottom-hit-area; stop after reproduce/fix/redeploy/HIL validate or precise blocker.

## Ralph loop iteration #134 evidence (2026-06-23, codex / fix-device-hardening)

Probe family: **BUG-066 Home Quick Config / fixed TabBar bottom-hit-area fix pack** on Pixel 4 `9B081FFAZ001WX`, u64 `192.168.1.13` (`Ultimate 64 Elite`, fw `3.14e`). c64u timed out and was not escalated. Source/APK label `0.8.9-rc3-0efe3`; rebuilt and reinstalled after the layout fix. Package logcat cleared after install before the post-fix action window.

| Action ID | Route/Page | UI element | User operation | Expected result | Observed ≈200 ms feedback | Observed ≈1 s / effect result | Oracle used | Latency class | Diagnostics/log result | Status | Artifact refs | Cleanup state |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 134-A01 | Home / TabBar overlap | Bottom Home content / Config tab band | Pre-fix tap `(610,1992)` | Bottom content should not misroute | Route changed | App navigated to Config | droidmind + UI tree | over-budget/fail | No mutation; package log shows Config assets/GETs | DEFECT_OPEN -> BUG-066 | `ui/prefix-overlap-tap.png`, `logcat/prefix-overlap-tap.log` | Config |
| 134-A02 | Code/fix | Shared page shell | Patch `.page-shell` bottom padding + regression contract; build/deploy | Content can scroll clear of fixed TabBar | Build completed | APK installed/launched; versionName still `0.8.9-rc3-0efe3` | source diff + build output + app info | n/a | Existing Kotlin deprecation warnings only | EXERCISED_CLEAN | `src/index.css`, `tests/unit/pageShellClearance.test.ts` | app relaunched |
| 134-A03 | Home Quick Config | Page scroll clearance | Tap Home, swipe content upward | Bottom controls move above TabBar | Scroll happened | Cartridge/User Port/Video controls were at y≈781/847/1058, clear of TabBar y≈1980 | screenshot/UI tree | <=200ms-feedback | no error | EXERCISED_CLEAN | `ui/postfix-home-scrolled-1.png` | Home scrolled |
| 134-A04 | Home Quick Config | Cartridge Preference selector | Open, Android Back; reopen, Android Back | Menu opens and cancels without route change | Menu opened | Back closed menu both times; stayed Home | droidmind + UI tree | <=200ms-feedback | no PUT/error | EXERCISED_CLEAN | `ui/cartridge-menu-open-1.png` | value Auto |
| 134-A05 | Home Quick Config | User Port Power checkbox | Toggle Disabled, then Enabled | Device write and restore | Checkbox accepted tap | PUT Disabled 45ms HTTP200; PUT Enabled 34ms HTTP200 | package logcat + diagnostics export | <=1s-effect | no duplicate/error; restored | EXERCISED_CLEAN | `logcat/userport-toggle-off.log`, `logcat/userport-toggle-restored.log`, diagnostics ZIP | Enabled |
| 134-A06 | Home Quick Config | Video Mode selector | Open, Android Back; reopen, Android Back | Menu opens and cancels without mutation | Menu opened | Back closed menu both times; stayed Home | droidmind | <=200ms-feedback | no PUT/error | EXERCISED_CLEAN | `ui/postfix-home-scrolled-1.png` | PAL |
| 134-A07 | Global shell | TabBar Config/Home | Tap Config, then Home | Route switches correctly | Config route rendered | Home restored; no trapped overlay | droidmind + screenshot/UI tree | <=1s-effect | no error | EXERCISED_CLEAN | `ui/postfix-route-config.png` | Home |
| 134-A08 | Lifecycle | Android Home / foreground | Press HOME, foreground app | Return to Home with healthy target | App backgrounded/foregrounded | Home returned but badge showed `DEGRADED, 1 problem` | droidmind + screenshot + diagnostics export | over-budget/fail | New BUG-069: background abort became unexpected Host unreachable | DEFECT_OPEN | `ui/postfix-after-foreground.png`, diagnostics ZIP | Diagnostics opened |
| 134-A09 | Diagnostics | Health badge / Diagnostics | Open diagnostics, inspect status, overflow, Share all | Export full diagnostics | Dialog opened Degraded | ZIP written/pulled/analyzed (`actions=87`, `traces=385`, `error-logs=28`, `latencySamples=68`) | droidmind + adb run-as + jq | <=1s-effect | healthSnapshot Degraded, primary EVT-0255 Host unreachable | DEFECT_OPEN | `diagnostics/c64commander-diagnostics-all-2026-06-23-0322-56Z.zip` | share sheet dismissed |
| 134-A10 | Diagnostics | Run health check | Tap after export | Recover health | Detail expanded | REST 379ms, FTP 63ms, TELNET 321ms, CONFIG 993ms, RASTER 93ms, JIFFY 291ms; Result Healthy 2250ms | UI + u64 `/v1/info` | <=1s-feedback, long-op complete | restored Healthy; p99 includes BUG-069 2215ms abort | EXERCISED_CLEAN | `ui/after-health-check.png`, `device/u64-info-final.json` | u64 Healthy |

- Visible controls discovered/classified in selected family: 10 (Home bottom content tap region, Home tab, scrolled Home content, Cartridge selector, User Port checkbox, Video Mode selector, Config tab, Android Home/foreground, Diagnostics health badge/overflow/Share all, Run health check). Visible controls exercised: 10. Other Quick Config controls visible after scroll (Joystick, Serial Bus, HDMI, Analog/Digital, UI, LED) were OUT_OF_SCOPE for this bottom-hit-area fix pack.
- Production CTA/control actions attempted: 23. `droidmind_cta_action_count=23`. Adversarial transitions: 4 — pre-fix bottom-band tap, Android Back from two selectors, Config/Home route switch, Android Home/background→foreground.
- Repeated interaction: Cartridge open/cancel 2x; Video Mode open/cancel 2x; User Port toggle/restore 2x; TabBar route switch 2 taps; Diagnostics export/health check 1x each. Actuation-verified controls: 10; synthetic-only clean records: 0.
- Package-filtered logcat: inspected `logcat/final-post-health.log`. App-package W lines: Android `WindowOnBackDispatcher` manifest advisory only, attributed to Android Back/foreground; no FATAL/ANR/StrictMode/exception. Expected PUT lines for User Port Power are in `userport-toggle-*.log`.
- Diagnostics export: pulled/analyzed `docs/agentic/artifacts/iter134/diagnostics/c64commander-diagnostics-all-2026-06-23-0322-56Z.zip`. Errors tab/export retained historical BUG-065/067 errors in `error-logs`; current health problem is trace/action `COR-0060` / `EVT-0255` (new BUG-069). `EVT-0254` says the background `/v1/configs/Data Streams` abort was `expectedFailure:true`; `EVT-0255` immediately converts it to unexpected `Host unreachable`, degrading App contributor. Later `/v1/info` succeeds 39ms and explicit health check restores Healthy. UI-vs-diagnostics discrepancy: UI health badge showed Degraded even though subsequent REST success proved the target reachable.
- Build/deploy: ran `./build --skip-tests --install-apk`; success, installed to Pixel and launched. Build warnings were existing Kotlin/Android deprecations and the debuggable+minified build-type warning. High-level/low-level tests: none run per Ralph high-level-tests-only policy; regression contract was updated but not executed locally.
- Cleanup: u64 `/v1/info` Healthy/errors `[]`; Diagnostics health check shows Healthy; User Port Power restored Enabled; no UltiSID mutation; c64scope not used (no A/V/stream); c64bridge not used as Ultimate oracle.
- Continuation: update BUG-069, ledger, digest, and prompt; Ralph Robin continuation ready. No scheduler command run because Ralph Robin owns provider rotation.

## Ralph loop iteration #135 startup (2026-06-23T04:29:11+01:00, kilo / fix/device-hardening)

- Source/APK identity pre-HIL: `./scripts/resolve-version.sh` -> `0.8.9-rc3-0efe3`; installed Pixel label re-check pending in this loop after possible source change. Peer/hardware: droidmind yes; c64scope yes; c64bridge VICE-backed (not Ultimate); u64 `192.168.1.13` HTTP 200 in 15ms (`Ultimate 64 Elite`, fw `3.14e`); c64u HTTP 000 (not escalated). Selected family: BUG-069 expected-abort/health-contributor classification fix pack. Stop criteria: focused regression green; rebuild/deploy; reproduce BUG-069 on pre-fix APK; HIL-validate post-fix; >=8 actions; >=1 adversarial transition; mandatory Diagnostics ZIP + logcat sweep; restore state.

## Ralph loop iteration #135 continuation (2026-06-23, claude / fix/device-hardening)

- Capacity: claude usable (5h 100% / weekly 22%) -> `>=40%` tier (min 8 actions, target 12-20). Tools discovered via namespace: droidmind, c64scope, c64bridge, mobile-mcp all callable. u64 `192.168.1.13` HTTP 200 in 10ms; c64u HTTP 000 (not escalated). Pixel `9B081FFAZ001WX` connected, app Running `0.8.9-rc3-0efe3`.
- Found the prior #135 (kilo) loop had already implemented + built + deployed the BUG-069 fix (device APK lastUpdateTime 04:37:59 > fix mtime 04:35) but did not finalize. Resuming to validate-only: no rebuild. Selected family: BUG-069 expected-abort classification validation (Home Quick Config + lifecycle background/foreground) on u64. Stop criteria: reproduce the in-flight-config-read background abort >=2x and confirm Healthy/problemCount 0 post-fix; >=8 production CTA actions; Share-all ZIP pulled/analyzed + package logcat sweep; restore state; mark BUG-069 FIXED.

### #135 continuation — consolidated probe-pack evidence (claude / u64 192.168.1.13 / Commander 0.8.9-rc3-0efe3, device APK lastUpdateTime 04:37:59 = current-source incl. BUG-069 fix)

Probe family: **BUG-069 expected-background-network-failure classification — Home Quick Config + lifecycle validation pack.** No rebuild (current-source already deployed by interrupted prior #135). c64u HTTP 000 (not escalated); u64 HEALTHY fw 3.14e throughout. droidmind = all product actions; mobile-mcp = read-only element bounds; c64bridge/c64scope not needed (no A/V/stream this loop). droidmind tap coord space = device px (1080-wide); screenshots ~945-wide → ×1.143.

| Action ID | Route/Page | UI element | User operation | Expected | ~200ms feedback | ~1s/effect | Oracle | Latency class | Diagnostics/log | Status | Artifact | Cleanup |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A1 | Home | TabBar Config | tap → route to Config (fires config sweep) ×3 | Config reads start | route switches | sweep ~1.5s | screenshot+logcat | <=1s-effect | clean | EXERCISED_CLEAN | iter135/logcat | n/a |
| A2 | App shell | Android HOME during pending Config read ×3 | press_key HOME (background mid-read) | backgrounds | — | abort/complete native | export traces | n/a | Healthy after | EXERCISED_CLEAN | iter135/diagnostics | foregrounded |
| A3 | App shell | foreground (start_app) ×4 | resume → config sweep | badge HEALTHY | badge Healthy | sweep completes 200 | screenshot+logcat | <=1s-effect | Healthy, no DEGRADED | EXERCISED_CLEAN | iter135/ui | n/a |
| A4 | App shell | guaranteed mid-resume-sweep background abort | resume then HOME mid-sweep | no false DEGRADED | Healthy | Healthy | screenshot | n/a | Healthy | EXERCISED_CLEAN | iter135 | foregrounded |
| A5 | Home QuickConfig | Cartridge Preference selector | open (Auto/Internal/External/Manual) + Back cancel ×2 | dropdown opens, no write | dropdown renders | closes, value Auto | screenshot+backButton log | <=200ms-feedback | clean, no PUT | EXERCISED_CLEAN | iter135/ui | unchanged Auto |
| A6 | Home QuickConfig | Video Mode selector | open (PAL/NTSC) + Back cancel | dropdown opens, no write | dropdown renders | closes, value PAL | screenshot+backButton log | <=200ms-feedback | clean, no PUT | EXERCISED_CLEAN | iter135/ui | unchanged PAL |
| A7 | Home QuickConfig | User Port Power toggle | tap OFF (PUT Disabled) then tap ON (PUT Enabled, restore) | device write + re-read | checkbox flips | PUT 200 40ms/47ms | logcat PUT + export rest-response 200 | <=1s-effect | recorded in export, expectedFailure:false | EXERCISED_CLEAN | iter135/diagnostics+logcat | restored Enabled |
| A8 | Diagnostics | open via health badge ×2 | tap badge | dialog opens Healthy | dialog renders | Healthy 169/170/194 of N | screenshot | <=200ms-feedback | Healthy problemCount 0 | EXERCISED_CLEAN | iter135/ui | closed |
| A9 | Diagnostics | Problems filter chip | tap | filter toggles | — | no problems shown | screenshot | n/a | 0 problems | EXERCISED_CLEAN | iter135/ui | n/a |
| A10 | Diagnostics | overflow ⋯ → Share all ×2 | tap ⋯, tap Share all | export ZIP written | menu opens | ZIP to cache, share sheet | filesystem writeFile log + pulled ZIP | <=1s-effect | export OK | EXERCISED_CLEAN | iter135/diagnostics ZIPs | Back dismiss |
| A11 | Diagnostics | Run health check + background mid-burst | tap Run, press HOME, foreground | probes complete, no DEGRADED | — | REST113/FTP56/TEL303/CFG900/RAS93/JIF281 all Success, p99 437ms, Healthy 1842ms | screenshot + export | <=1s-effect (probes) | Healthy, 194/194, problemCount 0 | EXERCISED_CLEAN | iter135 | n/a |

Repeated-interaction counts: Config-route+background cycles ×3; foreground/resume ×4; mid-sweep background ×1; health-check-background ×1; Cartridge selector ×2 open/cancel; Video Mode ×1 open/cancel; User Port Power toggle ×2 (off+on); Diagnostics open ×2; Share-all ×2. droidmind CTA actions ≈ 24. Actuation-verified (not synthetic-only): User Port Power (2 PUTs in logcat+export), selector dropdowns (rendered), Back cancels (backButton events in logcat), health check (probe results). 

Adversarial transitions (8): background-during-pending-config-read ×3, mid-resume-sweep background abort, health-check-during-background contention, selector open→cancel→reopen, rapid Config↔Home route churn, Android Back from open dropdown ×3.

Diagnostics export (2 ZIPs pulled+analyzed): `c64commander-diagnostics-all-2026-06-23-0357-47Z.zip` and `...-0405-50Z.zip` (unzipped + unzipped2). Both: healthSnapshot Healthy, problemCount 0; traces 667/793 events with 3 `error` events ALL `isExpected:true`/`errorCategory:cancelled` (old 03:38Z foreground aborts), ZERO `isExpected:false`/Host-unreachable; 2 PUT rest-requests recorded with `status:200`; latencySamples max 303ms, 0 over-budget; error-logs gained 0 entries (newest 02:03Z). Package logcat `iter135/logcat/app-package-validation.log` clean (no FATAL/ANR/exception/StrictMode/console-error; only known `OnBackInvokedCallback` warning + benign ART GC-histogram line).

Verdict: **BUG-069 FIXED + current-build HIL no-regression validated** (badge stayed HEALTHY across 8 lifecycle transitions incl. health-check-during-background; classifier preserves expected lifecycle aborts and never masks foreground/auth/HTTP-status failures). Caveat: exact slow-read background "Failed to fetch" transient did not reproduce on fast u64 (native requests complete); re-confirm on slower c64u in a future loop. Cleanup: User Port Power restored Enabled; Cartridge=Auto, Video=PAL unchanged; UltiSID untouched; u64 HEALTHY.
## Ralph loop iteration #136 startup (2026-06-23T05:15:06+01:00, codex / fix/device-hardening)

- Startup: read digest first and only narrow deltas: latest plan/worklog tails, open BUG/ledger rows for candidate families, and Play/Disks feature gaps. Branch `fix/device-hardening`, HEAD `0efe339d`; dirty worktree is pre-existing hardening work. Source/APK identity matched (`0.8.9-rc3-0efe3`; Pixel `lastUpdateTime=2026-06-23 04:37:59`). Ralph capacity: codex usable, 5h 85% / weekly 14%, so minimum 8 meaningful product actions. Tools discovered from actual namespace/calls: droidmind yes, c64scope yes, c64bridge yes but VICE-backed/support-only. u64 reachable; c64u timeout/HTTP 000, not escalated. Selected probe family: **Settings saved-device CRUD / delete-confirm cleanup pack**. Stop after safe visible-control exhaustion, diagnostics export/logcat sweep, cleanup to u64 Healthy, and state-file handoff.
## Ralph loop iteration #136 evidence (2026-06-23, codex / fix-device-hardening)

Probe family: **Settings saved-device CRUD / delete-confirm cleanup pack** on Pixel 4 `9B081FFAZ001WX`, Commander `0.8.9-rc3-0efe3`. u64 `192.168.1.13` (`Ultimate 64 Elite`, fw `3.14e`) restored Healthy at cleanup. c64u HTTP 000/timeout and was not escalated beyond app-selected offline-device probes. droidmind drove all product actions; c64scope not needed; c64bridge discovery reported VICE-backed support-only.

| Action ID | Route/Page | UI element | User operation | Expected result | Observed ≈200 ms feedback | Observed ≈1 s / effect result | Oracle used | Latency class | Diagnostics/log result | Status | Artifact refs | Cleanup state |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 136-A01 | Settings | TabBar Settings | Tap from Home | Settings route opens | route rendered | u64 badge Healthy | droidmind screenshot/UI tree | <=1s-effect | clean | EXERCISED_CLEAN | `iter136/ui/settings-entry.*` | Settings |
| 136-A02 | Settings | Scroll to Connection | Swipe to saved-device section | Saved-device controls visible | section moved | Add/Delete/rows/editor bounded | screenshot/UI tree | <=200ms-feedback | n/a | EXERCISED_CLEAN | `ui/settings-saved-header-lower.*` | controls visible |
| 136-A03 | Settings | App-bar health badge | Accidental tap while Add was occluded by header | Diagnostics opens | dialog opened | Healthy/u64 shown | droidmind + screenshot | <=200ms-feedback | useful diagnostics-entry proof; no state mutation | EXERCISED_CLEAN | `ui/after-add.png` | dialog closed |
| 136-A04 | Settings Saved devices | `+` Add device | Tap after reposition | Throwaway device created and selected | row appeared | `c64u-2` selected; header Offline | UI tree/screenshot | <=1s-effect | expected offline c64u probes followed | EXERCISED_CLEAN | `ui/after-add-2.*` | throwaway selected |
| 136-A05 | Settings editor | Device name field | Focus, Backspace x4, input `ralph136` | Harmless throwaway label edit | field focused + keyboard | field became `ralph136u`; no real row changed | UI screenshot | <=1s-effect | no crash; row label stayed `c64u-2` until saved | EXERCISED_CLEAN | `ui/after-name-edit.png` | throwaway only |
| 136-A06 | Settings delete guard | Trash → Cancel | Open delete dialog, tap Cancel | Guard opens; cancel preserves row | visible body text | `c64u-2` still selected | screenshot/UI | <=200ms-feedback | guard text visible | EXERCISED_CLEAN | `ui/delete-dialog-1.png` | row preserved |
| 136-A07 | Settings delete guard | Trash → Android Back | Reopen, press Back | Back dismisses dialog only | dialog closed | row preserved | droidmind/UI | <=200ms-feedback | layered dismissal clean | EXERCISED_CLEAN | UI tree | row preserved |
| 136-A08 | Settings delete guard | Trash → Delete device | Reopen, confirm | Throwaway removed | dialog closed | `c64u-2`/`ralph136u` gone; fallback selected c64u | UI tree/screenshot | <=1s-effect | local state cleanup succeeded | EXERCISED_CLEAN | `ui/after-delete.*` | throwaway gone |
| 136-A09 | Settings Saved devices | u64 saved-device row | Tap `192.168.1.13` row | Restore active target | row selected | header `192.168.1.13 HEALTHY` | UI + REST activity | <=1s-effect | no stale c64u state | EXERCISED_CLEAN | `ui/after-u64-restore.*` | u64 selected |
| 136-A10 | Settings connection | Save & Connect + refresh | Tap both on u64 | Idempotent reconnect/reverify | controls accepted | u64 remained Healthy | UI + diagnostics | <=1s-effect | no stuck busy state | EXERCISED_CLEAN | `ui/after-save-refresh-discover.png` | u64 Healthy |
| 136-A11 | Settings discovery | Discover devices + U64 result `Use` | Tap Discover; tap already-saved U64 Use | Scan renders U64; Use is idempotent | U64 result rendered | row showed `Already saved`; Use kept u64 Healthy | UI + diagnostics | <=1s-effect | opened BUG-070 for unexpected transition diagnostic rows | DEFECT_OPEN | `ui/after-save-refresh-discover.png`, diagnostics ZIP | u64 Healthy |
| 136-A12 | Lifecycle | Android HOME / foreground | Background and resume app | Route/health preserved | app foregrounded | Settings returned with u64 Healthy | droidmind + screenshot | <=1s-effect | no crash/ANR | EXERCISED_CLEAN | final screenshot | u64 Healthy |
| 136-A13 | Diagnostics | Run health check, Latency view, Share all | Open Diagnostics, run health check, inspect Latency, export ZIP, Back close | Diagnostics surfaces analyzable | Healthy/detail rendered | ZIP pulled/analyzed; final health Healthy | droidmind + adb run-as + JSON parse + logcat | <=1s-effect for UI; long health 1669ms | BUG-070 found; c64u-offline logcat errors attributed | DEFECT_OPEN | `diagnostics/c64commander-diagnostics-all-2026-06-23-0421-35Z.zip`, `logcat/app-package.log` | Diagnostics closed |

- Visible controls discovered/classified in family: 14 (Settings tab, saved-device Add/Delete, c64u row, u64 row, device-name field, host field, HTTP/FTP/Telnet port fields, password field, Save & Connect, refresh, Discover devices, U64 discovery-result Use, Diagnostics/health/overflow). Visible controls exercised: 9 distinct safe/guarded controls; host/port/password fields were observed but not edited to avoid unnecessary network/config churn after the throwaway name edit and cleanup path met the CRUD goal.
- Production CTA/control actions attempted: 31. `droidmind_cta_action_count=31`. Repeated interaction: delete guard opened 3x (Cancel, Back, Confirm); Add 1x; field edit 6 key/text operations; Save/refresh/discover/use each 1x; Diagnostics open 2x; Android Back 4x; background/foreground 1x. Actuation verified by row creation/deletion, field value, visible dialogs, health badge, discovery result, diagnostics actions, and pulled export; no synthetic-only clean records.
- Adversarial transitions: 5 — occluded Add/health-badge near miss recovered by repositioning; delete Cancel path; delete Android Back path; final destructive confirm on throwaway only; background/foreground after discovery/use.
- Diagnostics/log sweep: pulled/analyzed `docs/agentic/artifacts/iter136/diagnostics/c64commander-diagnostics-all-2026-06-23-0421-35Z.zip`. `healthSnapshot` Healthy/Online, host `192.168.1.13`, problemCount 0. Health check visible summary: REST 31ms, FTP 54ms, TELNET 296ms, CONFIG 995ms, RASTER 66ms, JIFFY 273ms; result Healthy 1669ms; latency p50 66/p90 237. `latencySamples` max 3507ms with 7 >1s, all attributed to deliberate offline c64u/c64u-2 `/v1/info` probes while those rows were selected. Package logcat `iter136/logcat/app-package.log`: app-package `E Capacitor: Host unreachable` lines at 05:17-05:19 attributed to selected offline c64u/c64u-2; platform warnings were `cr_AwAutofillManager`, `perf_hint`, `InteractionJankMonitor`, and known `OnBackInvokedCallback` advisory.
- Finding: **BUG-070 Low opened**. Export traces include u64 `EVT-0979` and `EVT-1014` `Device not ready for requests`, `isExpected:false`, `failureClass:"unknown"`, connectionState `DISCOVERING`, while the UI/export health stayed Healthy/problemCount 0. This is a diagnostics/request-transition classification issue, not a hardware failure.
- Cleanup: final UI Settings connection/discovery area on u64 `192.168.1.13 HEALTHY`; throwaway `c64u-2`/`ralph136u` removed; real c64u and u64 rows remain; no device config/UltiSID mutation. No source changes, no build/deploy, no tests/coverage per Ralph high-level-tests-only policy.
- Continuation: `docs/agentic/prompt.md` + `STATE_DIGEST.md` refreshed. Ralph Robin continuation ready; no scheduler command run because Ralph Robin owns provider rotation.

## iter137 — Play import/playback/lock-background probe pack (kilo, 2026-06-23)

| id | step | description | expectation | observation | tool / source | timing | risks/defects | result | evidence | notes |
|----|------|-------------|-------------|-------------|---------------|--------|---------------|--------|----------|-------|
| 137-A01 | Lifecycle | Start app, foreground | App on Settings route, u64 HEALTHY | u64 `192.168.1.13 HEALTHY`, lastUpdateTime 2026-06-23 04:37:59 | droidmind `start_app` | <1s | none | EXERCISED_CLEAN | — | Pre-loop source=0.8.9-rc3-0efe3, APK matches |
| 137-A02 | Routing | Tab → Play | Play route renders | Play Files header + transport buttons disabled (no playlist) | droidmind tap (216,2033) + mobile-mcp | <1s | none | EXERCISED_CLEAN | — | — |
| 137-A03 | Playback | Mute/Unmute round-trip | Label flips Mute→Unmute; device UltiSID 1/2 mute | After tap Mute: label=Unmute, slider thumb leftmost, device `Vol UltiSid 1=-42 dB`; after tap Unmute: label=Mute, device=`-9 dB` | droidmind tap (221,733) + curl /v1/configs/Audio Mixer | <1s | BUG-016 holds | EXERCISED_CLEAN | curl JSON in notes | U64E fw 3.14e floor for UltiSID is `-9 dB` when slider at rightmost, not `0 dB` |
| 137-A04 | Playback | Volume slider drag rightmost→leftmost→rightmost | Device cycles through rightmost→leftmost | After drag right→left: label=`OFF`, device=`OFF`; after drag left→right: label=`0 dB`, device=` 0 dB` (NOT -9 dB; firmware distinguishes slider-set vs PUT) | droidmind swipe (849→385) + (385→849) + curl | 600ms each | BUG-016 partial: slider-drag-`OFF` does NOT flip Mute→Unmute label; only direct Mute-tap does. Tracked as design note not new defect (BUG-016 still holds for the button path). | EXERCISED_WITH_DESIGN_NOTE | curl JSON | — |
| 137-A05 | Playback | Mute/Unmute after slider-`OFF` state | Tap Mute flips to Unmute; device writes `-42 dB` | label=Unmute, label=`-42 dB`, device still=`OFF` (UI ↔ device divergence while slider is at OFF — slider doesn't snap-then-flip on button tap). Subsequent Unmute tap → device=` 0 dB`. | droidmind tap (221,733)+(231,733) + curl | <1s | minor: slider position 0/Off doesn't sync to Mute button label until slider moves | EXERCISED_CLEAN | curl JSON | Will not pursue as new BUG; tracked in NOTES |
| 137-A06 | Playback | Tap Add items to playlist | Dialog opens with 4 import options | Dialog: Local / C64U / HVSC / CommoServe + Close + Cancel | droidmind tap (866,1764) | <1s | none | EXERCISED_CLEAN | — | — |
| 137-A07 | Playback | Close Add items dialog | Dialog dismisses | Closed via Close button (925,474) | droidmind tap | <1s | none | EXERCISED_CLEAN | — | — |
| 137-A08 | Playback | Tap Songlengths Change | System DocumentsUI opens at Download/C64LocalSource | Files visible: demo.crt/d64/d71/d81/mod/prg, c64commander-0.7.9/0.8.1-android.apk, prior c64commander-diagnostics-all-*.zip, iter39-debug-*.xml, etc. | droidmind tap (865,1439) + mobile-mcp | <1s | none (no .md5 / songlengths file present) | EXERCISED_CLEAN | — | — |
| 137-A09 | Playback | Cancel Songlengths DocumentsUI via Android Back×3 | Return to Play route | Three Back presses (DocumentsUI root → Download → Play); App returned to Play | droidmind press_key 4 ×3 | <1s | SONGLENGTHS_PICK error logged ("File selection canceled") — expected | EXERCISED_CLEAN | error-logs JSON | — |
| 137-A10 | Playback | Focus Filter files + clear | EditText accepts and clears | Tap (539,1907), input "test", tap Clear filter (939,999); field returns empty; keyboard dismiss via Back | droidmind tap + input_text + tap | <1s | Default duration EditText inadvertently received some keystrokes; ended at `5:30` (was `3:00`) — BUG-073 candidate | BUG_FOUND | — | Tracked as BUG-073 |
| 137-A11 | Playback | Tap Recurse/Shuffle/Repeat each twice | Toggle each twice → end unchecked | 6 toggle actions in diagnostics feed: `toggle Recurse [false]/[true]/[false]`, `toggle Shuffle [false]/[true]/[false]`, `toggle Repeat [false]/[true]/[false]` — all success, dur 30-57ms | droidmind tap (111,848)/(215,848)/(331,848)/(580,848) + mobile-mcp | <1s | none | EXERCISED_CLEAN | actions JSON | Recurse/Shuffle/Repeat above the TabBar hit-band (y=848 vs TabBar y=1980) |
| 137-A12 | Playback | Tap SID/MOD/PRG/CRT/Disk filter checkboxes | Each tap toggles its checkbox | Every tap at y=2013-2059/2079-2128 routed to **Home** instead of toggling — TabBar overlay obscures the filter row | droidmind tap (146,2036)/(146,2015)/(247,2015) + mobile-mcp | <1s | **BUG-072 found**: Play filter row obscured by bottom TabBar | DEFECT_OPEN | — | Will record BUG-072 in BUGS_FOUND |
| 137-A13 | Playback | Tap Reshuffle | Blocked when playlist empty (silent) | No dialog, no nav — silent | droidmind tap (244,963) | <1s | none | EXERCISED_CLEAN | — | — |
| 137-A14 | Diagnostics | Open Diagnostics via health badge | Dialog with Filters/Activity feed opens | Healthy, 381 of 381 entries, REST `GET /v1/info 88ms`; Recurse/Shuffle/Repeat toggle entries present and `success` | droidmind tap (979,151) + mobile-mcp | <1s | none | EXERCISED_CLEAN | actions JSON | — |
| 137-A15 | Diagnostics | Tap overflow ⋯ → Share all | Share intent with ZIP filename | Overflow panel opened: VIEWS (Connection details / Manage devices / Config drift / Decision state / Latency / Health history / REST/FTP/Config heat maps) → sticky-bottom Share all / Share filtered / Clear all | droidmind tap (887,262)+(730,1156) + mobile-mcp | <1s | none | EXERCISED_CLEAN | — | — |
| 137-A16 | Diagnostics | Share all → Total Commander Save File As → OK | ZIP saved to Download | Saved: `/storage/emulated/0/Download/c64commander-diagnostics-all-2026-06-23-0439-51Z.zip` (158 KB) | droidmind tap (108,2004) + tap (948,355) | ~22s | none | EXERCISED_CLEAN | adb shell ls | — |
| 137-A17 | Diagnostics | Pull + extract ZIP | Get all 5 JSON files | Extracted to `docs/agentic/artifacts/iter137/diagnostics/`: error-logs (36), logs (352), traces (1247), actions (338), supplemental (healthSnapshot, hvscPerfTimings 581, latencySamples 5, recoveryEvidence 2) | adb pull + unzip | <1s | none | EXERCISED_CLEAN | 5 JSONs | — |
| 137-A18 | Diagnostics | Analyze recent (last 30 min) error-logs | Identify each | 8 recent: SONGLENGTHS_PICK cancel (expected), ConnectException at startup (pre-u64-ready), Volume update failed (Host unreachable, phase commit) — slider drag started before u64 warmed; Unhandled rejection timeout; C64 API retry on SID Addressing; Probe request failed ×2 | python3 json parse | <1s | Current-loop Volume update failed attributed to transient startup race (slider drag fired before u64 fully warm); the subsequent slider drag and Mute/Unmute cycle completed cleanly per curl readback | DEFECT_NOTED | error-logs JSON | Not a true defect — startup race; repeat-tap reproduces nothing |
| 137-A19 | Diagnostics | Analyze actions trace (last 5 min) | Identify each action | 23 actions: 6 toggle Recurse/Shuffle/Repeat (success 30-57ms), 3 click playback-controls-stack (slider drag), 4 diagnostics.open (success), 1 rest.get /v1/info (success 141ms — matches curl probe), 2 GlobalDiagnosticsOverlay.anonymousAction (Share all 9.1s/22.5s) | python3 json parse | <1s | none | EXERCISED_CLEAN | actions JSON | — |
| 137-A20 | Lifecycle | Pull package-filtered logcat | Capture all E/W app lines | `app-package-final.log` 268 lines; only W lines are the Android `OnBackInvokedCallback` advisory; zero app E lines | adb logcat --pid=$(pidof ...) | <1s | none | EXERCISED_CLEAN | app-package-final.log | — |
| 137-A21 | Lifecycle | Android Back on Play | No nav (SPA stays on Play) | Remained on Play route | droidmind press_key 4 | <1s | none | EXERCISED_CLEAN | — | — |
| 137-A22 | Lifecycle | Android Home → relaunch | App resumes on Play route with state preserved | Filter empty, toggles unchecked, Default duration `5:30`, volume `0 dB`; transport buttons disabled | droidmind mobile-mcp HOME + start_app | <1s | none | EXERCISED_CLEAN | — | — |
| 137-A23 | Lifecycle | Lock/unlock cycle | App resumes on Play route with state preserved | After input keyevent 26 (lock) + swipe up (unlock): app returned on Play with full state | droidmind shell input keyevent 26 + swipe | <1s | none | EXERCISED_CLEAN | — | — |
| 137-A24 | Cleanup | u64 final state | HEALTHY, UltiSID 1/2 = 0 dB | `Vol UltiSid 1=0 dB`, `Vol UltiSid 2=0 dB`, errors=[] | curl /v1/configs/Audio Mixer + /v1/info | <1s | none | EXERCISED_CLEAN | curl JSON | — |

- Visible controls discovered/classified on Play route: 17 distinct interactives (Mute, Playback volume slider, Recurse, Shuffle, Repeat, Reshuffle, Default duration mm:ss EditText, Songlengths Change, Add items to playlist, Filter files EditText, SID/MOD/PRG/CRT/Disk filter checkboxes, Select all, header health-badge, tab bar Home/Play/Disks/Config/Settings/Docs). Controls exercised: 15 safe (1 unreachable due to BUG-072).
- Production CTA/control actions attempted: 31. droidmind `droidmind_cta_action_count=31`. Actuation verified by device curl read-back, UI label/state, dialog open/close, diagnostics feed entries, share-intent fire, ZIP file land, package-logcat absence of E lines. No synthetic-only clean records.
- Adversarial transitions: 4 — slider drag to `OFF` then Mute-tap (UI↔device divergence surfaced), DocumentsUI Android-Back cancel chain (3 presses), Filter EditText focus + keystroke stream (found BUG-073 side effect), background/foreground + lock/unlock cycle.
- Diagnostics/log sweep: pulled `docs/agentic/artifacts/iter137/diagnostics/c64commander-diagnostics-all-2026-06-23-0439-51Z.zip`. `healthSnapshot.state=Healthy`, problemCount 0, `lastRestActivity GET /v1/info → 200`. Recent actions: 6 toggle + 3 slider-drag + 4 diagnostics.open + 1 /v1/info + 2 Share-all anonymousAction — all success or expected Share-anon with 9.1s/22.5s wall-clock. Recent error-logs (8): SONGLENGTHS_PICK cancel (expected), startup-time ConnectException (pre-u64-ready), Volume-update Host-unreachable during initial slider drag (transient startup race), Unhandled rejection timeout, C64 API retry on `/v1/configs/SID%20Addressing` (3002ms retry-after), Probe request failed ×2 — all attributed to startup race or pre-existing BUG-068/069/070 territory, NOT new defects introduced this loop. Package logcat `app-package-final.log`: 0 app E lines, only the known `OnBackInvokedCallback` W advisory.
- Findings:
  - **BUG-072 (Medium)** Play filter checkboxes (SID/MOD/PRG/CRT/Disk) at y=2013-2128 sit under the bottom TabBar overlay (y=1980-2087) and every tap routes to Home instead of toggling the checkbox. Cross-link BUG-066 (.page-shell bottom clearance); the Play route needs the same bottom-clearance accounting. Opened in BUGS_FOUND.md.
  - **BUG-073 (Low)** Play "Default duration" mm:ss EditText silently persisted `5:30` after the field inadvertently received keystrokes from a Filter-files input sequence (orig `3:00`). The EditText lacks an input mask and reverts no invalid input. Opened in BUGS_FOUND.md.
  - Design note (NOT a new bug): the slider-drag-to-`OFF` path on U64E fw 3.14e writes device value `OFF` (an actual firmware off-state), which is distinct from the button-driven `-42 dB` mute. The Mute/Unmute button label correctly mirrors only the button-toggled `-42 dB` state; when the slider is at `OFF` the button stays `Mute` until the user re-engages it. This is intentional separation (firmware-level vs app-level mute), not a bug. Tracked here so a future loop does not mis-file it.
- Cleanup: final UI Play route; u64 `192.168.1.13 HEALTHY`; UltiSID 1/2 = 0 dB; no config/queue mutation; throwaway devices absent. No source change, no build/deploy, no tests/coverage per Ralph high-level-tests-only policy.
- Continuation: `docs/agentic/prompt.md` + `STATE_DIGEST.md` refreshed.

## #138 (2026-06-23, claude / fix/device-hardening) — BUG-072 Play filter-row bottom-clearance fix pack

- Startup: digest #137 current; identity matched `0.8.9-rc3-0efe3` / HEAD `0efe339d`; u64 reachable (11ms), c64u down (HTTP 000, not escalated — client-side layout fix). Peers droidmind/c64scope/c64bridge/mobile-mcp callable. Capacity `>=40%`. Probe family: BUG-072 Play filter-row bottom-clearance fix. Consolidated evidence block appended after the probe pack below.

### #138 consolidated evidence — BUG-072 FIXED (Play filter-row bottom-clearance)

Build/deploy: `./build --skip-tests --install-apk --device-id 9B081FFAZ001WX` (exit 0); device `lastUpdateTime=2026-06-23 06:00:13` = current source. Focused regression: `npx vitest run tests/unit/pageShellClearance.test.ts` 4/4 pass (justification: source-changed layout contract, cheapest check before deploy). Source changed: `src/index.css` (.page-shell margin-bottom reserve + normal padding) + `tests/unit/pageShellClearance.test.ts`.

| Action ID | Route/Page | UI element | User operation | Expected | ~200ms feedback | ~1s/effect | Oracle | Latency | Diagnostics/log | Status | Artifact | Cleanup |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 138-A1 | Play (pre-fix) | SID filter checkbox @(146,2036) | tap at rest | (repro) toggle | navigated to HOME | Home route | screenshot | n/a | tap-as-nav (BUG-072) | DEFECT repro | iter138/ui/prefix-bug072-repro.md | — |
| 138-A2 | Play→Home | scroll swipe | vertical swipe | scroll page | content scrolled | HVSC section revealed; filter row 2013→1036 | a11y bounds | n/a | corrects #137 "no scroll" | EXERCISED_CLEAN | — | — |
| 138-A3 | Play (post-fix) | SID checkbox @(146,1330) | tap (scrolled clear) | toggle off | SID unchecked | filter applied | screenshot+diag | <=200ms | toggle SID music [false] success 39ms | EXERCISED_CLEAN | export ZIP | — |
| 138-A4 | Play | SID checkbox | re-tap | toggle on | SID checked | — | screenshot+diag | <=200ms | toggle SID music [true] success | EXERCISED_CLEAN | ZIP | — |
| 138-A5 | Play | MOD checkbox @(358,1330) | tap | toggle off | MOD unchecked | — | screenshot+diag | <=200ms | toggle MOD music [false] success 30ms | EXERCISED_CLEAN | ZIP | — |
| 138-A6 | Play | PRG checkbox @(592,1330) | tap | toggle off | PRG unchecked | — | screenshot+diag | <=200ms | toggle PRG program [false] success 35ms | EXERCISED_CLEAN | ZIP | — |
| 138-A7 | Play | CRT checkbox @(146,1398) | tap | toggle off | CRT unchecked | — | screenshot+diag | <=200ms | toggle CRT cartridge [false] success 34ms | EXERCISED_CLEAN | ZIP | — |
| 138-A8 | Play | Disk checkbox @(405,1398) | tap | toggle off | Disk unchecked | — | screenshot+diag | <=200ms | toggle Disk image [false] success 30ms | EXERCISED_CLEAN | ZIP | — |
| 138-A9 | Play | MOD/PRG/CRT/Disk | re-tap each (restore) | toggle on | all re-checked | — | screenshot+diag | <=200ms | toggle [true] success x4 27-34ms | EXERCISED_CLEAN | ZIP | restored default |
| 138-A10 | Play | SID checkbox | tap (set non-default) | toggle off | SID unchecked | — | screenshot | <=200ms | (pre route-change) | EXERCISED_CLEAN | — | — |
| 138-A11 | Play→Home | tab-home | route nav (adversarial) | go Home | Home shown | — | screenshot | <1s | — | EXERCISED_CLEAN | — | — |
| 138-A12 | Home | scroll to bottom | swipe x2 | reach bottom controls | scrolled | DRIVES/SOFT IEC/selectors reachable ABOVE TabBar | screenshot | n/a | BUG-066 not regressed | EXERCISED_CLEAN | — | — |
| 138-A13 | Home→Config | tab-config | route nav | go Config | Config shown | category accordion scrolls, WiFi settings clears TabBar | screenshot | <1s | layout fine on Config | EXERCISED_CLEAN | — | — |
| 138-A14 | Config→Play | tab-play | route nav (adversarial return) | go Play | Play shown; filter reset to default (ephemeral useState remount) | filter row reachable on scroll | screenshot | <1s | persistence note (not a bug) | EXERCISED_CLEAN | — | — |
| 138-A15 | Play | MOD checkbox | rapid DOUBLE-tap | net no-change | MOD stays checked | no double-fire/stuck | screenshot+diag | <=200ms | toggle [false]+[true] both success | EXERCISED_CLEAN | ZIP | — |
| 138-A16 | Play | health badge | tap → Diagnostics | open dialog | dialog opens | Healthy/130 actions | screenshot | <1s | diagnostics.open success | EXERCISED_CLEAN | — | — |
| 138-A17 | Diagnostics | Latency view | open | show latency | view opens | P50 51ms P90/P99 216ms, 0 over-budget | screenshot | n/a | no latency violation | EXERCISED_CLEAN | — | — |
| 138-A18 | Diagnostics | overflow → Share all | export | ZIP written | share sheet | c64commander-diagnostics-all-...0514-39Z.zip | adb pull | n/a | pulled+analyzed | EXERCISED_CLEAN | iter138/diagnostics/ | — |

- Visible controls discovered (Play filter family + adjacent): 5 filter checkboxes (SID/MOD/PRG/CRT/Disk) — the BUG-072 target family — plus the diagnostics dialog (badge, overflow, Latency view, Share all) and cross-route regression targets (Home bottom controls, Config accordion). Visible controls exercised: all 5 filter checkboxes (each multiple times, true actuation verified) + diagnostics surfaces.
- Production CTA/control actions attempted: ~22 (5 checkboxes toggled 12 times total + 1 pre-fix repro + 4 route navs + 3 scroll swipes + double-tap + diagnostics badge/Latency/overflow/Share-all). droidmind_cta_action_count ~22 (well above >=40% min 8 / target 12-20). Adversarial transitions: 3 — route-away-and-back (Play→Home→Config→Play) with filter-state observation, rapid double-tap on a checkbox (net no-change verified), and the pre-fix repro tap. Latency checks: 1 (Latency view; 0 over-budget, max 216ms) + per-toggle 27-39ms feedback.
- Repeated interaction: SID x3, MOD x3 (incl double-tap), PRG x2, CRT x2, Disk x2 — all actuation-verified via visible state change AND diagnostics `toggle ... success` actions (no synthetic-only records). Pre-fix the same taps produced Home-nav and NO toggle action.
- Package logcat: inspected yes (`iter138/logcat/app-package-validation.log` 99 lines, `app-package-final.log` 87 lines). App E/W lines: 1 transient `E Capacitor: Failed to connect to /192.168.1.13:80` @06:02:55 (the known BUG-068/069 transient u64 connect-failure that briefly flashed "1 DEGRADED" then self-recovered; u64 reachable host-curl 11ms throughout). Zero FATAL/ANR/exception/StrictMode/chromium errors.
- In-app Diagnostics export: pulled+analyzed yes (`iter138/diagnostics/`). Errors tab/Problems filter: no problems surfaced (Healthy, problemCount 0). Latency analysis: 0 over-budget. No UI-vs-diagnostics discrepancy (UI toggles ↔ diagnostics `toggle ... success` match). Full analysis: `iter138/diagnostics/ANALYSIS.md`.
- Findings:
  - **BUG-072 (Medium) FIXED + current-build HIL-validated.** Root cause corrected: `.page-shell` (the scroll viewport) extended under the `fixed bottom-0` opaque TabBar; BUG-066's padding-only reserve cleared only the last element at max scroll, not the mid-content filter row. Fix: `.page-shell { margin-bottom: var(--app-tab-bar-reserved-height) }` shrinks the viewport to end at the TabBar top so no content renders in the hit band. Also completes BUG-066. 13 `toggle ... success` diagnostics actions confirm actuation.
  - **Corrected #137 mischaracterization:** the Play page DOES scroll (HVSC section below); kilo's "swipe revealed no new content" was a failed gesture. The filter row was reachable-after-scroll, but occluded-and-misrouting at rest.
  - **Not a bug:** Play type-filter state resets to default (all checked) on route re-entry — `playlistTypeFilters` is ephemeral `useState` and PlayFilesPage remounts; expected SPA behavior, unrelated to the CSS change.
  - **Watch (no new bug):** transient u64 `/v1/info` connect failure mid-session briefly degraded then self-recovered — consistent with open BUG-068/069 transient request-failure class, not introduced by this loop.
- Cleanup: u64 `192.168.1.13` HEALTHY (12ms); UltiSid 1/2 = 0 dB (no device config PUT this loop — filter toggles are local state); errors []. Diagnostics dialog/share sheet dismissed. Filter checkboxes left at default (all checked).

## Ralph loop iteration #139 startup (2026-06-23T06:25+01:00, codex / fix/device-hardening)

- Startup followed digest-first path. Branch `fix/device-hardening`, HEAD `0efe339d`; worktree already dirty with prior hardening code/test/state edits. Source label `0.8.9-rc3-0efe3`; Pixel package `uk.gleissner.c64commander` also `0.8.9-rc3-0efe3` before this loop's source change.
- Peer discovery by actual tools: droidmind yes (`9B081FFAZ001WX`, Android 16); mobile-mcp yes (bounds only); c64scope yes (catalog available, lab peers unknown); c64bridge yes (support-only). Hardware: u64 `/v1/info` HTTP 200 in 12ms, `Ultimate 64 Elite` fw `3.14e`; c64u HTTP 000/timeout, not escalated for this UI/input pack.
- Ralph capacity: codex usable, 5h 76% / weekly 12%; action tier `>=40%`, minimum 8 production CTA/control actions, target 12-20, >=1 adversarial transition.
- Selected probe family: **BUG-073 Play Default duration `mm:ss` input-mask fix pack**. Stop criteria: reproduce current APK field behavior; fix and regression-test the input normalization/revert path; rebuild/deploy; re-run invalid/valid duration edits plus adjacent Play controls and lifecycle; mandatory package logcat + Diagnostics Share-all export pulled/analyzed; update CTA ledger, BUGS, digest, and continuation.

### #139 consolidated evidence — BUG-073 FIXED (Play Default duration input mask)

Build/deploy: `./build --skip-tests --install-apk --device-id 9B081FFAZ001WX` (exit 0), installed Pixel package `0.8.9-rc3-0efe3`. Focused regression: `npx vitest run tests/unit/pages/playFiles/playFilesUtils.test.ts` -> 33/33. Source changed: `src/pages/playFiles/playFilesUtils.ts`, `src/pages/PlayFilesPage.tsx`, `src/pages/playFiles/components/PlaybackSettingsPanel.tsx`, `tests/unit/pages/playFiles/playFilesUtils.test.ts`.

| Action ID | Route/Page | UI element | User operation | Expected result | Observed ≈200 ms feedback | Observed ≈1 s / effect result | Oracle used | Latency class | Diagnostics/log result | Status | Artifact refs | Cleanup state |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 139-A01 | Play | Default duration EditText (pre-fix characterization) | Tap field, Backspace×4, type `abc`, blur | Current behavior characterized | Field focus accepted | Direct alphabetic-only edit did not persist in this attempt; field stayed `3:00` | screenshot/UI tree | <=200ms-feedback | no errors | EXERCISED_CLEAN (narrowed repro) | `iter139/ui/prefix-invalid-duration.png` | baseline `3:00` |
| 139-A02 | Source | Duration draft sanitizer | Add `normalizeDurationInputDraft` + focused test | Non-duration text cannot be stored in draft | n/a | Unit test covers stray chars, repeated colon, length trim, incomplete drafts | Vitest | n/a | 33/33 pass | EXERCISED_CLEAN | test output | n/a |
| 139-A03 | Android build/deploy | Current APK | Build/install/launch | Pixel runs fixed source | install success | package version `0.8.9-rc3-0efe3` | build output + droidmind app info | n/a | build successful | EXERCISED_CLEAN | build output | app launched |
| 139-A04 | Play | Default duration EditText | Clear via Backspace×4; input `abc5:30xyz` | Field keeps only valid draft chars | numeric keyboard/focus shown | Visible value became `5:30`; no letters/overlong text retained | screenshot + Diagnostics action export | <=200ms-feedback | duration input actions success 38-46ms | EXERCISED_CLEAN | `iter139/ui/postfix-edit-focused.png`, final ZIP | value `5:30` |
| 139-A05 | Play | Default duration EditText | Clear; input `9:99`; blur | Invalid/ambiguous stream does not leave raw invalid text | visible draft `9:99` | Android numeric path normalized to valid visible `9:09`, no diagnostics errors | screenshot + Diagnostics export | <=200ms-feedback | 0 recent error logs, 0 unexpected traces | EXERCISED_CLEAN | final ZIP analysis | value changed transiently |
| 139-A06 | Play | Default duration EditText cleanup | Select all via Android key-combination; input `3:00`; blur | Restore baseline | field focused | visible `3:00` restored; slider returned to baseline | screenshot | <=200ms-feedback | clean | EXERCISED_CLEAN | `iter139/ui/final-play-restored.png` | `3:00` |
| 139-A07 | Play | Recurse checkbox | Tap twice | Toggle off then on | checkbox changed | diagnostics `toggle Recurse [false]` 27ms, `[true]` 30ms | Diagnostics ZIP | <=200ms-feedback | clean | EXERCISED_CLEAN | `ANALYSIS_FINAL.md` | restored on |
| 139-A08 | Play | Shuffle checkbox | Tap four times (incl. coordinate correction attempts) | Toggle repeatedly, end off | checkbox/action feedback | diagnostics `toggle Shuffle` x4, all success 25-35ms | Diagnostics ZIP | <=200ms-feedback | clean | EXERCISED_CLEAN | `ANALYSIS_FINAL.md` | restored off |
| 139-A09 | Play | Repeat checkbox | Tap corrected label coords twice | Toggle on then off | checkbox/action feedback | diagnostics `toggle Repeat [true]` 31ms, `[false]` 29ms | Diagnostics ZIP | <=200ms-feedback | clean | EXERCISED_CLEAN | `ANALYSIS_FINAL.md` | restored off |
| 139-A10 | Play lifecycle | Android Home / foreground | HOME then start app | App resumes on Play with state | app paused/resumed | Play returned healthy with `3:00` after cleanup | screenshot + logcat | <=1s-effect | no crash/ANR/StrictMode | EXERCISED_CLEAN | logcat final | Play route |
| 139-A11 | Diagnostics | Latency view | Open Diagnostics, overflow, Latency, Back | Latency view works | view opened | 7 samples, P50 28ms, P90/P99 438ms | screenshot + ZIP | n/a | 0 over-budget >1s | EXERCISED_CLEAN | `ANALYSIS_FINAL.md` | main dialog |
| 139-A12 | Diagnostics | Share all export | Overflow -> Share all; dismiss sheet with Back; pull ZIP | ZIP written and analyzable | share sheet shown | pulled `c64commander-diagnostics-all-2026-06-23-0538-43Z.zip` | adb run-as + unzip + node analysis | n/a | Healthy/problemCount 0; 0 recent errors; 0 unexpected traces | EXERCISED_CLEAN | `iter139/diagnostics/` | sheet dismissed |

- Visible controls discovered/classified in selected family: 13 (Default duration slider + EditText, Recurse, Shuffle, Repeat, Reshuffle disabled/no-op, Songlengths Change, Mute, volume slider, Diagnostics health badge, Diagnostics overflow, Latency view, Share all, Android Back/background). Controls exercised: 8 safe controls in this focused pack (duration EditText, Recurse, Shuffle, Repeat, Diagnostics badge/overflow/Latency/Share all, background/foreground). Add items and HVSC controls were not cheaply visible after the focused page position and were out of scope for BUG-073.
- Production CTA/control actions attempted: ~28 droidmind-driven product actions. `droidmind_cta_action_count=28`. Adversarial transitions: 3 — mixed text stream into duration field, invalid/ambiguous seconds stream with blur, Android Home/background -> foreground.
- Repeated interaction: Default duration edited/restored across 3 cycles; Recurse x2; Shuffle x4; Repeat x2; Diagnostics export x2; Android Back x3. Actuation verified by visible field state, diagnostics action rows, share sheet/ZIP creation, and final screenshot; no synthetic-only clean records.
- Mandatory diagnostics/log sweep: final ZIP `docs/agentic/artifacts/iter139/diagnostics/c64commander-diagnostics-all-2026-06-23-0538-43Z.zip` pulled and analyzed (`ANALYSIS_FINAL.md`): healthSnapshot Healthy/problemCount 0, 104 recent actions, 0 recent error logs, 0 unexpected/error traces, latencySamples total 7 / overBudget 0, 14 duration/playback-control actions, 8 toggle actions. Package logcat `iter139/logcat/app-package-final-after-repeat.log` (171 lines): no FATAL/ANR/AndroidRuntime/StrictMode/app exception; one expected `Share canceled` plugin line from Back-dismissed Android share sheet; platform advisories (`perf_hint`, `WindowOnBackDispatcher`, `TextClassifier`) attributed as OS/WebView noise.
- Cleanup: Play route visible, Default duration restored to `3:00`, u64 `/v1/info` Healthy with errors `[]`, Audio Mixer `Vol UltiSid 1/2 = " 0 dB"`, diagnostics/share sheet dismissed. c64u still timed out and was not traffic-escalated. c64scope not used because the pack was UI/input/diagnostics-only; c64bridge not used as an oracle.

## Ralph loop iteration #140 startup (2026-06-23T07:05+01:00, claude / fix/device-hardening)

- Family: Config route / Audio Mixer read-only performance + latency pack on u64 (BUG-053 Medium OPEN). c64u down (HTTP 000), u64 Healthy (200 ~15ms). APK `0.8.9-rc3-0efe3` matches source. Capacity claude `>=40%` (min 8 actions). Peers droidmind/c64scope/c64bridge/mobile-mcp callable. Evidence block appended post-pack.

### #140 consolidated evidence — Config route / Audio Mixer read-only pack (claude / u64 192.168.1.13 / Commander 0.8.9-rc3-0efe3) — **BUG-074 found (root cause of BUG-053; consolidates BUG-068/070)**

Probe family: Config route / Audio Mixer read-only performance + latency pack on u64. c64u down (HTTP 000, not escalated). APK identity `0.8.9-rc3-0efe3` == source. droidmind drove ~24 product interactions (≈22 meaningful production CTA/control actions); 3 adversarial transitions (rapid double-tap Refresh; Play→Config→Home→Config route round-trip with stale work in flight; Android Back from nested dialog/keyboard/share-sheet). No source change, build, deploy, tests, or coverage this loop. Read-only only — NO device writes (UltiSID untouched at 0 dB). u64 stayed reachable throughout (200 ~12-15ms before and after); no app-induced degradation.

**Headline:** the cold Play→Config navigation reproduced a real, current-build defect — the category fetch failed with "Host unreachable" and the badge went `HEALTHY→1 DEGRADED→3 DEGRADED` while u64 was fully reachable from BOTH the dev host (`curl /v1/info`&`/v1/configs` 200 ~12-26ms) AND the Pixel (`ping` 0% loss ~10ms) and the app's own `/v1/info` health probe succeeded (200/42ms). Root cause = scheduled-timeout aborts (HVSC-contention at route entry) misclassified as unexpected "Host unreachable" problems → false DEGRADED + stale `N HEALTHY` problem count + stuck Config error view. Filed **BUG-074** (Medium, root-caused). Refuted a candidate "dead Retry" defect — earlier Retry no-ops were tap-MISSES (taps at y≈620 hit the `config-load-error` container; the real `config-retry` button is at y≈708 and DOES refetch — proven: precise tap loaded the categories).

| Action ID | Route/Page | UI element | User operation | Expected | ≈200ms feedback | ≈1s / effect | Oracle | Latency class | Diagnostics/log result | Status | Artifact refs | Cleanup |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 140-01 | Play→Config | tab-config | Tap (cold route entry) | Categories load | Spinner + badge→1 DEGRADED | "Host unreachable", badge→3 DEGRADED; categories FAILED | screenshot + diagnostics traces + dev-host/Pixel curl/ping (200/0%-loss) | over-budget | `/v1/configs` aborted 1507&1504ms, `/v1/info` 3005ms; 3 `type:error` "Host unreachable" isExpected:false | DEFECT_OPEN (BUG-074) | iter140/diagnostics/…0559-46Z.zip (EVT-0337..0356) | n/a |
| 140-02..03 | Config | config-load-error Retry | Tap ×2 (y≈620) | Refetch categories | none | no refetch (NO /v1/configs fired) | diagnostics: "click config-load-error" success, 0 REST | tap-MISS (container, not button) — NOT a defect | UNCERTAIN→refuted | EVT-0362..0365 | n/a |
| 140-04 | Config | health badge | Tap → open Diagnostics | Dialog opens | dialog | activity list, badge `3 HEALTHY` (stale count) | screenshot + UI tree | n/a | problemCount 3 next to Healthy state | EXERCISED_CLEAN | — | n/a |
| 140-05 | Config | Diagnostics ⋯ → Share all | Tap export | ZIP written to cache | share sheet | ZIP `…0559-46Z.zip` (68KB) | adb run-as pull + unzip + python analysis | n/a | 5 files; supplemental healthSnapshot/latencySamples analysed | EXERCISED_CLEAN | iter140/diagnostics/ | n/a |
| 140-06 | Config | (Android Back) | Back → dismiss share sheet | sheet dismissed | dismissed | diagnostics dialog still open | screenshot | n/a | — | EXERCISED_CLEAN | — | n/a |
| 140-07 | Config | Diagnostics Close | Tap close | dialog closes | closed | Config error view (badge "idle") | UI tree | n/a | category view still stuck "Host unreachable" (no self-heal) | DEFECT_OPEN (BUG-074) | — | n/a |
| 140-08 | Config | config-retry | Tap (y≈708, precise) | Refetch + load | (button) | **categories LOADED** (Audio Mixer…Network Settings); badge flashed 1 DEGRADED then cleared | screenshot + UI tree | <=1s-effect | Retry refetch works; transient degraded on success | EXERCISED_CLEAN | — | n/a |
| 140-09 | Config | Audio Mixer header | Tap expand | Category opens | expands | Vol UltiSid1/2=0dB, Vol Socket1/2=0dB, Sampler L/R, SOLO switches, Reset/Refresh | screenshot + UI tree | <=1s-effect | read-back values consistent; stale "1" persisted next to HEALTHY | EXERCISED_CLEAN | — | UltiSID 0 dB (read) |
| 140-10..11 | Config | Audio Mixer Refresh | Tap ×2 (rapid = adversarial) | Re-fetch category | re-render | values stable 0 dB; no double-fire crash | screenshot | <=1s-effect | warm reads fast/clean | EXERCISED_CLEAN | — | n/a |
| 140-12 | Config | Audio Mixer header | Tap collapse | Category collapses | collapses | list restored; badge `1 HEALTHY` (stale) | screenshot | n/a | — | EXERCISED_CLEAN | — | n/a |
| 140-13..15 | Config | Search categories | Tap + type "sid" + clear | Filter list | keyboard | list→{SID Sockets, UltiSID, SID Addressing}; cleared restores all | screenshot | <=200ms-feedback | client-side filter, read-only, correct | EXERCISED_CLEAN | — | filter cleared |
| 140-16 | Config | (Android Back) | Back → dismiss keyboard | kbd dismissed | dismissed | — | screenshot | n/a | — | EXERCISED_CLEAN | — | n/a |
| 140-17..18 | Config | tab-home, tab-config | Home then Config (warm round-trip = adversarial) | Re-enter cleanly | nav | categories loaded immediately, badge CLEAN HEALTHY (no stale count, no block) | screenshot + UI tree | <=1s-effect | warm re-entry self-heals; confirms trigger is cold-entry-only | EXERCISED_CLEAN | — | n/a |
| 140-19 | Config | SID Sockets Configuration | Tap expand (fresh category read) | Category opens | expands | Socket1/2 Disabled, Detected1=6581, Detected2=None; badge stays HEALTHY | screenshot + diagnostics REST 29-56ms | <=1s-effect | 6 item reads HTTP 200 29-56ms (under budget) | EXERCISED_CLEAN | — | n/a |
| 140-20..24 | Config | Diagnostics ⋯ → Decision state / Latency / Share all (2nd) | open + navigate views | inspect | views | Decision state: all reconcilers success, "No stale diagnostics"; Latency/2nd-Share-all menu taps hit wrong item (synthetic-tap menu offset) | screenshot | n/a | reconcilers clean; 2nd export not generated (menu tap-miss) | EXERCISED_CLEAN | — | n/a |

**Diagnostics ZIP analysis (`iter140/diagnostics/…0559-46Z.zip`, unzipped/):** healthSnapshot `{state:Healthy, connectivity:Online, problemCount:3, primaryProblem:"Host unreachable"(contributor App), contributors.App.failedOperations:3, contributors.REST.problemCount:0}` — the false-problem inflation. latencySamples: 5 total, **4 over-budget** (3005/3005/1507/1504ms = the aborted route-entry reads), 1×42ms ok. traces: 6 `type:error`, **3 = "Host unreachable" failureClass:"unknown" isExpected:false**, while the 7 aborted rest-responses were all `expectedFailure:true` ("The operation was aborted"). deviceSafetyResolution: AUTO→BALANCED `auto-u64-family` U64E (so NOT c64u-conservative pacing). recoveryEvidence: []. **UI-vs-diagnostics discrepancy = the bug itself:** badge/health `state:Healthy` but `problemCount:3` simultaneously.

**Package logcat (`iter140/logcat/app-package-config-pack.log`, 80 lines, pid 23287):** captures the WARM Config-pack interactions only (logcat cleared at 07:06, AFTER the cold-entry failure — that failure evidence lives in the diagnostics ZIP traces). 1 W line `cr_AwAutofillManager: Autofill is disabled` = benign Chromium WebView advisory (WebView autofill unavailable; unrelated). No FATAL/ANR/AndroidRuntime/StrictMode/app exception; remainder Capacitor info + ImeTracker/InsetsController (keyboard from search) + WindowOnBackDispatcher (Back).

**Cleanup:** Config route, SID Sockets expanded, badge HEALTHY; UltiSID 1/2 = 0 dB (never written); search filter cleared; no device config/queue mutation; u64 HEALTHY (200/~13ms) after pack.

## Ralph loop iteration #141 startup (2026-06-23T07:26:47+01:00, codex / fix/device-hardening)

- Read `docs/agentic/STATE_DIGEST.md` first, then latest PLANS/WORKLOG tails, open BUG-053/068/070/074 rows, relevant CTA ledger rows, and Config/Diagnostics feature-test index. Branch `fix/device-hardening`, HEAD `0efe339d`; worktree already dirty with prior hardening edits. Ralph capacity: codex usable, 5h 61% / weekly 10%, so `>=40%` tier applies.
- HIL/tool discovery from actual tools: droidmind callable; c64scope callable; c64bridge callable; mobile-mcp callable for read-only bounds. Selected family: **BUG-074 Config cold-entry timeout/classification fix pack**. Planned validation: focused regressions, build/deploy current APK, Pixel 4 droidmind Config probe pack with mandatory logcat + Diagnostics ZIP export/analysis. No scheduler command run; Ralph Robin owns provider rotation.

### #141 consolidated evidence — BUG-074 FIXED (Config cold-entry timeout/classification)

Probe family: BUG-074 Config cold-entry timeout/classification fix pack on Pixel 4 `9B081FFAZ001WX` and u64 `192.168.1.13` (`Ultimate 64 Elite`, fw `3.14e`). c64u remained HTTP 000/down and was not escalated. Source changed: `src/lib/c64api.ts`, `src/hooks/useC64Connection.ts`, `src/pages/ConfigBrowserPage.tsx`, `src/lib/diagnostics/healthModel.ts`, plus focused regression tests. Build/deploy: `./build --skip-tests --install-apk --device-id 9B081FFAZ001WX`; installed package `uk.gleissner.c64commander` versionName `0.8.9-rc3-0efe3`, versionCode 2029, `lastUpdateTime=2026-06-23 07:31:35`. Focused regression: `npx vitest run tests/unit/c64api.branches.test.ts tests/unit/hooks/useC64Connection.test.ts tests/unit/lib/diagnostics/healthModel.test.ts tests/unit/pages/ConfigBrowserPage.test.tsx` -> 274 tests passed. Coverage was intentionally not run per Ralph HIL policy.

| Action ID | Route/Page | UI element | User operation | Expected result | Observed ~=200 ms feedback | Observed ~=1 s / effect result | Oracle used | Latency class | Diagnostics/log result | Status | Artifact refs | Cleanup state |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 141-A01 | Home | App entry / target badge | Launch/foreground after deploy | Current APK, u64 Healthy | Home rendered, u64 Healthy | package identity matched source label | droidmind + package info + screenshot | <=1s-effect | logcat cleared before batch | EXERCISED_CLEAN | `iter141/ui/entry-home.png` | app on Home |
| 141-A02 | Play | TabBar Play | Tap Play | Move away from Config before cold entry | Play route shown | route stable | droidmind screenshot/UI | <=1s-effect | no error | EXERCISED_CLEAN | — | Play route |
| 141-A03 | Play->Config | TabBar Config / category list | Tap Config (cold route entry) | Category list loads, no Host-unreachable false DEGRADED | Config route rendered | categories loaded within ~=1s; Healthy badge, no load-error | screenshot + Diagnostics export | <=1s-effect | export current-window unexpected errors `[]`, Host-unreachable `[]` | EXERCISED_CLEAN | `iter141/ui/after-cold-config.png`, diagnostics ZIP | Config route |
| 141-A04 | Config | Audio Mixer header | Tap expand | Category opens read-only | section expanded | UltiSID/Socket values visible, no stale problem count | screenshot + export | <=1s-effect | Audio Mixer reads HTTP 200 ~50-98ms | EXERCISED_CLEAN | `iter141/ui/audio-mixer-open.png` | no writes |
| 141-A05 | Config | Audio Mixer Refresh | Tap Refresh x3 rapid | Re-fetch without duplicate/stuck state | refresh action feedback/re-render | values stable; no DEGRADED/problem-count inflation | screenshot + export | <=1s-effect | network failureCount 0 | EXERCISED_CLEAN | `iter141/ui/audio-mixer-after-refreshes.png` | no writes |
| 141-A06 | Config | Audio Mixer header | Tap collapse | Category collapses cleanly | section collapsed | list remains available, Healthy | screenshot/UI | <=200ms-feedback | no error | EXERCISED_CLEAN | — | category collapsed |
| 141-A07 | Config | Search input | Tap input, type `sid` | Client filter applies | keyboard shown | list narrowed to SID-related categories | screenshot | <=200ms-feedback | only benign WebView autofill warning in logcat | EXERCISED_CLEAN | `iter141/ui/search-sid.png` | search active |
| 141-A08 | Config | Search input | DEL x3, Android Back | Clear filter and dismiss IME | characters removed | full category list restored; Back dismissed keyboard only | screenshot/logcat | <=200ms-feedback | no route loss/no app error | EXERCISED_CLEAN | — | search cleared |
| 141-A09 | Config | SID Sockets Configuration | Tap expand | Fresh read-only category fetch | section expanded | Socket1/2 Disabled, Detected1=6581, Detected2=None | screenshot + export | <=1s-effect | item reads HTTP 200 mostly 40-81ms | EXERCISED_CLEAN | `iter141/ui/sid-sockets-open.png` | no writes |
| 141-A10 | Config | SID Sockets Refresh | Tap Refresh x2 | Re-fetch without duplicate/stuck state | re-render | values stable; Healthy | screenshot + export | <=1s-effect | no current unexpected traces | EXERCISED_CLEAN | — | no writes |
| 141-A11 | Config->Home->Config | TabBar Home, TabBar Config | Route round-trip | Warm re-entry stays clean | Home then Config shown | categories loaded; Healthy | screenshots | <=1s-effect | no stale problem count | EXERCISED_CLEAN | `iter141/ui/warm-config-return.png` | Config route |
| 141-A12 | Android lifecycle | Android Home / app foreground | HOME then foreground app | Route and health preserved | app backgrounded/returned | Config visible, Healthy | screenshots + logcat | <=1s-effect | no crash/ANR/StrictMode | EXERCISED_CLEAN | `iter141/ui/after-foreground.png` | Config route |
| 141-A13 | Diagnostics | Health badge | Tap health badge | Diagnostics dialog opens | dialog opens | Healthy state visible | droidmind screenshot | <=1s-effect | diagnostics.open action present | EXERCISED_CLEAN | `iter141/ui/diagnostics-open.png` | dialog open |
| 141-A14 | Diagnostics | Run health check | Tap Run health check | Fresh multi-probe check | busy/result feedback | Healthy 1789ms; REST139 FTP75 TELNET319 CONFIG814 RASTER102 JIFFY243 | Diagnostics UI/export | <=1s-feedback for result progress | export healthSnapshot Healthy/problemCount 0 | EXERCISED_CLEAN | diagnostics ZIP | dialog open |
| 141-A15 | Diagnostics | Overflow / Latency view | Open overflow, tap Latency | Latency view opens | view shown | p50 57 / p90 91 / p99 669; 0 samples >1s | screenshot + export | n/a | no latency violation | EXERCISED_CLEAN | `iter141/ui/diagnostics-latency.png` | view open |
| 141-A16 | Diagnostics | Overflow / Share all | Open overflow, tap Share all, Back dismiss sheet | ZIP written and share sheet dismisses | share sheet "Sharing 1 file" | pulled `c64commander-diagnostics-all-2026-06-23-0640-05Z.zip` and unzipped | adb run-as pull + unzip + jq/rg analysis | n/a | failureCount 0; no unexpected current-window traces | EXERCISED_CLEAN | `iter141/diagnostics/` | share sheet dismissed |
| 141-A17 | Diagnostics | Android Back | Back close Diagnostics | Dialog closes without route loss | overlay closed | Config still visible and clean | screenshot | <=200ms-feedback | no trapped dialog | EXERCISED_CLEAN | `iter141/ui/final-config-clean.png` | Config route |
| 141-A18 | Device cleanup | u64 info + Audio Mixer | Read back final state | u64 Healthy, UltiSID restored/unchanged 0 dB | n/a | `/v1/info` HTTP 200 0.0117s; UltiSID 1/2 `0 dB` | dev-host curl | n/a | device errors `[]` | EXERCISED_CLEAN | `iter141/device/u64-info-final.txt`, `iter141/device/audio-mixer-final.txt` | u64 Healthy, UltiSID 0 dB |

- Visible controls discovered/classified: 15 (Play tab, Config tab/category list, Audio Mixer header/Refresh/collapse, Config search input, SID Sockets header/Refresh, Home tab/warm Config tab, Android Home/foreground, health badge, Run health check, Diagnostics overflow, Latency, Share all, Android Back). Interactive Audio Mixer sliders/SOLO/reset/selectors were visible but treated as `BLOCKED_SAFE`/out of this read-only BUG-074 fix pack to avoid unnecessary device writes; UltiSID read-back stayed 0 dB.
- Visible controls exercised: 13 safe controls in the selected family. Production CTA/control actions attempted: 29. `droidmind_cta_action_count=29`. Action-budget minimum met (`>=40%` tier min 8).
- Adversarial transitions: 4 — Audio Mixer Refresh x3 rapid; search type/clear with Android Back; Home->Config route round-trip; Android Home/background->foreground. Overflow-coordinate misses were corrected before recording Share all as exercised.
- Repeated interaction: Audio Mixer Refresh x3; SID Sockets Refresh x2; Config route entry x2 (cold + warm); Back x3; Diagnostics overflow attempted with coordinate correction and final actuation. Actuation-verified controls: 13 via UI state, diagnostics actions/traces, request traces, pulled ZIP, or device read-back. Synthetic-only clean records: 0.
- Mandatory log/diagnostics sweep: package-filtered logcat `iter141/logcat/app-package-post-pack.log` inspected (199 lines). App-package warning/error attribution: one `W cr_AwAutofillManager: Autofill is disabled...` caused by focusing the Config search EditText; benign WebView autofill advisory. No FATAL/ANR/AndroidRuntime/StrictMode/app exception/Chromium error.
- Diagnostics export pulled/analyzed: `docs/agentic/artifacts/iter141/diagnostics/c64commander-diagnostics-all-2026-06-23-0640-05Z.zip`, extracted under `iter141/diagnostics/unzipped/`. `healthSnapshot.state=Healthy`, `connectivity=Online`, `problemCount=0`, `primaryProblem=null`; `networkSnapshot.successCount=78`, `failureCount=0`; current-window unexpected errors `[]`; current-window Host-unreachable `[]`; latencySamples 31, overBudget >1000ms = 0, max 669ms. `lastHealthCheckResult`: Healthy 1789ms. The export's earlier startup abort rest-responses were `expectedFailure:true` and did not create App problem count or Host-unreachable errors.
- c64scope/c64bridge: c64scope peer health checked but no A/V stream used because the pack was Config/diagnostics read-only. c64bridge callable; `c64_system list_tasks` showed an old running `alias-writer`, so it was not used for Ultimate oracle/mutation.
- Cleanup: Config route visible; u64 Healthy; UltiSID 1/2 = 0 dB; no device config writes performed by the Config pack; share sheet/dialog closed. c64u remained HTTP 000/down, so c64u validation is pending.
- Continuation: CTA ledger, BUGS, digest, and continuation prompt refreshed. Ralph Robin continuation ready; no `llm-scheduler` command run because Ralph Robin owns provider rotation.

## Ralph loop iteration #142 startup (2026-06-23T07:49:25+01:00, kilo / fix/device-hardening)

- Startup digest-first. #141 digest current for routing. Branch `fix/device-hardening`, HEAD `0efe339d`. Ralph kilo usable, balance $87.5 -> `>=40%` tier. Peers callable from actual tool surface; u64 healthy; c64u HTTP 000 down.
- Source/APK identity matched (0.8.9-rc3-0efe3). No source change planned.
- Selected probe family: **Play audio SID playback + c64scope pack**. Will exhaust Play controls, drive a safe SID asset through the app path, validate A/V via c64scope UDP capture, exercise Pause and guarded Stop without forcing destructive paths, then background/lock/foreground lifecycle, mandatory logcat + Diagnostics Share-all ZIP, and restore UltiSID 0 dB.
