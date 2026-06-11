# C64 Commander Prod Hardening 8 Worklog

Run started: 2026-06-05T23:53:04+01:00

## Setup

- 2026-06-05T23:53:04+01:00 - Replaced stale root prod-hardening-7 `PLANS.md` and `WORKLOG.md` with prod-hardening-8 execution state.
- 2026-06-05T23:53:04+01:00 - Created required output/artifact directories under `docs/research/stabilization/prod-hardening-8/`.
- 2026-06-05T23:53:04+01:00 - Change classification for permitted file edits: `DOC_ONLY`; execution still requires build/deploy and hardware-in-the-loop validation by prompt.
- 2026-06-05T23:53:04+01:00 - Product/source/test/script/dependency edits are prohibited for this research run.

## Previous Evidence Review

- 2026-06-05T23:54:00+01:00 - Reviewed prod-hardening-7 `FINDINGS.md`, `COVERAGE.md`, `DEVICE-LIVENESS.md`, `RAW-OBSERVATIONS.md`, and `ARTIFACTS.md`; all required previous files exist.
- 2026-06-05T23:54:00+01:00 - Prior baseline worth reusing: Pixel 4 serial `9B081FFAZ001WX`, u64 `/v1/info` healthy at `u64`/`192.168.1.13`, c64u `/v1/info` healthy at `c64u`/`192.168.1.167`, c64scope preflight passed for both.
- 2026-06-05T23:54:00+01:00 - Prior gaps carried forward: U64 profile missing/unsaved, switcher long-press unreliable, no actual playback, no disk mount/eject, no config mutation, no stream test, no slider/rate-limit stress, no reconnect/back-off audit, diagnostics export not completed, no c64scope capture, Maestro not run due app-state reset.
- 2026-06-05T23:54:00+01:00 - Prior anomalies to confirm/reject: transient Healthy badge with Device/Firmware `Not available`, Settings hostname edit not saved, adb coordinate scaling mistakes, diagnostics Share all opened from wrong/uncertain context.

## Repository Discovery

- 2026-06-05T23:55:00+01:00 - Package manager: npm; `package-lock.json` and `bun.lockb` both present, but root scripts and docs use npm.
- 2026-06-05T23:55:00+01:00 - Node requirement from `package.json`: `>=24 <25`; current preflight later observed Node v24.11.0.
- 2026-06-05T23:55:00+01:00 - Android app id/package id: `uk.gleissner.c64commander`; Gradle namespace same; debug APK directory `android/app/build/outputs/apk/debug/`.
- 2026-06-05T23:55:00+01:00 - Relevant build/deploy commands discovered: `./build --skip-install --skip-tests --skip-format --install-apk --device-id <serial>`, `npm run cap:build`, `npm run android:apk`.
- 2026-06-05T23:55:00+01:00 - c64scope commands discovered: `npm run scope:preflight`, `npm run scope:hil:evidence`, `npm run scope:hil:playback-volume-latency`, `npm run scope:mcp`.
- 2026-06-05T23:55:00+01:00 - c64scope capture path may require `.tmp/c64_capture_render.mjs`; absence will be classified if capture cannot run.
- 2026-06-05T23:55:00+01:00 - Maestro docs and scripts reviewed. `scripts/run-maestro.sh` defaults to install, `pm clear`, smoke config write, and HVSC fixture staging; `--skip-app-reset` avoids those destructive setup steps but may not prepare deterministic state.
- 2026-06-05T23:55:00+01:00 - Safe fixtures discovered: `tests/fixtures/local-source-assets/demo.sid`, `demo.prg`, `demo.d64`, `demo.d71`, `demo.d81`, `demo.mod`, `demo.crt`, and Android HVSC fixtures.
- 2026-06-05T23:55:00+01:00 - Saved-device implementation stores profiles in localStorage key `c64u_saved_devices:v1`; Settings exposes Add device, Delete device, host/name/port editor, Save & Connect, and saved rows.
- 2026-06-05T23:55:00+01:00 - Build helper debug fast path injects `VITE_DEBUG_SAVED_DEVICES_JSON` with IP-backed `debug-u64` and `debug-c64u` profiles, but existing persisted app data can prevent bootstrap from applying.

## Device Baseline

- 2026-06-05T23:55:42+01:00 - Pixel 4 baseline captured. Serial `9B081FFAZ001WX`, model Pixel 4, Android 16/API 36, battery 100%, screen awake/interactive, C64 Commander foreground, installed version `0.8.6-rc1` versionCode `1988`. Evidence: `docs/research/stabilization/prod-hardening-8/artifacts/logs/baseline-android-20260605T235542.txt`.
- 2026-06-05T23:55:48+01:00 - U64 low-risk baseline `/v1/info`: `u64` HTTP 200 in 1.095s, `192.168.1.13` HTTP 200 in 0.050s; product Ultimate 64 Elite firmware 3.14e, unique_id `38C1BA`.
- 2026-06-05T23:55:48+01:00 - C64U low-risk baseline `/v1/info`: `c64u` HTTP 200 in 0.025s, `192.168.1.167` HTTP 200 in 0.035s; product C64 Ultimate firmware 1.1.0, unique_id `5D4E12`.
- 2026-06-05T23:56:00+01:00 - Scoped run logcat capture started; pid stored at `docs/research/stabilization/prod-hardening-8/artifacts/logs/logcat-run.pid`, log path `docs/research/stabilization/prod-hardening-8/artifacts/logs/logcat-run-20260605T235600.txt`.

## Build And Deploy

