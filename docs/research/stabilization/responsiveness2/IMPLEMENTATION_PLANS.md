# IMPLEMENTATION_PLANS — Stabilization Refuel (Stage 2: Implementation)

Started: 2026-05-17 (continuing 2026-05-18+)
Working branch: `feat/reduce-latency-and-fix-errors` (HEAD = `c65aa7a5` at start)
Pixel 4 adb serial: `9B081FFAZ001WX`
Device targets: `u64` (192.168.1.13, fw 3.14e) primary; `c64u` (192.168.1.167, fw 1.1.0) secondary
Active app version at start: 0.7.9-rc1

This document is the live execution log for Stage 2. Read `STABILIZATION_PROMPT.md`, `FINDINGS.md`, and `DIAGNOSTICS_ROOT_CAUSE_MATRIX.md` for context. Updated continuously, not as a one-time note.

## Status legend

- TODO — not started
- IN_PROGRESS — code/tests in flight
- BLOCKED — see Notes column for documented reason and fallback path
- DONE — code merged on branch + tests + evidence captured

## Phase 1 — Diagnostics data integrity

| ID | Finding | Status | Notes / Evidence |
|---|---|---|---|
| F-DIAG-1 | Saved-device cross-contamination of contributor windows | DONE | `DeviceScope` + `eventMatchesDeviceScope` added in `healthModel.ts`; contributors accept optional scope; `useHealthState` passes `{ deviceId, host }`; `useSavedDeviceHealthChecks` background interval raised to 60 s. Fixed broken `resolveTraceAttributedHost` to use actual `savedDeviceHostSnapshot`/`verifiedHostname` fields. Pixel soak exposed an active-device Telnet race, so `useTelnetActions` capability discovery now also uses `withTelnetInteraction` (`capability-discovery`) to avoid racing the health-check TELNET probe. Evidence: targeted Vitest passed 148 tests on 2026-05-17; Pixel 4 u64 Home 60 s soak passed after scheduler fix. |
| F-DIAG-2 | REST window trim asymmetry | DONE (code+tests) | `restHealthWindowEvents` now sorts ascending + `trimToLatestSuccess` (matches FTP/TELNET). New regression tests added. Existing tests updated where the new trim invalidated old assertions. Evidence: targeted diagnostics/hook Vitest run passed on 2026-05-17. |
| F-DIAG-3 | App contributor over-sensitivity | DONE (code+tests) | Recency rule: severity from errors in last 60 s. 0 recent → Idle (even with old errors), 1–4 recent → Degraded, ≥5 recent → Unhealthy. Evidence: targeted diagnostics/hook Vitest run passed on 2026-05-17. |

Phase 1 gate:
- [x] Unit tests for new device-scoped + recency behaviour pass (104 healthModel + 14 useHealthState + 11 useSavedDeviceHealthChecks all green)
- [x] Telnet capability discovery scheduling regression passes (`useTelnetActions`: 19 tests; targeted set: 148 tests)
- [x] `npm run lint` passes after Prettier formatting of touched TS files (2026-05-17; 3 existing warnings under `c64scope/coverage`)
- [x] `npm run test:coverage` passes: 965 tests, 91.78 % branch coverage (2026-05-17)
- [x] Pixel 4 60 s Home soak with u64 active: badge remains HEALTHY. Evidence: `evidence/phase1-F-DIAG-1-u64-home-60s-after-telnet-scheduler.png`; logcat: `evidence/phase1-F-DIAG-1-u64-logcat-after-telnet-scheduler.txt`.
- [ ] c64u secondary validation blocked: `curl --max-time 5 http://c64u/v1/info` returns `Recv failure: Connection reset by peer` on 2026-05-17.

## Phase 2 — Connection state truthfulness

| ID | Finding | Status | Notes / Evidence |
|---|---|---|---|
| F-CONN-1 | OFFLINE badge while REST succeeding | DONE (code+tests) | Added `noteReachable(host, source, deviceInfo?)` in `connectionManager`; successful 2xx REST responses call it from `c64api`. Active-host reachability promotes `OFFLINE_NO_DEMO`/`DISCOVERING` to `REAL_CONNECTED`. Regression: `connectionManager` promotes offline active host when REST reports reachable. |
| F-CONN-2 | Home Device/Firmware row stuck on warm restart | DONE (code+tests) | `useC64Connection` invalidates `c64-info` when connection state transitions to `REAL_CONNECTED`, enabling Home `SystemInfo` to refresh after opportunistic promotion. Regression added in `useC64Connection.test.ts`. |
| F-CONN-3 | Diagnostics dialog header `u64 · Unknown` | DONE (code+tests) | Connection snapshot now carries live `/v1/info` `deviceInfo`; diagnostics maps it to `DeviceDetailInfo` and falls back to `deviceInfo.product` when saved-device product is empty. Regression added in `DiagnosticsDialog.test.tsx`. |

