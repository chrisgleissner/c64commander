# WORKLOG — Full CTA Coverage Hardening Pass

All times 2026-06-24 unless noted.

## Continuation for exhaustive Pixel 4 certification — 2026-06-24T23:55:38Z

- Role/prompt accepted: autonomous continuation for deep Pixel 4 CTA and flow certification on serial `9B081FFAZ001WX`, package `uk.gleissner.c64commander`, target `c64u` with password redacted in artifacts.
- Read current repo guidance and previous-state files: `README.md`, `REVIEW.md`, `.github/copilot-instructions.md`, `docs/ux-guidelines.md`, `PLANS.md`, `WORKLOG.md`, `docs/testing/agentic-tests/full-cta-coverage/runs/progress-ledger.md`, and `docs/testing/agentic-tests/full-cta-coverage/runs/infrastructure-audit.md`.
- Attempted to read stricter-prompt previous artifacts; these are absent in the checkout: `docs/testing/agentic-tests/full-cta-coverage/final-report-2.md`, `cleanup-report-2.md`, `callback-8020-residual-risk.md`, and `cta-runner.md`.
- Current branch/SHA: `test/full-cta-coverage`, `515e2818ed1992dd6e3579470e1355488111278f`.
- Starting worktree is dirty; preserving unrelated-looking local changes in `scripts/repro-cursor-blink-snapshot-restore.mjs`, `src/lib/machine/ramOperations.ts`, `tests/unit/machine/ramOperations.test.ts`, and untracked `scripts/prove-snapshot-all-types.ts`.
- Latest APK on disk before this continuation is stale: `android/app/build/outputs/apk/debug/c64u-remote-0.8.9-10c4b-debug.apk`.
- Installed Pixel 4 package before this continuation is stale: versionName `0.8.9-10c4b`, versionCode `2040`, lastUpdateTime `2026-06-25 00:17:22`, package path `/data/app/~~U83Do-y3NWKqtU49tTBMPw==/uk.gleissner.c64commander-xwJ3ACWEBnM_ee8FAXUMiw==/base.apk`, signature short `d39d81d2`.
- Classification: HIL/device certification. Per the repository HIL exception, current priority is current-SHA APK build/install and Pixel 4 evidence; coverage is a finalization gate, not the first action.
- Updated `PLANS.md`. Artifact root for this continuation: `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/`.
- Next command: create artifact log directories, run `npm run scope:check`, then build/install the current APK to Pixel 4.
- Created the artifact directory tree under `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/`.
- Ran `npm run scope:check`; passed 55 files / 356 tests. Logs:
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/commands/npm-run-scope-check.stdout.log`
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/commands/npm-run-scope-check.stderr.log`
- Ran `./build --skip-tests --install-apk --device-id 9B081FFAZ001WX`; build/install succeeded and launched the app. Logs:
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/commands/build-skip-tests-install-apk.stdout.log`
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/commands/build-skip-tests-install-apk.stderr.log`
- Current APK: `android/app/build/outputs/apk/debug/c64commander-0.8.9-515e2-debug.apk`, SHA-256 `2f9b1569575eb6539509dc828ead4a220ac79ad516aa100fc4971635a0adea45`.
- Installed package after build: versionName `0.8.9-515e2`, versionCode `2041`, lastUpdateTime `2026-06-25 00:59:13`, package path `/data/app/~~RNFTH4jdudOH7uFn_NTnlA==/uk.gleissner.c64commander-Epu5KWMBWr_2w8EVExzTXA==/base.apk`, signature short `d39d81d2`.
- Captured baseline current-SHA screenshot/hierarchy/logcat:
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/screenshots/baseline-current-sha-launch.png`
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/hierarchies/baseline-current-sha-launch.xml`
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/logcat/baseline-after-install-launch.log`
- MCP capability check passed with `satisfied: true`, `missing: []`; artifact `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/mcp-capabilities.json`.
- Target health probes recorded as infrastructure-only evidence: `c64u` unauthenticated 403, `c64u` authenticated 200 from host and Pixel-side curl, `u64` unauthenticated 200.
- Ran generic Gate 3 current-SHA Save-and-Connect command; artifact `c64scope/artifacts/cta-20260625T000108Z-pixel4-c64u-515e2818ed19/` returned `BLOCKED` because the runner did not find `Save & Connect` after editing the host field and later hierarchies show Android launcher. Command logs were redacted after the wrapper echoed the password argument.
- Ran targeted app-driven Save-and-Connect proof through `DroidmindClient` without localStorage/DOM edits. Result `PROVEN`; evidence root `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/targeted-save-connect/`. Pre/post app-visible status was `Connected to c64u, system healthy`; post-action Settings text was `Currently using: c64u · HTTP 80 · FTP 21 · Telnet 23`.
- Ran current-SHA all-route discovery:
  - Command: `npm run scope:cta:discover-routes -- --serial 9B081FFAZ001WX --target c64u --start-app --settle-ms 2200 --max-scrolls 12 --artifact-dir ../c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19`
  - Route counts: Home 106, Play 24, Disks 40, Config 28, Settings 74, Docs 18; total 290 discovery-only CTA rows.
  - Settings stopped at `max-scrolls`; treat as inventory completeness risk for Settings deep dive, not as coverage.
- Re-ran current-SHA keypad canary with D-pad: artifact `c64scope/artifacts/cta-20260625T000854Z-pixel4-c64u-515e2818ed19/`; 11/11 PASS.
- Re-ran Gate 4: artifact `c64scope/artifacts/cta-20260625T000959Z-pixel4-c64u-515e2818ed19/`; `PROVEN`, Theme Auto -> Dark -> Auto restored.
- Re-ran Gate 5: artifact `c64scope/artifacts/cta-20260625T001042Z-pixel4-c64u-515e2818ed19/`; 12/12 PASS.
- Gate 6 current-SHA runner hung for over five minutes while the app was stationary at Settings top and the process was inside DroidMind hierarchy capture. Stopped it with Ctrl-C; no `gate6.js` child remained. Partial artifact root `c64scope/artifacts/cta-20260625T001329Z-pixel4-c64u-515e2818ed19/`; live screenshot was captured through the MCP DroidMind screenshot tool.
- Re-ran Gate 6.5: artifact `c64scope/artifacts/cta-20260625T001827Z-pixel4-c64u-515e2818ed19/`; 11/12 PASS. The only blocked row was Config page load; screenshot proves the Drive A mount sheet remained open over Disks, so this is overlay contamination, not a Config outage.
- Dismissed the Drive A mount sheet via DroidMind Back.
- Re-ran Gate 7: artifact `c64scope/artifacts/cta-20260625T002012Z-pixel4-c64u-515e2818ed19/`; 2/3 PASS. Host and password negative mutations restored successfully. HTTP port scenario blocked while trying to restore, but follow-up cleanup proved the field was already `80`.
- Ran focused HTTP-port cleanup after Gate 7: evidence `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/restore-http-port-after-gate7/result.json`; status `PROVEN`, app-visible `Currently using: c64u · HTTP 80 · FTP 21 · Telnet 23`.
- Redaction scan for `pwd` and `wrongpwd` across active current-SHA artifacts returned no matches after redacting targeted Save-and-Connect and Gate 7 generated files.
- Ran Config deep dive from clean app state:
  - Evidence root `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/config-deep-dive/`
  - Status `PROVEN`
  - Five Config load entries detected `CONFIG`, app-visible `Connected to c64u, system healthy`, no loading/error/retry text.
  - Config census found 28 controls, 4 scroll attempts, fixed-point stop.
  - Refresh CTA was not visible in the initial viewport and remains for full CTA ledger execution.
- Ran guarded Disks Drive A mount/eject repetition against imported `/USB2/test-data/d64/Boulder Dash 2.d64`:
  - Evidence root `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/disks-mount-eject-loop/`
  - Iteration 1: mounted and ejected; after-eject text `No disk mounted`.
  - Iteration 2: mounted and ejected; after-eject text `No disk mounted`.
  - Iteration 3: tapped Drive A Mount disk and `Boulder Dash 2.d64`; after-mount screenshot shows `No disk mounted`, red C64U badge with two issues, and Drive A `Connection reset`; Eject control not found.
- Per device-safety rule, ran one infrastructure health probe after app-visible reset; authenticated `http://c64u/v1/info` failed with `curl: (56) Recv failure: Connection reset by peer`, HTTP code `000`.
- Stopped further `c64u` traffic, captured live screenshot/hierarchy, and stopped the app through `DroidmindClient.stopApp`.
- Captured logcat to `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/logcat/disks-loop-connection-reset.log`.
- Added S1 defect `docs/testing/agentic-tests/full-cta-coverage/defects/S1-DISKS-MOUNT-EJECT-RESETS-C64U.md`.

