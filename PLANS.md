# prod-hardening-5 Fix Plan

## Current Repository State

- Branch: `fix/prod-hardening`.
- Initial worktree state before this task's edits:
  - Modified: `package-lock.json`.
  - Untracked: `docs/research/stabilization/prod-hardening-5/evidence/`, `s33-resume-sm.png`, `s34-sm.png`.
- Those pre-existing changes are treated as unrelated and will be preserved.
- Change classification: `DOC_PLUS_CODE` and `UI_CHANGE`.
- Live HIL target constraint: use `c64u` only. Do not probe or validate against real `u64`.

## Assumptions

- The prod-hardening-5 HIL observations are authoritative unless source/tests prove a finding is already fixed.
- Stale-device and superseded-request behavior can be covered deterministically with mocks or local test doubles.
- Destructive HIL validation must open and cancel confirmations only; it must not confirm Reset, Reboot, Power Cycle, or similar actions on `c64u`.
- Existing unrelated evidence files and lockfile changes may belong to concurrent work and must not be reverted.

## Findings Being Fixed

1. Abort, cancellation, and stale/superseded request paths are misclassified as malformed JSON or selected-device API failures.
2. Diagnostics modal does not intercept Android Back before router navigation.
3. Destructive Home machine actions lack consistent confirmation.
4. Evidence screenshots are not consistently downscaled for LLM/review consumption.

## Impact Map

- Source files: expected in `src/lib/c64api.ts`, diagnostics/back handling, Home machine controls, modal/dialog support.
- Tests: expected in existing Vitest and/or Playwright suites for API, diagnostics/navigation, and Home controls.
- Scripts/docs: expected HIL/evidence helper scripts plus `docs/research/stabilization/prod-hardening-5/`.
- Runtime platforms: web and Android. iOS CI-only remains unaffected except shared React behavior.
- Screenshot docs under `docs/img/`: no broad refresh planned; confirmation UI is new behavior but this task requires evidence helpers rather than app-doc screenshot regeneration.

## Implementation Phases

### Phase 1 - Baseline and Source Reconnaissance

- Confirm git status and branch.
- Read repository instructions and UX guidance.
- Identify tests for `c64api`, diagnostics/back handling, and MachineControls.
- Identify HIL scripts and screenshot helpers.
- Record baseline in this file and `WORKLOG.md`.
- Status: completed.

### Phase 2 - Abort/Supersede Classification Fix

- Inspect `src/lib/c64api.ts`, abort helpers, selected-device routing, and diagnostics aggregation.
- Ensure body-read cancellation is classified before malformed JSON.
- Ensure superseded stale-device completions do not create selected-device ERROR problems.
- Add regression tests for valid JSON, malformed JSON, body-read abort, stale supersede downgrade/ignore, and selected-device transport failure.
- Run targeted tests, then broader relevant tests.
- Status: completed; targeted tests pass.

### Phase 3 - Modal Android Back Fix

- Inspect Capacitor Back Button integration and diagnostics modal state ownership.
- Make topmost modal/panel consume Android Back before router navigation.
- Add tests for Diagnostics closing without route change and normal Back when no modal is open.
- Status: completed; targeted tests pass.

### Phase 4 - Destructive-Action Confirmation

- Inspect `MachineControls`, `HomePage`, existing `PowerOffDialog`, and action guards.
- Add confirmation for Reset, Reboot, Reboot with clear memory, Power Cycle if present, preserving current Power Off protection.
- Re-check connection/busy guards on confirm.
- Ensure Android Back closes confirmation without navigation or command execution.
- Add regression tests for confirm/cancel/back and non-destructive actions.
- Status: completed; targeted tests pass.

### Phase 5 - Evidence Capture Hardening

- Inspect screenshot/evidence scripts.
- Add or update helper that keeps raw screenshots and creates review-safe downscaled PNGs under configured limits.
- Add script validation for raw/downscaled outputs and dimensions.
- Document raw vs downscaled usage.
- Status: completed; targeted tests pass.

### Phase 6 - Full Verification

- Run formatting, lint, typecheck/build, test coverage, targeted e2e/component tests, and Android build as applicable.
- Install current APK on Pixel 4 `9B081FFAZ001WX`.
- HIL validate against `c64u` only:
  - c64u selected and healthy.
  - Diagnostics opens from health/status badge.
  - Android Back closes Diagnostics without changing page.
  - Reset confirmation opens and Cancel sends no reset.
  - Reboot confirmation opens and Cancel sends no reboot.
  - Background/foreground smoke if time allows.
  - Final `http://c64u/v1/info` succeeds.
