# HVSC Production-Readiness Audit

Date: 2026-04-03
Classification: `DOC_ONLY`
Auditor: Codex deep research pass

## 1. Executive Summary

Overall judgment: the HVSC end-to-end capability is not production-ready for the target workload of roughly 60,000 HVSC songs, 100,000 playlist items, and real-device Android/C64U acceptance.

Top strengths:

- Android has a real native HVSC ingestion plugin that streams `.7z`/`.zip` entries to disk and batches SQLite upserts instead of forcing the JS extractor path by default.
- The historical zero-offset native bridge regression is fixed in both Android and iOS code, and the Android regression test still exists in source.
- The mocked/browser-safe flow coverage is strong: `playwright/hvsc.spec.ts` passed 17 HVSC scenarios, and the targeted JS/Vitest HVSC suite passed 568 assertions.
- The real C64 Ultimate is reachable from this host over REST and FTP, and the SID upload/playback endpoint accepted a real SID fixture without API errors.

Top blockers:

- The large-playlist path is still not truly lazy. Playlist filtering and row derivation still materialize full arrays in React memory, and `usePlaylistListItems` performs `playlist.findIndex(...)` per visible row.
- Playlist persistence and hydration still serialize, rewrite, and rematerialize the full playlist on routine state changes, including current-index updates and cold-start restore.
- The operational query path does not actually use the native SQLite HVSC index or an FTS-backed store. Browse/filter flows still rebuild and query TypeScript-side JSON/snapshot indexes.
- The repository adapters are persisted JavaScript snapshots with in-memory trigram indexes and offset-based scans, not low-RAM mobile query stores. The `localStorage` fallback is especially unsafe for 100k-item playlists.
- Recursive HVSC selection eagerly accumulates all discovered files and playlist items in memory, which is incompatible with “select some or all of ~60,000 songs”.
- Real Pixel 4 validation could not be completed because `adb devices -l` showed no attached Android device.
- Real app-first playback with streamed-audio proof on the C64 Ultimate remains unproven.

Recommendation:

- Do not call this workflow production-ready.
- Treat the next implementation pass as a convergence project with two hard goals:
  1. make the storage/query/rendering path actually scale,
  2. close the remaining Pixel 4 + C64U HIL proof gap with archived evidence.

Target production envelope for all platforms:

- Android, iOS, and Web are all required to support full HVSC ingest, browse/filter, playlisting, and playback.
- Design and validation should assume a maximum runtime envelope of `512 MiB RAM` and `2 CPU cores @ 2 GHz`.

## 2. Scope and Audit Method

### Feature scope audited

- HVSC archive acquisition
- `.7z`/`.zip` extraction
- native bridge large-file read/extract behavior
- SQLite ingestion behavior and schema
- HVSC browse/index/query path
- playlist construction, filtering, rendering, and persistence
- playback routing to the C64 Ultimate
- Android, iOS, and Web parity
- automated test coverage and real-device readiness evidence

### Environment used

- Repo: `/home/chris/dev/c64/c64commander`
- Host OS: Linux
- JDK: Corretto OpenJDK `25.0.1`
- Time of audit: 2026-04-03 UTC

### Product/runtime assumptions applied to this document

- Android, iOS, and Web are all in-scope production targets for full HVSC ingest and playback.
- Performance and memory recommendations in this document should be read against a target budget of `512 MiB RAM` and `2 CPU cores @ 2 GHz` on all platforms.

### Devices and external systems

- Android device target expected by repo: Pixel 4 via ADB
- Actual ADB state during audit: no attached devices
- Real C64 Ultimate host: `c64u` -> `192.168.1.167`
- C64 Ultimate REST probe: `/v1/info`, `/v1/version`
- C64 Ultimate FTP probe: `/`, `/Temp/`

### Primary commands executed

```bash
npx vitest run tests/unit/hvsc tests/unit/lib/hvsc \
  tests/unit/lib/playlistRepository/indexedDbRepository.test.ts \
  tests/unit/lib/playlistRepository/localStorageRepository.test.ts \
  tests/unit/playFiles/useHvscLibrary.test.tsx \
  tests/unit/playFiles/useHvscLibrary.progress.test.tsx \
  tests/unit/playFiles/useHvscLibrary.edges.test.tsx \
  tests/unit/pages/playFiles/usePlaylistListItems.test.tsx \
  tests/unit/pages/playFiles/handlers/addFileSelectionsArchive.test.ts

npx playwright test playwright/hvsc.spec.ts --reporter=line

./gradlew :app:testDebugUnitTest --tests 'uk.gleissner.c64commander.HvscSevenZipRuntimeTest'
./gradlew :app:testDebugUnitTest --tests 'uk.gleissner.c64commander.HvscIngestionPluginTest' --tests 'uk.gleissner.c64commander.HvscSevenZipRuntimeTest'

adb version && adb devices -l

ping -c 1 -W 2 c64u
curl -sS --max-time 5 http://c64u/v1/info
curl -sS --max-time 5 ftp://c64u/ --user :
curl -sS --max-time 15 -D - -o /tmp/c64u-sidplay-response.txt \
  -F file=@tests/fixtures/local-source-assets/demo.sid \
  http://c64u/v1/runners:sidplay
curl -sS --max-time 5 ftp://c64u/Temp/ --user :
curl -sS --max-time 10 -X PUT 'http://c64u/v1/runners:sidplay?file=%2FTemp%2Fdemo.sid'
```

### Audit limitations

- No attached Android device was visible to ADB, so no Pixel 4 install, launch, logcat, or on-device HVSC flow could be executed.
- No audible or packet-level streamed-audio oracle was run against the real C64 Ultimate, so playback success is proven only at the API-request layer.
- iOS physical-device execution is not possible from this Linux host.

## 3. Architecture Map

### End-to-end flow as implemented today

| Stage | Primary modules | Notes |
| --- | --- | --- |
| Release/version checks | `src/lib/hvsc/hvscIngestionRuntime.ts`, `src/lib/hvsc/hvscReleaseService.ts` | Chooses baseline/update plan and tracks installed version state |
| Download | `src/lib/hvsc/hvscDownload.ts` | Native platforms prefer `Filesystem.downloadFile`; non-native uses `fetch` |
| Archive read-back | `src/lib/hvsc/hvscDownload.ts` | Large native reads use `HvscIngestion.readArchiveChunk`; otherwise full file is base64-decoded into memory |
| Extraction / ingestion | `src/lib/hvsc/hvscIngestionRuntime.ts`, `src/lib/hvsc/hvscArchiveExtraction.ts`, Android/iOS native `HvscIngestionPlugin` | Native path ingests from archive path; non-native path reads full archive buffer then extracts |
| Filesystem writes | `src/lib/hvsc/hvscFilesystem.ts` plus native plugins | Song files written under `hvsc/library` |
| Metadata indexing | Android/iOS native SQLite `hvsc_song_index`; TS browse snapshot in `hvscBrowseIndexStore` and `hvscMediaIndex.ts` | Important divergence: native SQLite is written, but browse/filter uses TS snapshot indexes |
| Browse/listing | `src/lib/hvsc/hvscService.ts`, `src/lib/sourceNavigation/hvscSourceAdapter.ts` | Paged folder listing exists, but fallback snapshot rebuild scans filesystem |
| Playlist add | `src/pages/playFiles/handlers/addFileSelections.ts` | Recursive selection eagerly accumulates files and playlist items |
| Playlist storage/query | `src/lib/playlistRepository/*`, `src/pages/PlayFilesPage.tsx` | TS repository/query index, IndexedDB/localStorage, not SQLite FTS |
| Rendering | `src/components/lists/SelectableActionList.tsx`, `src/pages/playFiles/hooks/usePlaylistListItems.tsx` | Preview renders via `.map()`, “View all” uses `react-virtuoso` |
| Playback | `src/lib/playback/playbackRouter.ts`, `src/lib/c64api.ts`, `src/pages/playFiles/hooks/usePlaybackController.ts` | SID playback uses either `PUT /v1/runners:sidplay?file=...` or multipart `POST /v1/runners:sidplay` |

