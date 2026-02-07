# PLANS.md - Playback, Disk Labels, Songlengths Facade, and HVSC Pipeline Hardening

## Execution Contract
- Status legend: `[ ] pending`, `[-] in progress`, `[x] completed`.
- Loop per phase: `plan -> implement -> targeted tests -> verify -> update this file`.
- No test weakening, no skipped failures, no bypasses.
- Risky refactors require explicit rollback notes before edits.

## Phase 0 - Baseline and Guardrails
- [x] Capture current baseline and failing surfaces for A-E.
- Invariants:
  - Repository remains buildable after every phase.
  - Existing behavior outside scope is unchanged.
- Test gate:
  - Run targeted existing tests for play/hvsc/disks before edits.
- Rollback strategy:
  - Keep changes isolated by subsystem (playback, disk labels, songlengths, hvsc runtime) so each can be reverted independently.

## Phase 1 - Issue A/B/C UX and Playback Correctness
- [x] A: Ensure Play starts first playlist item when no prior track and playlist non-empty, with single in-flight play start.
- [x] B: Fix volume slider release snap-back and preserve authoritative UI position during/after interaction.
- [x] C: Replace dangling dash disk labels with exact required strings while preserving styling.
- Invariants:
  - At most one start-play request in flight.
  - No duplicate start requests from rapid taps.
  - Slider value remains stable post-release and still updates mixer/persistence.
  - Home/Disks visuals unchanged except text logic.
- Test gate:
  - Add tests for first-play + rapid taps.
  - Add tests for volume drag/release stability.
  - Add tests for Home and Disks no-disk/mounted labels.
- Rollback strategy:
  - Keep play/volume logic edits in `PlayFilesPage` scoped to handlers/effects.
  - Keep disk label edits text-only in `HomePage` and `HomeDiskManager`.

## Phase 2 - Issue D Songlengths Facade + Backend Boundary
- [x] Introduce facade + backend interface and first backend (in-memory text parser/indexer).
- [x] Route all HVSC songlength access through facade; remove direct parsing/map access from HVSC filesystem/listing code.
- [x] Route Play page songlength resolution through facade API (no direct map probing at call sites).
- [x] Add lifecycle APIs: cold-start load and reload-on-config-change.
- [x] Add centralized structured observability and status summary logging.
- Invariants:
  - Deterministic parse/index build.
  - Matching order strictly: unique filename -> filename+partial path -> full path -> md5 fallback.
  - Ambiguous matches never guessed.
  - Corrupt input never crashes; marks unavailable state.
  - Index model supports >=100k entries with best-effort memory estimate under 80 MiB.
- Test gate:
  - Facade correctness tests for unique/duplicate/path/md5/ambiguity.
  - Facade robustness tests for malformed/truncated input and cold-start failure.
  - Playlist reprocessing test on songlengths selection change.
  - Synthetic 100k benchmark-style test for parse/index performance + memory estimate.
- Rollback strategy:
  - Keep compatibility wrappers in `src/lib/sid/songlengths.ts` while runtime callers are migrated to facade-backed APIs.

## Phase 3 - Issue E HVSC Download/Extraction/Ingestion State Machine Hardening
- [x] Implement explicit linear state machine: `IDLE -> DOWNLOADING -> DOWNLOADED -> EXTRACTING -> EXTRACTED -> INGESTING -> READY`.
- [x] Enforce transition invariants and structured transition logging.
- [x] Ensure failure containment/recovery markers for partial download/extract/ingest and restart-safe behavior.
- [x] Improve progress/status consistency to eliminate contradictory state combinations.
- Invariants:
  - Illegal state transitions impossible (guarded, logged, rejected).
  - All exceptions include stack + context in logs.
  - Partial artifacts are recoverable and deterministic across restarts.
- Test gate:
  - Tests for interruption, corrupt archive, extraction failure, ingestion failure.
  - Tests for restart behavior after each failure class.
  - End-to-end success path test with expected transition order.
- Rollback strategy:
  - Keep runtime state-machine helpers isolated and archive I/O logic intact.

## Phase 4 - Full Verification and CI Parity
- [x] Run full local validation and confirm green results.
- Invariants:
  - `npm run test`, `npm run lint`, `npm run build` all pass.
  - Any touched docs are current.
- Test gate:
  - Full test suite and targeted suites for changed subsystems.
- Rollback strategy:
  - If late regression appears, revert only offending subsystem hunks and re-run all gates.

## Progress Log
- 2026-02-07: Initialized new execution contract and phased plan for issues A-E.
- 2026-02-07: Phase 0 baseline complete (targeted tests for hvsc/songlengths/disks/play hooks all green).
- 2026-02-07: Phase 1 complete. Implemented play single-flight guard + explicit first-item start target resolution, stabilized volume slider target sync after release, and replaced dash disk labels with required strings. Added unit tests in `tests/unit/playFiles/playbackGuards.test.ts`, plus disk label assertions in Home and Disks test suites.
- 2026-02-07: Phase 2 complete. Added `SongLengthServiceFacade` + `SongLengthStoreBackend` with `InMemoryTextBackend`; centralized HVSC songlength loading/resolution lifecycle and observability; migrated play-page resolution to facade-backed APIs.
- 2026-02-07: Phase 3 complete. Added explicit HVSC archive pipeline state machine with guarded transitions and structured logs; strengthened recovery flows and added restart-recovery tests for interrupted/corrupt/failing ingestion scenarios.
- 2026-02-07: Phase 4 complete. Verification passed: `npm run test` (120 files, 705 tests), `npm run lint`, `npm run build`.
