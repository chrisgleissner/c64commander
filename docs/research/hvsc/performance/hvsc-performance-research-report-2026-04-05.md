# HVSC Performance Research Report

Date: 2026-04-05
Author: Performance engineering research pass
Classification: DOC_ONLY
Status: Execution-grade research document — no product changes made

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Codebase Archaeology](#2-codebase-archaeology)
3. [Current Architecture Map](#3-current-architecture-map)
4. [Measurement Goals and Target Budgets](#4-measurement-goals-and-target-budgets)
5. [Recommended Profiling Toolchain](#5-recommended-profiling-toolchain)
6. [Exact Benchmark Scenarios](#6-exact-benchmark-scenarios)
7. [Required Instrumentation Plan](#7-required-instrumentation-plan)
8. [Artifact Plan and Directory Layout](#8-artifact-plan-and-directory-layout)
9. [Bottleneck Taxonomy](#9-bottleneck-taxonomy)
10. [Solution Options per Bottleneck](#10-solution-options-per-bottleneck)
11. [Grading Rubric](#11-grading-rubric)
12. [Ranked Top Three per Bottleneck](#12-ranked-top-three-per-bottleneck)
13. [Overall Ranked Top Three](#13-overall-ranked-top-three)
14. [Iterative Optimization Loop](#14-iterative-optimization-loop)
15. [CI Regression Strategy](#15-ci-regression-strategy)
16. [Open Questions and Validation Risks](#16-open-questions-and-validation-risks)

---

## 1. Executive Summary

C64 Commander's HVSC workflow spans six critical phases: archive download, ingest/index build, browse traversal, add-all-to-playlist, large-playlist filtering, and playback start. This report provides a measurement-first plan to bring each phase within hard performance targets on a real Pixel 4 (primary) and Docker-backed web (secondary).

Key findings from codebase archaeology:

- **Download** still materializes the full archive in JS heap on web paths and uses base64 bridge copies on native paths. Both create avoidable memory pressure.
- **Ingest** streams archive entries through 7z-wasm or fflate, writing each SID file individually through the Capacitor Filesystem bridge with base64 encoding. The per-file overhead across 60,582+ entries dominates wall time.
- **Browse** relies on a full JSON snapshot (`hvsc-browse-index-v1.json`) loaded into memory, rebuilt into folder/song maps, and queried with linear scans plus `.sort()` per navigation.
- **Playlist add** recursively enumerates directories, resolves configs and songlengths per file, and appends items to React state in batches of 250. The canonical playlist is a full `PlaylistItem[]` in React state.
- **Playlist filter** uses an IndexedDB-backed repository with trigram search and chunked reads, but the full playlist still lives in React state and is re-serialized on every change.
- **Playback start** reads SID bytes through a base64 Filesystem bridge and resolves songlengths on demand.

The three highest-impact optimization directions, pending measurement confirmation:

1. Replace the JSON browse snapshot with an indexed database (IndexedDB or SQLite) keyed by parent path, eliminating full-snapshot loads and linear scans.
2. Move download + ingest toward a native streaming pipeline with incremental writes and checksums, avoiding JS heap materialization of the full archive.
3. Make the playlist repository authoritative and window UI state, eliminating the full `PlaylistItem[]` in React state.

This report defines how to measure, confirm, and iteratively implement these and other improvements.

---

## 2. Codebase Archaeology

### 2.1 File inventory

| Area | Key files | Lines (approx) |
|------|-----------|----------------|
| Download | `src/lib/hvsc/hvscDownload.ts` | 750 |
| Filesystem | `src/lib/hvsc/hvscFilesystem.ts` | 490 |
| Archive extraction | `src/lib/hvsc/hvscArchiveExtraction.ts` | 300 |
| Ingestion runtime | `src/lib/hvsc/hvscIngestionRuntime.ts` | 800+ |
| Ingestion support | `src/lib/hvsc/hvscIngestionRuntimeSupport.ts` | 214 |
| Pipeline FSM | `src/lib/hvsc/hvscIngestionPipeline.ts` | 77 |
| Browse index | `src/lib/hvsc/hvscBrowseIndexStore.ts` | 484 |
| Media index adapter | `src/lib/hvsc/hvscMediaIndex.ts` | 185 |
| Service facade | `src/lib/hvsc/hvscService.ts` | 341 |
| Song source | `src/lib/hvsc/hvscSource.ts` | 84 |
| Release service | `src/lib/hvsc/hvscReleaseService.ts` | 102 |
| Songlength service | `src/lib/hvsc/hvscSongLengthService.ts` | 273 |
| Playlist repository | `src/lib/playlistRepository/indexedDbRepository.ts` | 549 |
| Query index | `src/lib/playlistRepository/queryIndex.ts` | 174 |
| Filtered playlist hook | `src/pages/playFiles/hooks/useQueryFilteredPlaylist.ts` | 225 |
| Add file selections | `src/pages/playFiles/handlers/addFileSelections.ts` | 745 |
| Playlist manager hook | `src/pages/playFiles/hooks/usePlaylistManager.ts` | 112 |
| Android telemetry | `ci/telemetry/android/monitor_android.sh` | 326 |
| Mock HVSC server | `playwright/mockHvscServer.ts` | 167 |

### 2.2 Native ingestion path

On Android, when the `HvscIngestion` Capacitor plugin is available, archive extraction and SID file writing are delegated to native Kotlin code via `HvscIngestion.ingestHvsc()`. This bypasses the 7z-wasm / fflate JS extraction path. The native plugin:

- Accepts a relative archive path in Capacitor's data directory
- Supports `baseline` and `update` modes
- Batches database writes (`dbBatchSize: 500`)
- Reports progress every 250 entries
- Optionally logs heap usage

When native ingestion is unavailable (web, tests), the JS path extracts via 7z-wasm or fflate, writes each file individually through `Filesystem.writeFile()` with base64 encoding, and builds the browse index in memory.

### 2.3 Existing test infrastructure

- **Playwright mock HVSC server** (`playwright/mockHvscServer.ts`): Serves synthetic baseline and update archives as in-memory zips. No throttling. Small fixture size (handful of songs).
- **HVSC Playwright spec** (`playwright/hvsc.spec.ts`): Tests browse, install, update, folder navigation, and song playback against the mock server.
- **Android telemetry script** (`ci/telemetry/android/monitor_android.sh`): Samples CPU%, RSS, PSS, Dalvik/native heap, and thread counts at configurable intervals. Outputs CSV + events log + metadata JSON.
- **Maestro flows**: `smoke-launch.yaml` and `smoke-hvsc.yaml` for CI; HVSC-specific flows tagged `hvsc`.

### 2.4 Data scale

- HVSC baseline archive: ~60,582 SID files + Songlengths.md5/Songlengths.txt
- Compressed archive size: ~80 MiB (7z)
- Extracted library size: ~230 MiB on disk
- Browse index JSON: ~15–25 MiB serialized (estimate based on 60K entries × ~300 bytes average)
- Target playlist scale: 60,582 items (HVSC full) to 100,000 items

---

## 3. Current Architecture Map

### 3.1 Download flow

```
User taps "Install HVSC"
  → hvscService.installOrUpdateHvsc(cancelToken)
    → hvscIngestionRuntime.installRuntime(cancelToken)
      → fetchLatestHvscVersions() [HTTP GET to HVSC index page]
      → for each archive (baseline, then updates):
          → downloadArchive()
            ├─ [Native] Filesystem.downloadFile() → disk
            │   └─ progress polling via Filesystem.stat() every 400ms
            └─ [Web] fetch() → streamToBuffer() → writeCachedArchive()
                └─ Full buffer in JS heap → base64 encode → Filesystem.writeFile()
          → computeArchiveChecksumMd5()
            ├─ [Native] chunked read via HvscIngestion.readArchiveChunk() + SparkMD5
            └─ [Web] Filesystem.readFile() → base64 decode → SparkMD5
          → writeCachedArchiveMarker()
```

**Hotspots**: JS heap pressure on web; base64 round-trips on native; full-buffer checksum.

### 3.2 Ingest flow

```
downloadArchive() completes
  → [Native path] ingestArchivePathNative()
      → HvscIngestion.ingestHvsc() [Kotlin: extract + write SIDs + build index]
      → reloadHvscSonglengthsOnConfigChange()
      → browseIndex.finalize()
  → [Web path] ingestArchiveBuffer()
      → readArchiveBuffer() [base64 decode entire archive into JS]
      → extractArchiveEntries()
        ├─ [7z] 7z-wasm: write to WASM FS → extract → walk → read back
        └─ [zip] fflate streaming Unzip with 256KB chunks
      → per entry:
          ├─ parseSidHeaderMetadata()
          ├─ writeStagingFile() or writeLibraryFile()
          │   └─ ensureDir() + writeFileWithRetry() [base64 encode + Filesystem.writeFile()]
          └─ browseIndex.upsertSong()
      → promoteLibraryStagingDir() [atomic rename]
      → reloadHvscSonglengthsOnConfigChange()
      → browseIndex.finalize()
        └─ buildFoldersFromSongs() + saveHvscBrowseIndexSnapshot()
            └─ JSON.stringify() → base64 encode → Filesystem.writeFile()
```

**Hotspots**: 60K+ individual `Filesystem.writeFile()` calls with base64 encoding; full archive buffer in JS heap on web; 7z-wasm WASM FS copies; JSON index build and serialization.

### 3.3 Browse traversal flow

```
User opens Add Items → selects HVSC
  → getHvscFolderListingPaged()
    → ensureHvscIndexReady()
      → hvscIndex.load()
        → readFilesystemSnapshot() [Filesystem.readFile() → base64 decode → JSON.parse()]
        → OR readLocalStorageSnapshot()
      → verifyHvscBrowseIndexIntegrity() [sample 12 paths]
    → hvscIndex.queryFolderPage()
      → listFolderFromBrowseIndex()
        → lookup folder row by normalized path
        → filter songs/folders by query (linear scan)
        → sort results with .sort() + localeCompare
        → slice for pagination
    → recordHvscQueryTiming()
```

**Hotspots**: Full snapshot load + JSON parse (~15–25 MiB); linear filter + sort per navigation; integrity check stats 12 files.

### 3.4 Add-all-to-playlist flow

```
User selects folder(s) and taps "Add"
  → createAddFileSelectionsHandler()
    → for each selected folder:
        → collectRecursive() [BFS with maxConcurrent=3]
          → source.listEntries(path) per directory
          → flush discovered files in batches of 250
    → for each discovered file:
        → appendPlayableFile()
          → resolvePlaybackConfig() + discoverConfigCandidates()
          → buildPlaylistItem()
          → batch into pendingPlaylistBatch (250 items)
          → appendPlaylistBatch()
            → applySonglengthsToItems()
            → setPlaylist(prev => [...prev, ...resolvedItems])
              └─ Full array spread + concat in React state
```

**Hotspots**: Repeated `listEntries()` for deep trees; config/songlength resolution per file; full array spread in `setPlaylist` for each batch of 250.

### 3.5 Playlist filter flow

```
User types in filter input
  → useQueryFilteredPlaylist effect fires
    → repository.upsertTracks() + replacePlaylistItems()
      └─ IndexedDB transaction: write all tracks + playlist items + order index
    → repository.queryPlaylist()
      └─ Read order index → chunked read (200 items) → filter by query + category
    → setQueryFilteredPlaylist(nextFiltered)
```

**Hotspots**: Full re-serialization of playlist into IndexedDB on every playlist change; chunked sequential reads for query; full playlist in React state alongside repository state.

### 3.6 Playback start flow

```
User taps Play on a filtered HVSC item
  → HvscSongSource.getSong(entry)
    → getHvscSong({ virtualPath })
      → getHvscSongByVirtualPath()
        → ensureHvscSonglengthsReadyOnColdStart()
        → readFileWithSizeGuard() [base64 read from Filesystem]
        → resolveHvscSonglengthDuration()
    → base64ToUint8(song.dataBase64) [decode for playback]
```

**Hotspots**: SID file read through base64 bridge; songlength resolution on demand.

---

## 4. Measurement Goals and Target Budgets

| Scenario | Hard budget | P50 target | Platform |
|----------|------------|------------|----------|
| Download full HVSC from mock at 5 MiB/s | < 20 s | < 18 s | Pixel 4, Docker web |
| Ingest all 60,582+ songs | < 25 s | < 20 s | Pixel 4, Docker web |
| Any add-items traversal step | < 2 s | < 1 s | Pixel 4 |
| Filter 60K+ playlist | < 2 s | < 1 s | Pixel 4 |
| Playback start from filtered result | < 1 s | < 500 ms | Pixel 4 |
| Scale to 100K playlist items without full in-memory hydration | Pass/fail | — | Pixel 4, RPi Zero 2W web |

### Download budget breakdown (5 MiB/s mock)

- ~80 MiB archive at 5 MiB/s = 16 s network time
- Budget for overhead (checksum, cache write, bridge copies): 4 s
- Total: 20 s

### Ingest budget breakdown

- 60,582 SID files + metadata + songlengths
- Target throughput: > 2,400 files/s on Pixel 4
- Target throughput: > 2,400 files/s on Docker web
- Budget for index build + persistence: 2 s

---

## 5. Recommended Profiling Toolchain

### 5.1 By platform

#### Android (Pixel 4 — primary target)

| Tool | Purpose | Cost | When to use |
|------|---------|------|-------------|
| **Perfetto CLI** (`adb shell perfetto`) | System traces: scheduling, CPU, memory counters, process stats | Free | Every benchmark run |
| **Perfetto Trace Processor** (`trace_processor_shell`) | SQL-based metric extraction from `.perfetto-trace` files | Free | Post-processing every trace |
| **Perfetto FrameTimeline** | Jank attribution (Android 12+ Pixel 4 supported) | Free | UI traversal/filter scenarios |
| **Chrome DevTools remote debugging** (`chrome://inspect`) | WebView JS profiling, flame charts, memory snapshots | Free | JS-side drill-down |
| **Android Studio CPU Profiler** | Method-level Java/Kotlin sampling and tracing | Free | Native plugin drill-down |
| **Android Studio Memory Profiler** | Heap dumps, allocation tracking | Free | Memory leak investigation |
| **`adb shell dumpsys meminfo <pid>`** | PSS/Dalvik/native heap snapshot | Free | Quick memory checks |
| **`adb shell dumpsys gfxinfo <pkg>`** | Frame render time histograms | Free | Frame jank validation |
| **`ci/telemetry/android/monitor_android.sh`** | Continuous CPU/RSS/PSS/thread sampling | Free (in-repo) | Background telemetry during scenarios |

#### Docker-backed web (secondary target)

| Tool | Purpose | Cost | When to use |
|------|---------|------|-------------|
| **Chrome DevTools Performance** | Flame charts, long tasks, layout/style costs | Free | Every web benchmark |
| **Chrome DevTools Memory** | Heap snapshots, allocation timeline | Free | Memory investigation |
| **Playwright `performance.measure()`** | Wall-clock timing with assertions | Free | CI budgets |
| **Saved DevTools traces** (`.json` export) | Artifact retention and before/after comparison | Free | Every benchmark run |
| **`performance.measureUserAgentSpecificMemory()`** | Cross-origin isolated memory measurement | Free | Memory budget checks |

#### iOS (lower-priority research lane)

| Tool | Purpose | Cost | When to use |
|------|---------|------|-------------|
| **Xcode Instruments Time Profiler** | CPU sampling | Free (requires macOS + Xcode) | Low-hanging fruit |
| **Xcode Instruments Allocations** | Heap allocation tracking | Free | Memory investigation |
| **Xcode Instruments Leaks** | Leak detection | Free | Regression checks |
| **`xctrace`** CLI | Command-line Instruments recording | Free | Automation-friendly |

### 5.2 By problem type

| Problem | Primary tool | Secondary tool |
|---------|-------------|----------------|
| Wall-clock regression | Playwright / Maestro timing | Perfetto slice durations |
| CPU hotspot | Perfetto scheduling + CPU slices | Android Studio CPU Profiler |
| Memory pressure | `dumpsys meminfo` + Perfetto `process_stats` | Chrome DevTools Memory |
| JS long task | Chrome DevTools Performance | `performance.measure()` |
| Jank / dropped frames | Perfetto FrameTimeline | `dumpsys gfxinfo` |
| IndexedDB / storage I/O | Chrome DevTools Performance (storage events) | Perfetto `ftrace` I/O |
| Native plugin hotspot | Android Studio CPU Profiler (Java sampling) | Perfetto `atrace` slices |

---

## 6. Exact Benchmark Scenarios

### 6.1 Benchmark matrix

| ID | Scenario | Pixel 4 | Emulator | Docker web |
|----|----------|---------|----------|------------|
| S1 | Download full HVSC from mock (5 MiB/s) | ✓ | ✓ | ✓ |
| S2 | Ingest cached HVSC (cold) | ✓ | ✓ | ✓ |
| S3 | Open add-items → enter HVSC root | ✓ | ✓ | ✓ |
| S4 | Traverse down: root → MUSICIANS → H → Hubbard_Rob | ✓ | ✓ | ✓ |
| S5 | Traverse back up: Hubbard_Rob → root | ✓ | ✓ | ✓ |
| S6 | Add entire HVSC library to playlist | ✓ | ✓ | ✓ |
| S7 | Open/render 60K+ playlist | ✓ | — | ✓ |
| S8 | Filter 60K+ playlist: "hubbard" (high match) | ✓ | — | ✓ |
| S9 | Filter 60K+ playlist: "xyzzy123" (zero match) | ✓ | — | ✓ |
| S10 | Filter 60K+ playlist: "Commando" (low match) | ✓ | — | ✓ |
| S11 | Start playback from filtered result | ✓ | — | ✓ |

### 6.2 Per-scenario specification

#### S1: Download full HVSC from mock (5 MiB/s)

**Preconditions**:
- App freshly installed, no HVSC cache
- Mock HVSC provider running, serving fixed archive fixture, throttled to 5 MiB/s
- Pixel 4 connected via USB with WiFi to the same LAN as mock server
- For Docker web: mock server accessible from container network

**Warm-up**: 1 run discarded (cold JIT, DNS, first connection)

**Runs**: 5 measured runs

**Artifact capture**:
- Perfetto trace per run (Pixel 4)
- Chrome DevTools trace per run (Docker web)
- App-level timing JSON per run
- Telemetry CSV per run (Pixel 4)

**Success metrics**:
- Wall-clock download time < 20 s (all 5 runs)
- Peak JS heap growth < 100 MiB above pre-download baseline (web path)
- Peak PSS growth < 150 MiB above pre-download baseline (native path)
- No checksum failures

**Failure signatures**:
- Wall-clock > 20 s
- OOM crash or low-memory kill
- Checksum mismatch
- Download truncation

#### S2: Ingest cached HVSC (cold)

**Preconditions**:
- Archive downloaded and cached (S1 complete)
- No existing browse index or library directory
- App cold-started (force-stop + clear WebView cache, but keep archive cache)

**Warm-up**: 1 run discarded

**Runs**: 5 measured runs

**Artifact capture**:
- Perfetto trace per run (Pixel 4)
- Chrome DevTools trace per run (Docker web)
- App-level timing JSON per run
- `dumpsys meminfo` snapshots at start, mid-ingest (30K files), and end

**Success metrics**:
- Wall-clock ingest time < 25 s
- All 60,582+ songs ingested (0 failures)
- Browse index persisted and loadable
- Songlengths loaded and resolving

**Failure signatures**:
- Wall-clock > 25 s
- Failed song count > 0
- OOM or ANR
- Incomplete browse index

#### S3: Open add-items → enter HVSC root

**Preconditions**:
- HVSC fully ingested (browse index populated)
- App on Play page with empty playlist

**Warm-up**: 1 run (cache the index load)

**Runs**: 5 measured runs (first run is cold index load)

**Success metrics**:
- Cold open (first load of browse index): < 2 s
- Warm open (index cached): < 1 s
- No jank frames > 32 ms during folder render

**Failure signatures**:
- Time to interactive > 2 s
- Visible hang or blank folder list
- Jank count > 5 in FrameTimeline

#### S4: Traverse down deep directory

Path: root → MUSICIANS → H → Hubbard_Rob

**Preconditions**: S3 complete, HVSC root visible

**Runs**: 5 measured runs per navigation step (3 steps × 5 runs = 15 measurements)

**Success metrics**:
- Each step < 2 s wall-clock, P50 < 1 s
- No dropped frames > 32 ms during transition

#### S5: Traverse back up to root

Path: Hubbard_Rob → H → MUSICIANS → root

**Preconditions**: S4 complete

**Runs**: 5 measured runs per step

**Success metrics**: Same as S4

#### S6: Add entire HVSC library to playlist

**Preconditions**: HVSC root folder selected in add-items

**Runs**: 3 measured runs (more expensive scenario)

**Artifact capture**:
- Perfetto trace (full duration)
- Chrome DevTools trace
- Memory snapshots at 0%, 25%, 50%, 75%, 100%
- App-level timing with per-batch markers

**Success metrics**:
- Total add time < 60 s (no hard budget specified; establish baseline)
- Peak memory < 512 MiB PSS on Pixel 4
- No OOM or ANR
- Playlist item count matches HVSC total

**Failure signatures**:
- OOM crash
- ANR (> 5 s UI thread block)
- Count mismatch

#### S7: Open/render 60K+ playlist

**Preconditions**: S6 complete, 60K+ items in playlist

**Runs**: 5 measured runs

**Success metrics**:
- Time to first visible item < 1 s
- Scroll jank: < 5 dropped frames per 100 frames

#### S8–S10: Filter operations

**Preconditions**: S7 complete

**Runs**: 5 measured runs per filter query

| ID | Query | Expected cardinality | Budget |
|----|-------|---------------------|--------|
| S8 | "hubbard" | ~200–500 matches | < 2 s |
| S9 | "xyzzy123" | 0 matches | < 2 s |
| S10 | "Commando" | ~10–30 matches | < 2 s |

**Success metrics**:
- Filter application time < 2 s, P50 < 1 s
- Result count rendered correctly
- No UI freeze during filter

#### S11: Start playback from filtered result

**Preconditions**: S8 complete, first filtered result visible

**Runs**: 5 measured runs

**Success metrics**:
- Time from tap to first audio frame < 1 s
- SID data loaded and decoded within 500 ms

---

## 7. Required Instrumentation Plan

### 7.1 Layer 1: App-level instrumentation

Add structured timing marks around each phase. Use `performance.mark()` and `performance.measure()` for web/WebView, and emit structured JSON events for both platforms.

#### Naming convention

```
hvsc:perf:<phase>:<event>
```

Examples:
```
hvsc:perf:download:start
hvsc:perf:download:end
hvsc:perf:download:checksum:start
hvsc:perf:download:checksum:end
hvsc:perf:ingest:extract:start
hvsc:perf:ingest:extract:end
hvsc:perf:ingest:write-sid:<n>
hvsc:perf:ingest:index-build:start
hvsc:perf:ingest:index-build:end
hvsc:perf:ingest:songlengths:start
hvsc:perf:ingest:songlengths:end
hvsc:perf:browse:load-snapshot:start
hvsc:perf:browse:load-snapshot:end
hvsc:perf:browse:query:start
hvsc:perf:browse:query:end
hvsc:perf:browse:render:start
hvsc:perf:browse:render:end
hvsc:perf:playlist:add-batch:start
hvsc:perf:playlist:add-batch:end
hvsc:perf:playlist:filter:start
hvsc:perf:playlist:filter:end
hvsc:perf:playlist:repo-sync:start
hvsc:perf:playlist:repo-sync:end
hvsc:perf:playback:load-sid:start
hvsc:perf:playback:load-sid:end
hvsc:perf:playback:first-audio:start
```

#### Persistence

Timing marks should be accumulated in a ring buffer (last 1000 marks) and exportable as JSON via the diagnostics overlay. For benchmark scenarios, a dedicated `collectPerfTimings()` function should return all marks since last reset.

### 7.2 Layer 2: Android system tracing on Pixel 4

#### Perfetto capture command

```bash
adb shell perfetto \
  -c - --txt \
  -o /data/misc/perfetto-traces/hvsc-benchmark.perfetto-trace \
  <<EOF
buffers: {
  size_kb: 65536
  fill_policy: RING_BUFFER
}
data_sources: {
  config {
    name: "linux.process_stats"
    process_stats_config {
      scan_all_processes_on_start: true
      proc_stats_poll_ms: 500
    }
  }
}
data_sources: {
  config {
    name: "linux.ftrace"
    ftrace_config {
      ftrace_events: "sched/sched_switch"
      ftrace_events: "sched/sched_waking"
      ftrace_events: "power/cpu_frequency"
      ftrace_events: "power/suspend_resume"
      ftrace_events: "mm_event/mm_event_record"
      atrace_categories: "view"
      atrace_categories: "webview"
      atrace_categories: "wm"
      atrace_categories: "am"
      atrace_categories: "dalvik"
      atrace_categories: "binder_driver"
      atrace_apps: "uk.gleissner.c64commander"
    }
  }
}
data_sources: {
  config {
    name: "android.surfaceflinger.frametimeline"
  }
}
duration_ms: 120000
EOF
```

#### What to capture and why

| Data source | Extracts | Why |
|------------|----------|-----|
| `sched/sched_switch` + `sched_waking` | CPU time per thread, scheduling latency | Identify if main thread is CPU-bound or waiting |
| `power/cpu_frequency` | CPU governor state | Detect thermal throttling on sustained loads |
| `process_stats` | RSS, PSS, swap, OOM score | Memory pressure tracking |
| `atrace` categories | View rendering, WebView, activity manager, Dalvik GC | Correlate app operations with system events |
| `binder_driver` | Binder transaction timing | Measure Capacitor bridge overhead |
| `surfaceflinger.frametimeline` | Per-frame jank attribution | Identify UI thread vs GPU vs compositor delays |

#### Post-processing with Trace Processor

```bash
# Extract wall-clock duration of app-visible trace sections
trace_processor_shell hvsc-benchmark.perfetto-trace <<SQL
SELECT
  name,
  ts / 1e6 AS start_ms,
  dur / 1e6 AS dur_ms
FROM slice
WHERE name LIKE 'hvsc:%'
ORDER BY ts;
SQL

# Extract frame jank metrics (FrameTimeline)
trace_processor_shell hvsc-benchmark.perfetto-trace <<SQL
SELECT
  jank_type,
  COUNT(*) AS jank_count,
  AVG(dur / 1e6) AS avg_frame_ms,
  MAX(dur / 1e6) AS max_frame_ms
FROM expected_frame_timeline_slice
WHERE upid IN (
  SELECT upid FROM process WHERE name = 'uk.gleissner.c64commander'
)
GROUP BY jank_type;
SQL

# Extract memory counters over time
trace_processor_shell hvsc-benchmark.perfetto-trace <<SQL
SELECT
  ts / 1e9 AS time_s,
  value / 1024 AS value_kb,
  name
FROM counter
JOIN counter_track ON counter.track_id = counter_track.id
WHERE counter_track.name IN ('mem.rss', 'mem.vms', 'oom_score_adj')
AND upid IN (
  SELECT upid FROM process WHERE name LIKE '%c64commander%'
)
ORDER BY ts;
SQL
```

### 7.3 Layer 3: Android drill-down profiling

Use these when Perfetto identifies a hotspot but doesn't show which methods are responsible:

**Android Studio CPU Profiler** (Java/Kotlin method tracing):
- Connect via Android Studio → Profiler → CPU
- Record sample-based or instrumented trace during the specific phase
- Use for: native ingestion plugin hot methods, Filesystem bridge overhead, 7z decompressor

**Android Studio Memory Profiler** (heap dumps):
- Capture heap dump at peak PSS during ingest
- Use for: identifying retained objects, duplicate buffers, string allocations
- Command-line alternative: `adb shell am dumpheap <pid> /data/local/tmp/hvsc-heap.hprof`

**`dumpsys` tools**:
```bash
# Memory snapshot
adb shell dumpsys meminfo uk.gleissner.c64commander

# Frame render times
adb shell dumpsys gfxinfo uk.gleissner.c64commander framestats

# Reset frame stats before measurement
adb shell dumpsys gfxinfo uk.gleissner.c64commander reset
```

### 7.4 Layer 4: Web and Android WebView profiling

#### Docker-backed web in desktop Chrome

1. Open app at `http://<host>:8064`
2. Open Chrome DevTools → Performance tab
3. Record during scenario execution
4. Save trace as `.json` file
5. Key metrics to extract:
   - Long tasks (> 50 ms) count and duration
   - Layout/style recalculation count
   - JS heap size timeline
   - Paint/composite time

#### Capacitor Android WebView via remote debugging

1. Ensure debug build has `WebView.setWebContentsDebuggingEnabled(true)` (default in debug builds)
2. Open `chrome://inspect` on desktop Chrome
3. Select the WebView instance under the app
4. Same DevTools workflow as desktop Chrome
5. **Key difference**: also correlate with Perfetto native traces

#### When Playwright is sufficient vs. not

| Task | Playwright sufficient? | Notes |
|------|----------------------|-------|
| Wall-clock budget assertion | Yes | Use `performance.measure()` + assertion |
| Reproducible scenario script | Yes | Drive navigation, clicks, input |
| Long task identification | Partial | Can detect via `PerformanceObserver` but limited detail |
| Flame chart analysis | No | Requires Chrome DevTools trace |
| Memory heap analysis | No | Requires Chrome DevTools Memory |
| Layout/rendering costs | No | Requires Chrome DevTools Performance |
| IndexedDB transaction timing | Partial | Via `performance.measure()` in app code |

### 7.5 Layer 5: Automation and reproducibility

#### Maestro role (Pixel 4 real-device benchmark)

Maestro drives the real-device flow for S1–S11 but does not profile:

```yaml
# Example: benchmark-hvsc-ingest.yaml
appId: ${APP_ID}
env:
  APP_ID: ${APP_ID || "uk.gleissner.c64commander"}
  HVSC_MOCK_URL: ${HVSC_MOCK_URL || "http://10.0.2.2:9876"}
  LONG_TIMEOUT: ${LONG_TIMEOUT || 60000}
---
- launchApp:
    clearState: true
- tapOn: "Settings"
- scroll
- tapOn: "HVSC"
# Configure mock URL and trigger install
# Wait for completion
- extendedWaitUntil:
    visible: "HVSC installed"
    timeout: ${LONG_TIMEOUT}
```

Maestro provides:
- Deterministic user flow execution
- Screenshots at each benchmark step
- Coarse timing (flow-level, not phase-level)

Maestro does NOT provide:
- Method-level profiling
- Memory analysis
- Frame-time data (use Perfetto for that)

#### Playwright role (Docker web benchmark)

Playwright drives web scenarios with timing assertions:

```typescript
// Example: benchmark wall-clock budget
test('HVSC ingest completes within 25s', async ({ page }) => {
  const start = await page.evaluate(() => performance.now());
  // ... trigger ingest ...
  await page.waitForSelector('[data-hvsc-state="ready"]', { timeout: 30000 });
  const duration = await page.evaluate((s) => performance.now() - s, start);
  expect(duration).toBeLessThan(25000);
});
```

---

## 8. Artifact Plan and Directory Layout

```
artifacts/perf/hvsc/
├── baseline/                          # Pre-optimization measurements
│   ├── android-pixel4/
│   │   ├── S1-download/
│   │   │   ├── run-1.perfetto-trace
│   │   │   ├── run-1.timing.json
│   │   │   ├── run-1.telemetry.csv
│   │   │   ├── ...
│   │   │   └── run-5.perfetto-trace
│   │   ├── S2-ingest/
│   │   ├── S3-browse-open/
│   │   ├── S4-traverse-down/
│   │   ├── S5-traverse-up/
│   │   ├── S6-add-all/
│   │   ├── S7-render-playlist/
│   │   ├── S8-filter-high/
│   │   ├── S9-filter-zero/
│   │   ├── S10-filter-low/
│   │   └── S11-playback-start/
│   ├── android-emulator/
│   │   └── (same structure, S1-S6 only)
│   └── web-docker/
│       ├── S1-download/
│       │   ├── run-1.devtools-trace.json
│       │   ├── run-1.timing.json
│       │   └── ...
│       └── (same scenarios)
├── after-change/
│   └── <change-id>/                   # e.g., "indexed-browse-store"
│       ├── android-pixel4/
│       ├── android-emulator/
│       └── web-docker/
├── traces/                            # Raw Perfetto traces for archival
├── sql/                               # Trace Processor SQL scripts
│   ├── extract-hvsc-slices.sql
│   ├── extract-frame-jank.sql
│   ├── extract-memory-counters.sql
│   └── extract-scheduling-latency.sql
├── reports/                           # Generated summary reports
│   ├── baseline-summary.md
│   └── <change-id>-comparison.md
└── mock-provider/                     # Mock HVSC server configuration
    ├── README.md
    ├── fixture/                        # Fixed archive fixture
    └── config/                         # Throttle and logging config
```

---

## 9. Bottleneck Taxonomy

Based on codebase archaeology, five distinct bottleneck categories are identified:

### B1: Download to cache

**Evidence**: `hvscDownload.ts` lines 152–199 (`streamToBuffer`) allocate the full archive in JS heap on web paths. Native path uses `Filesystem.downloadFile()` but then performs a separate full-archive checksum pass. Base64 encoding/decoding adds ~33% overhead on bridge transfers.

**Symptoms**: JS heap spike of ~80 MiB (archive size) plus base64 expansion. On Pixel 4, additional PSS from native download buffer. Checksum requires re-reading the entire archive.

### B2: Ingest and index build

**Evidence**: `hvscIngestionRuntime.ts` `ingestArchiveBuffer()` calls `extractArchiveEntries()` which, on the web path, requires the full archive buffer in JS memory. Then writes each of 60,582+ SID files individually through `Filesystem.writeFile()` with base64 encoding (per-file overhead: `ensureDir()` + `writeFileWithRetry()` → `uint8ToBase64()` → Filesystem bridge call). Browse index built in memory then serialized as JSON.

**Symptoms**: Dominated by I/O and bridge overhead. 60K base64 encode + write operations. Memory: full archive + extraction working set + index build.

### B3: HVSC browse traversal

**Evidence**: `hvscBrowseIndexStore.ts` `loadHvscBrowseIndexSnapshot()` reads and parses the entire JSON snapshot (~15–25 MiB). `listFolderFromBrowseIndex()` performs linear `.filter()` + `.sort()` on the song arrays per folder. `hvscService.ts` `ensureHvscIndexReady()` may rebuild the full snapshot if integrity check fails.

**Symptoms**: First-open latency dominated by snapshot load + parse. Per-navigation latency from sort + filter. Memory: full snapshot retained in memory.

### B4: Playlist add, render, and filter at scale

**Evidence**: `addFileSelections.ts` appends batches via `setPlaylist(prev => [...prev, ...resolvedItems])` — each batch creates a new array by spreading the entire existing playlist. `useQueryFilteredPlaylist.ts` re-serializes the full playlist into IndexedDB on every change. `indexedDbRepository.ts` `queryPlaylist()` reads items in chunks of 200 with sequential IndexedDB transactions.

**Symptoms**: O(n²) array growth during add. Full IndexedDB write on every playlist change. Chunked reads for filter queries. Full `PlaylistItem[]` in React state.

### B5: Playback start latency

**Evidence**: `hvscFilesystem.ts` `getHvscSongByVirtualPath()` reads the SID file through `readFileWithSizeGuard()` (base64 bridge), then resolves songlengths on demand. `hvscSource.ts` `getSong()` decodes base64 to Uint8Array for playback.

**Symptoms**: Two base64 conversions per playback start (read + decode). Songlength resolution may trigger cold-start load of the entire songlengths database.

---

## 10. Solution Options per Bottleneck

### B1: Download to cache — 6 options

#### B1-O1: Native streaming download with incremental checksum

Write a Capacitor plugin method that downloads directly to file while computing MD5 incrementally in the same native stream pass. Zero JS heap allocation for archive bytes.

| Criterion | Score |
|-----------|-------|
| Expected impact | 5 |
| Confidence | 5 |
| Engineering effort | 3 |
| Risk | Low — native download already works; adding streaming checksum is well-understood |
| Reversibility | High — feature-flaggable |
| Android benefit | 5 |
| Web benefit | 0 (native-only) |
| iOS benefit | 4 (same pattern on iOS) |

#### B1-O2: Move checksum to native post-download stream

Keep existing `Filesystem.downloadFile()` but add a native method `computeFileChecksumMd5(path)` that reads the file in native code without base64 bridging.

| Criterion | Score |
|-----------|-------|
| Expected impact | 4 |
| Confidence | 5 |
| Engineering effort | 2 |
| Risk | Very low |
| Reversibility | High |
| Android benefit | 4 |
| Web benefit | 0 |
| iOS benefit | 3 |

#### B1-O3: Resumable/range-aware downloads

Add HTTP Range support to resume interrupted downloads. Reduces repeated full-archive transfers but doesn't improve peak memory or checksum cost.

| Criterion | Score |
|-----------|-------|
| Expected impact | 3 |
| Confidence | 3 |
| Engineering effort | 4 |
| Risk | Medium — requires server support, edge cases |
| Reversibility | High |
| Android benefit | 3 |
| Web benefit | 3 |
| iOS benefit | 3 |

#### B1-O4: Eliminate JS-visible archive bytes on native

On native builds, download + checksum + extract entirely in native code. JS never sees the archive bytes. Only metadata and progress events cross the bridge.

| Criterion | Score |
|-----------|-------|
| Expected impact | 5 |
| Confidence | 4 |
| Engineering effort | 3 |
| Risk | Low — native ingestion already exists; extend it |
| Reversibility | High |
| Android benefit | 5 |
| Web benefit | 0 |
| iOS benefit | 4 |

#### B1-O5: Pre-size output buffer and avoid reallocation on web

In `streamToBuffer()`, use `Content-Length` to pre-allocate the `Uint8Array` (already partially done for known-size responses). Ensure the dynamic-growth path uses larger initial capacity.

| Criterion | Score |
|-----------|-------|
| Expected impact | 2 |
| Confidence | 4 |
| Engineering effort | 1 |
| Risk | Very low |
| Reversibility | High |
| Android benefit | 0 (web path only) |
| Web benefit | 2 |
| iOS benefit | 0 |

#### B1-O6: Binary bridge API (ArrayBuffer transfer without base64)

Use Capacitor's `DataView` or a custom binary bridge to transfer chunks without base64 encoding/decoding, reducing ~33% overhead.

| Criterion | Score |
|-----------|-------|
| Expected impact | 4 |
| Confidence | 4 |
| Engineering effort | 4 |
| Risk | Medium — requires changes to Capacitor bridge layer |
| Reversibility | Medium |
| Android benefit | 4 |
| Web benefit | 0 |
| iOS benefit | 4 |

### B2: Ingest and index build — 6 options

#### B2-O1: Stream extraction directly into indexed storage

Extract each SID entry and write it directly to an indexed database (SQLite or IndexedDB) instead of individual filesystem files. Eliminates 60K filesystem operations.

| Criterion | Score |
|-----------|-------|
| Expected impact | 5 |
| Confidence | 4 |
| Engineering effort | 5 |
| Risk | High — changes storage layer architecture |
| Reversibility | Medium |
| Android benefit | 5 |
| Web benefit | 5 |
| iOS benefit | 5 |

#### B2-O2: Batch filesystem writes with combined base64 payloads

Group multiple SID files into single native plugin calls that write N files per bridge invocation, reducing per-file bridge overhead from 60K calls to ~120 calls (500-file batches).

| Criterion | Score |
|-----------|-------|
| Expected impact | 5 |
| Confidence | 5 |
| Engineering effort | 3 |
| Risk | Low — batching is a well-understood optimization |
| Reversibility | High |
| Android benefit | 5 |
| Web benefit | 3 (still needs base64 but fewer calls) |
| iOS benefit | 4 |

#### B2-O3: Persist pre-sorted folder/song index during ingest

Instead of building `songs: Record<string, HvscBrowseIndexedSong>` in memory and then computing `folders` at finalize, maintain a pre-sorted index structure incrementally during extraction. Persist each folder row as it becomes complete.

| Criterion | Score |
|-----------|-------|
| Expected impact | 4 |
| Confidence | 4 |
| Engineering effort | 3 |
| Risk | Low |
| Reversibility | High |
| Android benefit | 4 |
| Web benefit | 4 |
| iOS benefit | 4 |

#### B2-O4: Defer non-essential metadata parsing until first access

During ingest, only write the SID file and record `virtualPath` and `fileName`. Parse `sidMetadata` (name, author, clock, SID model) lazily on first browse access or in a background pass.

| Criterion | Score |
|-----------|-------|
| Expected impact | 3 |
| Confidence | 4 |
| Engineering effort | 3 |
| Risk | Low — metadata is already nullable in the index |
| Reversibility | High |
| Android benefit | 3 |
| Web benefit | 3 |
| iOS benefit | 3 |

#### B2-O5: Resumable ingest with checkpoints

Save a progress marker after every N files so that interrupted ingests can resume from the last checkpoint instead of restarting.

| Criterion | Score |
|-----------|-------|
| Expected impact | 4 |
| Confidence | 4 |
| Engineering effort | 4 |
| Risk | Medium — checkpoint/resume state complexity |
| Reversibility | High |
| Android benefit | 4 |
| Web benefit | 4 |
| iOS benefit | 4 |

#### B2-O6: Offload web ingest to a Web Worker

Move the extraction + write loop to a dedicated Worker thread so the UI remains responsive during ingest. Use `postMessage` with `Transferable` `ArrayBuffer` to avoid copies.

| Criterion | Score |
|-----------|-------|
| Expected impact | 4 |
| Confidence | 4 |
| Engineering effort | 4 |
| Risk | Medium — Worker has no Capacitor Filesystem access; must use IndexedDB or message back |
| Reversibility | High |
| Android benefit | 3 (WebView Worker) |
| Web benefit | 5 |
| iOS benefit | 3 |

### B3: HVSC browse traversal — 6 options

#### B3-O1: Replace JSON snapshot with IndexedDB-backed browse store

Store each folder row as an IndexedDB record keyed by parent path. Queries read only the relevant folder row, not the entire index. Eliminates full-snapshot load.

| Criterion | Score |
|-----------|-------|
| Expected impact | 5 |
| Confidence | 5 |
| Engineering effort | 4 |
| Risk | Low — IndexedDB is already used for playlists |
| Reversibility | High — can fall back to JSON snapshot |
| Android benefit | 5 |
| Web benefit | 5 |
| iOS benefit | 5 |

#### B3-O2: Serve paged folder rows with precomputed sort keys

Pre-sort folder and song lists at ingest time. Store them sorted. Navigation queries need only slice, not sort.

| Criterion | Score |
|-----------|-------|
| Expected impact | 5 |
| Confidence | 5 |
| Engineering effort | 3 |
| Risk | Very low |
| Reversibility | High |
| Android benefit | 5 |
| Web benefit | 5 |
| iOS benefit | 5 |

#### B3-O3: Cache only current folder + parent chain in memory

Instead of loading the full snapshot, maintain a small LRU cache of recently visited folder rows. Load new folder rows on demand from the persistent store.

| Criterion | Score |
|-----------|-------|
| Expected impact | 4 |
| Confidence | 4 |
| Engineering effort | 3 |
| Risk | Low |
| Reversibility | High |
| Android benefit | 4 |
| Web benefit | 4 |
| iOS benefit | 4 |

#### B3-O4: Move browse query off main thread

Execute browse queries in a Web Worker (web) or on a background thread (native) to prevent UI jank during folder navigation.

| Criterion | Score |
|-----------|-------|
| Expected impact | 4 |
| Confidence | 4 |
| Engineering effort | 3 |
| Risk | Low — read-only queries are safe to offload |
| Reversibility | High |
| Android benefit | 4 |
| Web benefit | 4 |
| iOS benefit | 4 |

#### B3-O5: Store folder cardinality metadata at ingest

Record `childFolderCount` and `childSongCount` for each folder at ingest time so the UI can display counts without scanning.

| Criterion | Score |
|-----------|-------|
| Expected impact | 3 |
| Confidence | 4 |
| Engineering effort | 2 |
| Risk | Very low |
| Reversibility | High |
| Android benefit | 3 |
| Web benefit | 3 |
| iOS benefit | 3 |

#### B3-O6: Memoize recent traversal results

Cache the last N folder query results with eviction by path+query. Avoids redundant filter/sort on back-navigation.

| Criterion | Score |
|-----------|-------|
| Expected impact | 3 |
| Confidence | 3 |
| Engineering effort | 2 |
| Risk | Very low |
| Reversibility | High |
| Android benefit | 3 |
| Web benefit | 3 |
| iOS benefit | 3 |

### B4: Playlist add, render, and filter at scale — 6 options

#### B4-O1: Repository-authoritative, windowed UI state

Make the IndexedDB/native repository the single source of truth. React state holds only the current visible window (e.g., 100 items). All queries go through the repository.

| Criterion | Score |
|-----------|-------|
| Expected impact | 5 |
| Confidence | 5 |
| Engineering effort | 5 |
| Risk | High — fundamental architecture change to playlist state |
| Reversibility | Low |
| Android benefit | 5 |
| Web benefit | 5 |
| iOS benefit | 5 |

#### B4-O2: Streaming batch insert without full-array accumulation

Instead of `setPlaylist(prev => [...prev, ...batch])`, append batches directly to the repository and increment a revision counter. The UI observes the revision and queries for the current page.

| Criterion | Score |
|-----------|-------|
| Expected impact | 5 |
| Confidence | 5 |
| Engineering effort | 3 |
| Risk | Medium — requires reworking playlist mutation patterns |
| Reversibility | Medium |
| Android benefit | 5 |
| Web benefit | 5 |
| iOS benefit | 5 |

#### B4-O3: Full-text search or trigram index for filtering

Replace linear string-includes filtering with a precomputed trigram index (already partially implemented in `queryIndex.ts`). Ensure the index is used on the hot path and covers all searchable fields.

| Criterion | Score |
|-----------|-------|
| Expected impact | 5 |
| Confidence | 4 |
| Engineering effort | 3 |
| Risk | Low — `queryIndex.ts` already has trigram infrastructure |
| Reversibility | High |
| Android benefit | 5 |
| Web benefit | 5 |
| iOS benefit | 5 |

#### B4-O4: Split track catalog from playlist-instance state

Store track metadata (title, author, path, duration) once in a shared catalog. Playlist items reference tracks by ID. Filtering touches only the catalog index, not per-playlist-item data.

| Criterion | Score |
|-----------|-------|
| Expected impact | 4 |
| Confidence | 5 |
| Engineering effort | 3 |
| Risk | Low — `TrackRecord` and `PlaylistItemRecord` already separated |
| Reversibility | High |
| Android benefit | 4 |
| Web benefit | 4 |
| iOS benefit | 4 |

#### B4-O5: Avoid full re-serialization on batch append

When appending a batch, write only the new items + update the order index incrementally, rather than replacing all items.

| Criterion | Score |
|-----------|-------|
| Expected impact | 4 |
| Confidence | 4 |
| Engineering effort | 3 |
| Risk | Low |
| Reversibility | High |
| Android benefit | 4 |
| Web benefit | 4 |
| iOS benefit | 4 |

#### B4-O6: Debounce + cancellation for filter requests

Add a 150 ms debounce to filter input and cancel in-flight queries when a new character is typed.

| Criterion | Score |
|-----------|-------|
| Expected impact | 2 |
| Confidence | 5 |
| Engineering effort | 1 |
| Risk | Very low |
| Reversibility | High |
| Android benefit | 2 |
| Web benefit | 2 |
| iOS benefit | 2 |

### B5: Playback start latency — 5 options

#### B5-O1: Persist all duration and playback metadata at ingest

During ingest, write duration, subsong count, and SID header metadata into the browse index. Eliminates on-demand songlength resolution at playback time.

| Criterion | Score |
|-----------|-------|
| Expected impact | 4 |
| Confidence | 5 |
| Engineering effort | 2 |
| Risk | Very low — metadata is already parsed during ingest |
| Reversibility | High |
| Android benefit | 4 |
| Web benefit | 4 |
| iOS benefit | 4 |

#### B5-O2: Native file path playback (bypass base64 bridge)

On native builds, pass the filesystem path directly to the SID player instead of reading, base64-encoding, transferring to JS, and decoding.

| Criterion | Score |
|-----------|-------|
| Expected impact | 4 |
| Confidence | 4 |
| Engineering effort | 4 |
| Risk | Medium — requires SID player to accept file paths |
| Reversibility | High |
| Android benefit | 4 |
| Web benefit | 0 |
| iOS benefit | 4 |

#### B5-O3: Pre-resolve next playable item during idle

When the current song is playing, preload the next song's SID data and metadata in the background.

| Criterion | Score |
|-----------|-------|
| Expected impact | 2 |
| Confidence | 4 |
| Engineering effort | 2 |
| Risk | Low |
| Reversibility | High |
| Android benefit | 2 |
| Web benefit | 2 |
| iOS benefit | 2 |

#### B5-O4: LRU cache for recently played SID data

Cache the last N decoded SID buffers in memory to avoid re-reading for repeat plays.

| Criterion | Score |
|-----------|-------|
| Expected impact | 2 |
| Confidence | 3 |
| Engineering effort | 2 |
| Risk | Low — bounded cache size |
| Reversibility | High |
| Android benefit | 2 |
| Web benefit | 2 |
| iOS benefit | 2 |

#### B5-O5: Separate playback-start timing from browse/filter timing

Add dedicated timing marks for playback-start so it can be measured independently. This is a measurement improvement, not a performance improvement, but critical for attributing wins correctly.

| Criterion | Score |
|-----------|-------|
| Expected impact | 3 (measurement value) |
| Confidence | 5 |
| Engineering effort | 1 |
| Risk | Very low |
| Reversibility | High |
| Android benefit | 3 |
| Web benefit | 3 |
| iOS benefit | 3 |

---

## 11. Grading Rubric

Each solution option is graded on:

| Criterion | Scale | Definition |
|-----------|-------|------------|
| **Expected impact** | 1–5 | 1 = negligible improvement; 5 = transformative improvement |
| **Confidence** | 1–5 | 1 = pure speculation; 5 = strong evidence from codebase or prior measurements |
| **Engineering effort** | 1–5 | 1 = < 1 day; 2 = 1–3 days; 3 = 3–5 days; 4 = 1–2 weeks; 5 = > 2 weeks |
| **Risk** | Very low / Low / Medium / High | Likelihood of regressions, bugs, or incomplete benefits |
| **Reversibility** | High / Medium / Low | Can the change be feature-flagged, reverted, or abandoned without lasting damage? |
| **Platform benefit** | 0–5 per platform | 0 = not applicable; 5 = large benefit |

**Composite ranking formula** (for tiebreaking):

```
score = (impact × confidence) / effort
```

Higher is better. Risk and reversibility serve as tiebreakers.

---

## 12. Ranked Top Three per Bottleneck

### B1: Download to cache

| Rank | Option | Score | Rationale |
|------|--------|-------|-----------|
| 1 | **B1-O1**: Native streaming download + incremental checksum | (5×5)/3 = 8.3 | Highest impact, highest confidence, eliminates both heap pressure and separate checksum pass |
| 2 | **B1-O4**: Eliminate JS-visible archive bytes on native | (5×4)/3 = 6.7 | Same direction as O1 but broader scope; complementary |
| 3 | **B1-O2**: Native checksum-only method | (4×5)/2 = 10.0 | Highest score per effort but lower absolute impact; good quick win |

**Implementation order**: B1-O2 first (quick win), then B1-O1 (full streaming pipeline).

### B2: Ingest and index build

| Rank | Option | Score | Rationale |
|------|--------|-------|-----------|
| 1 | **B2-O2**: Batch filesystem writes | (5×5)/3 = 8.3 | Highest confidence; directly addresses 60K per-file bridge overhead |
| 2 | **B2-O3**: Pre-sorted index during ingest | (4×4)/3 = 5.3 | Reduces finalization cost; complements O2 |
| 3 | **B2-O4**: Deferred metadata parsing | (3×4)/3 = 4.0 | Easy win; reduces per-entry work during ingest |

### B3: HVSC browse traversal

| Rank | Option | Score | Rationale |
|------|--------|-------|-----------|
| 1 | **B3-O2**: Paged folder rows with precomputed sort keys | (5×5)/3 = 8.3 | Eliminates sort on hot path; low effort |
| 2 | **B3-O1**: IndexedDB-backed browse store | (5×5)/4 = 6.25 | Eliminates full-snapshot load; transformative for memory |
| 3 | **B3-O3**: LRU folder cache | (4×4)/3 = 5.3 | Good complement to O1/O2; reduces I/O for back-navigation |

**Implementation order**: B3-O2 first (pre-sorted keys during ingest), then B3-O1 (indexed store), then B3-O3 (caching layer).

### B4: Playlist add, render, and filter at scale

| Rank | Option | Score | Rationale |
|------|--------|-------|-----------|
| 1 | **B4-O2**: Streaming batch insert | (5×5)/3 = 8.3 | Eliminates O(n²) array growth; moderate effort |
| 2 | **B4-O3**: Trigram index for filtering | (5×4)/3 = 6.7 | Leverages existing infrastructure in `queryIndex.ts` |
| 3 | **B4-O5**: Incremental order index update on append | (4×4)/3 = 5.3 | Avoids full-serialize cost; good complement to O2 |

### B5: Playback start latency

| Rank | Option | Score | Rationale |
|------|--------|-------|-----------|
| 1 | **B5-O1**: Persist metadata at ingest | (4×5)/2 = 10.0 | Highest score; very low effort; eliminates on-demand resolution |
| 2 | **B5-O5**: Dedicated playback timing | (3×5)/1 = 15.0 | Highest score but measurement-only; essential for correct attribution |
| 3 | **B5-O2**: Native file path playback | (4×4)/4 = 4.0 | Eliminates base64 round-trip; significant for native platforms |

---

## 13. Overall Ranked Top Three

Across all bottlenecks, the three highest-impact investments are:

### Rank 1: Replace JSON browse snapshot with indexed, pre-sorted storage (B3-O1 + B3-O2)

**Why**: Browse traversal is the most user-facing latency. Every navigation currently loads and parses a 15–25 MiB JSON snapshot, then sorts results linearly. Moving to per-folder-row indexed storage with precomputed sort keys transforms this from O(total songs) to O(folder size) per navigation.

**Combined impact**: Eliminates snapshot load time (~500 ms–2 s), eliminates per-navigation sort, reduces memory from ~50 MiB retained snapshot to ~10 KB per folder row.

**Confidence**: 5/5 — the current bottleneck is architecturally inherent in the JSON snapshot approach.

### Rank 2: Batch + native streaming ingest pipeline (B2-O2 + B1-O1)

**Why**: Ingest dominates wall time at first install. The current per-file write path (60K+ individual `Filesystem.writeFile()` with base64 encoding) is the primary wall-time contributor. Batching writes to 500-file native calls and streaming downloads with incremental checksums addresses both.

**Combined impact**: Expected 5–10× reduction in ingest wall time (from bridge overhead elimination). Download checksum moves from separate full-archive pass to streaming.

**Confidence**: 5/5 — bridge overhead per call is well-characterized; batching is a proven optimization.

### Rank 3: Repository-first playlist with streaming batch insert (B4-O2 + B4-O3)

**Why**: Adding 60K+ items to a playlist currently involves O(n²) array growth in React state and full re-serialization to IndexedDB. Making the repository authoritative with streaming inserts and trigram-indexed filtering enables scaling to 100K items without full in-memory hydration.

**Combined impact**: Eliminates O(n²) add cost, enables 100K scale, and brings filter latency within budget.

**Confidence**: 5/5 — the O(n²) array pattern is observable in the code; the trigram index infrastructure already exists.

---

## 14. Iterative Optimization Loop

Every optimization must follow this loop exactly. Batching multiple major changes before remeasurement is forbidden.

### Step 1: Capture clean baseline

- Run all S1–S11 scenarios on Pixel 4 and Docker web
- Use the same fixed HVSC archive fixture from the mock provider
- Use the same Maestro/Playwright scripts
- Persist all artifacts to `artifacts/perf/hvsc/baseline/`

### Step 2: Identify the single dominant bottleneck

- Analyze Perfetto traces, DevTools traces, and app-level timing
- Rank phases by wall-clock contribution
- Do not trust intuition — use measured data

### Step 3: Pick one change only

- Select the highest-ranked option for the dominant bottleneck
- If two options are complementary and tightly coupled (e.g., B3-O1 + B3-O2), they may be implemented together only if they share the same storage change

### Step 4: Implement the smallest coherent change

- Feature-flag the change where possible
- Add the narrowest regression test that fails before and passes after
- Keep the old path available for A/B comparison

### Step 5: Remeasure on the same workload

- Run the same S1–S11 scenarios
- Use the same mock provider, same fixture, same scripts
- Persist artifacts to `artifacts/perf/hvsc/after-change/<change-id>/`

### Step 6: Compare before and after

Compare across:
- Wall-clock duration per scenario
- CPU time per phase
- Peak RSS/PSS
- JS heap growth
- Jank count (FrameTimeline)
- Long task count (web)
- Items/second (ingest, add)
- Query latency percentiles (browse, filter)

### Step 7: Keep or discard

- Keep the change only if it produces a **meaningful win** (> 10% improvement on the target metric OR crosses a budget threshold)
- Discard if it regresses any other metric by > 5%
- Discard if it creates new failure modes

### Step 8: Add regression protection

- Add a Playwright wall-clock budget test for the improved scenario
- Add a Vitest microbenchmark for the improved hot path
- Update CI thresholds

### Step 9: Repeat

Return to Step 2 and identify the next dominant bottleneck from the new baseline.

---

## 15. CI Regression Strategy

### Constraints

- CI runners do not have Pixel 4 hardware
- CI runner performance is variable (noisy neighbors)
- Absolute wall-clock thresholds will produce flaky tests on CI

### Strategy: three tiers

#### Tier 1: Deterministic microbenchmarks (CI-safe)

**What**: Vitest benchmarks for repository query, trigram search, browse index lookup, and batch insert with large synthetic datasets.

**Why**: These are CPU-bound operations that can be measured deterministically without hardware variance.

**Implementation**:
```typescript
// test/benchmarks/browse-query.bench.ts
import { bench, describe } from 'vitest';

describe('browse index query', () => {
  bench('query 60K-song index for folder with 500 songs', async () => {
    const result = listFolderFromBrowseIndex(largeSnapshot, '/MUSICIANS/H/Hubbard_Rob', '', 0, 200);
    expect(result.songs.length).toBeGreaterThan(0);
  });

  bench('filter 60K-song playlist for "hubbard"', async () => {
    const result = queryPlaylistIndex(largeIndex, {
      playlistId: 'test',
      query: 'hubbard',
      offset: 0,
      limit: 200,
      sort: 'playlist-position',
    });
    expect(result.totalMatchCount).toBeGreaterThan(0);
  });
});
```

**CI assertion**: Vitest benchmarks complete within generous bounds (3× expected). Trend tracked over time.

#### Tier 2: Playwright wall-clock budgets (CI with tolerance)

**What**: Playwright tests that measure web scenario durations and assert generous budgets (2× the target).

**Why**: Playwright runs are more stable than device tests but still subject to CI variance. Using 2× budget catches major regressions without flaking on normal variance.

**Implementation**:
```typescript
test('HVSC browse folder query completes within 4s on web', async ({ page }) => {
  // ... setup with large mock dataset ...
  const start = await page.evaluate(() => performance.now());
  await page.click('[data-folder-path="/MUSICIANS"]');
  await page.waitForSelector('[data-source-entry-row]');
  const duration = await page.evaluate((s) => performance.now() - s, start);
  expect(duration).toBeLessThan(4000); // 2× the 2s budget
});
```

**CI assertion**: Hard-fail if > 2× budget. Warn if > 1.5× budget.

#### Tier 3: Maestro coarse timing on emulator (CI with trending only)

**What**: Maestro flows on Android emulator that record flow-level timing but do not hard-fail on absolute thresholds.

**Why**: Emulator performance varies significantly. Use for trend detection, not absolute gates.

**Implementation**:
- Run `smoke-hvsc.yaml` with timing capture
- Record wall-clock in CI artifacts
- Plot trend across recent runs
- Alert (not fail) if trend increases > 20% over 5 runs

#### Artifact retention for failures

When any tier misses its threshold:
- Retain Playwright traces (`.zip`)
- Retain Maestro screenshots and recordings
- Retain app-level timing JSON
- Retain telemetry CSV (emulator)
- Store in `ci-artifacts/perf/` with run ID

#### Avoiding flaky absolute-time gates

1. Use relative thresholds where possible (e.g., "ingest should not be > 2× the last green run")
2. Use percentile-based budgets (P95 of last 10 runs + 50% headroom)
3. Never hard-fail CI on emulator timing — trend only
4. Hard-fail only on Vitest microbenchmarks (deterministic) and Playwright budgets (generous 2× margin)

---

## 16. Open Questions and Validation Risks

### Open questions

1. **Pixel 4 thermal throttling**: Extended benchmark runs may trigger thermal throttling, reducing CPU frequency. Need to monitor `power/cpu_frequency` in Perfetto traces and add cool-down periods between runs.

2. **Native ingestion plugin source location**: The Kotlin native plugin for `HvscIngestion` was not found at the expected path (`android/app/src/main/java/com/c64/commander/hvsc/`). Its actual location and implementation details need to be confirmed before implementing B2-O2 (batch writes).

3. **7z-wasm memory behavior**: The 7z-wasm extraction path writes the entire archive into WASM linear memory, then extracts files from it. Peak WASM memory usage during extraction of an 80 MiB archive needs measurement.

4. **IndexedDB write throughput on Android WebView**: The maximum achievable write throughput for IndexedDB in the Pixel 4's WebView is unknown and critical for B3-O1 and B4-O2.

5. **Mock HVSC fixture size**: The current Playwright mock server uses a tiny fixture (handful of songs). A 60K-song fixture is needed for benchmark scenarios S3–S11. Options:
   - Generate a synthetic 60K-entry fixture with valid SID headers
   - Use a subset of the real HVSC archive as a fixture (licensing permitting)
   - Use the production HVSC archive fixture cached at `$HVSC_UPDATE_84_CACHE` or `~/.cache/c64commander/hvsc`

6. **RPi Zero 2W baseline**: No RPi hardware is currently available for benchmarking. Docker web on a constrained VM can approximate the memory/CPU profile. Define VM constraints: 512 MiB RAM, 1 vCPU, 1 GHz.

### Validation risks

1. **Mock provider fidelity**: A mock server that serves from memory without throttling latency jitter will produce optimistic download times. The throttle implementation must include realistic TCP behavior (not just `setTimeout` between chunks).

2. **Perfetto FrameTimeline support**: FrameTimeline requires Android 12+ (API 31+). Pixel 4 ships with Android 10 but likely has been updated to Android 12/13. Need to verify the device's actual API level.

3. **Maestro timing precision**: Maestro measures flow-level wall-clock time, not phase-level. It cannot isolate "index load time" from "render time" within a navigation step. App-level instrumentation is required for that granularity.

4. **Docker web vs. production Docker**: The development Docker image may have different characteristics than the production image (different Node.js version, different build flags). Benchmarks should use the production image.

5. **Concurrent GC impact**: Android's concurrent GC can affect timing measurements. Consider forcing a full GC before each measured run (`System.gc()` via debug bridge) to reduce variance.

---

## Mock HVSC Provider Specification

### Purpose

Serve a fixed HVSC archive fixture from disk at a controlled throughput for reproducible benchmarks on both Android and Docker web.

### Architecture

```
┌──────────────────────────────────────┐
│  Mock HVSC Provider (Node.js HTTP)   │
│                                      │
│  ┌──────────────────────────────┐    │
│  │ Fixed archive fixture (disk) │    │
│  └──────────────────────────────┘    │
│                                      │
│  ┌──────────────────────────────┐    │
│  │ Throttle: 5 MiB/s per conn  │    │
│  └──────────────────────────────┘    │
│                                      │
│  ┌──────────────────────────────┐    │
│  │ Counters + timing log        │    │
│  └──────────────────────────────┘    │
│                                      │
│  Endpoints:                          │
│  GET /                → HTML index   │
│  GET /hvsc/HVSC_N-all-of-them.7z     │
│  GET /hvsc/HVSC_Update_M.7z         │
│  HEAD /hvsc/*         → Content-Len  │
│  GET /metrics         → JSON stats   │
└──────────────────────────────────────┘
```

### Implementation sketch

Extend the existing `playwright/mockHvscServer.ts`:

```typescript
// Key additions to createMockHvscServer():

// 1. Load fixture from disk instead of generating in memory
const fixturePath = process.env.HVSC_FIXTURE_PATH
  ?? path.resolve('playwright/fixtures/hvsc/full-archive.7z');
const fixtureBuffer = fs.readFileSync(fixturePath);

// 2. Throttled response writer
const THROTTLE_BYTES_PER_SECOND = 5 * 1024 * 1024;
const CHUNK_SIZE = 64 * 1024;
const CHUNK_INTERVAL_MS = Math.floor((CHUNK_SIZE / THROTTLE_BYTES_PER_SECOND) * 1000);

const writeThrottled = (res: http.ServerResponse, buffer: Buffer) => {
  res.writeHead(200, {
    'Content-Type': 'application/x-7z-compressed',
    'Content-Length': String(buffer.length),
    ...corsHeaders,
  });
  let offset = 0;
  const writeChunk = () => {
    if (offset >= buffer.length) { res.end(); return; }
    const end = Math.min(offset + CHUNK_SIZE, buffer.length);
    res.write(buffer.subarray(offset, end));
    offset = end;
    setTimeout(writeChunk, CHUNK_INTERVAL_MS);
  };
  writeChunk();
};

// 3. Request counter and timing
const metrics = {
  requestCount: 0,
  bytesServed: 0,
  startTime: Date.now(),
  requests: [] as Array<{ url: string; startMs: number; endMs: number; bytes: number }>,
};

// 4. HEAD support
if (req.method === 'HEAD') {
  res.writeHead(200, {
    'Content-Length': String(fixtureBuffer.length),
    ...corsHeaders,
  });
  res.end();
  return;
}

// 5. Metrics endpoint
if (url === '/metrics') {
  res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
  res.end(JSON.stringify(metrics));
  return;
}
```

### Network configuration for Android

For Pixel 4 connected via USB:
1. Run mock server on the development machine on port 9876
2. Use `adb reverse tcp:9876 tcp:9876` to forward the port to the device
3. Configure the app's HVSC base URL to `http://localhost:9876/hvsc/`

For Android emulator:
1. Use the emulator's host loopback address: `http://10.0.2.2:9876/hvsc/`

For Docker web:
1. Run mock server on the host machine
2. Use `--add-host=host.docker.internal:host-gateway` or equivalent
3. Configure the app's HVSC base URL to `http://host.docker.internal:9876/hvsc/`

### Fixture preparation

For 60K-song benchmark:
```bash
# Option A: Use cached production HVSC archive
cp ~/.cache/c64commander/hvsc/HVSC_84-all-of-them.7z \
   playwright/fixtures/hvsc/full-archive.7z

# Option B: Generate synthetic fixture
node scripts/generate-hvsc-benchmark-fixture.mjs \
  --song-count 60582 \
  --output playwright/fixtures/hvsc/full-archive.7z
```

The synthetic fixture generator should:
- Create valid SID files with minimal but parseable headers
- Include a valid `Songlengths.md5` file
- Distribute songs across a realistic directory tree (~2000 folders)
- Target ~80 MiB compressed archive size

---

## iOS Research Lane (Low Priority)

iOS profiling requires macOS + Xcode. This section documents the strongest feasible plan for when macOS CI or local resources are available.

### Low-hanging fruit to investigate

1. **Same browse index optimization**: B3-O1/O2 benefits are cross-platform
2. **Same playlist optimization**: B4-O2/O3 benefits are cross-platform
3. **WKWebView profiling**: Use Safari Web Inspector for WebView JS profiling
4. **Xcode Instruments command line**: `xctrace record --template 'Time Profiler' --attach <pid>`

### iOS-specific measurement

```bash
# Record a Time Profiler trace
xctrace record \
  --template "Time Profiler" \
  --device <device-udid> \
  --attach "uk.gleissner.c64commander" \
  --output hvsc-benchmark.trace \
  --time-limit 120s

# Record memory allocations
xctrace record \
  --template "Allocations" \
  --device <device-udid> \
  --attach "uk.gleissner.c64commander" \
  --output hvsc-memory.trace \
  --time-limit 120s
```

---

## Files Prepared In This Pass

- `docs/research/hvsc/performance/hvsc-performance-research-report-2026-04-05.md` (this document)
- `docs/research/hvsc/performance/hvsc-performance-research-brief-2026-04-05.md` (companion brief, already existed)
- `docs/research/hvsc/performance/hvsc-performance-research-prompt-2026-04-05.md` (originating prompt, already existed)
