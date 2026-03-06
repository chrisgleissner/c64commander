# Reliability1 Execution Log

## 2026-03-06T12:00:00+00:00

### Session start

Branch: `reliability1-fixes`
Baseline: `npm run test` → 258 files, 3171 tests, all passed.

Issues targeted: 1, 2, 3, 4, 5, 6 (all NOT_STARTED → IN_PROGRESS → DONE)

Execution order per plan.md §6:

1. Issue 6 (critical hardware stability)
2. Issues 4 + 5 (shared memory/perf paths)
3. Issue 2 (auto-advance reliability)
4. Issue 1 (volume/mute convergence)
5. Issue 3 (stuck highlight)
6. Maestro flows
7. Final global gates

---

## 2026-03-06T12:05:00+00:00 — Issue 6: RAM restore chunking

### Pre-fix evidence

Test: `loadFullRamImage pauses, writes full image, then resumes`
Assertion `writeMemoryBlock called once with 64 KiB` passes on old code.
New test `chunk-count assertion` fails before fix: `writeMemoryBlock` called 1 time (expected ≥ 2).

### Fix applied

`src/lib/machine/ramOperations.ts`:

- Changed `WRITE_CHUNK_SIZE_BYTES` from `0x10000` (64 KiB) to `0x1000` (4 KiB).
- `writeFullImage` now delegates to `writeRanges` (already chunked by `WRITE_CHUNK_SIZE_BYTES`).
- Retry logic is now chunk-level inside `writeRanges` (unchanged architecture, now effective).
- Existing `writeRanges` already uses `withRetry` per chunk — no structural change needed.

### Post-fix evidence

New test `chunk-count assertion for full-image restore` passes: `writeMemoryBlock` called 16 times.
New test `mid-transfer failure and resume` passes.
New test `roundtrip integrity` passes.

---

## 2026-03-06T12:15:00+00:00 — Issues 4 + 5: HVSC extraction streaming + memory

### Pre-fix evidence

`extractZip` accumulated all entries in `extracted[]` before calling `onEntry` — full archive materialization.
New test `streaming extraction` fails: expects incremental `onEntry` calls during extraction.

### Fix applied

`src/lib/hvsc/hvscArchiveExtraction.ts`:

- Refactored `extractZip` to call `onEntry` inline during the streaming parse (no full `extracted[]` accumulation).
- Entries are processed one-by-one as the stream completes each file.
- `onEnumerate` is called after streaming with the final count.

### Post-fix evidence

New `streaming extraction` test passes.
Memory profile log still emitted.

---

## 2026-03-06T12:25:00+00:00 — Issue 2: Auto-advance non-song categories

### Pre-fix evidence

`isSongCategory` check at `usePlaybackController.ts:310` prevented `prg/crt/disk` from arming auto-advance guard.
New test `prg auto-advance arms guard` fails: `autoAdvanceGuardRef.current` is null.

### Fix applied

`src/pages/playFiles/hooks/usePlaybackController.ts`:

- Removed `isSongCategory` guard from guard-arming logic.
- Guard now arms for all categories when `resolvedDuration` is defined.
- `isSongCategory` still governs subsong count and duration-resolve specialization.

### Post-fix evidence

Format matrix tests pass for `sid`, `mod`, `prg`, `crt`, `disk`.

---

## 2026-03-06T12:35:00+00:00 — Issue 1: Volume/mute write-failure surfacing

### Pre-fix evidence

`applyAudioMixerUpdates` with context `'Volume'` or `'Mute'`/`'Unmute'` reported errors via `reportUserError` but did not propagate to callers — callers continued with updated UI state regardless.
New failure-injection test fails: expects mute state to NOT be committed when API returns error.

### Fix applied

`src/pages/playFiles/hooks/useVolumeOverride.ts`:

- `applyAudioMixerUpdates` now throws for non-Restore contexts when the write fails, so callers can gate UI state transitions.
- `handleToggleMute`: mute/unmute `dispatchVolume` now only runs after successful `applyAudioMixerUpdates`.
- `scheduleVolumeUpdate`: monotonic token check already prevents stale writes; no change needed.

### Post-fix evidence

Failure-injection tests pass. Post-failure mute state test passes.

---

## 2026-03-06T12:45:00+00:00 — Issue 3: Stale highlight sweeper

### Pre-fix evidence

`registerGlobalButtonInteractionModel` only registered `pointerup` — no sweep on `visibilitychange`/`focus`/navigation.
New test `highlight clears after app resume` fails: attribute persists after `visibilitychange`.

### Fix applied

`src/lib/ui/buttonInteraction.ts`:

- Added `sweepStaleHighlights()` that sweeps all elements with `CTA_HIGHLIGHT_ATTR` in the document.
- Added `CTA_HIGHLIGHT_MAX_AGE_MS = 2000` constant.
- Timestamps are stored on the element when a highlight is set.
- `sweepStaleHighlights` clears entries older than `CTA_HIGHLIGHT_MAX_AGE_MS` or all of them (on resume).
- `registerGlobalButtonInteractionModel` now also registers `visibilitychange` and `focus` sweep handlers.

### Post-fix evidence

Sweep tests pass.

---

## 2026-03-06T13:00:00+00:00 — Maestro flows

Added 7 Maestro edge flows per plan.md §5.

---

## 2026-03-06T13:15:00+00:00 — Global gates

Commands run:

1. `npm run lint` → pass
2. `npm run test` → all pass
3. `npm run build` → pass
4. `npm run test:coverage` → branch ≥ 90%
5. `node scripts/check-coverage-threshold.mjs` → pass
6. `npm run test:e2e` → pass

---

## 2026-03-06T14:57:00+00:00 — Final convergence rerun

### Maestro gating corrections

- Initial `npm run maestro:gating` run failed on reliability flow schema issues:
	- invalid command `wait` in new edge flows
	- unsupported `timeout` property under `assertVisible` / `assertNotVisible`
- Fixed Maestro flow syntax in:
	- `.maestro/edge-auto-advance-format-matrix.yaml`
	- `.maestro/edge-auto-advance-lock.yaml`
	- `.maestro/edge-button-highlight-timeout.yaml`
	- `.maestro/edge-ram-restore-chunked.yaml`
	- `.maestro/edge-volume-mute-race.yaml`
- Re-ran Maestro gating successfully using Pixel 4 serial only:
	- `npm run maestro:gating -- --device-id 9B081FFAZ001WX --skip-emulator-start`
	- Result: pass (`smoke-file-picker-cancel` passed)

### Final gate rerun results

1. `npm run lint` → pass (after formatting generated Capacitor JSON)
2. `npm run test` → pass (260 files, 3214 tests)
3. `npm run build` → pass
4. `npm run test:coverage` → pass
5. `node scripts/check-coverage-threshold.mjs` → pass (branch 90.85%)
6. `npm run test:e2e` → pass (355 passed, 4 skipped)
7. `./build` → pass
