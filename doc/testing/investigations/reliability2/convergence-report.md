# Reliability2 Convergence Report

Branch: `reliability1-fixes`
Date: 2026-03-06

## Summary

The reliability2 plan is implemented across the JS/runtime surface, Android FTP hardening, and RAM dump/restore parity with the known-good shell scripts. The remaining uncertainty is validation, not the mainline TypeScript code: Android JVM tests could not be completed locally because the Gradle/Kotlin toolchain failed before test execution with `IllegalArgumentException: 25.0.1`, and the final `./build` Playwright phase was started but not observed to completion in this session.

---

## R2-1

HVSC cancel convergence

Status: `DONE`

Root cause: cancellation paths updated state to cancelled/idle and then later top-level catch blocks overwrote the terminal state to `error`.

Fix:

- `src/lib/hvsc/hvscIngestionRuntime.ts`
  - added explicit cancellation convergence helper
  - install/update and cached-ingest catches now branch on `classifyError(...).category === "cancelled"`
  - cancellation emits cancelled progress instead of terminal error progress

Test evidence:

- `tests/unit/hvsc/hvscIngestionRuntime.test.ts`

---

## R2-2

Android FTP timeout/cancel hardening

Status: `DONE`

Root cause: native FTP calls had no bounded timeout configuration and could block the single worker indefinitely.

Fix:

- `android/app/src/main/java/uk/gleissner/c64commander/FtpClientPlugin.kt`
  - configures connect/default/socket/data timeouts
  - supports per-call `timeoutMs`
  - normalizes timeout messages for list/read failures
- `src/lib/native/ftpClient.ts`
  - exposes `timeoutMs` on bridge option types

Test evidence:

- `android/app/src/test/java/uk/gleissner/c64commander/FtpClientPluginTest.kt`

Validation note:

- Android JVM test execution was blocked locally by the Gradle/Kotlin environment issue, so this change is code-complete but not locally re-executed end-to-end here.

---

## R2-3

Source navigator stale-request correctness

Status: `DONE`

Fix:

- `src/lib/sourceNavigation/useSourceNavigator.ts`
  - stale catch path is token-guarded
  - stale finally path can no longer clear current loading state

Test evidence:

- `tests/unit/sourceNavigation/useSourceNavigator.test.ts`

---

## R2-4

Disk-library device isolation

Status: `DONE`

Fix:

- `src/hooks/useDiskLibrary.ts`
  - device boundary changes reset in-memory disks/runtime files before reload

Test evidence:

- `tests/unit/hooks/useDiskLibrary.test.ts`

---

## R2-5

Playback repository local `sourceId` recovery

Status: `DONE`

Fix:

- `src/lib/playlistRepository/types.ts`
  - persisted track schema now includes `sourceId`
- `src/pages/playFiles/hooks/usePlaybackPersistence.ts`
  - hydrates local source IDs from explicit field and legacy formats
- `src/pages/PlayFilesPage.tsx`
  - query-playlist persistence also stores `sourceId`

Test evidence:

- `tests/unit/playFiles/usePlaybackPersistence.test.tsx`

---

## R2-6

Non-song auto-advance fallback duration

Status: `DONE`

Fix:

- `src/pages/playFiles/hooks/usePlaybackController.ts`
  - applies `durationFallbackMs` to non-song items without explicit duration

Test evidence:

- `tests/unit/playFiles/usePlaybackController.test.tsx`

---

## R2-7

Volume failure reporting and async safety

Status: `DONE`

Fix:

- `src/pages/playFiles/hooks/useVolumeOverride.ts`
  - write failures are logged instead of silently ignored
- `src/pages/PlayFilesPage.tsx`
  - mute-toggle promise rejections are handled and reported

Test evidence:

- existing volume/mute regression tests plus new failure-observability coverage

---

## R2-8

HVSC listener lifecycle cleanup race

Status: `DONE`

Fix:

- `src/pages/playFiles/hooks/useHvscLibrary.ts`
  - late listener registrations are removed exactly once after unmount/dispose

Test evidence:

- `tests/unit/playFiles/useHvscLibrary.test.tsx`

---

## R2-9

Android transport regression hardening

Status: `DONE`

Fix:

- preserved `capacitor.config.ts` settings:
  - `server.androidScheme = "http"`
  - `plugins.CapacitorHttp.enabled = true`
- added release-process note in `doc/developer.md` so these settings are treated as protected Android connectivity requirements

---

## R2-10

Hostname fallback/discovery resilience

Status: `DONE`

Fix:

- `src/lib/c64api.ts`
  - prefers stored last-known-good device host when the derived host would otherwise be the default hostname `c64u`

Test evidence:

- `tests/unit/c64api.test.ts`

---

## R2-11

HVSC native archive compatibility

Status: `DONE`

Root cause: some Android devices reject the live HVSC 7z method chain with a native `Unsupported compression method [...]` decoder failure.

Fix:

- `android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt`
  - classifies unsupported 7z method-chain failures into an explicit actionable error message
- `src/lib/hvsc/hvscIngestionRuntime.ts`
  - catches that native error class and falls back to the non-native archive extractor for the same cached archive

Test evidence:

- `tests/unit/hvsc/hvscIngestionRuntime.test.ts`
- `android/app/src/test/java/uk/gleissner/c64commander/HvscIngestionPluginTest.kt`

Validation note:

- local JVM execution of the Android test file was blocked by the environment issue above, so device/runtime confirmation still needs a targeted Android rerun.

---

## R2-12

HVSC status-state convergence

Status: `DONE`

Fix:

- `src/lib/hvsc/hvscIngestionRuntime.ts`
  - failure/cancellation terminal state writes now converge through a single deterministic path
  - cached-ingest start resets stale summary stage before new progress is emitted

Test evidence:

- `tests/unit/hvsc/hvscIngestionRuntime.test.ts`

---

## R2-13

Android service-worker startup noise cleanup

Status: `DONE`

Fix:

- `src/lib/startup/serviceWorkerRegistration.ts`
  - skips service-worker registration on native platforms
- `src/main.tsx`
  - uses the shared helper

Test evidence:

- `tests/unit/startup/serviceWorkerRegistration.test.ts`

---

## R2-14

RAM dump/restore script parity

Status: `DONE`

Root cause: the Save RAM path already matched the working `ram_read.py` sequence, but `loadFullRamImage(...)` restored memory in 4 KiB chunks instead of using the known-good single 64 KiB `writemem` request from `ram_write.py`.

Fix:

- `src/lib/machine/ramOperations.ts`
  - keeps the chunked dump path unchanged
  - restores full RAM with one `writeMemoryBlock("0000", image)` call inside the existing pause/resume guard
- `tests/unit/machine/ramOperations.test.ts`
  - now asserts `pause -> one full-image write -> resume`

Test evidence:

- `tests/unit/machine/ramOperations.test.ts`

---

## Global gates

| Gate | Status |
| --- | --- |
| `npm run lint` | pass |
| `npm run build` | pass |
| `npm run test:coverage` | pass |
| `node scripts/check-coverage-threshold.mjs` | pass |

Coverage summary:

- line coverage `91.27%`
- branch coverage `90.19%`

Outstanding verification gaps:

- local Android JVM test execution blocked by Gradle/Kotlin environment failure `IllegalArgumentException: 25.0.1`
- final `./build` Playwright completion was not captured in this session
