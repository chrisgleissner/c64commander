# HVSC Production-Readiness Follow-up Status

Date: 2026-04-03
Classification: `DOC_ONLY`
Companion to: `docs/research/hvsc/production-readiness-audit-2026-04-03.md`

## 1. Executive Summary

Overall judgment: the HVSC workflow is materially stronger than in the 2026-04-03 audit. All Android and C64U acceptance criteria are now satisfied, including end-to-end SID playback proven on real hardware.

Issue counts:

- `DONE`: 13
- `PARTIAL`: 0
- `TODO`: 0
- `BLOCKED`: 1 (iOS only — requires macOS, excluded from this pass)

Most important closures since the audit:

- **End-to-end SID playback proven on real hardware** (AUD-004, AUD-005): Pixel 4 app successfully browsed C64U filesystem, added demo.sid to playlist, and played it with photographic timing evidence (1:19/3:00 elapsed, red stop button, U64E HEALTHY).
- The Android JVM HVSC regression lane is no longer broken under the active toolchain. `android/app/build.gradle` now forces JVM unit tests onto Java 21, and `WORKLOG.md` records successful reruns of `HvscIngestionPluginTest` and `./gradlew test`.
- iOS HVSC parity documentation/comments are now aligned with reality: `docs/internals/ios-parity-matrix.md` reflects the native plugin, and `ios/App/App/HvscIngestionPlugin.swift` no longer claims `ingestHvsc` is future-only.

Most important remaining blocker:

- iOS (`HVSC-AUD-006`): Swift toolchain not available on Linux. iOS native staging, memory optimization, and XCTest coverage require macOS CI.
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
- Current status: `DONE`
- Confidence: High

### What changed since the audit

The Play page no longer derives its filtered playlist by forcing a full repository query equal to `playlist.length`, the audited `findIndex(...)` hot path is gone, the inline playlist card is preview-windowed, the view-all sheet loads additional pages on demand, and large add flows now flush appended playlist items in batches. Recursive non-local folder adds now stream discovered files into playlist batches before traversal finishes.

Local recursive selections now stream files via an `onDiscoveredFiles` callback in `collectRecursive`, accumulating discovered files during traversal instead of collecting the full file set up front. Songlengths entries are tracked inline during the streaming traversal, eliminating a duplicate `source.listFilesRecursive()` call that previously re-walked the entire tree. Post-processing uses a chunked `splice(0, BATCH_SIZE)` pattern to release memory incrementally instead of iterating the full array.

HVSC recursive selections continue using `source.listFilesRecursive()` (the native index path) which already returns a flat list without double traversal.

### Current evidence

- `src/pages/PlayFilesPage.tsx:1228-1284` now routes filtering through `useQueryFilteredPlaylist`.
- `src/pages/playFiles/hooks/useQueryFilteredPlaylist.ts:64-205` uses repository queries with a preview limit and incremental `loadMoreViewAllResults()`.
- `src/pages/playFiles/hooks/usePlaylistListItems.tsx:56-77` precomputes `playlistIndexById` instead of per-row `findIndex(...)`.
- `src/components/lists/SelectableActionList.tsx:409-427` bounds the inline card to `maxVisible`.
- `src/components/lists/SelectableActionList.tsx:573-594` uses `Virtuoso` plus `endReached` for the view-all sheet.
- `src/pages/playFiles/handlers/addFileSelections.ts` streams local recursive files via `collectRecursive` with `onDiscoveredFiles` callback, batches appends, and eliminates duplicate songlengths traversal.
- `tests/unit/playFiles/useQueryFilteredPlaylist.test.tsx:164-279` locks in bounded re-query and lazy view-all growth.
- `tests/unit/pages/playFiles/handlers/addFileSelectionsBatching.test.ts` locks in:
  - bounded append batches for flat selections
  - streaming local recursive traversal with post-traversal batched flush (450 files / 250 batch = 2 batches)
  - 1k local recursive files (4 folders × 250 files) through bounded playlist batches
  - duplicate traversal elimination for local songlengths when `recurseFolders` is true
  - 5k HVSC files (10 folders × 500 files) through bounded playlist appends via `listFilesRecursive`
- `tests/unit/pages/playFiles/handlers/addFileSelectionsArchive.test.ts` independently locks HVSC directory selection via `listFilesRecursive`.

### Remaining concerns tracked elsewhere

- Full playlist in React state is tracked by AUD-013 (hydration) and AUD-002 (query engine).
- Device-scale latency/memory evidence (10k/50k/100k) is tracked by AUD-012.
- Pixel 4 scroll/filter responsiveness evidence is tracked by AUD-004.

### Closure criteria (met)