- 2026-06-05T23:56:14+01:00 - Build/deploy command started: `./build --skip-install --skip-tests --skip-format --install-apk --device-id 9B081FFAZ001WX`.
- 2026-06-05T23:56:44+01:00 - Build/deploy result: exit 0. Web build, Capacitor sync, Gradle `assembleDebug`, streamed install, and launcher monkey event succeeded. Evidence: `docs/research/stabilization/prod-hardening-8/artifacts/logs/build-deploy-20260605T235614.txt`, summary `docs/research/stabilization/prod-hardening-8/artifacts/logs/build-deploy-summary-20260605T235614.txt`.
- 2026-06-05T23:56:58+01:00 - Post-deploy app foreground confirmed. APK/app version still `0.8.6-rc1` versionCode `1988`; lastUpdateTime `2026-06-05 23:56:44`. Evidence: `docs/research/stabilization/prod-hardening-8/artifacts/logs/post-deploy-android-20260605T235655.txt`.
- 2026-06-05T23:56:55+01:00 - Startup screenshot/UI dump captured. Visible screen: Home, badge `C64U HEALTHY`, App `0.8.6-rc1`, Device/Firmware `Not available`. Evidence: `docs/research/stabilization/prod-hardening-8/artifacts/screenshots/startup-20260605T235655.png`, `docs/research/stabilization/prod-hardening-8/artifacts/uiautomator/startup-20260605T235655.xml`.
- 2026-06-05T23:57:25+01:00 - Startup rechecked after 8s; Device/Firmware remained `Not available` despite Healthy badge and loaded C64U-backed Home content. Evidence: `docs/research/stabilization/prod-hardening-8/artifacts/screenshots/startup-settled-20260605T235725.png`.
- 2026-06-05T23:57:30+01:00 - WebView devtools socket found and forwarded to `127.0.0.1:9222` for read-only app state inspection.
- 2026-06-05T23:58:06+01:00 - CDP state captured. `c64u_saved_devices:v1` has exactly one saved device for host `c64u`; no u64 profile exists. Body text still shows `Device Not available` and `Firmware Not available`, while C64U config enrichment cache keys and Home C64U controls are present. Evidence: `docs/research/stabilization/prod-hardening-8/artifacts/logs/cdp-initial-state-20260605T235806.json`.

## App Profile Setup

- 2026-06-05T23:58:51+01:00 - Used app Settings UI through WebView/CDP to add a test-owned U64 profile because only one saved `c64u` profile existed. Evidence: `docs/research/stabilization/prod-hardening-8/artifacts/logs/profile-setup-u64-20260605T235851.json`.
- 2026-06-05T23:59:03+01:00 - U64 profile was saved through `Save & Connect`; Home showed `U64 HEALTHY`, Device `Ultimate-64-Elite-F83C87`, Firmware `3.14e`. Evidence screenshots: `profile-settings-u64-filled-1780700337069.png`, `profile-settings-u64-after-save-1780700343924.png`, `profile-home-u64-after-save-1780700351321.png`.
- 2026-06-05T23:59:03+01:00 - Settings saved-device list showed non-selected `c64u` row as `U64E · c64u` after U64 selection, suggesting cross-device product-label bleed.
- 2026-06-05T23:59:03+01:00 - Saved-device storage after U64 save retained stale `Unavailable`/`Offline` health summary for the U64 profile despite the active UI being healthy.

## U64 Workflow Tests

- 2026-06-06T00:11:03+01:00 - Ran bounded U64 app workflow script through app UI test IDs. Evidence: `docs/research/stabilization/prod-hardening-8/artifacts/logs/u64-bounded-workflows-20260606T001103.ndjson`.
- 2026-06-06T00:11:10+01:00 - Home route showed correct U64 product/firmware, quick config, drives, streams, and no disk mounted. Evidence: `u64-home-before-bounded-1780701069573.png`.
- 2026-06-06T00:11:11+01:00 - U64 VIC stream Start was enabled and clicked through the app UI; Stop was enabled after start and clicked. Evidence: `u64-stream-before-1780701070522.png`, `u64-stream-after-start-1780701073605.png`, `u64-stream-after-stop-1780701076666.png`.
- 2026-06-06T00:11:20+01:00 - U64 Play volume slider was enabled and exercised through app UI native range input: five 500 ms changes, five 200 ms changes, then restored to original `0 dB`. Evidence: `u64-volume-before-1780701079754.png`, `u64-volume-after-restore-1780701086762.png`.
- 2026-06-06T00:11:30+01:00 - U64 Settings `Refresh connection` accepted a second click about 300 ms after the first click; the button was not disabled at 100 ms. Classified as reconnect/discovery busy-state gating issue.

## C64U Workflow Tests

- 2026-06-06T00:01:27+01:00 - Attempted conservative app-driven c64u selection through saved-device switcher. App switched selected profile to c64u but reported `OFFLINE`/`Not connected` while direct `/v1/info` remained healthy immediately after the switching loop.
- 2026-06-06T00:12:37+01:00 - Later low-frequency c64u hostname reprobe returned immediate connection reset. Evidence: `docs/research/stabilization/prod-hardening-8/artifacts/logs/c64u-lowfreq-reprobe-20260606T001237.txt`.
- 2026-06-06T00:13:08+01:00 - One IP-based c64u reprobe also returned immediate connection reset. Evidence: `docs/research/stabilization/prod-hardening-8/artifacts/logs/c64u-ip-lowfreq-reprobe-20260606T001308.txt`.
- 2026-06-06T00:13:08+01:00 - Stopped all C64U mutation and further probing after confirmed degradation.

## Cross-Device Switching

- 2026-06-06T00:00:01+01:00 - Opened saved-device switcher through actual long-press handler via WebView pointer events. Initial switcher showed contradictory status for U64: selected row included `Offline selection` while also showing online/healthy state after probes. Evidence: `docs/research/stabilization/prod-hardening-8/artifacts/screenshots/switcher-open-1780700405972.png`, `docs/research/stabilization/prod-hardening-8/artifacts/logs/device-switch-cdp-20260606T000001.json`.
- 2026-06-06T00:01:27+01:00 - Performed careful U64 -> c64u -> U64 -> c64u -> U64 switching through saved-device rows. Evidence: `docs/research/stabilization/prod-hardening-8/artifacts/logs/device-switch-cdp-rows-20260606T000127.ndjson`.
- 2026-06-06T00:01:27+01:00 - Each c64u selection left app `OFFLINE`/`Not connected`; each U64 selection recovered to `U64 HEALTHY`. Direct liveness after switch loop showed both u64 and c64u HTTP 200 at that time. Evidence: `docs/research/stabilization/prod-hardening-8/artifacts/logs/post-switch-liveness-20260606T000230.txt`.

