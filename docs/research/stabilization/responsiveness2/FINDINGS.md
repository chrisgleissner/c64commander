# FINDINGS — Stabilization Refuel (Stage 1)

Investigation 2026-05-17 on branch `feat/reduce-latency-and-fix-errors`. Evidence under `evidence/`.

Each finding follows the root-cause format. Confidence: **High** = direct code + runtime evidence; **Medium** = direct code, runtime evidence indirect; **Low** = code suspicion, runtime evidence pending.

---

## F-DIAG-1 (CRITICAL, Confidence: High) — Saved-device background probes cross-contaminate the active device's health rollup

- **Symptom**: With u64 (192.168.1.13) as the active device, the badge spontaneously flips from `U64 HEALTHY` to `U64 ▲ 3 DEGRADED` even when u64 itself is responding to every REST/Telnet/FTP request within ~20 ms.
- **Reproduction**: Launch app cold → wait ~60 s with no user interaction → open Diagnostics dialog. Activity tab lists REST `GET 192.168.1.167 /v1/machine:readmem?...` and Telnet connect to 192.168.1.167 — c64u IP, not u64. Badge shows DEGRADED.
- **Device**: Active u64, saved c64u. Both devices, both saved.
- **Platform**: Android Pixel 4, but root cause is shared TypeScript code.
- **Evidence**:
  - `evidence/diagnostics-dialog.png` — badge `U64 ▲ 3 DEGRADED`, dialog header `u64 · Unknown`, Activity shows `GET 192.168.1.167 /v1/machine:readmem?address=00A2&len...` at 21:21:27.
  - `evidence/logcat-coldstart-u64.txt` and follow-on logcat show repeated `CapacitorHttp` and `TelnetSocket` calls to `192.168.1.167` while active device is u64 (192.168.1.13).
- **Suspected root cause**: `useSavedDeviceHealthChecks` (`src/hooks/useSavedDeviceHealthChecks.ts:326`) schedules `runCycle` every 10 s (`AUTO_REFRESH_MS = 10_000`) over **all** saved devices. Each cycle runs full probes (REST + FTP + TELNET + CONFIG + RASTER + JIFFY) against every saved device. The contributor windows in `healthModel.ts` (`deriveRestContributorHealth`, `deriveFtpContributorHealth`, `deriveTelnetContributorHealth`) filter trace events only by event TYPE — never by device host or device identity. Therefore probes against a non-active saved device feed the active device's 5-minute rollup and can push the badge to Degraded/Unhealthy.
- **Confidence**: High.
- **Code paths**:
  - `src/hooks/useSavedDeviceHealthChecks.ts:32` `AUTO_REFRESH_MS = 10_000`
  - `src/hooks/useSavedDeviceHealthChecks.ts:315-335` `setInterval` + `runCycle(false)` loop
  - `src/lib/diagnostics/healthModel.ts:294-312` `restHealthWindowEvents`, `ftpHealthWindowEvents`, `telnetHealthWindowEvents` — no target-host filter
  - `src/lib/diagnostics/healthCheckEngine.ts` `recordTelnetOperation`, `traceFormatter.ts` — events written into shared trace ring buffer without per-device segmentation
- **Why not cosmetic**: Diagnostics is the trust contract. False DEGRADED states devalue every other diagnostic, and the user cannot tell whether the active device or a saved-but-inactive device is actually failing.
- **What a root fix likely requires**:
  1. Trace events must carry a stable `deviceId` (or normalized host) field. Update `traceSession.ts` recorders and any code that creates `rest-response`, `ftp-operation`, `telnet-operation`, `error` events to include `data.deviceId`.
  2. `deriveRestContributorHealth`, `deriveFtpContributorHealth`, `deriveTelnetContributorHealth`, `deriveAppContributorHealth` must accept the active deviceId and filter the input window.
  3. `useSavedDeviceHealthChecks` cycle frequency for inactive devices must be reduced (e.g. 60 s) AND its results must be scoped to that device's per-device snapshot, not the global rollup.