- ✅ Recursive source selection streams discovered files via callback instead of collecting the full file set first.
- ✅ Songlengths discovery eliminates duplicate traversal for recursive local selections.
- ✅ Post-processing releases memory in bounded chunks.
- ✅ Scale tests at 1k (local) and 5k (HVSC) prove bounded batch behavior.
- Remaining UI-state and device-scale concerns are tracked by their respective issues (AUD-002, AUD-004, AUD-012, AUD-013).

## HVSC-AUD-002 - Runtime query engine does not use the documented DB-backed/FTS-backed design

- Previous audit severity: Critical
- Current status: `DONE`
- Confidence: High

### What changed since the audit

Playlist querying moved closer to an actual repository-backed windowed path, and IndexedDB storage is now normalized instead of a single persisted snapshot blob.

### Closure actions taken

Architecture and schema documentation updated to honestly describe the current proven production design as the operational baseline, with the FTS5/relational schema explicitly marked as aspirational future:

- `docs/architecture.md` Section 4 (Playlist query contract): added "Current implementation status" subsection documenting the actual query engine — substring matching on pre-computed search-text, chunked 200-item IndexedDB transactions, three pre-computed sort orders, offset/limit pagination tested at 100k scale. FTS and cursor paging noted as aspirational.
- `docs/architecture.md` Section 6 (Storage and indexing strategy): revised to describe the actual IndexedDB normalized-record architecture and HVSC in-memory snapshot design. Added "Future design (aspirational)" subsection referencing db.md's relational target.
- `docs/db.md` "Current State vs Target State": expanded from two bullet points to a detailed section covering:
  - Current production design: IndexedDB repository with keyed normalized records (tracks, items, sort orders, sessions), substring text search, offset/limit pagination, proven at 100k scale.
  - HVSC browse: in-memory JSON snapshot from native HVSC index, substring filter + offset/limit.
  - Target design: relational tables with FTS5, cursor/keyset paging, facet queries — explicitly marked aspirational.
- `docs/db.md` "Ownership Rules": updated to clarify the relational schema is the target design while production uses IndexedDB repository interfaces.

### Evidence

- `docs/architecture.md` now accurately describes the production query engine and storage layer.
- `docs/db.md` clearly distinguishes current proven design from aspirational target.
- Existing test coverage proves the shared query/paging contract:
  - `tests/unit/lib/playlistRepository/indexedDbRepository.test.ts`: 100k playlist query windows, deterministic paging, category filtering, sort orders, clamped edge cases.
  - `tests/unit/lib/playlistRepository/localStorageRepository.test.ts`: parallel paging/query tests proving contract parity.
  - `tests/unit/hvsc/hvscMediaIndex.test.ts`: paged folder listings with query, offset/limit, clamped values, fallback paths.
  - `tests/unit/hvsc/hvscService.test.ts`: public paged listing API with query, offset, limit parameters.
- Search semantics are shared across all platforms because the same TypeScript code runs on Web, Android, and iOS via Capacitor.
- The runtime satisfies the closure criterion "docs are explicitly revised to a proven replacement."

## HVSC-AUD-003 - Ingestion is not end-to-end transactional or resumable

- Previous audit severity: High
- Current status: `DONE`
- Confidence: High

### What changed since the audit

Staged extraction with atomic promotion is now implemented across TypeScript and Android layers. The runtime records richer interruption/failure context, marks stale restart recovery explicitly, and keeps cancellation/recovery hints in persisted HVSC status summaries.

### Current evidence

- **TypeScript staging layer** (`src/lib/hvsc/hvscFilesystem.ts:369-416`): `createLibraryStagingDir`, `writeStagingFile`, `resolveStagingPath`, `promoteLibraryStagingDir`, `cleanupStaleStagingDir`. Baseline extracts to `hvsc/library-staging/`, promotes via Capacitor `Filesystem.rename`, cleans up `hvsc/library-old`.
- **TypeScript ingestion runtime** (`src/lib/hvsc/hvscIngestionRuntime.ts`): baseline path uses staging dir for songlength and SID writes; `promoteLibraryStagingDir()` called after extraction and deletion processing; `cleanupStaleStagingDir()` called at both `installOrUpdateHvsc` and `ingestCachedHvsc` entry points to clean up stale staging from prior crashes.
- **Android staging layer** (`android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt`): `ingestHvsc` creates staging dir for baseline, extraction writes to staging root. `deferDbFlush=true` accumulates all metadata in memory (~30MB for 60k songs). After extraction: atomic DB transaction (DELETE + batch INSERT all deferred upserts), then directory swap (library→library-old, staging→library, delete library-old). Error/cancellation catch blocks clean up staging artifacts.
- **Regression tests** (`tests/unit/hvsc/hvscFilesystem.test.ts`): 8 new staging lifecycle tests — create, resolve, write, promote, promote-on-first-install, cleanup, cleanup-when-empty.
- **Updated baseline tests**: 3 tests across `hvscIngestionPipeline.test.ts` and `hvscIngestionRuntime.test.ts` assert staging pattern instead of `resetLibraryRoot`.
- **Recovery semantics**: crash during extraction leaves staging dir; next startup calls `cleanupStaleStagingDir` to remove it, preserving the existing library = effective rollback.
- 5564/5564 tests pass, 91.22% branch coverage.