## Playback

- 2026-06-06T00:03:09+01:00 - Staged safe local playback fixtures to `/sdcard/Download/C64LocalSource`. Evidence: `docs/research/stabilization/prod-hardening-8/artifacts/logs/stage-local-fixtures-20260606T000309.txt`.
- 2026-06-06T00:03:18+01:00 - Attempted `scripts/run-maestro.sh --mode tags --tags +android-regression-proof --skip-app-reset`; runner exited 1 because the requested flow also has excluded tag `slow`, so no safe playback proof ran. Evidence: `docs/research/stabilization/prod-hardening-8/artifacts/logs/maestro-local-binary-playback-20260606T000318.txt`.
- 2026-06-06T00:03:42+01:00 - Attempted direct `maestro test .maestro/local-binary-playback-proof.yaml` without app reset; flow exited 1 on Android DocumentsUI toolbar assertion while file picker was open in remembered `C64Music` folder. Evidence: `docs/research/stabilization/prod-hardening-8/artifacts/logs/maestro-direct-local-binary-playback-20260606T000342.txt` and artifacts under `docs/research/stabilization/prod-hardening-8/artifacts/maestro/direct-local-binary-playback/`.
- 2026-06-06T00:05:23+01:00 - Manual attempts to continue the DocumentsUI picker did not complete source selection. Evidence screenshots: `manual-picker-after-use-20260606T000523.png`, `manual-picker-after-use2-20260606T000549.png`, `manual-picker-after-use3-20260606T000600.png`.
- 2026-06-06T00:13:33+01:00 - Ran c64scope U64 direct playback/volume capture with fixture `tests/fixtures/local-source-assets/demo.sid`; capture passed with 10 operations, 0 failures, 0 stale writes. This proves U64 hardware/capture path, not app playlist playback. Evidence: `docs/research/stabilization/prod-hardening-8/artifacts/logs/c64scope-playback-volume-latency-direct-20260606T001333.txt`.

## Disk Workflows

- 2026-06-06T00:03:42+01:00 - Disk mount/eject app workflow remained blocked by the same deterministic local fixture picker/harness failure before `demo.d64` could be added or mounted through the app. Classified as testability gap; no disk was mounted by this run.

## Config Workflows

- 2026-06-06T00:11:20+01:00 - App-driven volume config mutation on U64 was exercised through Play volume slider and restored to original `0 dB`.
- 2026-06-06T00:13:33+01:00 - c64scope direct Audio Mixer mutation/restore on U64 completed with no failures and restored snapshot.
- 2026-06-06T00:13:08+01:00 - Broader C64U config mutation was not attempted because c64u degraded.

## Stream Workflows

- 2026-06-06T00:11:11+01:00 - U64 VIC stream start/stop was performed through app UI and stopped. No streams intentionally left running.

## Diagnostics Export

- 2026-06-06T00:11:37+01:00 - Opened diagnostics overlay on U64 and captured header/test IDs. Evidence: `diagnostics-open-u64-1780701097011.png`.
- 2026-06-06T00:11:39+01:00 - Clicked diagnostics overflow then `Share all`. Android intent resolver opened; no deterministic file destination was offered through the app path. Evidence: `diagnostics-overflow-u64-1780701098444.png`, `diagnostics-share-after-click-1780701101961.png`, `post-u64-bounded-focus-20260606T001155.png`.

## Slider And Back-Off Audit

- 2026-06-06T00:11:20+01:00 - U64 app volume slider accepted bounded 500 ms and 200 ms sequences and UI label tracked requested values; final UI restored to `0 dB`.
- 2026-06-06T00:13:33+01:00 - c64scope direct U64 playback-volume latency capture showed p95 132 ms, 0 failures, 0 stale writes, 0 cancellations.
- 2026-06-06T00:13:08+01:00 - C64U slider audit was not run after c64u degradation.

## Reconnect And Discovery Audit

- 2026-06-06T00:11:30+01:00 - U64 Settings `Refresh connection` did not gate a second click while the first refresh/discovery operation was likely in progress; second click was accepted. Classified as safety/back-off issue.
- 2026-06-06T00:13:08+01:00 - C64U reconnect/discovery audit stopped after degradation; no further c64u reconnect attempts were made.

## c64scope Capture

- 2026-06-06T00:13:22+01:00 - `npm run scope:hil:playback-volume-latency -- --host ...` failed before hardware interaction because nested npm argument passing converted options to positional args. Evidence: `docs/research/stabilization/prod-hardening-8/artifacts/logs/c64scope-playback-volume-latency-20260606T001322.txt`.
- 2026-06-06T00:13:33+01:00 - Direct built c64scope command succeeded with artifacts under prod-hardening-8: `docs/research/stabilization/prod-hardening-8/artifacts/c64scope/playback-volume-latency-20260606T001333/`.
- 2026-06-06T00:13:33+01:00 - Broader c64scope `hil:evidence` path was not run because source inspection showed its artifact root is hardcoded to `c64scope/artifacts`, outside the run's permitted output directory.

## Agentic/Maestro/Harness Evaluation

- 2026-06-06T00:03:18+01:00 - Maestro runner usability evaluated with `--skip-app-reset`; tag filtering prevented the intended slow playback proof from running.
- 2026-06-06T00:03:42+01:00 - Direct Maestro flow avoided app reset but failed in DocumentsUI due brittle selector/remembered picker state.
- 2026-06-06T00:14:57+01:00 - Scoped logcat capture file was empty after the run, so app-runtime log evidence was not available from the configured capture.

## Findings

- 2026-06-06T00:14:57+01:00 - Confirmed findings to carry into `research.md`: c64u switch failure, c64u degradation, Healthy-without-identity, switcher/status contradictions, saved-device label bleed, reconnect refresh not gated, diagnostics export nondeterministic, Maestro tag/picker blockers, c64scope artifact/CLI issues, and empty logcat capture.

## Final Liveness