### Platform divergence points

| Concern | Android | iOS | Web |
| --- | --- | --- | --- |
| Native HVSC plugin present | Yes | Yes | No |
| Native ingest entrypoint used by runtime | Yes if plugin available | Yes if plugin available; source comment still claims Android-only gating | No |
| Native large-file chunk read | Yes | Yes | No |
| Native SQLite HVSC metadata DB | Yes | Yes | No |
| Non-native archive extraction | Fallback only | Fallback possible | Primary path |
| Real-device proof in this audit | Blocked by no ADB device | Not possible on Linux host | Browser/mocked proof only |

### Key implementation divergence from design docs

The design docs require DB-backed, FTS-backed, query-driven rendering for 100k-scale playlists:

- `docs/architecture.md:183-217`
- `docs/ux-guidelines.md:150-156`
- `docs/db.md:236-252`

The current runtime still uses:

- TypeScript-side playlist query indexes in `src/lib/playlistRepository/queryIndex.ts:23-173`
- full playlist repository replacement/query in `src/pages/PlayFilesPage.tsx:1270-1315`
- TS browse snapshot rebuilds in `src/lib/hvsc/hvscService.ts:151-179` and `src/lib/hvsc/hvscMediaIndex.ts:96-175`

## 4. Existing Test Coverage Assessment

### Inventory summary

Observed relevant inventory during audit:

- HVSC-related unit/source files matched by filename pattern: `63`
- Play/playlist-related test files matched by filename pattern: `78`
- Android HVSC test files: `8`
- Playwright HVSC specs: `4`
- Maestro HVSC/play flows: `18`
- iOS native test files: `4`, but HVSC-specific iOS native tests: `0`

### Executed tests

| Suite | Command | Outcome | What it actually proves |
| --- | --- | --- | --- |
| JS/Vitest targeted HVSC + playlist suite | see commands above | Passed: 36 files / 568 tests | Good source-level confidence for TS ingestion state, extraction helpers, browse/index stores, add-to-playlist handlers, repository query behavior |
| Playwright HVSC flow | `npx playwright test playwright/hvsc.spec.ts --reporter=line` | Passed: 17 tests / 1.0m | Strong mocked/browser-safe flow proof for UI status, mocked download/ingest, add-to-playlist, playback request shape |
| Android pure JVM SevenZip runtime | `./gradlew ... HvscSevenZipRuntimeTest` | Passed | Real `.7z` fixture can be opened/enumerated by the Android runtime library in this environment |
| Android Robolectric plugin tests | `./gradlew ... HvscIngestionPluginTest ...` | Failed | Did not reach meaningful plugin assertions due Robolectric/classpath failure |

### What the tests prove well

- The zero-offset read regression is explicitly covered by source test intent in `android/app/src/test/java/uk/gleissner/c64commander/HvscIngestionPluginTest.kt:207-231`.
- Android SevenZip runtime support is directly asserted in `android/app/src/test/java/uk/gleissner/c64commander/HvscSevenZipRuntimeTest.kt:10-37`.
- The repository layer can page/query large in-memory datasets deterministically:
  - `tests/unit/lib/playlistRepository/indexedDbRepository.test.ts:491-530` covers `100_000` playlist items.
  - `tests/unit/lib/playlistRepository/localStorageRepository.test.ts:191-233` covers `2_000` items.
- Playwright proves mocked flow shape for download -> ingest -> browse -> add -> play:
  - `playwright/hvsc.spec.ts:737-777`
  - `playwright/hvsc.spec.ts:895-928`
  - `playwright/hvsc.spec.ts:818-852`

### What the tests do not prove

- They do not prove real Android app-first HVSC ingest on a Pixel 4.
- They do not prove real C64U streamed-audio success.
- They do not prove that a 60k-song recursive selection path or a 100k-item rendered playlist remains responsive.
- They do not prove that playlist persistence, hydration, and repository writes remain cheap at 100k scale; the current hook tests are correctness-oriented, not allocation/write-amplification/perf-budget tests.
- The largest executed playlist UI scroll test covered `2,700` seeded rows for sheet layout/scrollability, not 100k-item latency or memory behavior: `playwright/playback.spec.ts:579-634`.
- They do not prove that the operational query path uses SQLite or FTS at runtime, because it currently does not.
- They do not prove iOS HVSC ingest correctness under real archive sizes; there are no HVSC-specific iOS native tests.

### Confidence by subsystem

| Subsystem | Confidence | Rationale |
| --- | --- | --- |
| TS download/extraction helpers | Medium | Strong unit coverage, but still memory-heavy in non-native mode |
| Android SevenZip runtime availability | Medium | Direct fixture test passed |
| Android plugin behavior | Low to Medium | Source looks intentional, but Robolectric regression suite is currently broken here |
| HVSC browse/query correctness | Medium | Source and tests cover snapshot browsing, but not target-scale runtime behavior |
| Playlist repository pagination | Medium | Good repository tests, but UI path does not preserve lazy behavior |
| Playlist rendering/performance | Low | No executed scale/perf UI tests found |
| Real playback on C64U | Low to Medium | Endpoint accepted real requests, but no app-first or audio-oracle proof |
| Android real-device acceptance | Low | No ADB-visible device during audit |

## 5. Real-Device Validation Results

### Pixel 4 validation

Status: blocked by environment.

Evidence:

- `adb version && adb devices -l` returned:

```text
Android Debug Bridge version 1.0.41
Version 36.0.2-14143358
Installed as /home/chris/platform-tools/adb
Running on Linux 6.17.0-20-generic (x86_64)
List of devices attached
```

What was validated:

- The expected Android package ID is `uk.gleissner.c64commander` from `capacitor.config.ts:12`.
- The launcher activity is `.MainActivity` from `android/app/src/main/AndroidManifest.xml:6-13`.
- The repo’s device-oriented Maestro flow also targets `appId: uk.gleissner.c64commander` in `.maestro/real-c64u-ftp-browse.yaml:1-6`.

What was not validated:

- install on device
- app launch on device
- on-device HVSC download
- on-device HVSC ingest
- on-device add-to-playlist
- logcat capture
- on-device playback against the real C64U

### C64 Ultimate validation

Status: real device reachable; playback API acceptance proven; streamed-audio success not proven.

Evidence:

- `ping -c 1 -W 2 c64u` succeeded with `192.168.1.167`
- `curl http://c64u/v1/info` returned:

```json
{
  "product": "C64 Ultimate",
  "firmware_version": "1.1.0",
  "core_version": "1.49",
  "hostname": "c64u",
  "unique_id": "5D4E12",
  "errors": []
}
```