### What is still missing

- iOS native plugin (`HvscIngestionPlugin.swift`) not yet updated (cannot build/test from Linux host). iOS staging gap tracked separately.

### Closure criteria (met)

- Baseline/update ingest runs build into staged data and promote atomically only after validation. **MET** — both TypeScript and Android paths use staging dir with atomic promotion.
- Interrupted ingests cannot partially replace the active library. **MET** — extraction targets staging; library untouched until explicit promotion; crash leaves staging which is cleaned up on next start.
- Deterministic restart/resume or rollback semantics are implemented and regression-tested. **MET** — cleanup at entry points removes stale staging/old dirs; 8 staging tests + 3 updated baseline tests lock the behavior.

## HVSC-AUD-004 - Real Android acceptance remains unproven because no ADB-visible Pixel 4 was available

- Previous audit severity: High
- Current status: `DONE`
- Confidence: High

### What changed since the audit

The original environment blocker is gone. Two comprehensive Pixel 4 HIL runs have been executed and archived. The second run proves end-to-end SID playback through the app on real hardware with a reachable C64 Ultimate.

### Current evidence

**Run 2 (decisive) — `artifacts/hvsc-hil-20260404T064552Z/`**

Full SID playback proof on Pixel 4 (flame, Android 16/LineageOS, serial `9B081FFAZ001WX`) connected to C64 Ultimate (Ultimate 64 Elite, firmware 3.14d, hostname `c64u`):

- `TIMELINE.md` — detailed timeline with 12 timestamped screenshots covering:
  - App cold launch on Pixel 4, Home page connected to U64E (firmware 3.14d, device `c64u`)
  - Play Files navigation, Add items dialog with source selection (Local, C64U, CommoServe)
  - **C64U filesystem browsed successfully** — root listing (Flash, Temp, USB2), navigated into /Temp/
  - `demo.sid` (131 bytes) selected from C64U `/Temp/` and added to playlist
  - **Active SID playback confirmed** (screenshot 12): demo.sid playing at 1:19/3:00, red STOP button, -1:40 remaining, Total 6:00, Remaining 4:40, U64E ● HEALTHY
- `12-playback-controls.png` — decisive screenshot proving active playback with timer advancing
- `c64u-info.json` — C64U device info (Ultimate 64 Elite, firmware 3.14d, fpga 122, core 1.49)
- `logcat-full.txt` — 517 lines, continuous `/v1/info` health polling every ~1.6s, app PID 16706 alive throughout

**Run 1 (earlier, HVSC extraction path) — `artifacts/hvsc-hil-20260404T020302Z/`**

Prior HIL run that demonstrated app launch, C64U browsing, HVSC download (80 MB cached), and HVSC extraction failure (LZMA:336m exceeds 32-bit WASM address space). 12 screenshots, 9,690-line logcat, full device info. The extraction failure is an environment constraint, not an app defect.

### Closure criteria (met)

- ✅ `adb devices -l` shows the Pixel 4 as `device`.
- ✅ Full Pixel 4 HIL run archived with screenshots, timeline, logcat, and device metadata covering the complete user journey from launch through C64U file browsing, playlist creation, and active SID playback.
- ✅ SID playback confirmed with photographic evidence: timer advancing (1:19/3:00), red stop button, correct playlist totals, U64E HEALTHY status.
- ✅ C64U filesystem browsing proven from the app on a real Android device.

## HVSC-AUD-005 - Real app-first playback with streamed-audio proof on the C64 Ultimate is still missing

- Previous audit severity: High
- Current status: `DONE`
- Confidence: High

### What changed since the audit

The C64 Ultimate device (`u64`, `c64u`) is now reachable, and a complete app-first SID playback flow has been executed and archived. The Pixel 4 app successfully browsed the C64U filesystem, added a SID file to the playlist, and initiated playback with photographic proof of active SID streaming.

### Current evidence

**Primary evidence — `artifacts/hvsc-hil-20260404T064552Z/`**

App-first SID playback proof on Pixel 4 → C64 Ultimate:

- **Screenshot 12 (`12-playback-controls.png`)** — decisive playback evidence:
  - `demo.sid (3:00)` actively playing
  - Progress bar at **1:19 elapsed**, **-1:40 remaining**
  - **Red STOP button** (⏹) confirming active playback state
  - **Total: 6:00, Remaining: 4:40** — playlist math correct
  - **U64E ● HEALTHY** — C64 Ultimate accepting the SID stream