- 2026-06-06T00:14:35+01:00 - Final app navigation captured Home and Settings on Pixel 4 with U64 selected and app responsive. Evidence: `docs/research/stabilization/prod-hardening-8/artifacts/logs/final-app-navigation-force-20260606T001435.ndjson`.
- 2026-06-06T00:14:56+01:00 - Final Pixel adb state `device`; foreground app C64 Commander; U64 `/v1/info` HTTP 200 in 0.026s. Evidence: `docs/research/stabilization/prod-hardening-8/artifacts/logs/final-liveness-20260606T001456.txt`.
- 2026-06-06T00:14:56+01:00 - C64U final liveness was not reprobed again after confirmed degradation to avoid further interaction.
- 2026-06-06T00:14:57+01:00 - Stopped scoped logcat capture. File was empty (`0` lines); tail artifact preserved.

## Final Documents

- 2026-06-06T00:15:00+01:00 - Preparing `research.md` and `prompt.md` under `docs/research/stabilization/prod-hardening-8/`.
- 2026-06-06T00:15:30+01:00 - Wrote `docs/research/stabilization/prod-hardening-8/research.md` with fail verdict and 11 findings.
- 2026-06-06T00:15:45+01:00 - Wrote `docs/research/stabilization/prod-hardening-8/prompt.md` as execution-ready fix prompt starting with `ROLE`.
- 2026-06-06T00:16:00+01:00 - Final status check: changed files are `PLANS.md`, `WORKLOG.md`, and untracked `docs/research/stabilization/prod-hardening-8/`; no product code was modified by this run.

## Fix Pass