- `curl ftp://c64u/ --user :` listed `SD`, `Flash`, `Temp`, `USB1`
- `curl -F file=@tests/fixtures/local-source-assets/demo.sid http://c64u/v1/runners:sidplay` returned HTTP `200` with empty `errors`
- `curl ftp://c64u/Temp/ --user :` then showed:

```text
-rw-rw-rw-   1 user     ftp          131 Apr 03 18:33 demo.sid
```

- `curl -X PUT 'http://c64u/v1/runners:sidplay?file=%2FTemp%2Fdemo.sid'` returned empty `errors`

What this proves:

- The device is reachable on the expected network path.
- The SID playback endpoint accepts real binary uploads from this host.
- The uploaded SID is visible in `/Temp`, which aligns with the app’s upload-style playback path.

What this does not prove:

- the app initiated the request
- the selected HVSC song in the UI matches the song played on hardware
- non-silent audio was streamed
- playback continuity, timing, or recovery behavior on real hardware

### Remaining unclosed real-device gaps

- Attach and authorize the Pixel 4 so `adb devices` shows at least one `device`.
- Build/install the current app and capture logcat during a full HVSC run.
- Run the repo’s HIL/c64scope audio oracle as required by `docs/testing/physical-device-matrix.md:19-21`.

## 6. Findings by Subsystem

### Download

Verified:

- Native platforms prefer `Filesystem.downloadFile` in `src/lib/hvsc/hvscDownload.ts:456-533`.
- Non-native downloads can stream from `response.body` in `src/lib/hvsc/hvscDownload.ts:533-578`.
- Basic truncation detection exists via content-length comparison in `src/lib/hvsc/hvscDownload.ts:527-531` and `src/lib/hvsc/hvscDownload.ts:542-544`.

Insufficient or missing:

- No resumable download support.
- No checksum/signature validation.
- Non-native fallback still materializes the full archive buffer before writing or extracting.

### Extraction / decompression

Verified:

- Android native path streams entries from `.7z`/`.zip` into files and batches SQLite writes:
  - `android/.../HvscIngestionPlugin.kt:325-507`
  - `android/.../HvscIngestionPlugin.kt:509-661`
- Non-native extractor supports `.zip` and `.7z` with progress callbacks in `src/lib/hvsc/hvscArchiveExtraction.ts:67-297`.

Insufficient or fragile:

- Non-native `.7z` extraction writes the full archive into wasm FS first: `src/lib/hvsc/hvscArchiveExtraction.ts:176-183`.
- iOS native ingest loads the full archive into `Data` before opening it: `ios/App/App/HvscIngestionPlugin.swift:164-165`.
- Large-archive safety is therefore much weaker on iOS and Web than on Android.

### Native bridge

Verified:

- Android zero-offset chunk-read regression is fixed by inspecting raw call data instead of trusting `call.getLong(...)`; see source comments around `readArchiveChunk` logic and the regression test name in `HvscIngestionPluginTest.kt:207-231`.
- iOS `readArchiveChunk` also distinguishes absent offset from `0` via `call.options?["offsetBytes"]`: `ios/App/App/HvscIngestionPlugin.swift:63-78`.

Insufficient or fragile:

- The iOS plugin comment still says the JS layer gates native ingest to Android only, but the runtime now selects native mode whenever the plugin is available:
  - stale comment: `ios/App/App/HvscIngestionPlugin.swift:26-30`
  - actual runtime selection: `src/lib/hvsc/hvscIngestionRuntime.ts:85-120`
- Web/non-native fallback remains enabled even when the override is not enabled; the code only logs a warning before returning `"non-native"`:
  - `src/lib/hvsc/hvscIngestionRuntime.ts:109-120`
  - `tests/unit/hvsc/hvscNonNativeGuard.test.ts:5-12`

### SQLite ingestion

Verified:

- Android creates `hvsc_song_index` with `virtual_path`, `file_name`, `songs`, `start_song`, `updated_at_ms` plus one `file_name` index:
  - `android/.../HvscIngestionPlugin.kt:122-148`
- iOS creates the same schema:
  - `ios/App/App/HvscIngestionPlugin.swift:470-486`
- Batched upserts are transactional within each batch:
  - Android `flushSongBatch`: `android/.../HvscIngestionPlugin.kt:172-197`
  - iOS `flushUpserts`: `ios/App/App/HvscIngestionPlugin.swift:402-434`

Insufficient or missing:

- The schema is not adequate for the documented filtering targets. There is no author, released, path FTS, folder table, or subsong table.
- The app does not use this SQLite DB as the operational browse/search engine.
- Baseline reset deletes the library and clears the DB before ingest; failure mid-run can leave a partial new library:
  - Android reset: `android/.../HvscIngestionPlugin.kt:705-721`
  - iOS reset: `ios/App/App/HvscIngestionPlugin.swift:156-158`, `365-379`

### Playlist model

Verified:

- There is a repository abstraction and deterministic query window testing at 100k scale in the repository layer.

Insufficient or fragile:

- The full playlist lives in React state in `src/pages/playFiles/hooks/usePlaylistManager.ts:42-50`.
- Selection pruning still scans the whole playlist to rebuild `selectedPlaylistIds` in `src/pages/playFiles/hooks/usePlaylistManager.ts:54-61`.
- Reshuffle operations copy and compare whole arrays in `src/pages/playFiles/hooks/usePlaylistManager.ts:13-40` and `src/pages/playFiles/hooks/usePlaylistManager.ts:68-79`.
- The page effect writes the entire playlist into the repository and queries with `limit: Math.max(1, playlist.length)` on each relevant change:
  - `src/pages/PlayFilesPage.tsx:1281-1298`
- This makes the page-level path effectively full-materialization even though the repository can page.

### Playlist persistence / storage adapters

Verified:

- The app has a dedicated persistence hook and a repository abstraction for playlist/session state:
  - `src/pages/playFiles/hooks/usePlaybackPersistence.ts`
  - `src/lib/playlistRepository/repository.ts`

Insufficient or fragile:

- `usePlaybackPersistence` serializes every playlist item into `TrackRecord[]` and `PlaylistItemRecord[]` before persistence in `src/pages/playFiles/hooks/usePlaybackPersistence.ts:185-220`.
- Repository persistence still replaces the whole playlist item set after every serialize pass in `src/pages/playFiles/hooks/usePlaybackPersistence.ts:222-231`.
- Repository hydration reads all playlist items, fetches all tracks by ID, and rebuilds a full `PlaylistItem[]` in memory in `src/pages/playFiles/hooks/usePlaybackPersistence.ts:233-269`.
- The persistence effect runs on `[currentIndex, playlist, playlistStorageKey]` and can therefore rewrite large playlist state even when only playback position changes in `src/pages/playFiles/hooks/usePlaybackPersistence.ts:436-494`.
- Legacy blob persistence still `JSON.stringify`s the full playlist payload when it fits the size budget in `src/pages/playFiles/hooks/usePlaybackPersistence.ts:440-487`.
- Session restore still performs `playlist.findIndex(...)` over the full hydrated playlist in `src/pages/playFiles/hooks/usePlaybackPersistence.ts:381-434`.
- The IndexedDB repository persists one `PersistedState` object containing tracks, playlist items, sessions, random sessions, and query indexes in `src/lib/playlistRepository/indexedDbRepository.ts:24-31`.
- IndexedDB mutations call `writeState(state)` after every `withState(...)` operation, which rewrites the full state object in `src/lib/playlistRepository/indexedDbRepository.ts:174-204`.
- The localStorage repository does the same via `JSON.stringify(state)` on every commit in `src/lib/playlistRepository/localStorageRepository.ts:164-174`.
- Both repositories rebuild a full playlist query index whenever playlist items are replaced in:
  - `src/lib/playlistRepository/indexedDbRepository.ts:228-235`
  - `src/lib/playlistRepository/localStorageRepository.ts:196-202`

