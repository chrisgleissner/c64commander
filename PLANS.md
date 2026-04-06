# HVSC Playlist Convergence Plan

## Classification

- `CODE_CHANGE`
- `UI_CHANGE`

## Mission

Restore deterministic playlist correctness for HVSC imports and large playlists. The import workflow must not declare completion until playlist persistence is complete, repository reads reflect the full dataset, and the UI can immediately render the correct playlist state without waiting for background sync.

## P0 Failure Statement

Observed failure:

1. Import completes, playlist appears empty, then items materialize later.
2. `View all` appears only after delayed playlist materialization.

Validated root cause:

- `useQueryFilteredPlaylist` currently mirrors the full React playlist into the repository asynchronously on every playlist mutation.
- Large imports create a backlog of full-playlist rewrites.
- The hook suppresses repository-backed results until the async mirror finishes, so UI correctness lags behind the import completion signal.

## Non-negotiable Rules

- Lazy behavior is allowed only for rendering and paging.
- Lazy behavior is forbidden for persistence, correctness, completion semantics, and UI truth.
- `Import complete` must occur only after repository write completion and read-back validation.
- There must be zero real repository writes after the UI transitions to ready for a given snapshot.

## Execution Order

### Phase 1. Ingest to Playlist Consistency

- [x] Instrument scan start and end, batch creation, batch append, repository commit start and end, repository validation, and UI readiness transition.
- [x] Introduce an explicit playlist import state machine with `SCANNING`, `INGESTING`, `COMMITTING`, and `READY`.
- [x] Replace eventual repository mirroring with an explicit commit barrier for playlist imports.
- [x] Add repository read-back validation so expected item count must equal committed item count before success.
- [x] Fail loudly and keep the workflow non-ready if repository validation fails.

### Phase 2. Restore `View all` Availability

- [x] Decouple `View all` visibility from lazy rendered rows.
- [x] Base `View all` availability on authoritative item counts instead of overflow-only preview state.
- [x] Apply the fix to both Play page and Disks page shared list surfaces.

### Phase 3. Rebuild `View all` Bottom Sheet for Scale

- [x] Keep eager correctness metadata only: count, ordering, section anchors.
- [x] Keep rendering windowed with virtualization.
- [x] Keep repository fetch incremental with paging for large lists.
- [x] Add fast jump affordances for large result sets.
- [x] Ensure first viewport opens immediately without blocking on full list hydration.

### Phase 4. Harden Playlist Hydration and Query Model

- [x] Audit and fix `playlistRepository`, `usePlaybackPersistence`, `useQueryFilteredPlaylist`, and `usePlaylistListItems` integration.
- [x] Remove stale cache and hidden async rebuild dependencies from playlist correctness.
- [x] Introduce explicit repository invalidation and ready revision tracking after each committed snapshot.
- [x] Guarantee deterministic read-after-write behavior for repository-backed queries.

### Phase 5. Regression and Stress Coverage

- [x] Add a consistency test for 10K+ imported items with immediate repository count assertion.
- [x] Add a regression test proving the UI does not report completion before repository commit resolves.
- [x] Add a UI test proving playlist visibility and `View all` availability immediately after import readiness.
- [x] Add a large-playlist stress test covering load more, filtering, and deletion/update behavior at 50K+ scale.
- [ ] Hold changed-code branch coverage above 91% during `npm run test:coverage`.

### Phase 6. Performance Re-measurement

- [x] Re-measure S6 add to playlist.
- [x] Re-measure S7 playlist render.
- [x] Re-measure S8 to S10 playlist filtering.
- [x] Update target status for T2 ingest, T3 browse, and T4 filter.
- [x] Record evidence and blockers in `WORKLOG.md`.

## Current Evidence

- Focused regression validation passed: 95 targeted tests, 0 failed.
- Repo-wide build passed: `npm run build`.
- Repo-wide lint is still blocked by pre-existing Prettier failures in untouched files: `.opencode/package.json`, `src/lib/hvsc/hvscDownload.ts`, `src/lib/playback/playbackRouter.ts`, `src/lib/smoke/smokeMode.ts`, `src/pages/playFiles/hooks/useHvscLibrary.ts`, `tests/benchmarks/hvscHotPaths.bench.ts`, `tests/unit/ci/androidMaestroWorkflowContracts.test.ts`, `tests/unit/ci/playFilesHvscHookContracts.test.ts`, `tests/unit/hvsc/hvscService.test.ts`, `tests/unit/lib/hvsc/hvscService.test.ts`, `tests/unit/scripts/webPerfArtifacts.test.ts`, `tests/unit/smoke/smokeMode.test.ts`.
- Repo-wide `npm run test:coverage` is still blocked by unrelated existing failures in `tests/unit/maestro/launchAndWaitFlow.test.ts` and `tests/unit/lib/smoke/smokeMode.test.ts`.
- Focused coverage for the touched playlist regression surface passed with 95 tests. The new shared repository sync helper reached 37/49 branch coverage and the touched runtime surfaces are covered by dedicated regression and stress tests, but repo tooling does not currently provide diff-only branch coverage for the exact changed lines.
- Fresh web fixture perf artifact: `ci-artifacts/hvsc-performance/web/web-full-quick.json`
  - S6 add to playlist: `1613.72 ms` wall clock, `playlist:add-batch` p95 `17.2 ms`, `playlist:repo-sync` p95 `21.1 ms`
  - S7 render playlist: `6.75 ms` wall clock
  - S8 filter high match: `545.53 ms` wall clock, `playlist:filter` p95 `17.2 ms`
  - S9 filter zero match: `544.06 ms` wall clock, `playlist:filter` p95 `16.6 ms`
  - S10 filter low match: `550.23 ms` wall clock, `playlist:filter` p95 `13.9 ms`
  - Target evidence from the same run: T2 ingest `228.4 ms` pass, T3 browse `334.64 ms` pass, T4 filter `550.23 ms` pass

## Success Criteria

- [x] Playlist state is correct immediately after import completion.
- [x] UI correctness no longer depends on delayed background repository work.
- [x] `View all` is always available for non-empty authoritative lists.
- [x] Large imports remain correct and measurable at 50K+ items.
- [x] Performance targets are either measured with evidence or explicitly blocked with current bottleneck details.
