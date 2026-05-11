# Android Real-Device Performance Investigation

## Executive Summary

- Real-device measurement on the Pixel 4 shows that the main measured app-side responsiveness problem is Android bare-hostname resolution during saved-device switching, not raw transport cost to a healthy device.
- When saved devices used bare hostnames, the existing switch soak failed 10/10 transitions with a `p50` of `14317 ms`. When the same saved devices were rebuilt to use resolved IPs, the healthy `u64` leg recovered to `p50 = 140 ms`, `p90 = 176 ms`.
- Direct Pixel 4 transport probes to `u64` were already fast: REST `27-33 ms`, config read `31-36 ms`, and Telnet connect `14-24 ms`.
- `c64u` is currently a split-health target: Telnet accepts TCP connects in `15-22 ms`, but REST `/v1/info` resets the connection in `17-161 ms`. That hardware/service instability must be tracked separately from app performance.
- The implementation plan therefore stays narrow:
  1.  remove Android hostname stalls from saved-device switching.
  2.  stop background health/reconciliation work from distorting the foreground path.
  3.  make Diagnostics lazy by default.
  4.  defer broader transport or architecture work unless those narrow fixes fail to hit target metrics.

## Scope

- Android-first responsiveness investigation against real `u64` and `c64u` hardware.
- Secondary safety check for web/iOS regression risk based on shared code paths.

## Non-Goals

- No broad refactors.
- No architectural redesign.
- No speculative cleanup.
- No request-pressure increase against device hardware.

## Device Setup

- Primary handset: Pixel 4, serial `9B081FFAZ001WX`.
- Preferred device target: `u64`.
- Secondary device target: `c64u`.
- Session host resolution:
  - `u64 = 192.168.1.13`
  - `c64u = 192.168.1.167`
- End-of-session device state:
  - restored the Pixel 4 to the normal debug APK `android/app/build/outputs/apk/debug/c64commander-0.8.2-debug.apk`.
  - relaunched `uk.gleissner.c64commander/.MainActivity`.

## Measurement Method

- Existing diagnostics trace events.
- Existing latency tracker percentiles.
- Existing saved-device switch metrics.
- Existing health-check probe durations.
- Android adb/logcat and direct device probes where necessary.
- Existing Android switch-soak harness: `node scripts/run-device-switch-soak.mjs --target=real --serial=9B081FFAZ001WX`.
- Direct Android-shell transport probes using `adb shell curl` and `adb shell nc -z`.
- Code-path inspection when direct measurement would have required invasive new instrumentation.

## Raw Measurement Summary

- Saved-device switch soak, bare-hostname build:
  - artifact: `docs/plans/performance/iteration1/switch-soak-real-android.json`
  - transitions: 10
  - successes: 0
  - failures: 10
  - summary: `min = 202 ms`, `p50 = 14317 ms`, `p90 = 14397 ms`, `max = 14445 ms`, `avg = 8170 ms`
  - notable failures: `c64u -> u64` legs repeatedly spent ~14.3 s in verification before resolving offline.
- Saved-device switch soak, IP-based build:
  - artifact: `docs/plans/performance/iteration1/switch-soak-real-android-ip.json`
  - transitions: 10
  - successes: 5
  - failures: 5
  - summary: `min = 69 ms`, `p50 = 140 ms`, `p90 = 176 ms`, `max = 226 ms`, `avg = 135 ms`
  - all residual failures were `u64 -> c64u` offline outcomes.
- Direct Pixel 4 transport probes:
  - `u64` REST `/v1/info`: 27, 28, 28, 28, 29, 31, 32, 32, 33, 27 ms.
  - `u64` config read `/v1/configs/U64 Specific Settings/CPU Speed`: 31, 32, 32, 32, 33, 34, 34, 34, 34, 36 ms.
  - `u64` Telnet TCP connect: 24, 14, 15, 14, 19 ms.
  - `c64u` REST `/v1/info`: 161, 24, 17, 18, 17 ms, all curl exit 56.
  - `c64u` Telnet TCP connect: 17, 15, 22, 17, 16 ms.