- **Tests required**:
  - Unit: failures in events for `deviceId = "c64u"` must NOT change contributor health for `deviceId = "u64"`.
  - Integration: simulating one saved device unreachable while the other is healthy must keep the active device's badge HEALTHY.

---

## F-DIAG-2 (HIGH, Confidence: High) — REST contributor window uses asymmetric trim (`firstSuccessIndex`) vs FTP/TELNET (`findLastIndex`)

- **Symptom**: After a transient REST failure (e.g. one timeout), the REST contributor stays Degraded for up to 5 minutes even after dozens of subsequent successful REST calls. FTP and Telnet do not exhibit the same lag.
- **Reproduction (code)**: Inspect `src/lib/diagnostics/healthModel.ts:294-298`:
  ```ts
  const restHealthWindowEvents = (events) => {
    const windowEvents = events.filter((e) => e.type === "rest-response" && isInCurrentWindow(e));
    const firstSuccessIndex = windowEvents.findIndex(isSuccessfulRestResponse);
    return firstSuccessIndex >= 0 ? windowEvents.slice(firstSuccessIndex) : windowEvents;
  };
  ```
  Compare with FTP/TELNET at lines 300-312 which use `trimToLatestSuccess(... findLastIndex)`.
- **Evidence**: Prior root PLANS.md (2026-05-13) already noted the same "Degraded after recovery" symptom on REST. The asymmetry is now visible in the code.
- **Confidence**: High.
- **Suspected root cause**: The REST helper trims from the first success and keeps every subsequent failure, but FTP/TELNET trim from the last success and drop everything before it. This is either an intentional defensive policy for REST (because REST is the heartbeat) or a copy-paste defect. The behaviour is undocumented.
- **What a root fix likely requires**: Decide whether REST should also trim from latest success (then all three contributors converge), or if REST must keep failures-since-first-success, document why and add a unit test that locks in the rationale. Either way, fix the cross-protocol asymmetry that produces user-confusing "FTP went green but REST still red after recovery" states.
- **Tests required**:
  - Unit: rest contributor after `[fail, fail, success, fail, success]` should equal what the chosen policy specifies; lock that policy in.

---

## F-DIAG-3 (HIGH, Confidence: High) — App contributor goes Degraded on a single transient error

- **Symptom**: Any single error trace event makes `deriveAppContributorHealth` return `Degraded` with `problemCount: 1` for the full 5-minute window.
- **Reproduction**: `src/lib/diagnostics/healthModel.ts:375-387` — `total === 0 → Idle`, `total >= 5 → Unhealthy`, else (`1..4`) → `Degraded`. No "must be sustained or recent" filter.
- **Evidence**: Common sense + the badge showing DEGRADED after very short idle windows. The "App" contributor often dominates because it has no ratio gate.
- **Confidence**: High (code-level).
- **What a root fix likely requires**: Replace the integer threshold with either (a) "Degraded only if ≥ N errors in last 60 s" (recent-window inside the 5-min window) or (b) a ratio-based rule consistent with REST/FTP/TELNET. Whichever wins must be documented and tested.

---

## F-CONN-1 (HIGH, Confidence: High) — `OFFLINE` badge persists ~10–15 s after launch despite successful REST traffic

- **Symptom**: On cold launch the badge shows `OFFLINE` and Home page shows `Device: Not connected, Firmware: Not connected` for 10–15 s while the very first config-tree REST reads against the active device's IP succeed (HTTP 200, <30 ms).
- **Reproduction**: `am force-stop` then `am start` → first screenshot ~5 s after launch shows OFFLINE; another at ~12 s still OFFLINE; ~25 s shows HEALTHY.
- **Evidence**:
  - `evidence/home-screenshot.png` (OFFLINE, "Not connected") taken seconds after launch.
  - `evidence/home-screenshot-2.png` (OFFLINE, 5–6 s later, still "Not connected").
  - `evidence/home-screenshot-3.png` (HEALTHY, "u64 3.14e") after wait.
  - `evidence/logcat-coldstart-u64.txt` shows `CapacitorHttp` calls to `http://192.168.1.13/v1/configs/...` returning 200 starting at +1.7 s.