- 2026-06-06T00:58:00+01:00 - Started PH8 fix pass from the user-provided prompt. Required reading completed: `.github/copilot-instructions.md`, `AGENTS.md`, `README.md`, `docs/ux-guidelines.md`, `docs/testing/maestro.md`, `docs/testing/agentic-tests/agentic-safety-policy.md`, PH8 `research.md`, and `artifact-index.txt`.
- 2026-06-06T00:58:00+01:00 - Classified this fix pass as `DOC_PLUS_CODE` and `UI_CHANGE` because it will touch app behavior, visible health/status UI, test scripts, and docs as needed.
- 2026-06-06T00:58:00+01:00 - Observed pre-existing worktree state before fix edits: modified `PLANS.md`/`WORKLOG.md`, untracked `docs/research/stabilization/prod-hardening-7/`, untracked `docs/research/stabilization/prod-hardening-8/`, and untracked `org/`.
- 2026-06-06T00:58:00+01:00 - Replaced root `PLANS.md` with the PH8 fix execution plan while preserving the prior research chronology in this worklog.
- 2026-06-06T01:17:00+01:00 - Implemented first connection/saved-device fix cluster: identity-required discovery probes, coalesced manual discovery, coalesced saved-device switches, removed redundant Settings Save & Connect discovery, immediate Settings Refresh in-flight gating, per-device Settings row product labels, first-verification alias/IP mismatch fix, identity-gated health rollup, and switcher row status reconciliation.
- 2026-06-06T01:17:00+01:00 - Added/updated focused regressions in connection manager, SettingsPage, saved-device store, saved-device switching hook, useHealthState, and UnifiedHealthBadge tests.
- 2026-06-06T01:23:00+01:00 - Ran `npx prettier --write` on the first fix cluster files.
- 2026-06-06T01:24:00+01:00 - Focused regression run initially failed because the switch hook still used IIFE call syntax after converting to `Promise.resolve().then`, two old probe timeout tests still used product-less payloads, and immediate-selection timing regressed. Fixed the hook with a deferred active switch promise and updated the tests to the new identity-required probe contract.
- 2026-06-06T01:26:00+01:00 - Focused regression command passed: `npx vitest run tests/unit/connection/connectionManager.test.ts tests/unit/pages/SettingsPage.test.tsx tests/unit/lib/savedDevices/store.test.ts tests/unit/hooks/useSavedDeviceSwitching.test.tsx tests/unit/hooks/useHealthState.test.tsx tests/unit/components/UnifiedHealthBadge.test.tsx` (`197` tests passed).
- 2026-06-06T01:19:46+01:00 - Implemented PH8 harness/testability batch: deterministic diagnostics automation export path, Android local-source initial URI support, Maestro explicit `--flow` and slow-tag config override, local playback fixture staging/DocumentsUI reset, c64scope `--artifact-root` handling, root npm forwarding, and app-scoped non-empty logcat capture enforcement.
- 2026-06-06T01:19:46+01:00 - Added/updated regressions for diagnostics export automation, smoke local-source picker URI, local source picker options, Maestro runner contracts, c64scope artifact-root resolution, and app logcat capture failure preservation.
- 2026-06-06T01:19:46+01:00 - Updated narrow harness docs in `docs/testing/maestro.md`, `docs/testing/playback-volume-latency.md`, and `c64scope/README.md`.
- 2026-06-06T01:19:46+01:00 - Ran `npx prettier --write` on the second implementation batch files.
- 2026-06-06T01:20:12+01:00 - Focused PH8 root Vitest run initially failed in `localSourcesStore.test.ts` because enabling the test probe activates the window platform override path; updated the test to set `__c64uPlatformOverride = "android"` for that regression.
- 2026-06-06T01:21:12+01:00 - Focused second-batch root tests passed: `npx vitest run tests/unit/sourceNavigation/localSourcesStore.test.ts tests/unit/lib/diagnostics/diagnosticsExport.test.ts tests/unit/smoke/smokeMode.test.ts tests/unit/scripts/runMaestroScript.test.ts` (`88` tests passed).
- 2026-06-06T01:21:21+01:00 - Full PH8-focused root Vitest command passed: `npx vitest run tests/unit/connection/connectionManager.test.ts tests/unit/pages/SettingsPage.test.tsx tests/unit/lib/savedDevices/store.test.ts tests/unit/hooks/useSavedDeviceSwitching.test.tsx tests/unit/hooks/useHealthState.test.tsx tests/unit/components/UnifiedHealthBadge.test.tsx tests/unit/lib/diagnostics/diagnosticsExport.test.ts tests/unit/smoke/smokeMode.test.ts tests/unit/sourceNavigation/localSourcesStore.test.ts tests/unit/scripts/runMaestroScript.test.ts tests/unit/maestro/maestroFlowContracts.test.ts` (`292` tests passed).
- 2026-06-06T01:21:42+01:00 - Focused c64scope tests passed: `npx vitest run tests/hilArtifactRoot.test.ts tests/validationHelpers.test.ts` from `c64scope/` (`9` tests passed).
- 2026-06-06T01:22:19+01:00 - Android JVM validation passed for folder-picker changes: `cd android && ./gradlew testDebugUnitTest --tests uk.gleissner.c64commander.FolderPickerPluginTest`. Existing Kotlin/Gradle deprecation warnings were emitted; build succeeded.
- 2026-06-06T01:33:00+01:00 - `npm run lint` passed. Existing warnings were from generated coverage HTML under `.worktrees/stop-ui-validation/coverage/lcov-report/*` and `c64scope/coverage/*`; no new product-code warnings were introduced.
- 2026-06-06T01:42:00+01:00 - `npm run test` passed (`581` files, `6723` tests). Expected fixture tests printed budget-failure text while asserting reporting behavior; command exit was `0`.
- 2026-06-06T01:50:00+01:00 - First `npm run test:coverage` passed with global branch coverage `91.69%` (`Statements 94.65%`, `Functions 91.11%`, `Lines 94.65%`).
- 2026-06-06T01:51:00+01:00 - `npm run build` passed. Existing Vite warnings remained: browser externalization of Node `url`, vendor circular chunk note, and static/dynamic import overlap notes.
- 2026-06-06T01:53:00+01:00 - `npm run scope:check` passed for c64scope TypeScript build and tests (`33` files, `259` tests).
- 2026-06-06T01:55:00+01:00 - `npm run scope:test:coverage` passed for c64scope with branch coverage `85.65%`, satisfying that package's configured threshold (`statements 95.04%`, `functions 96.69%`, `lines 94.94%`).
- 2026-06-06T01:55:00+01:00 - Local root changed-line coverage check after the first coverage run showed `299/314` executable changed lines covered (`95.22%`). Added focused regressions for TELNET identity rollup, unknown saved-device switch failure, query cancellation warning, and Settings refresh error reporting.
- 2026-06-06T01:56:00+01:00 - Ran `npx prettier --write tests/unit/hooks/useHealthState.test.tsx tests/unit/hooks/useSavedDeviceSwitching.test.tsx tests/unit/pages/SettingsPage.test.tsx` and the focused regression command `npx vitest run tests/unit/hooks/useHealthState.test.tsx tests/unit/hooks/useSavedDeviceSwitching.test.tsx tests/unit/pages/SettingsPage.test.tsx`; focused tests passed (`84` tests).
- 2026-06-06T02:02:00+01:00 - Re-ran `npm run test:coverage` after the added regressions. Coverage passed with global branch coverage `91.71%` (`Statements 94.67%`, `Functions 91.11%`, `Lines 94.67%`).
- 2026-06-06T02:03:00+01:00 - Local patch coverage from `coverage/lcov.info`: root app/test executable changed lines `271/271` covered (`100.00%`).
- 2026-06-06T02:04:00+01:00 - Local c64scope included-source patch coverage from `c64scope/coverage/coverage-final.json`: `21/21` executable changed lines covered (`100.00%`) for covered files. `c64scope/src/hilEvidenceRun.ts`, `c64scope/src/playbackVolumeLatency.ts`, and `c64scope/src/validation/cases/navigation.ts` remain excluded by c64scope's coverage config; behavior is covered by focused script/unit tests.
- 2026-06-06T02:43:34+01:00 - Continued PH8-009 Maestro investigation after DocumentsUI ignored the exact fixture `localSourceInitialUri` and reopened a remembered `C64Music` folder during a no-reset local playback proof run.
- 2026-06-06T02:43:34+01:00 - Added Android SAF persisted-grant cleanup: `FolderPicker.releasePersistedUris()` native bridge, TypeScript wrapper support, smoke config `resetLocalSourcePermissions`, local-source picker preflight reset, and runner smoke payload flag for `.maestro/local-binary-playback-proof.yaml`.
- 2026-06-06T02:43:34+01:00 - Updated `docs/testing/maestro.md` to document the local playback fixture URI plus persisted local-source SAF grant reset.
- 2026-06-06T02:43:34+01:00 - Focused TypeScript validation passed: `npx vitest run tests/unit/smoke/smokeMode.test.ts tests/unit/sourceNavigation/localSourcesStore.test.ts tests/unit/native/folderPicker.test.ts tests/unit/lib/native/folderPicker.test.ts tests/unit/scripts/runMaestroScript.test.ts` (`91` tests passed).
- 2026-06-06T02:43:34+01:00 - Focused Android JVM validation passed after the native bridge change: `cd android && ./gradlew testDebugUnitTest --tests uk.gleissner.c64commander.FolderPickerPluginTest`.
- 2026-06-06T03:10:37+01:00 - Built and installed a test-probe APK for the no-reset Maestro proof: `VITE_ENABLE_TEST_PROBES=1 npm run cap:build`, `npm run android:apk`, `adb -s 9B081FFAZ001WX install -r android/app/build/outputs/apk/debug/c64commander-0.8.6-rc1-debug.apk`.
- 2026-06-06T03:10:37+01:00 - Maestro proof attempt `maestro-local-binary-playback-saf-reset` failed because DocumentsUI still reopened `Download/C64Music` despite the app calling `FolderPicker.releasePersistedUris()` and passing exact `localSourceInitialUri`. Evidence: `docs/research/stabilization/prod-hardening-8/artifacts/post-fix/maestro-local-binary-playback-saf-reset/`, log `docs/research/stabilization/prod-hardening-8/artifacts/logs/maestro-local-binary-playback-saf-reset.txt`.
- 2026-06-06T03:10:37+01:00 - Updated `.maestro/local-binary-playback-proof.yaml` to recover through the visible DocumentsUI `Download` breadcrumb and open `C64LocalSource`, avoiding toolbar/internal-storage selectors.
- 2026-06-06T03:10:37+01:00 - Subsequent Maestro attempts exposed flow mismatches after the picker: local files were below the viewport, Android auto-confirm populated the playlist directly, and playback `Stop` was above the viewport. Updated the flow to scroll to fixture rows, remove obsolete `Add to playlist` steps, retry source chooser opening, and scroll back to transport controls before stopping playback.
- 2026-06-06T03:10:37+01:00 - Focused flow contract validation passed after the final Maestro flow edits: `npx vitest run tests/unit/maestro/maestroFlowContracts.test.ts tests/unit/scripts/runMaestroScript.test.ts` (`13` tests passed).
- 2026-06-06T03:10:37+01:00 - Pixel 4 Maestro proof passed: `scripts/run-maestro.sh --mode tags --tags +android-regression-proof --flow .maestro/local-binary-playback-proof.yaml --device-id 9B081FFAZ001WX --apk-path android/app/build/outputs/apk/debug/c64commander-0.8.6-rc1-debug.apk --output-dir docs/research/stabilization/prod-hardening-8/artifacts/post-fix/maestro-local-binary-playback-passed --c64u-target mock --skip-app-reset`.
- 2026-06-06T03:10:37+01:00 - Passed Maestro evidence: `docs/research/stabilization/prod-hardening-8/artifacts/post-fix/maestro-local-binary-playback-passed/maestro-report.xml`, command trace under `2026-06-06_030644/`, and screenshots `local-source-listed.png`, `local-playlist-populated.png`, `local-d64-playing.png`, `local-prg-playing.png`, `local-crt-playing.png`.
- 2026-06-06T03:10:37+01:00 - Preserved passed-run log artifacts: `docs/research/stabilization/prod-hardening-8/artifacts/logs/maestro-local-binary-playback-passed.txt`, non-empty logcat `docs/research/stabilization/prod-hardening-8/artifacts/logs/maestro-local-binary-playback-passed-logcat.txt` (`6643` lines), and smoke file snapshot `docs/research/stabilization/prod-hardening-8/artifacts/logs/maestro-local-binary-playback-passed-smoke-files.txt`.
- 2026-06-06T03:31:11+01:00 - Final broad root validation rerun passed after the Maestro/native-smoke fixes: `npm run lint` passed with only existing generated coverage HTML warnings; `npm run test` passed (`581` files, `6737` tests); `npm run test:coverage` passed with global branch coverage `91.71%` (`Statements 94.67%`, `Functions 91.11%`, `Lines 94.67%`).
- 2026-06-06T08:14:16+01:00 - Continuation started from finalization state. Confirmed `diff.txt` is not present. Confirmed `PLANS.md`/`WORKLOG.md` were still at the pre-continuation state with remaining tasks: final build, final c64scope rerun, changed-line coverage recompute, and final APK deploy/validation.