### Lazy materialization / rendering

Verified:

- `react-virtuoso` is used inside the “View all” sheet in `src/components/lists/SelectableActionList.tsx:475-520`.

Insufficient or fragile:

- Preview rendering still maps every preview item directly: `src/components/lists/SelectableActionList.tsx:380-387`.
- Filtered preview/view-all lists are still derived from in-memory `items` arrays via `filterWithHeaders(...)`: `src/components/lists/SelectableActionList.tsx:315-378`.
- `usePlaylistListItems` performs O(n^2) derivation by calling `playlist.findIndex(...)` for each filtered item: `src/pages/playFiles/hooks/usePlaylistListItems.tsx:59-76`.
- The “View all” virtualization starts only after `viewAllFilteredItems` has already been materialized and header-expanded in memory in `src/components/lists/SelectableActionList.tsx:352-355` and `src/components/lists/SelectableActionList.tsx:521-540`.
- `AlphabetScrollbar` builds additional derived arrays from `viewAllFilteredItems` and then uses `findIndex(...)` to translate back into the virtualized list in `src/components/lists/SelectableActionList.tsx:544-562`.

### Filtering / lookup

Verified:

- The TS repository builds trigram-style search grams and supports category filter, sort, limit, and offset:
  - `src/lib/playlistRepository/queryIndex.ts:23-173`

Insufficient or fragile:

- This is not the documented FTS-backed storage strategy.
- UI code still requests the entire filtered set instead of a paged window.
- The persisted playlist query index duplicates playlist rows, sort orders, category buckets, and trigram buckets in memory in `src/lib/playlistRepository/queryIndex.ts:23-32` and `src/lib/playlistRepository/queryIndex.ts:73-117`.
- Query evaluation is still offset-based and scans `orderedIds` from the front on every request in `src/lib/playlistRepository/queryIndex.ts:150-167`.
- The public repository contract only exposes `limit`/`offset` pagination, not cursor/keyset or streaming semantics, in `src/lib/playlistRepository/types.ts:65-84`.
- `getPlaylistDataRepository()` falls back to the localStorage snapshot repository when IndexedDB is unavailable in `src/lib/playlistRepository/factory.ts:16-29`, which is not a credible 100k-item production path.
- No executed UI latency or scroll-jank measurements were found for 10k/50k/100k data sizes.

### Playback path

Verified:

- Ultimate SID playback without upload uses `PUT /v1/runners:sidplay?file=...`: `src/lib/c64api.ts:1433-1449`
- Local/HVSC SID playback upload uses multipart `POST /v1/runners:sidplay`: `src/lib/c64api.ts:1452-1488`
- Playback router handles both direct ultimate path and upload path with optional `.ssl` payload propagation:
  - `src/lib/playback/playbackRouter.ts:260-337`

Insufficient or unverified:

- No app-first proof exists that an ingested HVSC item was selected, added, and played on a real device with audio confirmation.
- Recovery behavior for slow/disconnected C64U hardware was not exercised on a real app/device path in this audit.

### Observability / diagnostics

Already good:

- HVSC progress stages, summaries, and user-visible failure categorization are present in `useHvscLibrary.ts:294-499`.
- Android and iOS native plugins emit progress and log failures instead of silently swallowing exceptions.

Still missing:

- No persisted per-run ingestion telemetry tying archive version, row counts, duration, and later browse/query behavior together.
- No scale/perf counters for list query latency, row render cost, or memory ceilings.
- No audit artifact path that correlates selected HVSC track -> UI state -> C64U request -> streamed audio in one run.

### Android

Verified:

- Native plugin exists and is wired into the runtime.
- SevenZip runtime test passed.

Unverified or blocked:

- Pixel 4 app-first validation was blocked by absent ADB device.
- Native plugin regression suite is not currently runnable in this environment because Robolectric/plugin setup fails before assertions.

### iOS

Verified:

- Native `HvscIngestionPlugin` exists and is registered in the app.
- Native chunked archive reads and SQLite ingestion methods exist.

Unverified or risky:

- HVSC-specific iOS native test coverage is absent.
- Native ingestion loads the entire archive into memory.
- Linux-host audit cannot supply physical iOS evidence.

### Web

Verified:

- Mocked/browser-safe HVSC flow passed in Playwright.
- Runtime bridge availability on web depends on Capacitor/plugin availability: `src/lib/hvsc/hvscService.ts:48-63`.

Unverified or risky:

- Web is a required production target for full HVSC ingest and playback, so the current non-native constraints are launch-relevant rather than optional fallback concerns.
- Large archive read-back is guarded at `5 MiB` unless native chunked read is available: `src/lib/hvsc/hvscFilesystem.ts:23`, `src/lib/hvsc/hvscDownload.ts:355-395`.
- The non-native path still uses full archive buffers and wasm extraction, so real large-archive browser behavior remains high risk.
- No executed evidence in this audit proves that the Web path can complete full-HVSC ingest, browse/filter, playlisting, and playback within the target `512 MiB RAM` / `2 cores @ 2 GHz` envelope.

## 7. Production-Readiness Issue Register

### HVSC-AUD-001

- Title: Playlist rendering and recursive selection are still eager and non-scalable
- Severity: Critical
- Confidence: High
- Platforms: Android, iOS, Web
- Components/files:
  - `src/pages/PlayFilesPage.tsx`
  - `src/pages/playFiles/hooks/usePlaylistListItems.tsx`
  - `src/components/lists/SelectableActionList.tsx`
  - `src/lib/sourceNavigation/hvscSourceAdapter.ts`
  - `src/pages/playFiles/handlers/addFileSelections.ts`
- User impact:
  - Selecting many HVSC songs or operating on a 100k playlist can cause long freezes, memory pressure, or unusable scrolling/filtering.
- Reproduction:
  - Inspect the current add/filter/render path for recursive HVSC selection and filtered playlist rendering.
- Evidence:
  - Full repository query with `limit: Math.max(1, playlist.length)` at `src/pages/PlayFilesPage.tsx:1285-1289`
  - O(n^2) row derivation at `src/pages/playFiles/hooks/usePlaylistListItems.tsx:59-76`
  - Preview `.map()` rendering at `src/components/lists/SelectableActionList.tsx:380-387`
  - Recursive accumulation of every file in `src/lib/sourceNavigation/hvscSourceAdapter.ts:68-99`
  - Eager playlist item accumulation in `src/pages/playFiles/handlers/addFileSelections.ts:159-193` and later append flow
- Likely root cause:
  - The repository/pagination idea exists, but the page and list hooks still consume full arrays.
- Recommended fix:
  - Move the Play page to a real windowed query contract.
  - Replace recursive “collect all then append” with chunked selection materialization and background batching.
  - Precompute playlist index lookup maps instead of calling `findIndex` per row.
- Required tests:
  - UI/windowing tests for 10k/50k/100k playlists.
  - Recursive HVSC add flow test with tens of thousands of synthetic entries and memory/latency assertions.
  - Real-device scroll/filter responsiveness checks on Android.
