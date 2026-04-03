# HVSC Production-Readiness Follow-up Status

Date: 2026-04-03
Classification: `DOC_ONLY`
Companion to: `docs/research/hvsc/production-readiness-audit-2026-04-03.md`

## 1. Executive Summary

Overall judgment: the HVSC workflow is materially stronger than in the 2026-04-03 audit, but it is still not honestly production-ready for the stated 60k-song / 100k-playlist / real-device acceptance envelope.

Issue counts:

- `DONE`: 2
- `PARTIAL`: 10
- `TODO`: 2
- `BLOCKED`: 0

Most important closures since the audit:

- The Android JVM HVSC regression lane is no longer broken under the active toolchain. `android/app/build.gradle` now forces JVM unit tests onto Java 21, and `WORKLOG.md` records successful reruns of `HvscIngestionPluginTest` and `./gradlew test`.
- iOS HVSC parity documentation/comments are now aligned with reality: `docs/internals/ios-parity-matrix.md` reflects the native plugin, and `ios/App/App/HvscIngestionPlugin.swift` no longer claims `ingestHvsc` is future-only.

Most important remaining blockers:

- The runtime still does not use one authoritative DB-backed / FTS-backed query engine across HVSC browse/search and large playlists.
- The Play path still keeps the whole playlist in React state, hydrates the whole repository playlist, and recursive HVSC/local folder selection still accumulates full file lists in memory.
- The required app-first hardware proof is still missing: no archived Pixel 4 HVSC download/cache -> browse -> add -> play run with real streamed-audio evidence.
- iOS still uses a memory-heavy native ingest path and still has no HVSC-specific XCTest coverage.
- UI/device scale gates still do not prove 10k/50k/100k responsiveness or memory behavior.

Production-readiness verdict: no. The current repo is closer to convergence, but it is not yet production-ready by the audit’s own closure criteria.

## 2. Evidence Base Considered

- Live code changes landed after the audit in:
  - `src/lib/playlistRepository/**`
  - `src/pages/playFiles/**`
  - `src/components/lists/SelectableActionList.tsx`
  - `src/lib/hvsc/**`
  - `android/app/build.gradle`
  - `ios/App/App/HvscIngestionPlugin.swift`
  - `docs/internals/ios-parity-matrix.md`
- Updated unit and hook tests, including:
  - `tests/unit/lib/playlistRepository/indexedDbRepository.test.ts`
  - `tests/unit/playFiles/usePlaybackPersistence.repositorySession.test.tsx`
  - `tests/unit/playFiles/useQueryFilteredPlaylist.test.tsx`
  - `tests/unit/pages/playFiles/handlers/addFileSelectionsBatching.test.ts`
  - `tests/unit/hvsc/hvscDownload.test.ts`
  - `tests/unit/hvsc/hvscStatusStore.test.ts`
  - `tests/unit/lib/hvsc/hvscIngestionRuntimeSupport.test.ts`
- Current planning/execution artifacts:
  - `PLANS.md`
  - `WORKLOG.md`
- Recorded build and validation evidence already captured in `WORKLOG.md`, including:
  - `npm run build`
  - `npm run lint`
  - `npm run test`
  - `npm run test:coverage`
  - `cd android && ./gradlew test`
  - `npm run cap:build`
  - `./gradlew installDebug`
  - `adb shell am start -W -n uk.gleissner.c64commander/.MainActivity`
  - `adb devices -l`
  - REST probes against `u64` and `c64u`
  - direct SID playback probe against `/v1/runners:sidplay`
- Current hardware-proof requirement docs:
  - `docs/testing/physical-device-matrix.md`
  - `docs/plans/hvsc/automation-coverage-map.md`

## 3. Per-Issue Status Register

## HVSC-AUD-001 - Playlist rendering and recursive selection are still eager and non-scalable

- Previous audit severity: Critical
- Current status: `PARTIAL`
- Confidence: High

### What changed since the audit

The Play page no longer derives its filtered playlist by forcing a full repository query equal to `playlist.length`, the audited `findIndex(...)` hot path is gone, the inline playlist card is preview-windowed, the view-all sheet loads additional pages on demand, and large add flows now flush appended playlist items in batches.

### Current evidence