## Continuation Finalization 2026-06-06

- 2026-06-06T08:17:01+01:00 - Executed final normal build with `unset VITE_ENABLE_TEST_PROBES && npm run build`; output captured in `docs/research/stabilization/prod-hardening-8/artifacts/post-fix/logs/final-build.log`.
- 2026-06-06T08:19:05+01:00 - Executed `npm run cap:build`; output captured in `docs/research/stabilization/prod-hardening-8/artifacts/post-fix/logs/final-cap-build.log`.
- 2026-06-06T08:20:54+01:00 - Executed `npm run android:apk`; output captured in `docs/research/stabilization/prod-hardening-8/artifacts/post-fix/logs/final-android-apk.log`.
- 2026-06-06T08:15:31+01:00 - Re-ran `npm run scope:check` (pass: `33` files, `259` tests); evidence in `docs/research/stabilization/prod-hardening-8/artifacts/post-fix/logs/final-scope-check.log`.
- 2026-06-06T08:16:33+01:00 - Re-ran `npm run scope:test:coverage` (branch `85.65%`); evidence in `docs/research/stabilization/prod-hardening-8/artifacts/post-fix/logs/final-scope-coverage.log`.
- 2026-06-06T07:41:33+01:00 - Re-ran `npm run scope:hil:playback-volume-latency -- --host u64 --artifact-root docs/research/stabilization/prod-hardening-8/artifacts/post-fix/c64scope --password` (10 ops, 0 failures, `summary` under `docs/research/stabilization/prod-hardening-8/artifacts/post-fix/c64scope/playback-volume-latency/20260606T071748Z-u64`); evidence in `docs/research/stabilization/prod-hardening-8/artifacts/post-fix/logs/final-scope-playback-volume-latency.log`.
- 2026-06-06T08:18:21+01:00 - Re-ran full `npm run test:coverage`; final branch coverage remained `91.72%`, summary preserved in `docs/research/stabilization/prod-hardening-8/artifacts/post-fix/logs/final-test-coverage.log`.
- 2026-06-06T08:40:27+01:00 - Installed latest normal debug APK `android/app/build/outputs/apk/debug/c64commander-0.8.6-rc1-debug.apk` on Pixel 4 via `adb install -r` with success; evidence in `docs/research/stabilization/prod-hardening-8/artifacts/post-fix/final-device-validation/apk-install.log`.
- 2026-06-06T07:42:12+01:00 - Performed first final-device-validator run with flow path issues (`.maestro/subflows/launch-and-wait.yaml` missing at `/tmp/.maestro/...`); fixed flow path and retried.
- 2026-06-06T07:42:09+01:00 - Second validator run failed on malformed YAML (`assertVisible` optional formatting); flow was corrected and retried.
- 2026-06-06T07:42:12+01:00 - Final validator run passed with flow `final-device-validation-flow` after launch/settings diagnostics navigation by ID; evidence in `docs/research/stabilization/prod-hardening-8/artifacts/post-fix/final-device-validation/final-maestro-run.log`.
- 2026-06-06T08:43:05+01:00 - Captured final device focus/version/package/stack/logcat and health checks (`version.txt`, `package-info.txt`, `focus-check.txt`, `liveness-results.txt`, `post-validate-logcat.txt`) under `docs/research/stabilization/prod-hardening-8/artifacts/post-fix/final-device-validation/`.
- 2026-06-06T08:43:11+01:00 - Final liveness probes: U64 `/v1/info` succeeded (`product`: `Ultimate 64 Elite`, `firmware_version`: `3.14e`); C64U `/v1/info` probe failed with connection reset and was not retried further, per safety rule.
- 2026-06-06T08:44:18+01:00 - Recomputed changed-line coverage context from live diff: `git diff --name-only` returned no paths, so root and c64scope patch deltas are not applicable in this continuation state (no working-tree changes after last committed state); outputs: `ROOT_PATCH_COVERAGE_NO_CHANGED_FILES`, `C64SCOPE_PATCH_COVERAGE_NO_CHANGED_FILES`.
- 2026-06-06T08:44:18+01:00 - Updated `PLANS.md` continuation section with completion status and evidence references; updated this worklog with finalization steps.

