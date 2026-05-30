# prod-hardening-5 Worklog

## Baseline

- Task started on branch `fix/prod-hardening`.
- Initial worktree state:
  - `package-lock.json` modified before this task.
  - `docs/research/stabilization/prod-hardening-5/evidence/`, `s33-resume-sm.png`, and `s34-sm.png` untracked before this task.
- Change classification: `DOC_PLUS_CODE` and `UI_CHANGE`.
- Live HIL target: `c64u` only. `u64` must not be probed or used.

## Commands Run

- `git status --short --branch`
- `sed -n '1,220p' README.md`
- `sed -n '1,260p' .github/copilot-instructions.md`
- `sed -n '261,520p' .github/copilot-instructions.md`
- `sed -n '1,260p' docs/ux-guidelines.md`
- `rg --files -g '*test*' -g '*.test.*' -g '*.spec.*' src test playwright agents android | sed -n '1,240p'`
- `rg -n "Diagnostics|MachineControls|parseResponseJson|AbortError|BackButton|backButton|App.addListener|power off|reboot|reset|screenshot|uiautomator|adb" src test playwright docs scripts agents .maestro package.json`
- `rg -n "parseResponseJson|createAbortError|AbortError|invalid-json|Malformed JSON|selected|generation|supersed|Diagnostics|record.*problem|problem" src/lib src/hooks src/components src/pages | head -n 260`
- `sed -n '1,320p' src/lib/c64api.ts`
- `sed -n '320,760p' src/lib/c64api.ts`
- `sed -n '760,1320p' src/lib/c64api.ts`
- `sed -n '1320,1880p' src/lib/c64api.ts`
- `sed -n '1,260p' src/lib/c64api/requestRuntime.ts`
- `sed -n '1,260p' src/lib/logging.ts`
- `sed -n '1,340p' src/hooks/useSavedDeviceSwitching.ts`
- `sed -n '1,320p' src/lib/deviceInteraction/deviceInteractionManager.ts`
- `sed -n '1,260p' src/lib/tracing/failureTaxonomy.ts`
- `find . -path './node_modules' -prune -o -path './.git' -prune -o \\( -name '*.test.ts' -o -name '*.test.tsx' -o -name '*.spec.ts' -o -name '*.spec.tsx' \\) -print | sed -n '1,320p'`
- `sed -n '1,280p' src/components/ui/interstitial-state.tsx`
- `sed -n '1,220p' src/components/SwipeNavigationLayer.tsx`
- `sed -n '1,300p' src/pages/home/components/MachineControls.tsx`
- `sed -n '1,260p' tests/unit/pages/home/components/MachineControls.test.tsx`
- `cat package.json`
- `npx vitest run tests/unit/c64api.ext2.test.ts`
- `npx vitest run tests/unit/components/ui/interstitial-state.test.tsx`
- `npx vitest run tests/unit/pages/home/components/MachineControls.test.tsx`
- `npx vitest run tests/unit/scripts/hilScreenshotEvidence.test.ts`
- `npx vitest run tests/unit/components/diagnostics/GlobalDiagnosticsOverlay.test.tsx`
- `npx vitest run tests/unit/pages/HomePage.ramActions.test.tsx`
- `npx prettier --write src/lib/c64api.ts src/lib/c64api/requestRuntime.ts src/components/ui/interstitial-state.tsx src/pages/home/components/MachineControls.tsx src/pages/home/dialogs/MachineActionConfirmationDialog.tsx tests/unit/c64api.ext2.test.ts tests/unit/components/ui/interstitial-state.test.tsx tests/unit/components/diagnostics/GlobalDiagnosticsOverlay.test.tsx tests/unit/pages/home/components/MachineControls.test.tsx tests/unit/pages/HomePage.ramActions.test.tsx scripts/hil-screenshot-evidence.mjs tests/unit/scripts/hilScreenshotEvidence.test.ts playwright/homeInteractivity.spec.ts docs/research/stabilization/prod-hardening-5/hil-evidence.md PLANS.md WORKLOG.md`
- `npx vitest run tests/unit/c64api.ext2.test.ts tests/unit/components/ui/interstitial-state.test.tsx tests/unit/components/diagnostics/GlobalDiagnosticsOverlay.test.tsx`
- `npx vitest run tests/unit/pages/home/components/MachineControls.test.tsx tests/unit/pages/HomePage.ramActions.test.tsx tests/unit/scripts/hilScreenshotEvidence.test.ts`
- `npx vitest run tests/unit/c64api.branches.test.ts`
- `npx playwright test playwright/homeInteractivity.spec.ts`
- `npm run lint` (first run found pre-existing Prettier drift in `src/lib/diagnostics/healthCheckEngine.ts`)
- `npx prettier --write tests/unit/c64api.branches.test.ts src/lib/diagnostics/healthCheckEngine.ts PLANS.md WORKLOG.md`
- `npm run lint`
- `npm run test` (first full run found `HomePage.test.tsx` still expected immediate Reset execution)
- `npx prettier --write tests/unit/pages/HomePage.test.tsx`
- `npx vitest run tests/unit/pages/HomePage.test.tsx`
- `npm run test`
- `npm run test:coverage`
- Local changed-line statement coverage check against `.cov-unit/merged/coverage-final.json`
- `npx vitest run tests/unit/components/ui/interstitial-state.test.tsx tests/unit/lib/c64api/requestRuntime.test.ts tests/unit/c64api.ext2.test.ts`
- `npm run test:coverage`
- Local changed-line statement coverage re-check against `.cov-unit/merged/coverage-final.json`
- `npm run lint`
- `npm run cap:build`
- `npm run android:apk`
- `adb devices -l`
- `curl -sS --max-time 4 http://c64u/v1/info`
- `curl -v --http1.1 --max-time 4 http://c64u/v1/info`
- `curl -v --max-time 4 http://192.168.1.167/v1/info`
- `ping -c 2 -W 1 c64u`
- `adb -s 9B081FFAZ001WX install -r android/app/build/outputs/apk/debug/c64commander-0.7.9-rc1-debug.apk`
- `adb -s 9B081FFAZ001WX shell am force-stop uk.gleissner.c64commander && adb -s 9B081FFAZ001WX shell logcat -c && adb -s 9B081FFAZ001WX shell monkey -p uk.gleissner.c64commander -c android.intent.category.LAUNCHER 1`
- `adb -s 9B081FFAZ001WX shell dumpsys package uk.gleissner.c64commander | rg -n "versionName|versionCode|firstInstall|lastUpdate"`
- `node scripts/hil-screenshot-evidence.mjs --serial 9B081FFAZ001WX --name prod-hardening-5-launch --out-dir docs/research/stabilization/prod-hardening-5/evidence --ui-dump`
- `adb -s 9B081FFAZ001WX shell cat /proc/net/unix | rg webview_devtools || true`
- `adb -s 9B081FFAZ001WX forward tcp:9222 localabstract:webview_devtools_remote_6586 && curl -sS http://127.0.0.1:9222/json`
- CDP/Playwright DOM probes against `http://127.0.0.1:9222` for launch state, Diagnostics Back behavior, and destructive control disabled state.
- `node scripts/hil-screenshot-evidence.mjs --serial 9B081FFAZ001WX --name prod-hardening-5-post-back --out-dir docs/research/stabilization/prod-hardening-5/evidence --ui-dump`
- `adb -s 9B081FFAZ001WX shell logcat -d -t 500 | rg -i "console|chromium|c64|error|exception|fatal|reset|reboot|power" || true`
- After `c64u` reboot by the user:
  - `adb devices -l`
  - `curl -sS --max-time 4 http://c64u/v1/info`
  - `adb -s 9B081FFAZ001WX shell am force-stop uk.gleissner.c64commander && adb -s 9B081FFAZ001WX shell logcat -c && adb -s 9B081FFAZ001WX shell monkey -p uk.gleissner.c64commander -c android.intent.category.LAUNCHER 1`
  - `adb -s 9B081FFAZ001WX shell cat /proc/net/unix | sed -n 's/.*@\\(webview_devtools_remote_[0-9]*\\)$/\\1/p' | tail -1`
  - `adb -s 9B081FFAZ001WX forward tcp:9222 localabstract:webview_devtools_remote_6832 && curl -sS http://127.0.0.1:9222/json`
  - CDP/Playwright DOM validation for selected c64u healthy state, Diagnostics Back, Reset/Reboot Cancel, Reset Back, and machine request monitoring.
  - `node scripts/hil-screenshot-evidence.mjs --serial 9B081FFAZ001WX --name prod-hardening-5-final-healthy --out-dir docs/research/stabilization/prod-hardening-5/evidence --ui-dump`
  - `curl -sS --max-time 4 http://c64u/v1/info`
  - `adb -s 9B081FFAZ001WX shell logcat -d -t 700 | rg -i "console|chromium|c64|error|exception|fatal|reset|reboot|power" || true`

