# C64 Commander Prod Hardening 7 Findings

## Executive Summary

- Build deployed: yes
- Pixel 4 usable: yes
- Ultimate 64 reachable at start: yes
- Ultimate 64 reachable at end: yes
- Commodore 64 Ultimate reachable at start: yes
- Commodore 64 Ultimate reachable at end: yes
- Commodore 64 Ultimate degraded during run: no
- Testing continued on Ultimate 64 after C64U degradation: not applicable
- App remained responsive: yes for covered routes and diagnostics
- User-visible errors: 0
- Log-only errors: 0
- P0 findings: 0
- P1 findings: 0
- P2 findings: 0
- P3 findings: 0
- Agentic tests run: 2 c64scope preflights
- Overall verdict: inconclusive, because Ultimate 64 app-driven workflows and destructive/mutation-heavy workflows were blocked or intentionally not run

## Environment

- Repository path: /home/chris/dev/c64/c64commander
- Branch: fix/stabilization
- Commit: 95ec058878ff72771912c7828cf22712b5c67fdb
- Package manager: npm, package-lock.json
- Node version: v24.11.0
- Android build command: ./build --skip-install --skip-tests --skip-format --install-apk --device-id 9B081FFAZ001WX
- APK path: android/app/build/outputs/apk/debug/c64commander-0.8.6-rc1-debug.apk
- Pixel 4 model: Pixel 4
- Android version: 16, API 36
- App package id: uk.gleissner.c64commander
- App version/build: 0.8.6-rc1, versionCode 1988, Git ID 95ec0588 shown in About
- Ultimate 64 target description: hostname u64, product Ultimate 64 Elite, firmware 3.14e
- Commodore 64 Ultimate target description: hostname c64u, product C64 Ultimate, firmware 1.1.0
- Test tools used: adb, curl, repository ./build helper, c64scope preflight, Android screencap, UIAutomator dump, logcat

## Documents Read

- README.md
- .github/copilot-instructions.md
- docs/architecture.md
- docs/features-by-page.md
- docs/testing/agentic-tests/agentic-test-architecture.md
- docs/testing/agentic-tests/agentic-feature-surface.md
- docs/testing/agentic-tests/agentic-coverage-matrix.md
- docs/testing/agentic-tests/agentic-action-model.md
- docs/testing/agentic-tests/agentic-oracle-catalog.md
- docs/testing/agentic-tests/agentic-safety-policy.md
- docs/testing/agentic-tests/agentic-android-runtime-contract.md
- docs/testing/agentic-tests/agentic-observability-model.md
- docs/testing/agentic-tests/agentic-infrastructure-reuse.md
- docs/testing/agentic-tests/agentic-open-questions.md
- docs/testing/agentic-tests/c64scope-spec.md
- docs/testing/agentic-tests/c64scope-delivery-prompt.md
- .github/prompts/agentic-test.prompt.md
- .opencode/agents/c64-agentic-tester.md

## Build And Deployment

Command: ./build --skip-install --skip-tests --skip-format --install-apk --device-id 9B081FFAZ001WX

Result: success. The APK installed via streamed install and the helper launched the app. The build log contains Kotlin/Java deprecation warnings but no build failure.

Evidence:

- Build log: docs/research/stabilization/prod-hardening-7/artifacts/logs/build-deploy-20260605T232135.txt
- Build summary: docs/research/stabilization/prod-hardening-7/artifacts/logs/build-deploy-summary-20260605T232253.txt
- Post-deploy state: docs/research/stabilization/prod-hardening-7/artifacts/logs/post-deploy-android-20260605T232253.txt
- Startup screenshot: docs/research/stabilization/prod-hardening-7/artifacts/screenshots/startup-20260605T232253.png

## Device Liveness Timeline