## PR 274 Convergence Follow-up

- 2026-06-06: Started PR 274 convergence from `fix/stabilization` with existing modified `PLANS.md`, `WORKLOG.md`, `src/hooks/useSavedDeviceSwitching.ts`, and `tests/unit/hooks/useSavedDeviceSwitching.test.tsx` preserved as in-progress work.
- 2026-06-06: Confirmed two unresolved Copilot review threads: saved-device switch coalescing and append-only `PLANS.md` stewardship.
- 2026-06-06: Confirmed CI failures on head `09260bc`: `Web | Screenshots`, `Web | E2E (sharded) (8, 12)`, and `Web | E2E (sharded) (9, 12)`.
- 2026-06-06: Kept the saved-device switch fix that reuses same-device in-flight promises but queues different-device switch requests after the active switch settles.
- 2026-06-06: Restored `PLANS.md` to append-only structure by prefixing the prior main-branch plan history and retaining the PH8 plan as an addendum.
- 2026-06-06: Added deterministic Playwright mock identity seeding through the app connection manager so health-badge tests satisfy the product-plus-firmware gate without weakening production behavior.
- 2026-06-06: Seeded the stream start/stop Playwright test's initial config snapshot with the same audio endpoint written to the mock server, avoiding stale snapshot display of `—:11001`.
- 2026-06-06: Targeted validation passed: `npx vitest run tests/unit/hooks/useSavedDeviceSwitching.test.tsx`; `npx playwright test playwright/demoMode.spec.ts --project=android-phone -g "real connection shows green C64U indicator"`; `npx playwright test playwright/homeInteractivity.spec.ts --project=android-phone -g "start/stop interactions send stream commands"`; targeted screenshot subset for the seven failed screenshot captures.
- 2026-06-06: Broad validation passed: `npm run lint` (existing generated coverage HTML warnings only), `npm run test` (`582` files, `6739` tests), `npm run test:coverage` (`91.72%` branch coverage), `npm run build`, `npm run cap:build`, and `npm run android:apk`.
- 2026-06-06: Pixel 4 `9B081FFAZ001WX` install succeeded for `android/app/build/outputs/apk/debug/c64commander-0.7.9-rc1-debug.apk`; app activity launched as `uk.gleissner.c64commander/.MainActivity`.
- 2026-06-06: On-device UI dump validation was blocked because Android SystemUI kept `NotificationShade`/quick settings as `mCurrentFocus` after Back, Home, swipe, `cmd statusbar collapse`, statusbar service calls, and `CLOSE_SYSTEM_DIALOGS`; `mFocusedApp` remained C64 Commander. U64 `/v1/info` succeeded and C64U `/v1/info` reset the connection, so no C64U retry/mutation was attempted.

## Fable Planning/Handoff Run (Productionization Pass 1)

Run started: 2026-06-10T16:55+01:00. Branch `fix/hardening`. Run type: planning/handoff only — no production source changes, no commits, no device traffic, no ADB usage. Prompt: `docs/plans/hardening/1/prompt-research.md` (this run) feeding `docs/plans/hardening/1/prompt.md` (executor source material).

### Commands executed (all read-only)

- 2026-06-10T16:55 `git status --short --branch`, `git log --oneline` — branch `fix/hardening`, only untracked `docs/plans/hardening/`.
- 2026-06-10T16:56 `ls` of repo root, `docs/`, `docs/plans/hardening/1/`, `src/pages`, `src/lib` and subdirs (`sources`, `sourceNavigation`, `diagnostics`, `playback`, `disks`, `deviceInteraction`, `config`, `connection`, `native`, `playFiles`), `tests/`, `playwright/`, `.maestro/`, `android/app/src/main/java/uk/gleissner/c64commander/`.
- 2026-06-10T16:57 Read `package.json` scripts; previewed root `PLANS.md` (prod-hardening-2 research plan) and `WORKLOG.md` (prod-hardening-8 log).
- 2026-06-10T16:59 `rg -il "commoserve|commuserve"` — CommoServe IS implemented: `src/lib/sourceNavigation/sourceTerms.ts` (`commoserve: "CommoServe"` / "Online File Archive"), `archiveSourceAdapter.ts`, Telnet specs in `docs/c64/telnet/`, `playwright/commoserve.spec.ts`.
- 2026-06-10T17:00 `git show --stat 0524d1f6` — prior stabilization research (prod-hardening-2..8, responsiveness 1-2) was deleted 2026-06-06 but is recoverable via `git show 0524d1f6^:docs/research/stabilization/...`.
- 2026-06-10T17:02 Read `src/lib/uiErrors.ts` in full; read executive summary of deleted `prod-hardening-2/research.md` and `prod-hardening-7/FINDINGS.md` from git history.
- 2026-06-10T17:05 `rg` checks: raw-fetch bypasses named in prod-hardening-2 research (`probeWithFetch` in `connectionManager.ts`, raw `fetch` in `GlobalDiagnosticsOverlay.tsx`) are GONE from current source. The only raw `fetch(` to devices are the two legitimate transport sites inside `c64api.ts` (~996, ~1324). `__c64uIntent` is now threaded through `healthCheckEngine.ts` probes (10+ sites).
- 2026-06-10T17:07 Checked `src/hooks/use-toast.ts`: `TOAST_LIMIT = 1`, `TOAST_REMOVE_DELAY = 1000000` ms (~16.7 min). Checked `deviceSafetySettings.ts`: modes AUTO/RELAXED/BALANCED/CONSERVATIVE/TROUBLESHOOTING. `useSavedDeviceHealthChecks.ts`: `MIN_BACKGROUND_HEALTHY_CADENCE_MS = 60_000`, still uses `Promise.allSettled` across saved devices (line ~329) with supersede-cancellation.
- 2026-06-10T17:10 `rg -c reportUserError` — ~110 call sites across 17 files, concentrated in page/dialog handlers; `useSavedDeviceHealthChecks.ts` and `healthCheckEngine.ts` contain NO `reportUserError`/`toast` calls (background health probes do not toast).
- 2026-06-10T17:11 Listed `tests/unit`, `playwright/*.spec.ts` (~50 specs), `.maestro/*.yaml` (48 flows), `docs/testing/maestro.md`; inspected `./build` helper flags.

