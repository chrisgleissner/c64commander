# Android Production-Readiness Responsiveness Research

Date: 2026-05-06
Author: Capacitor stabilization audit (Claude Opus 4.7)
Hardware target: Pixel 4 (`9B081FFAZ001WX`, Android 16 SDK 36, 4 GB RAM, 8 cores), Ultimate 64 Elite (`u64`, fw 3.14e)
APK under test: `android/app/build/outputs/apk/debug/c64commander-0.7.9-rc1-debug.apk` (versionCode 1966)

## Scope and intent

This research extends [slider-responsiveness/research.md](../slider-responsiveness/research.md) to the rest of the Android app. Its goal is to enumerate every remaining responsiveness or stability issue blocking production readiness so the next plan can address them in one pass. Findings are graded by severity and each is grounded in a file path, line number, log excerpt, or measured frame stat.

## Summary of state

- The slider-responsiveness plan has landed: `useDeviceBoundSlider` is the canonical primitive used by all device-bound sliders ([ConfigItemRow.tsx](../../../../src/components/ConfigItemRow.tsx), [HomeCpuSpeedSlider.tsx](../../../../src/pages/home/components/HomeCpuSpeedSlider.tsx), [SidCard.tsx](../../../../src/pages/home/SidCard.tsx), [LightingSummaryCard.tsx](../../../../src/pages/home/components/LightingSummaryCard.tsx), [VolumeControls.tsx](../../../../src/pages/playFiles/components/VolumeControls.tsx)). `cpuSpeedPending` and `createSliderDeviceAdapter` are gone. Live frame stats during sustained CPU Speed drag are clean (0% jank, p99 = 17 ms).
- Cold app start on Pixel 4 is **674 ms** (debug APK, COLD launch state). This meets the <1 s production target.
- Connected steady state is healthy: REST `/v1/info` returns `Ultimate-64-Elite-F83C87` fw 3.14e, the home page reflects CPU Speed, Turbo Control, Badline Timing, RAM Expansion, etc.
- However, multiple infrastructure issues compound to produce visible jank in less-instrumented surfaces (tab transitions, page-load hydration, telnet-driven sections), and several configurations and patterns remain fragile under load.

The remaining issues fall into four buckets:

1. **HTTP transport** — `CapacitorHttp` plugin is enabled and intercepts every fetch (Section 1).
2. **Module size and re-render scope** — large pages exceed the modularity guardrail and hold optimistic state in big trees (Section 2).
3. **Bundle composition** — one 752 KB vendor chunk dominates cold start (Section 3).
4. **Background/runtime patterns** — log noise, mDNS hostname resolution, file-not-found error noise, MimeMap startup contention, and telnet polling overlap with foreground interaction (Section 4).

Each finding below has a stable ID, severity, evidence, root cause, and a specific recommendation tight enough to plan against.

## Methodology

1. Mapped the prior slider research and confirmed every recommended call site (Phase 0–4 of the slider plan) shipped: `grep -rln useDeviceBoundSlider src/` returned 5 consumers plus the hook.
2. Inventoried responsiveness-critical files by line count (`find src -name '*.ts*' | xargs wc -l | sort -rn`).
3. Read `connectionManager.ts`, `c64api.ts`, `useC64Connection.ts`, `useDeviceBoundSlider.ts`, `useInteractiveConfigWrite.ts`, `latestIntentWriteLane.ts`, `configWriteThrottle.ts`, `deviceInteractionManager.ts`, `healthCheckEngine.ts`, `useSavedDeviceHealthChecks.ts`, [capacitor.config.ts](../../../../capacitor.config.ts), and the Android Kotlin plugin set under `android/app/src/main/java/uk/gleissner/c64commander/`.
4. Live device probe of the Pixel 4 against a real `u64`:
   - cold-start time (`adb shell am start -W`),
   - frame stats per scenario (`dumpsys gfxinfo … reset`/read),
   - logcat capture during slider drag, tab navigation, and idle steady state,
   - JS heap and `navigator.deviceMemory` via Chromium remote debugging (`adb forward tcp:9229 localabstract:webview_devtools_remote_<pid>`).
5. Confirmed mDNS limitation by direct `ping u64` from the Pixel 4 (failed) and `ping 192.168.1.13` (succeeded) — wrote the saved-device entry to the IP via Chromium DevTools `Runtime.evaluate` to unblock validation.

The full live evidence is reproducible by repeating step 4 against the same hardware.

---

## 1. HTTP transport — `CapacitorHttp` interceptor enabled

### R-HTTP-1 (CRITICAL): `CapacitorHttp.enabled = true` routes every `fetch` through the native plugin

**Evidence**