- `src/pages/PlayFilesPage.tsx:1228-1284` now routes filtering through `useQueryFilteredPlaylist`.
- `src/pages/playFiles/hooks/useQueryFilteredPlaylist.ts:64-205` uses repository queries with a preview limit and incremental `loadMoreViewAllResults()`.
- `src/pages/playFiles/hooks/usePlaylistListItems.tsx:56-77` precomputes `playlistIndexById` instead of per-row `findIndex(...)`.
- `src/components/lists/SelectableActionList.tsx:409-427` bounds the inline card to `maxVisible`.
- `src/components/lists/SelectableActionList.tsx:573-594` uses `Virtuoso` plus `endReached` for the view-all sheet.
- `src/pages/playFiles/handlers/addFileSelections.ts:116-118`, `218-229`, `161-195` adds 250-item append batching, but `collectRecursive()` still accumulates all discovered files in `files`.
- `tests/unit/playFiles/useQueryFilteredPlaylist.test.tsx:164-279` locks in bounded re-query and lazy view-all growth.
- `tests/unit/pages/playFiles/handlers/addFileSelectionsBatching.test.ts:88-108` locks in bounded append batches.

### What is still missing

- `src/pages/playFiles/handlers/addFileSelections.ts:164-195` still retains the full recursive file list in memory before returning.
- `src/pages/PlayFilesPage.tsx` and `src/pages/playFiles/hooks/usePlaybackPersistence.ts` still keep the full playlist in React memory.
- No recorded 10k/50k/100k UI-scale latency or memory evidence exists.
- No recorded Pixel 4 scroll/filter responsiveness evidence exists.

### Closure criteria

- Recursive source selection streams or checkpoints discovered files instead of collecting the full file set first.
- The Play page holds only the active window and active-item metadata in hot-path UI state.
- 10k/50k/100k playlist rendering, filter, and add flows have explicit latency/memory gates in tests and device evidence.

## HVSC-AUD-002 - Runtime query engine does not use the documented DB-backed/FTS-backed design

- Previous audit severity: Critical
- Current status: `PARTIAL`
- Confidence: High

### What changed since the audit

Playlist querying moved closer to an actual repository-backed windowed path, and IndexedDB storage is now normalized instead of a single persisted snapshot blob.

### Current evidence

- `src/lib/playlistRepository/indexedDbRepository.ts:376-489` persists playlist items, order records, and sessions separately and queries in chunks.
- `src/pages/playFiles/hooks/useQueryFilteredPlaylist.ts:64-205` now queries the repository for filtered playlist windows.
- `src/lib/hvsc/hvscService.ts:151-179` still relies on TS-side `hvscIndex` readiness and snapshot rebuilds.
- `src/lib/hvsc/hvscMediaIndex.ts:96-175` still uses JSON/filesystem snapshots plus in-memory browse snapshots.
- `src/lib/playlistRepository/queryIndex.ts:23-173` still defines a persisted JS query-index model for the localStorage path.
- `src/lib/playlistRepository/types.ts:65-84` still exposes offset/limit pagination only.
- `docs/architecture.md` and `docs/db.md` still describe a DB-backed / FTS-backed contract that the operational runtime does not yet satisfy.

### What is still missing

- HVSC browse/search still does not query the native SQLite index written during ingest.
- No platform exposes one authoritative search contract with equivalent semantics across Android, iOS, and Web.
- No FTS-backed implementation exists for title/path/author/released facets.
- Cursor/keyset paging is still absent.

### Closure criteria

- HVSC browse/filter/search and large-playlist query paths run against authoritative indexed storage on every platform.
- The runtime either matches the documented DB/FTS design or the docs are explicitly revised to a proven replacement.
- Search semantics and paging contract are shared and tested across platform adapters.

## HVSC-AUD-003 - Ingestion is not end-to-end transactional or resumable

- Previous audit severity: High
- Current status: `PARTIAL`
- Confidence: High

### What changed since the audit

The runtime now records richer interruption/failure context, marks stale restart recovery explicitly, and keeps cancellation/recovery hints in persisted HVSC status summaries instead of leaving opaque state behind.

### Current evidence

- `src/lib/hvsc/hvscIngestionRuntimeSupport.ts:121-212` records cancellation and stale-restart recovery with explicit failure summaries and retry hints.
- `src/lib/hvsc/hvscStatusStore.ts:24-257` now persists ingestion IDs, archive names, last stages, failure categories, and recovery hints.
- `tests/unit/hvsc/hvscStatusStore.test.ts:52-202` and `tests/unit/lib/hvsc/hvscIngestionRuntimeSupport.test.ts:83-171` lock in the new summary/recovery behavior.
- `src/lib/hvsc/hvscIngestionRuntime.ts:310-315` still resets the baseline library root before full ingest completion.
- `android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt:705-721` still deletes the library and clears metadata at ingest start when `resetLibrary` is set.
- `ios/App/App/HvscIngestionPlugin.swift:155-165` still clears the library before opening the archive.

### What is still missing

- No staging root or atomic promotion exists.
- No resumable ingest journal/checkpoint model exists.
- Crash/restart does not resume; it merely surfaces a clearer failure state.

### Closure criteria

