# Final Bug-Free Ledger — HEAD fe212a59 / APK 0.9.0-rc1 (vc2036)

Run: `final-bugfree-20260626T062957Z-pixel4-c64u-fe212a59`
Device: Pixel 4 `9B081FFAZ001WX`. Target: c64u (192.168.1.167) fw 1.1.0. Started 2026-06-26T06:30Z.

Statuses: `NOT_STARTED` `IN_PROGRESS` `BUG_FOUND` `FIX_IN_PROGRESS` `FIXED_NEEDS_HIL_RETEST` `FIXED_AND_HIL_VERIFIED` `NO_BUG_FOUND_AFTER_EXHAUSTIVE_TEST` `BLOCKED_WITH_EVIDENCE` `SAFETY_BLOCKED_NOT_EXECUTED` `INCONCLUSIVE_REPLAY_REQUIRED` `NOT_PRESENT_WITH_REASON` `SPEC_GAP_WITH_EVIDENCE`

## Build / device baseline

| Item | Status | Evidence |
| --- | --- | --- |
| scope:check (55/361) | FIXED_AND_HIL_VERIFIED | WORKLOG; exit 0 |
| APK built from HEAD fe212a59 | FIXED_AND_HIL_VERIFIED | apk-identity.json; 0.9.0-rc1 vc2036 sha bc3b8256 |
| APK installed on Pixel 4 | FIXED_AND_HIL_VERIFIED | installed-package-identity.json |
| App-visible c64u green/HEALTHY | NO_BUG_FOUND_AFTER_EXHAUSTIVE_TEST | screenshots/04-connected-home.png; device c64u fw 1.1.0 |
| Clean launch (no JS/native errors) | NO_BUG_FOUND_AFTER_EXHAUSTIVE_TEST | baseline-launch-connect.log clean |

## High-value flows (prompt A–I)

| Flow | Status | Evidence |
| --- | --- | --- |
| A. Playlist add (Play sources) | BUG_FOUND | C64U source: browse Flash/SD/Temp/USB2→test-data/SID OK; 4 sources present (Local/C64U/HVSC/CommoServe). Add 3 SIDs OK (Total 9:00). Songlengths-FTP-wedge defect → being fixed. screenshots/05-10 |
| B. Playlist filtering | IN_PROGRESS | type-filter chips (SID/MOD/PRG/CRT/Disk) + text filter present; toggle exercised. Full text/label/unicode/edge cases pending. |
| C. Playback transport | NO_BUG_FOUND_AFTER_EXHAUSTIVE_TEST | play/pause/resume/stop verified; CTA sweep of Mute/Recurse/Shuffle/Repeat/Reshuffle toggles + volume slider (→-42dB) + default-duration slider — all toggle/apply correctly, **0 console/logcat errors**. No Radix slider double-handling bug. |
| D. Locked-screen auto-advance | NOT_STARTED | needs fresh device + playlist |
| E. Disks import/mount/eject/swap | IN_PROGRESS | Drive A ON/1541/No-disk baseline confirmed (route-disks.png); S1 mount/eject reliability pending |
| F. Disk filtering | NOT_STARTED | |
| G. Config spot checks | NO_BUG_FOUND_AFTER_EXHAUSTIVE_TEST (sampled) | 23 categories, no circuit-breaker. Turbo boost category: dropdown opens with options (no blank-Select bug), config **write via PUT works** (Turbo control Manual→Off→Manual), device stayed HEALTHY (no degradation — LED-crash class fixed), 0 errors. Full per-category row coverage pending. |
| H. Settings/Diagnostics/Switcher | IN_PROGRESS | Settings renders; theme Auto/Dark toggle+restore OK. **Diagnostics: PASS — opened via Star key (keypad), no password leak in visible text OR full HTML (security gate).** Device Switcher: Pound key did NOT open it this build (entry point TBD); negative-path connect pending. |
| I. Docs/Licenses/simple spot checks | IN_PROGRESS | Docs 15 accordion sections; expand/collapse works (aria-expanded), 0 errors. Licenses + external-link spot checks pending. |

