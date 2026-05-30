# prod-hardening-5 Fix Summary

## Summary

Implemented the actionable prod-hardening-5 fixes for API cancellation classification, modal Android Back handling, destructive Home action confirmation, and review-safe HIL evidence capture.

## Issues fixed

- Abort-like response body read failures are now classified as cancellation before malformed JSON handling.
- Genuine malformed JSON responses still report malformed JSON.
- Requests superseded by selected-device/routing changes are downgraded to expected cancellation and do not create selected-device ERROR faults.
- Diagnostics and other top-level interstitials now consume Android Back before router navigation.
- Home Reset, Reboot, Reboot (Clr Mem), and Power Cycle require confirmation. Confirm re-checks connection/busy guards before sending the command.
- Cancel, close, and Android Back from confirmations do not execute destructive commands.
- HIL screenshot evidence now keeps raw PNGs and writes downscaled review PNGs with dimensions below 2000 px; default review width is 480 px.

## Files changed

- `src/lib/c64api.ts`
- `src/lib/c64api/requestRuntime.ts`
- `src/components/ui/interstitial-state.tsx`
- `src/pages/home/components/MachineControls.tsx`
- `src/pages/home/dialogs/MachineActionConfirmationDialog.tsx`
- `scripts/hil-screenshot-evidence.mjs`
- Tests under `tests/unit/**`
- `playwright/homeInteractivity.spec.ts`
- `docs/research/stabilization/prod-hardening-5/hil-evidence.md`
- `PLANS.md`
- `WORKLOG.md`

`src/lib/diagnostics/healthCheckEngine.ts` was formatted to satisfy the existing Prettier lint gate; no behavior change was intended there.

## Tests added or updated

- API tests for valid JSON, malformed JSON, body-read abort classification, superseded stale-device failures, and selected-device transport failures.
- Request runtime tests for abort-like JSON/text/binary response body inspection failures.
- Diagnostics/interstitial tests for Android Back closing the topmost modal without route changes.
- MachineControls/Home tests for Reset, Reboot, Reboot (Clr Mem), Power Cycle, Power Off, Cancel, Confirm, Back, guard re-checking, and non-destructive actions.
- Evidence helper test for raw and downscaled screenshot outputs.
- Playwright Home interactivity coverage updated for destructive confirmation flow.

## HIL validation

- Pixel 4 attached: `9B081FFAZ001WX`.
- Installed APK: `android/app/build/outputs/apk/debug/c64commander-0.7.9-rc1-debug.apk`.
- App package version after install: versionCode `1985`, versionName `0.7.9-rc1`.
- Initial implementation HIL used `c64u` only for live target checks.
- After the user rebooted `c64u`, app HIL showed selected device `debug-c64u` at `192.168.1.167`, `HEALTHY`, device `c64u`, firmware `1.1.0`.
- Diagnostics opened from the health badge on Pixel 4.
- Android Back via ADB closed Diagnostics and the route stayed `/`.
- Reset confirmation opened, Cancel closed it, and no reset/reboot/power machine request was observed.
- Reboot confirmation opened, Cancel closed it, and no reset/reboot/power machine request was observed.
- Android Back closed a Reset confirmation and the route stayed `/`.
- Final `c64u` `/v1/info` succeeded with hostname `c64u`, unique id `5D4E12`, and empty `errors`.
- Evidence captured as locally generated artifacts. The `docs/research/**/evidence/` tree and research PNGs are intentionally gitignored, so these paths document the local HIL evidence locations rather than committed repository files:
  - `docs/research/stabilization/prod-hardening-5/evidence/raw/prod-hardening-5-launch.png`
  - `docs/research/stabilization/prod-hardening-5/evidence/review/prod-hardening-5-launch-review.png`
  - `docs/research/stabilization/prod-hardening-5/evidence/raw/prod-hardening-5-post-back.png`
  - `docs/research/stabilization/prod-hardening-5/evidence/review/prod-hardening-5-post-back-review.png`
  - `docs/research/stabilization/prod-hardening-5/evidence/raw/prod-hardening-5-final-healthy.png`
  - `docs/research/stabilization/prod-hardening-5/evidence/review/prod-hardening-5-final-healthy-review.png`
  - UI dumps under `docs/research/stabilization/prod-hardening-5/evidence/ui/`

Initial HIL limitation: before the user rebooted `c64u`, REST `/v1/info` reset connections from both hostname and IP probes. After reboot, the required live checks and final health probe succeeded.

## Device-safety notes

- No Reset, Reboot, Power Cycle, or Power Off command was confirmed on the real `c64u`.
- Reset and Reboot confirmations were opened and cancelled only.
- Power Cycle was not visible in the default connected Home quick actions during HIL.
- Stale-device supersede behavior was validated with mocks/test doubles, not by switching to or probing the real `u64`.

## PR convergence deploy validation

- Pixel 4 `9B081FFAZ001WX` installed `android/app/build/outputs/apk/debug/c64commander-0.7.9-rc1-debug.apk`.
- App package version after install: versionCode `1986`, versionName `0.7.9-rc1`.
- Current hardware probe followed repository preference order:
  - `u64` reachable: product `Ultimate 64 Elite`, firmware `3.14e`, hostname `u64`, unique id `38C1BA`, empty `errors`.
  - `c64u` REST `/v1/info` reset the connection.
- On-device validation used selected device `debug-u64` / host `u64`.
- App showed `HEALTHY`, device `u64`, firmware `3.14e`.
- Reset confirmation opened, Cancel closed it, and no reset/reboot/power machine request was observed.
- Android Back closed a Reset confirmation and the route stayed `/`.
- Diagnostics opened from the health badge; Android Back closed Diagnostics and the route stayed `/`.
- Final `u64` `/v1/info` succeeded.

## Known non-issues deliberately left unchanged

- Polling intervals, retry/backoff policy, circuit-breaker thresholds, and device-safety presets were not tuned.
- Manual health-check service semantics were not changed.
- Non-destructive actions such as Menu, Pause/Resume, browsing, and diagnostics were not given confirmation prompts.

## Commands run

- `npm run test`
- `npm run test:coverage`
- Local changed-line statement coverage check: 378/378 changed executable statements covered.
- `npm run lint`
- `npx playwright test playwright/homeInteractivity.spec.ts`
- `npm run cap:build`
- `npm run android:apk`
- `adb -s 9B081FFAZ001WX install -r android/app/build/outputs/apk/debug/c64commander-0.7.9-rc1-debug.apk`
- `curl -sS --max-time 4 http://c64u/v1/info`
- `curl -v --http1.1 --max-time 4 http://c64u/v1/info`
- `node scripts/hil-screenshot-evidence.mjs --serial 9B081FFAZ001WX --name prod-hardening-5-launch --out-dir docs/research/stabilization/prod-hardening-5/evidence --ui-dump`
- `node scripts/hil-screenshot-evidence.mjs --serial 9B081FFAZ001WX --name prod-hardening-5-post-back --out-dir docs/research/stabilization/prod-hardening-5/evidence --ui-dump`
- `node scripts/hil-screenshot-evidence.mjs --serial 9B081FFAZ001WX --name prod-hardening-5-final-healthy --out-dir docs/research/stabilization/prod-hardening-5/evidence --ui-dump`
- CDP/Playwright WebView validation via `http://127.0.0.1:9222`

## Residual risk

- Power Cycle was covered by unit/component and Playwright tests but was not visible in the default connected HIL quick actions.
- Destructive Confirm paths were not executed on real `c64u` by design; live validation covered open, Cancel, Back, and network monitoring for absence of destructive requests.
