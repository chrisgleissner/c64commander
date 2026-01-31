# Playwright Trace Regression Plan (feed/tracing)

Date: 2026-01-31
Branch: feed/tracing

## Triage (initial, update as evidence arrives)
- Bucket B: trace comparator / normalization (confirmed)
  - Demo mode: repeated `/v1/info` actions vary by target and count; comparator treated duplicates as required.
  - FTP list flows: request payload `port` differs per run; comparator treated port as semantic.
  - Affected tests: demoMode, itemSelection, playback.part2 (android-phone).
- Bucket A: real behavior regressions
  - None observed in repros (UI + API behavior matched; only trace comparison failed).

## Minimal reproduction (only failing tests)
- [x] Single-test repro (android-phone, passed): `npx playwright test playwright/settingsConnection.spec.ts:81 --project=android-phone`
- [x] Targeted batch (android-phone, demoMode failed pre-fix): `npx playwright test playwright/connectionSimulation.spec.ts:164 playwright/demoMode.spec.ts:179 playwright/configVisibility.spec.ts:28 --project=android-phone`
- [x] Post-fix targeted batch (android-phone): `npx playwright test playwright/demoMode.spec.ts:179 playwright/connectionSimulation.spec.ts:164 playwright/configVisibility.spec.ts:28 playwright/settingsDiagnostics.spec.ts:68 playwright/playback.spec.ts:105 --project=android-phone`

## Fixes (one checkbox per change)
- [x] Collapse noisy `/v1/info` actions by signature (ignore backend target when de-duping)
- [x] Normalize `port` fields in trace payloads as volatile
- [x] Add trace comparator unit tests (URL port normalization, payload port normalization, timestamps ignored, semantic mismatch, noisy collapse)
- [ ] Adjust trace comparator ordering/abort handling (not needed)
- [ ] Fix action tracing regression in app code (not needed)
- [ ] Update golden traces only if normalization is correct and behavior intentionally changed (not needed)

## Verification (rerun after each change)
- [x] Re-run single-test repro (android-phone): `npx playwright test playwright/demoMode.spec.ts:179 --project=android-phone`
- [x] Re-run 3–5 related tests (android-phone): `npx playwright test playwright/demoMode.spec.ts:179 playwright/connectionSimulation.spec.ts:164 playwright/configVisibility.spec.ts:28 playwright/settingsDiagnostics.spec.ts:68 playwright/playback.spec.ts:105 --project=android-phone`
- [x] Re-run 3–5 related tests (android-tablet): `npx playwright test playwright/diskManagement.spec.ts:230 playwright/homeConfigManagement.spec.ts:149 playwright/playlistControls.spec.ts:211 --project=android-tablet`
- [x] Full failing list on android-phone: `npx playwright test playwright/audioMixer.spec.ts:44 playwright/configVisibility.spec.ts:28 playwright/connectionSimulation.spec.ts:164 playwright/demoMode.spec.ts:179 playwright/diskManagement.spec.ts:230 playwright/homeConfigManagement.spec.ts:149 playwright/itemSelection.spec.ts:203 playwright/navigationBoundaries.spec.ts:200 playwright/playback.part2.spec.ts:217 playwright/playback.spec.ts:105 playwright/playback.spec.ts:178 playwright/playback.spec.ts:205 playwright/playlistControls.spec.ts:211 playwright/settingsConnection.spec.ts:81 playwright/settingsDiagnostics.spec.ts:68 --project=android-phone`\n+- [x] Full failing list on android-tablet: `npx playwright test playwright/diskManagement.spec.ts:230 playwright/homeConfigManagement.spec.ts:149 playwright/playlistControls.spec.ts:211 --project=android-tablet`

## Notes
- Capture: demoMode failure showed missing `/v1/info` actions in trace comparison; itemSelection/playback.part2 showed `/v1/ftp/list` mismatches due to request `port`.
- Bucket assignment: A = real product regression, B = trace non-determinism (all observed failures in bucket B).