- Exit criteria:
  - The page renders and filters via paged windows only.
  - Recursive HVSC add does not hold all selected files and all rendered rows in memory at once.
  - Measured latency and memory stay within defined budgets at 60k/100k scale.

### HVSC-AUD-002

- Title: Runtime query engine does not use the documented DB-backed/FTS-backed design
- Severity: Critical
- Confidence: High
- Platforms: Android, iOS, Web
- Components/files:
  - `src/lib/hvsc/hvscService.ts`
  - `src/lib/hvsc/hvscMediaIndex.ts`
  - `src/lib/playlistRepository/indexedDbRepository.ts`
  - `src/lib/playlistRepository/queryIndex.ts`
  - `android/.../HvscIngestionPlugin.kt`
  - `ios/App/App/HvscIngestionPlugin.swift`
  - `docs/architecture.md`
  - `docs/db.md`
- User impact:
  - Filtering and lookup at production scale will not match the documented performance and capability targets.
- Reproduction:
  - Compare runtime code with the normative architecture/schema docs.
- Evidence:
  - DB-backed/FTS requirements in `docs/architecture.md:183-217` and `docs/db.md:236-252`
  - TS query index implementation in `src/lib/playlistRepository/queryIndex.ts:23-173`
  - Runtime browse index rebuild in `src/lib/hvsc/hvscService.ts:151-179`
  - TS media index/snapshot usage in `src/lib/hvsc/hvscMediaIndex.ts:96-175`
  - Native SQLite schema is minimal and not exposed for browse/query: Android `hvsc_song_index` at `android/.../HvscIngestionPlugin.kt:129-142`, iOS at `ios/App/App/HvscIngestionPlugin.swift:470-486`
- Likely root cause:
  - Native ingestion SQLite was added as a metadata sidecar, but the app’s operational query path never converged onto it.
- Recommended fix:
  - Define one authoritative query store per platform.
  - Expose native HVSC browse/search query APIs backed by SQLite on Android/iOS.
  - Provide a web adapter with equivalent query semantics.
  - Retire snapshot rebuilds as the primary browse/filter source for production scale.
- Required tests:
  - Query contract tests shared across platform adapters.
  - FTS/search correctness tests for title/path/author/released/subsong facets.
  - Migration/integrity tests for schema evolution.
- Exit criteria:
  - Browse/filter/search operate against the authoritative DB-backed query engine.
  - The implementation matches the documented schema contract or the docs are updated to match a new proven design.

### HVSC-AUD-003

- Title: Ingestion is not end-to-end transactional or resumable
- Severity: High
- Confidence: High
- Platforms: Android, iOS, Web
- Components/files:
  - `android/.../HvscIngestionPlugin.kt`
  - `ios/App/App/HvscIngestionPlugin.swift`
  - `src/lib/hvsc/hvscIngestionRuntime.ts`
  - `src/lib/hvsc/hvscStateStore.ts`
- User impact:
  - Cancellation, crash, or failure mid-ingest can leave a partially replaced library and partial metadata state.
- Reproduction:
  - Review baseline reset and batched write semantics.
- Evidence:
  - Android baseline reset deletes library and clears DB before ingest: `android/.../HvscIngestionPlugin.kt:705-721`
  - iOS baseline reset does the same: `ios/App/App/HvscIngestionPlugin.swift:156-158`, `365-379`
  - Upserts are only transactional per batch, not across the full ingest:
    - Android `flushSongBatch`: `172-197`
    - iOS `flushUpserts`: `402-434`
  - Runtime success state is saved in localStorage state store after completion, but there is no resumable journal in `src/lib/hvsc/hvscStateStore.ts:22-93`
- Likely root cause:
  - The implementation optimizes for batch throughput, not crash-safe resumability or atomic switchover.
- Recommended fix:
  - Introduce ingestion-run metadata and staged library roots.
  - Build new baseline/update state in a staging area and atomically promote only after validation.
  - Record resumable checkpoints and make cancellation/restart semantics explicit.
- Required tests:
  - Mid-ingest interruption tests.
  - Crash/restart recovery tests.
  - Idempotent re-run tests for the same archive.
- Exit criteria:
  - Partial ingestion cannot masquerade as ready state.
  - Recovery from interruption is deterministic and documented.

### HVSC-AUD-004

- Title: Real Android acceptance remains unproven because no ADB-visible Pixel 4 was available
- Severity: High
- Confidence: High
- Platforms: Android
- Components/files:
  - External environment
  - `docs/testing/physical-device-matrix.md`
  - `docs/plans/hvsc/hvsc-workflow-test.md`
- User impact:
  - The primary acceptance path required by the repo cannot currently be claimed.
- Reproduction:
  - Run `adb devices -l`.
- Evidence:
  - `adb devices -l` returned no devices.
  - Repo precondition explicitly requires a physical Android device in `docs/testing/physical-device-matrix.md:7-13`.
- Likely root cause:
  - External connectivity/authorization issue, not established as a repo code defect.
- Recommended fix:
  - Restore Pixel 4 ADB visibility and rerun the full app-first HVSC HIL workflow with archived artifacts.
- Required tests:
  - Full Pixel 4 HIL run.
- Exit criteria:
  - `adb devices` shows the Pixel 4 as `device`.
  - Full Android HIL artifact set exists for download -> ingest -> add -> play -> audio proof.

### HVSC-AUD-005

- Title: Real app-first playback with streamed-audio proof on the C64 Ultimate is still missing
- Severity: High
- Confidence: Medium
- Platforms: Android, iOS, Web
- Components/files:
  - `src/lib/playback/playbackRouter.ts`
  - `src/lib/c64api.ts`
  - `docs/testing/physical-device-matrix.md`
  - `docs/plans/hvsc/automation-coverage-map.md`
- User impact:
  - The core user promise “play songs back on a real Commodore 64 Ultimate” is not yet proven end to end.
- Reproduction:
  - Compare current evidence with repo-required HIL acceptance.
- Evidence:
  - Real device endpoint probes succeeded, but only from host curl, not the app.
  - The repo itself states HIL proof is still required in `docs/plans/hvsc/automation-coverage-map.md:47-71` and `docs/testing/physical-device-matrix.md:19-21`.
- Likely root cause:
  - Automation and direct hardware reachability exist, but the app-first HIL step has not been completed in this environment.
- Recommended fix:
  - Use the repo’s HIL/c64scope path to correlate selected UI track, device request, and streamed audio.
- Required tests:
  - App-first HVSC hardware run with screenshots, action timeline, logcat, and c64scope packet/RMS outputs.
- Exit criteria:
  - One archived run proves selected HVSC track -> playlist -> real C64U playback -> non-silent audio.

### HVSC-AUD-006

- Title: iOS HVSC ingestion path is memory-heavy and lacks HVSC-specific native test coverage
- Severity: High
- Confidence: High
- Platforms: iOS
- Components/files:
  - `ios/App/App/HvscIngestionPlugin.swift`
  - `ios/native-tests/**`
- User impact:
  - Large HVSC archives may fail or be unstable on iOS devices with tighter memory ceilings.
- Reproduction:
  - Inspect the iOS native ingest path and native test inventory.
- Evidence:
  - Full archive read into memory: `ios/App/App/HvscIngestionPlugin.swift:164-165`
  - No HVSC-specific native tests found under `ios/native-tests`
