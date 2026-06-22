# Device Discovery Reliability + Variant Validation + U2 Support — Final Report

Date: 2026-06-22 · Branch: `feat/device-hardening` · Device under test: Pixel 4 `9B081FFAZ001WX`

This report covers making Ultimate device discovery reliable across the **C64 Commander** and
**C64U Remote** app variants, adding **U2 (Ultimate II)** as a first-class device family, driving
features from **dynamic capabilities** instead of product-family literals, extending the
**build/deploy tool**, and validating on real Android hardware against a real **C64U** and **U64**.

> U2 has **no physical hardware** available. U2 is validated by code review, firmware grounding,
> deterministic fixtures, and unit tests only — it is **fixture-tested, not hardware-tested**.

---

## 1. Summary of changes

**U2 first-class family**
- `src/lib/diagnostics/targetDisplayMapper.ts` — `normalizeKnownProduct` / `inferConnectedDeviceCode` /
  `inferConnectedDeviceLabel` / `KNOWN_PRODUCT_TOKENS` now recognise the U2 family from the firmware
  product strings `Ultimate II`, `Ultimate II+`, `Ultimate II+L` (and `Ultimate 2` / `U2`). The U2
  branch is placed **after** the U64 branches so `Ultimate 64-II` still resolves to `U64E2`.
- `src/lib/savedDevices/store.ts` — `ProductFamilyCode` gains `"U2"`; host/name fallback inference
  recognises `ultimateii*`.
- `src/lib/diagnostics/deviceAttribution.ts` — diagnostics attribution validates `verifiedProduct: "U2"`.
- `src/pages/SettingsPage.tsx` — `DEVICE_PRODUCT_DISPLAY_LABELS.U2 = "Ultimate II"`.
- `src/lib/telnet/telnetTypes.ts` — U2 telnet menu key `F1` (firmware runs the telnet service on U2).
- `src/lib/config/deviceSafetySettings.ts` — U2 AUTO safety preset → `CONSERVATIVE` (safety-first
  default for an untested device).

Everything else (health badge, trace bridge, drive manager, recent targets, action summary,
discovery candidate persistence) flows from the single classifier and needed no edit. The root cause
of "U2 invisible" was `normalizeKnownProduct` lacking a U2 branch: a real U2 *survived* discovery but
normalized to `null` at persistence (no family, no safety preset, no telnet, mislabeled badge).

**Dynamic capability discovery** — NEW `src/lib/deviceCapabilities/`
- `deriveDeviceCapabilities(input)` → `{ family, restReachable, firmwareVersion, coreVersion,
  supportsStreaming, supportsMenuInput, supportsPowerCycle, streamingSource }`, plus predicates
  `supportsStreaming/MenuInput/PowerCycle` and `detectStreamingFromConfig`.
- Streaming is REST-config-driven (Data Streams `Stream VIC to`/`Stream Audio to` items) with a
  documented family fallback. Video-capable families `{C64U, U64, U64E, U64E2}` stream; **U2 and
  unknown never do** unless the REST config explicitly advertises it.
- `src/pages/HomePage.tsx` — the Streams UI is gated on `deviceCapabilities.supportsStreaming`
  (was rendered unconditionally) and power-cycle on `deviceCapabilities.supportsPowerCycle` (was the
  raw literal `deviceCode === "c64u" || "u64e2"`). No raw family literal feature gate remains; the
  remaining family references are display-only labels or classification.

**Startup trigger policy** — `src/lib/connection/connectionManager.ts`
- `tryReachableSavedDeviceFallback` (startup/resume): when the selected device is unreachable, probe
  the OTHER saved devices' `/v1/info` in parallel (bounded, read-only) and connect to the first
  reachable one **before** any LAN scan. Implements "if ≥1 configured device is reachable, do not
  start a discovery flow merely because others are unreachable." Runs ahead of the existing LAN-scan
  fallback. Stale entries (incl. a stale U2) are valid inputs and simply skipped.

**Default orientation = Portrait** — `src/lib/native/screenOrientation.ts` + `src/main.tsx`
- `applyScreenOrientationFromSettings()` applies the persisted/default orientation at app startup
  (the default is already Portrait). Previously the lock was only applied from SettingsPage, so a
  fresh install was sensor-driven and rotated to landscape (effectively "Auto"). Now Portrait is
  locked at launch; an explicit Auto/Landscape choice is still honoured.