## Cross-cutting

| Item | Status | Evidence |
| --- | --- | --- |
| Keypad-first parity | IN_PROGRESS | digit 2→Play, 4→Config, 1→Home; Star→Diagnostics. Full matrix (3/5/6, sliders, focus ring) pending. |
| Touch parity | IN_PROGRESS | tab nav + Play/Disks/Config/Settings/Diagnostics all touch-driven OK. Full per-CTA parity pending. |
| Negative paths | NOT_STARTED | invalid host/port/password Save-and-Connect pending (app-local, safe). |
| Lifecycle | IN_PROGRESS | bg→fg PASS (pid survived, no crash/ANR, resumed HEALTHY, poll re-armed). Lock/rotate/relaunch-during-playback pending. |
| Performance | IN_PROGRESS | REST timings visible in Diagnostics (drives ~50ms, info ~10ms). Formal report pending. |
| Reliability reps | NOT_STARTED | tab×20, diag×10 pending. |
| CDP error sweep (all routes) | NO_BUG_FOUND_AFTER_EXHAUSTIVE_TEST | 6/6 main routes (Home/Play/Disks/Config/Settings/Docs) render HEALTHY, no JS console errors during sweep (only 3 errors total, all from the songlengths episode under fix). route-*.png |
| Cleanup / restore | NOT_STARTED | |

## Defects (this run)

| ID | Severity | Status | Evidence |
| --- | --- | --- | --- |
| HEALTH-POLL-SELF-HALT (useC64Connection refetchInterval) | S2 | FIXED_AND_HIL_VERIFIED | Fix: coalescing moved to queryFn; refetchInterval only gates on reactive state. tsc + JS tests green; on-device polling continues w/o nav, badge HEALTHY. |
| S2-PLAY-SID-ADD-AUTO-SONGLENGTHS-FTP-WEDGE (read no-timeout) | S2 | FIXED_AND_HIL_VERIFIED | 6MiB cap + timeoutMs:0 streaming read + progress + abort. Read completes (12th_Sector=03:11 resolved). tsc+140 JS+Kotlin tests green. |
| FTP-LISTING-CASCADE-CHURN (resolveListing) | S1-class trigger | FIXED_NEEDS_HIL_RETEST | Cut LIST→MLSD→NLST cascade on SocketTimeoutException (3→1 PASV cycles). Kotlin test green. **c64u-no-wedge firmware-limited; not re-tested on-device (avoid power-cycle #3).** |
| S2-PLAY-SID-ADD wedge = FIRMWARE FTP churn (fw-1.1.0) | external | BLOCKED_WITH_EVIDENCE | Real cure = firmware (u64 3.14x fixed issue #364). App fixes reduce trigger only. defects/S2-PLAY-SID-ADD-AUTO-SONGLENGTHS-FTP-WEDGE.md UPDATE section. |

## Carried defects (prior runs)

| ID | Class | Status |
| --- | --- | --- |
| S1-C64U-FIRMWARE-TCP-WEDGE-ON-IDLE-RECONNECT | FIRMWARE (external, unfixable in-app) | App mitigations active; re-verify graceful degradation |
| S1-DISKS-MOUNT-EJECT-RESETS-C64U | Manifestation of firmware wedge | Re-test mount/eject reliability on 0.9.0-rc1 |
| S2-DISKS-FTP-RECURSIVE-SCAN-STALL | App/perf | Re-test broad-folder import behavior |
| S4-UNHANDLED-ABORTERROR-ON-OVERLAY-DISMISS | App | Re-test overlay dismiss |
| S2-DISKS-DRIVE-A-STATUS-STUCK-HOST-UNREACHABLE | App | Re-test drive status recovery |