Phase 2 gate:
- [x] Targeted unit/integration tests pass: `npx vitest run tests/unit/connection/connectionManager.test.ts tests/unit/hooks/useC64Connection.test.ts tests/unit/components/diagnostics/DiagnosticsDialog.test.tsx tests/unit/hooks/useTelnetActions.test.tsx` (152 tests, 2026-05-17)
- [x] `npm run lint` passes (2026-05-17; 3 existing warnings under `c64scope/coverage`)
- [x] `npm run test:coverage` passes: 965 tests, 91.76 % branch coverage (2026-05-17)
- [ ] Pixel 4 cold-launch at +3s: badge non-OFFLINE; Device/Firmware populated at +5s; same on warm restart

## Phase 3 — Transport overhead and log noise

| ID | Finding | Status | Notes / Evidence |
|---|---|---|---|
| F-HTTP-1 | CapacitorCookies per-request hop | TODO | Verify disable; route around if not honoured. |
| F-HTTP-2 | Cold-boot LED Strip config storm | TODO | Use `getConfigItems` batching; defer Keyboard Lighting. |
| F-LOG-1 | `Msg: undefined` log spam | TODO | ESLint rule + remove culprit. |
| F-LOG-2 | `triggerEvent` TypeError at cold boot | TODO | Defer bridge consumer behind ready promise. |

Phase 3 gate:
- [ ] 30 s Home idle: 0 `CapacitorCookies` lines for C64U URLs
- [ ] 30 s Telnet activity: 0 `Msg: undefined` lines
- [ ] Cold-boot: 0 `triggerEvent` TypeError lines
- [ ] Cold-boot LED Strip Settings REST calls ≤ 2

## Phase 4 — Interaction-aware background scheduling and MimeMap

| ID | Finding | Status | Notes / Evidence |
|---|---|---|---|
| F-RT-1 | Saved-device probes ignore polling-pause | TODO | Subscribe `useSavedDeviceHealthChecks` to registry. |
| F-MIME-1 | MimeMap long monitor contention | TODO | Prewarm in MainActivity.onCreate off-UI. |

Phase 4 gate:
- [ ] 30 s slider/volume stress: 0 saved-device probes during interaction
- [ ] Cold-boot MimeMap contention < 100 ms (or absent)

## Phase 5 — Hypothesis verification

| ID | Hypothesis | Status | Notes |
|---|---|---|---|
| H-VOL-1 | Rapid mute/unmute/mute lands intermediate state | TODO | Reproduce on u64 with 3 toggles in 200 ms each |
| H-VOL-2 | `handleVolumeDraftChange` discards draft when snapshot missing | TODO | Reproduce mute→drag→unmute |
| H-PLAY-1 | `handleStop` 3 s reset vs Telnet contention emits false toasts | TODO | Reproduce playback then Stop mid-cycle |
| H-RT-2 | App pause/resume during cold boot prolongs DISCOVERING | TODO | `am start-stop-start` 200 ms gaps |

## Phase 6 — Full validation sweep

Per-finding evidence in `evidence/phase<N>-<finding-id>-<host>-<artifact>`.

Run order:
1. `npm run lint`
2. `npm run test`
3. `npm run test:coverage` (must be ≥ 91 %)
4. `npm run build`
5. `npm run cap:build`
6. `npm run android:apk`
7. `adb -s 9B081FFAZ001WX install -r android/app/build/outputs/apk/debug/c64commander-*-debug.apk`
8. Pixel 4 + u64 validation matrix (all findings)
9. Pixel 4 + c64u validation matrix (cross-contamination findings)

## Pixel 4 deploy log

| When | APK | TotalTime | Notes |
|---|---|---|---|
| 2026-05-17 22:23 | `android/app/build/outputs/apk/debug/c64commander-0.7.9-rc1-debug.apk` | 583 ms | Initial Phase 1 soak failed: Home badge `U64 · 1 UNHEALTHY`; diagnostics showed active-device `useTelnetActions` capability discovery `Read failed: Not connected`. Failure evidence retained under `evidence/phase1-F-DIAG-1-u64-*failed*` and initial `home-60s.png`/`logcat.txt`. |
| 2026-05-17 22:44 | `android/app/build/outputs/apk/debug/c64commander-0.7.9-rc1-debug.apk` | 614 ms | Rebuilt after Telnet scheduler fix; 60 s u64 Home soak passed with `U64 · HEALTHY`. Known Phase 3 `Msg: undefined` spam remains in logcat. |

## u64 + c64u real-device validation log

| Finding | u64 result | c64u result | Evidence |
|---|---|---|---|
| F-DIAG-1/F-DIAG-2/F-DIAG-3 | PASS: `u64` reachable (`Ultimate 64 Elite`, fw `3.14e`), Pixel 4 Home soak remains `U64 · HEALTHY` after 60 s. | BLOCKED: `/v1/info` on `c64u` resets connection. | `evidence/phase1-F-DIAG-1-u64-home-60s-after-telnet-scheduler.png`, `evidence/phase1-F-DIAG-1-u64-logcat-after-telnet-scheduler.txt` |