## Continuation for exhaustive Pixel 4 certification — 2026-06-24T21:48:02Z

- Role/prompt accepted: autonomous continuation for deep Pixel 4 CTA and flow certification on serial `9B081FFAZ001WX`, package `uk.gleissner.c64commander`, target `c64u` with password restored/redacted as required.
- Read current repo guidance and previous-state files: `README.md`, `REVIEW.md`, `.github/copilot-instructions.md`, `PLANS.md`, `WORKLOG.md`, `docs/testing/agentic-tests/full-cta-coverage/runs/progress-ledger.md`, `docs/testing/agentic-tests/full-cta-coverage/runs/infrastructure-audit.md`, and `docs/testing/agentic-tests/full-cta-coverage/handover4.md`.
- Required previous hardening artifacts requested by the prompt but missing from the checkout: `final-report-2.md`, `cleanup-report-2.md`, `callback-8020-residual-risk.md`, and `cta-runner.md`.
- Current branch/SHA confirmed again: `test/full-cta-coverage`, `414ec2a965d64651881c658cc5df772dd4ed934b`.
- Existing dirty worktree preserved. Notable existing changes include `PLANS.md`, `WORKLOG.md`, `c64scope/src/cta/gate3.ts`, `c64scope/src/cta/retention.ts`, `c64scope/tests/ctaRetention.test.ts`, generated variant/branding files, and untracked CTA audit files.
- Classification: HIL/device certification with existing executable CTA infrastructure changes. Per AGENTS exception for Pixel 4 HIL loops, current priority is build/install/device proof; coverage is not run before HIL deliverables.
- Updated `PLANS.md` for the stricter continuation. Active blocker is stale installed APK versus current source state.
- Next material commands: `npm run scope:check`, then current APK build/install to Pixel 4, package identity capture, launch, baseline screenshot/hierarchy/logcat, and app-driven Gate 3 Save-and-Connect.
- Ran `npm run scope:check`; passed 52 files / 351 tests. Logs:
  - `c64scope/artifacts/cta-20260624T214802Z-pixel4-c64u-414ec2a965d6/logs/commands/npm-run-scope-check.stdout.log`
  - `c64scope/artifacts/cta-20260624T214802Z-pixel4-c64u-414ec2a965d6/logs/commands/npm-run-scope-check.stderr.log`
- Ran `./build --skip-tests --install-apk --device-id 9B081FFAZ001WX`; Android build succeeded, install initially failed with `INSTALL_FAILED_VERSION_DOWNGRADE` because installed versionCode `2038` was newer than current-source versionCode `2037`.
- Per repo deploy rule, uninstalled `uk.gleissner.c64commander` from Pixel 4 and installed `android/app/build/outputs/apk/debug/c64commander-0.8.9-414ec-debug.apk`.
- Fresh APK identity:
  - APK: `android/app/build/outputs/apk/debug/c64commander-0.8.9-414ec-debug.apk`
  - SHA-256: `b404778e5c617c203009a7b608dbca2149555a45dfdb9c1c21342c2af6225256`
  - Installed versionName `0.8.9-414ec`, versionCode `2037`
  - firstInstallTime/lastUpdateTime `2026-06-24 22:52:18`
  - package path `/data/app/~~AIeSfoxigZHXtD-Mo6Ky-g==/uk.gleissner.c64commander-ITET5_YkUO8PpJhMlS5JLA==/base.apk`
- Launched the app through `DroidmindClient`, captured baseline screenshot/hierarchy/logcat:
  - `c64scope/artifacts/cta-20260624T214802Z-pixel4-c64u-414ec2a965d6/screenshots/baseline-launch.png`
  - `c64scope/artifacts/cta-20260624T214802Z-pixel4-c64u-414ec2a965d6/hierarchies/baseline-launch.xml`
  - `c64scope/artifacts/cta-20260624T214802Z-pixel4-c64u-414ec2a965d6/logs/logcat/baseline-launch.log`
- Baseline after clean reinstall auto-selected/probed `u64` (`192.168.1.13`) before C64U restoration.
- Ran current Gate 3 Save-and-Connect. First run `cta-20260624T215352Z-pixel4-c64u-414ec2a965d6` was `BLOCKED`: app-visible `Offline, device not reachable` while Settings showed active target `192.168.1.167 · HTTP 80 · FTP 21 · Telnet 23`.
- Investigated the app-visible offline state:
  - Pixel 4 ping to `192.168.1.167` and `c64u` succeeded with 0% loss.
  - Host curl to `http://c64u/v1/info` returned 403 without password and 200 with `X-Password`.
  - Pixel-side `adb shell curl` to `http://192.168.1.167/v1/info` returned 200 with `X-Password`.
  - Conclusion: C64U/network/password were healthy; initial Gate 3 offline state was transient/app retry state, not target unreachability.
- Found a C64Scope evidence redaction defect: Gate 3 result/summary and hierarchy XML exposed the test password. Immediately redacted existing current-run artifacts and patched the runner.
- Implemented redaction fixes:
  - `c64scope/src/cta/gate3.ts` now redacts Gate 3 password text in steps, JSON evidence, and Markdown summary.
  - `c64scope/src/cta/runnerCommon.ts` now supports secret-aware UI hierarchy writes.
  - Added `c64scope/tests/ctaGate3Redaction.test.ts`.
  - Added `c64scope/tests/ctaRunnerCommonRedaction.test.ts`.
