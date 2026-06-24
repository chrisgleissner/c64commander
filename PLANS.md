# Pixel 4 Exhaustive CTA Certification Plan

## Current Identity

- Branch: `test/full-cta-coverage`
- Git SHA: `10c4b5e98510b3a4cd0afa824ca4ac34dcc71db9`
- Working tree: dirty with certification state-file/defect-report updates only.
- Current APK build identity: `android/app/build/outputs/apk/debug/c64commander-0.8.9-10c4b-debug.apk`, SHA-256 `38d17f562159101f340d729f4e93ba5c21e7885dd3ccf40b868c792432e71e6e`, built and installed by `./build --skip-tests --install-apk`.
- Current installed package identity: `uk.gleissner.c64commander` versionName `0.8.9-10c4b`, versionCode `2040`, firstInstallTime `2026-06-24 22:52:18`, lastUpdateTime `2026-06-25 00:17:22`, path `/data/app/~~U83Do-y3NWKqtU49tTBMPw==/uk.gleissner.c64commander-xwJ3ACWEBnM_ee8FAXUMiw==/base.apk`, signature short `d39d81d2`.
- Pixel 4 target: `9B081FFAZ001WX`.
- Primary C64U target: `c64u`, password `pwd`, HTTP `80`, FTP `21`, Telnet `23`.
- Artifact root for this continuation: `c64scope/artifacts/cta-20260624T231700Z-pixel4-c64u-10c4b5e98510/`.

## Active Phase

Interruption fixes before resuming Phase C/D: the Pixel 4 showed an empty/wrong Drive A/B `Mount disk` flow after clean install, and the Disks `Add items` source picker exposed only Local and C64U while Play exposed CommoServe. The current APK fixes both and the fixed Drive A sheet is proven populated from C64U `/USB2/test-data/d64`.

## Active Surface

- Route/page/overlay/flow/CTA group: Disks route, Drive A/B `Mount disk` sheet, disk library import flow, C64U `/USB2/test-data` disk corpus, CommoServe archive source; next route group is resumed all-route CTA execution.
- Product action path: existing `c64scope` runners using `DroidmindClient`; product key input must use `DroidmindClient.pressKey()`.
- Raw ADB scope: infrastructure identity, APK install, log capture, and package metadata only.

## Exhaustive Inventory Counts

- Runtime CTAs discovered on current APK: `295` discovery rows across `/current`, `/play`, `/disks`, `/config`, `/settings`, and `/docs`; discovery only. Route counts: Home `109`, Play `24`, Disks `40`, Config `28`, Settings `76`, Docs `18`.
- Runtime CTAs executed on current APK: current gate slices only; no exhaustive CTA execution ledger yet.
- Main flows proven on current APK: `3` (`C64U Save-and-Connect`; Disks Add items source picker includes CommoServe; Drive A mount sheet populated with imported C64U D64s).
- Unaccounted runtime CTAs: `295` until execution statuses are written; must finish at `0`.
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
- Fixed product defect: Drive A/B `Mount disk` sheet now exposes `Add disks` when empty and no longer opens the generic `All disks` overlay for drive-specific mounting; fixed proof shows `Mount disk to Drive A` populated with `Boulder Dash 2.d64`, `Frogger.d64`, and `interface-harness.d64`.
- Fixed product defect: Disks `Add items` picker includes CommoServe using the same archive source wiring as Play; targeted proof shows Local, C64U, and CommoServe in the Disks Add items popup.
- Open product defect: selecting the broad C64U folder `/USB2/test-data` for import stalls at `Scanning... 0 items` for at least 1m52s before manual cancel; importing specific D64 files from `/USB2/test-data/d64` succeeds.
- Gate 6.5 Config block was reclassified: direct clean Config navigation discovered 28 controls and showed connected `c64u`; the earlier block was caused by the stale empty Mount disk sheet swallowing `KEY_4`.

## Concrete Next Command Or DroidMind Action

1. Resume all-route CTA execution on APK `0.8.9-1ce6a`.
2. Re-run or supersede Gate 3, Gate 4, Gate 5, Gate 6, Gate 6.5, Gate 7, and keypad canary with current-SHA evidence.
3. Continue Disks deep dive from the corrected state: mount/eject repetitions, Drive B, filters, item actions, removal/cleanup, and disconnected behavior.
4. Continue Config, Play, Home, Settings, Docs/Licenses, Diagnostics, Device Switcher, native picker, negative-path, lifecycle, performance, reliability, and soak passes.

## Cleanup Requirements

- Restore saved device to `c64u`.
- Restore host/password/HTTP/FTP/Telnet fields to `c64u`/`pwd`/`80`/`21`/`23`.
- Stop playback and clear temporary playlists.
- Eject test disks and restore drive state where safe.
- Restore theme, display profile, orientation, fullscreen options, and every app-local or C64 config setting changed during the run.
- Export final diagnostics, capture final screenshot/hierarchy, confirm app-visible connected state, and write `cleanup-report-3.md`.
