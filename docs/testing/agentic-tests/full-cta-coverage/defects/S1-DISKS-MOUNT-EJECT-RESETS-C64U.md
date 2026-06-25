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

Current status: `IN_PROGRESS`, not closed.

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

Pixel 4 current-build proof:

- Single clean Drive A readonly mount/eject cycle from `No disk mounted`: `PROVEN`.
- Evidence root: `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361/clean-readonly-mount-eject-2/`.
- Result file: `clean-readonly-mount-eject-2/result.json`.
- Key evidence:
  - `screenshots/disks-before-clean-mount.png`
  - `screenshots/after-clean-readonly-mount.png`
  - `screenshots/after-clean-readonly-eject.png`
  - `logs/logcat/successful-single-cycle.raw.log`
- Observed result: after mount `bad=[]`, Eject visible, mounted text `/USB2/test-data/.../Boulder Dash 2.d64`; after eject `bad=[]`, `No disk mounted`, target `Connected to c64u, system healthy`.
- Direct unauthenticated `http://c64u/v1/info` probes before and after the clean pass returned expected HTTP `403` in about 8 ms, proving the target remained responsive without exposing credentials.

Remaining verification gap:

- Five-cycle reliability is not yet proven. The attempted repetition run under `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361/readonly-mount-eject-repetitions/` is `INCONCLUSIVE_NEEDS_REPLAY` because the harness used a stale coordinate fallback and did not exercise the intended mount/eject sequence. It must not be counted as product pass/fail.
- Final app-visible target was restored to `C64U` / `c64u` after the repetition harness drifted target selection; evidence `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361/restore-c64u-final-state/home-after-c64u-final.png`.

Closure requirement:

- Re-run five Drive A readonly mount/eject cycles with corrected semantic targeting or screenshot-verified active-surface coordinates.
- Keep this defect open until all five cycles restore `No disk mounted`, keep app-visible `Connected to c64u, system healthy`, and leave direct target health responsive.