- Validation after redaction fixes:
  - `npm run scope:check` passed 53 files / 352 tests after Gate 3 summary/result redaction.
  - `npm run scope:check` passed 54 files / 353 tests after hierarchy redaction.
- Re-ran Gate 3 with fully redacted runner. Canonical current-APK artifact:
  - `c64scope/artifacts/cta-20260624T220402Z-pixel4-c64u-414ec2a965d6/`
  - Status `PROVEN`
  - Connection status `Connected to c64u, system healthy`
  - Currently using `c64u · HTTP 80 · FTP 21 · Telnet 23`
  - Redaction scan for `pwd` in the canonical artifact and current command logs returned no matches.
- Added current-SHA all-route discovery runner and executed it on Pixel 4:
  - Command: `npm run scope:cta:discover-routes -- --serial 9B081FFAZ001WX --target c64u --start-app --settle-ms 2200 --max-scrolls 12`
  - Artifact: `c64scope/artifacts/cta-20260624T221006Z-pixel4-c64u-414ec2a965d6/`
  - Discovery counts: `/current` 43, `/play` 27, `/disks` 26, `/config` 9, `/settings` 76, `/docs` 18, total 199.
  - Result status remains discovery-only (`CALIBRATION_ONLY` rows), not CTA coverage proof.
- Ran current-SHA keypad canary:
  - Command: `npm run scope:cta:keypad -- --serial 9B081FFAZ001WX --target c64u --start-app`
  - Artifact: `c64scope/artifacts/cta-20260624T221253Z-pixel4-c64u-414ec2a965d6/`
  - Result: 9/9 passed for digit tabs, Star diagnostics, Pound device switcher, and one touch docs activation.
- Re-ran Gate 4, Gate 5, Gate 6, and Gate 6.5 on the current APK:
  - Gate 4 artifact `c64scope/artifacts/cta-20260624T221410Z-pixel4-c64u-414ec2a965d6/`, `PROVEN` Theme Auto -> Dark -> Auto restored.
  - Gate 5 artifact `c64scope/artifacts/cta-20260624T221549Z-pixel4-c64u-414ec2a965d6/`, 12/12 PASS.
  - Gate 6 artifact `c64scope/artifacts/cta-20260624T221859Z-pixel4-c64u-414ec2a965d6/`, 16/17 PASS with `/home` `home-ports-tab` blocked because the PORTS control was behind the tab bar.
  - Gate 6.5 artifact `c64scope/artifacts/cta-20260624T222244Z-pixel4-c64u-414ec2a965d6/`, 11/12 PASS with `/config` initially blocked.
- Investigated the Gate 6.5 Config block:
  - Evidence in `gate65` hierarchies showed the `Mount disk to Drive A` sheet was still open, so `KEY_4` was consumed by the overlay.
  - Direct clean Config navigation via `DroidmindClient.pressKey("KEYCODE_4")` discovered 28 Config controls and showed connected `c64u`.
  - Evidence: `c64scope/artifacts/cta-20260624T214802Z-pixel4-c64u-414ec2a965d6/screenshots/config-direct-clean.png`, `hierarchies/config-direct-clean.xml`, `diagnostics/config-direct-clean-census.json`.
  - Decision: reclassify Gate 6.5 Config as overlay contamination from Disks, not a proven Config route outage.
- User interruption at `2026-06-24T22:28:37Z`: app-visible `Mount disk` dialog was completely empty; user requested a fix and noted disk fixtures under `/home/chris/dev/c64/test-data` and `/USB2/test-data` on `c64u`.
- Diagnosed the empty dialog root cause in `src/components/disks/HomeDiskManager.tsx`:
  - Drive A/B `Mount disk` sheet lists only `diskLibrary.disks`.
  - Clean reinstall left `c64u_disk_library:shared` empty.
  - Existing Disks page has an Add disks flow, but the mount sheet exposed no Add disks CTA, so it was a dead end.
- Implemented the product fix:
  - Added an empty-state `Add disks` CTA inside the Drive A/B mount sheet using the existing `ItemSelectionDialog` and C64U/local source flow.
  - Added regression test coverage in `tests/unit/components/disks/HomeDiskManager.dialogs.test.tsx`.
  - Updated `docs/cta-inventory.md` for the new `mount-sheet-add-disks` CTA.
- Ran focused regression command `npm run test -- tests/unit/components/disks/HomeDiskManager.dialogs.test.tsx`; passed 9/9 tests.
- Ran `npm run scope:check`; passed 55 files / 356 tests after the mount-sheet fix.
- Built and installed patched APK on Pixel 4:
  - APK SHA-256 `664a07f36576b83a22d794cff15ee3c8dbf6a19ca0ab33efc5e4093e6c411385`.
  - Installed versionName `0.8.9-414ec`, versionCode `2037`, lastUpdateTime `2026-06-24 23:31:57`, package path `/data/app/~~9Gb8mrWG5vFjCQtgoZ59Iw==/uk.gleissner.c64commander-TYAfeYOawuwio8xAH1eIIA==/base.apk`.
- DroidMind proof attempt `DISKS-MOUNT-EMPTY-FIX-PIXEL4` initially failed its own assertion after tapping Add disks because the Add items dialog was already open over the mount sheet. The screenshots nevertheless prove the new empty-state `Add disks` CTA was visible and opened the Add items source dialog.
- Follow-up import/mount runner was interrupted after the user identified a second Disks source-picker defect: the Disks Add items popup showed Local and C64U but omitted CommoServe.
- Diagnosed the CommoServe source omission:
  - `PlayFilesPage` includes `createArchiveSourceLocation(archiveConfig)` when `commoserve_enabled` is true and passes `archiveConfigs` to `ItemSelectionDialog`.
  - `HomeDiskManager` only built Local and C64U `sourceGroups`; it did not import the archive source adapter or archive settings.
- Implemented the CommoServe Disks fix:
  - `HomeDiskManager` now uses `useArchiveClientSettings`, appends CommoServe to Disks source groups when enabled, and passes `archiveConfigs` to `ItemSelectionDialog`.
  - Disks archive selections now resolve archive entries, find disk images, download the selected disk image, and add it to the normal disk library with a runtime `File` so it can be mounted through the existing local upload path.
  - Updated `DocsPage` and `docs/cta-inventory.md` to include CommoServe for Disks Add items.
  - Added regression coverage that verifies CommoServe appears in the Disks Add items picker and archive disk images are imported as runtime mountable disk entries.
- Ran targeted disk component suites:
  - Command: `npm run test -- tests/unit/components/disks/HomeDiskManager.dialogs.test.tsx tests/unit/components/disks/HomeDiskManager.test.tsx tests/unit/components/disks/HomeDiskManager.extended.test.tsx tests/unit/components/disks/HomeDiskManager.branches.test.tsx tests/unit/components/disks/HomeDiskManager.focus.test.tsx tests/unit/components/disks/HomeDiskManager.ui.test.tsx`
  - Result: 6 files passed, 98 tests passed.