- Likely root cause:
  - The iOS implementation prioritizes completeness over streaming memory behavior, and validation has not caught up.
- Recommended fix:
  - Add a streaming or chunked native extraction path for iOS.
  - Add iOS native tests for chunk reads, `.7z` ingestion, cancellation, and corrupt archives.
- Required tests:
  - XCTest/native validation for HVSC plugin
  - iOS device or simulator stress tests with real-sized HVSC fixtures
- Exit criteria:
  - iOS can ingest target-size archives within defined memory limits and has repeatable native test coverage.

### HVSC-AUD-007

- Title: Web and non-native paths still depend on full archive buffers and permissive fallback
- Severity: High
- Confidence: High
- Platforms: Web, iOS fallback, Android fallback
- Components/files:
  - `src/lib/hvsc/hvscDownload.ts`
  - `src/lib/hvsc/hvscArchiveExtraction.ts`
  - `src/lib/hvsc/hvscIngestionRuntime.ts`
  - `src/lib/hvsc/hvscFilesystem.ts`
- User impact:
  - Large archives may exceed browser/device memory or hit size guards in non-native mode.
- Reproduction:
  - Inspect non-native archive read/extract code paths.
- Evidence:
  - Large non-native read blocked above `5 MiB` without native chunk bridge: `src/lib/hvsc/hvscFilesystem.ts:23`, `src/lib/hvsc/hvscDownload.ts:355-395`
  - Non-native `.7z` path writes full archive buffer into wasm FS: `src/lib/hvsc/hvscArchiveExtraction.ts:176-183`
  - Runtime still falls back to `"non-native"` even when override is off: `src/lib/hvsc/hvscIngestionRuntime.ts:109-120`
- Likely root cause:
  - Fallback behavior remained permissive for compatibility/testing, but target-scale safety constraints were not enforced.
- Recommended fix:
  - Make production fallback rules explicit per platform.
  - Refuse unsupported large-archive paths with user-visible messaging instead of silently relying on memory-heavy fallback.
  - Implement a proven browser/Web large-file strategy because Web is a required production HVSC path, and document the supported limits against the `512 MiB RAM` / `2 cores @ 2 GHz` target envelope.
- Required tests:
  - Large-archive web/native-fallback tests with explicit size thresholds
  - UX tests for unsupported-platform or unsupported-size messaging
- Exit criteria:
  - Each platform has an explicit, tested large-archive support contract.

### HVSC-AUD-013

- Title: Playlist persistence and hydration still rewrite the full dataset on ordinary state changes
- Severity: High
- Confidence: High
- Platforms: Android, iOS, Web
- Components/files:
  - `src/pages/playFiles/hooks/usePlaybackPersistence.ts`
  - `src/pages/playFiles/hooks/usePlaylistManager.ts`
  - `src/pages/PlayFilesPage.tsx`
- User impact:
  - Large playlists can trigger repeated CPU spikes, storage writes, and heap churn during normal usage such as restore, append, filter, and current-track changes.
- Reproduction:
  - Inspect the playlist persistence/hydration effects and their dependency lists.
- Evidence:
  - Full serialize pass to `tracks` and `playlistItems` in `src/pages/playFiles/hooks/usePlaybackPersistence.ts:185-220`
  - Full repository rewrite in `src/pages/playFiles/hooks/usePlaybackPersistence.ts:222-231`
  - Full repository hydrate/rematerialize in `src/pages/playFiles/hooks/usePlaybackPersistence.ts:233-269`
  - Full localStorage candidate scan and replay in `src/pages/playFiles/hooks/usePlaybackPersistence.ts:294-358`
  - Session restore scans the playlist via `findIndex(...)` in `src/pages/playFiles/hooks/usePlaybackPersistence.ts:390-392`
  - Persistence effect keyed by `[currentIndex, playlist, playlistStorageKey]` in `src/pages/playFiles/hooks/usePlaybackPersistence.ts:436-494`
  - Whole-playlist React state in `src/pages/playFiles/hooks/usePlaylistManager.ts:42-79`
- Likely root cause:
  - Persistence is modeled as repeated snapshot serialization instead of incremental mutation tracking over a normalized store.
- Recommended fix:
  - Move playlist persistence to delta-oriented operations: append/remove/reorder/session updates instead of full replace.
  - Persist playback session/current item separately from playlist rows.
  - Hydrate only the initial query window plus the active item, then page the rest on demand.
  - Remove legacy large-playlist blob persistence from the production path.
- Required tests:
  - Hook/integration tests proving that current-index changes do not rewrite all playlist rows.
  - Cold-start hydration tests for 10k/50k/100k playlists with bounded allocations and time budgets.
  - Device perf tests covering restore, append, and next-track transitions on large playlists.
- Exit criteria:
  - Ordinary playback/session mutations do not serialize or rewrite the full playlist.
  - Startup and resume hydrate only the necessary window and active item metadata.

### HVSC-AUD-014

- Title: Playlist repositories are persisted JS snapshots with in-memory trigram indexes, not low-RAM mobile query stores
- Severity: High
- Confidence: High
- Platforms: Android, iOS, Web
- Components/files:
  - `src/lib/playlistRepository/indexedDbRepository.ts`
  - `src/lib/playlistRepository/localStorageRepository.ts`
  - `src/lib/playlistRepository/queryIndex.ts`
  - `src/lib/playlistRepository/factory.ts`
  - `src/lib/playlistRepository/types.ts`
- User impact:
  - Query memory grows with duplicated row/order/gram state, deep paging becomes increasingly linear, and environments without IndexedDB fall back to a storage path that is not realistic for 100k-item playlists.
- Reproduction:
  - Inspect repository persistence layout, query-index construction, and query contract.
- Evidence:
  - IndexedDB persists one full `PersistedState` snapshot including query indexes in `src/lib/playlistRepository/indexedDbRepository.ts:24-31`
  - IndexedDB rewrites the full state object after each mutation in `src/lib/playlistRepository/indexedDbRepository.ts:174-204`
  - localStorage commits stringify the full state in `src/lib/playlistRepository/localStorageRepository.ts:164-174`
  - Playlist replacement rebuilds the full query index in:
    - `src/lib/playlistRepository/indexedDbRepository.ts:228-235`
    - `src/lib/playlistRepository/localStorageRepository.ts:196-202`
  - The query index duplicates rows, sort orders, category buckets, and trigram buckets in `src/lib/playlistRepository/queryIndex.ts:23-32` and `src/lib/playlistRepository/queryIndex.ts:73-117`
  - Query execution still linearly walks `orderedIds` with `offset`/`limit` in `src/lib/playlistRepository/queryIndex.ts:150-167`
  - The repository contract only exposes offset pagination in `src/lib/playlistRepository/types.ts:65-84`
  - Factory fallback uses localStorage when IndexedDB is unavailable in `src/lib/playlistRepository/factory.ts:16-29`
- Likely root cause:
  - The repository layer was designed as a persisted in-memory model for correctness and portability, not as a normalized storage engine optimized for constrained devices.
- Recommended fix:
  - Replace snapshot repositories with normalized tables/object stores keyed by playlist item, track, and session.
  - Move search/sort to real DB indexes or FTS where available, and use equivalent indexed object-store queries on web.
  - Introduce cursor/keyset pagination with stable sort keys instead of deep offset scans.
  - Make large-playlist capability gating explicit; do not treat localStorage fallback as production-capable for this workload.
