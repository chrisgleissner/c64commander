# S1-DISKS-MOUNT-EJECT-RESETS-C64U — Repeated Drive A mount/eject flow leaves C64U connection resetting

- ID: S1-DISKS-MOUNT-EJECT-RESETS-C64U
- Title: Repeated Drive A mount/eject flow leaves C64U connection resetting
- Severity: S1
- Priority: P0
- Product area: Disks / C64U drive control
- Route: Disks
- Overlay/dialog: Drive A `Mount disk` sheet
- CTA fingerprint: `Drive A Mount disk`, `Mount Boulder Dash 2.d64`, post-mount Eject control
- Control label: Drive A Mount disk / Boulder Dash 2.d64 / Eject
- Input method: Touch through `DroidmindClient`
- Build identity: `0.8.9-515e2`, APK SHA-256 `2f9b1569575eb6539509dc828ead4a220ac79ad516aa100fc4971635a0adea45`
- Git SHA: `515e2818ed1992dd6e3579470e1355488111278f`
- Pixel 4 identity: `9B081FFAZ001WX`
- Target identity: `c64u`, HTTP `80`, FTP `21`, Telnet `23`
- First reproduced UTC: `2026-06-25T00:30:28Z`
- Last reproduced UTC: `2026-06-25T00:31:49Z`
- Reproduction count: 1 run, failed on third mount attempt after two successful cycles
- Reproduction rate: 1/1 current-SHA Disks repetition loop
- Preconditions: App connected to `c64u`; disk library contains `/USB2/test-data/d64/Boulder Dash 2.d64`, `Frogger.d64`, and `interface-harness.d64`.
- Exact DroidMind semantic actions: Start app, navigate Disks, tap Drive A Mount disk, tap `Boulder Dash 2.d64`, wait, tap Eject, repeat. Third iteration tapped mount item and then failed to find Eject.
- Exact command: `node --input-type=module <droidmind-disks-mount-eject-loop script>`
- Expected result: Five safe Drive A mount/eject repetitions, each restoring `No disk mounted`, without degrading target connectivity.
- Actual result: Iterations 1 and 2 mounted/ejected successfully. Iteration 3 showed `No disk mounted` but app header red `C64U` with two issues and Drive A `Connection reset`. Direct authenticated `/v1/info` probe then failed with `curl: (56) Recv failure: Connection reset by peer`.
- User impact: Critical release risk. A normal repeated disk action path can reset the C64U connection and may indicate request pattern stress against the hardware.
- State before: App-visible `Connected to c64u, system healthy`; Drive A `No disk mounted`.
- State after: App-visible red C64U status with `Connection reset`; Drive A and Drive B both display `No disk mounted`; app stopped to prevent further target traffic.
- Recovery performed: Captured live screenshot/hierarchy, captured logcat, stopped the app. Did not continue `c64u` traffic after the failed health probe.
- Cleanup status: Disk media state appears restored (`No disk mounted` for Drive A and B), but C64U connection health is not restored in this run.
- Suspected component: Disks mount/eject request pattern or app polling during/after disk mount flow.
- Evidence supporting suspected component: Failure occurred immediately after app-driven repeated Drive A mount/eject flow; host authenticated `/v1/info` returned connection reset after the app showed `Connection reset`.
- Remaining uncertainty: Exact REST/FTP request sequence is not yet extracted from app diagnostics; app was stopped to protect the target before opening Diagnostics.
- Replay command: Re-run is unsafe until the request pattern is reviewed; do not replay against `c64u` without a safety change or explicit test window.
- Linked screenshots:
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/disks-mount-eject-loop/screenshots/iter-3-after-mount.png`
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/screenshots/disks-loop-connection-reset-live.png`
- Linked UI hierarchies:
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/disks-mount-eject-loop/hierarchies/iter-3-after-mount.xml`
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/hierarchies/disks-loop-connection-reset-live.xml`
- Linked `actions.jsonl`: Not emitted by this targeted loop.
- Linked `checkpoint.jsonl`: Not emitted by this targeted loop.
- Linked `coverage.json` row: Not part of final CTA coverage; targeted loop result is below.
- Linked `results.json` entry: `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/disks-mount-eject-loop/result.json`
- Linked `issue-groups.json`: `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/issue-groups.json`
- Linked logcat: `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/logcat/disks-loop-connection-reset.log`
- Linked DroidMind logs:
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/commands/droidmind-disks-mount-eject-loop.stdout.log`
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/commands/droidmind-preserve-disks-reset-and-stop.stdout.log`
- Linked C64Scope timeline: `disks-mount-eject-loop/steps.md`
- Linked C64Bridge log: not used
- Linked diagnostics export: not captured; app stopped to prevent further `c64u` traffic.
- Full stdout/stderr command log paths:
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/commands/droidmind-disks-mount-eject-loop.stdout.log`
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/commands/droidmind-disks-mount-eject-loop.stderr.log`
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/commands/target-health-after-disks-loop.stdout.log`
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/commands/target-health-after-disks-loop.stderr.log`
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/commands/droidmind-preserve-disks-reset-and-stop.stdout.log`
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/commands/droidmind-preserve-disks-reset-and-stop.stderr.log`
- Relevant log excerpts:
  - Iteration 1: `after eject text=No disk mounted`
  - Iteration 2: `after eject text=No disk mounted`
  - Iteration 3: `Eject control not found after mount`
  - Health probe: `curl: (56) Recv failure: Connection reset by peer`