## Phase 0 — infrastructure conformance audit started

- Branch at start: `test/full-cta-coverage`.
- Git SHA at start: `414ec2a965d64651881c658cc5df772dd4ed934b`.
- Starting worktree: untracked `docs/testing/agentic-tests/full-cta-coverage/hardening1/`.
- Read required current-run inputs: full-CTA prompt, handovers 1-4, progress ledger, previous final report, previous cleanup report, `AGENTS.md`, `REVIEW.md`, `.github/copilot-instructions.md`, canonical agentic contracts, and full-app coverage reference docs.
- Previous final report is historical baseline only: it certifies SHA `41b0d368ca06d80f9ffc0e40f10a46e1b11fe380`, while this pass is auditing SHA `414ec2a965d64651881c658cc5df772dd4ed934b`.
- Infra identity checks:
  - Pixel 4 attached as `9B081FFAZ001WX`; Android `16`, SDK `36`.
  - Installed package `uk.gleissner.c64commander`: versionCode `2038`, versionName `0.8.9-c102a`.
  - Latest local APK: `android/app/build/outputs/apk/debug/c64commander-0.8.9-c102a-debug.apk`.
  - U64 fallback reachable by infra probe: Ultimate 64 Elite firmware `3.14e`, unique ID `38C1BA`.
  - C64U unauthenticated infra probe returns HTTP 403, so app-driven authenticated status remains to be revalidated.
- Audit findings so far:
  - CTA implementation is inside `c64scope/src/cta`; no parallel package found.
  - Root and `c64scope` scripts expose `scope:cta`, `scope:cta:discover`, `scope:cta:resume`, `scope:cta:replay`, keypad, and gate-specific runners.
  - `docs/testing/agentic-tests/full-cta-coverage/cta-runner.md` is absent and must be added.
  - Gate 3 uses `DroidmindClient.shell("input keyevent ...")` for product text-field editing; hardening pass treats that as a control-path gap and will replace it with `pressKey()`.
- Implemented Phase 0 fixes:
  - Replaced Gate 3 shell keyevent use with `DroidmindClient.pressKey()` for MOVE_END and DEL.
  - Added `c64scope/tests/ctaControlPathPolicy.test.ts` to prevent shell keyevents in CTA product runners.
  - Added `docs/testing/agentic-tests/full-cta-coverage/cta-runner.md`.
  - Fixed retention so incomplete legacy CTA artifact directories without `results.json` do not abort current runs.
  - Added retention regression coverage for incomplete legacy directories.
- Validation:
  - `npm run scope:check` passed: 52 test files, 351 tests.
  - First `npm run scope:cta -- --device 9B081FFAZ001WX --target c64u --discover-only --routes /current --case CTA-HARDENING-SMOKE --retain-success 999` failed before the retention fix because old artifact `cta-20260624T112157Z-pixel4-c64u-41b0d368ca06` lacked `results.json`.
  - Same command passed after the retention fix and emitted `c64scope/artifacts/cta-20260624T212754Z-pixel4-c64u-414ec2a965d6/`; MCP capability check satisfied all requirements.
  - `npm run scope:cta:discover -- --serial 9B081FFAZ001WX --route /current --start-app` passed and emitted `c64scope/artifacts/cta-discover/cta-discover-20260624T212806Z/cta-discover.json` with 2 discovered controls.
  - `npm run scope:cta:replay -- --run-id cta-20260624T212754Z-pixel4-c64u-414ec2a965d6 --case CTA-HARDENING-SMOKE` passed and emitted `replays/CTA-HARDENING-SMOKE-replay-summary.json`.
- Representative previous artifacts parsed successfully with current JSON expectations:
  - Gate 5 coverage: 12/12 PASS.
  - Gate 6 coverage: 14/16 PASS.
  - Gate 6.5 coverage: 11/12 PASS.
  - Gate 7 result: 3/3 PASS.
  These remain stale because they target SHA `41b0d368ca06`.

---

# WORKLOG — menu ⇄ REST config mapping hardening

All times 2026-06-23 (local). Prior task content for this file is in git history.

## P0 — baseline + evidence inventory

- Branch `feat/align-ux-with-device-menu`; large uncommitted feature tree (untracked
  `src/lib/config/menuMapping/`, `src/pages/config/`, `scripts/compile-menu-mapping.mjs`,
  `scripts/menu-mapping/`, tests, generated TS, screenshots).
- Architecture (verified by reading source, not the prior report):
  - **Layer A overlay** (`overlay.ts`, `types.ts`): `{category→{item→{label,formatterId}}}`,
    device-agnostic, applied on every device, first-writer-wins merge.
  - **Layer B hierarchy** (`resolveMenuMapping.ts`): registry keyed by family+firmware;
    C64U 1.1.0 only; never crosses families; `null` → REST-grouped layout. Intra-family
    version fallback (exact → nearest-lower → latest).
  - **Projection** (`projectConfigToMenu.ts`): pure, computed over LIVE data; lossless
    (`renderedRestKeySet == liveRestKeySet`); stale pointers dropped not errored.
  - **Routing** (`advancedRouting.ts`): keyword (U64-Specific topic split) → sole-owner
    (data-derived) → category default (per family). Page renderer
    (`MenuPageSection`/`AdvancedFallbackSection`) consumes the SAME routing functions, so
    the pure projection and the runtime agree (no divergence).
  - **Write-back** (`useConfigLeafWrite.ts`): canonical `{category,item}` via `setConfig`
    → PUT (single-item; POST is the device-crash path). Aliases share one optimistic cell
    keyed by `canonicalConfigKey` (`ConfigLeafRow`).
  - **Compiler** validates: stale paths, duplicate paths, unknown formatters, conflicting
    primary labels, alias-without-primary, mapped/intentional items exist in the config
    sample, and **completeness** (every config item mapped OR intentionallyUnmapped).
    `--check` is wired into `npm run lint`.
- Claim checks:
  - Prior report "did not modify repo-root PLANS.md/WORKLOG.md" — TRUE: both tracked,
    last touched at `6bfb766a` (previous feature), no working-tree diff. Updated here.
  - "Advanced fallback dissolved" — FALSIFIED as stated: it is not dissolved by design,
    it is *populated by speculative category defaults* so it renders empty on C64U. See P2.
- Baseline gates: `menu-mapping:check` OK (179 items, 16 menu-only). Targeted suite
  (7 files / 47 tests) green.

## P1 — verification matrix

`projectConfigToMenu.test.ts` already proves the lossless set-equality on real fixtures:
C64U 1.1.0 (hierarchy), C64U 3.14 (intra-family fallback + stale ref), U64e 3.12a / 3.14e
(null → REST-grouped), a synthetic never-seen category ("Audio Output Settings", a U2
stand-in) → fallback with intact write identity, drive-ROM alias dedup, menu-only nodes.
`ConfigBrowserPageMenuMode.test.tsx` proves the runtime: menu pages render, menu labels
applied, write-back uses canonical `{category,item}`, alias rows share the source.
Matrix rows all covered; extended the routing assertions in P2.

