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
| F-DIAG-1 | Saved-device cross-contamination of contributor windows | DONE (code+tests) | `DeviceScope` + `eventMatchesDeviceScope` added in `healthModel.ts`; contributors accept optional scope; `useHealthState` passes `{ deviceId, host }`; `useSavedDeviceHealthChecks` background interval raised to 60 s. Fixed broken `resolveTraceAttributedHost` to use actual `savedDeviceHostSnapshot`/`verifiedHostname` fields. Evidence: `npx vitest run tests/unit/lib/diagnostics/healthModel.test.ts tests/unit/hooks/useHealthState.test.tsx tests/unit/hooks/useSavedDeviceHealthChecks.test.tsx` passed 129 tests on 2026-05-17. |
| F-DIAG-2 | REST window trim asymmetry | DONE (code+tests) | `restHealthWindowEvents` now sorts ascending + `trimToLatestSuccess` (matches FTP/TELNET). New regression tests added. Existing tests updated where the new trim invalidated old assertions. Evidence: targeted diagnostics/hook Vitest run passed on 2026-05-17. |
| F-DIAG-3 | App contributor over-sensitivity | DONE (code+tests) | Recency rule: severity from errors in last 60 s. 0 recent → Idle (even with old errors), 1–4 recent → Degraded, ≥5 recent → Unhealthy. Evidence: targeted diagnostics/hook Vitest run passed on 2026-05-17. |

Phase 1 gate:
- [x] Unit tests for new device-scoped + recency behaviour pass (104 healthModel + 14 useHealthState + 11 useSavedDeviceHealthChecks all green)
- [x] `npm run lint` passes after Prettier formatting of touched TS files (2026-05-17; 3 existing warnings under `c64scope/coverage`)
- [x] `npm run test:coverage` passes: 965 tests, 91.78 % branch coverage (2026-05-17)
- [ ] Pixel 4 60 s Home soak with u64 active + c64u saved+powered: badge remains HEALTHY (TODO — requires Pixel 4 + powered devices, deferred to Phase 6 hardware sweep)

## Phase 2 — Connection state truthfulness

| ID | Finding | Status | Notes / Evidence |
|---|---|---|---|
| F-CONN-1 | OFFLINE badge while REST succeeding | TODO | `noteReachable` opportunistic promotion. |
| F-CONN-2 | Home Device/Firmware row stuck on warm restart | TODO | Invalidate `c64-info` on REAL_CONNECTED. |
| F-CONN-3 | Diagnostics dialog header `u64 · Unknown` | TODO | Fall back to live `/v1/info` cache. |

Phase 2 gate:
- [ ] Unit + integration tests pass
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
| (TBD) | | | |

## u64 + c64u real-device validation log

| Finding | u64 result | c64u result | Evidence |
|---|---|---|---|
| (per phase) | | | |