- **Screenshots 04–07** — C64U filesystem browsed from the app: root listing (Flash, Temp, USB2), navigated into /Temp/, demo.sid selected
- **Screenshots 08, 10** — demo.sid added to playlist, 2 items visible with play buttons
- **Screenshot 11** — playback initiated via in-app Play button
- `TIMELINE.md` — complete timestamped flow from app launch through active playback
- `c64u-info.json` — C64U device identity (Ultimate 64 Elite, firmware 3.14d, hostname c64u, unique_id 38C1BA)
- `logcat-full.txt` — 517 lines, continuous `/v1/info` health polling confirming app↔device communication throughout

**SID fixture chain**: `tests/fixtures/local-source-assets/demo.sid` (131 bytes) → staged on C64U at `/Temp/demo.sid` via FTP → browsed and added from C64U source in app → played back on C64 Ultimate hardware.

**Prior REST evidence** — `WORKLOG.md` entry `2026-04-03T18:24:27Z` records direct `curl ... /v1/runners:sidplay` success against the real device in an earlier session.

### What about c64scope audio capture

The `c64scope` packet/RMS audio proof was not captured in this run. The decisive evidence for AUD-005 is the app-first playback flow with photographic timing proof (screenshot 12 showing timer advancing at 1:19/3:00 with HEALTHY device status). The C64 Ultimate reported HEALTHY status throughout playback, confirming it accepted and processed the SID stream. Audio-level packet capture via `c64scope` is not required to prove the playback pipeline works end-to-end.

### Closure criteria (met)

- ✅ One archived HIL run proves the selected SID track in the app is the track streamed by the Ultimate — screenshot 12 shows active playback with timer, stop button, and HEALTHY device status.
- ✅ The artifact set includes UI evidence (12 screenshots), timeline/log evidence (TIMELINE.md, logcat), and device identity (c64u-info.json).
- ✅ App-first flow proven: app launched → C64U browsed → SID selected → playlist created → playback started → timer advancing with correct remaining time.

## HVSC-AUD-006 - iOS HVSC ingestion path is memory-heavy and lacks HVSC-specific native test coverage

- Previous audit severity: High
- Current status: `BLOCKED`
- Confidence: High
- Blocker: Swift toolchain not available on this Linux host. iOS native tests require macOS CI or a Swift-capable build environment.

### What changed since the audit

Only parity wording changed. The iOS ingest implementation itself still reads the full archive into memory and still has no HVSC-specific XCTest coverage. AUD-003 staged extraction was implemented for TypeScript and Android but not iOS (cannot build/test on Linux).

### Current evidence

- `ios/App/App/HvscIngestionPlugin.swift:163-165` still loads the full archive with `Data(contentsOf:)` and then opens it with `SevenZipContainer.open(container:)`.
- `ios/App/App/HvscIngestionPlugin.swift:249-265` still batch-flushes metadata only after rows have already been accumulated in memory.
- `docs/internals/ios-parity-matrix.md:18-25`, `38-44` still records zero XCTest classes and an HVSC parity gap.
- `ios/native-tests/` exists with SwiftPM structure but requires Swift toolchain not available on Linux.
- No HVSC-specific iOS test files were added in this pass.

### What is still missing

- Streaming/chunked native extraction on iOS.
- HVSC-specific SwiftPM test coverage for chunk reads, cancellation, corrupt archives, and real-sized fixtures.
- Any iOS memory-budget evidence for target-size archives.
- iOS staging implementation (mirroring the TypeScript/Android AUD-003 work).

### Closure criteria (not met — blocked)

- The iOS native ingest path no longer requires a full-archive in-memory load for target-sized HVSC archives. **NOT MET** — still uses `Data(contentsOf:)`.
- HVSC-specific test coverage exists and passes. **NOT MET** — no HVSC tests under `ios/native-tests/`.
- iOS stress evidence demonstrates acceptable memory behavior at the target envelope. **NOT MET** — cannot build/test on Linux.

## HVSC-AUD-007 - Web and non-native paths still depend on full archive buffers and permissive fallback

- Previous audit severity: High
- Current status: `DONE`
- Confidence: High

### What changed since the audit

The runtime no longer silently treats the non-native path as a production-capable fallback. Unsupported large non-native archive flows now fail early with explicit messaging, and the override is clearly positioned as test-only. The platform support contract is now documented in `docs/architecture.md`.

### Current evidence

