# Reliability1 Convergence Report

Branch: `reliability1-fixes`
Date: 2026-03-06

## Summary

All 6 reliability issues are fixed. This report documents the fix applied, the
test evidence, and the convergence verification for each issue.

---

## Issue 1: Volume/mute UI–device state desynchronisation

**Root cause**: `applyAudioMixerUpdates` swallowed write failures for
`Volume`/`Mute`/`Unmute` contexts (called `reportUserError`, did not rethrow).
Callers — `scheduleVolumeUpdate` and `handleToggleMute` — dispatched UI state
changes unconditionally before or independently of the write.

**Fix** (`src/pages/playFiles/hooks/useVolumeOverride.ts`):

- `applyAudioMixerUpdates` now rethrows for all non-Restore contexts.
- `scheduleVolumeUpdate`/`runUpdate`: converted to `async`; `dispatchVolume({
type: 'unmute' })` moved after `await applyAudioMixerUpdates`; failure exits
  early without dispatch; stale-token check repeated after write.
- `handleToggleMute` mute path: `dispatchVolume({ type: 'mute' })` moved to
  after `await applyAudioMixerUpdates`.
- Unused `reportUserError` import removed.

**Test evidence**: `tests/unit/playFiles/volumeMuteRace.test.ts` — 15 tests:

- `applyAudioMixerUpdates` rethrow contract (5 tests)
- `scheduleVolumeUpdate` dispatch gated on write (5 tests)
- `handleToggleMute` mute path gated on write (3 tests)
- Convergence: rapid sequence + failure sequence (2 tests)

---

## Issue 2: Auto-advance does not arm for prg/crt/disk

**Root cause**: `isSongCategory` guard at
`usePlaybackController.ts:~310` blocked auto-advance guard arming for all
non-song file categories.

**Fix** (`src/pages/playFiles/hooks/usePlaybackController.ts`):

- Removed `isSongCategory` guard from guard-arming block.
- Guard arms for any category when `resolvedDuration` is a number.

**Test evidence**: `tests/unit/playFiles/autoAdvanceGuard.test.ts` — 16 tests
covering sid/mod/prg/crt/disk arming and no-op cases.

---

## Issue 3: Stuck button highlight on background/timer starvation

**Root cause**: The 220 ms clear timer is starved when the main thread is
blocked (heavy JSON, extraction loops) or when the app is backgrounded. No
sweep mechanism existed to recover stale highlights on resume.

**Fix** (`src/lib/ui/buttonInteraction.ts`):

- Added `CTA_HIGHLIGHT_SET_AT_ATTR` (`data-c64-tap-flash-set-at`): timestamp
  written on every `setTapFlash` call.
- Added `CTA_HIGHLIGHT_MAX_AGE_MS = 2000`.
- Added `sweepStaleHighlights(nowMs?)`: queries all `[data-c64-tap-flash]`
  elements and removes those older than `CTA_HIGHLIGHT_MAX_AGE_MS`.
- `registerGlobalButtonInteractionModel` now registers `visibilitychange` and
  `window focus` listeners that call `sweepStaleHighlights`; both are removed
  by the returned cleanup function.

**Test evidence**: `tests/unit/lib/ui/buttonInteraction.test.ts` — 17 tests
(8 new sweep tests added on top of 9 existing):

- `sweepStaleHighlights` removes stale elements (2 tests)
- `sweepStaleHighlights` preserves recent elements (1 test)
- `CTA_HIGHLIGHT_SET_AT_ATTR` written on apply (1 test)
- Sweeps multiple elements (1 test)
- No-op on empty document (1 test)
- `registerGlobalButtonInteractionModel`: sweep on visibilitychange (1 test)
- `registerGlobalButtonInteractionModel`: sweep on window focus (1 test)
- Sweep listeners removed on cleanup (1 test)

---

## Issues 4 + 5: HVSC extraction memory peak (streaming fix)

**Root cause**: `extractZip` accumulated all extracted entries in an `extracted[]`
array before calling `onEntry`, materialising the full archive in memory.

**Fix** (`src/lib/hvsc/hvscArchiveExtraction.ts`):

- `extractZip` refactored to call `onEntry` inline per entry during streaming parse.
- No `extracted[]` accumulation; memory usage is bounded per-entry.

**Test evidence**: `tests/unit/hvsc/hvscArchiveExtraction.test.ts` — 11 tests
including new streaming incremental-callback test.

---

## Issue 6: RAM restore device instability (chunked writes)

**Root cause**: `WRITE_CHUNK_SIZE_BYTES = 0x10000` (64 KiB). `writeFullImage`
issued a single 64 KiB write, which caused device firmware instability.

**Fix** (`src/lib/machine/ramOperations.ts`):

- `WRITE_CHUNK_SIZE_BYTES` lowered to `0x1000` (4 KiB).
- `writeFullImage` delegates to `writeRanges`, which chunks by `WRITE_CHUNK_SIZE_BYTES`.
- `writeRanges` accepts optional `onRetry` callback.

**Test evidence**: `tests/unit/machine/ramOperations.test.ts` — 18 tests.
Stale assertions in `tests/unit/ramOperations.test.ts` updated (16-chunk).

---

## Global gates

| Gate                    | Status                          |
| ----------------------- | ------------------------------- |
| `npm run lint`          | pass                            |
| `npm run test`          | 259 files, 3191 tests, all pass |
| `npm run build`         | pending (see final gate run)    |
| `npm run test:coverage` | pending (see final gate run)    |
| `npm run test:e2e`      | pending (see final gate run)    |