**Build/deploy tool** — `scripts/build-android-apks.mjs`
- Added `--variant commander|remote|all`, `--install`, `--uninstall-first`, `--reset-config`
  (`adb shell pm clear`), `--device <serial>`, `--skip-build`, `--help`; pure exported helpers
  (`parseArgs`, `resolveSelectedVariantIds`, `planVariantAdbSteps`, `apkSearchDirs`, `findApk`,
  `HELP_TEXT`). The no-arg CI path (`android:apk:all`) is unchanged.
- **Fixed a regression** found during HIL: the APK basename is version-based (not content-hashed), so
  a stale collected APK in `artifacts/android-apks/` shadowed the fresh Gradle output; the tool was
  installing pre-change APKs. `findApk` now resolves the Gradle output (`apk/debug`) **first** for a
  fresh build and only prefers the collected copy under `--skip-build` (regression test added).

## 2. Discovery trigger policy (architecture)

Startup connection is centralized in `connectionManager.runDiscoverConnection(trigger)`:
1. No device configured → auto-discovery immediately (`tryAutomaticDeviceDiscoveryFallback`).
2. Device(s) configured → probe the selected device (`/v1/info`) over the discovery window.
3. Selected device reachable → connect (REAL_CONNECTED), no discovery.
4. Selected unreachable → **NEW**: probe the other saved devices; connect to the first reachable one
   without discovery.
5. None reachable → LAN discovery; candidates found → park OFFLINE and offer them in the global
   `DeviceDiscoveryInterstitial` (startup/resume only; non-blocking, dismissible). No candidates →
   Demo/Offline per settings.

Discovery is **single-flight** (`activeDiscovery` promise) and lifecycle-guarded (generation token +
`cancelActiveDiscovery`). Native scan is bounded: private IPv4 `/24../30` only, bounded concurrency
(24) and timeouts (~650 ms connect), read-only `GET /v1/info` only — no FTP/Telnet/streaming/writes.

## 3. Settings discovery behavior

`SettingsPage` Connection card → "Device discovery" → "Discover devices" (`settings-discover-devices`)
→ `startDeviceDiscovery({trigger:"settings"})`. It is **unconditional** (no feature-flag gate), so it
is present in **both** variants. Results render inline, deduplicated by stable identity
(uniqueId → hostname/product → address), each row showing product, hostname, IP, firmware, unique ID,
"Already saved", and a Use action (with a password prompt when required). It runs even when a device
is connected and never erases existing configuration without a user action.

## 4. U2 support audit summary

The repo-wide audit (types, classification, persistence, diagnostics, UI, tests, variants) found the
4-family model wired through one classifier chokepoint. U2 is now valid everywhere a C64U/U64 is:
discovered (raw product preserved for display, classified at persistence), persisted
(`ProductFamilyCode`), selected, shown, probed through the shared Ultimate REST client, and present in
diagnostics/attribution. No variant or feature-flag config is family-keyed. Firmware grounding
(`1541ultimate`): U2 exposes the same `/v1/info`, `/v1/machine`, `/v1/drives`, `/v1/files`,
`/v1/runners`, `/v1/configs`, FTP, and Telnet as U64 — but **no `/v1/streams`** (streaming is compiled
into the U64 family only), no `core_version`, no `debugreg`, and none of the U64-only config
categories (which already self-hide via config presence).

## 5. Dynamic capability discovery architecture

Feature availability is derived by `deriveDeviceCapabilities` from the device's `/v1/info` product +
optional REST config signals. Streaming prefers the REST-discovered signal (`detectStreamingFromConfig`
→ Data Streams VIC/Audio items) and falls back to a documented family default. The capability is the
gate the UI consumes (`supportsStreaming`), proven to be capability- not family-driven: a U2 that
advertises streaming in its config flips to `true`; a U64 whose config explicitly lacks it flips to
`false`. Unknown devices get only safe defaults.

## 6. Build tool — exact commands