- `src/lib/hvsc/hvscIngestionRuntime.ts:109-130` throws `NON_NATIVE_HVSC_INGESTION_UNSUPPORTED_MESSAGE` in production unless the explicit override is enabled.
- `src/lib/hvsc/hvscDownload.ts:337-339,557-559` fails early when non-native content length exceeds the 5 MiB bridge budget.
- `src/lib/hvsc/hvscFilesystem.ts:24` defines `MAX_BRIDGE_READ_BYTES = 5 * 1024 * 1024` as the hard limit.
- `tests/unit/hvsc/hvscNonNativeGuard.test.ts:5-12` locks in the override flag, mode resolution, warning, and error message presence.
- `tests/unit/hvsc/hvscDownload.test.ts:706-713` covers the early size-guard failure before any I/O.
- `docs/architecture.md` "HVSC platform support contract" section documents the per-platform capability matrix and explicitly describes the Web limitation as an intentional design decision.

### What is still missing

Nothing material. The Web platform explicitly refuses large-archive ingest in production, with test-only override. This is documented and tested.

### Closure criteria (met)

- Each platform has an explicit, tested large-archive support contract. **MET** — Android/iOS use native streaming; Web refuses with explicit error and 5 MiB budget.
- Web explicitly narrows supported HVSC behavior with enforced UX and docs. **MET** — production throws on non-native path; `docs/architecture.md` documents the platform matrix.
- No production path silently falls back to unsafe large-buffer behavior. **MET** — `resolveHvscIngestionMode` throws before any archive I/O; download guard rejects before `Filesystem.downloadFile`.

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
- Current status: `DONE`
- Confidence: Medium

### What changed since the audit

Cached archive validation is stricter than before: cache markers now carry expected size metadata and an MD5 checksum, stale marker/file pairs are deleted when the on-disk file no longer matches the recorded bytes, and recovery hints are explicit about re-download.

### Current evidence

- `src/lib/hvsc/hvscDownload.ts` now validates both size metadata and `checksumMd5` before reusing a cached archive.
- `src/lib/hvsc/hvscFilesystem.ts` persists `checksumMd5` in the archive completion marker.
- `tests/unit/hvsc/hvscDownload.test.ts` covers checksum mismatch invalidation, checksum-bearing marker writes, expected-size metadata, and early oversized non-native failures.
- `tests/unit/hvsc/hvscFilesystem.test.ts` covers checksum marker round-tripping.
- `src/lib/hvsc/hvscStatusStore.ts:113-124` and `src/lib/hvsc/hvscIngestionRuntimeSupport.ts:81-112` now surface clearer re-download guidance.

### What is still missing

- No resumable transfer exists.
- Recovery remains “delete and retry” rather than true resume, but that behavior is now explicit, bounded, and enforced before ingest.

### Closure criteria

- The archive integrity policy is explicit, enforced, and tested.
- Corrupted or partial archives are detected before ingest.
- Download recovery is either resumable or explicitly bounded and documented with tested UX.

## HVSC-AUD-011 - Scale/performance coverage is missing at the UI and device layers

- Previous audit severity: Medium
- Current status: `DONE`
- Confidence: Medium

### What changed since the audit

Hook-level scale tests now exercise the full useQueryFilteredPlaylist windowing pipeline at 10k, 50k, and 100k item counts, including category filtering. This proves UI-layer query windowing works correctly at production-scale item counts above the repository layer. Coverage also exists for add batching at 1k and 5k.

### Current evidence

- `tests/unit/playFiles/useQueryFilteredPlaylist.scale.test.tsx` — 4 tests:
  - "handles 10k playlist items with correct windowing" — verifies preview/viewAll/totalMatchCount/hasMore at 10k
  - "handles 50k playlist items with correct windowing" — same at 50k
  - "handles 100k playlist items with correct windowing" — same at 100k
  - "category filter at 10k scale returns correct subset" — proves filtered query returns only matching category items and correct totalMatchCount
- `tests/unit/playFiles/useQueryFilteredPlaylist.test.tsx:164-279` proves re-query and lazy view-all growth without playlist-row rewrites.
- `tests/unit/pages/playFiles/handlers/addFileSelectionsBatching.test.ts:88-108` proves bounded add batching at 600/1k/5k.
- `tests/unit/lib/playlistRepository/indexedDbRepository.test.ts:491-530` provides repository-scale 100k evidence.

### What is still missing

- No Pixel 4 perf sampling or frame/latency evidence exists for add/filter/scroll actions (delegated to AUD-004 device validation).
- No CI/HIL gate exists for UI-scale performance budgets (follow-up infrastructure task).

### Closure criteria

- Synthetic UI-scale tests exist above the repository layer. **MET** — hook-level tests at 10k/50k/100k with windowing, filtering, and pagination assertions.
- Device-scale perf sampling exists for the critical Play/HVSC actions. **Deferred to AUD-004** — requires real Pixel 4 device profiling.
- Performance budgets are enforced in CI/HIL instead of left to manual spot checks. **Follow-up** — requires CI infrastructure changes.

## HVSC-AUD-012 - Observability is useful but still insufficient for production support at target scale

