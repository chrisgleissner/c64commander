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
| F-CONN-2 | Home Device/Firmware row stuck on warm restart | DONE (code+tests) | `useC64Connection` invalidates `c64-info` when connection state transitions to `REAL_CONNECTED`, enabling Home `SystemInfo` to refresh after opportunistic promotion. Follow-up: the visible `/v1/info` query now uses user intent instead of background intent so Home metadata is not starved behind cold-boot request gating. Regression added in `useC64Connection.test.ts`. |
| F-CONN-3 | Diagnostics dialog header `u64 · Unknown` | DONE (code+tests) | Connection snapshot now carries live `/v1/info` `deviceInfo`; diagnostics maps it to `DeviceDetailInfo` and falls back to `deviceInfo.product` when saved-device product is empty. Regression added in `DiagnosticsDialog.test.tsx`. |

Phase 2 gate:
- [x] Targeted unit/integration tests pass: `npx vitest run tests/unit/connection/connectionManager.test.ts tests/unit/hooks/useC64Connection.test.ts tests/unit/components/diagnostics/DiagnosticsDialog.test.tsx tests/unit/hooks/useTelnetActions.test.tsx` (152 tests, 2026-05-17) and `npx vitest run tests/unit/hooks/useC64Connection.test.ts tests/unit/pages/home/components/SystemInfo.test.tsx tests/unit/connection/connectionManager.test.ts tests/unit/components/diagnostics/DiagnosticsDialog.test.tsx` (143 tests, 2026-05-18 after the visible-info intent fix).
- [x] `npm run lint` passes (2026-05-18; 3 existing warnings under `c64scope/coverage`)
- [ ] `npm run test:coverage` rerun deferred while Phase 3 is still in flight; last green coverage before the visible-info intent follow-up was 965 tests, 91.76 % branch coverage (2026-05-17).
- [x] Pixel 4 cold-launch at +3s: badge non-OFFLINE; Device/Firmware populated at +5s; warm restart keeps the same metadata. Evidence: `evidence/phase2-F-CONN-1-u64-cold-start-after-info-fallback.txt`, `evidence/phase2-F-CONN-1-u64-cold-3s-after-info-fallback.png`, `evidence/phase2-F-CONN-2-u64-cold-5s-after-info-fallback.png`, OCR companions, `evidence/phase2-F-CONN-2-u64-warm-start-after-info-fallback.txt`, `evidence/phase2-F-CONN-2-u64-warm-3s-after-info-fallback.png`, `evidence/phase2-F-CONN-2-u64-warm-5s-after-info-fallback.png`.

## Phase 3 — Transport overhead and log noise