- Baseline/update ingest runs build into staged data and promote atomically only after validation.
- Interrupted ingests cannot partially replace the active library.
- Deterministic restart/resume or rollback semantics are implemented and regression-tested.

## HVSC-AUD-004 - Real Android acceptance remains unproven because no ADB-visible Pixel 4 was available

- Previous audit severity: High
- Current status: `PARTIAL`
- Confidence: High

### What changed since the audit

The original environment blocker is gone. `WORKLOG.md` now records a visible Pixel 4, a successful Android build/install/cold-launch, and on-device network activity.

### Current evidence

- `WORKLOG.md` entry `2026-04-03T18:24:27Z` records:
  - `adb devices -l` showing the attached Pixel 4
  - `npm run cap:build`
  - `./gradlew installDebug`
  - `adb shell am start -W -n uk.gleissner.c64commander/.MainActivity`
  - app-originated `http://c64u/v1/info` traffic
- `WORKLOG.md` entry `2026-04-03T19:15:34Z` records that `u64` is currently the preferred reachable hardware target and `c64u` currently fails REST probing.
- `docs/testing/physical-device-matrix.md:9-21` still requires a full app-first HVSC ingest/playback artifact set, not just install/launch proof.

### What is still missing

- No archived Pixel 4 HVSC download/cache -> ingest -> browse -> add -> play artifact set exists.
- No log bundle or action timeline tied to a full HVSC HIL run exists.

### Closure criteria

- `adb devices -l` shows the Pixel 4 as `device`.
- A full Pixel 4 HVSC HIL run is archived with screenshots, timeline evidence, and device logs covering ingest through playback.

## HVSC-AUD-005 - Real app-first playback with streamed-audio proof on the C64 Ultimate is still missing

- Previous audit severity: High
- Current status: `TODO`
- Confidence: Medium

### What changed since the audit

Hardware reachability improved: the app now launches on the Pixel 4, `u64` is reachable, and direct SID playback probes against the Ultimate endpoint succeeded from the host.

### Current evidence

- `WORKLOG.md` entry `2026-04-03T18:24:27Z` records direct `curl ... /v1/runners:sidplay` success against the real device.
- `WORKLOG.md` entry `2026-04-03T19:15:34Z` records the refreshed hardware-target decision (`u64` reachable, `c64u` failing).
- `docs/plans/hvsc/automation-coverage-map.md:47-72` still states the real app-first HVSC playback and streamed-audio proof remain unexecuted.
- `docs/testing/physical-device-matrix.md:19-21` still requires `c64scope` audio evidence with `packetCount > 0` and `RMS >= 0.005`.

### What is still missing

- No archived app-first HVSC track-selection -> playlist -> playback -> audio-proof run exists.
- No `c64scope` packet/RMS artifact exists for the selected HVSC track.

### Closure criteria

- One archived HIL run proves the selected HVSC track in the app is the track streamed by the Ultimate.
- The artifact set includes UI evidence, timeline/log evidence, and non-silent audio proof.

## HVSC-AUD-006 - iOS HVSC ingestion path is memory-heavy and lacks HVSC-specific native test coverage

- Previous audit severity: High
- Current status: `TODO`
- Confidence: High

### What changed since the audit

Only parity wording changed. The iOS ingest implementation itself still reads the full archive into memory and still has no HVSC-specific XCTest coverage.

### Current evidence

- `ios/App/App/HvscIngestionPlugin.swift:163-165` still loads the full archive with `Data(contentsOf:)` and then opens it with `SevenZipContainer.open(container:)`.
- `ios/App/App/HvscIngestionPlugin.swift:249-265` still batch-flushes metadata only after rows have already been accumulated in memory.
- `docs/internals/ios-parity-matrix.md:18-25`, `38-44` still records zero XCTest classes and an HVSC parity gap.
- No HVSC-specific iOS test files were added in this pass.

### What is still missing

- Streaming/chunked native extraction on iOS.
- HVSC-specific XCTest coverage for chunk reads, cancellation, corrupt archives, and real-sized fixtures.
- Any iOS memory-budget evidence for target-size archives.

### Closure criteria

- The iOS native ingest path no longer requires a full-archive in-memory load for target-sized HVSC archives.
- HVSC-specific XCTest coverage exists and passes.
- iOS stress evidence demonstrates acceptable memory behavior at the target envelope.

## HVSC-AUD-007 - Web and non-native paths still depend on full archive buffers and permissive fallback

- Previous audit severity: High
- Current status: `PARTIAL`
- Confidence: High

### What changed since the audit

The runtime no longer silently treats the non-native path as a production-capable fallback. Unsupported large non-native archive flows now fail early with explicit messaging, and the override is clearly positioned as test-only.

### Current evidence