## P2 — advanced-routing adversarial review

Evidence gathered from `c64u-menu.yaml` (label/structure authority) + `c64u-config.yaml`
(REST schema):
- `c64u-menu.yaml` has NO Tape page, NO `C64U Model`, NO SoftIEC/Data-Streams page
  (only Audio Mixer "Vol/Pan tape *" volume rows mention "tape").
- `intentionallyUnmapped` leftovers reach routing: `C64U Model`, SoftIEC (`IEC Drive`,
  `Soft Drive Bus ID`, `Default Path`), `Tape Playback Rate`, Data Streams (`Stream * to`,
  `Debug Stream Mode`), plus keyworded U64-Specific items + sole-owned C64/Cartridge leftovers.
- The `categoryDefaults` tier placed WHOLE categories on a page with no captured-menu
  evidence: `U64 Specific Settings→Video setup` (caught only `C64U Model`),
  `SoftIEC→Built-in drive A`, `Tape→Built-in drive A`, `Data Streams→Network`. These are
  exactly the "too broad / likely to misplace future items" rules the brief flags.

Defect: `Tape Playback Rate` rendered on "Built-in drive A" (cassette setting on the disk
drive page) and `C64U Model` (hardware edition) on "Video setup" — both misleading, neither
evidence-backed.

Fix: removed all `categoryDefaults` (kept the field as an empty, documented extension
point). Kept the evidence-based tiers: keyword rules (topical split of the one multi-owner
category — HDMI→Video, user-port→Joystick, drive-comms→Built-in drive A) and sole-owner
derivation (a category genuinely claimed by exactly one page). Unplaceable leftovers
(`C64U Model`, SoftIEC, Tape, Data Streams) now render in the residual, explicitly-labelled
**Advanced (REST-only) settings** section — lossless, canonical write-back, self-hiding when
empty (invariant #7). Keyword routing of HDMI Tx Swing/Adjust Color Clock/UserPort/Serial
Bus/SpeedDOS/Burst Mode is unchanged (topically correct).

Tests updated to encode the evidence-based behavior (placement assertions changed; lossless
set-equality unchanged): `advancedRouting.test.ts`, `projectConfigToMenu.test.ts`,
`ConfigBrowserPageMenuMode.test.tsx`.

## P3 — `Disk swap delay` / `Loop delay` units

Sources checked: `c64u-config.yaml` (REST schema), `c64u-3.14`/`u64e-*` configs, menu YAML,
`menuValueFormatters.ts`, `ConfigItemRow.tsx`, `normalizeConfigItem.ts`, association YAML.

Verified from the firmware REST schema `format` field (printf-style):
- `Disk swap delay` (Drive A/B): `min:1 max:10 format:"%d00 ms"` → display `value*100 ms`
  (1→"100 ms" … 10→"1000 ms").
- `Loop Delay` (Modem Settings): `min:1 max:20 format:"%d0 ms"` → display `value*10 ms`
  (2→"20 ms" … 20→"200 ms").

Root cause of "raw": `ConfigItemRow` fetches `format` into `mergedDetails` but **never uses
it** (dead memo, line ~176); `inferControlKind` keys only off options, so a min/max/format
item with no options renders as a raw text input. This is app-wide — ~108 items across the
sampled configs carry a `format` string (`%d`, `%d00 ms`, `%02d`, `%d ppm`, `%d0 ms`,
`%02x`, `%d00`). Honoring `details.format` generically would change rendering for all of
them (control-kind + slider/label) — a broad shared-control change, out of this feature's
scope and not a menu-mapping concern.

Disposition: keep RAW. A hardcoded ×100/×10 multiplier in the menu overlay would be the
wrong layer (duplicating device-provided `format`) AND ineffective (these items have no
options, so `formatOptionLabel` never fires). Added a regression test that pins raw display
and raw write-back for both items, and documented the verified unit + the dead-code finding.
No multiplier invented.

## P4 — overlay/label cleanup

Audited the generated overlay labels: already natural sentence case (menu-YAML-sourced:
"CPU speed", "HDMI scan resolution", "Analog video mode", "Auto save config"). No stale
source-reference annotations, no spurious title-case. C64U/U64/U2 terminology consistent.
Minimal change.

## P5 — source pipeline + authoring cleanup

Compiler is deterministic + drift-checked (verified `--check` fails on a hand-edited
generated file). Updated `README.md` + `SKILL.md` to describe the evidence-based routing
(no speculative whole-category defaults; unplaceable → residual Advanced). `restKey`
separator robustness reviewed (see findings).

## P6 — UI integration review

- Hierarchy mode selected only when `resolveMenuMapping` returns non-null; else REST-grouped.
- Layer A overlay applied in both layouts (`ConfigBrowserPage` passes `TERMINOLOGY_OVERLAY`;
  `FallbackCategoryBlock` uses `resolveOverlayEntry`).
- Lazy per-category fetch preserved (`useC64Category` gated on `isOpen`/`active`); each
  `MenuBlock` fetches exactly one category → stable hook usage (no hooks-in-a-loop).
- Aliases share the optimistic store via `canonicalConfigKey`.
- Audio Mixer keeps the specialized `CategorySection` (solo/reset/BUG-033) — routed by
  `soleRestCategory(page)==="Audio Mixer"`.
- U64E-only `Clock Settings` renders editable in REST-grouped mode (proved in projection test).

## P7 — E2E / screenshots / HIL

E2E impact of the P2 routing change (audited every spec):
- `demoConfig.spec.ts` — encoded the old "junk drawer dissolved" behavior
  (`config-advanced-fallback` count 0). The demo config is `docs/c64/c64u-config.yaml`,
  which DOES contain the now-residual categories (C64U Model, SoftIEC, Tape Settings,
  Data Streams). Updated the spec: the residual Advanced (REST-only) section is now present
  and shows `Tape Playback Rate` (litmus test: the new behavior is the intended,
  evidence-based one — the spec encoded the removed speculative placement).
- `configEditingBehavior.spec.ts` — UNAFFECTED: it relies on `Clock Settings` rendering in
  the residual fallback (Clock Settings was never in `categoryDefaults`, so it always routed
  to residual — before and after).
- `solo.spec.ts`, `navigationBoundaries.spec.ts`, `ui.spec.ts`, `configVisibility.spec.ts`,
  `keypadInput.spec.ts`, `homeInteractivity.spec.ts` — UNAFFECTED (assert mapped items
  System Mode / drive page / Data-Streams-as-home-mock; none depend on the removed defaults).
- `screenshots.spec.ts` — captures config sections generically (including the
  `config-advanced-fallback-toggle` → `advanced-rest-only` slug). With the residual section
  now present in demo mode it will capture an `advanced-rest-only` screenshot again; the
  catalog is a blob-diff tracker, not a fixed required list, so a new capture does not fail it.

HIL (real hardware on the local network, 2026-06-23):
- **Ultimate 64 Elite — REACHABLE, no auth.** `http://u64` → `/v1/info` product
  "Ultimate 64 Elite", firmware 3.14e, fpga 122, hostname u64. `GET /v1/configs` returns 19
  live categories incl. the U64e-only `Clock Settings`, SoftIEC, Tape, Data Streams, U64
  Specific. `normalizeKnownProduct("Ultimate 64 Elite")` → `u64e` → family `U64E` →
  `resolveMenuMapping` returns null → **REST-grouped layout** (Layer A overlay still applies).
  This is the null-hierarchy path; my C64U-only routing change does not affect it. The
  lossless REST-grouped rendering of this exact category shape (incl. Clock Settings,
  editable) is unit-proven over the matching `u64e-3.14e` fixture.
- **C64U — VALIDATED ON-DEVICE (PASSED).** Credential later supplied by the user; handled
  via a gitignored scratchpad file (referenced through `$(cat)`, shredded afterwards) and
  the app's own stored password — never printed to logs/screenshots/commits. Built+installed
  the hardening APK (`0.8.9-6f367`, commit `6f367873`) to Pixel `9B081FFAZ001WX` via
  `./build --skip-tests --install-apk`, switched the active device to **c64u** (product
  "C64 Ultimate", firmware **1.1.0** — exact hierarchy match → menu mode), opened Config and
  expanded **Advanced (REST-only) settings**. Confirmed on real hardware:
  - The full menu hierarchy renders (Memory & ROMs, Turbo boost, Video setup, Audio setup
    group, … Built-in drive A/B) with friendly labels + group headers.
  - The residual **Advanced (REST-only) settings** section is present and contains exactly
    the items my change routes there: **U64 SPECIFIC SETTINGS → C64U Model = "Starlight
    Edition"** (NOT mis-homed on Video setup), **SOFTIEC DRIVE SETTINGS** (IEC Drive, Soft
    Drive Bus ID 11, Default Path /USB0/), **TAPE SETTINGS → Tape Playback Rate = "0.98 MHz
    (PAL)"** (NOT mis-homed on Built-in drive A), **DATA STREAMS** (Stream VIC/Audio to …).
  - **Unknown-category invariant proven on real hardware:** the live C64U exposes 22
    categories incl. **"ARMSID in Socket 1" / "ARMSID in Socket 2"** — categories present in
    NO fixture/association (the fixture has "ARMSID" only as a SID-socket *option value*).
    Both surface automatically in the Advanced section, fully rendered + editable (Fundamental
    Mode / 6581 Filter Strength / 8580 Filt Freq sliders + selects) with humanized labels.
    This also disproves the prior "junk drawer fully dissolved" claim: even a fixture-matching
    1.1.0 device shows a residual section (ARMSID).
  - Device health flaked once during the connection handover ("Host unreachable", badge
    "DEGRADED") — the documented c64u overload/handover drop-out, not a regression (read-only
    curl confirmed the device healthy throughout: 200 OK ~10ms). A single in-app **Retry**
    recovered to **C64U ● HEALTHY** and the page rendered.
  - Write-back NOT exercised on the live device (to avoid mutating the user's hardware,
    especially given the intermittent drop-outs). It is unchanged by this routing work and is
    covered by unit (`ConfigBrowserPageMenuMode`: System Mode / alias writes assert canonical
    `{category,item}`) + E2E (`configEditingBehavior`: PUT commit-on-blur).
  - Evidence PNGs: `hil_advanced_c64umodel_armsid.png`,
    `hil_advanced_softiec_tape_datastreams.png` (session scratchpad `hil-c64u/`).