## Fix Verification

Current status: `BLOCKED_WITH_EVIDENCE`, not closed. The underlying S1 failure remains open.

Mitigation implemented on current source/build `af2d795b2361cc78e52f3013cf3502c0e72c0375` / `0.8.9-af2d7`:

- Manual Disks mounts now request `readonly` mode instead of `readwrite`.
- Drive mount/eject handlers pause drive polling, cancel active drive queries, invalidate without immediate refetch, settle, and then release the polling pause.
- Current APK installed on Pixel 4: `android/app/build/outputs/apk/debug/c64commander-0.8.9-af2d7-debug.apk`, SHA-256 `e0f00bc9a9d595566df01b2eb1cfe63992dfc1611d4acce0fe4a21fa56af7891`.
- Installed package identity: versionName `0.8.9-af2d7`, versionCode `2042`, lastUpdateTime `2026-06-25 07:52:21`, signature short `d39d81d2`.

Validation:

- `npm run scope:check`: passed 55 files / 360 tests on current source.
- Focused Disks tests: passed 6 files / 94 tests.
- `npm run lint`: passed with existing c64scope coverage-helper warnings only.
- Prior full `npm run test`: passed 643 files / 7457 tests before the branch advanced to `af2d7`; focused current-HEAD tests above cover the touched Disks paths.

Pixel 4 current-build retest:

- Current status: `INCONCLUSIVE_NEEDS_REPLAY`.
- The apparent single-cycle proof under `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361/clean-readonly-mount-eject-2/` must not be counted as a valid clean mount proof. Later screenshot review showed `screenshots/disks-before-clean-mount.png` already had Drive A mounted with `/USB2/test-data/.../Boulder Dash 2.d64`, so the run did not start from `No disk mounted`.
- The repetition attempt under `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361/readonly-mount-eject-repetitions/` is also `INCONCLUSIVE_NEEDS_REPLAY`; stale coordinate fallback opened or stayed in the wrong surface and did not exercise the intended product mount/eject sequence.
- A corrected single-cycle attempt under `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361/corrected-readonly-cycle-1/` showed that Drive A was OFF and the disk action did not open the mount sheet. It ended with `No disk mounted`, but did not prove mount.
- Drive A power was restored to ON under `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361/restore-drive-a-power/`; the app then showed a C64U warning badge (`C64U ▲ 4`). Direct unauthenticated `http://c64u/v1/info` still returned expected HTTP `403` in about 8 ms, so the target was responsive but not app-clean.
- App-visible target was restored to `C64U` / `c64u` before warning diagnosis; evidence `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361/restore-c64u-final-state/home-after-c64u-final.png`.

Remaining verification gap:

- Diagnose or clear the app-visible C64U warning badge after Drive A power restore.
- Re-run Drive A readonly mount/eject from a verified clean state: `c64u` selected, healthy badge, Drive A ON, Drive A `No disk mounted`, and mount sheet opened through a semantic control.
- Do not count stale coordinate fallback runs as product coverage.

Closure requirement:

- Re-run five Drive A readonly mount/eject cycles with corrected semantic targeting or screenshot-verified active-surface coordinates.
- Keep this defect open until all five cycles restore `No disk mounted`, keep app-visible `Connected to c64u, system healthy`, and leave direct target health responsive.

## Current Replay Failure And Additional Hardening