- Required tests:
  - Shared repository contract tests for cursor/keyset windows and stable ordering.
  - Repository perf tests that cover deep paging and repeated filter updates at 10k/50k/100k.
  - Capability/fallback tests that reject unsupported large-playlist environments with explicit UX.
- Exit criteria:
  - Repository writes are incremental, not full-snapshot rewrites.
  - Search/sort/page behavior is backed by indexed storage primitives rather than persisted JS indexes.
  - Large-playlist support contracts are explicit and enforced per platform.

### HVSC-AUD-008

- Title: Android plugin regression suite is currently broken under the active toolchain
- Severity: Medium
- Confidence: High
- Platforms: Android
- Components/files:
  - `android/app/src/test/java/uk/gleissner/c64commander/HvscIngestionPluginTest.kt`
  - Robolectric test environment
- User impact:
  - Native bridge regressions are harder to detect before shipping.
- Reproduction:
  - Run `./gradlew :app:testDebugUnitTest --tests 'uk.gleissner.c64commander.HvscIngestionPluginTest'`
- Evidence:
  - Failures reported `NoClassDefFoundError: android/webkit/RoboCookieManager` from generated test reports under `android/app/build/reports/tests/testDebugUnitTest/`
  - JDK in this environment is `25.0.1`
- Likely root cause:
  - Robolectric/classpath/toolchain incompatibility in the current environment.
- Recommended fix:
  - Make the Android HVSC plugin suite green on the supported CI/local JDK version.
  - Pin or document the supported JDK if necessary.
- Required tests:
  - Green `HvscIngestionPluginTest`
  - CI job covering the supported JDK lane
- Exit criteria:
  - Plugin regression suite runs green in the supported local/CI environment.

### HVSC-AUD-009

- Title: iOS parity documentation and comments are stale and can mislead execution
- Severity: Medium
- Confidence: High
- Platforms: iOS, docs
- Components/files:
  - `ios/App/App/HvscIngestionPlugin.swift`
  - `docs/internals/ios-parity-matrix.md`
- User impact:
  - Engineers can make incorrect platform assumptions during triage or implementation.
- Reproduction:
  - Compare iOS code with parity docs/comments.
- Evidence:
  - Stale plugin comment: `ios/App/App/HvscIngestionPlugin.swift:26-30`
  - Stale doc claims “HVSC module | Shared TypeScript (no native code)” at `docs/internals/ios-parity-matrix.md:18-25`
  - Actual iOS native plugin exists and is registered.
- Likely root cause:
  - Docs/comments were not updated after native iOS HVSC code landed.
- Recommended fix:
  - Update comments/docs to reflect current reality and current remaining gaps.
- Required tests:
  - None beyond doc review, but platform smoke tests should align with updated docs.
- Exit criteria:
  - Internal docs accurately describe the current iOS HVSC implementation and its validation gaps.

### HVSC-AUD-010

- Title: Download integrity and recovery are weaker than a production archive pipeline needs
- Severity: Medium
- Confidence: Medium
- Platforms: Android, iOS, Web
- Components/files:
  - `src/lib/hvsc/hvscDownload.ts`
- User impact:
  - Users may need to re-download after partial or corrupted transfers, with limited validation beyond size checks.
- Reproduction:
  - Inspect download and cache marker logic.
- Evidence:
  - HEAD/content-length validation exists, but no checksum/signature validation or resume support.
  - Cache completeness is marker-based in `src/lib/hvsc/hvscDownload.ts:281-333`.
- Likely root cause:
  - The download path optimized for simple cache-complete semantics, not durable resumable transfer.
- Recommended fix:
  - Add content hash validation if the HVSC source provides it, or document a stronger integrity policy.
  - Add resumable download support or explicit restart/recovery UX.
- Required tests:
  - Corrupt cache marker tests
  - Interrupted download restart tests
- Exit criteria:
  - Archive integrity policy is explicit, enforced, and tested.

### HVSC-AUD-011

- Title: Scale/performance coverage is missing at the UI and device layers
- Severity: Medium
- Confidence: High
- Platforms: Android, iOS, Web
- Components/files:
  - `tests/unit/playFiles/**`
  - `tests/unit/pages/playFiles/**`
  - device/HIL flows
- User impact:
  - Performance cliffs can ship unnoticed even if repository-level query tests pass.
- Reproduction:
  - Search current tests for 60k/100k UI or device-scale assertions.
- Evidence:
  - Repository scale tests exist, but no corresponding UI/render-scale tests were found in the play/list test folders during this audit.
  - `rg` over the play/list test folders found no `100k`, `100_000`, `60k`, `virtualized`, `scroll`, or `jank` assertions.
- Likely root cause:
  - Scale testing focused on storage/query adapters, not the actual React list pipeline.
- Recommended fix:
  - Add synthetic scale fixtures and instrumentation-based UI tests.
  - Add Android device perf gates for add/filter/scroll actions.
- Required tests:
  - React windowing tests at 10k/50k/100k
  - device perf sampling on Pixel hardware
- Exit criteria:
  - Scale gates exist above the repository layer and run in CI/HIL as appropriate.

### HVSC-AUD-012

- Title: Observability is useful but still insufficient for production support at target scale
- Severity: Low
- Confidence: Medium
- Platforms: Android, iOS, Web
- Components/files:
  - `src/pages/playFiles/hooks/useHvscLibrary.ts`
  - native logging paths
  - diagnostics flows
- User impact:
  - Support can distinguish major stages, but not quickly answer “how big was the archive, how long did query windowing take, which selected track mapped to which playback request, and where did latency occur?”
- Reproduction:
  - Review existing diagnostics surfaces and compare them with expected production support questions.
- Evidence:
  - Stage-based summaries exist in `useHvscLibrary.ts:380-499`, but no persisted per-run metrics or cross-stage correlation IDs for browse/query/render/playback timing were found in the audited path.
- Likely root cause:
  - Current diagnostics focus on correctness/failure surfacing, not operational scale triage.
- Recommended fix:
  - Add per-run ingestion summaries, query latency counters, and playback-correlation artifacts.
- Required tests:
  - Diagnostics payload tests
  - HIL artifact completeness checks
- Exit criteria:
  - Support can distinguish download, extraction, ingest, query, render, and playback failures from collected diagnostics alone.

## 8. What Is Already Good Enough

- The Android native HVSC plugin is a serious implementation, not a stub. It handles `.7z` and `.zip`, writes files incrementally, batches metadata writes, and surfaces progress.
- The zero-offset bridge regression is addressed in code on both Android and iOS, and the Android regression test source still documents the exact failure mode.
- The mocked/browser-safe HVSC UI flow is well-covered and currently green.
- The repository abstraction already supports deterministic paging/query behavior and provides a useful foundation for a true windowed UI.
- The existing playlist tests are good at locking down correctness semantics for ordering, filtering, session restore, and repository behavior, even though they do not yet prove target-scale performance.
- The C64 Ultimate network environment is alive and responsive from this machine; the hardware itself is not the obvious blocker.
- Error handling is generally explicit rather than silent across the audited HVSC path.

## 9. Priority-Ordered Implementation Plan

1. Converge the storage/query architecture.
   - Decide and implement the authoritative DB/query engine per platform.
   - Replace full-snapshot playlist persistence with incremental writes and windowed hydration.
   - Eliminate localStorage as a claimed large-playlist production path.
   - Expose real browse/search APIs from that store.
   - Align docs and runtime.

