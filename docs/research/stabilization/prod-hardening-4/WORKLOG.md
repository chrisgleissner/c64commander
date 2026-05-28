# Production Hardening 4 - Worklog

## 2026-05-28 07:17 UTC - Start and classification

- Classified the task as `CODE_CHANGE` with required tests, lint, build, coverage, Android APK deploy, and hardware/mobile validation evidence.
- Screenshot regeneration is not planned because the requested fixes should not alter documented visible UI.

## 2026-05-28 07:18 UTC - Required reading

- Read `.github/copilot-instructions.md`.
- Read `AGENTS.md`.
- Checked for `CLAUDE.md`; none was present.
- Read `docs/research/stabilization/prod-hardening-4/research.md`.
- Read `docs/research/stabilization/prod-hardening-3/results.md`.
- Read `docs/architecture.md`.
- Attempted full reads of large `docs/research/stabilization/prod-hardening-3/prompt.md` and `docs/features-by-page.md`; continuing with targeted ranges/searches before implementation.

## 2026-05-28 07:19 UTC - Initial plan

- Created `PLANS.md` with the authoritative execution plan.
- Created this `WORKLOG.md`.

## 2026-05-28 07:20-07:55 UTC - Inspection and implementation

- Inspected the FTP path through `src/lib/ftp/ftpClient.ts`, `src/lib/deviceInteraction/deviceInteractionManager.ts`, and `android/app/src/main/java/uk/gleissner/c64commander/FtpClientPlugin.kt`.
- Implemented explicit FTP timeout split:
  - JS wrapper default `FTP_CONNECT_TIMEOUT_MS = 1500`.
  - Android native default connect timeout `1500 ms`.
  - Android native transfer/read/data timeout remains `8000 ms` by default.
- Implemented one bounded transient FTP retry in `withFtpInteraction`, using the existing gateway/circuit path and no bypass flag.
- Added per-host FTP connect pacing for list/read/write attempts, including retry attempts.
- Inspected `src/pages/playFiles/hooks/usePlaybackController.ts` and implemented a 120 ms user-only transport coalescer for manual Next/Previous.
- Preserved the auto-advance path outside coalescing.
- Inspected `src/pages/PlayFilesPage.tsx` and changed `backgroundAutoSkipDue` listener registration to stable refs for volatile state/callbacks.

## 2026-05-28 07:55-08:02 UTC - Regression tests

- Added/updated FTP regression tests in:
  - `tests/unit/lib/ftp/ftpClient.test.ts`
  - `tests/unit/lib/deviceInteraction/deviceInteractionManager.test.ts`
  - `android/app/src/test/java/uk/gleissner/c64commander/FtpClientPluginTest.kt`
- Added/updated playback and background listener regression tests in:
  - `tests/unit/playFiles/usePlaybackController.concurrency.test.tsx`
  - `tests/unit/playFiles/usePlaybackController.autoAdvance.test.tsx`
  - `tests/unit/pages/playFiles/PlayFilesPage.featureFlagContracts.test.ts`
- Targeted JS regression command passed:
  - `npm run test -- tests/unit/lib/ftp/ftpClient.test.ts tests/unit/lib/deviceInteraction/deviceInteractionManager.test.ts tests/unit/playFiles/usePlaybackController.concurrency.test.tsx tests/unit/playFiles/usePlaybackController.autoAdvance.test.tsx tests/unit/pages/playFiles/PlayFilesPage.featureFlagContracts.test.ts`
  - Result: 5 test files passed, 77 tests passed.
- Android FTP plugin command:
  - First attempted `cd android && ./gradlew test --tests uk.gleissner.c64commander.FtpClientPluginTest`; Gradle rejected `--tests` on the root `test` task.
  - Corrected command passed: `cd android && ./gradlew :app:testDebugUnitTest --tests uk.gleissner.c64commander.FtpClientPluginTest`
  - Result: BUILD SUCCESSFUL, 31 tests completed.

## 2026-05-28 08:02-08:58 UTC - Full local validation