| Time | Device | Probe method | Result | Latency | Notes | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-06-05T23:21:08+01:00 | Pixel 4 | adb devices/getprop/dumpsys | pass | n/a | Pixel 4 serial 9B081FFAZ001WX authorized, battery 100% | docs/research/stabilization/prod-hardening-7/artifacts/logs/baseline-android-20260605T232108.txt |
| 2026-06-05T23:21:08+01:00 | Ultimate 64 | curl http://u64/v1/info | pass HTTP 200 | 0.061s | Ultimate 64 Elite firmware 3.14e | docs/research/stabilization/prod-hardening-7/artifacts/logs/baseline-liveness-20260605T232108.txt |
| 2026-06-05T23:21:08+01:00 | Commodore 64 Ultimate | curl http://c64u/v1/info | pass HTTP 200 | 0.043s | C64 Ultimate firmware 1.1.0 | docs/research/stabilization/prod-hardening-7/artifacts/logs/baseline-liveness-20260605T232108.txt |
| 2026-06-05T23:34:55+01:00 | Ultimate 64 | c64scope preflight | pass | not reported | Preflight READY | docs/research/stabilization/prod-hardening-7/artifacts/logs/c64scope-preflight-u64-20260605T233442.txt |
| 2026-06-05T23:35:20+01:00 | Commodore 64 Ultimate | c64scope preflight | pass | not reported | Preflight READY | docs/research/stabilization/prod-hardening-7/artifacts/logs/c64scope-preflight-c64u-20260605T233508.txt |
| 2026-06-05T23:36:58+01:00 | Ultimate 64 | curl http://u64/v1/info | pass HTTP 200 | 0.014s | Final liveness healthy | docs/research/stabilization/prod-hardening-7/artifacts/logs/final-liveness-20260605T233655.txt |
| 2026-06-05T23:36:59+01:00 | Commodore 64 Ultimate | curl http://c64u/v1/info | pass HTTP 200 | 0.012s | Final liveness healthy | docs/research/stabilization/prod-hardening-7/artifacts/logs/final-liveness-20260605T233655.txt |

## Commodore 64 Ultimate Degradation Continuity

No Commodore 64 Ultimate degradation occurred. Coverage performed against C64U included app launch, Home, Play, Disks, Config, Settings, Docs, Licenses, diagnostics overlay, diagnostics overflow inspection, low-frequency direct /v1/info liveness probes, and c64scope preflight. The C64U remained reachable at the end of the run.

The continuity rule was not triggered. No reboot, power cycle, reset, clear memory, destructive disk action, rapid reconnect loop, or stress/request storm was performed.

## Safety And Back-Off Observations

- The diagnostics overlay reported Healthy for c64u and exposed activity entries with REST timings.
- Diagnostics showed request activity such as GET c64u /v1/drives and GET c64u /v1/info at ordinary user-driven cadence, not high-rate loops.
- Settings exposed safety/circuit-breaker related text, including a checked control for user-triggered actions and circuit-breaker protection.
- The app remained responsive during route changes and diagnostics opening.
- No AndroidRuntime, fatal exception, ANR, exception, error, or warning candidates were found in the captured logcat summary.
- Slider/race behavior, destructive-action serialization, and high-rate reconnect back-off were not stress-tested because the run avoided request-intensive behavior on the fragile C64U.

## Manual Exploration Coverage Summary

| Page | Device | Workflow | Covered | Result | Evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Home | C64U | Launch, connection badge, quick actions visible, quick config visible | yes | pass | docs/research/stabilization/prod-hardening-7/artifacts/screenshots/home-route3-20260605T232745.png | Destructive Reset/Reboot/Power Off not tapped. Initial Device/Firmware Not available was transient and later resolved. |
| Play | C64U | Transport controls, volume, playlist empty state, Add items affordance | partial | pass | docs/research/stabilization/prod-hardening-7/artifacts/screenshots/play-route3-20260605T232717.png | Playback not started; no safe item was selected. |
| Disks | C64U | Drive state and disk section visible | partial | pass | docs/research/stabilization/prod-hardening-7/artifacts/screenshots/disks-route3-20260605T232723.png | Mount/eject not performed. |
| Config | C64U | Category list and search visible | partial | pass | docs/research/stabilization/prod-hardening-7/artifacts/screenshots/config-route3-20260605T232728.png | No config mutation performed. |
| Settings | C64U | Appearance, saved device, connection fields, diagnostics, safety/about | yes | pass | docs/research/stabilization/prod-hardening-7/artifacts/logs/diagnostics-settings-artifacts.csv | Only one saved c64u entry was visible. |
| Docs | C64U | Docs route and sections visible | yes | pass | docs/research/stabilization/prod-hardening-7/artifacts/screenshots/docs-route3-20260605T232739.png | Expand actions not performed beyond route inspection. |
| Open Source Licenses | Android-only | License content loads | yes | pass | docs/research/stabilization/prod-hardening-7/artifacts/screenshots/diagnostics-share-all-20260605T233620.png | Page rendered bundled third-party notices. |
| Diagnostics | C64U | Overlay, activity, overflow views/share/clear menu | yes | pass | docs/research/stabilization/prod-hardening-7/artifacts/screenshots/diagnostics-menu-20260605T233546.png | Clear all not used. Share all affordance observed but handoff not proven. |
| Device switcher | C64U/U64 | Header long-press switcher | blocked | inconclusive | docs/research/stabilization/prod-hardening-7/artifacts/screenshots/device-switcher-20260605T232925.png | adb long-press did not open switcher; likely automation limitation. |
| Ultimate 64 app workflows | Ultimate 64 | App-driven switching and workflows | blocked | inconclusive | docs/research/stabilization/prod-hardening-7/artifacts/logs/switch4-artifacts.csv | No separate u64 saved profile was visible; blind hostname edit was not saved. Direct U64 liveness passed. |