- **Suspected root cause**: `connectionManager.discover('startup')` runs its `probeOnce` cycle independently of the React Query config reads. The first successful config-tree response is **not** treated as evidence of REAL_CONNECTED; only the dedicated `/v1/info` probe transitions the state, and that probe waits its own scheduling slot (`STARTUP_PROBE_INTERVAL_MS = 700` and `loadStartupDiscoveryWindowMs()` reapply delays). Until the probe succeeds, `ConnectionState` stays `DISCOVERING` (which maps to "Checking") or `OFFLINE_NO_DEMO`.
- **Confidence**: High (badge state, logcat, code).
- **Code paths**:
  - `src/lib/connection/connectionManager.ts:59` `STARTUP_PROBE_INTERVAL_MS = 700`
  - `src/lib/connection/connectionManager.ts:357-400` `probeOnce`
  - `src/hooks/useC64Connection.ts:226-229` `isConnected = state === REAL_CONNECTED || DEMO_ACTIVE`
- **What a root fix likely requires**:
  - Either (a) gate the first `/v1/info` probe on the same shared abort signal as the config-tree boot reads so it shares the first cold-network warmup, or
  - (b) opportunistically promote `OFFLINE_NO_DEMO` → `REAL_CONNECTED` when any normal REST call to the active device returns success (no need to wait for the next dedicated probe), or
  - (c) make the badge reflect "Checking" instead of "OFFLINE" until the first probe has actually failed (current logic over-claims OFFLINE during DISCOVERING in some paths).
- **Tests required**: Integration test that drives discovery + first config read in parallel and asserts the badge does not show OFFLINE while the active device is responding.

---

## F-CONN-2 (MEDIUM, Confidence: High) — Home page "Device / Firmware" meta row sticks at "Not available" on warm restart even after badge is HEALTHY

- **Symptom**: After warm-restarting the app (`am start` while running), the badge eventually shows `U64 HEALTHY`, but the Home page meta row `Device: Not available  Firmware: Not available` does not update.
- **Evidence**: `evidence/home-warm.png` — badge HEALTHY but `Device: Not available  Firmware: Not available`.
- **Suspected root cause**: The Home page meta row reads from a different state slice than the badge — likely from `deviceProduct`/`deviceFirmware` on a React Query cache that is invalidated on cold start but not on warm-restart. Need to check `src/pages/HomePage.tsx` and `useC64Connection` to confirm.
- **Confidence**: High symptom, Medium on root cause until that hook is read.
- **What a root fix likely requires**: Ensure that when the connection state flips to `REAL_CONNECTED` and `/v1/info` returns a `DeviceInfo`, the Home page meta row consumes that snapshot. If the meta row hangs off a separate query, invalidate that query when REAL_CONNECTED transitions.

---

## F-CONN-3 (MEDIUM, Confidence: Medium) — Diagnostics dialog header shows `u64 · Unknown` despite known firmware

- **Symptom**: Diagnostics dialog header reads `u64 · Unknown` while the home page badge reads `u64 3.14e`. The "Unknown" appears to be the device-product slot.
- **Evidence**: `evidence/diagnostics-dialog.png`.
- **Suspected root cause**: `DiagnosticsDialog.tsx` derives the header label from the saved-device snapshot, which may not carry `product` when the device-bound probe last succeeded. Needs a read of the dialog source.
- **What a root fix likely requires**: Ensure the saved-device per-device snapshot carries `deviceInfo.product` and that the dialog falls back to the live `/v1/info` cache when the snapshot is stale.

---

## F-HTTP-1 (HIGH, Confidence: High) — CapacitorCookies plugin still emits per-request "Getting cookies at:" hop despite `CapacitorCookies.enabled: false`