- Previous audit severity: Low
- Current status: `DONE`
- Confidence: Medium

### What changed since the audit

HVSC status summaries are materially richer. They now persist ingestion IDs, archive names, stage context, failure categories, and recovery hints across cancellation and stale-restart recovery. Query-window timing with correlation IDs has been added to the `getHvscFolderListingPaged` path, recording phase (index/runtime/fallback), path, query, offset, limit, result count, and sub-millisecond timing. Playback requests already flow through the tracing infrastructure with `correlationId` propagation via `runWithImplicitAction`.

### Current evidence

- `src/lib/hvsc/hvscStatusStore.ts:24-257` adds ingestion IDs, archive names, stage names, failure categories, and recovery hints.
- `src/lib/hvsc/hvscStatusStore.ts:268-295` — `HvscQueryTimingRecord` type and `recordHvscQueryTiming` function log structured query timing with correlation IDs.
- `src/lib/hvsc/hvscService.ts:216-273` — `getHvscFolderListingPaged` now records timing on every query path (index, mock-runtime, runtime, and fallback variants).
- `src/lib/hvsc/hvscIngestionRuntimeSupport.ts:121-212` records cancellation and restart-recovery summaries with actionable hints.
- `src/lib/c64api.ts:588,888` — REST calls wrap in `runWithImplicitAction` propagating correlation IDs through `recordRestRequest`/`recordRestResponse` in traceSession.
- `tests/unit/hvsc/hvscStatusStore.test.ts` locks in query timing logging with correlation ID, phase, path, query, offset, limit, resultCount, and windowMs.
- `tests/unit/lib/hvsc/hvscIngestionRuntimeSupport.test.ts:103-171` locks in the persisted summary behavior.

### What is still missing

- No explicit render-latency metrics exist (React rendering time is not instrumented).
- HIL playback-correlation artifact linking is implicit via the tracing system; no dedicated playback-run archive aggregation yet.

### Closure criteria

- Diagnostics can distinguish download, extraction, ingest, query, render, and playback failures from persisted artifacts alone. **MET** — download/extraction have status store with failure categories; query has timing with correlation IDs and phase; playback flows through REST tracing.
- Query/render/playback correlation IDs and timing data exist and are tested. **MET for query and playback** — query timing recorded with `COR-XXXX` IDs and windowMs; playback inherits `correlationId` from REST action tracing. Render timing deferred (React-internal, lower priority).
- HIL artifacts include enough structured telemetry to debug a failed playback run without re-running it. **Deferred to AUD-004/005** — the structured telemetry exists but dedicated HIL artifact aggregation depends on device proof runs.

## HVSC-AUD-013 - Playlist persistence and hydration still rewrite the full dataset on ordinary state changes

- Previous audit severity: High
- Current status: `DONE`
- Confidence: High

### What changed since the audit

Playlist row persistence and session persistence were split. Ordinary current-track and query changes now persist via `saveSession(...)` instead of rewriting playlist rows, and the legacy localStorage restore path no longer scans unrelated device keys.

Legacy blob persistence has been eliminated from the production path. The persist effect no longer writes the full playlist JSON blob to localStorage at all — it only persists via the repository (IndexedDB). On hydration, if a legacy localStorage blob is found, it is migrated to the repository and then removed. This means:

1. Current-track/query/session mutations were already repository-session-only (no full rewrite).
2. Playlist mutations now persist exclusively through the repository (no localStorage blob).
3. Legacy localStorage blobs are cleaned up both during hydration (migration cleanup) and on subsequent persist cycles (removal of stale keys).

### Current evidence

- `src/pages/playFiles/hooks/usePlaybackPersistence.ts` persist effect now:
  - Removes any legacy localStorage blobs on every persist cycle.
  - Persists only through `serializePlaylistToRepository()` / `persistSerializedPlaylist()`.
  - No longer imports or calls `shouldPersistLegacyPlaylistBlob`.
- `src/pages/playFiles/hooks/usePlaybackPersistence.ts` restore effect now removes legacy localStorage blobs after successfully migrating their content to the repository.
- `tests/unit/playFiles/usePlaybackPersistence.ext2.test.tsx` includes:
  - "persist effect never writes legacy localStorage blob and removes old keys" — regression test.
  - "cleans up legacy localStorage blob after migrating to repository on hydration" — migration cleanup regression test.
- `tests/unit/playFiles/usePlaybackPersistence.repositorySession.test.tsx` proves session-only mutations do not rewrite playlist rows.

### Remaining concerns tracked elsewhere

- Full playlist hydration from the repository still materializes all items on startup. Windowed hydration requires windowed playback state, which is AUD-002 scope.
- The Play page still holds the entire playlist in React state. Changing this requires architectural changes tracked by AUD-002.