## Observations

- Initial `rg` commands reported `test: No such file or directory` because this repository does not have a top-level `test/` directory.
- Existing Playwright suites include diagnostics, navigation, modal consistency, home interactivity, and playback coverage.
- Existing scripts include screenshot/evidence helpers in `playwright/testArtifacts.ts`, `scripts/build-maestro-evidence.mjs`, and Android/iOS evidence validation helpers.
- Pixel 4 was attached as `9B081FFAZ001WX`.
- `c64u` resolved to `192.168.1.167` and responded to ping, but REST port 80 reset `/v1/info` connections.
- The installed app selected saved device `debug-c64u` / `192.168.1.167`; seeded `debug-u64` data existed in app storage but was not selected or probed.
- After the user rebooted `c64u`, REST `/v1/info` returned `product: C64 Ultimate`, `firmware_version: 1.1.0`, `hostname: c64u`, `unique_id: 5D4E12`, and empty `errors`.

## Failures And Fixes

- Fixed API response-body abort classification by rethrowing abort-like body read failures before malformed JSON handling.
- Added request-generation supersede detection to downgrade stale selected-device failures after routing changes.
- Added shared interstitial Android Back listener that dispatches Escape while a modal/sheet/progress overlay is active.
- Added confirmation dialog for destructive Home machine actions except Power Off, which already delegates to its protected flow.
- Added screenshot evidence helper that creates raw and review-safe downscaled PNGs, plus optional UI dumps.
- Initial targeted tests found three issues:
  - body-read aborts still normalized to `Host unreachable` at the final throw;
  - confirm guard closure could use stale props after rerender;
  - screenshot test created a raw file before its directory.