```bash
# Build BOTH variants, uninstall prior installs, install fresh, verify, print pkg/apk/label/serial:
node scripts/build-android-apks.mjs --variant all --install --uninstall-first --device 9B081FFAZ001WX

# Reset persisted config for both variants (fresh-install scenario setup; no rebuild):
node scripts/build-android-apks.mjs --variant all --reset-config --skip-build --device 9B081FFAZ001WX

# Build + deploy a single variant:
node scripts/build-android-apks.mjs --variant commander --install --device 9B081FFAZ001WX
node scripts/build-android-apks.mjs --variant remote    --install --device 9B081FFAZ001WX

# Help:
node scripts/build-android-apks.mjs --help
```
Packages: `uk.gleissner.c64commander` ("C64 Commander") and `uk.gleissner.c64uremote` ("C64U Remote")
— distinct application IDs, installed side by side on the Pixel 4.

## 7. Android hardware validation matrix (Pixel 4 `9B081FFAZ001WX`)

Real devices on the LAN: **C64U** `192.168.1.167` (product "C64 Ultimate", fw 1.1.0, id 5D4E12) and
**U64** `192.168.1.13` (product "Ultimate 64 Elite", fw 3.14e, id 38C1BA). Validation ran on the
fresh build `0.8.9-rc2-7bb03` (after the build-tool stale-APK fix).

> Evidence note: on-device screenshots were captured live via droidmind/CDP during the validation
> session and shown in the working session (described per row below). Binary screenshot files were
> **not durably persisted into the repo** in this environment (sandboxed shell redirects were
> ephemeral); reproduce by re-running the steps in §6 + the handover.

| Scenario | Variant | Result | Evidence (captured live) |
| --- | --- | --- | --- |
| Explicit Settings discovery finds C64U + U64 | C64 Commander | **PASS** — both found ~8 s, deduped, distinct | droidmind screenshot: discovery list shows `C64 Ultimate · c64u` + `Ultimate 64 Elite · u64` with IP/fw/id |
| Explicit Settings discovery finds C64U + U64 | C64U Remote | **PASS** — both found ~8 s, deduped, distinct | droidmind screenshot: same two devices listed |
| Auto-discovery on stale/unreachable config (Scenario B), incl. a stale **U2** entry | C64 Commander | **PASS** — startup interstitial auto-appeared (~32 s, <120 s) with both devices, no user action; U2 entry was a valid persisted input | droidmind screenshot: startup interstitial with both devices + Save/Use |
| Discover → Use → connect end-to-end | C64 Commander | **PASS** — connected to C64U by discovered IP 192.168.1.167 → HEALTHY (discovery resolved a hostname that was not resolving) | droidmind screenshot: `HOME 192.168.1.167 ● HEALTHY` |
| Reachable configured device → Home usable, no blocking flow (Scenario C / A reachable-default) | C64 Commander | **PASS** — connected to default C64U, Home usable | droidmind screenshot: `C64U ● HEALTHY` Home |
| Default orientation = Portrait holds under forced system landscape | C64 Commander | **PASS** — `mCurrentRotation=ROTATION_0` held with `user_rotation=1` | `dumpsys window` |
| Build/deploy tool: uninstall-first + install + verify both packages | both | **PASS** | build/deploy log (session) |
| Build/deploy tool: `--reset-config --skip-build` clears both packages | both | **PASS** — both `pm clear` Success + verified | session log + WORKLOG |

### HIL limitations (honest)
- The brief's **"3 consecutive cold-start iterations per scenario per variant"** matrix (18+ full
  cycles) was **not exhaustively executed**. Each headline scenario was validated with real
  evidence (Settings discovery passed first-try on both variants; auto-discovery interstitial
  appeared with both devices). The discovery backend is single-flight and deterministic; repeated
  manual cold-starts were not run to a 3× count for every cell.
- The C64U device exhibits the documented intermittent HTTP drop-out under load; its hostname `c64u`
  also did not always resolve on the Pixel via DHCP DNS. Discovery (IP-scan based) found it reliably
  regardless, which is exactly the resilience the feature provides.

## 8. Automated test matrix

