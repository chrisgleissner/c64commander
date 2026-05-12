# Android Real-Device Performance Investigation Worklog

## 2026-05-11

- Started a production-stabilization performance investigation with Android as the primary target and real `u64` / `c64u` devices as measurement backends.
- Reviewed the current root planning/worklog files to avoid conflicting with existing repository work.
- Mapped the first performance-critical code surfaces:
  - `src/lib/diagnostics/healthCheckEngine.ts`
  - `src/lib/diagnostics/latencyTracker.ts`
  - `src/lib/tracing/traceSession.ts`
  - `src/hooks/useSavedDeviceSwitching.ts`
  - `src/hooks/useSavedDeviceHealthChecks.ts`
  - `src/lib/deviceInteraction/deviceInteractionManager.ts`
  - `src/lib/savedDevices/savedDeviceSwitchMetrics.ts`
  - `src/components/diagnostics/DiagnosticsDialog.tsx`
  - `src/App.tsx`
- Confirmed the repo already includes timing and trace infrastructure sufficient to start investigation without changing executable code.
- Confirmed `docs/plans/performance/iteration1/` existed but was empty; created dedicated iteration plan/worklog/report files there.
- Probed live device availability before app-level measurement:
  - `u64` REST responded normally.
  - `c64u` REST reset the connection.
  - host resolution for this session was `u64 = 192.168.1.13` and `c64u = 192.168.1.167`.
- Ran the existing real-Android switch-soak harness with bare hostnames and recorded `switch-soak-real-android.json`.
  - 10 total transitions.
  - `successCount = 0`, `failureCount = 10`.
  - `p50 = 14317 ms`, `p90 = 14397 ms`, `max = 14445 ms`.
- Rebuilt with IP-based saved devices and reran the same soak into `switch-soak-real-android-ip.json`.
  - `successCount = 5`, `failureCount = 5`.
  - `p50 = 140 ms`, `p90 = 176 ms`, `max = 226 ms`.
  - all remaining failures were `u64 -> c64u` offline outcomes.
- Collected Android-shell transport probes directly from the Pixel 4:
  - `u64` REST `/v1/info`: 27-33 ms over 10 samples.
  - `u64` config read: 31-36 ms over 10 samples.
  - `u64` Telnet connect: 14-24 ms over 5 samples.
  - `c64u` REST `/v1/info`: connection reset in 17-161 ms over 5 samples.
  - `c64u` Telnet connect: 15-22 ms over 5 samples.
- Collected a startup artifact with `TTFSC p50 = 615 ms`, `p95 = 703 ms`, then marked it contaminated because the probe build auto-launched the switch lab and bypassed representative startup traffic.
- Read the concrete Diagnostics/open path after the network measurements:
  - `src/components/diagnostics/GlobalDiagnosticsOverlay.tsx`
  - `src/components/diagnostics/DiagnosticsDialog.tsx`
  - `src/hooks/useSavedDeviceHealthChecks.ts`
  - `src/lib/deviceInteraction/deviceInteractionManager.ts`
- Reached the final ranking:
  1. Android bare-hostname resolution is the main measured app-side stall.
  2. Foreground switch work can still be distorted by background saved-device health polling and Diagnostics reconciliation.
  3. Diagnostics does too much eager derivation for a surface that is usually closed.
  4. `c64u` REST instability is a real hardware/service blocker but separate from the measured `u64` fast path.
  5. Telnet connect cost is not currently a bottleneck.
- Restored the Pixel 4 to a normal debug APK after the probe runs and relaunched the app.