| ID | Finding | Status | Notes / Evidence |
|---|---|---|---|
| F-HTTP-1 | CapacitorCookies per-request hop | DONE (code+tests+evidence) | `capacitor.config.json` already disabled `CapacitorCookies`, but Capacitor Android still registered the built-in cookie plugin and installed a process-wide `CookieHandler`. Added `android/app/src/main/java/uk/gleissner/c64commander/C64LanCookieBypassHandler.kt` and wrapped the default handler from `MainActivity` when cookies are disabled so `u64`/`c64u`/private-LAN requests bypass Capacitor cookies entirely. Latest 35 s Pixel 4 cold boot shows no `CapacitorCookies` traffic for C64U URLs; the only remaining line is plugin registration. Evidence: `evidence/phase3-F-HTTP-1-u64-cold-start-after-cookie-bypass.txt`, `evidence/phase3-F-HTTP-1-u64-cold-logcat-after-cookie-bypass.txt`, `evidence/phase3-F-HTTP-2-F-LOG-1-u64-cold-logcat-after-config-cache-reuse.txt`. |
| F-HTTP-2 | Cold-boot LED Strip config storm | DONE (code+tests+evidence) | Home/studio lighting now uses summary reads, skips enrichment, and defers keyboard controls until explicit user action. The remaining third LED fetch came from `useAppConfigState` reloading a category that Home had already fetched; the background snapshot now reuses `C64API`'s cached category payload before issuing another network read. Targeted Vitest regressions cover the cache-reuse path, and the latest Pixel 4 cold boot drops `LED Strip Settings` to 2 requests while `Keyboard Lighting` stays at 0. Evidence: `evidence/phase3-F-HTTP-2-F-LOG-1-u64-cold-5s-after-config-cache-reuse.png`, `evidence/phase3-F-HTTP-2-F-LOG-1-u64-cold-logcat-after-config-cache-reuse.txt`. |
| F-LOG-1 | `Msg: undefined` log spam | DONE (code+tests+evidence) | Root cause was native Telnet plugin methods resolving successful calls with no payload, which Capacitor logged as `undefined`. `TelnetSocketPlugin.connect` / `disconnect` / `send` now resolve `JSObject()` instead of bare `resolve()`, and `TelnetSocketPluginTest` asserts the empty object payloads. Evidence: targeted Android JVM run `./gradlew testDebugUnitTest --tests uk.gleissner.c64commander.TelnetSocketPluginTest` passed on 2026-05-18; Pixel 4 `u64` cold boot now logs 0 `Msg: undefined` lines in `evidence/phase3-F-HTTP-2-F-LOG-1-u64-cold-logcat-after-telnet-empty-result-fix.txt` with companion screenshot `evidence/phase3-F-HTTP-2-F-LOG-1-u64-cold-5s-after-telnet-empty-result-fix.png`. |
| F-LOG-2 | `triggerEvent` TypeError at cold boot | DONE (evidence) | Current Phase 3 cold-boot runs stay at 0 `triggerEvent` TypeError lines without further code changes after the cookie-bypass and Telnet-result fixes. Evidence: `evidence/phase3-F-HTTP-2-F-LOG-1-u64-cold-logcat-after-config-cache-reuse.txt`. |

Phase 3 gate:
- [x] 30 s Home idle: 0 `CapacitorCookies` lines for C64U URLs. Latest log still contains the expected plugin-registration line only: `evidence/phase3-F-HTTP-2-F-LOG-1-u64-cold-logcat-after-config-cache-reuse.txt`.
- [x] 30 s Telnet activity: 0 `Msg: undefined` lines. Evidence: `evidence/phase3-F-HTTP-2-F-LOG-1-u64-cold-logcat-after-telnet-empty-result-fix.txt`.
- [x] Cold-boot: 0 `triggerEvent` TypeError lines. Evidence: `evidence/phase3-F-HTTP-2-F-LOG-1-u64-cold-logcat-after-config-cache-reuse.txt`.
- [x] Cold-boot LED Strip Settings REST calls ≤ 2. Evidence: `evidence/phase3-F-HTTP-2-F-LOG-1-u64-cold-logcat-after-config-cache-reuse.txt`.

## Phase 4 — Interaction-aware background scheduling and MimeMap

| ID | Finding | Status | Notes / Evidence |
|---|---|---|---|
| F-RT-1 | Saved-device probes ignore polling-pause | DONE (code+tests+evidence) | `useSavedDeviceHealthChecks` now checks `pollingPauseRegistry` before starting background-maintenance cycles and cancels in-flight cycles when an interaction pause is acquired. Regression coverage landed in `tests/unit/hooks/useSavedDeviceHealthChecks.test.tsx`. Final Pixel 4 `u64` Home CPU-slider stress used a 30 s DevTools drag timed across the next 60 s background-maintenance tick; the post-start request slice contains only `u64` drive/config traffic and **0** secondary-device (`192.168.1.167`) requests while the slider release/REST-completed logs prove the interaction stayed active. Evidence: `evidence/phase4-F-RT-1-u64-home-cpu-slider-30s-request-trace-devtools-final.json`, `evidence/phase4-F-RT-1-u64-home-cpu-slider-30s-after-polling-pause-devtools-final.png`. |
| F-MIME-1 | MimeMap long monitor contention | DONE (code+tests+evidence) | `MainActivity` now starts an off-UI `MimeTypeMap` prewarm before the Capacitor bridge initializes, with direct helper tests in `MainActivityTest`. The initial Pixel 4 cold-boot smoke logged `MIME_COUNT=0` / `MIME_MAX_MS=0` and `TotalTime=569 ms`, and the broader repeat sweep held that result across three additional cold boots (`480 ms`, `492 ms`, `486 ms`; all `MIME_COUNT=0`, `MIME_MAX_MS=0`). Evidence: `evidence/phase4-F-MIME-1-u64-cold-logcat-after-mime-prewarm.txt`, `evidence/phase4-F-MIME-1-u64-cold-6s-after-mime-prewarm.png`, `evidence/phase4-F-MIME-1-u64-cold-repeat-summary-after-mime-prewarm.json`, plus per-run `run1..run3` JSON/logcat/screenshot artifacts. |

