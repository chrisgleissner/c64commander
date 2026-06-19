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