Recorded UTC: `2026-06-25T08:04:19Z`.

Cycle 1 on `0.8.9-af2d7`:

- Status: `PROVEN` for one readonly key-driven Drive A mount/eject cycle.
- Mount evidence: `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361/readonly-cycle-key-1/`
- Eject evidence: `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361/readonly-cycle-key-1-eject/`
- Logcat showed `PUT http://c64u/v1/drives/a:mount?...mode=readonly` and `PUT http://c64u/v1/drives/a:remove`.
- Post-eject screenshot showed Drive A ON with `No disk mounted`; direct unauthenticated health returned expected HTTP `403`.

Cycle 2 on `0.8.9-af2d7`:

- Status: `FAILED`.
- Mount evidence: `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361/readonly-cycle-key-2/`
- Eject failure evidence: `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361/readonly-cycle-key-2-eject/`
- Before-eject screenshot `readonly-cycle-key-2-eject/screenshots/focus-up-from-b/09-LEFT.png` proves focus on `Drive A Eject disk`.
- `DroidmindClient.pressKey(DPAD_CENTER)` activated the focused eject CTA.
- Logcat `readonly-cycle-key-2-eject/logs/logcat/cycle-2-eject.log` shows `PUT http://c64u/v1/drives/a:remove` failed in 37 ms with `Connection reset`; the failure details included `idleMs=197050` and `wasIdle=true`.
- Post-action screenshot `readonly-cycle-key-2-eject/screenshots/03-after-eject-polling.png` showed the app on Home, `C64U` not connected, app `0.8.9-8a785` visible in the WebView, and device/firmware `Not connected`.
- The installed package identity at that moment was still `versionName=0.8.9-af2d7`, versionCode `2042`, so the visible `0.8.9-8a785` string is a separate build-identity anomaly to investigate during recovery.
- App was stopped through `DroidmindClient.stopApp`.
- Direct app-stopped probes continued failing with `curl: (56) Recv failure: Connection reset by peer`:
  - `readonly-cycle-key-2-eject/logs/commands/c64u-health-after-cycle-2.stdout.log`
  - `readonly-cycle-key-2-eject/logs/commands/c64u-health-recovery-1.stdout.log`
  - `readonly-cycle-key-2-eject/logs/commands/c64u-health-recovery-2.stdout.log`
  - `readonly-cycle-key-2-eject/logs/commands/c64u-health-recovery-3.stdout.log`
  - `readonly-cycle-key-2-eject/logs/commands/c64u-health-after-current-apk-install.stdout.log`

Additional source hardening now implemented but not device-validated:

- `src/lib/c64api.ts` adds `Connection: close` to native direct-device REST requests while leaving web/proxy requests unchanged. This targets stale native HTTP connection reuse after idle periods.
- Regression coverage: `tests/unit/c64api.branches.test.ts` test `closes native direct-device REST connections without changing web or proxy requests`.
- Validation:
  - `npm run test -- tests/unit/c64api.branches.test.ts`: passed 94 tests.
  - `npm run lint`: passed.
  - `npm run cap:build && npm run android:apk`: passed.
- Current installed APK: `android/app/build/outputs/apk/debug/c64commander-0.8.9-cf84d-debug.apk`, SHA-256 `462bfa1578c219d1f753311695688863c68bdda27480a449823ce60b36d49a07`, versionName `0.8.9-cf84d`, versionCode `2044`, lastUpdateTime `2026-06-25 09:01:54`, package stopped=true.

Recovery gate:

- Do not launch the app or continue C64U product validation while app-stopped direct health probes return connection reset.
- After target recovery, launch the stopped `0.8.9-cf84d` APK through DroidMind, prove the app-visible baseline, then retry five readonly Drive A mount/eject cycles from Drive A ON / `No disk mounted` / healthy `c64u`.

## Handover 7 Resume Block

Recorded UTC: `2026-06-25T12:23:41Z`.

Target health before app launch:

- Direct unauthenticated `http://c64u/v1/info` returned expected HTTP `403` in `0.008523s`.
- Evidence: `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361/s1-five-cycle-cf84d-resume/logs/commands/c64u-info.stdout.log`.

App launch and baseline:

- Launched installed `0.8.9-cf84d` with `DroidmindClient.startApp()`.
- The app opened a discovery interstitial showing `Ultimate 64 Elite · u64`; `u64` was not selected.
- After dismissing the interstitial through DroidMind, Home showed `App 0.8.9-cf84d Device Not connected Firmware Not connected` and `Unable to connect to C64U`.
- Drive readback visible in the same app state showed Drive A ON / `No disk mounted` and Drive B OFF / `No disk mounted`.
- A 12 second reconnect wait did not clear the app-visible `Not connected` state.

Target health after app-visible degradation:

- Direct unauthenticated `http://c64u/v1/info` still returned expected HTTP `403` in `0.009939s`.
- Evidence: `s1-five-cycle-cf84d-resume/logs/commands/c64u-info-after-app-not-connected.stdout.log`.

Safety decision:

- The required app-visible healthy `c64u` baseline was not present, so the five-cycle Drive A mount/eject replay was not attempted.
- The app was stopped with `DroidmindClient.stopApp()`.
- Package state after stop: versionName `0.8.9-cf84d`, versionCode `2044`, `stopped=true`.
- Result artifact: `s1-five-cycle-cf84d-resume/baseline-block-result.json`.

## Bug-Hunt Session Five-Cycle Replay — 2026-06-25T13:18–13:25Z

Run: `c64scope/artifacts/bughunt-20260625T125855Z-pixel4-c64u-cf84d8e565cb/`. Build `0.8.9-cf84d` (SHA-256 462bfa…, includes uncommitted `Connection: close`). c64u recovered by user (HTTP 403/7-8 ms before start). App-visible baseline proven healthy: badge `C64U ●` green, device `c64u`, firmware `1.1.0`, Drive A ON / No disk mounted, Drive B OFF / No disk mounted.

Five readonly Drive A mount/eject cycles (Boulder Dash 2.d64), each with before/after screenshots + hierarchies + per-step c64u health probe + device readback:

| Cycle | Mount ms | Mount result | Eject ms | c64u health each step | Drive A status after mount |
|---|---|---|---|---|---|
| 1 | 1774 | device mounted OK (readback image_file set) | 199 | 403 / 7-8 ms | **STUCK "Host unreachable"** (Drive B = OK) |
| 2 | 1269 | mounted OK | 150 | 403 / 7-8 ms | OK |
| 3 | 819 | mounted OK | 205 | 403 / 7-8 ms | OK |
| 4 | 990 | mounted OK | 259 | 403 / 7-8 ms | OK |
| 5 | 10032 then **UnknownHostException** (phone DNS blip) | mount FAILED, not mounted | n/a (mount failed) | 403 / 7-8 ms | **STUCK "Host unreachable"** (Drive B = OK) |

### Catastrophic aspect (this defect): NOT REPRODUCED
- Across 5 mounts + 4 ejects, **c64u never reset/dropped**; direct `GET /v1/info` returned HTTP 403 in 7–8 ms at every step; `GET /v1/drives` always served `errors: []`.
- No `Connection reset` in logcat (contrast the original repro). The `Connection: close` native-REST hardening in `src/lib/c64api.ts` (present in this APK) appears effective for the catastrophic connection-reset/device-down failure.
- Status: catastrophic reset **could not be reproduced** in rapid cycles. Caveat: the original failure was **idle-triggered** (`idleMs=197050, wasIdle=true`) on a post-idle eject; this session ran rapid cycles and did **not** specifically replay the ~200 s-idle-then-eject path. Recommend one dedicated idle-replay (mount → ~200 s idle with polling paused → eject) before formal closure.

### New residual defect found → see [[S2-DISKS-DRIVE-A-STATUS-STUCK-HOST-UNREACHABLE]]
- Intermittent (2/5): after a slow (cycle 1, 1774 ms successful) or failed (cycle 5, DNS) mount, `drive-status-a` sticks on "Host unreachable" while `drive-status-b` shows "OK" on the same page and the device is healthy. Cleared only by navigating away/back. This is an app-side per-drive status non-recovery bug, distinct from the catastrophic reset.

### Environmental observation
- Pixel 4 ↔ c64u link is flaky over WiFi: logcat shows WiFi scan/supplicant churn; one transient `UnknownHostException` for host `c64u` (cycle 5). Phone ping to c64u otherwise 0% loss, ~11 ms. This flakiness is the trigger for the S2 stuck-status; it is not a c64u or app fault per se, but the app's 10 s hang on the failed mount (no visible timeout/feedback) is a minor UX gap.

### Cleanup
Drive A left No disk mounted, status OK, badge green; device readback `image_file=''`.
