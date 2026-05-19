# Iteration 2 Worklog

Append-only chronological log. One entry per meaningful event: spec change, scenario draft, agent run, triage note, fix landed, re-run, sign-off.

Conventions:

- Entries are date-prefixed (`YYYY-MM-DD HH:MM UTC`).
- Each soak run produces exactly one closing entry with the run's verdict and a link to `runs/<runId>/summary.json`.
- Specs are inputs; if a spec must change, log the change here and amend the spec in the same commit.

## 2026-05-19

- Iteration plan drafted under `docs/plans/performance/iteration2/`.
  - `plan.md` defines phases A-E and gates.
  - `auto-safety-mode-spec.md` defines the new `AUTO` device-safety mode.
  - `cta-inventory.md` enumerates 56 distinct interaction shapes mapped to soak scenarios.
  - `soak-scenarios.md` defines 22 scenarios across Navigation, Home, Play, Disks, Config, Settings, Docs.
  - `agent-prompt.md` is the verbatim handoff for an autonomous soak agent.
  - `parallelization.md` defines Pattern 1 (lock-and-line) as the default; auxiliary agents are read-only.
  - `proof-of-work.md` defines the artifact schema and acceptance gates.
- Implementation has not started. The next agent's job is to land Phase A (Auto safety mode) and then re-read `plan.md` Gate A before moving on.

## 2026-05-19 10:20 UTC

- Phase A landed: AUTO device safety mode is now the default for fresh installs, resolves at read time from the selected saved device, and refreshes when saved-device selection/verification changes.
  - Files touched: `src/lib/config/deviceSafetySettings.ts`, `src/lib/savedDevices/store.ts`, `src/lib/deviceInteraction/deviceInteractionManager.ts`, `src/pages/SettingsPage.tsx`, `src/lib/config/settingsTransfer.ts`, `src/components/diagnostics/DiagnosticsDialog.tsx`, `src/components/diagnostics/GlobalDiagnosticsOverlay.tsx`, and focused regression tests under `tests/unit/config/`, `tests/unit/pages/`, `tests/unit/components/diagnostics/`, `tests/unit/lib/deviceInteraction/`, plus `tests/unit/components/UnifiedHealthBadge.test.tsx`.
  - Regression coverage: acceptance tests 1-7 are locked in, including migration safety for existing installs and AUTO import/export round-trip coverage.
  - Validation: focused diagnostics suites passed (`ActionExpandedContent`: 5 tests, `DiagnosticsDialog`: 33 tests); Gate A validation passed earlier with `npm run test:coverage` at 91.63% branch coverage, `npm run lint`, `npm run build`, and `npm run cap:build`.
  - Pixel 4 (`9B081FFAZ001WX`) verification succeeded against both devices: Settings shows `Auto (Conservative for C64U, Balanced for others) - recommended`, and the on-device Diagnostics safety line resolves to `Balanced` for `u64` / `U64E` and `Conservative` for `c64u` / `C64U`.

## 2026-05-19 10:24 UTC

- Phase B inventory audit complete.
  - Re-read `docs/plans/performance/iteration2/cta-inventory.md`; no rows were `TBD`, no concrete examples or scenario IDs had drifted, and no inventory edits were required.
  - Logged as a docs-only follow-up after the Phase A commit so the inventory status remains green before the soak handoff.

## 2026-05-19 11:30 UTC

- Diagnostics REST rendering follow-up closed out.
  - `src/components/diagnostics/ActionExpandedContent.tsx` now renders the full REST request URL, adds a one-line `User activity:` summary ahead of REST details, and suppresses hex/ascii payload previews whenever a decoded request/response body is available.
  - `tests/unit/components/diagnostics/ActionExpandedContent.test.tsx` locks the renderer against regressions for full-URL display, the activity prefix, decoded payload rendering, and preview fallback when no decoded body exists.
  - Validation: fresh `npm run test:coverage` passed at 91.62% branch coverage; live Pixel 4 (`9B081FFAZ001WX`) verification against `u64` confirmed the expanded Diagnostics row shows the full request URL, the user-activity prefix, pretty response JSON, and preview suppression for decoded payloads.

<!-- Template for future entries:

## YYYY-MM-DD HH:MM UTC

- Event title.
  - Detail, links, runId references.
  - Verdict if this entry closes a soak run.
-->

## 2026-05-19 11:59 UTC

- Pre-soak hardening fix landed after live-device spot checks exposed two diagnostics/navigation regressions.
  - `SwipeNavigationLayer` now synthesizes transition completion immediately after the configured animation duration instead of waiting 3 seconds for a fallback timeout, eliminating repeated real-device `transition-end-fallback` warnings during fast nav.
  - `GlobalDiagnosticsOverlay` now records diagnostics-open completion and first-visible info logs through `withDiagnosticsTraceOverride`, so opening Diagnostics no longer leaves a stale `diagnostics.open` action stuck `in_progress` while the overlay is visible.
  - Regression coverage: `tests/unit/components/SwipeNavigationLayer.test.tsx` and `tests/unit/components/diagnostics/GlobalDiagnosticsOverlay.routeClose.test.tsx`.
  - Validation: targeted Vitest regressions passed; `npm run test:coverage` passed at 91.62% branch coverage; `npm run build`, `npm run cap:build`, and `./build --skip-tests --install-apk` succeeded; deployed and relaunched on Pixel 4 (`9B081FFAZ001WX`).

