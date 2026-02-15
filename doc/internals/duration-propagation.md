# Song Duration Propagation Contract

## Overview

Song duration (songlength) determines auto-advance timing. Duration flows from metadata sources through the playback pipeline to the native background service.

## Duration by Source

| Source | Duration Origin | Availability | Notes |
|--------|----------------|-------------|-------|
| **HVSC** | HVSC songlengths database (`.md5` / `.txt`) | Always available if song is in HVSC | Embedded during HVSC ingestion |
| **Local** | Playlist item metadata (user-provided or HVSC cross-reference) | Optional | May be null for non-HVSC SIDs |
| **Ultimate** | Playlist item metadata (propagated from HVSC lookup or prior playback) | Optional | Requires FTP fetch for SSL upload |

## Propagation Path

1. **Playlist item** carries `durationMs` from track metadata.
2. **PlayRequest** includes `durationMs` in the request object.
3. **PlayPlan** (`buildPlayPlan`) copies `durationMs` from request.
4. **playbackRouter.executePlayback()** branches on `hasSonglengthData`:
   - **With duration**: Fetches SID via FTP, creates SSL payload, uploads via `playSidUpload`.
   - **Without duration**: Falls back to `playSid` (device plays without auto-advance).
5. **Auto-advance guard**: Set in `PlayFilesPage` when `durationMs > 0`, stored as `dueAtMs = trackStartedAt + durationMs`.
6. **Native bridge**: `BackgroundExecutionPlugin.setDueAtMs()` forwards to `BackgroundExecutionService` for lock-screen watchdog.
7. **Session restore**: `usePlaybackPersistence` rehydrates `autoAdvanceGuardRef` and calls `setAutoAdvanceDueAtMs` to re-register the native due-time.

## Failure Modes

| Failure | Behavior | Observability |
|---------|----------|---------------|
| No duration metadata | Direct play without auto-advance | `playback-no-duration` info event |
| FTP fetch fails | Fallback to direct play | `ssl-propagation-failure` error event |
| SSL payload invalid | Fallback to direct play | `ssl-propagation-failure` error event |
| Upload + fallback both fail | Error thrown to caller | Error log + classified trace error |

## Test Coverage

- `tests/unit/playbackRouter.test.ts`: 20+ tests covering all duration/route combinations.
- `tests/unit/playFiles/usePlaybackPersistence.test.tsx`: Session restore rehydrates native due-time.