- `src/lib/hvsc/hvscIngestionRuntime.ts:109-130` now throws `NON_NATIVE_HVSC_INGESTION_UNSUPPORTED_MESSAGE` unless the explicit override is enabled.
- `src/lib/hvsc/hvscDownload.ts:357-359`, `478-482` fails early when non-native content length exceeds the bridge budget.
- `src/lib/hvsc/hvscFilesystem.ts:23`, `91-106` still guards large file reads at `5 MiB`.
- `tests/unit/hvsc/hvscNonNativeGuard.test.ts:5-12` locks in the explicit safety contract.
- `tests/unit/hvsc/hvscDownload.test.ts:706-713` covers the early size-guard failure.

### What is still missing

- The Web path still has no proven large-archive strategy beyond refusal/guardrails.
- Non-native extraction still depends on full archive buffers for supported sizes.
- No explicit supported-capability matrix exists for Web large-archive ingest under the target memory/CPU envelope.

### Closure criteria

- Each platform has an explicit, tested large-archive support contract.
- Web either gains a proven large-archive strategy or explicitly narrows supported HVSC behavior with enforced UX and docs.
- No production path silently falls back to unsafe large-buffer behavior.

## HVSC-AUD-008 - Android plugin regression suite is currently broken under the active toolchain

- Previous audit severity: Medium
- Current status: `DONE`
- Confidence: Medium

### What changed since the audit

The Android build now pins JVM unit tests to a supported Java 21 launcher while leaving Android compilation on Java 17, and the previously failing HVSC plugin test lane was rerun successfully.

### Current evidence

- `android/app/build.gradle:309-311` sets `javaLauncher` for `Test` tasks to Java 21.
- `android/app/src/test/java/uk/gleissner/c64commander/HvscIngestionPluginTest.kt:37-280` remains the active regression suite.
- `WORKLOG.md` entry `2026-04-03T19:02:35Z` records successful execution of:
  - `cd android && ./gradlew :app:testDebugUnitTest --tests uk.gleissner.c64commander.HvscIngestionPluginTest`
  - `cd android && ./gradlew test`

### What is still missing

Nothing material remains.

### Closure criteria

- The HVSC plugin suite stays green in the supported local/CI JDK configuration.
- If the supported JDK changes again, the test launcher contract must be updated deliberately rather than failing implicitly.

## HVSC-AUD-009 - iOS parity documentation and comments are stale and can mislead execution

- Previous audit severity: Medium
- Current status: `DONE`
- Confidence: High

### What changed since the audit

The parity matrix was updated to acknowledge the native iOS HVSC plugin, the plugin’s top-level comment was corrected earlier in the implementation pass, and this follow-up pass removed the remaining stale method-level claim that `ingestHvsc` was not on the active iOS runtime path.

### Current evidence

- `docs/internals/ios-parity-matrix.md:18-25` now describes the HVSC module as `iOS native plugin + TS runtime`.
- `ios/App/App/HvscIngestionPlugin.swift:16-29` states the native plugin is on the active iOS production path.
- `ios/App/App/HvscIngestionPlugin.swift:118-122` now says the remaining gap is validation/memory scaling, not runtime reachability.

### What is still missing

Nothing material remains.

### Closure criteria

- Internal docs and source comments stay aligned with the actual iOS HVSC runtime path.
- Future runtime-gating changes must update both the docs and the code comments in the same slice.

## HVSC-AUD-010 - Download integrity and recovery are weaker than a production archive pipeline needs

- Previous audit severity: Medium
- Current status: `PARTIAL`
- Confidence: Medium

### What changed since the audit

Cached archive validation is stricter than before: cache markers now carry expected size metadata, stale marker/file pairs are deleted when the on-disk file no longer matches, and recovery hints are more explicit.

### Current evidence

- `src/lib/hvsc/hvscDownload.ts:281-322` validates marker/file size agreement and deletes stale cache pairs.
- `tests/unit/hvsc/hvscDownload.test.ts:631-713` covers expected-size metadata, size mismatch failures, and early oversized non-native failures.
- `src/lib/hvsc/hvscStatusStore.ts:113-124` and `src/lib/hvsc/hvscIngestionRuntimeSupport.ts:81-112` now surface clearer re-download guidance.

### What is still missing

- No checksum/signature validation exists.
- No resumable transfer exists.
- Recovery is still “delete and retry” rather than true resume.

### Closure criteria

- The archive integrity policy is explicit, enforced, and tested.
- Corrupted or partial archives are detected before ingest.
- Download recovery is either resumable or explicitly bounded and documented with tested UX.

## HVSC-AUD-011 - Scale/performance coverage is missing at the UI and device layers

- Previous audit severity: Medium
- Current status: `PARTIAL`
- Confidence: Medium