## 2026-05-19 12:35 UTC

- Saved-device switch affordance now keeps the tapped target highlighted while verification is still in flight.
  - `src/components/UnifiedHealthBadge.tsx` now treats `pendingSwitch.toDeviceId` as the selected picker row, so the quick-switch sheet no longer keeps the previous device visually selected during a real-device switch.
  - Regression coverage: `tests/unit/components/UnifiedHealthBadge.test.tsx` locks the pending-target highlight behavior.
  - Validation: targeted `npx vitest run tests/unit/components/UnifiedHealthBadge.test.tsx --reporter=dot`, targeted Prettier/ESLint on the changed files, `npm run test:coverage` (91.60% branch coverage), `npm run build`, `npm run cap:build`, and `./build --skip-tests --install-apk`; relaunched on Pixel 4 (`9B081FFAZ001WX`).

## 2026-05-19 12:52 UTC

- Run `1f355b53-7cca-49e2-8542-15dc2052d01c` closed `inconclusive`; summary: `docs/plans/performance/iteration2/runs/1f355b53-7cca-49e2-8542-15dc2052d01c/summary.json`.
  - Preflight passed on both hardware targets, and switching via Settings did correctly move selection from `u64` to the verified `c64u-2` / `C64U` saved-device entry.
  - Immediately after that switch, the app and host both observed the `c64u` REST endpoint reset the TCP connection for `/v1/info`; the active badge fell to `OFFLINE`, `c64u-2` stayed selected, and host curl reproducibly failed with `Recv failure: Connection reset by peer` while `u64` remained healthy.
  - Evidence: `oracles/screenshots/settings-c64u2-offline.png`, `oracles/network/c64u-v1-info.curl.log`, `oracles/network/reachability-blocker.json`, and `screen.mp4` under the run directory.

## 2026-05-19 12:57 UTC

- Settings / HVSC / Open Source Licenses follow-up closed out.
  - `src/pages/SettingsPage.tsx` keeps a dedicated HVSC panel above Online Archive, exposes the HVSC base URL override to normal users, and adds a persisted automatic HVSC update-check cadence with a minimum 6-hour interval.
  - `src/lib/hvsc/hvscReleaseService.ts` now persists the cadence and last-check timestamp, and `src/pages/playFiles/hooks/useHvscLibrary.ts` performs real automatic HVSC update checks when the installed library is ready instead of leaving the new setting decorative.
  - `src/pages/OpenSourceLicensesPage.tsx` now uses a `100dvh` native scroll container with overflow containment and aggressive long-token wrapping so the overlay fits and scrolls on small screens.
  - Regression coverage: `tests/unit/hvsc/hvscReleaseService.test.ts`, `tests/unit/pages/SettingsPage.test.tsx`, and the `useHvscLibrary*` focused suites now lock the new HVSC settings/cadence behavior; `tests/unit/pages/OpenSourceLicensesPage.test.tsx` locks the mobile-safe overlay layout.
  - Validation: `npm run lint`, `npm run test:coverage` (91.60% branch coverage), `npm run build`, `npm run cap:build`, `cd android && ./gradlew assembleDebug`, and Pixel 4 (`9B081FFAZ001WX`) deployment/install all succeeded. Live Pixel WebView checks confirmed `/settings` renders the HVSC panel with both inputs present and `/settings/open-source-licenses` renders with `overflow-y:auto`, a viewport-height shell, scrollable content (`scrollTop` advanced from 0 to 400), and wrapped inline code. Device screenshots were captured to `tmp/settings-hvsc-verification.png` and `tmp/licenses-page-verification.png`.
  - Blocker recheck after deployment: `u64` remained healthy (`/v1/info` HTTP 200), but `c64u` still reproducibly reset `/v1/info` from the host, so the Iteration 2 end-to-end soak remains externally blocked until `c64u` recovers.

## 2026-05-19 14:24 UTC