## Agentic Test Summary

| Test | Device | Command/tool | Result | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| c64scope preflight | Ultimate 64 | ANDROID_SERIAL=9B081FFAZ001WX C64U_HOST=u64 npm run scope:preflight | pass | docs/research/stabilization/prod-hardening-7/artifacts/logs/c64scope-preflight-u64-20260605T233442.txt | Low-risk readiness/liveness check only. |
| c64scope preflight | Commodore 64 Ultimate | ANDROID_SERIAL=9B081FFAZ001WX C64U_HOST=c64u npm run scope:preflight | pass | docs/research/stabilization/prod-hardening-7/artifacts/logs/c64scope-preflight-c64u-20260605T233508.txt | Low-risk readiness/liveness check only. |

## Findings

No P0, P1, P2, or P3 product findings were confirmed in this run.

## Non-Finding Reviewed Anomalies

- NF-001: Home initially displayed Device and Firmware as Not available while the badge was Healthy. Later Home capture showed c64u and firmware 1.1.0, so this was treated as startup/transient state rather than a confirmed defect.
- NF-002: Early route taps stayed on Home and opened a quick-config dropdown. Root cause was adb coordinate scaling on a 1080x2280 Pixel 4; corrected physical coordinates navigated successfully.
- NF-003: Header long-press did not open the device switcher via adb. Because normal tap opened diagnostics and adb long-press can be unreliable against WebView content, this was classified as automation-blocked, not a product finding.
- NF-004: Diagnostics Share all handoff was not proven because the active state was the Licenses page after prior navigation. The diagnostics overflow menu did show Share all and Share filtered affordances.
- NF-005: Build emitted Kotlin/Java deprecation warnings. These did not affect build/deploy and are not tied to observed runtime behavior.

## Final Device State

- Pixel 4: adb responsive, app foregroundable.
- App: C64 Commander installed and launched, package uk.gleissner.c64commander, version 0.8.6-rc1.
- Ultimate 64: reachable at final liveness, HTTP 200 from /v1/info.
- Commodore 64 Ultimate: reachable at final liveness, HTTP 200 from /v1/info.
- Playback: no playback started by this run.
- Streams: no streams started by this run.
- Settings changed and restored: no saved setting was intentionally saved or changed.
- Settings not restored and why: none known from saved app actions; blind hostname edit attempts were not saved.

## Blockers And Limitations

- Ultimate 64 app-driven coverage was blocked because only a c64u saved device was visible and reliable UI hostname editing was not completed.
- Device switcher long-press was blocked by adb/WebView long-press reliability.
- Broad Maestro flows were not run because the repository harness clears app data and can drive broader scripted flows than the conservative no-data-loss discovery policy allowed.
- Playback item selection, disk mount/eject, stream start/stop, config mutation, pause/resume machine control, and high-rate back-off/race tests were intentionally not run for safety.
- Diagnostics export handoff was only partially covered; export menu affordances were observed but a file/share destination was not completed.
- c64scope A/V capture sessions were not run; only preflight was used.

## Recommended Follow-Up

- Add a dedicated saved u64 profile before the next hardware run, or provide a documented non-destructive profile-selection fixture.
- Add a reliable adb/Maestro selector path for the device switcher and Settings connection form.
- Run a separate, explicitly approved safe playback/disk/config mutation pass with known test-owned media and disk fixtures.
- Add a diagnostics export case that saves to a deterministic local path rather than depending on Android share-sheet interaction.