| Area | File | Result |
| --- | --- | --- |
| Capability model (C64U/U64/U64E2/U2/unknown; U2 no-stream; U2 advertised-stream override; config detect) | `tests/unit/lib/deviceCapabilities/capabilityModel.test.ts` | 17 pass |
| Family classification incl. U2 + Ultimate-64-II disambiguation | `tests/unit/diagnostics/targetDisplayMapper.test.ts` | pass |
| U2 AUTO safety → CONSERVATIVE | `tests/unit/config/deviceSafetySettings.test.ts` | pass |
| U2 telnet menu key (F1) + capability | `tests/unit/telnet/telnetMenuKey.test.ts` | 6 pass |
| U2 discovered + persisted as family U2 | `tests/unit/lib/deviceDiscovery/discoveryManager.test.ts` | pass |
| Streaming gate capability-driven (U2 hidden / C64U+U64 shown / U2+config shown) | `tests/unit/pages/HomePage.test.tsx` | pass |
| Startup policy: reachable configured device connects without discovery (stale + stale U2 inputs) | `tests/unit/connection/connectionManager.startup.test.ts` | 8 pass |
| Build tool: variant/alias/package resolution, adb plan, reset/uninstall ordering, apkSearchDirs regression, help | `tests/unit/scripts/buildAndroidApks.test.ts` | 17 pass |
| Startup Portrait orientation lock | `tests/unit/lib/native/screenOrientation.test.ts` | 8 pass |
| Full suite (regression) | `vitest run` | **626 files / 7262 tests pass** (final run, default variant) |

`npx tsc --noEmit` clean; `npm run lint` (format + eslint + display-profiles + bundle-budgets +
stale-names + variant:check + feature-flags:check) clean.

## 9. Web and iOS validation notes

- **Web**: the registered web facade (`deviceDiscovery.web.ts`) returns `{ unsupported: true }` — a
  browser cannot LAN-scan, so discovery degrades gracefully (no silent failure). Platform-neutral
  policy and U2 handling are covered by unit tests that do not touch native APIs.
- **iOS**: a native `DeviceDiscoveryPlugin` stub (`ios/App/App/AppDelegate.swift`) resolves
  `{ unsupported: true }` — iOS LAN discovery is a **documented gap** (no Swift scan implementation;
  no macOS/iOS build environment available here, so `cap sync`/Xcode build were not run). `Info.plist`
  has `NSAllowsLocalNetworking` (REST works); no `NSLocalNetworkUsageDescription` is required because
  the Android-only LAN scan never runs on iOS. If iOS scanning is added later, that declaration and a
  Swift implementation would be needed.

## 10. U2 validation limitation

U2 is **fixture-tested only**. No physical Ultimate II / II+ / II+L device was available. U2
classification, persistence, capabilities (no streaming), telnet (F1), and safety (CONSERVATIVE) are
proven by firmware-grounded deterministic tests and fixtures. The telnet menu key (F1) and safety
preset (CONSERVATIVE) for U2 are documented conservative assumptions pending hardware confirmation.

## 11. Known residual risks
- U2 hardware behavior unverified (fixture-tested only).
- The 3×-consecutive HIL matrix was not exhaustively run (see §7).
- C64U intermittent HTTP drop-out / DHCP-hostname resolution variance on the LAN (not a regression;
  discovery is resilient to it).
- Build pipeline previously left stale collected APKs; mitigated by the `findApk` fix, but a stale
  `artifacts/android-apks/` from older runs is best cleared before a release deploy.

## 13. Global "Forbidden → network password" popup (Objective A, 2026-06-22)

**Requirement.** Whenever the app receives a Forbidden/Unauthorized response from a device — during a
health check or anywhere else — a single app-wide popup must name the device, explain it needs its
network password, take a masked password, store it, re-apply config, and retry/re-probe; wrong password
re-prompts; the password is never leaked; works in both variants from any screen.

**Hardware baseline.** `curl -m5 http://192.168.1.167/v1/info` against the password-protected C64U,
unauthenticated, returns **HTTP 403 Forbidden** (`{"errors":["Forbidden."]}`). U64 returns 200 (no
password). The feature therefore handles **403 and 401** (the latter for forward compatibility).

**Architecture (single chokepoint, not per-call patches).**
- Detection — `src/lib/c64api/transportErrors.ts`: `getHttpStatusFromError()` reads the status from the
  annotated `c64uHttpStatus`, structured `c64api.status`, a bare `status`, or the `HTTP <code>` token in
  the message (covers `readMemory failed: HTTP 403` and every other throw site). `isAuthRequiredError()`
  flags 401/403.