- **Symptom**: Every `CapacitorHttp` request to the device IP logs an `I CapacitorCookies: Getting cookies at: 'http://192.168.1.13/...'` line on Pixel 4.
- **Evidence**: `evidence/logcat-coldstart-u64.txt`, lines at 21:18:25.762, .921, .992, etc. Capacitor config explicitly sets `CapacitorCookies.enabled: false`.
- **Suspected root cause**: Either (a) the Capacitor plugin still includes Cookies as a hard dependency of CapacitorHttp on Android regardless of the per-plugin `enabled` flag, (b) the disable only applies to the JS-side cookie shim (not the Java side's JNI hop), or (c) `cap sync` did not regenerate `capacitor.config.json` with the new value. Logcat confirms `D Capacitor: Registering plugin instance: CapacitorCookies` at boot, so the plugin is still active.
- **Confidence**: High symptom (live logs), Medium-to-High on root cause.
- **What a root fix likely requires**:
  1. Confirm whether `android/app/src/main/assets/capacitor.config.json` actually has `"CapacitorCookies": { "enabled": false }`. If yes, examine whether CapacitorHttp explicitly invokes `CookieManager.getCookie(...)` on every URLConnection and short-circuit that path.
  2. If a true disable is not honored by Capacitor, file a release blocker against the plugin and route around it (e.g. native `XMLHttpRequest` for hot reads with no cookies).
- **Why not cosmetic**: This is per-request JNI overhead on every REST call. Pages that fan out 10+ config reads on first paint accumulate measurable latency.

---

## F-HTTP-2 (HIGH, Confidence: High) — Cold-boot LED Strip + Keyboard Lighting config-tree storm issues 9+ sequential CapacitorHttp calls before steady state

- **Symptom**: Logcat shows 9 sequential `Handling CapacitorHttp request: ... /v1/configs/LED Strip Settings/*` and `/v1/configs/Keyboard Lighting` calls in ~700 ms at cold boot, then a stragger at +3 s.
- **Evidence**: `evidence/logcat-coldstart-u64.txt` (timestamps 21:18:25.717 to 21:18:29.204).
- **Suspected root cause**: The Home page's Lighting/SID/Quick Config sections each fetch their own subset of LED Strip Settings keys with no batching. `getConfigItems(category, items, options)` exists for batching but the boot fan-out doesn't seem to use it for these sections.
- **What a root fix likely requires**: Batch the cold-boot config reads. The C64U REST API supports the `?include=...` shape used elsewhere; if not, the API client already has `getConfigItems(category, items)` which does a single bulk read per category. Wire those into the Home page hot path.

---

## F-LOG-1 (MEDIUM, Confidence: High) — Repeated `I Capacitor/Console: File:  - Line 353 - Msg: undefined` log spam during Telnet activity

- **Symptom**: For every Telnet send/read tick (≈ 5–10 per Telnet probe), one `Msg: undefined` line is emitted to logcat. With saved-device probes every 10 s, this is ≥ 30 log lines/min of noise.
- **Evidence**: Logcat in `evidence/logcat-slider-stress.txt` (and inline transcripts) shows `I Capacitor/Console: File:  - Line 353 - Msg: undefined` repeated.
- **Suspected root cause**: A `console.log(...)` (or `console.info(...)`) is being invoked with `undefined` as the first argument from a post-bundling code path (possibly an ESLint-untouched file outside `src/lib/telnet/**` and `src/lib/diagnostics/**`). The empty `File:` field is consistent with code injected by Capacitor's web view bridge or a tagged template. Note: prior research recommended an ESLint rule banning `console.log` in those folders; that rule is currently absent (`eslint.config.js` lacks the prohibition).
- **What a root fix likely requires**:
  1. Add a `no-console` ESLint rule for `src/lib/telnet/**` and `src/lib/diagnostics/**` (allowing only `console.warn`/`console.error` for the bridge) — and run it across the source.
  2. Add a `disableConsoleLogInProduction` shim in `src/main.tsx` that overrides `console.log` in production builds.
  3. Find and remove the actual culprit: search bundled output sourcemaps for "Line 353" callers, or instrument `console.log` in dev mode to log the call stack.
- **Why not cosmetic**: Noise floor obscures real errors; high log-frequency in Android logcat is non-zero CPU and battery cost.

---

## F-LOG-2 (HIGH, Confidence: High) — `Uncaught TypeError: Cannot read properties of undefined (reading 'triggerEvent')` at cold boot

- **Symptom**: `E Capacitor/Console: File: http://localhost/ - Line 1 - Msg: Uncaught TypeError: Cannot read properties of undefined (reading 'triggerEvent')` at +0.5 s after WebView load, before chunks finish loading.
- **Evidence**: `evidence/logcat-coldstart-u64.txt` line at 21:18:24.115.
- **Suspected root cause**: A Capacitor bridge consumer is reading `something.triggerEvent` where `something` is the `Capacitor` global before the bridge has finished initializing. Likely a registered plugin emitter (probably `DiagnosticsBridgePlugin`'s `notifyListeners` consumer) is invoked from an early `import` side effect.
- **What a root fix likely requires**: Defer all `notifyListeners` consumers behind `Capacitor.isReady` (or equivalent), and add a Vitest case that asserts the boot-time import graph does not synchronously read `Capacitor.triggerEvent`.

---

## F-RT-1 (MEDIUM, Confidence: Medium) — Saved-device 10 s background probes can hold the polling-pause registry against the user's slider drag

- **Symptom hypothesis**: `useDeviceBoundSlider` calls `pollingPauseRegistry.acquirePause()` on the first drag tick to silence drives/info polling. But saved-device health-check cycles do NOT subscribe to the same registry, so a slider drag that lands while a 10 s health-check cycle is mid-flight contends with the cycle's REST/Telnet/FTP traffic for CapacitorHttp/CapacitorCookies serialization, JNI, and main-thread bridge work.
- **Evidence**: Code review of `useSavedDeviceHealthChecks.ts` (no `pollingPauseRegistry` reference) + slider's pause acquisition path; not validated live this session because hardware `input swipe` failed to drive the slider deterministically.
- **What a root fix likely requires**: Make the saved-device health-check scheduler also subscribe to `pollingPauseRegistry`, so user drag/touch acquires a pause that suspends all background probes for the duration of the interaction.

---

## F-MIME-1 (MEDIUM, Confidence: High) — Long monitor contention on `MimeMap` adds ~370 ms during chunk load

- **Symptom**: Two log lines at cold boot: `W er.c64commander: Long monitor contention with owner ThreadPoolForeg ... at libcore.content.type.MimeMap$MemoizingSupplier.get()(MimeMap.java:475) waiters=2 in ... for 374ms`.
- **Evidence**: `evidence/logcat-coldstart-u64.txt`.
- **Suspected root cause**: Multiple WebView chunk loads request MIME type lookup concurrently; the Android `MimeMap` lazy initializer serializes. Prior research R-RT noted this as a side effect of the large vendor chunk.
- **What a root fix likely requires**: Either (a) prewarm `MimeMap` from `MainActivity.onCreate` off the UI thread, or (b) reduce the chunk count / size so fewer concurrent MIME lookups race for the lock.

---

## Open hypotheses (Confidence: Low) — pending live evidence

- **H-VOL-1**: Rapid mute → unmute → mute on Play page can land an out-of-order intermediate state if the device's audio mixer refetch races a third toggle. Not exercised live this session.
- **H-VOL-2**: `handleVolumeDraftChange` updates `manualMuteSnapshotRef.volumes` only when `target` and `snapshot` both exist; if the user drags the slider while muted and the snapshot was already cleared by a prior unmute settle, the new index is silently discarded.
- **H-PLAY-1**: `handleStop` reset/reboot timeout of 3 s vs Telnet/REST queue contention can cause `Stop failed` toasts when the device eventually resets fine.
- **H-RT-2**: `useC64Connection.isConnected` evaluates synchronously off `connection.state`; if a Capacitor visibility change triggers app paused/resumed close together (we saw `App started`, `App resumed`, `App paused`, `App stopped`, `App resumed` in the same second at boot) and the discovery probe was mid-flight, the state can remain `DISCOVERING` longer than needed.

These hypotheses must be validated during the stabilization stage with explicit reproductions.