- Status: completed after `c64u` reboot; APK installed and Diagnostics Back, Reset/Reboot confirmation cancel, confirmation Back, selected c64u health, and final c64u health were validated on Pixel 4.

## Tests To Add Or Update

- API cancellation/malformed JSON classification tests.
- Selected-device supersede/stale-host diagnostic suppression tests.
- Selected-device transport failure severity regression test.
- Diagnostics Android Back modal consumption test.
- Back behavior without open modal regression test.
- Home destructive machine action confirmation tests for Reset, Reboot, clear-memory Reboot, Power Cycle if present, and existing Power Off.
- Evidence helper validation test for raw plus downscaled screenshots with dimensions below limit.

## HIL Validation Steps

- Run `adb devices -l` and verify Pixel 4 serial `9B081FFAZ001WX`.
- Run `curl -sS --max-time 4 http://c64u/v1/info`.
- Do not run any `u64` probes.
- Install latest built APK on Pixel 4.
- Use ADB/UI automation, logcat, and accessibility dumps.
- Capture raw screenshots and downscaled review images only.
- Do not confirm destructive commands on the real `c64u`.

## Risk Controls

- Preserve retry, timeout, backoff, circuit-breaker, and device-safety behavior unless a finding directly requires a scoped change.
- Keep abort/cancel/supersede logs low severity while preserving genuine selected-device failures as WARN/ERROR.
- Do not silence real selected-device errors or malformed JSON.
- Use tests and mocks for stale-device behavior instead of live host switching.
- Avoid broad refactors and unrelated formatting churn.
- Never intentionally access live `u64`.

## Completion Checklist

- [x] `PLANS.md` exists and final status is accurate.
- [x] `WORKLOG.md` exists and includes commands, failures, fixes, and verification evidence.
- [x] Abort/body-read cancellation no longer reports malformed JSON.
- [x] Genuine malformed JSON still reports malformed JSON.
- [x] Superseded stale-device requests do not create selected-device ERROR problems.
- [x] Diagnostics modal consumes Android Back before route navigation.
- [x] Destructive Home actions require confirmation.
- [x] Cancel and Back from confirmation never execute destructive commands.
- [x] Screenshot/evidence helpers create downscaled review-safe images.
- [x] Regression tests pass.
- [x] Coverage validation passes: global branch coverage 91.70%; local changed `src/**` statement coverage 357/357.
- [x] Android build is installed on Pixel 4 and HIL validation against `c64u` only is complete, or a concrete hardware/ADB blocker is documented.
- [x] Final `c64u` health probe succeeds.
- [x] `docs/research/stabilization/prod-hardening-5/fix-summary.md` exists and is suitable for PR review.

## Current Status

- Phase 1 source reconnaissance is complete.
- API cancellation/supersede handling has been patched.
- Shared interstitial Android Back handling has been patched.
- Home destructive machine action confirmations have been added for Reset, Reboot, Reboot (Clr Mem), and Power Cycle.
- HIL evidence screenshot helper and usage note have been added.
- Targeted Vitest regression tests, full unit tests, lint, coverage, focused Playwright, web/Capacitor build, and Android APK build pass.
- Latest APK `android/app/build/outputs/apk/debug/c64commander-0.7.9-rc1-debug.apk` was installed on Pixel 4 `9B081FFAZ001WX`.
- Initial `c64u` REST validation was blocked by connection resets, but the user rebooted `c64u` and the final validation succeeded.
- On-device HIL passed with selected device `debug-c64u` at `192.168.1.167`:
  - app showed `HEALTHY`, device `c64u`, firmware `1.1.0`;
  - Diagnostics opened from the health badge; Android Back closed it; route stayed `/`;
  - Reset confirmation opened and Cancel closed it without a machine request;
  - Reboot confirmation opened and Cancel closed it without a machine request;
  - Android Back closed a Reset confirmation without route navigation or a machine request;
  - final `curl -sS --max-time 4 http://c64u/v1/info` succeeded with product `C64 Ultimate`, hostname `c64u`, unique id `5D4E12`, and no errors.
- No live `u64` probes have been run.