- Diagnostics abort-noise hardening is in progress after a real Pixel replay surfaced expected probe cancellations as visible errors.
  - Reproduced on-device on Pixel 4 (`9B081FFAZ001WX`) by quick-switching `u64 -> c64u -> u64` and opening Diagnostics: the dialog showed a leaked action row `GET 192.168.1.13 /v1/info · REST 1 · ERR 1 · signal is aborted without reason`.
  - Root cause split across both traced request paths: `src/lib/c64api.ts` and `src/lib/tracing/fetchTrace.ts` were both recording expected caller-driven aborts as trace errors and action-summary errors.
  - The fix now marks true caller aborts as `expectedFailure`, suppresses `recordTraceError(...)` for those aborts, and strips `error` from expected-failure REST effects in `src/lib/diagnostics/actionSummaries.ts`; `DiagnosticsDialog` also defensively hides any `expectedFailure` trace rows.
  - Regression coverage added/updated in `tests/unit/c64api.branches.test.ts`, `tests/unit/tracing/fetchTrace.test.ts`, `tests/unit/lib/diagnostics/actionSummaries.test.ts`, and `tests/unit/components/diagnostics/DiagnosticsDialog.test.tsx`. Targeted `c64api`, `fetchTrace`, action-summary, and diagnostics-dialog suites pass; `npm run lint`, `npm run build`, and `npm run cap:build` also pass.
  - Fresh live `u64` verification now opens Diagnostics without the old `signal is aborted without reason` action row; screenshot evidence saved to `docs/plans/performance/iteration2/runs/b20f8ead-ac6d-4ef2-81d5-082e8289af38/oracles/screenshots/abort-fix-diagnostics-no-abort-row.png`.
  - New blocker at the same time: host-side `curl http://c64u/v1/info` repeatedly fails with `Recv failure: Connection reset by peer`, and the live switcher shows `c64u` / `c64u-2` offline while `u64` stays healthy. Final `c64u` replay legs remain blocked until that endpoint recovers.

## 2026-05-19 15:03 UTC

- Diagnostics header cleanup and diagnostics-open trace-noise cleanup are now closed out on the live Pixel 4 (`9B081FFAZ001WX`).
  - Fresh on-device replay started from Home on `u64`, cleared the trace buffer, long-pressed the health badge to switch `u64 -> c64u`, then switched back `c64u -> u64`, and reopened Diagnostics on the rebuilt debug APK.
  - Live replay results: Diagnostics activity stayed empty (`0 of 0`), the diagnostics header no longer renders the removed `Effective preset` line, and the trace snapshot returned `clickConnectedStarts: []`, `orphanSuccessEndOnly: []`, `abortNoise: 0`, and `failedFetchInfoResponses: []`.
  - Screenshot evidence for the clean diagnostics state is saved to `docs/plans/performance/iteration2/runs/b20f8ead-ac6d-4ef2-81d5-082e8289af38/oracles/screenshots/diagnostics-empty-after-switch-replay.png`.
  - `c64u` was healthy enough for this replay leg, so the app-level quick-switch path is unblocked again and the remaining work is now the full artifact-backed Iteration 2 soak.

## 2026-05-19 15:22 UTC

- Fresh soak run `6741550e-a2f4-49ce-bcbf-2dde0af717c9` exposed a new product bug during the first navigation/disks pass and then verified the fix on-device.
  - Preflight for `6741550e-a2f4-49ce-bcbf-2dde0af717c9` succeeded on Pixel 4 (`9B081FFAZ001WX`): `u64` `/v1/info` answered in 237 ms, `c64u` `/v1/info` answered in 100 ms, the installed app version was `0.7.9-rc1`, both devices were present with verified products, and stored safety mode remained `AUTO`.
  - Failure found: after opening Disks, Diagnostics showed fresh App problem rows `{"message":"Directory does not exist"}` at `16:12:11` on `u64`; matching native evidence in `runs/6741550e-a2f4-49ce-bcbf-2dde0af717c9/logcat.txt` showed two `Capacitor Filesystem.readdir` failures, and screenshot evidence was captured to `runs/6741550e-a2f4-49ce-bcbf-2dde0af717c9/oracles/screenshots/disks-directory-error-live.png`.
  - Root cause: HVSC songlength cold-start bootstrap was probing `Directory.Data/hvsc/...` even when HVSC had never been installed (`c64u_hvsc_state:v1` absent / `installedVersion = 0`), so missing-directory probes leaked native Filesystem errors into Diagnostics.
  - Fix: `src/lib/hvsc/hvscSongLengthService.ts` now short-circuits `discoverSonglengthFiles()` when persisted HVSC state indicates nothing is installed; regression coverage in `tests/unit/hvsc/hvscSongLengthService.test.ts` locks that we skip all Filesystem probing in that state.
  - Post-fix verification: rebuilt (`npm run build`, `npm run cap:build`, `cd android && ./gradlew assembleDebug`), redeployed to the Pixel, cleared Diagnostics history to `0 of 0`, reopened Disks, and confirmed (a) Diagnostics still showed zero problem rows and (b) a freshly cleared `adb logcat` window produced no new `Directory does not exist` / `Filesystem.readdir` failures. Screenshot evidence for the clean Disks screen after the fix is saved to `runs/6741550e-a2f4-49ce-bcbf-2dde0af717c9/oracles/screenshots/disks-post-fix-no-error.png`.
