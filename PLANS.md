# HVSC Production-Readiness Implementation Plan

## Current Pass - 2026-04-03 Follow-up Status Assessment

## Change Classification

- Classification: `DOC_ONLY`
- Goal: produce a source-backed follow-up status register for `docs/research/hvsc/production-readiness-audit-2026-04-03.md`, reconcile it with the implementation already landed in the worktree, and turn all non-closed issues into an executable remaining-work plan.
- Primary output: `docs/research/hvsc/production-readiness-status-2026-04-03-followup.md`

## Impact Map

- Docs:
  - `PLANS.md`
  - `WORKLOG.md`
  - `docs/research/hvsc/production-readiness-status-2026-04-03-followup.md`
- Comment/doc reality sync if needed:
  - `ios/App/App/HvscIngestionPlugin.swift`
- Evidence sources to inspect:
  - `docs/research/hvsc/production-readiness-audit-2026-04-03.md`
  - current `PLANS.md`
  - current `WORKLOG.md`
  - live source and tests under `src/lib/hvsc/**`, `src/lib/playlistRepository/**`, `src/pages/playFiles/**`, `android/app/src/test/**`, and referenced docs
- Platforms assessed:
  - Android
  - iOS
  - Web

## Phase A - Reconcile Live Evidence

- Scope:
  - extract every issue from `HVSC-AUD-001` through `HVSC-AUD-014`
  - compare the audit baseline with landed implementation, tests, and recorded validation history
  - identify stale statements that now contradict the live repo
- Exit criteria:
  - every issue has a live evidence file list and an initial state hypothesis
  - contradictions between the audit baseline and current reality are recorded in `WORKLOG.md`

## Phase B - Produce Follow-up Status Register

- Scope:
  - write the follow-up document with per-issue `DONE` / `PARTIAL` / `TODO` / `BLOCKED` status
  - keep each judgment tied to specific code, tests, docs, or recorded runtime evidence
  - distinguish clearly between meaningful progress and true closure
- Exit criteria:
  - the follow-up document contains all required sections in the requested order
  - status counts reconcile exactly with the per-issue register

## Phase C - Minimal Reality Sync

- Scope:
  - fix only clearly stale documentation or source comments that materially affect the follow-up status accuracy
  - avoid widening into feature work or fresh implementation
- Exit criteria:
  - any remaining parity/status statements cited by the follow-up document are accurate
  - `WORKLOG.md` records why each minimal sync was needed

## Phase D - Final Consistency Review

- Scope:
  - verify bucket counts, closure matrix, and remaining-work phases
  - ensure the report does not claim builds, tests, screenshots, or HIL proof that were not actually performed
- Exit criteria:
  - `PLANS.md`, `WORKLOG.md`, and the follow-up document all agree on the current readiness picture
  - the final user summary can state exactly which issues are closed and which remain open

## Current Status

- Phase A: completed
- Phase B: in progress
- Phase C: pending
- Phase D: pending

## Current Focus

- Finish the evidence-backed status register before touching any stale-reality syncs.
- Keep the closure bar strict: repository or diagnostics improvements do not close architecture, scale, or HIL-proof issues on their own.
- Record any contradiction between the original audit and current repo state in `WORKLOG.md` instead of silently rewriting the audit.

## Change Classification

- Classification: `DOC_PLUS_CODE`, `CODE_CHANGE`, `UI_CHANGE`
- Goal: converge the audited HVSC storage, playlist, ingest, and validation path toward production readiness without re-running the discovery pass.
- Audit baseline: `docs/research/hvsc/production-readiness-audit-2026-04-03.md`

## Impact Map

- Source:
  - `src/lib/playlistRepository/**`
  - `src/pages/playFiles/hooks/usePlaybackPersistence.ts`
  - `src/pages/playFiles/hooks/usePlaylistListItems.tsx`
  - `src/pages/PlayFilesPage.tsx`
  - `src/pages/playFiles/handlers/addFileSelections.ts`
  - `src/lib/hvsc/**`
  - `src/lib/sourceNavigation/**`
  - `ios/App/App/HvscIngestionPlugin.swift`