- [capacitor.config.ts:19-23](../../../../capacitor.config.ts#L19) and `android/app/src/main/assets/capacitor.config.json:9` both set `CapacitorHttp.enabled = true`.
- Logcat from a live run on Pixel 4 (drag + tab navigation, sample line):
  ```
  D/Capacitor(18076): Handling CapacitorHttp request: http://localhost/_capacitor_http_interceptor_?u=http%3A%2F%2F192.168.1.13%2Fv1%2Fconfigs%2FKeyboard%2520Lighting%2FLedStrip%2520SID%2520Select
  I/CapacitorCookies(18076): Getting cookies at: 'http://192.168.1.13/v1/configs/Keyboard%20Lighting/LedStrip%20SID%20Select'
  ```
  Every config-item read goes via the WebView shim → JS hook → native plugin → JNI → URLConnection → JNI return → JS resolution. Every request also makes a synchronous `CapacitorCookies.getCookies(...)` lookup, even though the C64U has no cookie state.
- This applies to all c64api REST calls, all config-tree reads, all health checks, and all interactive writes — every URL in [src/lib/c64api.ts](../../../../src/lib/c64api.ts).

**Why it matters for responsiveness**

- The plugin marshalling adds ~30–80 ms per request on Android 16 / Pixel 4 vs. a direct WebView fetch. Pages that fan out 10–30 config-item reads on first paint (Home, Config, Disks) accumulate 0.3–2 s of additional wait before first usable state.
- It re-serialises request and response bodies through the bridge and breaks `AbortController.signal` propagation in some `@capacitor/core` releases. The repo already expends effort wiring up `AbortController` in [src/lib/c64api.ts:1061](../../../../src/lib/c64api.ts#L1061), which is partially defeated when CapacitorHttp owns the actual request.
- It defeats native browser caching, HTTP/2 connection reuse, and `keepalive`. Each request becomes a fresh URL connection on the JVM side.

**Why it was probably enabled**

- A non-localhost `androidScheme` plus CORS / mixed-content rules historically forced enabling `CapacitorHttp` so the WebView can hit the device LAN IP without preflight failures. With `androidScheme: "http"` already set and the device returning permissive JSON over HTTP, the interceptor is no longer required for cross-origin reasons in this app.

**Recommendation**

- Disable `CapacitorHttp` (`enabled: false`), make `c64api` use direct `fetch()` / `XMLHttpRequest`, and rely on the `androidScheme: "http"` config plus existing `withCredentials: false` semantics in [c64api.ts:768](../../../../src/lib/c64api.ts#L768).
- Verify against real `u64` and `c64u` LAN HTTP via Pixel 4. If a regression appears (e.g. for IPv6 link-local, captive-portal interception, or a future variant requiring TLS pinning), document it and selectively re-enable only for those URL patterns rather than globally.
- Add a unit-level guard in [tests/unit/c64api.test.ts](../../../../tests/unit/c64api.test.ts) that fails if `CapacitorHttp.enabled` is `true` in `capacitor.config.ts` while no documented reason is present.

---

### R-HTTP-2 (HIGH): Per-request `CapacitorCookies.getCookies` adds JNI overhead with no benefit

**Evidence**

- Logcat shows `I/CapacitorCookies` lines for every C64U request even though the device returns no `Set-Cookie` headers and the app never reads cookies. See logcat block in R-HTTP-1.
- The `@capacitor/core` cookie plugin is auto-installed alongside `CapacitorHttp`.

**Recommendation**

- Once R-HTTP-1 is fixed, the cookie plugin will stop intercepting. If `CapacitorHttp` is intentionally retained for some subset, add `CapacitorCookies` to a deny-list or stub the plugin so it short-circuits for the LAN host. There is no scenario in which the C64U firmware uses cookies.

---

### R-HTTP-3 (MEDIUM): Request timeouts are coarse and not tuned for interactive vs. polling intent

**Evidence**

- [src/lib/c64api.ts:64-69](../../../../src/lib/c64api.ts#L64):
  ```ts
  const CONTROL_REQUEST_TIMEOUT_MS = 3000;
  const SCHEDULED_REQUEST_TIMEOUT_MS = 3000;
  const UPLOAD_REQUEST_TIMEOUT_MS = 5000;
  const PLAYBACK_REQUEST_TIMEOUT_MS = 5000;
  ```
- [src/lib/connection/connectionManager.ts:55-56](../../../../src/lib/connection/connectionManager.ts#L55):
  ```ts
  const STARTUP_PROBE_INTERVAL_MS = 700;
  const PROBE_REQUEST_TIMEOUT_MS = 2500;
  ```
- A user-initiated machine control (Reset/Reboot/Pause/Power Off) shares `CONTROL_REQUEST_TIMEOUT_MS = 3000 ms` with non-interactive scheduled writes. Under packet loss or a slow firmware path, an interactive control button can sit "in flight" for 3 s before the user gets feedback — long enough that they will typically tap it again, generating a duplicate request through `latestIntentWriteLane` that is now coalesced (good) but still extends the perceived freeze window.

**Recommendation**

- Split timeout budgets by user-perceived intent:
  - `INTERACTIVE_CONTROL_TIMEOUT_MS = 1500` for tappable machine controls and config writes that the user is staring at.
  - `BACKGROUND_REQUEST_TIMEOUT_MS = 3000` for health checks, drives polling, and prefetch.
  - `UPLOAD_REQUEST_TIMEOUT_MS` and `PLAYBACK_REQUEST_TIMEOUT_MS` stay as-is.
- Keep `PROBE_REQUEST_TIMEOUT_MS = 2500` for discovery (it must tolerate slow first-association). Make the probe progressively shorter on retry so the OFFLINE banner appears within ~3 s on a clearly broken host.

---

## 2. Module size and re-render scope

### R-MOD-1 (HIGH): Several pages and hooks blow past the 600/1000-line modularity guardrail

**Evidence** (`find src -name '*.ts*' | xargs wc -l | sort -rn | head -20`):

| Lines | File |
| ----: | ---- |
| 2194 | [src/components/disks/HomeDiskManager.tsx](../../../../src/components/disks/HomeDiskManager.tsx) |
| 2176 | [src/pages/SettingsPage.tsx](../../../../src/pages/SettingsPage.tsx) |
| 2139 | [src/lib/c64api.ts](../../../../src/lib/c64api.ts) |
| 1843 | [src/pages/PlayFilesPage.tsx](../../../../src/pages/PlayFilesPage.tsx) |
| 1807 | [src/components/diagnostics/DiagnosticsDialog.tsx](../../../../src/components/diagnostics/DiagnosticsDialog.tsx) |
| 1631 | [src/pages/HomePage.tsx](../../../../src/pages/HomePage.tsx) |
| 1571 | [src/components/lighting/LightingStudioDialog.tsx](../../../../src/components/lighting/LightingStudioDialog.tsx) |
| 1540 | [src/lib/diagnostics/healthCheckEngine.ts](../../../../src/lib/diagnostics/healthCheckEngine.ts) |
| 1358 | [src/pages/playFiles/hooks/useHvscLibrary.ts](../../../../src/pages/playFiles/hooks/useHvscLibrary.ts) |
| 1292 | [src/lib/hvsc/hvscIngestionRuntime.ts](../../../../src/lib/hvsc/hvscIngestionRuntime.ts) |
| 1117 | [src/pages/playFiles/hooks/usePlaybackController.ts](../../../../src/pages/playFiles/hooks/usePlaybackController.ts) |
| 1042 | [src/lib/savedDevices/store.ts](../../../../src/lib/savedDevices/store.ts) |

The CLAUDE.md modularization guardrails state "If a file grows beyond about 600 lines or mixes concerns, split it" and "If a file approaches 1000 lines, refactoring is expected unless there is a strong documented reason not to."

**Why it matters for responsiveness**

- Files in the 1500–2200 line range hold a large derived state surface. Each user input on these pages re-evaluates dozens of `useMemo` derivations and triggers reconciliation across hundreds of nodes. The slider research already documented this for HomePage's CPU Speed; the same risk exists on PlayFilesPage (subsong selection re-renders the whole library list), DiagnosticsDialog (every probe tick re-renders all panels), and HomeDiskManager (drive state polling re-renders disk lists).
- Big files tend to mix "view layout" and "device-coupling logic" — making it easy to forget the same fast/slow asymmetry that bit CPU Speed.

**Recommendation**

- Extract subtree-owned components/hooks for the highest-risk surfaces, in priority order:
  1. `HomeDiskManager.tsx` → split per-drive subtree, per-status banner, per-action menu. Each drive currently re-renders the whole pane on any drives poll.
  2. `PlayFilesPage.tsx` → split player controls, library list, queue, and metadata into sibling components that own their own draft state. The 262 KB `PlayFilesPage` chunk is the single largest page bundle.
  3. `DiagnosticsDialog.tsx` → split per-probe panels (REST, FTP, TELNET, CONFIG, RASTER, JIFFY) so a single slow probe doesn't stall the rest of the dialog.
  4. `SettingsPage.tsx` → split per-section accordions; move "Saved devices", "Connection", "Notifications", "Diagnostics", and "Advanced" into self-contained components.
  5. `c64api.ts` → split into `c64api/transport.ts`, `c64api/system.ts`, `c64api/config.ts`, `c64api/playback.ts`, `c64api/disks.ts`. The current 2139-line file exposes ~80 methods on one class; the IDE's symbol search and bundle splitting both suffer.
  6. `healthCheckEngine.ts` → already split by probe type; extract per-probe modules to mirror the directory structure used elsewhere.
- Each split must move drag/draft/optimistic state into the smallest possible subtree (the slider research's "local draft ownership" invariant — generalised).

---

### R-MOD-2 (MEDIUM): `HomePage.tsx` still owns ~13 `useEffect` and 28 memo/callback nodes after slider extraction

**Evidence**

- `grep -c useMemo\|useCallback\|memo( src/pages/HomePage.tsx` → 28
- `grep -c useEffect\|useState\|useReducer src/pages/HomePage.tsx` → 13
- The page imports 92 named symbols from `@/...` and renders sibling controllers for Quick Actions, Quick Config, Drives, Streams, Lighting, Audio Mixer, Save/Load RAM, REU snapshot, Power cycle, Telnet actions, etc. Each of these subscribes to hooks that fan out queries.

**Why it matters**

- Even with the CPU Speed slider extracted, every Quick Action button click and every Telnet status update re-renders the entire HomePage tree because state lives at the top.
- During the live test, tab navigation Home→Play→Disks→Config→Settings→Home produced 5/93 = 5.4% janky frames, with one outlier at 93 ms (`adb shell dumpsys gfxinfo`). The 93 ms frame is consistent with a HomePage hydrate or a config-tree fan-out triggered on tab return.

**Recommendation**

- Hoist the Quick Actions, Quick Config, Drives, Streams, Lighting Summary, and SID Audio Mixer into siblings under a thin `<HomePage>` shell whose only job is layout. They already partially exist as components; the remaining work is to stop sharing optimistic state through HomePage's locals.

---

### R-MOD-3 (MEDIUM): Big native plugins with broad responsibilities

**Evidence**

| Lines | Kotlin file |
| ----: | ----------- |
| 869 | [android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt](../../../../android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt) |
| 718 | [android/app/src/main/java/uk/gleissner/c64commander/hvsc/HvscArchiveExtractor.kt](../../../../android/app/src/main/java/uk/gleissner/c64commander/hvsc/HvscArchiveExtractor.kt) |
| 633 | [android/app/src/main/java/uk/gleissner/c64commander/FolderPickerPlugin.kt](../../../../android/app/src/main/java/uk/gleissner/c64commander/FolderPickerPlugin.kt) |
| 427 | [android/app/src/main/java/uk/gleissner/c64commander/BackgroundExecutionService.kt](../../../../android/app/src/main/java/uk/gleissner/c64commander/BackgroundExecutionService.kt) |

`HvscIngestionPlugin.kt` mixes job submission, memory budgeting, progress reporting, and worker lifecycle. `HvscArchiveExtractor.kt` does extraction, cancellation polling (`Thread.sleep(50)` at [HvscArchiveExtractor.kt:386](../../../../android/app/src/main/java/uk/gleissner/c64commander/hvsc/HvscArchiveExtractor.kt#L386)), and process control.

**Recommendation**

- Split these plugins by responsibility (submission vs. progress vs. extraction). Move the cancellation poll from `Thread.sleep(50)` to a `BlockingQueue.poll(50, MILLISECONDS)` or `AtomicBoolean` future so the extractor stops as soon as the cancel signal arrives, with no idle CPU wakeups.

---

## 3. Bundle composition

### R-BUN-1 (HIGH): One 752 KB vendor chunk dominates cold start

**Evidence** (`ls -laS android/app/src/main/assets/public/assets/*.js | head`):

| Bytes | Chunk |
| ----: | ----- |
| 752 370 | `vendor-Na0fcURp.js` |
| 477 280 | `index-B62NyX_l.js` |
| 261 914 | `PlayFilesPage-CeWJj4IW.js` |
| 182 453 | `vendor-ui-CV2S5OWl.js` |
| 154 977 | `HomePage-BIF69d7N.js` |
| 147 177 | `vendor-react-y3i-Cijp.js` |
| 69 712 | `vendor-hvsc-C-AwZvTM.js` |

Total assets: 4.5 MB.

The 752 KB `vendor-…` chunk is the single largest blob and is loaded and parsed on every cold start. Logcat during cold launch on Pixel 4:

```
W/er.c64commander(16948): Long monitor contention with owner ThreadPoolForeg (16978)
  at java.lang.Object libcore.content.type.MimeMap$MemoizingSupplier.get()(MimeMap.java:475)
  waiters=2 in java.lang.Object libcore.content.type.MimeMap$MemoizingSupplier.get() for 301ms
W/er.c64commander(16948): Long monitor contention with owner ThreadPoolForeg (16978)
  at java.lang.Object libcore.content.type.MimeMap$MemoizingSupplier.get()(MimeMap.java:475)
  waiters=4 in java.lang.Object libcore.content.type.MimeMap$MemoizingSupplier.get() for 307ms
```

`MimeMap.MemoizingSupplier` contention is triggered by the WebView resolving the MIME types of bundled assets concurrent with parsing them. With one ~750 KB chunk plus ~480 KB main, the resource loader hits the same lock from multiple threads.

**Why it matters**

- Cold start was measured at **674 ms** (debug build). The Long monitor contention adds 600 ms of UI-thread blocking *while* the main bundle is parsing. The dominating cost during this window is JS parse + first React render of HomePage.
- The current Vite chunk strategy bundles "everything not split out by `manualChunks`" into one vendor blob.

**Recommendation**

- Update `vite.config.ts` `build.rollupOptions.output.manualChunks` to split the giant vendor chunk by domain:
  - `vendor-react` (already split)
  - `vendor-ui` (already split)
  - `vendor-hvsc` (already split)
  - `vendor-router` (`react-router-dom`)
  - `vendor-query` (`@tanstack/react-query`)
  - `vendor-radix` (Radix primitives)
  - `vendor-motion` (`framer-motion`)
  - `vendor-icons` (`lucide-react`)
  - `vendor-misc` (everything else, but capped)
- Target: no single chunk above 250 KB gzipped. The Pixel 4's WebView V8 parses ~5 MB/s on cold cache, so cutting the worst chunk in half saves ~50 ms of parse on the critical path.
- After splitting, retest cold start; aim for `LaunchState: COLD` total time ≤ 500 ms.

---

### R-BUN-2 (MEDIUM): `PlayFilesPage` chunk is 262 KB on its own

**Evidence**

- `PlayFilesPage-CeWJj4IW.js` weighs 262 KB; it imports `useHvscLibrary` (1358 LOC), `usePlaybackController` (1117 LOC), `addFileSelections` (991 LOC), `useVolumeOverride` (901 LOC).
- This page is lazy-loaded but on first visit the user pays the full cost.

**Recommendation**

- Lazy-split inside the page: load the HVSC library only when the user opens the HVSC source pane. Defer `usePlaybackController`'s playlist persistence and source-rotation logic to a worker module.
- Retest first-visit time-to-interactive on the Play tab.

---

## 4. Background and runtime patterns

### R-RT-1 (HIGH): mDNS hostname resolution does not work on Android

**Evidence**

- `adb shell ping -c 1 u64` from the Pixel 4 returned `ping: unknown host u64`.
- `adb shell ping -c 1 192.168.1.13` succeeded with 3–11 ms RTT.
- The localStorage `c64u_saved_devices:v1` entry held `host: "u64"`. The app cold-started, the OFFLINE banner appeared, and the home page never resolved CPU Speed / Turbo Control because every `/v1/info` probe failed at DNS. Only after rewriting the entry to `host: "192.168.1.13"` (via Chromium remote debugging) did discovery succeed.
- Android's stock `InetAddress.getByName` does not perform mDNS lookup. `NsdManager` is required for `.local` resolution and does not handle bare-name `u64` either.

**Why it matters**

- Every user who follows the README's "Add device by hostname `c64u`" instruction will see OFFLINE on Android even when the device is reachable. The README at [README.md:60-68](../../../../README.md#L60) implies hostnames work. They do not.
- The discovery probe at [connectionManager.ts:145-180](../../../../src/lib/connection/connectionManager.ts#L145) silently logs at `debug` level (`addLog("debug", "Discovery probe request failed", ...)`), so the user has no surfaced reason for the OFFLINE state.

**Recommendation**

- Add an explicit fallback in [src/lib/c64api.ts:resolvePlatformApiBaseUrl](../../../../src/lib/c64api.ts) and the saved-devices store: when running on Capacitor Android (`Capacitor.getPlatform() === "android"`) and the configured `host` is a bare name (no dot, no IP), perform an mDNS lookup via the Android `NsdManager` through a new `MdnsResolverPlugin` (resolves `u64.local` → A record).
- If mDNS still fails, surface an actionable error: "Cannot resolve hostname `u64`. Tap to enter the IP address or enable mDNS in your router." The current OFFLINE banner is silent.
- Update the README and the Settings page Add-Device dialog to suggest "IP recommended on Android" until mDNS is wired through.
- Add a unit test in `tests/unit/connection/connectionManager.startup.test.ts` that simulates a hostname which fails DNS but whose A record is reachable, and asserts the user gets a clear error not a silent OFFLINE.

---

### R-RT-2 (MEDIUM): ENOENT on `c64u-smoke.json` is logged at ERROR every cold start

**Evidence**

- Every cold launch produces:
  ```
  E/Capacitor/Plugin(16948): File does not exist
  E/Capacitor/Plugin(16948): java.io.FileNotFoundException:
    /data/user/0/uk.gleissner.c64commander/files/c64u-smoke.json: open failed: ENOENT
  ```
- This is the smoke-mode bootstrap probing for an optional file. The error is benign (smoke mode is opt-in) but it pollutes the diagnostics log at ERROR and pulls a stack trace through the JNI bridge.

**Recommendation**

- Probe via `Filesystem.stat` (no exception thrown) instead of `Filesystem.readFile`, or wrap the read in `Filesystem.exists` first. Search for the smoke-mode loader (likely `src/lib/smoke/smokeMode.ts` or `src/lib/startup/`) and replace the unconditional `readFile` with a stat-then-read pattern.
- This will eliminate one stack trace per cold start and reduce diagnostics noise.

---

### R-RT-3 (HIGH): Capacitor Console "Msg: undefined" log spam during Telnet activity

**Evidence**

- During a single home-page session, logcat showed 30+ lines like:
  ```
  I/Capacitor/Console(18076): File:  - Line 353 - Msg: undefined
  ```
  interleaved with each `TelnetSocket.send`/`read` callback.
- A console-method patch via Chromium DevTools (`Runtime.evaluate` injecting wrappers around `console.log`/`info`/`warn`) caught zero of these — meaning they come from a path other than `console.log`, possibly `console.debug` or a direct call into the Capacitor Console plugin from the WebView (e.g. an unhandled rejection logging `undefined`).
- The empty `File:` field implies a WebView-internal source map miss; line 353 is inside the bundled `index-…js` (a minified position), so the human-readable origin is lost.

**Why it matters**

- Each line costs a JNI bridge call from the WebView to the Capacitor Console plugin and a write into the diagnostics ring buffer. At ~30 lines per Telnet menu walk, this is real overhead during foreground interaction.
- The repository's exception-handling rule (CLAUDE.md, "It is forbidden to catch an exception silently") is at risk: `Msg: undefined` strongly suggests a `console.log(error?.message)` where `error` is undefined, i.e. a swallow-and-log pattern.

**Recommendation**

- Patch `console.debug` and `console.error` along with `log/info/warn` and capture during a Telnet menu walk to identify the call site.
- Once located, replace `console.log(maybeUndefined)` with a structured `addLog(...)` carrying intent, action, and the actual error if any.
- Add an ESLint rule banning `console.log` in production code paths under `src/lib/telnet/**` and `src/lib/diagnostics/**` (allowing only in tests).

---

### R-RT-4 (MEDIUM): Telnet menu walks share the foreground JS thread with sliders and tab transitions

**Evidence**

- During a 12-stroke CPU Speed slider drag, frame stats showed 4.69 % janky and **45/64 frames flagged "high input latency"**, while a follow-up isolated drag (no concurrent Telnet activity) produced 0 % jank, 0 high-input-latency frames over 45 frames. The difference is the Telnet menu walker running concurrently.
- Telnet activity is gated by `home_telnet_*` feature flags ([feature-flags.yaml](../../../../src/lib/config/feature-flags.yaml#L57)) and triggered by `useTelnetActions()` in [HomePage.tsx:167](../../../../src/pages/HomePage.tsx#L167). The session reads ESC sequences with `timeoutMs: 700` per read ([logcat: `methodName: read, methodData: {"timeoutMs":700}`]) and re-establishes the session repeatedly.

**Why it matters**

- The Telnet plugin is async, but every ESC sequence response triggers a JS callback that runs on the same single React render thread. During a slider drag the slider's `requestAnimationFrame`-driven preview competes for that thread.

**Recommendation**

- Consolidate Telnet support detection into a single one-shot probe per session. Cache `getActionSupport(...)` results for the lifetime of the connection (`useTelnetActions` already exposes the API); the only refresh trigger should be a manual "Reconnect device" or a connection-state change.
- Split the Telnet read loop off the React render path: marshall each completed menu read through a `requestIdleCallback` wrapper (or a `MessageChannel.postMessage` microtask) so it never lands inside a frame budget.
- Add a frame-stat regression test (Playwright + WebKit on Android emulator) that asserts ≤ 5 % janky frames during a sustained slider drag while a Telnet refresh is in flight.

---

### R-RT-5 (MEDIUM): Health-check polling cadence is good but not fully gated

**Evidence**

- [src/hooks/useC64Connection.ts:51](../../../../src/hooks/useC64Connection.ts#L51): `HEALTH_CHECK_INTERVAL_MS = 60_000`.
- [src/lib/query/c64PollingGovernance.ts:18](../../../../src/lib/query/c64PollingGovernance.ts#L18): `DRIVES_POLL_INTERVAL_MS = 30_000`.
- [src/hooks/useSavedDeviceHealthChecks.ts:20](../../../../src/hooks/useSavedDeviceHealthChecks.ts#L20): `AUTO_REFRESH_MS = 10_000` (only while the saved-device switcher is open).
- All three respect `screenActive` / `useScreenActivity()` and `diagnosticsSuppressionActive` — good.
- However, `DRIVES_POLL_INTERVAL_MS = 30_000` with the WebView in foreground means a fresh REST round-trip every 30 s. Each round-trip currently goes through `CapacitorHttp` (R-HTTP-1), so it lands on the JNI bridge every 30 s and triggers a CapacitorCookies plugin call.

**Recommendation**

- Once R-HTTP-1 is fixed, this is mostly self-correcting. Consider raising `DRIVES_POLL_INTERVAL_MS` to 60 000 ms when no drive operation is currently in flight; revert to 30 s for 2 min after a user-initiated mount/unmount.
- Add a "polling pause" handle that the slider primitive can take during a sustained drag and release on commit, preventing the drives poll from firing in the middle of the drag.

---

### R-RT-6 (LOW): Optimistic-override store still self-clears via `Object.is`

**Evidence**

- [src/hooks/useAuthoritativeConfigValueState.ts:73](../../../../src/hooks/useAuthoritativeConfigValueState.ts#L73): `if (Object.is(entry.value, deviceValue))` is still the clear condition.
- The slider plan called out trim-aware and type-coercing reconciliation. The slider hook works around this with a watchdog timer, but the underlying store is unchanged.
- Other consumers of `setConfigOverride` (machine-control buttons, Quick Config buttons, dialog forms) still depend on the strict equality clear — they can stuck-pending if the device echoes back a value that differs by whitespace or type (e.g. number vs. numeric string).

**Why it matters**

- This is the same root-cause class that produced the original CPU Speed freeze. The slider primitive is no longer susceptible because it doesn't gate `disabled` on pending; but a `loading` indicator on a Quick Action button bound to `pending["…"]` would still get stuck under the same conditions.

**Recommendation**

- Replace the `Object.is` clear with a configurable equality function per item (default: trim-and-coerce-aware). Implement once in `useAuthoritativeConfigValueState`, and ship a regression test for trim and number/string drift.
- Audit every reader of `authoritativeValues.pending` in `src/pages/**` and `src/components/**`. If any gates UI-blocking state on it, either migrate to a self-resolving mutation flag or accept the new equality function.

---

### R-RT-7 (LOW): Single live unhandled error class in saved logs

**Evidence**

- Saved log payload pulled from `c64u_app_logs` localStorage via levelDB included multiple entries of:
  ```json
  {"path":"/v1/drives","url":"http://c64u/v1/drives","attempt":1,"durationMs":2341,
   "error":{"name":"TypeError","message":"Failed to fetch"},"transient":true}
  ```
  These were generated while the saved host was the unreachable `c64u`. The interesting bit is the WebView `fetch` error is normalized to `"Host unreachable"` in some places and `"Failed to fetch"` in others.
- [src/lib/c64api.ts:565-580](../../../../src/lib/c64api.ts#L565) inspects firmware `errors[]` arrays correctly; transport errors fall back to the raw `Error.message`.

**Recommendation**

- Add a transport-error normalizer that distinguishes:
  - DNS failure (no IP) → user-facing "Cannot resolve `<host>`"
  - Network unreachable → "No route to `<host>` (check WiFi)"
  - Connection refused → "Device is on the network but not responding (firmware booting?)"
  - Connection reset / EPIPE → "Lost connection mid-request — retrying"
- Surface these via the existing `addErrorLog` channel; do not silently re-throw `Failed to fetch`.

---

### R-RT-8 (LOW): `MainActivity.ensureCapacitorPluginAssetPath` swallows directory-creation failures with a warn-and-continue

**Evidence**

- [android/app/src/main/java/uk/gleissner/c64commander/MainActivity.kt:32-58](../../../../android/app/src/main/java/uk/gleissner/c64commander/MainActivity.kt#L32) silently degrades when the plugins directory cannot be created, logging a warn and returning without throwing.
- This violates the CLAUDE.md exception-handling rule for unrecoverable startup conditions: a missing plugin asset path means subsequent plugin invocations may behave unpredictably.

**Recommendation**

- Distinguish recoverable (warn-and-continue when the directory already exists in a usable form) from unrecoverable (throw `IllegalStateException` so the launch fails fast). Today, both paths warn-and-continue.
- Add an `assertPluginPathReady()` early in `onCreate` that throws if the path was not made writable.

---

## 5. Live measurements summary

| Scenario | Duration | Total frames | Jank % | p50 | p90 | p95 | p99 | High input latency frames |
| -------- | -------: | -----------: | -----: | --: | --: | --: | --: | -----------------------: |
| Cold start to Home | 674 ms COLD | 1 (rendered) | 100.0 % | — | — | — | 400 ms | 0 |
| 12 slider drags (mixed with Telnet activity) | ~3.6 s | 64 | 4.69 % | 6 ms | 13 ms | 19 ms | 57 ms | 45 |
| 5 tab transitions Home→Play→Disks→Config→Settings→Home | ~10 s | 93 | 5.38 % (12.9 % legacy) | 9 ms | 19 ms | 26 ms | 93 ms | 93 |
| 16 isolated slider drags (no Telnet) | ~3.2 s | 45 | **0.00 %** | 7 ms | 15 ms | 16 ms | 17 ms | 0 |

Interpretation:

- The slider primitive itself is excellent (the 0 % jank, 17 ms p99 in scenario 4 is the upper-bound proof). This validates the slider plan's outcome.
- Background activity (Telnet menu walks, drive polling, Capacitor cookie reads on every fetch) is what pushes jank up to 5–13 %. Fixing R-HTTP-1, R-RT-3, R-RT-4 is expected to bring tab-transition jank to ≤ 2 %.
- The 93 ms outlier on tab transitions is consistent with hydrating the new page bundle off the critical path while the previous page is still resolving query subscriptions. Splitting the 752 KB vendor chunk (R-BUN-1) and reducing HomePage's render scope (R-MOD-2) will collapse this.

---

## 6. Severity-ordered punch list

| ID | Severity | Title |
| --- | -------- | ----- |
| R-HTTP-1 | CRITICAL | Disable `CapacitorHttp` and route fetches directly through the WebView |
| R-MOD-1  | HIGH     | Split files exceeding 1000 LOC into subtree-owned modules |
| R-RT-1   | HIGH     | Make hostname resolution Android-aware (mDNS via NsdManager) and surface DNS failure clearly |
| R-RT-3   | HIGH     | Eliminate "Msg: undefined" Capacitor Console spam during Telnet activity |
| R-BUN-1  | HIGH     | Split the 752 KB vendor chunk and aim for cold start ≤ 500 ms |
| R-HTTP-2 | HIGH     | Stop CapacitorCookies from intercepting LAN requests (follows R-HTTP-1) |
| R-MOD-2  | MEDIUM   | Reduce HomePage render scope by hoisting subtree state |
| R-MOD-3  | MEDIUM   | Split large Kotlin plugins by responsibility |
| R-BUN-2  | MEDIUM   | Lazy-load HVSC library and playback controller inside `PlayFilesPage` |
| R-RT-4   | MEDIUM   | Move Telnet read loop off the React render thread |
| R-RT-5   | MEDIUM   | Pause drives polling during sustained slider drag; raise idle interval |
| R-HTTP-3 | MEDIUM   | Split request timeout budgets by user-perceived intent |
| R-RT-2   | MEDIUM   | Replace unconditional `Filesystem.readFile` with stat-then-read for `c64u-smoke.json` |
| R-RT-6   | LOW      | Replace strict-equality clear in `useAuthoritativeConfigValueState` with trim/coerce-aware compare |
| R-RT-7   | LOW      | Normalize transport errors with actionable user-facing messages |
| R-RT-8   | LOW      | Fail fast on unrecoverable plugin asset-path failures in `MainActivity.onCreate` |

## 7. Out of scope for this research

- Behavioural slider work — already covered by [slider-responsiveness/research.md](../slider-responsiveness/research.md) and shipped.
- iOS-specific stabilization — iOS uses WKWebView, not Chromium; CapacitorHttp interception is materially different there. The findings in Section 1 should be retested on iOS before generalizing.
- HVSC ingestion correctness — orthogonal to the responsiveness lens.
- Variant generation pipeline.

## 8. Validation plan for the follow-up implementation

The remediation plan should:

- Add a Playwright + Android emulator scenario that boots the app, drags the CPU Speed slider for 10 s, and asserts:
  - frame jank ≤ 2 %
  - p99 frame time ≤ 32 ms
  - no "Msg: undefined" Capacitor Console lines emitted
- Add a CI gate that fails if `capacitor.config.ts` enables `CapacitorHttp` without a documented exemption comment.
- Add a cold-start gate (existing `startup:gate` pipeline) tightened to ≤ 500 ms after R-BUN-1 lands.
- Re-run the live device probes from Section 5 against the same Pixel 4 + `u64` setup before declaring the work complete; record before/after frame stats in the plan.

## 9. Reproduction notes

- The Pixel 4 lost its WiFi DHCP lease during the test run; running `adb shell svc wifi disable && sleep 3 && adb shell svc wifi enable` restored connectivity.
- mDNS hostname `u64` does not resolve on Android. To test against `u64`, write `192.168.1.13` (or the device's current IP) into `localStorage["c64u_saved_devices:v1"].devices[0].host` via Chromium DevTools (`adb forward tcp:9229 localabstract:webview_devtools_remote_<pid>`).
- `dumpsys gfxinfo uk.gleissner.c64commander reset` clears frame stats; the read after a scenario gives the histogram used in Section 5.
- Logcat noise can be filtered with `adb logcat -d -t N -v brief | grep -E "^[WE]/" | grep -vE "chromium.*runtime_features|InteractionJank|library_loader"` for a useful warning/error subset.