### Decisions

- Repurposed root `PLANS.md`/`WORKLOG.md` per established repo convention (see PR 274 note above about append-only stewardship): new Fable handoff plan prepended to `PLANS.md` with prior plan preserved below as historical archive; this `WORKLOG.md` section appended.
- Mined deleted `docs/research/stabilization/` from git (`0524d1f6^`) instead of re-deriving the pacing architecture; prod-hardening-2 research remains the canonical deep-dive and is cited by reference in `REQUEST_PACING_POLICY.md`.
- Classified prod-hardening-2 "Phase 1" (bypass removal, intent threading) as likely landed (repo evidence: bypass symbols absent, intent threaded); "Phase 2" (background-health redesign) as UNVERIFIED — executor must verify before changing health-check code (see `BUG_HYPOTHESIS_BACKLOG.md` H-06).
- CommoServe confirmed implemented (Telnet-backed "Online File Archive" source); executor must NOT document it as a product gap.
- No subagents launched (per prompt). Optional subagent-able subtasks recorded in `HANDOFF_RISKS.md`.

### Skipped checks (intentionally left for the executor)

- No unit/Playwright/Maestro execution: last known-good broad baseline recorded 2026-06-06 above (`npm run test` 582 files / 6739 tests, coverage 91.72%, build + apk OK); re-baselining is executor Phase 1, not a planning need.
- No ADB/Pixel 4 contact, no u64/c64u probes: planning run produces no device evidence; probing without acting on it would consume c64u headroom for nothing (see memory: c64u drops when overloaded; failing c64u probe is not a regression).
- Did not read `deviceInteractionManager.ts`/`healthCheckEngine.ts` line-by-line: prod-hardening-2 research already documents them; executor verifies the specific deltas listed in the backlog.

### Outputs

- Created/updated: `PLANS.md` (new authoritative handoff plan prepended), `WORKLOG.md` (this section), `ERROR_POLICY.md`, `REQUEST_PACING_POLICY.md`, `CODE_TOUCHPOINTS.md`, `TEST_MATRIX.md`, `BUG_HYPOTHESIS_BACKLOG.md`, `EXECUTOR_PROMPT.md`, `HANDOFF_SUMMARY.md`, `HANDOFF_RISKS.md`.
- No production source, test, config, or Android files modified. No commits made.

## Executor Run (Productionization Pass 1)

Run started: 2026-06-10T17:30+01:00. Branch `fix/hardening`. Run type: execution — fixes, tests, build, on-device matrix. Prompt: `EXECUTOR_PROMPT.md`.

### E0 — Setup

- 2026-06-10T17:30 Starting tree (git status): `M PLANS.md`, `M WORKLOG.md`; untracked: `BUG_HYPOTHESIS_BACKLOG.md`, `CODE_TOUCHPOINTS.md`, `ERROR_POLICY.md`, `EXECUTOR_PROMPT.md`, `HANDOFF_RISKS.md`, `HANDOFF_SUMMARY.md`, `REQUEST_PACING_POLICY.md`, `TEST_MATRIX.md`, `docs/plans/hardening/`.
- 2026-06-10T17:30 Created `BUGS_FOUND.md` (empty findings log).
- 2026-06-10T17:30 Created artifact directory `docs/plans/hardening/1/artifacts/`.
- 2026-06-10T17:30 Updated `PLANS.md` status table (E0 in_progress).
- 2026-06-10T17:30 Appended this WORKLOG section.
- 2026-06-10T17:30 Read all 7 required handoff files in order. Key takeaways: H-03/H-04 confirmed code-level (use-toast.ts TOAST_LIMIT=1, TOAST_REMOVE_DELAY=1000000ms, no dedup/stale-clear); H-05 grep-audit needed; H-01/H-02/H-07 need code reads; H-06/H-08/H-09 need device work.

### E1 — Baseline

- 2026-06-10T17:51 `npm run test` passed: 583 files / 6745 tests (reference: 582/6739 on 2026-06-06; 1 new file, 6 new tests — pre-existing branch delta).
- 2026-06-10T17:53 `npm run lint` initially failed: two pre-existing issues:
  1. `tests/unit/scripts/detectPreinstalledAndroidSdk.test.ts` formatting (committed in `4695a673` without running prettier) — fixed with `npx prettier --write`.
  2. ESLint scanned `.worktrees/stabilize-structured-soak/` (gitignored but not in eslint ignores), picking up a build artifact with a missing typescript-eslint rule → error. Fixed by adding `.worktrees/**` to `eslint.config.js` ignores. Pre-existing: worktree existed before this run.
- 2026-06-10T17:55 `npm run lint` passes after fixes. Remaining: 3 warnings from generated `c64scope/coverage/*.js` — pre-existing, not actionable.
- 2026-06-10T18:00 `npm run build` passed (8.09 s, 47 chunks, all under bundle budget).
