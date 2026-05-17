# WORKLOG — Stabilization Refuel Investigation (2026-05-17)

## Session: 2026-05-17

### Environment confirmed

- Repo `c64commander` on branch `feat/reduce-latency-and-fix-errors`, working tree clean (start of session).
- Pixel 4 attached: serial `9B081FFAZ001WX`, Android 16 SDK 35, IP 192.168.1.206.
- u64: 192.168.1.13 — Ultimate 64 Elite fw 3.14e, fpga 122, core 1.4B, unique_id `38C1BA`.
- c64u: 192.168.1.167 — C64 Ultimate fw 1.1.0, fpga 122, core 1.49, unique_id `5D4E12`.
- Both REST/Telnet/FTP ports reachable from dev host and from Pixel 4 by both bare hostname and IP.
- APK already installed on Pixel 4: `c64commander-0.7.9-rc1-debug.apk` (matches latest local build, lastUpdateTime 2026-05-15).

### Source-level inspection performed

- Slider primitive `src/hooks/useDeviceBoundSlider.ts` (359 LOC) — confirmed canonical use across Home/Config/Play sliders. Optimistic preview with throttle, watchdog 2 s, polling-pause registry coordination.
- Optimistic override store `src/hooks/useAuthoritativeConfigValueState.ts` (138 LOC) — trim-aware + numeric coercion equality, microtask-scheduled clear; OK.
- Latest-intent write lane `src/lib/deviceInteraction/latestIntentWriteLane.ts` — correct coalescing: rapid `.schedule()` collapses to the latest job, older pending jobs resolve when a later job's version reaches `settledVersion`.
- Interactive config write hook `src/hooks/useInteractiveConfigWrite.ts` — uses lane + `immediate: true`, `skipInvalidation: true`, debounced 250 ms reconciliation refetch. Looks correct.
- Volume hook `src/pages/playFiles/hooks/useVolumeOverride.ts` (908 LOC) — separate playback write lane, manual-mute snapshot logic, `lastManualWrite` 1500 ms window to ignore stale syncs. Multiple refs (manualMuteSnapshotRef, pauseMuteSnapshotRef, manualMuteIntentRef, resumingFromPauseRef, pausingFromPauseRef…) — sync effect is large with several explicit "do not overwrite" guards, but still vulnerable to ordering where one refetch races a pending write.
- Playback controller `src/pages/playFiles/hooks/usePlaybackController.ts` (1117 LOC) — `handleStop` issues `machineReboot` for disks and `machineReset` for everything else, both with 3 s timeout. `handlePauseResume` uses transition coordinator + retry on resume.
- Diagnostics engine `src/lib/diagnostics/healthCheckEngine.ts` (1857 LOC) + `healthModel.ts` (601 LOC):
  - REST contributor window trims **from FIRST success** in 5-minute window → old failures stay until they age out.
  - FTP and TELNET contributor windows trim **from LATEST success** → recent success clears history.
  - App contributor goes Degraded at total ≥ 1 in the 5-min window.
  - Contributor windows are NOT filtered by device target — events from ANY saved device feed the active device's badge.
- Saved-device health checks `src/hooks/useSavedDeviceHealthChecks.ts` — runs full health probes (REST + FTP + TELNET + CONFIG + RASTER + JIFFY) against **every** saved device every 10 s by default (`AUTO_REFRESH_MS = 10_000`).
- Capacitor config `capacitor.config.ts` — `CapacitorHttp.enabled = true` documented as load-bearing due to firmware lack of CORS. `CapacitorCookies.enabled = false`. Observed logcat **contradicts** the cookie disable: every CapacitorHttp request still logs `I CapacitorCookies: Getting cookies at: ...` per call.

### Device-side runtime evidence

- Cold start: TotalTime 643 ms (LaunchState COLD) on Pixel 4. (Prior baseline 674 ms.)
- MimeMap long monitor contention 369–374 ms during chunk load. (Same symptom as prior R-RT-* research.)
- `E Capacitor/Console: File: http://localhost/ - Line 1 - Msg: Uncaught TypeError: Cannot read properties of undefined (reading 'triggerEvent')` during cold boot before chunks finish loading.
- `Filesystem.stat({path: "c64u-smoke.json", directory: "DATA"})` returns "File does not exist" → handled, but error is still routed and observed.
- LED Strip config-tree fan-out at cold start: 9 sequential `CapacitorHttp` calls to LED Strip Settings / Keyboard Lighting / individual sub-items, spaced ~60–80 ms each, totalling ~700 ms of foreground request traffic before steady state. Even though the active device responds in <30 ms, request marshalling through CapacitorHttp + CapacitorCookies inflates that.
- Steady-state log shows `I Capacitor/Console: File:  - Line 353 - Msg: undefined` repeated for every Telnet send/read tick — repeating noise during HVSC/playback flows. Empty `File:` field implies the source is post-bundling code injected with no source.
- Home page Connection Status sequence observed:
  1. Just-after-launch (~5 s): badge shows `OFFLINE` and Device/Firmware say "Not connected", even though `CapacitorHttp` REST calls to 192.168.1.13 are firing successfully. Status takes 10–15 s to settle.
  2. After warm restart: badge eventually shows `U64 HEALTHY` but Device/Firmware can stay "Not available" indefinitely on the home page meta row.
  3. After ~60 s with no interaction: badge flipped to `U64 ▲ 3 DEGRADED`. Diagnostics dialog header showed `u64 · Unknown` (firmware label empty in header) with "263 of 1423 events".

### Diagnostics evidence

- Saved-device probes cross-contaminate active-device health. With u64 set as active, `CapacitorHttp` and `TelnetSocket` were observed targeting `192.168.1.167` (c64u IP). Because `deriveRestContributorHealth` / `deriveTelnetContributorHealth` filter only by event TYPE (not target host), c64u's probe events feed u64's REST/Telnet contributor windows and push the badge to Degraded.
- Telnet probe rapid open/connect/send/read/disconnect cycles per probe — each cycle does 6+ Capacitor plugin hops. Stress flows can stack these.
- Diagnostics dialog Activity tab shows recent REST `GET /v1/machine:readmem` calls — those are RASTER/JIFFY probes. They run from the active-device's health check (CONFIG pulse policy: visible-config-pulse-allowed for manual-diagnostics context, read-only for backgroundMaintenance — but the CONFIG/RASTER/JIFFY reads still fire).

### Slider stress

- Tried 10 quick adb `input swipe` events across the CPU Speed slider region (`100→950 x, y=670, 80 ms`). Did not visibly land write traffic in the captured logcat window (the swipes may have been registered as page scroll instead of slider drag because the slider thumb needs to be at a specific X position before the drag begins). The slider visual stayed at 1. Hardware swipe is a poor proxy for finger drag — a real slider stress requires per-touch events. Documented as test-method limitation, not as a finding.
- However, real human slider drags reportedly still feel laggy under sustained Telnet activity according to prior R-RT-* research — confirmed code path (`useDeviceBoundSlider`) is correct in shape, so latency is more likely in the transport layer (CapacitorHttp marshalling + cookie hop) and in saved-device background polling stealing main-thread time, not in slider primitive.

### Tasks marked done in PLANS.md

- All inspection tasks (#1–8) completed during this session.
- Remaining: FEATURE_INVENTORY.md, FINDINGS.md, DIAGNOSTICS_ROOT_CAUSE_MATRIX.md, RESPONSIVENESS_NOTES.md, STABILIZATION_PROMPT.md.