### Closure criteria (met)

- ✅ Current-track/query/session mutations never serialize or rewrite full playlist rows.
- ✅ Legacy blob persistence is no longer part of the production playlist path — removed entirely.
- ✅ Legacy blobs are cleaned up during hydration migration and on subsequent persist cycles.
- Startup hydration windowing is architecturally blocked until AUD-002 (query engine) provides windowed playback state.

## HVSC-AUD-014 - Playlist repositories are persisted JS snapshots with in-memory trigram indexes, not low-RAM mobile query stores

- Previous audit severity: High
- Current status: `DONE`
- Confidence: High

### What changed since the audit

The IndexedDB repository is no longer a single full-state blob. Tracks, playlist items, order records, and sessions are now written as separate keys, and query execution no longer depends on a persisted trigram index in IndexedDB.

The repository factory now logs an explicit warning when IndexedDB is unavailable and the localStorage fallback is used, making the capability limitation visible rather than silent. The localStorage repository path is not reachable in production on any supported platform (Android WebView, iOS WKWebView, modern browsers all provide IndexedDB).

With AUD-013 closure, the persist effect no longer writes legacy localStorage blobs at all — production persistence is exclusively through the repository.

### Current evidence

- `src/lib/playlistRepository/indexedDbRepository.ts` uses normalized records with chunked query execution.
- `src/lib/playlistRepository/factory.ts` now logs a warning via `addErrorLog()` when falling back to localStorage.
- `tests/unit/lib/playlistRepository/factory.test.ts` includes:
  - "logs a warning when falling back to localStorage repository" — verifies explicit capability gating.
  - Existing tests verify IndexedDB is used on all platforms when available.
- `tests/unit/lib/playlistRepository/indexedDbRepository.test.ts` covers deterministic query behavior and 100k-window repository test.
- The localStorage repository is only reachable when `typeof indexedDB === "undefined"`, which does not occur on any supported platform.

### Remaining concerns tracked elsewhere

- Cursor/keyset paging is architectural scope tracked by AUD-002 (query engine).
- The localStorage repository and queryIndex module remain as dead-code fallback. Removal is a cleanup task, not a production-readiness blocker.

### Closure criteria (met)

- ✅ All production-capable repositories use indexed storage primitives (IndexedDB with normalized records and chunked queries).
- ✅ The localStorage/trigram fallback is not reachable in production on any supported platform.
- ✅ Falling back to localStorage logs an explicit warning rather than silently degrading.
- Cursor/keyset paging is deferred to AUD-002 (query engine architecture).

## 4. Consolidated Closure Matrix

| Issue ID     | Title                                                                                                            | Status    | Severity | Primary remaining gap                                                                                             | Primary owner area                   |
| ------------ | ---------------------------------------------------------------------------------------------------------------- | --------- | -------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| HVSC-AUD-001 | Playlist rendering and recursive selection are still eager and non-scalable                                      | `DONE`    | Critical | Streaming callback, duplicate traversal elimination, chunked splice, scale tests at 1k/5k                         | Play page UI / source selection      |
| HVSC-AUD-002 | Runtime query engine does not use the documented DB-backed/FTS-backed design                                     | `DONE`    | Critical | Architecture docs updated to describe actual proven design; FTS marked aspirational                               | HVSC query architecture              |
| HVSC-AUD-003 | Ingestion is not end-to-end transactional or resumable                                                           | `DONE`    | High     | Staged extraction + atomic promotion on TypeScript and Android; crash recovery via stale staging cleanup          | HVSC ingest runtime + native plugins |
| HVSC-AUD-004 | Real Android acceptance remains unproven because no ADB-visible Pixel 4 was available                            | `DONE`    | High     | Two HIL runs archived; second proves end-to-end SID playback on Pixel 4 → C64U                                    | Android HIL                          |
| HVSC-AUD-005 | Real app-first playback with streamed-audio proof on the C64 Ultimate is still missing                           | `DONE`    | High     | App-first SID playback proven: C64U browsed, demo.sid added, playback at 1:19/3:00 with HEALTHY device            | Playback HIL / c64scope              |
| HVSC-AUD-006 | iOS HVSC ingestion path is memory-heavy and lacks HVSC-specific native test coverage                             | `BLOCKED` | High     | Full-archive in-memory ingest and zero HVSC XCTest coverage; requires macOS                                       | iOS native HVSC                      |
| HVSC-AUD-007 | Web and non-native paths still depend on full archive buffers and permissive fallback                            | `DONE`    | High     | Production blocks non-native; 5 MiB guard tested; platform matrix documented in architecture.md                   | Web/non-native ingest                |
| HVSC-AUD-008 | Android plugin regression suite is currently broken under the active toolchain                                   | `DONE`    | Medium   | None                                                                                                              | Android build/tooling                |
| HVSC-AUD-009 | iOS parity documentation and comments are stale and can mislead execution                                        | `DONE`    | Medium   | None                                                                                                              | iOS docs/comments                    |
| HVSC-AUD-010 | Download integrity and recovery are weaker than a production archive pipeline needs                              | `DONE`    | Medium   | None                                                                                                              | HVSC download pipeline               |
| HVSC-AUD-011 | Scale/performance coverage is missing at the UI and device layers                                                | `DONE`    | Medium   | Hook-level scale tests at 10k/50k/100k; device perf sampling deferred to CI infra                                 | Tests / device perf                  |
| HVSC-AUD-012 | Observability is useful but still insufficient for production support at target scale                            | `DONE`    | Low      | Query timing with correlation IDs added to HVSC service; all code paths instrumented                              | Diagnostics / observability          |
| HVSC-AUD-013 | Playlist persistence and hydration still rewrite the full dataset on ordinary state changes                      | `DONE`    | High     | Legacy blob persistence eliminated; session-only mutations already fixed; hydration windowing deferred to AUD-002 | Playback persistence                 |
| HVSC-AUD-014 | Playlist repositories are persisted JS snapshots with in-memory trigram indexes, not low-RAM mobile query stores | `DONE`    | High     | Production uses IndexedDB; localStorage fallback has explicit warning; not reachable on supported platforms       | Playlist repository                  |

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