- Startup artifact:
  - artifact: `docs/plans/performance/iteration1/startup-baseline/startup-baseline.json`
  - observed `TTFSC p50 = 615 ms`, `p95 = 703 ms`
  - caveat: collected from a probe build that auto-launched the switch lab and therefore is not a valid production startup baseline.

## Key Findings

- Android bare-hostname resolution is the only measured factor large enough to explain the 14 s switch stall.
- Once the saved-device host was converted to an IP, the healthy `u64` switch path dropped into the same order of magnitude as the direct Android-shell transport probes.
- `u64` transport cost on the Pixel 4 is already low enough that broad network-transport refactors are not justified by this session’s evidence.
- `c64u` is not generically offline: its Telnet port is reachable and quick, but its REST endpoint is unhealthy. That makes it an independent lab/hardware issue and a separate regression axis.
- Diagnostics likely has a real open/render cost problem, but today’s evidence is architectural rather than stopwatch-based because there is no existing narrow open-latency marker.

## Ranked Bottlenecks

1. Android bare-hostname resolution in saved-device verification.
   - Evidence: bare-hostname soak `p50 = 14317 ms`; IP-based soak `p50 = 140 ms` with the same harness.
2. Foreground switch and diagnostics work competing with background saved-device health polling and reconciliation.
   - Evidence: `useSavedDeviceHealthChecks` runs on a 10 s cadence; Diagnostics open also triggers `runDiagnosticsReconciler` and `runPlaybackReconciler`.
3. Diagnostics overlay eager data derivation.
   - Evidence: `GlobalDiagnosticsOverlay` eagerly rebuilds logs/errors/traces/action summaries/export payloads; `DiagnosticsDialog` eagerly assembles and sorts a unified evidence list.
4. `c64u` REST instability.
   - Evidence: direct Android REST failures in 17-161 ms while Telnet stays reachable.
5. Telnet transport cost is not a current bottleneck.
   - Evidence: `u64` Telnet TCP connect in 14-24 ms and `c64u` Telnet TCP connect in 15-22 ms.

## Implementation Plan

### Stage 0 - Add the minimum missing metric

- Add one local metric for `Diagnostics open requested -> first visible Diagnostics content`.
- Rerun startup on a normal build, not the switch-lab probe build.
- Exit criterion:
  - a valid Diagnostics-open measurement exists on Android.
  - a representative normal-build startup baseline exists.

### Stage 1 - Remove Android hostname stalls

- Change the saved-device verification path on Android to prefer a verified resolved target before retrying the raw bare hostname.
- Persist or reuse the least-invasive existing resolution hint available from successful verification.
- Warn when Android users save a bare hostname without any verified resolved address.
- Exit criterion:
  - healthy-device switch soak on Android reaches `p50 < 250 ms`, `p95 < 500 ms`.
  - unavailable-device failures no longer stall at ~14 s.

### Stage 2 - Protect the foreground path

- Pause or defer background saved-device health cycles while a foreground device switch verification is in progress.
- Do not let Diagnostics-open reconciliation start before the initial Diagnostics surface is painted.
- Keep last-known status visible instead of demanding a fresh background cycle during the foreground transition.
- Exit criterion:
  - switch variance stays close to the measured `u64` transport envelope.
  - no overlapping background health cycle occurs during a foreground switch verification.

### Stage 3 - Make Diagnostics lazy by default

- Snapshot heavy diagnostics inputs on open rather than continuously while closed.
- Derive action summaries and evidence rows only while the overlay is open.
- Defer non-visible subviews and expanded detail computation.
- Exit criterion:
  - Diagnostics open-to-first-visible meets `p50 < 250 ms`, `p95 < 400 ms` on Pixel 4 with representative evidence volume.

### Stage 4 - Stop if the narrow plan works

- If the metrics above are met on `u64`, stop and leave broader transport/bundle/architecture work for the separate longer-horizon responsiveness track.
- Only reopen broad refactors if real Android measurements still miss target after Stages 1-3.

## Test Plan

- Unit tests:
  - saved-device host selection/fallback order on Android.
  - foreground-switch behavior when background saved-device health polling is enabled.
  - Diagnostics lazy-derivation behavior while closed versus open.