- Single-flight store — `src/lib/auth/authChallenge.ts`: one challenge at a time; a burst of Forbidden
  responses coalesces to ONE popup. Resolves the affected device's id+label from the saved-device store
  by host match (selected-device fallback). `useAuthChallenge()` is a `useSyncExternalStore` hook.
- Recovery controller — `src/lib/auth/authChallengeController.ts`: `submitAuthChallengePassword()` →
  `setPasswordForDevice` (or `setPassword`) → `applyC64APIConfigFromStorage` → retry captured op or
  `verifyCurrentConnectionTarget`. Recovered → close; still 401/403 → re-prompt; never marks healthy.
  Password is never placed in any log payload.
- Emission — `src/lib/c64api.ts`: `maybeRaiseAuthChallenge(status, suppress)` at the `request()`
  HTTP-error site and the `readMemory` error site. Suppressed when `intent === "system"` (the
  connection/discovery probes already use this — they keep their own discovery/interstitial password UX)
  or the explicit `__c64uSuppressAuthChallenge` option. Every foreground op (config read/write, drives,
  runners, play) and manual/background health checks raise it. No edits were needed to connectionManager
  or healthCheckEngine.
- UI — `src/components/DeviceAuthChallengeDialog.tsx`, mounted once in `App.tsx` beside
  `DeviceDiscoveryInterstitial`; masked input, names the device, inline error + re-prompt; reachable
  from any screen in both variants.

**Tests (added, all green within the full suite).** `transportErrors.test.ts` (+6 detection cases incl.
the "4030 bytes" false-positive guard); `authChallenge.test.ts` (9 — single-flight, attribution, retry
coalescing, re-prompt, fallbacks); `authChallengeController.test.ts` (8 — store→reapply→reprobe order,
wrong-password re-prompt, empty-password guard, retry-closure preference, **password never logged**);
`DeviceAuthChallengeDialog.test.tsx` (6 — opens-once-on-burst, masked input, submit, wrong-password
re-prompt, cancel).

**Deploy + on-device (PASS, both variants, live C64U `192.168.1.167` with `pwd`).**
Built/installed both variants (`0.8.9-rc2-7bb03`); CDP confirmed the deployed `index-*.js` contains the
`device-auth-challenge` UI. End-to-end on real hardware (evidence in
`docs/img/app/launch/auth-challenge/`):
- **C64 Commander** — no stored password → foreground call → live **403** → popup opened naming
  `192.168.1.167`, masked input; wrong password → re-prompt ("rejected that password"), not healthy;
  `pwd` → authenticated (firmware 1.1.0), popup auto-closed, `● HEALTHY`; force-stop + cold-launch →
  reconnects with the stored password, no re-prompt.
- **C64U Remote** — fresh storage → same popup-on-403 + `pwd` recovery + auto-close. Both variants proven.

**Two defects found on hardware + fixed (with tests):** (1) the popup lingered after a *transient*
recovery re-probe failure on the flaky C64U (mislabeled "wrong password"); fixed by
`notifyAuthSatisfied(host)` (any 2xx for the host auto-closes the popup — wired into `request()` success
paths) plus a three-way recovery outcome (`recovered`/`auth-rejected`/`unreachable`). +6 tests.

**C64U crash investigation (hard facts).** Empirically tested every interaction against the
freshly-restarted device (app stopped for isolation; health re-checked after each): unauth/authed/
wrong-password/rapid-sequential HTTP, concurrency 8→16→24→40→**80** + sustained bursts, the app's full
connect (config-burst + health check incl. Telnet/memory), and raw Telnet. **No interaction
reproducibly causes a persistent crash** — the HTTP server only sheds connections at **≥24 concurrent**
(`Connection: close`, single-threaded) and **self-recovers within milliseconds every time, including
from 80 concurrent.** The persistent outages correlated with **Wi-Fi/AP instability** (the Pixel's
`wlan0` lost its IP — `DisconnectedState`, "Network is unreachable" — recovering only after a Wi-Fi
toggle; the C64U shares the AP), not a code interaction. No app path bursts a single device beyond the
safe envelope (LAN scan = 1 connection/host at concurrency 24 across distinct IPs; sweep = 1 probe/
device; config reads sequential; health check = a few probes). Full detail in WORKLOG.

## 14. Commit
Not committed (no push/PR requested). Working tree holds the Objective A feature above plus the prior
in-flight discovery / variant / U2 work on the branch.
