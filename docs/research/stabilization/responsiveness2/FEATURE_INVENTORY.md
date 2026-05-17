# FEATURE_INVENTORY — User-perceived feature audit (priority-ranked)

Generated 2026-05-17 during investigation Stage 1. Priority is a stabilization rank where 1 = ship-blocking, 5 = nice-to-have.

## Priority 1 — Connection / Diagnostics fidelity

### Device selection & connection (saved devices)

- Source: `src/lib/connection/connectionManager.ts` (1080 LOC), `src/lib/savedDevices/store.ts` (1090 LOC), `src/hooks/useSavedDeviceSwitching.ts`, `src/hooks/useC64Connection.ts` (494 LOC).
- Network: `GET /v1/info`, mDNS resolve via Capacitor `MdnsResolver`, host probe `probeWithFetch` (2500 ms timeout).
- State: `connectionManager` snapshot — UNKNOWN | DISCOVERING | REAL_CONNECTED | DEMO_ACTIVE | OFFLINE_NO_DEMO.
- Failure modes observed:
  - Home-page status badge stays `OFFLINE` for 10–15 s after launch despite the very first config-tree REST call succeeding (`/v1/configs/LED Strip Settings` returns 200 within ~30 ms). The discovery probe lags the config reads.
  - After warm restart, `Device: Not available  Firmware: Not available` may persist on the home page meta row even when the badge shows `U64 HEALTHY`.
- Tests: `tests/unit/lib/connection/connectionManager.test.ts` and friends (already exist); no test for "first config read succeeded but badge still OFFLINE".
- Suggested priority: **1** — first impression. A badge that says OFFLINE when the device is actually connected is a trust-destroying defect.

### Device health & diagnostics overlay

- Source: `src/lib/diagnostics/healthCheckEngine.ts` (1857 LOC), `src/lib/diagnostics/healthModel.ts` (601 LOC), `src/hooks/useSavedDeviceHealthChecks.ts` (386 LOC), `src/components/diagnostics/DiagnosticsDialog.tsx` (1828 LOC), `src/components/diagnostics/GlobalDiagnosticsOverlay.tsx`, `src/components/UnifiedHealthBadge.tsx` (697 LOC).
- Network: REST `/v1/info`, `/v1/machine:readmem`, `/v1/configs/...` (CONFIG pulse), FTP list, Telnet connect+menu probe.
- State: per-device `HealthCheckRunResult` cache + global rollup from a 5-minute event window across REST/FTP/TELNET/App.
- Failure modes observed:
  - **Saved-device probes cross-contaminate active-device health** — c64u (192.168.1.167) is probed every 10 s while u64 is the active device; failures from c64u feed into the 5-min window used by the active-device rollup, pushing the U64 badge to "Degraded".
  - REST contributor window uses **`firstSuccessIndex`** trimming → older failures persist for up to 5 min after a single success; FTP/TELNET use **`findLastIndex(isSuccess)`** trimming → recent success clears history. Asymmetry between contributors is undocumented and yields confusing results.
  - App contributor goes Degraded at total ≥ 1 in 5 minutes — a single transient warn turns the whole UI degraded for 5 minutes.
  - Diagnostics dialog Activity tab shows mixed-host events with no per-host filter; user has to read IPs to understand what's being probed.
- Tests: many under `tests/unit/lib/diagnostics/`; no test for "events from one saved device must not pollute another saved device's contributor health".
- Suggested priority: **1** — diagnostics correctness is the prerequisite for trusting every other reliability claim.

### Background-vs-foreground probe coordination

- Source: `src/lib/diagnostics/diagnosticsOverlay.ts`, `src/lib/deviceInteraction/deviceInteractionManager.ts` (786 LOC), and the read-only/visible-pulse split in `HEALTH_CHECK_CONTEXTS`.
- Failure mode: 10 s `AUTO_REFRESH_MS` cycle runs full multi-probe sweeps against every saved device; pauses only on Diagnostics overlay suppression or active foreground switch.
- Suggested priority: **1** — both for responsiveness and for diagnostics fidelity.

## Priority 2 — Slider, volume, mute controls

### Home page sliders (CPU Speed, Lighting, SID)

- Source: `src/hooks/useDeviceBoundSlider.ts`, `src/pages/home/components/HomeCpuSpeedSlider.tsx`, `src/pages/home/SidCard.tsx`, `src/pages/home/components/LightingSummaryCard.tsx`, `src/components/ConfigItemRow.tsx`.
- Network: `POST /v1/configs/<category>` via `useC64UpdateConfigBatch`.
- State: `useDeviceBoundSlider` (draft + pendingIntent) + `useAuthoritativeConfigValueState` per-key optimistic store.
- Failure modes (live device):
  - Direct slider primitive shape is correct; potential regressions come from transport-layer marshalling (CapacitorHttp per-request cookie hop) and from saved-device background-probe traffic stealing main-thread time during drag.
  - `pollingPauseRegistry` only pauses drives/info polling, not saved-device health-check cycles.