Phase 4 gate:
- [x] 30 s slider/volume stress: 0 saved-device probes during interaction. Evidence: `evidence/phase4-F-RT-1-u64-home-cpu-slider-30s-request-trace-devtools-final.json`.
- [x] Cold-boot MimeMap contention < 100 ms (or absent). Evidence: `evidence/phase4-F-MIME-1-u64-cold-repeat-summary-after-mime-prewarm.json` (`maxMimeMs=0`, `maxMimeEvents=0` across three cold launches).

## Phase 5 — Hypothesis verification

| ID | Hypothesis | Status | Notes |
|---|---|---|---|
| H-VOL-1 | Rapid mute/unmute/mute lands intermediate state | DONE (falsified by tests) | Added `useVolumeOverride` regression coverage showing the latest manual mute intent stays authoritative even when stale device sync still reports the prior unmuted mixer state. Evidence: `npx vitest run tests/unit/playFiles/useVolumeOverride.test.tsx` (35 tests, 2026-05-18). |
| H-VOL-2 | `handleVolumeDraftChange` discards draft when snapshot missing | DONE (falsified by tests) | Added `useVolumeOverride` regression coverage showing unmute still restores the latest muted draft target via `previousVolumeIndexRef` even when `manualMuteSnapshotRef` is cleared. Evidence: `npx vitest run tests/unit/playFiles/useVolumeOverride.test.tsx` (35 tests, 2026-05-18). |
| H-PLAY-1 | `handleStop` 3 s reset vs Telnet contention emits false toasts | DONE (code+tests) | `handleStop` now wraps reset/reboot inside a machine-transition pause and extends the stop grace period to 6 s so a queued reset/reboot no longer emits a false `Stop failed` toast at ~3.5 s. Regression coverage added for both reset and reboot branches. Evidence: `npx vitest run tests/unit/playFiles/usePlaybackController.test.tsx` (45 tests, 2026-05-18). |
| H-RT-2 | App pause/resume during cold boot prolongs DISCOVERING | DONE (falsified by tests) | Added startup coverage proving `discoverConnection(\"resume\")` follows the shared discovery path and reconnects to `REAL_CONNECTED` when the next probe succeeds after an offline startup timeout. Evidence: `npx vitest run tests/unit/connection/connectionManager.startup.test.ts` (4 tests, 2026-05-18). |

Phase 5 gate:
- [x] Volume hypothesis regressions/falsifications pass: `npx vitest run tests/unit/playFiles/useVolumeOverride.test.tsx` (35 tests, 2026-05-18).
- [x] Stop-path regression passes for delayed reset/reboot completion: `npx vitest run tests/unit/playFiles/usePlaybackController.test.tsx` (45 tests, 2026-05-18).
- [x] Resume discovery hypothesis falsification passes: `npx vitest run tests/unit/connection/connectionManager.startup.test.ts` (4 tests, 2026-05-18).

## Phase 6 — Full validation sweep

Per-finding evidence in `evidence/phase<N>-<finding-id>-<host>-<artifact>`.

Phase 6 gate:
- [x] `npm run lint` passes after extending `.prettierignore` to keep the repo-wide TS/JSON sweep out of hidden tooling directories (`.kilo/`, `.opencode/`, `.venv/`).
- [x] `npm run test` passes: 555 files / 6396 tests green on 2026-05-18.
- [x] `npm run test:coverage` passes with thresholds intact: 94.20 % statements, 91.75 % branches, 90.67 % functions, 94.20 % lines on 2026-05-18.
- [x] `npm run build` passes on 2026-05-18.
- [x] `npm run cap:sync` and `npm run android:apk` pass on 2026-05-18.
- [x] Fresh debug APK installs on Pixel 4 (`9B081FFAZ001WX`) and cold-launches into `uk.gleissner.c64commander/.MainActivity` with `TotalTime: 638 ms`. The post-install WebView route probe also reached `/play` and rendered the Play Files shell with the `u64` health badge. Evidence: `evidence/phase6-u64-home-after-final-install.png`, `evidence/phase6-u64-home-after-final-install.txt`, `evidence/phase6-u64-play-after-final-install.png`.
- [ ] `c64u` cross-device sweep remains blocked because `/v1/info` still resets the connection.