### What changed since the audit

Coverage now exists above the bare repository layer for query-windowing and add batching, so this is no longer purely a storage-only proof story.

### Current evidence

- `tests/unit/playFiles/useQueryFilteredPlaylist.test.tsx:164-279` proves re-query and lazy view-all growth without playlist-row rewrites.
- `tests/unit/pages/playFiles/handlers/addFileSelectionsBatching.test.ts:88-108` proves bounded add batching.
- `tests/unit/lib/playlistRepository/indexedDbRepository.test.ts:491-530` still provides only repository-scale, not UI-scale, 100k evidence.
- `docs/testing/physical-device-matrix.md:16-39` still requires physical-device proof for HVSC ingest/playback, but not yet with recorded perf budgets.

### What is still missing

- No React/UI tests at 10k/50k/100k with latency or memory assertions.
- No Pixel 4 perf sampling or frame/latency evidence exists for add/filter/scroll actions.
- No CI/HIL gate exists for UI-scale performance budgets.

### Closure criteria

- Synthetic UI-scale tests exist above the repository layer.
- Device-scale perf sampling exists for the critical Play/HVSC actions.
- Performance budgets are enforced in CI/HIL instead of left to manual spot checks.

## HVSC-AUD-012 - Observability is useful but still insufficient for production support at target scale

- Previous audit severity: Low
- Current status: `PARTIAL`
- Confidence: Medium

### What changed since the audit

HVSC status summaries are materially richer. They now persist ingestion IDs, archive names, stage context, failure categories, and recovery hints across cancellation and stale-restart recovery.

### Current evidence

- `src/lib/hvsc/hvscStatusStore.ts:24-257` adds ingestion IDs, archive names, stage names, failure categories, and recovery hints.
- `src/lib/hvsc/hvscIngestionRuntimeSupport.ts:121-212` records cancellation and restart-recovery summaries with actionable hints.
- `tests/unit/hvsc/hvscStatusStore.test.ts:52-202` and `tests/unit/lib/hvsc/hvscIngestionRuntimeSupport.test.ts:103-171` lock in the new persisted summary behavior.

### What is still missing

- No query-window latency metrics exist.
- No render-latency metrics exist.
- No playback-correlation artifact links the selected app track to the device playback request and resulting audio proof.

### Closure criteria

- Diagnostics can distinguish download, extraction, ingest, query, render, and playback failures from persisted artifacts alone.
- Query/render/playback correlation IDs and timing data exist and are tested.
- HIL artifacts include enough structured telemetry to debug a failed playback run without re-running it.

## HVSC-AUD-013 - Playlist persistence and hydration still rewrite the full dataset on ordinary state changes

- Previous audit severity: High
- Current status: `PARTIAL`
- Confidence: High

### What changed since the audit

Playlist row persistence and session persistence were split. Ordinary current-track and query changes now persist via `saveSession(...)` instead of rewriting playlist rows, and the legacy localStorage restore path no longer scans unrelated device keys.

### Current evidence

- `src/pages/playFiles/hooks/usePlaybackPersistence.ts:438-496` persists playlist rows only on playlist changes.
- `src/pages/playFiles/hooks/usePlaybackPersistence.ts:498-534` persists session state separately.
- `src/pages/playFiles/hooks/usePlaybackPersistence.ts:313-343` narrows legacy localStorage candidate keys.
- `tests/unit/playFiles/usePlaybackPersistence.repositorySession.test.tsx:143-219` proves current-index and active-query changes do not rewrite playlist rows and that repository session state restores `activeQuery`.

### What is still missing

- `src/pages/playFiles/hooks/usePlaybackPersistence.ts:237-288` still hydrates the full repository playlist and all referenced tracks.
- `src/pages/playFiles/hooks/usePlaybackPersistence.ts:442-484` still serializes the whole playlist blob when it is under the legacy budget threshold.
- The Play page still holds the entire playlist in React state.

### Closure criteria

- Current-track/query/session mutations never serialize or rewrite full playlist rows.
- Startup and resume hydrate only the initial window plus active-item metadata.
- Legacy blob persistence is no longer part of the production large-playlist path.

## HVSC-AUD-014 - Playlist repositories are persisted JS snapshots with in-memory trigram indexes, not low-RAM mobile query stores

- Previous audit severity: High
- Current status: `PARTIAL`
- Confidence: High

### What changed since the audit

The IndexedDB repository is no longer a single full-state blob. Tracks, playlist items, order records, and sessions are now written as separate keys, and query execution no longer depends on a persisted trigram index in IndexedDB.

### Current evidence