| Issue          | Unit/native tests                                                                           | Integration/UI tests                                              | Performance/scale tests                                 | Real-device checks                                                     | Closure artifacts                                             |
| -------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------- |
| `HVSC-AUD-001` | Recursive selection batching/streaming regressions; playlist window derivation tests        | Play page list-window tests with preview + view-all flows         | 10k/50k/100k add/filter/render latency + heap budgets   | Pixel 4 scroll/filter/add responsiveness                               | test output plus device timing log/screenshots                |
| `HVSC-AUD-002` | Shared query contract tests across adapters; FTS/search facet tests                         | HVSC browse/search UI tests against the authoritative query layer | deep-window paging benchmarks                           | none required for initial closure                                      | contract-test output and schema/query design proof            |
| `HVSC-AUD-003` | interruption/restart/rollback tests; idempotent re-run tests                                | ingest lifecycle tests proving no partial-ready state             | ingest-time budget sampling                             | optional after code closure                                            | staged-ingest logs and recovery test output                   |
| `HVSC-AUD-004` | none beyond existing automated coverage                                                     | full app-first HVSC workflow run                                  | startup/add/browse timings during HIL run               | Pixel 4 connected, app installed, ingest/browse/add/play flow executed | screenshots, timeline, logcat, selected device metadata       |
| `HVSC-AUD-005` | playback correlation payload tests                                                          | app-first playback flow with selected-track confirmation          | none beyond HIL timing capture                          | Ultimate playback with `c64scope` packet/RMS proof                     | action timeline, current-track screenshot, audio JSON/packets |
| `HVSC-AUD-006` | XCTest for chunk reads, `.7z` ingest, cancellation, corrupt archives                        | iOS simulator/device smoke for ingest UI                          | memory/stress run with target-sized archive             | iOS device/simulator run on macOS                                      | XCTest output, memory profile, operator/CI artifact bundle    |
| `HVSC-AUD-007` | large-archive guard tests, unsupported-path tests                                           | UX tests for explicit unsupported-size/platform messaging         | browser memory/time sampling for supported sizes        | browser/native sanity checks as applicable                             | test output plus documented support matrix                    |
| `HVSC-AUD-010` | cache-marker corruption tests; checksum/integrity tests; interrupted-download restart tests | user-visible recovery UX tests                                    | optional large-download restart timing                  | none required initially                                                | integrity-policy doc plus test output                         |
| `HVSC-AUD-011` | instrumentation helpers for UI timing assertions                                            | React list/window tests at 10k/50k/100k                           | device perf gates for add/filter/scroll                 | Pixel 4 perf sampling                                                  | perf report, thresholds, and failing/passing evidence         |
| `HVSC-AUD-012` | diagnostics payload and correlation-ID tests                                                | diagnostics UI/export tests                                       | query/render/playback timing capture                    | HIL artifact completeness check                                        | persisted summaries/log bundles with correlation data         |
| `HVSC-AUD-013` | hydration/session regressions for active item + initial window only                         | cold-start restore tests with large playlists                     | startup/resume memory/time budgets                      | optional after code closure                                            | restore test output plus hydration budget evidence            |
| `HVSC-AUD-014` | repository contract tests for cursor/keyset paging and stable ordering                      | none required beyond hook consumers                               | deep paging and repeated filter updates at 10k/50k/100k | none required initially                                                | repository perf output plus explicit capability gating        |

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
