# Reliability2 Execution Log

## 2026-03-06T00:00:00+00:00

### Session start

Branch: `reliability1-fixes`
Target: implement `doc/testing/investigations/reliability2/plan.md`.

Execution order followed the plan where practical, with TypeScript/runtime fixes landed first, then Android FTP hardening, then repo-wide verification.

---

## 2026-03-06T00:15:00+00:00

### HVSC runtime convergence and playback/session fixes

Applied:

- `src/lib/hvsc/hvscIngestionRuntime.ts`
  - cancellation convergence now preserves `idle` + `Cancelled`
  - cached-ingest start resets stale progress summary stage
  - native 7z unsupported-method failures now fall back to the non-native extractor
- `src/pages/playFiles/hooks/usePlaybackPersistence.ts`
  - repository persistence stores explicit local `sourceId`
  - hydration recovers local `sourceId` from explicit field, legacy locator, or legacy encoded `trackId`
- `src/pages/playFiles/hooks/usePlaybackController.ts`
  - non-song items use fallback duration when no explicit duration exists
- `src/lib/sourceNavigation/useSourceNavigator.ts`
  - stale requests can no longer set error or clear loading state
- `src/hooks/useDiskLibrary.ts`
  - device switch resets in-memory disk state instead of merging across devices
- `src/pages/playFiles/hooks/useHvscLibrary.ts`
  - fixed unmount-before-listener-registration cleanup race
- `src/pages/playFiles/hooks/useVolumeOverride.ts`
  - volume write failures are logged instead of silently swallowed
- `src/pages/PlayFilesPage.tsx`
  - mute-toggle invocation now handles async failures explicitly
- `src/lib/startup/serviceWorkerRegistration.ts`
  - native platforms skip service-worker registration
- `src/lib/c64api.ts`
  - stored device IP is preferred when runtime host would otherwise fall back to `c64u`

Test coverage added/extended:

- `tests/unit/hvsc/hvscIngestionRuntime.test.ts`
- `tests/unit/playFiles/usePlaybackPersistence.test.tsx`
- `tests/unit/playFiles/usePlaybackController.test.tsx`
- `tests/unit/sourceNavigation/useSourceNavigator.test.ts`
- `tests/unit/hooks/useDiskLibrary.test.ts`
- `tests/unit/playFiles/useHvscLibrary.test.tsx`
- `tests/unit/startup/serviceWorkerRegistration.test.ts`
- `tests/unit/c64api.test.ts`

---

## 2026-03-06T00:35:00+00:00

### Android-native hardening

Applied:

- `android/app/src/main/java/uk/gleissner/c64commander/FtpClientPlugin.kt`
  - connect/default/socket/data timeouts configured per call
  - timeout failures normalized into deterministic rejection messages
- `src/lib/native/ftpClient.ts`
  - JS bridge types now expose `timeoutMs`
- `android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt`
  - unsupported 7z method-chain failures are classified into an actionable message so the JS runtime can trigger fallback extraction

Test coverage added/extended:

- `android/app/src/test/java/uk/gleissner/c64commander/FtpClientPluginTest.kt`
- `android/app/src/test/java/uk/gleissner/c64commander/HvscIngestionPluginTest.kt`

---

## 2026-03-06T00:50:00+00:00

### Release/process notes

Updated `doc/developer.md` release guidance to keep the Android transport regression hotfix in place:

- keep `server.androidScheme = "http"`
- keep `plugins.CapacitorHttp.enabled = true`
- treat either rollback as a release blocker for Android connectivity validation

---

## 2026-03-06T01:00:00+00:00

### Verification

Completed:

1. `npm run lint` -> pass
2. `npm run build` -> pass
3. `npm run test:coverage` -> pass
4. `node scripts/check-coverage-threshold.mjs` -> pass

Coverage:

- line coverage: `91.27%`
- branch coverage: `90.19%`

Notes:

- full JS/Vitest suite passed during coverage run: `263` files, `3226` tests
- Android JVM validation hit a local Gradle/Kotlin environment failure (`IllegalArgumentException: 25.0.1`), so native test execution was not re-verified end-to-end in this environment
- a full `./build` completion result was not captured after the helper moved into the Playwright phase

---

## 2026-03-06T01:20:00+00:00

### RAM dump/restore script parity

Applied:

- `doc/testing/investigations/reliability2/analysis.md`
  - added `R2-14` for Save RAM / Load RAM parity with the known-good shell scripts
- `src/lib/machine/ramOperations.ts`
  - preserved script-matching dump behavior (`pause -> 16 x 4 KiB readmem -> resume`)
  - changed full RAM restore to match `scripts/ram_write.py` (`pause -> single 64 KiB writemem at $0000 -> resume`)
- `tests/unit/machine/ramOperations.test.ts`
  - replaced chunked-restore assertions with single-request parity checks

Planned verification after landing the RAM parity change:

1. focused unit tests for RAM operations and Home page RAM actions
2. `npm run lint`
3. `npm run build`
4. `npm run test:coverage`
5. `./build`