- Real-device validation:
  - rerun `node scripts/run-device-switch-soak.mjs --target=real --serial=9B081FFAZ001WX` for bare-hostname and IP-backed saved devices.
  - rerun the Android-shell `curl` and `nc -z` probes used in this report.
  - rerun `node scripts/startup/collect-android-startup-baseline.mjs --serial=9B081FFAZ001WX` on a normal build.
- Acceptance thresholds:
  - `u64` REST and config-read probes stay in roughly the current 27-36 ms band.
  - `u64` Telnet connect stays in roughly the current 14-24 ms band.
  - healthy switch legs meet the Stage 1 target.
  - Diagnostics open meets the Stage 3 target after Stage 0 instrumentation lands.

## Risks

- `c64u` hardware/service instability can hide app-side wins or losses if measurements are not attributed per target.
- It is easy to overreact to older, broader performance research and start large transport or bundle refactors that this session did not justify.
- A contaminated startup build can create false confidence or false alarms; startup must be re-baselined on the normal app path.

## Deferred Items

- Any broad `CapacitorHttp`, bundle-chunk, or page-scale modularization work that is not needed to hit the Stage 1-3 targets.
- Deep Telnet session/login optimization, because connect latency is already low in the current hardware state.
- `c64u` device-health remediation, which is a separate hardware/service investigation.

## Appendix: Commands Used

- `node scripts/run-device-switch-soak.mjs --target=real --serial=9B081FFAZ001WX --timeoutMs=180000 --out=docs/plans/performance/iteration1/switch-soak-real-android.json`
- `VITE_ENABLE_TEST_PROBES=1 VITE_DEBUG_SAVED_DEVICES_JSON='[...]' VITE_DEBUG_DEVICE_SWITCH_SOAK_JSON='{"fromDeviceId":"u64","toDeviceId":"c64u","iterations":5,"interSwitchDelayMs":150,"autorun":true}' npm run cap:build && npm run android:apk`
- `node scripts/run-device-switch-soak.mjs --target=real --serial=9B081FFAZ001WX --timeoutMs=180000 --out=docs/plans/performance/iteration1/switch-soak-real-android-ip.json`
- `adb -s 9B081FFAZ001WX shell 'curl -fsS --max-time 3 http://192.168.1.13/v1/info'`
- `adb -s 9B081FFAZ001WX shell 'curl -fsS --max-time 3 http://192.168.1.13/v1/configs/U64%20Specific%20Settings/CPU%20Speed'`
- `adb -s 9B081FFAZ001WX shell 'nc -z -w 3 192.168.1.13 23'`
- `adb -s 9B081FFAZ001WX shell 'curl -fsS --max-time 3 http://192.168.1.167/v1/info'`
- `adb -s 9B081FFAZ001WX shell 'nc -z -w 3 192.168.1.167 23'`
- `node scripts/startup/collect-android-startup-baseline.mjs --serial=9B081FFAZ001WX --outDir=docs/plans/performance/iteration1/startup-baseline`
- `npm run cap:build && npm run android:apk && adb -s 9B081FFAZ001WX install -r /home/chris/dev/c64/c64commander/android/app/build/outputs/apk/debug/c64commander-0.8.2-debug.apk && adb -s 9B081FFAZ001WX shell am start -n uk.gleissner.c64commander/.MainActivity`

## Appendix: Relevant Code Paths

- `src/lib/diagnostics/healthCheckEngine.ts`
- `src/lib/diagnostics/latencyTracker.ts`
- `src/lib/tracing/traceSession.ts`
- `src/hooks/useSavedDeviceSwitching.ts`
- `src/hooks/useSavedDeviceHealthChecks.ts`
- `src/lib/deviceInteraction/deviceInteractionManager.ts`
- `src/lib/savedDevices/savedDeviceSwitchMetrics.ts`
- `src/components/diagnostics/DiagnosticsDialog.tsx`

## Appendix: Measurement Schema Or Log Examples

- Bare-hostname switch-soak failure signature:
  - repeated `verificationDurationMs` around `14360-14382 ms` on `c64u -> u64` legs.
- IP-based switch-soak success signature:
  - healthy `u64` leg total duration clustering around `69-176 ms`.
- Android-shell transport signature:
  - low-latency `u64` REST/config/Telnet results.
  - `c64u` REST reset with simultaneous low-latency Telnet reachability, which separates service failure from general transport failure.
