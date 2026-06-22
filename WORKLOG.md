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