## Pixel 4 deploy log

| When | APK | TotalTime | Notes |
|---|---|---|---|
| 2026-05-17 22:23 | `android/app/build/outputs/apk/debug/c64commander-0.7.9-rc1-debug.apk` | 583 ms | Initial Phase 1 soak failed: Home badge `U64 · 1 UNHEALTHY`; diagnostics showed active-device `useTelnetActions` capability discovery `Read failed: Not connected`. Failure evidence retained under `evidence/phase1-F-DIAG-1-u64-*failed*` and initial `home-60s.png`/`logcat.txt`. |
| 2026-05-17 22:44 | `android/app/build/outputs/apk/debug/c64commander-0.7.9-rc1-debug.apk` | 614 ms | Rebuilt after Telnet scheduler fix; 60 s u64 Home soak passed with `U64 · HEALTHY`. Known Phase 3 `Msg: undefined` spam remains in logcat. |
| 2026-05-18 08:53 | `android/app/build/outputs/apk/debug/c64commander-0.7.9-rc1-debug.apk` | 620 ms cold / 36 ms hot | Rebuilt after switching the visible `/v1/info` query to user intent. Cold +3s/+5s and hot restart both show `U64 · HEALTHY`, `Device u64`, `Firmware 3.14e`. Evidence retained under `evidence/phase2-F-CONN-*-after-info-fallback*`. |
| 2026-05-18 09:07 | `android/app/build/outputs/apk/debug/c64commander-0.7.9-rc1-debug.apk` | 592 ms cold | Rebuilt after installing the LAN cookie bypass handler. Pixel 4 cold boot against `u64` now logs 0 `CapacitorCookies` lines and 0 `triggerEvent` lines, but `Msg: undefined` still appears 10 times in the first 12 s. Evidence retained under `evidence/phase3-F-HTTP-1-u64-cold-*-after-cookie-bypass*`. |
| 2026-05-18 09:39 | `android/app/build/outputs/apk/debug/c64commander-0.7.9-rc1-debug.apk` | 602 ms cold | Rebuilt after changing `TelnetSocketPlugin` success paths to resolve `JSObject()` payloads. Pixel 4 cold boot against `u64` now logs 0 `Msg: undefined` lines and 0 `triggerEvent` lines; remaining Phase 3 blocker is still 3 `LED Strip Settings` requests during cold boot. Evidence retained under `evidence/phase3-F-HTTP-2-F-LOG-1-u64-cold-*-after-telnet-empty-result-fix*`. |
| 2026-05-18 09:48 | `android/app/build/outputs/apk/debug/c64commander-0.7.9-rc1-debug.apk` | 604 ms cold | Rebuilt after teaching the background app-config snapshot to reuse cached category payloads before re-fetching them. Pixel 4 cold boot against `u64` now logs `LED_STRIP_CALLS=2`, `KEYBOARD_LIGHTING_CALLS=0`, `MSG_UNDEFINED=0`, and `TRIGGEREVENT=0`; only the expected `CapacitorCookies` plugin-registration line remains. Evidence retained under `evidence/phase3-F-HTTP-2-F-LOG-1-u64-cold-*-after-config-cache-reuse*`. |
| 2026-05-18 10:00 | `android/app/build/outputs/apk/debug/c64commander-0.7.9-rc1-debug.apk` | 569 ms cold | Rebuilt after adding the off-UI `MimeTypeMap` prewarm and polling-pause awareness for saved-device background checks. Initial Pixel 4 cold boot smoke logged `MIME_COUNT=0` / `MIME_MAX_MS=0`; saved-device slider-stress evidence is still pending before Phase 4 can close. Evidence retained under `evidence/phase4-F-MIME-1-u64-cold-*-after-mime-prewarm*`. |
| 2026-05-18 13:19 | `android/app/build/outputs/apk/debug/c64commander-0.7.9-rc1-debug.apk` | 638 ms cold | Final Phase 6 closeout install after Phase 5 verification and the full repo gates. Fresh APK installed successfully, `u64` was reachable as `Ultimate 64 Elite` / fw `3.14e`, the app foregrounded into `MainActivity`, and a WebView route probe confirmed the Play Files surface rendered on-device. Evidence retained under `evidence/phase6-u64-home-after-final-install.*` and `evidence/phase6-u64-play-after-final-install.png`. |