Screenshots: the C64U/demo config surface gains a residual Advanced (REST-only) section, so
the committed docs section PNGs for the config surface are candidates for recapture (P5).
The prior `advanced-rest-only` screenshot was removed under the old "dissolved" design; it is
legitimately reintroduced by this change.

## P11 — performance: config section expansion

Measured (real C64U, Pixel 4, via a WebView CDP DOM-settle probe — Capacitor uses native
HTTP so CDP Network/resource-timing can't see the requests):

- Diagnosis: live `GET /v1/configs/<category>` returns **scalars only** (no options/details);
  every `ConfigItemRow` then hits `needsDetailFetch` and fires its OWN `GET /v1/configs/<cat>/<item>`
  → an **N+1 request storm per expansion** (e.g. ~17 for the 16-row Modems page). There is no
  bulk-metadata endpoint (confirmed by probing the device). The device itself is fast
  (~52 ms/req, handles concurrency: 8 serial 0.42 s, 8 parallel 0.26 s), but the c64u
  intermittently chokes on the unbounded burst → severe outliers.
- Key finding: a **persistent, firmware-namespaced enrichment cache** already exists
  (`configEnrichmentCache.ts`, localStorage) and the batched `getConfigItems` path uses it to
  skip per-item fetches — but the per-row `useC64ConfigItem`/`getConfigItem` path **never reads
  it**, so every session re-fetches all (firmware-static) options.

Baseline (cold, before fix):
- Modems 7988 ms (worst), ~0.8 s typical · Printers 821 ms (one run timed out at 20 s / failed
  to render) · User interface 880 ms · warm re-expand (React-Query cache) 492 ms.

Fix (no hack, no benchmark-gaming): make the per-row read **cache-aware** — `ConfigItemRow`
now serves the firmware-static option set synchronously from the existing persistent cache
(`getC64API().getCachedConfigItem`, added) and only falls back to the network fetch on a cache
miss (which repopulates it). The device-fresh value still comes from the category read. This
eliminates the per-item HTTP storm on every session after the options are first cached.

After fix (fresh app launch = empty React-Query cache; options from persistent cache):
- **Modems 223 ms · Printers 277 ms · User interface 348 ms** — all rows + interactive
  controls rendered, 0 loading (impossible without the cache: there is no time for 16 HTTP
  round-trips). ~3–4× faster typical and the multi-second / timeout outliers are gone (no
  per-item burst to overload the device). First-ever expand (cold persistent cache) is
  unchanged (one N+1 pass that populates the cache).

Validation: typecheck ✓; eslint/prettier ✓; `catchGuardrail` ✓ (no silent-catch — used
optional chaining, not try/catch); new deterministic regression test
`ConfigItemRow.cachedOptions.test.tsx` proves a remount serves options from cache with **no
second per-item GET**; full unit suite re-run. Files: `src/lib/c64api.ts`
(`getCachedConfigItem`), `src/components/ConfigItemRow.tsx` (cache short-circuit).

## P9 / P10 — appended as they run

## Pixel 4 CTA continuation — Disks mount/import fixes

Recorded UTC: 2026-06-24T23:09:00Z.

Commands and material actions:

- `git status --short`: worktree dirty with unrelated snapshot/RAM test files preserved.
- `git rev-parse --abbrev-ref HEAD && git rev-parse HEAD`: branch `test/full-cta-coverage`, SHA `1ce6ab76f04d284225fb5fec3ef940c8c3760ccb`.
- `npm run test -- tests/unit/components/disks/HomeDiskManager.dialogs.test.tsx`: passed 10 tests; locks the empty mount-sheet Add disks path, Disks CommoServe picker/import path, and no nested `All disks` view-all control inside the drive-specific mount sheet.
- `npm run scope:check`: passed 55 files / 356 tests.
- `./build --skip-tests --install-apk`: built and installed `android/app/build/outputs/apk/debug/c64commander-0.8.9-1ce6a-debug.apk` on Pixel 4 `9B081FFAZ001WX`.
- `sha256sum android/app/build/outputs/apk/debug/c64commander-0.8.9-1ce6a-debug.apk`: `9d020f42d609614c6ea83cf05d9512987b2d96c5d4b66e1f9806c5597208826f`.
- `adb -s 9B081FFAZ001WX shell dumpsys package uk.gleissner.c64commander`: installed identity `versionName=0.8.9-1ce6a`, `versionCode=2039`, first install `2026-06-24 22:52:18`, last update `2026-06-25 00:07:16`, signature short `d39d81d2`.
- DroidMind targeted Save-and-Connect was used to restore the app-visible connected state after the user reported the app was `Offline`; evidence `screenshots/save-connect-targeted-after.png`, `hierarchies/save-connect-targeted-after.xml`, `logs/commands/droidmind-targeted-save-connect.stdout.log`.
- DroidMind Disks Add items source proof showed `Local`, `C64U`, and `CommoServe`; evidence `screenshots/commoserve-library-source-01-source-picker.png`, `hierarchies/commoserve-library-source-01-source-picker.xml`, `results-disks-commoserve-library-source.json`.
- DroidMind C64U import from broad `/USB2/test-data` stalled at `Scanning... 0 items` for at least 1m52s and was cancelled through the visible Cancel control; evidence `screenshots/disks-import-stuck-scan-before-cancel.png`, `screenshots/disks-import-stuck-scan-after-semantic-cancel.png`, `hierarchies/disks-import-stuck-scan-before-cancel.xml`, `logs/commands/droidmind-disks-import-add-to-library.stdout.log`, `logs/commands/droidmind-disks-import-semantic-cancel-scan.stdout.log`.
- DroidMind C64U import from `/USB2/test-data/d64` succeeded by selecting `interface-harness.d64`, `Frogger.d64`, and `Boulder Dash 2.d64`; evidence `screenshots/disks-import-specific-after-add.png`, `hierarchies/disks-import-specific-after-add.xml`, `logs/commands/droidmind-disks-import-specific-d64.stdout.log`.
- DroidMind mount/eject proof mounted `interface-harness.d64` and then ejected Drive A; evidence `screenshots/mount-proof-drive-a-after-mount.png`, `screenshots/mount-proof-drive-a-after-eject.png`, `hierarchies/mount-proof-drive-a-after-mount.xml`, `hierarchies/mount-proof-drive-a-after-eject.xml`, `logs/commands/droidmind-mount-dialog-populated-mount-eject.stdout.log`.
- DroidMind exact-sheet proof initially exposed a product bug: tapping the semantically identified `Drive A Mount disk` control opened the generic `All disks` sheet instead of `Mount disk to Drive A`; evidence `screenshots/drive-a-mount-sheet-exact-open.png`, `hierarchies/drive-a-mount-sheet-exact-open.xml`, `logs/commands/droidmind-drive-a-mount-sheet-exact.stdout.log`.
- After the drive-sheet fix and reinstall, DroidMind proof passed: `Drive A Mount disk` opened `Mount disk to Drive A`, showed `Available disks`, listed all three C64U D64 fixtures, did not show the empty state, did not show generic `All disks`, and dismissed cleanly with `DroidmindClient.pressKey(Back)`; evidence `screenshots/drive-a-mount-sheet-fixed-open.png`, `hierarchies/drive-a-mount-sheet-fixed-open.xml`, `logs/commands/droidmind-drive-a-mount-sheet-fixed.stdout.log`.

Decisions and evidence:

- The empty Mount disk report was not treated as a hardware absence issue. It was fixed as product UX: an empty mount sheet now offers `Add disks`, and the drive-specific sheet no longer opens a nested generic `All disks` surface when disks exist.
- The Disks Add items source picker now includes CommoServe. Archive disk import is wired through the existing archive client path and stores the downloaded disk as a runtime `File` for the disk library.
- The broad-folder C64U recursive scan stall remains open as a product issue. It does not block mounting because specific D64 selection from `/USB2/test-data/d64` succeeds, but it must be tracked in the Disks deep dive and performance results.
- Cleanup status at this point: Drive A was ejected and the app-visible target is connected to `c64u`; three temporary disk-library entries remain intentionally retained for continuing Disks CTA coverage and must be removed during final cleanup.

Artifact root:

- `c64scope/artifacts/cta-20260624T230900Z-pixel4-c64u-1ce6ab76f04d/` (current-SHA copy with `environment.json`)
- Source evidence was first captured under `c64scope/artifacts/cta-20260624T222959Z-pixel4-c64u-414ec2a965d6/` before the APK was rebuilt as `0.8.9-1ce6a`.

Current-HEAD correction after concurrent branch advance:

- `git rev-parse HEAD`: branch advanced to `10c4b5e98510b3a4cd0afa824ca4ac34dcc71db9` (`Improve RAM snapshot tests`).
- Rebuilt and installed current APK with `./build --skip-tests --install-apk`; APK `android/app/build/outputs/apk/debug/c64commander-0.8.9-10c4b-debug.apk`, SHA-256 `38d17f562159101f340d729f4e93ba5c21e7885dd3ccf40b868c792432e71e6e`.
- Installed package identity after reinstall: versionName `0.8.9-10c4b`, versionCode `2040`, lastUpdateTime `2026-06-25 00:17:22`, package path `/data/app/~~U83Do-y3NWKqtU49tTBMPw==/uk.gleissner.c64commander-xwJ3ACWEBnM_ee8FAXUMiw==/base.apk`.
- Re-ran current-HEAD all-route discovery with absolute artifact path. Results: total `295` discovery rows; Home `109`, Play `24`, Disks `40`, Config `28`, Settings `76`, Docs `18`.
- Active current artifact root is now `c64scope/artifacts/cta-20260624T231700Z-pixel4-c64u-10c4b5e98510/`.

## Pixel 4 exhaustive CTA continuation — current-SHA blocked handover

Recorded UTC: 2026-06-25T01:44:00Z.

Commands and material actions:

- `git status --short`: worktree remains dirty. Certification files touched in this continuation are `PLANS.md`, `WORKLOG.md`, `docs/testing/agentic-tests/full-cta-coverage/runs/progress-ledger.md`, and new defect files. Additional modified/untracked files in `src/lib/c64api.ts`, `src/lib/c64api/hostConfig.ts`, `src/lib/connection/connectionManager.ts`, RAM/snapshot files, docs, and scripts were already present or concurrent and were preserved.
- Read-only source inspection after the S1 device-safety stop:
  - `sed -n '1,260p' src/lib/disks/diskMount.ts`
  - `sed -n '900,1120p' src/lib/c64api.ts`
  - `rg -n "getDrivesPollIntervalMs|drives|pollingPaused|pause|cooldown|invalidateQueries" src/hooks src/lib src/components/disks`
  - `sed -n '300,380p' src/lib/disks/diskMount.ts && sed -n '2100,2235p' src/lib/c64api.ts && sed -n '560,610p' src/hooks/useC64Connection.ts`
- Observed source pattern for the S1 defect: Drive A mount calls `PUT /v1/drives/a:mount?...mode=readwrite`; eject calls `PUT /v1/drives/a:remove`; `HomeDiskManager` invalidates `["c64-drives"]` after mount/eject; `useC64Drives` also polls `GET /v1/drives` while connection/screen are active; device-interaction safety has cooldown support for `/v1/drives`, but no product fix or retest was attempted after the target reset.
- No further `c64u` app, REST, FTP, or Telnet traffic was sent after the S1 stop. The app had already been stopped through `DroidmindClient.stopApp`.
- Created continuation handover: `docs/testing/agentic-tests/full-cta-coverage/handover5.md`.

Current blocker:

- `S1-DISKS-MOUNT-EJECT-RESETS-C64U`: current-SHA repeated Drive A mount/eject loop completed two cycles, then on the third mount the app showed `Connection reset`; authenticated `/v1/info` returned connection reset. The live app hierarchy before stop showed Drive A and Drive B as `No disk mounted`, so disk media cleanup appears likely, but final connected cleanup is not proven.

Decision:

- Do not write `docs/testing/agentic-tests/full-cta-coverage/final-report-3.md`.
- Continue only with local/source analysis or non-C64U UI work that proves no target traffic, until the S1 request pattern is fixed or a deliberate safe test window is available.

## Pixel 4 CTA continuation — Drive A readonly mount mitigation and current-HEAD correction

Recorded UTC: 2026-06-25T07:10:00Z.

Commands and material actions:

- Investigated `S1-DISKS-MOUNT-EJECT-RESETS-C64U` locally in `src/components/disks/HomeDiskManager.tsx`, `src/lib/disks/diskMount.ts`, `src/lib/c64api.ts`, `src/hooks/useC64Connection.ts`, and `src/lib/deviceInteraction/deviceInteractionManager.ts`.
- Implemented a Disks safety mitigation:
  - Drive mount/eject handlers pause drive polling, cancel active `["c64-drives"]` queries, invalidate without immediate refetch, settle, then release polling.
  - Manual Disks mounts now call `mountDiskToDrive(..., { mode: "readonly" })`; default `mountDiskToDrive` behavior remains `readwrite` for playback/autostart callers.
- Added/updated regression coverage:
  - `tests/unit/components/disks/HomeDiskManager.extended.test.tsx`
  - `tests/unit/components/disks/HomeDiskManager.test.tsx`
  - `tests/unit/components/disks/HomeDiskManager.ui.test.tsx`
  - `tests/unit/components/disks/HomeDiskManager.dialogs.test.tsx`
  - `tests/unit/lib/disks/diskMount.test.ts`
- Validation on the first local source state:
  - `npm run test -- tests/unit/lib/disks/diskMount.test.ts tests/unit/diskMount.test.ts tests/unit/components/disks/HomeDiskManager.dialogs.test.tsx tests/unit/components/disks/HomeDiskManager.extended.test.tsx tests/unit/components/disks/HomeDiskManager.ui.test.tsx tests/unit/components/disks/HomeDiskManager.test.tsx`: passed 6 files / 94 tests.
  - `npm run lint`: passed with existing c64scope coverage-helper warnings only.
  - `npm run scope:check`: passed 55 files / 360 tests.
  - `npm run test`: passed 643 files / 7457 tests.
  - `npm run build`: passed.
- Current-HEAD correction:
  - During the continuation, branch HEAD advanced from `515e2818ed1992dd6e3579470e1355488111278f` to `af2d795b2361cc78e52f3013cf3502c0e72c0375`.
  - Rebuilt and installed current APK with `./build --skip-tests --install-apk --device-id 9B081FFAZ001WX`.
  - Current APK: `android/app/build/outputs/apk/debug/c64commander-0.8.9-af2d7-debug.apk`, SHA-256 `e0f00bc9a9d595566df01b2eb1cfe63992dfc1611d4acce0fe4a21fa56af7891`.
  - Installed identity: versionName `0.8.9-af2d7`, versionCode `2042`, lastUpdateTime `2026-06-25 07:52:21`, signature short `d39d81d2`.
  - Re-ran `npm run scope:check`: passed 55 files / 360 tests.
  - Re-ran focused Disks tests on `af2d7`: passed 6 files / 94 tests.
  - Re-ran `npm run lint`: passed with existing c64scope coverage-helper warnings only.
- Target restoration and cleanup actions:
  - App-visible target had drifted to `u64`; used `DroidmindClient.pressKey(KEYCODE_POUND)` to open Switch Device, selected `c64u`, and captured `manual-restore-c64u/home-after-c64u-switch-back.png`.
  - A residual Drive A `Boulder Dash 2.d64` mount from a failed replay was ejected through the semantically identified Drive A eject control; evidence `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361/cleanup-drive-a-residual/result.json`, screenshots `before-coordinate-eject.png` and `after-coordinate-eject.png`.
  - Final app-visible target restored again after repetition harness drifted target to `u64`; evidence `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361/restore-c64u-final-state/home-after-c64u-final.png`.
- Current-build Disks evidence:
  - Single clean readonly Drive A mount/eject pass from no-disk state: `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361/clean-readonly-mount-eject-2/result.json`.
  - Result: `PROVEN`; after mount `bad=[]`, Eject visible, mounted text `/USB2/test-data/.../Boulder Dash 2.d64`; after eject `bad=[]`, `No disk mounted`, target `Connected to c64u, system healthy`.
  - Supporting direct unauthenticated `c64u` probes returned expected `403` in ~8 ms before and after the clean pass.
  - Repetition runner attempt under `readonly-mount-eject-repetitions/` is `FAILED` as automation evidence only: stale coordinate fallback did not exercise the intended mount/eject path and left the mount sheet open. Do not count it as product reliability failure; replay with corrected semantic targeting.

Decisions and evidence:

- The original readwrite repeated mount/eject S1 remains open until a corrected five-cycle current-build reliability run passes.
- The current code mitigation has one valid Pixel 4 proof and did not reproduce target reset during the guarded clean pass.
- The app was stopped after final target restoration; final visible target screenshot shows `C64U`, device `c64u`, firmware `1.1.0`, app `0.8.9-af2d7`.
- Do not write `final-report-3.md`; exhaustive CTA execution and cleanup remain incomplete.