- Tests:
  - `tests/unit/lib/playlistRepository/**`
  - `tests/unit/playFiles/**`
  - `tests/unit/pages/playFiles/**`
  - Android JVM tests under `android/app/src/test/**` as needed
- Docs:
  - `PLANS.md`
  - `WORKLOG.md`
  - `docs/internals/ios-parity-matrix.md`
- Platforms:
  - Web
  - Android
  - iOS

## Phase 1 - Reconcile Audit Into Execution Slices

- Scope:
  - translate audited issue IDs into concrete implementation slices
  - preserve existing local worktree changes
  - keep `PLANS.md` and `WORKLOG.md` authoritative
- Issue coverage:
  - all implementation phases below are keyed to `HVSC-AUD-001/002/003/006/007/008/009/010/011/012/013/014`
- Exit criteria:
  - the plan reflects the live implementation pass rather than the completed research pass
  - dependencies between repository, persistence, UI, and ingest work are explicit

## Phase 2 - Playlist Storage And Query Foundation

- Scope:
  - replace the IndexedDB full-snapshot repository with incremental normalized records
  - keep playlist/session data out of full-rewrite hot paths
  - reduce page-level duplicate playlist rewrites where feasible
- Targeted issues:
  - `HVSC-AUD-002`
  - `HVSC-AUD-013`
  - `HVSC-AUD-014`
- Planned files:
  - `src/lib/playlistRepository/indexedDbRepository.ts`
  - `src/lib/playlistRepository/repository.ts`
  - `src/lib/playlistRepository/types.ts`
  - `src/pages/playFiles/hooks/usePlaybackPersistence.ts`
  - `src/pages/PlayFilesPage.tsx`
- Validation:
  - repository contract tests
  - playback persistence regression tests proving current-index changes do not rewrite the playlist
- Exit criteria:
  - IndexedDB writes are incremental instead of single-state rewrites
  - current-track/session updates persist separately from playlist rows
  - repository hydration can restore the active item without rematerializing on every session mutation

## Phase 3 - Playlist UX Scale Cleanup

- Scope:
  - remove avoidable O(n^2) row derivation and eager playlist-side scans
  - batch or bound large add flows where practical in this pass
- Targeted issues:
  - `HVSC-AUD-001`
  - `HVSC-AUD-011`
- Planned files:
  - `src/pages/playFiles/hooks/usePlaylistListItems.tsx`
  - `src/pages/playFiles/handlers/addFileSelections.ts`
  - `src/components/lists/SelectableActionList.tsx`
  - `src/pages/playFiles/components/PlaylistPanel.tsx`
- Validation:
  - existing list-item tests plus new regression coverage for index lookups and large-playlist behavior
- Exit criteria:
  - no per-row `findIndex(...)` over the full playlist
  - large add/derive paths are more bounded than the audited baseline

## Phase 4 - HVSC Ingest And Platform Path Fixes

- Scope:
  - implement the highest-leverage ingest durability and platform-path fixes feasible in one pass
  - close stale iOS parity comments/docs
- Targeted issues:
  - `HVSC-AUD-003`
  - `HVSC-AUD-006`
  - `HVSC-AUD-007`
  - `HVSC-AUD-009`
  - `HVSC-AUD-010`
  - `HVSC-AUD-012`
- Planned files:
  - `src/lib/hvsc/**`
  - `ios/App/App/HvscIngestionPlugin.swift`
  - `docs/internals/ios-parity-matrix.md`
- Validation:
  - targeted Vitest HVSC suites
  - platform-specific smoke tests where supported locally
- Exit criteria:
  - touched ingest/runtime paths have explicit failure semantics and updated docs
  - stale iOS parity claims are removed

## Phase 5 - Validation And Hardware Attempts

- Scope:
  - run the minimum honest validation for touched code
  - satisfy repository coverage obligations
  - retry Android/C64U hardware evidence collection