- `src/lib/playlistRepository/indexedDbRepository.ts:23-47`, `255-287`, `376-489` shows schema migration to normalized records plus chunked query execution.
- `tests/unit/lib/playlistRepository/indexedDbRepository.test.ts:145-201`, `491-530` covers deterministic query behavior and a 100k-window repository test.
- `src/lib/playlistRepository/localStorageRepository.ts:21-28`, `79-112`, `164-222` still persists a full JS snapshot plus `queryIndexesByPlaylistId`.
- `src/lib/playlistRepository/queryIndex.ts:23-173` still defines trigram-based in-memory query indexes and offset-based scans.
- `src/lib/playlistRepository/types.ts:65-84` still exposes offset pagination only.

### What is still missing

- The Web/localStorage fallback still uses persisted JS snapshots and trigram indexes.
- No cursor/keyset paging contract exists.
- Search/sort still runs in JS logic rather than DB/FTS-backed indexes.
- Large-playlist capability gating is still implicit rather than explicit per environment.

### Closure criteria

- All production-capable repositories use indexed storage primitives rather than persisted JS query indexes.
- Paging uses stable cursor/keyset semantics for deep windows.
- Unsupported large-playlist environments are explicitly rejected with clear UX.

## 4. Consolidated Closure Matrix

| Issue ID | Title | Status | Severity | Primary remaining gap | Primary owner area |
| --- | --- | --- | --- | --- | --- |
| HVSC-AUD-001 | Playlist rendering and recursive selection are still eager and non-scalable | `PARTIAL` | Critical | Recursive selection and full-playlist React state still materialize too much data | Play page UI / source selection |
| HVSC-AUD-002 | Runtime query engine does not use the documented DB-backed/FTS-backed design | `PARTIAL` | Critical | HVSC browse/search still runs on TS snapshots, not authoritative DB/FTS queries | HVSC query architecture |
| HVSC-AUD-003 | Ingestion is not end-to-end transactional or resumable | `PARTIAL` | High | No staged/promotion-based ingest or resumable journal | HVSC ingest runtime + native plugins |
| HVSC-AUD-004 | Real Android acceptance remains unproven because no ADB-visible Pixel 4 was available | `PARTIAL` | High | Pixel 4 is available again, but the required full HVSC HIL artifact set is still missing | Android HIL |
| HVSC-AUD-005 | Real app-first playback with streamed-audio proof on the C64 Ultimate is still missing | `TODO` | High | No archived app-first audio-proof run | Playback HIL / c64scope |
| HVSC-AUD-006 | iOS HVSC ingestion path is memory-heavy and lacks HVSC-specific native test coverage | `TODO` | High | Full-archive in-memory ingest and zero HVSC XCTest coverage | iOS native HVSC |
| HVSC-AUD-007 | Web and non-native paths still depend on full archive buffers and permissive fallback | `PARTIAL` | High | Unsafe fallback is now explicit, but Web large-archive support is still unproven | Web/non-native ingest |
| HVSC-AUD-008 | Android plugin regression suite is currently broken under the active toolchain | `DONE` | Medium | None | Android build/tooling |
| HVSC-AUD-009 | iOS parity documentation and comments are stale and can mislead execution | `DONE` | Medium | None | iOS docs/comments |
| HVSC-AUD-010 | Download integrity and recovery are weaker than a production archive pipeline needs | `PARTIAL` | Medium | Marker validation improved, but checksum/resume policy is still missing | HVSC download pipeline |
| HVSC-AUD-011 | Scale/performance coverage is missing at the UI and device layers | `PARTIAL` | Medium | No UI/device-scale perf gates yet | Tests / device perf |
| HVSC-AUD-012 | Observability is useful but still insufficient for production support at target scale | `PARTIAL` | Low | Diagnostics still do not correlate query/render/playback timing end to end | Diagnostics / observability |
| HVSC-AUD-013 | Playlist persistence and hydration still rewrite the full dataset on ordinary state changes | `PARTIAL` | High | Session rewrites are fixed, but hydration and legacy blob persistence still materialize the whole playlist | Playback persistence |
| HVSC-AUD-014 | Playlist repositories are persisted JS snapshots with in-memory trigram indexes, not low-RAM mobile query stores | `PARTIAL` | High | IndexedDB improved, but localStorage/queryIndex/cursor design is still not production-grade | Playlist repository |

## 5. Remaining Work Plan

### Phase 1 - Authoritative Query And Hydration Convergence

Purpose:
replace the remaining snapshot-style playlist/HVSC query path with one authoritative indexed query contract and stop full-playlist hydration in the hot path.

Issue IDs covered:

- `HVSC-AUD-002`
- `HVSC-AUD-013`
- `HVSC-AUD-014`
- `HVSC-AUD-001`

Code areas expected to change:

- `src/lib/hvsc/hvscService.ts`
- `src/lib/hvsc/hvscMediaIndex.ts`
- `src/lib/playlistRepository/**`
- `src/pages/playFiles/hooks/usePlaybackPersistence.ts`
- `src/pages/playFiles/hooks/useQueryFilteredPlaylist.ts`
- `src/pages/PlayFilesPage.tsx`

Validation required:

- shared query contract tests across repository/HVSC adapters
- deep-window tests at 10k/50k/100k
- regressions proving current-index/query changes never rewrite playlist rows
- hydration tests proving only the initial window plus active item are loaded on startup

Exit criteria:

- no production browse/filter path depends on TS snapshot rebuilds as the primary source
- playlist startup/resume hydrates only the needed query window plus active item
- repository/query contract supports stable deep paging without full-array scans

Dependencies and sequencing constraints:

- This phase should go first because it unlocks honest UI-scale and device-scale validation.
- Do not start new HIL proof work before the runtime query/hydration contract is stable enough to avoid false positives.

### Phase 2 - UI Scale And Selection Streaming

Purpose:
remove the remaining eager list/selection materialization and add UI/device scale gates above the repository layer.

Issue IDs covered:

- `HVSC-AUD-001`
- `HVSC-AUD-011`

Code areas expected to change:

- `src/pages/playFiles/handlers/addFileSelections.ts`
- `src/lib/sourceNavigation/hvscSourceAdapter.ts`
- `src/pages/playFiles/hooks/usePlaylistListItems.tsx`
- `src/components/lists/SelectableActionList.tsx`
- `tests/unit/pages/playFiles/**`
- `tests/unit/components/lists/**`

Validation required:

- synthetic recursive add tests with tens of thousands of entries
- UI list/window tests at 10k/50k/100k
- Pixel 4 perf sampling for add/filter/scroll actions

Exit criteria:

- recursive source selection no longer accumulates the full discovered file set before append
- inline and view-all list paths stay within defined latency/memory budgets
- scale gates exist above the repository layer

Dependencies and sequencing constraints:

- Depends on Phase 1’s query/hydration contract to avoid duplicating old full-array behavior behind a new UI shell.

### Phase 3 - Ingest Durability, Web Contract, And iOS Native Hardening

Purpose:
make ingest semantics transactional enough for recovery, formalize the non-native/Web support contract, and close the iOS native-path gap.

Issue IDs covered:

- `HVSC-AUD-003`
- `HVSC-AUD-006`
- `HVSC-AUD-007`
- `HVSC-AUD-010`
- `HVSC-AUD-012`

Code areas expected to change:

- `src/lib/hvsc/hvscIngestionRuntime.ts`
- `src/lib/hvsc/hvscDownload.ts`
- `src/lib/hvsc/hvscFilesystem.ts`
- `src/lib/hvsc/hvscStatusStore.ts`
- `src/lib/hvsc/hvscIngestionRuntimeSupport.ts`
- `android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt`
- `ios/App/App/HvscIngestionPlugin.swift`
- iOS native test target(s)

Validation required:

- interruption/restart/rollback tests
- archive integrity tests for corrupt cache and recovery
- large-archive capability tests for Web/non-native paths
- HVSC-specific iOS native tests
- diagnostics payload tests for richer per-run observability

Exit criteria:

- partial ingests cannot replace the active library state
- Web/non-native support limits are explicit, enforced, and documented
- iOS has repeatable HVSC native test coverage and a non-pathological memory strategy

Dependencies and sequencing constraints:

- Phases 1 and 2 can proceed first, but Phase 3 must complete before any final production-ready claim.
- If Web support cannot be brought to the target envelope, the product contract must narrow scope explicitly instead of leaving an implied production promise.

### Phase 4 - Hardware Proof And Release Closure

Purpose:
collect the missing real-device proof and close the remaining acceptance-only gaps.

Issue IDs covered:

- `HVSC-AUD-004`
- `HVSC-AUD-005`
- `HVSC-AUD-011`
- `HVSC-AUD-012`

Code areas expected to change:

- `docs/plans/hvsc/artifacts/**`
- HIL scripts and supporting automation only as needed
- documentation under `docs/testing/**` if artifact expectations change

Validation required:

- app-first Pixel 4 HVSC download/cache -> ingest -> browse -> add -> play run
- `c64scope` packet/RMS proof
- archived screenshots, action timeline, logcat, and hardware target metadata

Exit criteria:

- one archived HIL run satisfies the physical-device matrix and automation coverage map requirements
- real audio proof exists for app-initiated HVSC playback
- remaining open issues are runtime/design issues only, not evidence gaps

Dependencies and sequencing constraints:

- Run this only after the major runtime/query and ingest contracts are stable enough that the HIL artifacts are worth keeping.
- Prefer `u64` when both devices respond; otherwise use whichever host responds successfully and record that choice in the archived artifacts.

## 6. Test and Validation Plan for Remaining Work

| Issue | Unit/native tests | Integration/UI tests | Performance/scale tests | Real-device checks | Closure artifacts |
| --- | --- | --- | --- | --- | --- |
| `HVSC-AUD-001` | Recursive selection batching/streaming regressions; playlist window derivation tests | Play page list-window tests with preview + view-all flows | 10k/50k/100k add/filter/render latency + heap budgets | Pixel 4 scroll/filter/add responsiveness | test output plus device timing log/screenshots |
| `HVSC-AUD-002` | Shared query contract tests across adapters; FTS/search facet tests | HVSC browse/search UI tests against the authoritative query layer | deep-window paging benchmarks | none required for initial closure | contract-test output and schema/query design proof |
| `HVSC-AUD-003` | interruption/restart/rollback tests; idempotent re-run tests | ingest lifecycle tests proving no partial-ready state | ingest-time budget sampling | optional after code closure | staged-ingest logs and recovery test output |
| `HVSC-AUD-004` | none beyond existing automated coverage | full app-first HVSC workflow run | startup/add/browse timings during HIL run | Pixel 4 connected, app installed, ingest/browse/add/play flow executed | screenshots, timeline, logcat, selected device metadata |
| `HVSC-AUD-005` | playback correlation payload tests | app-first playback flow with selected-track confirmation | none beyond HIL timing capture | Ultimate playback with `c64scope` packet/RMS proof | action timeline, current-track screenshot, audio JSON/packets |
| `HVSC-AUD-006` | XCTest for chunk reads, `.7z` ingest, cancellation, corrupt archives | iOS simulator/device smoke for ingest UI | memory/stress run with target-sized archive | iOS device/simulator run on macOS | XCTest output, memory profile, operator/CI artifact bundle |
| `HVSC-AUD-007` | large-archive guard tests, unsupported-path tests | UX tests for explicit unsupported-size/platform messaging | browser memory/time sampling for supported sizes | browser/native sanity checks as applicable | test output plus documented support matrix |
| `HVSC-AUD-010` | cache-marker corruption tests; checksum/integrity tests; interrupted-download restart tests | user-visible recovery UX tests | optional large-download restart timing | none required initially | integrity-policy doc plus test output |
| `HVSC-AUD-011` | instrumentation helpers for UI timing assertions | React list/window tests at 10k/50k/100k | device perf gates for add/filter/scroll | Pixel 4 perf sampling | perf report, thresholds, and failing/passing evidence |
| `HVSC-AUD-012` | diagnostics payload and correlation-ID tests | diagnostics UI/export tests | query/render/playback timing capture | HIL artifact completeness check | persisted summaries/log bundles with correlation data |
| `HVSC-AUD-013` | hydration/session regressions for active item + initial window only | cold-start restore tests with large playlists | startup/resume memory/time budgets | optional after code closure | restore test output plus hydration budget evidence |
| `HVSC-AUD-014` | repository contract tests for cursor/keyset paging and stable ordering | none required beyond hook consumers | deep paging and repeated filter updates at 10k/50k/100k | none required initially | repository perf output plus explicit capability gating |

## 7. Recommended Next Execution Slice

Recommended next slice:
implement the authoritative query/hydration convergence slice first.

Why it should go first:

- It moves four high-impact issues at once: `HVSC-AUD-001`, `HVSC-AUD-002`, `HVSC-AUD-013`, and `HVSC-AUD-014`.
- It removes the biggest architectural reason the current UI/perf/HIL evidence would be misleading: the app still rehydrates and reasons about whole-playlist state even after the recent batching/windowing work.
- It creates the foundation needed for honest UI-scale testing and meaningful hardware proof.

Issues materially advanced:

- `HVSC-AUD-001`
- `HVSC-AUD-002`
- `HVSC-AUD-013`
- `HVSC-AUD-014`
- `HVSC-AUD-011`

Exact deliverables expected:

- one authoritative query adapter contract for large playlists and HVSC browse/search
- initial-window-plus-active-item hydration in `usePlaybackPersistence`
- removal of remaining full-playlist repository resyncs from query-only changes
- explicit large-playlist capability handling for non-IndexedDB / non-authoritative fallback paths
- contract and regression tests that prove the new paging/hydration behavior

Validation bar for that slice:

- shared query contract tests pass
- large-playlist repository tests still pass at 100k
- new hydration tests prove no whole-playlist rematerialization for session-only changes
- new Play-page tests prove filter/window changes do not rewrite repository rows or expand hot-path state beyond the requested window