- `npm run test`
  - First full run failed in `tests/unit/pages/SettingsPage.test.tsx` because its `@/lib/tracing/traceSession` mock was missing `recordDeviceGuard`.
  - Added the missing mock export and confirmed `npm run test -- tests/unit/pages/SettingsPage.test.tsx` passed: 55 tests passed.
  - Rerun passed: 574 test files passed, 6664 tests passed.
- `npm run lint && npm run build`
  - First lint stopped at a Prettier issue in `tests/unit/hvsc/hvscService.test.ts`.
  - Applied Prettier to that single file.
  - Rerun passed; `npm run build` also passed and packaged `THIRD_PARTY_NOTICES.md` into `dist`.
- `npm run test:coverage`
  - Passed.
  - Coverage summary: statements 94.61%, branches 91.66%, functions 90.24%, lines 94.61%.
- Patch/changed-line coverage:
  - No repository patch-coverage script was found.
  - Ran a local changed-line coverage check over executable TS/TSX patch lines against `.cov-unit/merged/coverage-final.json`.
  - Result: 357/357 executable changed TS/TSX lines covered = 100.00%.
- `npm run cap:build && npm run android:apk`
  - Passed.
  - Built APK: `android/app/build/outputs/apk/debug/c64commander-0.8.5-rc2-debug.apk`.

## 2026-05-28 09:00-09:10 local / 08:00-08:10 UTC - Pixel 4 and live hardware validation

- Android device:
  - Pixel 4 serial `9B081FFAZ001WX` was attached and focused on `uk.gleissner.c64commander/.MainActivity`.
  - Installed APK: `android/app/build/outputs/apk/debug/c64commander-0.8.5-rc2-debug.apk`.
  - Install result: `Success`.
  - Launched with `adb -s 9B081FFAZ001WX shell monkey -p uk.gleissner.c64commander -c android.intent.category.LAUNCHER 1`.
- Hardware probes:
  - `http://u64/v1/info` succeeded:
    - product `Ultimate 64 Elite`
    - firmware `3.14e`
    - host `u64`
    - unique id `38C1BA`
    - no reported errors
  - `http://c64u/v1/info` failed twice with `curl: (56) Recv failure: Connection reset by peer`.
  - Live validation target selected: `u64` at `192.168.1.13`.
- WebView DevTools:
  - Forwarded `tcp:9222` to `webview_devtools_remote_24714`.
  - Attached to page `C64 Commander` at `http://localhost/`.
- Rapid manual Next coalescing:
  - Used existing mixed playlist from `/USB2/_Test/` with PRG and disk entries.
  - Enabled Repeat so four rapid Next taps had a deterministic net target in the 4-item playlist.
  - Cleared app logs immediately before the burst.
  - Four rapid Next clicks produced one final runner call only:
    - `/v1/runners:run_prg?file=%2FUSB2%2F_Test%2Fanykey-c64.prg`
  - No intermediate `joyride`, `micromys`, disk mount, or reboot requests were logged for the burst.
  - WebView `Runtime.exceptionThrown`: 0.
  - App errors: none.
- Background auto-skip / auto-advance:
  - Native background watchdog logs showed `Auto-skip watchdog fired`.
  - Playback advanced through the playlist exactly once per due guard.
  - Observed due guard firings for successive track instance ids with one subsequent playback request each.
  - App errors: none.
- FTP browse resilience:
  - Opened Play Files Add items -> C64U.
  - Removed `c64u_ftp_cache:v1` to force fresh FTP listing.
  - Browsed Root -> `USB2` -> `_Test`, then refreshed the `_Test` listing twice.
  - Final path: `/USB2/_Test/`.
  - `_Test` listing included `anykey-c64.prg`.
  - FTP cache repopulated (`4307` bytes).
  - WebView `Runtime.exceptionThrown`: 0.
  - App errors / browse failures / timeouts: none.
- Stable behavior spot checks:
  - Volume slider rapid changes completed with one `Play volume commit send` and no errors.
  - Auto-advance remained exactly-once per due item during the live playback run.
  - Cross-device disk-origin validation could not be re-run because `c64u` remained unavailable; recorded as a concrete hardware blocker rather than a pass.
- Screenshot regeneration:
  - Not performed; no documented visible UI surface changed.