2. Remove eager playlist/list-selection behavior.
   - Replace full-array page filtering, preview derivation, and O(n^2) row derivation.
   - Move deep scrolling/filtering to cursor-backed windows instead of `offset` scans over full arrays.
   - Make recursive HVSC adds chunked and cancelable.

3. Fix ingestion durability semantics.
   - Add staged baseline/update promotion and resumable run metadata.
   - Ensure partial failure cannot look like success.

4. Re-enable trustworthy native regression coverage.
   - Make Android plugin tests green on the supported toolchain.
   - Add iOS HVSC native tests.

5. Close the platform-specific large-archive gaps.
   - Streaming-safe iOS path.
   - A Web ingestion/playback path that is explicitly production-capable within the shared `512 MiB RAM` / `2 cores @ 2 GHz` budget, with non-native constraints enforced rather than implied.

6. Run the real-device convergence lane.
   - Restore Pixel 4 ADB access.
   - Execute the full HIL flow with c64scope audio proof.

7. Upgrade operational diagnostics.
   - Add run-level metrics and correlation artifacts once the functional path is fixed.

## 10. Test Plan Required Before Release

### Unit / native

- Android:
  - Green `HvscIngestionPluginTest`
  - corrupt archive
  - zero-offset / EOF chunk read
  - cancel mid-ingest
  - staged baseline promotion
- iOS:
  - HVSC native chunk-read tests
  - `.7z` ingest tests
  - cancellation and corrupt-archive tests
- Shared/query:
  - DB query contract tests shared across adapters
  - FTS/facet search tests

### Integration / UI

- Play page windowed query tests at 10k/50k/100k
- Recursive HVSC add tests with very large synthetic folder trees
- Scroll/filter stability tests for “View all” and preview modes
- Persistence/reload tests for large playlists without full-array rematerialization
- Playback-session tests proving that current-index changes do not trigger full playlist rewrites
- Deep-page query tests proving cursor/keyset access remains bounded for late windows

### End-to-end / device

- Pixel 4:
  - cold download -> ingest -> browse -> add -> play
  - cache-reuse -> ingest -> browse -> add -> play
  - cancellation/restart during ingest
  - large playlist filter/scroll responsiveness
- C64 Ultimate:
  - streamed-audio proof with `packetCount > 0` and `RMS >= 0.005`
  - selected-track correlation artifact

### Performance gates

- Defined max latency for:
  - filter keystroke -> visible results
  - opening “View all”
  - appending large selection batches
  - first playable row after ingest
  - cold-start hydrate of a persisted 100k playlist
  - next/prev/current-track persistence updates on a large playlist
- Defined memory ceilings for:
  - iOS ingestion within the shared `512 MiB RAM` target
  - Web/non-native extraction within the shared `512 MiB RAM` target
  - 100k playlist browsing within the shared `512 MiB RAM` target
  - 100k playlist persistence/hydration within the shared `512 MiB RAM` target
- Defined CPU/throughput gates for:
  - ingest, filter, and scroll behavior on hardware no stronger than `2 CPU cores @ 2 GHz`
  - Web main-thread responsiveness under the same `2 CPU cores @ 2 GHz` constraint

## 11. Open Questions and Unknowns

- Unknown: the actual memory headroom of current iOS devices for full-HVSC archive ingestion with the current `Data(contentsOf:)` implementation.
  - Needed evidence: instrumented iOS run with a real archive and memory sampling.

- Unknown: exact Pixel 4 runtime performance for 60k HVSC selection and 100k playlist operations after the architecture is fixed.
  - Needed evidence: on-device perf traces and HIL artifacts.

- Unknown: the current heap and storage amplification of the snapshot playlist repository on genuinely low-RAM Android hardware.
  - Needed evidence: instrumented large-playlist runs measuring JS heap, IndexedDB/localStorage footprint, and persistence latency before and after the storage redesign.

- Unknown: whether the real app UI on Android still has any residual “ready after failed extraction” lie under edge-state combinations.
  - Current source looks better than the historical hypothesis, but no real-device repro was possible in this audit.
  - Needed evidence: on-device failure injection and status-surface verification.

## 12. Appendix

### Key source references

- Runtime mode selection: `src/lib/hvsc/hvscIngestionRuntime.ts:85-120`
- Native ingest fallback and browse snapshot clearing: `src/lib/hvsc/hvscIngestionRuntime.ts:563-653`
- Non-native archive read-back: `src/lib/hvsc/hvscDownload.ts:338-410`
- Native/non-native download branches: `src/lib/hvsc/hvscDownload.ts:438-579`
- Non-native `.7z` extraction: `src/lib/hvsc/hvscArchiveExtraction.ts:154-275`
- HVSC index readiness and snapshot rebuild: `src/lib/hvsc/hvscService.ts:151-179`
- Playlist full-query effect: `src/pages/PlayFilesPage.tsx:1270-1315`
- Playlist persistence/hydration snapshot path: `src/pages/playFiles/hooks/usePlaybackPersistence.ts:185-494`
- Playlist React state management: `src/pages/playFiles/hooks/usePlaylistManager.ts:42-79`
- O(n^2) playlist row mapping: `src/pages/playFiles/hooks/usePlaylistListItems.tsx:59-76`
- Preview/list rendering and “View all”: `src/components/lists/SelectableActionList.tsx:315-520`
- IndexedDB playlist snapshot repository: `src/lib/playlistRepository/indexedDbRepository.ts:24-259`
- localStorage playlist snapshot repository: `src/lib/playlistRepository/localStorageRepository.ts:21-259`
- Playlist query index and offset scan behavior: `src/lib/playlistRepository/queryIndex.ts:23-173`
- Playlist repository contract/fallback: `src/lib/playlistRepository/types.ts:65-84`, `src/lib/playlistRepository/factory.ts:16-29`
- Recursive HVSC source scan: `src/lib/sourceNavigation/hvscSourceAdapter.ts:68-99`
- Android native SQLite schema/batching: `android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt:122-217`
- iOS native ingest/load-into-memory path: `ios/App/App/HvscIngestionPlugin.swift:123-307`

### Command outcomes

```text
Vitest:
  Test Files  36 passed (36)
  Tests       568 passed (568)
  Duration    16.79s

Playwright:
  17 passed (1.0m)

Android Gradle:
  HvscSevenZipRuntimeTest => BUILD SUCCESSFUL
  HvscIngestionPluginTest => failed with NoClassDefFoundError: android/webkit/RoboCookieManager

ADB:
  List of devices attached
  [none]

C64 Ultimate:
  ping c64u => success
  /v1/info => product C64 Ultimate, firmware 1.1.0
  FTP root => SD, Flash, Temp, USB1
  POST /v1/runners:sidplay with demo.sid => HTTP 200, errors []
  FTP /Temp => demo.sid present
  PUT /v1/runners:sidplay?file=/Temp/demo.sid => errors []
```

### Repo guidance relevant to this audit

- Physical Android device precondition: `docs/testing/physical-device-matrix.md:7-13`
- HVSC playback hardware proof requirement: `docs/testing/physical-device-matrix.md:19-21`
- Existing automation honesty notes: `docs/plans/hvsc/automation-coverage-map.md:7-13`, `47-71`
- Existing gap analysis: `docs/plans/hvsc/existing-agentic-test-analysis.md:9-13`, `101-107`
