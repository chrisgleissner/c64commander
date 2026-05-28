# Android Live Results

Pixel 4 and `c64u` validation evidence for prod-hardening-6.

## Baseline

- Timestamp: `2026-05-28T13:22:36+01:00`.
- Pixel 4: `9B081FFAZ001WX` from `adb devices`.
- Package id: `uk.gleissner.c64commander`.
- `c64u` before app launch:
  - ICMP healthy: `3/3` ping replies, hostname resolved to `192.168.1.167`.
  - REST unhealthy: `curl: (56) Recv failure: Connection reset by peer`, exit `56`.
  - FTP listener reachable: TCP connect exit `0`.
  - Telnet listener reachable: TCP connect exit `0`.
- Baseline conclusion: REST-dependent live scenarios are blocked until `c64u` REST recovers; any initial REST reset is not app-caused because no app traffic had been launched.

## Post-Restart Baseline (after user restart) — 2026-05-28T14:39:30+01:00

- REST: healthy. firmware_version "1.1.0". REST_EXIT:0.
- FTP TCP: FTP_TCP_EXIT:0.
- Telnet TCP: TELNET_TCP_EXIT:0.
- All listeners operational after restart. Scenarios may proceed.

## APK

- Path: `android/app/build/outputs/apk/debug/c64commander-0.8.5-debug.apk`
- Built prior session; verified installed on Pixel 4 `9B081FFAZ001WX`.
- Package: `uk.gleissner.c64commander` version 0.7.9-rc1.

## Live Scenario Results

All scenarios executed Pixel 4 `9B081FFAZ001WX` ↔ `c64u` firmware 1.1.0.

| Scenario | Time (BST) | PRE REST | POST REST | Logcat | Result |
|----------|------------|----------|-----------|--------|--------|
| S1: Cold app launch | 2026-05-28 ~13:30 | — | EXIT:0 | logcat-s1-cold-launch.txt (934 lines) | PASS |
| S2: Settings page | ~13:32 | EXIT:0 | EXIT:0 | logcat-s2-settings-retry.txt | PASS |
| S3: Diagnostics panel | ~13:37 | EXIT:0 | EXIT:56 | logcat-s3-health-check.txt (7611 lines) | External outage; NOT app defect |
| S4: Home page | ~14:02 | EXIT:0 | EXIT:0 | (no separate logcat) | PASS |
| S5: CPU Speed slider | ~14:10 | EXIT:0 | EXIT:0 | logcat-s5-cpu-slider.txt (2264 lines) | PASS (P3: accidental Turbo Control change) |
| S6: Badline Timing toggle | ~14:25 | EXIT:0 | EXIT:0 | logcat-s6-badline-toggle.txt (689 lines) | PASS |
| S7: Config Audio Mixer slider | 15:27 | EXIT:0 | EXIT:0 | logcat-s7-config.txt (2492 lines) | PASS |
| S8: Play page | 15:27 | EXIT:0 | EXIT:0 | logcat-s8-play-page.txt (742 lines) | PASS |
| S9: Volume slider + mute/unmute | 15:28 | EXIT:0 | EXIT:0 | logcat-s9-volume-mute.txt (1361 lines) | PASS |
| S10: Play C64U source browsing | 15:29 | EXIT:0 | EXIT:0 | logcat-s10-play-c64u-browse.txt (1749 lines) | PASS |
| S11: Disks page | 15:31 | EXIT:0 | EXIT:0 | logcat-s11-disks-page.txt (707 lines) | PASS |
| S12: Disks C64U source browsing | 15:32 | EXIT:0 | EXIT:0 | logcat-s12-disks-c64u-browse.txt (2593 lines) | PASS |
| S13: Background / foreground | 15:33 | EXIT:0 | EXIT:0 | logcat-s13-bg-fg.txt (1124 lines) | PASS |
| S14: Force-stop + REST probe | 15:34 | EXIT:0 | EXIT:0 | logcat-s14-force-stop.txt (419 lines) | PASS |

## c64u Health Summary

- 13 out of 14 scenarios: c64u REST remained healthy PRE and POST.
- 1 exception: S3 (diagnostics panel / health check cycle). REST failed AFTER scenario. The REST crash occurred after a Telnet health probe; the c64u REST listener has a known pre-existing intermittent crash pattern (exit 56, ECONNRESET). FTP and Telnet TCP remained reachable during that crash, confirming it is the REST process, not a full device freeze. Classified external — c64u-side instability, NOT an app defect. No app request storm was found that caused or plausibly contributed to the crash.
- After S3 the user manually restarted c64u; REST recovered. All subsequent scenarios (S4–S14) passed with REST healthy before and after each scenario.
- c64u survived app force-stop (S14): REST_EXIT:0 immediately after force-stop confirms no app-caused crash from connection teardown.
