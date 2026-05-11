# Android Real-Device Performance Stabilization Plan

## Current Phase

- Phase 2: measurement complete and implementation staged.

## Concrete TODO List

- [completed] Map diagnostics, switching, health, config, Telnet, and request-scheduling code paths.
- [completed] Inventory existing measurement infrastructure and logging/tracing surfaces.
- [completed] Define Android-first real-device measurement strategy.
- [completed] Attempt `c64u` and `u64` measurements and record device availability.
- [completed] Analyze measured bottlenecks against code evidence.
- [completed] Produce staged implementation and regression plans.

## Investigation Findings

- Existing built-in timing surfaces already cover much of the required scope:
  - request latency samples in `src/lib/diagnostics/latencyTracker.ts`
  - event-level trace timestamps and device attribution in `src/lib/tracing/traceSession.ts`
  - health-check probe timing in `src/lib/diagnostics/healthCheckEngine.ts`
  - saved-device switch timing in `src/lib/savedDevices/savedDeviceSwitchMetrics.ts`
- Diagnostics UX is controlled by overlay/dialog code plus shared diagnostics state, not by a heavyweight route transition.
- Device switching is a multi-step flow: selection, runtime host/port mutation, query cancellation, verification, then route invalidation.
- Request concurrency and backpressure are already explicitly mediated in `src/lib/deviceInteraction/deviceInteractionManager.ts` and must be treated as part of the performance model.
- Real-device evidence shows that raw transport cost to `u64` is already low on the Pixel 4. The current responsiveness problem is therefore not explained by Android Wi-Fi or by Telnet socket setup alone.
- Android bare-hostname resolution remains the dominant measured stall in saved-device switching.
- `c64u` is partially reachable in this session: its Telnet port answers quickly, but REST `/v1/info` is unstable and resets the connection.
- Diagnostics-open timing lacks a built-in metric. The current conclusion is a code-path proxy, not a stopwatch measurement.

## Measurement Approach

- Prefer the repo’s existing diagnostics/tracing surfaces over invasive new instrumentation.
- Use Android on real hardware as the primary measurement environment.
- Probe `u64` and `c64u` availability directly over REST before running app scenarios.
- Attribute each sample by device, platform, scenario, operation, and success/failure outcome.

## Measurement Results

- Saved-device switch soak using bare hostnames on the Pixel 4:
  - artifact: `switch-soak-real-android.json`
  - result: 10 failures out of 10 transitions.
  - summary: `p50 = 14317 ms`, `p90 = 14397 ms`, `max = 14445 ms`.
- Saved-device switch soak using IP-based saved devices on the Pixel 4:
  - artifact: `switch-soak-real-android-ip.json`
  - result: 5 successes and 5 failures.
  - summary: `p50 = 140 ms`, `p90 = 176 ms`, `max = 226 ms`.
  - interpretation: the `u64` leg is fast when Android DNS is bypassed; the residual failures are `c64u` offline outcomes.
- Pixel 4 direct transport probes:
  - `u64` REST `/v1/info`: 27-33 ms.
  - `u64` config read: 31-36 ms.
  - `u64` Telnet connect: 14-24 ms.
  - `c64u` REST `/v1/info`: failed in 17-161 ms with connection reset.
  - `c64u` Telnet connect: 15-22 ms.
- Startup baseline:
  - artifact: `startup-baseline/startup-baseline.json`
  - observed `TTFSC p50 = 615 ms`, `p95 = 703 ms`.
  - caveat: collected from a probe build that auto-launched the device-switch lab, so it is not a production startup baseline.

## Risks

- `c64u` availability is unstable and can turn a useful regression run into a device-health incident unless samples are attributed per device.
- Diagnostics-open timing still lacks a direct marker. The wrong fix would be to add broad instrumentation instead of a single narrow timing marker.
- Startup must be rerun on a normal build before any startup optimization work is prioritized.

## Candidate Fixes

- Recommended now:
  1. Android hostname-stall mitigation for saved-device switching.
  2. Background-health throttling or deferral during foreground switch verification.
  3. Diagnostics lazy derivation and initial-surface slimming.