- Targeted issues:
  - `HVSC-AUD-004`
  - `HVSC-AUD-005`
  - `HVSC-AUD-008`
  - `HVSC-AUD-011`
- Required commands:
  - `npm run test`
  - `npm run test:coverage`
  - targeted Playwright/HVSC tests if UI behavior changes materially
  - `cd android && ./gradlew test`
  - `adb devices -l`
  - C64 Ultimate probes/playback attempts as environment allows
- Exit criteria:
  - final report distinguishes closed issues, partial closures, and external blockers
  - hardware attempts are evidenced even if blocked

## Current Status

- Phase 1: completed
- Phase 2: completed
- Phase 3: in progress
- Phase 4: partially completed
- Phase 5: completed

## Current Focus

- Reduce remaining playlist UX hot-path costs beyond the repository/session fixes already landed.
- Keep the HVSC ingest/platform findings honest: the Android JVM lane is green now, but full end-to-end HVSC download/ingest/browse proof on device is still incomplete.
- Push the remaining audit gaps toward query-windowed playlist browsing/search and stronger ingest durability semantics instead of legacy snapshot fallbacks.
- For all remaining hardware validation, use the adb-attached Pixel 4 and probe `u64` and `c64u` by hostname; if both answer over REST, prefer `u64`, otherwise use whichever reachable device responds.
- Leave the execution artifacts aligned with what was actually implemented and validated in this pass.

## Progress Notes

- Completed in this pass:
  - incremental IndexedDB persistence for tracks, playlist rows, playlist order, and sessions
  - separate repository session persistence so ordinary current-track changes stop rewriting the playlist dataset
  - removal of the audited O(n^2) playlist-row `findIndex(...)` lookup
  - Play-page query hook split so category-filter changes requery without resyncing the repository
  - Play-page playlist filtering now uses a bounded query window: the collapsed card stays preview-sized while the sheet lazily loads additional repository-backed pages on demand
  - large playlist-add flows now append in bounded batches for both recursive file scans and CommoServe archive-result imports
  - legacy localStorage playlist restore no longer scans unrelated device keys when hydrating the active playlist
  - non-native HVSC ingest now fails explicitly for unsupported full-archive runtime paths instead of silently presenting a production fallback
  - cached HVSC archive markers now carry expected size metadata and the runtime deletes marker/file pairs that no longer match the on-disk archive size
  - HVSC status summaries now retain ingestion IDs, archive names, stage context, and recovery hints for cancellations, restart recovery, and failure diagnostics
  - Android JVM unit tests now run with a Java 21 launcher, restoring a green local `./gradlew test` lane in this environment
  - stale iOS HVSC parity comments/docs corrected
- Validation completed:
  - `npm run build`
  - `npm run lint` with only pre-existing warnings from generated coverage artifacts
  - `npm run test`
  - `npm run test:coverage`
  - `node scripts/check-coverage-threshold.mjs coverage/coverage-final.json`
  - coverage gate satisfied: branch coverage `91.25%`, line coverage `94.74%`
  - `cd android && ./gradlew test`
  - `adb devices -l`
  - `npm run cap:build`
  - `cd android && ./gradlew installDebug`
  - `adb shell am start -W -n uk.gleissner.c64commander/.MainActivity`
  - `curl http://c64u/v1/info`
  - direct SID playback probe against `http://c64u/v1/runners:sidplay`
  - `curl http://u64/v1/info`
  - refreshed targeted Vitest coverage for playlist query windowing and HVSC cache-marker integrity
  - Android install and cold launch on attached Pixel 4
- Validation still blocked or incomplete:
  - no fresh end-to-end Pixel 4 proof yet for full HVSC download, extraction, ingest, browse, and large-playlist manipulation inside the app
  - no direct in-app Ultimate playback proof yet beyond the confirmed device API and direct runner endpoint probe
  - `u64` is currently the reachable preferred Ultimate target; `c64u` REST probing is currently failing

## Historical Note

- The prior `DOC_ONLY` research plan was completed and its output remains the audit baseline in `docs/research/hvsc/production-readiness-audit-2026-04-03.md`.
