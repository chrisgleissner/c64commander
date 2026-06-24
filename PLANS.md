# Pixel 4 Exhaustive CTA Certification Plan

## Current Identity

- Branch: `test/full-cta-coverage`
- Git SHA: `414ec2a965d64651881c658cc5df772dd4ed934b`
- Working tree at continuation start: dirty; existing changes are preserved.
- Current APK build identity: `android/app/build/outputs/apk/debug/c64commander-0.8.9-414ec-debug.apk`, SHA-256 `b404778e5c617c203009a7b608dbca2149555a45dfdb9c1c21342c2af6225256`, built by `./build --skip-tests --install-apk --device-id 9B081FFAZ001WX`.
- Current installed package identity: `uk.gleissner.c64commander` versionName `0.8.9-414ec`, versionCode `2037`, firstInstallTime/lastUpdateTime `2026-06-24 22:52:18`, path `/data/app/~~AIeSfoxigZHXtD-Mo6Ky-g==/uk.gleissner.c64commander-ITET5_YkUO8PpJhMlS5JLA==/base.apk`.
- Pixel 4 target: `9B081FFAZ001WX`.
- Primary C64U target: `c64u`, password `pwd`, HTTP `80`, FTP `21`, Telnet `23`.
- Artifact root for this continuation: pending after fresh build/install timestamp, expected shape `c64scope/artifacts/cta-<UTC>Z-pixel4-c64u-414ec2a965d6/`.

## Active Phase

Interruption fixes before resuming Phase C/D: the Pixel 4 showed an empty Drive A/B `Mount disk` sheet after clean install, and the Disks `Add items` source picker exposed only Local and C64U while Play exposed CommoServe. These are now active Disks product defects under fix.

## Active Surface

- Route/page/overlay/flow/CTA group: Disks route, Drive A/B `Mount disk` sheet, disk library import flow, C64U `/USB2/test-data` disk corpus, CommoServe archive source.
- Product action path: existing `c64scope` runners using `DroidmindClient`; product key input must use `DroidmindClient.pressKey()`.
- Raw ADB scope: infrastructure identity, APK install, log capture, and package metadata only.

## Exhaustive Inventory Counts

- Runtime CTAs discovered on current APK: `199` discovery rows across `/current`, `/play`, `/disks`, `/config`, `/settings`, and `/docs`; discovery only.
- Runtime CTAs executed on current APK: current gate slices only; no exhaustive CTA execution ledger yet.
- Main flows proven on current APK: `1` (`C64U Save-and-Connect`).
- Unaccounted runtime CTAs: `199` until execution statuses are written; must finish at `0`.
- Untested main flows: Home, Play, Disks, Config, Settings, Docs, Diagnostics, Device Switcher, Licenses, native pickers, negative paths, lifecycle, performance, reliability, soak, cleanup.

## Remaining Untested CTAs

Unknown until all-route current-APK discovery completes. No discovered CTA may remain without a final row in `exhaustive-cta-ledger-3.md`.

## Remaining Untested Flows

- All-route clean-state discovery.
- All-route CTA execution, touch pass, keypad-first pass.
- Gate 3, Gate 4, Gate 5, Gate 6, Gate 6.5, Gate 7 re-run or superseded with deeper evidence.
- Home, Play, Disks, Config, Settings, Docs/Licenses, Diagnostics, Device Switcher, native picker deep dives.
- Negative-path matrix, lifecycle matrix, performance timings, reliability repetitions, background playback, soak.
- Cleanup and final state diff.

## Current Blockers

- The stricter prompt's named `final-report-2.md`, `cleanup-report-2.md`, `callback-8020-residual-risk.md`, and `cta-runner.md` are absent in the checkout; this is recorded as inherited artifact drift.
- Generic `scope:cta` still marks discovery rows `CALIBRATION_ONLY`; current certification cannot stop at that runner slice.
- First current-APK Gate 3 attempt reported `Offline, device not reachable`; Pixel-side HTTP health with `X-Password` succeeded and a redacted Gate 3 rerun proved app-driven recovery.
- Product defect under fix: Drive A/B `Mount disk` sheet was empty after clean install because it only listed the persisted disk library and exposed no in-sheet way to add disks. Fix in progress adds an in-sheet `Add disks` CTA and will be proven by importing C64U `/USB2/test-data` disk images and mounting at least one disk on Pixel 4.
- Product defect under fix: Disks `Add items` picker omitted CommoServe. Fix in progress shares Play's CommoServe archive source wiring with Disks and imports selected archive disk images into the disk library as runtime mountable local files.
- Gate 6.5 Config block was reclassified: direct clean Config navigation discovered 28 controls and showed connected `c64u`; the earlier block was caused by the stale empty Mount disk sheet swallowing `KEY_4`.

## Concrete Next Command Or DroidMind Action

1. Run targeted regression tests for the empty mount sheet Add disks CTA and Disks CommoServe source/import path.
2. Build and install the patched APK on Pixel 4.
3. Use DroidMind to verify the Disks Add items popup shows Local, C64U, and CommoServe.
4. Use DroidMind to import C64U `/USB2/test-data` disk images through the visible Add disks picker and mount a representative disk.
5. Resume all-route CTA execution and Disks deep dive from the corrected state.

## Cleanup Requirements

- Restore saved device to `c64u`.
- Restore host/password/HTTP/FTP/Telnet fields to `c64u`/`pwd`/`80`/`21`/`23`.
- Stop playback and clear temporary playlists.
- Eject test disks and restore drive state where safe.
- Restore theme, display profile, orientation, fullscreen options, and every app-local or C64 config setting changed during the run.
- Export final diagnostics, capture final screenshot/hierarchy, confirm app-visible connected state, and write `cleanup-report-3.md`.