- Fixed all three and reran targeted tests successfully.
- Full unit run found one stale HomePage expectation for immediate Reset execution; fixed the test to confirm Reset before expecting the mutation/toast.
- Local changed-line coverage initially found uncovered new cancellation branches; added focused tests for Android Back listener registration failures, abort-like response body inspection failures, and response-inspection supersede logging.

## Tests Run

- PASS: `npx vitest run tests/unit/c64api.ext2.test.ts tests/unit/components/ui/interstitial-state.test.tsx tests/unit/components/diagnostics/GlobalDiagnosticsOverlay.test.tsx`
- PASS: `npx vitest run tests/unit/pages/home/components/MachineControls.test.tsx tests/unit/pages/HomePage.ramActions.test.tsx tests/unit/scripts/hilScreenshotEvidence.test.ts`
- PASS: `npx vitest run tests/unit/c64api.branches.test.ts`
- PASS: `npx playwright test playwright/homeInteractivity.spec.ts` (15 passed)
- PASS: `npx vitest run tests/unit/pages/HomePage.test.tsx` (37 passed)
- PASS: `npm run test` (580 files, 6704 tests)
- PASS: `npx vitest run tests/unit/components/ui/interstitial-state.test.tsx tests/unit/lib/c64api/requestRuntime.test.ts tests/unit/c64api.ext2.test.ts` (46 passed)
- PASS: `npm run test:coverage` with final summary: statements 94.63%, branches 91.70%, functions 91.05%, lines 94.63%.
- PASS: local changed `src/**` executable statement coverage: 357/357 (100.00%).
- PASS: `npm run lint`; ESLint reported only existing generated coverage warnings in `.worktrees/stop-ui-validation/coverage/lcov-report/*` and `c64scope/coverage/*`.
- PASS: `npm run cap:build`; Vite emitted existing chunking warnings, and iOS sync skipped local CocoaPods/xcodebuild on Linux.
- PASS: `npm run android:apk`; built `android/app/build/outputs/apk/debug/c64commander-0.7.9-rc1-debug.apk`.