## u64 + c64u real-device validation log

| Finding | u64 result | c64u result | Evidence |
|---|---|---|---|
| F-DIAG-1/F-DIAG-2/F-DIAG-3 | PASS: `u64` reachable (`Ultimate 64 Elite`, fw `3.14e`), Pixel 4 Home soak remains `U64 · HEALTHY` after 60 s. | BLOCKED: `/v1/info` on `c64u` resets connection. | `evidence/phase1-F-DIAG-1-u64-home-60s-after-telnet-scheduler.png`, `evidence/phase1-F-DIAG-1-u64-logcat-after-telnet-scheduler.txt` |
| F-CONN-1/F-CONN-2/F-CONN-3 | PASS: cold launch and hot restart on Pixel 4 both show non-OFFLINE `U64 · HEALTHY` with Home metadata populated (`Device u64`, `Firmware 3.14e`). | BLOCKED: `/v1/info` on `c64u` still resets the connection, so the secondary-device validation remains unavailable. | `evidence/phase2-F-CONN-1-u64-cold-start-after-info-fallback.txt`, `evidence/phase2-F-CONN-1-u64-cold-3s-after-info-fallback.png`, `evidence/phase2-F-CONN-2-u64-cold-5s-after-info-fallback.png`, `evidence/phase2-F-CONN-2-u64-warm-start-after-info-fallback.txt`, `evidence/phase2-F-CONN-2-u64-warm-3s-after-info-fallback.png`, `evidence/phase2-F-CONN-2-u64-warm-5s-after-info-fallback.png` |
| F-HTTP-1/F-HTTP-2/F-LOG-1/F-LOG-2 | PASS: latest Pixel 4 `u64` cold boot holds Phase 3 targets with 2 `LED Strip Settings` requests, 0 `Keyboard Lighting` requests, 0 `Msg: undefined`, and 0 `triggerEvent` TypeErrors in the 35 s capture; only the expected `CapacitorCookies` plugin-registration line remains. | BLOCKED: `/v1/info` on `c64u` still resets the connection, so no secondary-device comparison run was available. | `evidence/phase3-F-HTTP-2-F-LOG-1-u64-cold-5s-after-config-cache-reuse.png`, `evidence/phase3-F-HTTP-2-F-LOG-1-u64-cold-logcat-after-config-cache-reuse.txt` |
| F-RT-1/F-MIME-1 | PASS: Phase 4 closes on `u64`; a timed 30 s Home CPU-slider drag suppressed all secondary-device background probes after the interaction window started, and four cold-boot samples held `MimeMap` contention at 0 ms / 0 events. | BLOCKED: `/v1/info` on `c64u` still resets the connection, so the secondary-device comparison run remains unavailable. | `evidence/phase4-F-RT-1-u64-home-cpu-slider-30s-request-trace-devtools-final.json`, `evidence/phase4-F-RT-1-u64-home-cpu-slider-30s-after-polling-pause-devtools-final.png`, `evidence/phase4-F-MIME-1-u64-cold-repeat-summary-after-mime-prewarm.json` |
| H-VOL-1/H-VOL-2/H-PLAY-1/H-RT-2 + Phase 6 closeout | PASS: Phase 5 verification is locked in by targeted regressions, and the final Phase 6 APK install/launch on Pixel 4 foregrounded the app against a reachable `u64` with no fatal launch exceptions in the captured logcat. The post-install route probe also reached `/play` and rendered the Play Files shell on-device. | BLOCKED: `/v1/info` on `c64u` still resets the connection, so no secondary-device comparison run was available. | `evidence/phase6-u64-home-after-final-install.png`, `evidence/phase6-u64-home-after-final-install.txt`, `evidence/phase6-u64-play-after-final-install.png` |