- Not recommended now:
  1. Broad request-scheduler rewrites.
  2. Telnet transport rewrites.
  3. Architecture-scale page refactors.
  4. Broad network transport changes justified only by older research rather than this session’s measurements.

## Final Implementation Plan

### Stage 0 - Close the missing metric with one narrow hook

- Add a single Diagnostics timing metric covering `open requested -> first visible frame/section mounted`.
- Do not add a general tracing framework; add one local marker that can be exercised on Android and stripped into existing diagnostics exports.
- Rerun the normal-build startup baseline so startup is measured on the actual app flow rather than the switch-lab probe route.

### Stage 1 - Remove Android hostname stalls from saved-device switching

- Reuse existing host-resolution knowledge instead of paying the bare-hostname penalty on every switch verification.
- Prefer a verified IP or last-known-good resolved target on Android when a saved device was entered as `u64` or `c64u`.
- Only fall back to the raw bare hostname when no verified resolved target exists.
- Show a narrow Android-specific warning when a bare hostname is saved without a verified resolved address.
- Acceptance:
  - Pixel 4 switch soak against a healthy `u64` leg: `p50 < 250 ms`, `p95 < 500 ms`.
  - Unavailable-target failure legs should fail fast, ideally `< 500 ms p95`, rather than parking for 14 s.

### Stage 2 - Prevent background health work from distorting the foreground path

- Pause or defer saved-device background health cycles while a foreground switch verification is in progress.
- Keep last-known health state visible instead of forcing a fresh background cycle to compete with the active switch.
- Avoid kicking off expensive diagnostics reconciliation until the initial Diagnostics surface is visible.
- Acceptance:
  - Switch-soak variance should converge near the direct Android transport envelope already measured for `u64`.
  - No new background health cycle should start during a foreground switch verification window.

### Stage 3 - Make Diagnostics lazy by default

- Snapshot logs/traces/history only when the overlay opens.
- Derive action summaries and unified evidence lists only while open.
- Keep initial activity rendering small; expand detail rows and deeper pages lazily.
- Defer non-visible panels such as heat maps, history, and drift views until opened.
- Acceptance:
  - After Stage 0 instrumentation lands, Diagnostics open-to-first-visible `p50 < 250 ms`, `p95 < 400 ms` on the Pixel 4 with representative trace volume.

### Stage 4 - Re-measure before any wider intervention

- If Stages 1-3 meet their targets on `u64`, stop.
- Only reopen broader transport, bundle, or architecture work if real Android measurements still miss user-visible targets after the narrower fixes land.

## Explicit Non-Goals

- No broad refactors.
- No architectural modernization.
- No request-rate increase against real hardware.
- No correctness regressions in device state semantics.
- No broad transport rewrite based solely on older repository research.

## Open Questions

- Which persistence point is least invasive for Android resolved-host hints.
- Whether Diagnostics can meet the open-latency target with lazy derivation alone, or whether part of the evidence list also needs memoized snapshots.
- Whether the foreground switch path should cancel or merely postpone background saved-device health cycles.

## Regression And Verification Plan

- Unit and hook coverage:
  - add focused tests around Android saved-device host selection and fallback order.
  - add focused tests proving background health polling pauses or defers during foreground switch verification.
  - add focused tests proving Diagnostics heavy derivation does not run while the overlay is closed.
- Real-device validation:
  - rerun `node scripts/run-device-switch-soak.mjs --target=real --serial=9B081FFAZ001WX` against both bare-hostname and IP-configured saved devices.
  - rerun the Android-shell transport probes used in this investigation to confirm no raw transport regression was introduced.
  - rerun `node scripts/startup/collect-android-startup-baseline.mjs --serial=9B081FFAZ001WX` on a normal build.
- Thresholds:
  - `u64` REST and config-read probes should remain close to the current 27-36 ms band.
  - `u64` Telnet connect should remain within the current 14-24 ms band.
  - healthy switch legs should stay within the Stage 1 threshold above.
  - Diagnostics open should meet the Stage 3 threshold once the narrow timing marker exists.
