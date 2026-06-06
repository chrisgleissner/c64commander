# C64 Commander Prod Hardening 7 Coverage

## Route-Level Coverage

| Route | C64U | Ultimate 64 | Android-only | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| Home | covered | blocked | n/a | partial pass | artifacts/screenshots/home-route3-20260605T232745.png |
| Play | covered read-only | blocked | n/a | partial pass | artifacts/screenshots/play-route3-20260605T232717.png |
| Disks | covered read-only | blocked | n/a | partial pass | artifacts/screenshots/disks-route3-20260605T232723.png |
| Config | covered read-only | blocked | n/a | partial pass | artifacts/screenshots/config-route3-20260605T232728.png |
| Settings | covered | blocked | covered | partial pass | artifacts/screenshots/settings-route3-20260605T232734.png |
| Docs | covered | blocked | covered | pass | artifacts/screenshots/docs-route3-20260605T232739.png |
| Open Source Licenses | n/a | n/a | covered | pass | artifacts/screenshots/diagnostics-share-all-20260605T233620.png |
| Diagnostics | covered | blocked | covered | pass | artifacts/screenshots/diagnostics-menu-20260605T233546.png |

## Feature-Level Coverage

| Feature | Coverage | Result | Notes |
| --- | --- | --- | --- |
| Pixel 4 deployment | yes | pass | Built, installed, launched. |
| App launch/resume | yes | pass | Foreground at final liveness. |
| C64U liveness | yes | pass | Baseline, c64scope preflight, final liveness all passed. |
| U64 liveness | yes | pass | Baseline, c64scope preflight, final liveness all passed. |
| C64U app workflows | partial | pass | Read-only and diagnostics workflows covered. |
| U64 app workflows | no | blocked | No saved u64 profile visible; UI edit not saved. |
| Saved-device switching | partial | blocked | Settings saved c64u inspected; switcher long-press not opened by adb. |
| Diagnostics overlay | yes | pass | Healthy, activity, filters, overflow menu visible. |
| Diagnostics export | partial | inconclusive | Share affordances visible; share handoff not completed. |
| Back navigation | partial | pass | Back closed diagnostics and licenses. |
| Playback | partial | inconclusive | Play route visible; no item played. |
| Disk mount/eject | no | blocked | Avoided mutation without test-owned fixture. |
| Config mutation | no | blocked | Avoided C64U config writes. |
| Device safety/back-off | partial | inconclusive | Safety/circuit-breaker UI observed; no stress/race testing. |

## Device-Level Coverage

| Device | Covered | Result | Notes |
| --- | --- | --- | --- |
| Pixel 4 | yes | pass | adb responsive, app installed and foregroundable. |
| Commodore 64 Ultimate | partial | pass | App connected as c64u; no degradation. |
| Ultimate 64 | liveness only | blocked for app workflows | Direct and c64scope preflight passed. |

## Agentic-Test Coverage

| Test family | Covered | Result | Notes |
| --- | --- | --- | --- |
| c64scope preflight | yes | pass | Run for u64 and c64u. |
| c64scope A/V capture | no | blocked | No safe playback fixture/session selected. |
| droidmind | no | blocked | Tooling unavailable in environment. |
| c64bridge | no | blocked | No direct gap-fill needed beyond curl liveness. |
| Maestro | discovered only | blocked | Harness clears app state and was not run. |
| Playwright | not applicable | not run | Web-only, not physical Android evidence. |

## Explicitly Not Tested

- C64U reset, reboot, power off, power cycle, RAM clear, and other destructive operations.
- Playback start/stop of real media.
- Stream start/stop.
- Disk mount/eject.
- Config writes and restoration.
- Slider coalescing under rapid input.
- Reconnect/discovery retry storms.
- Background/lock-screen playback.
- Full diagnostics export to a file destination.
- Ultimate 64 app-controlled workflows.
