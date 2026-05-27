# Production Hardening 3 - Worklog

## 2026-05-27T15:48:06Z - Kickoff

- Classified the task as CODE_CHANGE with required tests, documentation, coverage, build, and Android/device validation evidence.
- Read `.github/copilot-instructions.md`, `AGENTS.md`, `docs/research/stabilization/prod-hardening-2/research.md`, `docs/research/stabilization/prod-hardening-2/plans.md`, `docs/research/stabilization/prod-hardening-2/prompt.md`, `docs/architecture.md`, `docs/features-by-page.md`, `docs/ux-guidelines.md`, and `docs/testing/maestro.md`.
- Confirmed `CLAUDE.md` is not present.
- Initial git status showed `docs/research/stabilization/prod-hardening-3/` as untracked before creating this plan/worklog; the folder contained `prompt.md`.
- Created the authoritative phase-3 execution plan and worklog.

Next: audit current production code and tests against prod-hardening-2 guarantees before changing behavior.

## 2026-05-27T17:10:00Z - Local hardening changes

- Removed the remaining production diagnostics `__c64uBypassCircuit` use from validate-target and added a regression assertion.
- Added CI guard coverage for planted `__c64uBypassCircuit` usage outside the REST gateway and for reintroduced `updateConfigBatch(..., { immediate: ... })`.
- Hardened `useDeviceBoundSlider` preview writes so slow preview requests are single-flight with one trailing latest intent; synchronous preview functions still release immediately.
- Hardened saved-device `backgroundMaintenance` so hidden documents do not issue probes and visible resume triggers one selected-device lightweight check.
- Hardened mounted disk removal so a failed eject logs/reports the failure and returns without removing the disk from the library.
- Added playback auto-advance regressions for duplicate auto callbacks and manual-stop suppression of a pending auto callback.
- Deduped clustered playback resume signals from `focus`, `pageshow`, and `visibilitychange`.
- Hardened HVSC cancellation so idle/repeated cancel requests do not overwrite ready/idle state with `Cancelled`.
- Split HVSC browse availability from HVSC install/ingest availability so Filesystem-only native availability no longer enables ingestion actions.

Targeted command results:

- `npm run test -- --run tests/unit/components/disks/HomeDiskManager.extended.test.tsx` - passed, 20 tests.
- `npm run test -- --run tests/unit/hooks/useSavedDeviceHealthChecks.test.tsx tests/unit/components/disks/HomeDiskManager.extended.test.tsx` - passed, 36 tests.
- `npm run test -- --run tests/unit/ci/deviceGatewayGuard.test.ts tests/unit/hooks/useSavedDeviceHealthChecks.test.tsx` - passed, 21 tests.
- `npm run test -- --run tests/unit/hvsc/hvscIngestionRuntime.test.ts tests/unit/playFiles/usePlaybackResumeTriggers.test.tsx tests/unit/playFiles/usePlaybackController.autoAdvance.test.tsx` - passed, 64 tests.
- `npm run test -- --run tests/unit/hvsc/hvscService.test.ts tests/unit/playFiles/useHvscLibrary.test.tsx tests/unit/playFiles/useHvscLibrary.preparation.test.tsx tests/unit/playFiles/useHvscLibrary.progress.test.tsx tests/unit/playFiles/useHvscLibrary.edges.test.tsx` - passed, 118 tests.

Next: run formatting/lint/build/test/coverage, then Android APK deploy and hardware validation or record exact blockers.

## 2026-05-27T16:40:00Z - Final validation and device evidence

- `npm run test` passed: 574 test files and 6649 tests.
- `npm run lint` passed after adding `.worktrees/**` to `.prettierignore` and formatting/fixing the pre-existing lint drift in `src/pages/playFiles/hooks/useVolumeOverride.ts`, `src/pages/PlayFilesPage.tsx`, and `src/pages/SettingsPage.tsx`.
- `npm run build && npm run test:coverage` passed. Final coverage summary: statements 94.56%, branches 91.64% (21427/23380), functions 90.22%, lines 94.56%.
- Android APK build/deploy:
  - `./build --skip-install --skip-tests --skip-format --install-apk --device-id 9B081FFAZ001WX` built `android/app/build/outputs/apk/debug/c64commander-0.8.5-rc1-debug.apk`.
  - First install was blocked by `INSTALL_FAILED_VERSION_DOWNGRADE` because the Pixel 4 had versionCode 1991 installed and the freshly built APK has versionCode 1980.
  - Per repository policy, uninstalled `uk.gleissner.c64commander`, installed the freshly built APK, and launched it successfully on Pixel 4 serial `9B081FFAZ001WX`.
- Hardware target probe:
  - `http://u64/v1/info` returned Ultimate 64 Elite firmware 3.14e with no reported errors, so `u64` was selected.
  - `http://c64u/v1/info` returned a connection reset during the initial probe, so no further validation traffic was sent to `c64u`.
- On-device validation:
  - Home loaded on the installed app as version `0.8.5-rc1`, connected to `u64`, firmware `3.14e`, with the header showing `U64 HEALTHY`.
  - Play Files loaded in the WebView with the `U64 HEALTHY` header, playlist controls, mute, volume, default-duration, Songlengths, and playlist controls visible.
  - App process remained running (`pidof uk.gleissner.c64commander` returned `21044`), and filtered app logs showed no `FATAL`, `AndroidRuntime`, unhandled JavaScript error, or install/runtime crash signature after launch and Play Files navigation.
- No documentation screenshots were regenerated because the hardening changes did not intentionally change documented visible UI.

Remaining follow-up: HVSC partial browse-index transaction checkpointing is still a larger future hardening item; this pass covered the incorrect ingestion affordance and idle-cancel correctness issues.