## HIL Observations

- Pixel 4 attached: `9B081FFAZ001WX`.
- Initial `c64u` probe status before the user reboot:
  - `curl -sS --max-time 4 http://c64u/v1/info`: failed with `Recv failure: Connection reset by peer`.
  - `curl -v --http1.1 --max-time 4 http://c64u/v1/info`: resolved `c64u` to `192.168.1.167`, connected to port 80, then reset.
  - `curl -v --max-time 4 http://192.168.1.167/v1/info`: same reset.
  - `ping -c 2 -W 1 c64u`: passed with 0% packet loss.
- Installed latest debug APK successfully on Pixel 4.
- Launched app; app showed selected c64u saved device context but offline because REST reset.
- Captured evidence with helper:
  - raw `docs/research/stabilization/prod-hardening-5/evidence/raw/prod-hardening-5-launch.png` and review `docs/research/stabilization/prod-hardening-5/evidence/review/prod-hardening-5-launch-review.png` (480x1013).
  - raw `docs/research/stabilization/prod-hardening-5/evidence/raw/prod-hardening-5-post-back.png` and review `docs/research/stabilization/prod-hardening-5/evidence/review/prod-hardening-5-post-back-review.png` (480x1013).
  - UI dumps under `docs/research/stabilization/prod-hardening-5/evidence/ui/`.
- CDP validation:
  - Diagnostics opened from `[data-testid="unified-health-badge"]`.
  - Android Back via `adb shell input keyevent KEYCODE_BACK` closed the Diagnostics dialog.
  - Route stayed `/` before and after Back.
- After `c64u` reboot, app CDP validation showed:
  - selected device `debug-c64u`, host `192.168.1.167`, name `c64u`;
  - app body contained `HEALTHY`, `Device c64u`, and `Firmware 1.1.0`;
  - Diagnostics opened from the health badge and Android Back closed it with route unchanged at `/`;
  - Reset confirmation text: `Reset?` and `This resets the running C64 session.`;
  - Reboot confirmation text: `Reboot?` and `This reboots the C64 Ultimate and interrupts the current session.`;
  - Cancel closed both Reset and Reboot confirmations;
  - Android Back closed a Reset confirmation with route unchanged at `/`;
  - monitored machine requests matching reset/reboot/power endpoints: none.
- Android logcat after validation showed `Capacitor: Connection reset`; no reset/reboot/power command log entries were observed in the filtered log output.
- Android logcat after the successful rerun showed no app reset/reboot/power command entries in the filtered output; non-app/system power/perf messages were present.
- Final `curl -sS --max-time 4 http://c64u/v1/info` succeeded.
- No live `u64` probes were run.

## Final Verification Evidence

- Unit/component/Playwright coverage verifies abort classification, stale supersede downgrade, Diagnostics Android Back interception, destructive confirmations, confirmation Back/Cancel behavior, and evidence downscaling.
- Android APK deployment succeeded on Pixel 4 with versionCode `1985`, versionName `0.7.9-rc1`.
- On-device Diagnostics Back behavior was validated via CDP and ADB.
- On-device destructive confirmation Cancel and Back behavior was validated against selected healthy `c64u` without sending destructive machine commands.
- Final c64u health probe succeeded.

## Intentionally Skipped Destructive HIL Confirmations

- Reset and Reboot live HIL open/cancel checks were performed after `c64u` reboot; no destructive command was sent.
- Power Cycle was not visible in the default connected Home quick actions during HIL.
- Destructive actions were not confirmed on the real `c64u`.