- Tests: `tests/unit/hooks/useDeviceBoundSlider*.test.ts` (good coverage at primitive level); no end-to-end test that "saved-device 10 s probe must not steal frames during slider drag".
- Suggested priority: **2** — primitive is fine, but downstream contention matters.

### Play page volume + mute (`VolumeControls`, `useVolumeOverride`)

- Source: `src/pages/playFiles/components/VolumeControls.tsx` (96 LOC, thin), `src/pages/playFiles/hooks/useVolumeOverride.ts` (908 LOC, dense).
- Network: `POST /v1/configs/Audio Mixer` updates per SID volume slot.
- State: `volumeState` reducer (index + muted + reason), plus 6+ refs guarding sync vs intent (`manualMuteSnapshotRef`, `pauseMuteSnapshotRef`, `manualMuteIntentRef`, `pendingVolumeWriteRef`, `lastKnownDeviceVolumeRef`, `volumeSessionSnapshotRef`, `resumingFromPauseRef`, `pausingFromPauseRef`, `lastManualWriteRef` with 1500 ms window).
- Failure modes (likely, code-evidence only — not live-validated this session):
  - Mute/unmute uses snapshot of pre-mute volumes; if a fresh refetch lands while the snapshot is stale, sync effect can rewrite UI state.
  - "Skip identical pending write" guard `queuePlaybackMixerWrite` is correct but only checks `pending`'s `(index, muted)`. If the user toggles mute repeatedly while a previous write is still in-flight, an intermediate state can land between two redundant writes.
  - On `resume` from pause the snapshot of muted volumes is reapplied verbatim — if the user changed the slider while paused (`handleVolumeDraftChange` updates the snapshot too when `volumeMuted` is true), the snapshot-rewrite-on-resume should reflect the new draft. Code does this conditionally on `target && snapshot` but the path is intricate.
- Tests: many `tests/unit/pages/playFiles/*volume*`, `volumeState*`, `volumeSync*`; no targeted real-device test for "rapid mute/unmute/mute under playback".
- Suggested priority: **2** — high user-visible impact.

## Priority 3 — Playback start/stop/pause

- Source: `src/pages/playFiles/hooks/usePlaybackController.ts` (1117 LOC), `src/lib/playback/playbackRouter.ts`.
- Network: REST `/v1/runners:run_sid_file`, `/v1/runners:run_prg`, `/v1/runners:load_d64`, Telnet REU/snapshot actions; `machineReboot`, `machineReset`, `machinePause`, `machineResume`.
- Failure modes:
  - `handleStop` issues `machineReset` (or `machineReboot` for disk) with 3 s timeout — if the device is mid-task the reset can be queued behind a write and time out the UI even though the device eventually resets.
  - `resumeMachineWithRetry` retries once on failure (6 s timeout each); the second attempt has no fresh telemetry context.
  - `handleStop` calls `restoreVolumeOverrides("stop")` AFTER reset — if the reset succeeded but volume restore fails, the user gets "stopped but volume not restored" with no toast unless `applyAudioMixerUpdates` reports it as `Restore` context (which is silent except for an addErrorLog).
- Tests: `tests/unit/pages/playFiles/playbackController*.test.ts`, `tests/unit/lib/deviceInteraction/machineTransitionCoordinator*.test.ts`.
- Suggested priority: **3** — code structure is reasonable; real-device validation needed.

## Priority 4 — Configuration browsing & writes

- Source: `src/pages/ConfigBrowserPage.tsx` (690 LOC), `src/pages/SettingsPage.tsx` (2176 LOC), `src/components/ConfigItemRow.tsx`.
- Network: `GET /v1/configs/<category>` (per-item probe storm at first paint), `POST /v1/configs/<category>`.
- Failure modes:
  - First-paint config-item storm: LED Strip Settings + Keyboard Lighting + sub-items issued 9+ sequential CapacitorHttp calls; cookie plugin hop per request.
- Suggested priority: **4** — single-screen impact, not a primary user flow.

## Priority 5 — Feature flags & device profile

- Source: `src/lib/config/featureFlags.ts`, `src/lib/config/deviceSafetySettings.ts`.
- Not a likely root cause for current symptoms.
- Suggested priority: **5**.

## Cross-cutting features

### Error display, retry, recovery

- Source: `src/lib/uiErrors.ts`, `src/components/toast.tsx`, `src/lib/diagnostics/logger.ts`.
- Failure modes:
  - `Capacitor/Console File:  - Line 353 - Msg: undefined` repeats per Telnet send/read tick. Source is post-bundling code, possibly `addLog`/console-bridge call passing `undefined` as first arg.
  - `Uncaught TypeError: Cannot read properties of undefined (reading 'triggerEvent')` at cold boot — JS error before chunks finish loading.

### Background/foreground recovery

- Source: `src/hooks/useDeviceBoundSlider.ts` (visibilitychange listener clears draft state), `connectionManager.ts` (resume trigger via `discover('resume')`).
- Failure mode hypothesis: the resume trigger may not invalidate stale React Query data that backs the badge, leaving a `DEGRADED` badge until the next 10 s cycle.
