# HVSC Performance Research Brief

Date: 2026-04-05
Scope: Research-only preparation for a later measurement and optimization pass. No product changes were made in this pass.
Classification: DOC_ONLY

## Goal

Define a fact-driven, low-level performance investigation plan for the HVSC workflow on C64 Commander, with Android on a real ADB-connected Pixel 4 as the primary benchmark target and Docker-backed web as the secondary target.

The end-state budgets to design around are:

- Full HVSC download from a throttled mock provider at 5 MiB/s: less than 20 seconds.
- Full ingest of 60,582+ songs: less than 25 seconds.
- HVSC add-items traversal in either direction: less than 2 seconds worst case, with a practical P50 target below 1 second.
- Playlist filter application on very large playlists: less than 2 seconds worst case, ideally below 1 second.
- Large-playlist architecture target: 100,000 items without requiring full in-memory hydration on Pixel 4 or Raspberry Pi Zero 2W-class web targets.

## Current Repo Findings

These findings matter because they shape where measurement should start.

### 1. Download path still has expensive JS-side buffering

Relevant files:

- `src/lib/hvsc/hvscDownload.ts`
- `src/lib/hvsc/hvscFilesystem.ts`

Observed behavior:

- The web/native bridge path still contains full-buffer logic such as `streamToBuffer`, `concatChunks`, base64 decoding, and MD5 calculation over full archive buffers.
- This is likely to create avoidable JS heap pressure and duplicate memory traffic during large archive downloads.
- Existing logic appears correctness-focused, not budget-focused.

Measurement implication:

- Baseline must separately measure network time, bytes read, JS heap growth, native RSS/PSS growth, bridge copy volume, checksum time, and cache write time.

### 2. HVSC browse is still snapshot-heavy and JS-centric

Relevant files:

- `src/lib/hvsc/hvscService.ts`
- `src/lib/hvsc/hvscMediaIndex.ts`
- `src/lib/hvsc/hvscBrowseIndexStore.ts`

Observed behavior:

- HVSC browse relies on JSON snapshot persistence and in-memory browse structures.
- Folder rows and song lists are built and sorted in JS.
- Fallback behavior can rebuild browse snapshots from all entries.
- Query timing is recorded, but only at a coarse app-level layer.

Measurement implication:

- Traversal latency must be broken down into index load time, snapshot parse time, query time, sort time, bridge time, React render time, and frame/jank impact.

### 3. Recursive add is batched, but still tree-walk heavy

Relevant files:

- `src/pages/playFiles/handlers/addFileSelections.ts`

Observed behavior:

- Add-items uses batching and yields to the event loop, which is good.
- The hot path still recursively enumerates directories, resolves configs, discovers songlength files, and appends playlist batches through the UI path.
- Large-source add workflows are still likely paying repeated listing and bookkeeping costs.

Measurement implication:

- Add-all-to-playlist needs explicit per-phase markers: discovery, listing, config resolution, songlength resolution, batch write, repository sync, and UI refresh.

### 4. Playlist querying is more mature than HVSC browse, but the full playlist still exists in React state

Relevant files:

- `src/pages/playFiles/hooks/useQueryFilteredPlaylist.ts`
- `src/lib/playlistRepository/indexedDbRepository.ts`
- `src/pages/playFiles/hooks/usePlaylistManager.ts`

Observed behavior:

- Querying already uses a repository-backed path with paging and IndexedDB on supported environments.
- Filtering is better than a naive full-array scan in the hot path.
- However, the canonical playlist still lives as a full `PlaylistItem[]` in React state, and repository sync serializes the full playlist into track and playlist-item records.

Measurement implication:

- Large-playlist filtering must be measured both as repository query latency and as full-state maintenance cost.
- It is not enough to time only the repository query.

### 5. Existing telemetry is useful but insufficient

Relevant files:

- `src/lib/hvsc/hvscStatusStore.ts`
- `ci/telemetry/android/monitor_android.sh`

Observed behavior:

- The app already records some HVSC query timing and status summaries.
- There is already an Android telemetry script for CPU, RSS, PSS, and process lifecycle sampling.
- There is no coherent end-to-end HVSC performance harness yet.

Measurement implication:

- Keep the existing telemetry and extend it; do not replace it with ad hoc console timing.

## Recommended Free Tool Stack

### Primary Android stack

1. Perfetto CLI over `adb`
   Why: best system-level view of scheduling, CPU contention, process stats, memory counters, and Android frame/jank data.
   Use for: end-to-end baseline traces on the Pixel 4 and emulator.

2. Perfetto FrameTimeline
   Why: gives app-vs-SurfaceFlinger jank attribution and SQL tables for frame analysis on Android 12+.
   Use for: browse/open/filter/jank diagnosis on the Pixel 4.

3. Perfetto Trace Processor
   Why: SQL-based, scriptable post-processing of traces for deterministic metrics extraction.
   Use for: generating CSV/JSON metrics from every baseline and after-change trace.

4. Android Studio CPU profiler and memory profiler
   Why: finer method/sample-level attribution and heap dump workflow when Perfetto says "where" but not "which method/object graph".
   Use for: second-pass drill-down only, not as the primary benchmark harness.

5. `adb` support tools
   Why: low-friction point measurements and sanity checks.
   Use for: `dumpsys meminfo`, `dumpsys gfxinfo`, `top`, `logcat`, existing repo telemetry scripts, and optional heap dumps.

### Android WebView/Web path stack

1. Chrome DevTools remote debugging for WebViews via `chrome://inspect`
   Why: needed to profile Capacitor WebView JS and rendering on Android.
   Note: requires `WebView.setWebContentsDebuggingEnabled(true)` in debug/profile builds.

2. Chrome DevTools Performance traces
   Why: best low-level JS/rendering flame charts for the web runtime and Android WebView content.
   Use for: deep inspection of JS, style, layout, rendering, and long tasks.

3. Saved DevTools traces
   Why: can be versioned as artifacts and compared before/after.
   Use for: artifact retention outside the browser session.

### Automation stack

1. Maestro
   Good for: deterministic real-device flow orchestration on the Pixel 4.
   Not good for: low-level profiling on its own.
   Role: driver for benchmark scenarios, screenshots, and controlled user flows.

2. Playwright
   Good for: web timing budgets, assertions, and automated scenario reproduction.
   Not good for: replacing Perfetto or DevTools flame charts.
   Role: CI-friendly wall-clock budgets and reproducible web user journeys.

### iOS stack

1. Xcode Instruments, Time Profiler, Allocations, Leaks, and Energy Log
   Why: still the correct free toolchain for iOS, but it requires macOS/Xcode.
   Role here: secondary research lane only, focused on low-hanging fruit and parity recommendations.

## Measurement Architecture

### Principle

Every optimization must be justified by measurements captured before and after the change on the same workload.

### Controlled data source

The real HVSC provider must not be the benchmark source for repeated runs.

Use a local mock provider that:

- serves a fixed HVSC archive fixture from disk,
- throttles response throughput to 5 MiB/s,
- emits server-side timing and byte counters,
- optionally supports `HEAD`, `Range`, and checksum endpoints,
- can be used from Android and Docker-backed web.

### Required instrumentation layers

1. App-level timing marks
   Add structured timing around download, cache write, extraction, index build, browse query, add batch, playlist query, filter apply, and playback start.

2. Native Android trace sections
   Use `android.os.Trace` around extractor, downloader, filesystem, and database/index work so those phases appear in Perfetto.

3. Web user-timing marks
   Use `performance.mark` and `performance.measure` for the Capacitor/WebView and Docker web path.

4. Device/system telemetry
   Capture CPU, RSS/PSS, thread counts, and frame/jank signals alongside scenario timestamps.

5. Trace post-processing
   Convert every Perfetto trace into structured metrics using SQL, not only screenshots and manual inspection.

### Suggested artifact layout

Future measurement work should write to a stable layout such as:

```text
artifacts/perf/hvsc/
  baseline/
    android-pixel4/
    android-emulator/
    web-docker/
  after-change/
    <change-id>/
      android-pixel4/
      android-emulator/
      web-docker/
  traces/
  sql/
  reports/
```

### Required scenarios

Measure each scenario at least 5 times after one warm-up run.

1. Download full HVSC from mock provider to cache.
2. Ingest cached HVSC into browse/index structures.
3. Open add-items and enter HVSC root.
4. Traverse down a deep directory path.
5. Traverse back up to root.
6. Add the entire HVSC library to a playlist.
7. Open/render the resulting playlist.
8. Apply a representative filter string to the playlist.
9. Clear and re-apply other filter strings with low-match and high-match cardinalities.
10. Start playback from a filtered result.

### Minimum metrics per scenario

- Wall-clock duration.
- App CPU time and scheduling behavior.
- Peak RSS and PSS.
- JS heap growth where applicable.
- Jank count and frame-time distribution where UI is involved.
- Main-thread long-task count for web/WebView.
- Query latency distribution: p50, p95, p99.
- Bytes transferred and effective throughput for download.
- Items per second for ingest and playlist add.

## Bottleneck Matrix And Candidate Solution Space

These are hypotheses to test, not pre-approved implementations. Each option is pre-graded to accelerate later research.

Scoring key:

- Impact: `1` low to `5` very high.
- Confidence: `1` speculative to `5` strong.
- Effort: `1` low to `5` high.

### Bottleneck A: Download to cache

Likely symptoms:

- Large JS heap spikes.
- Double or triple copy cost during buffering and checksum generation.
- Excess bridge overhead.

Options:

1. Native streaming download directly to file with incremental checksum.
   Impact `5`, Confidence `5`, Effort `3`.
2. Keep download native and move checksum to the same native stream pass.
   Impact `4`, Confidence `5`, Effort `2`.
3. Add resumable/range-aware cache downloads.
   Impact `3`, Confidence `3`, Effort `4`.
4. Remove or reduce JS-visible archive bytes entirely on native builds.
   Impact `5`, Confidence `4`, Effort `3`.
5. Pre-size output and avoid repeated array growth/reallocation in JS fallback paths.
   Impact `2`, Confidence `4`, Effort `2`.
6. Introduce a binary bridge API that streams chunks without base64.
   Impact `4`, Confidence `4`, Effort `4`.

### Bottleneck B: Ingest and index build

Likely symptoms:

- Extraction writes a raw tree first and then materializes relevant files.
- Index build and snapshot persistence can duplicate work.
- Large intermediate files and metadata handling inflate wall time and memory.

Options:

1. Stream extraction directly into the authoritative browse/index store instead of a raw tree.
   Impact `5`, Confidence `4`, Effort `5`.
2. Batch database/index writes and commit incrementally instead of building a full in-memory structure first.
   Impact `5`, Confidence `5`, Effort `3`.
3. Persist pre-sorted folder rows and song rows during ingest.
   Impact `4`, Confidence `4`, Effort `3`.
4. Defer non-essential metadata parsing until first access.
   Impact `3`, Confidence `4`, Effort `3`.
5. Split ingest into archive extraction and query-index materialization with resumable checkpoints.
   Impact `4`, Confidence `4`, Effort `4`.
6. Offload web ingest to a Worker and store results incrementally in IndexedDB.
   Impact `4`, Confidence `4`, Effort `4`.

### Bottleneck C: HVSC browse traversal in add-items

Likely symptoms:

- Snapshot load/parse time dominates first-open or first-navigation.
- Querying and sorting per folder takes too long.
- Traversal janks the UI thread.

Options:

1. Replace JSON browse snapshots with an authoritative indexed database table keyed by parent path.
   Impact `5`, Confidence `5`, Effort `4`.
2. Serve paged folder rows directly from the repository with precomputed sort keys.
   Impact `5`, Confidence `5`, Effort `3`.
3. Cache only the current folder, parent chain, and immediate siblings in memory.
   Impact `4`, Confidence `4`, Effort `3`.
4. Move browse query execution off the main thread on web/WebView.
   Impact `4`, Confidence `4`, Effort `3`.
5. Add folder cardinality metadata at ingest so the UI does not recompute counts or deep scans.
   Impact `3`, Confidence `4`, Effort `2`.
6. Memoize recent traversal results with eviction by path and query.
   Impact `3`, Confidence `3`, Effort `2`.

### Bottleneck D: Playlist add, render, and filter at 60k to 100k scale

Likely symptoms:

- Full playlist remains canonical in React state.
- Full repository sync is triggered from large arrays.
- Filter performance can degrade due to hydration, serialization, and UI bookkeeping.

Options:

1. Make the repository authoritative and window the UI state instead of storing the full playlist array in React.
   Impact `5`, Confidence `5`, Effort `5`.
2. Bulk-insert playlist items in streaming batches without retaining the full add result set.
   Impact `5`, Confidence `5`, Effort `3`.
3. Use FTS or an equivalent indexed token/trigram strategy for playlist filtering.
   Impact `5`, Confidence `4`, Effort `4`.
4. Split track catalog and playlist-instance state so filtering touches only indexed metadata.
   Impact `4`, Confidence `5`, Effort `3`.
5. Avoid full re-serialization of playlist records when appending batches.
   Impact `4`, Confidence `4`, Effort `3`.
6. Add debounce and cancellation for filter requests, but only as a secondary measure.
   Impact `2`, Confidence `5`, Effort `1`.

### Bottleneck E: Playback start and filtered-playback path

Likely symptoms:

- HVSC playback may still materialize bytes through a base64 path.
- Duration and metadata resolution can happen too late.

Options:

1. Persist all duration and playback metadata at ingest.
   Impact `4`, Confidence `5`, Effort `2`.
2. On native builds, play HVSC songs from native file paths or native handles rather than base64 payloads.
   Impact `4`, Confidence `4`, Effort `4`.
3. Pre-resolve next playable item metadata during idle time.
   Impact `2`, Confidence `4`, Effort `2`.
4. Cache decoded song access results for recently played items.
   Impact `2`, Confidence `3`, Effort `2`.
5. Separate playback-start timing from browse/filter timing so playback does not hide upstream wins.
   Impact `3`, Confidence `5`, Effort `1`.

## Initial Cross-Bottleneck Ranking

Before any measurements are collected, the most promising overall directions appear to be:

1. Replace snapshot-centric HVSC browse with authoritative indexed storage and paged queries.
2. Move download plus ingest toward a native streaming pipeline with incremental writes and checksums.
3. Move playlist state from full-array React ownership to repository-first windowed ownership, plus indexed filtering.

These are starting hypotheses only. Keep them only if the baseline data confirms them.

## Iterative Optimization Loop

Every later implementation pass should follow this loop exactly.

1. Capture a clean baseline on the Pixel 4 and Docker web using the same fixed dataset and same scenario script.
2. Identify the single dominant bottleneck from traces and metrics, not from intuition.
3. Pick one change only.
4. Implement the smallest coherent fix for that bottleneck.
5. Re-run the same benchmark set.
6. Compare before and after across wall time, CPU, memory, and jank.
7. Keep the change only if it produces a meaningful win without violating memory, stability, or maintainability constraints.
8. If the change fails, revert or redesign it before moving to the next candidate.
9. Add automated regression checks for the winning improvement.
10. Repeat until budgets are met or the remaining blockers are structural and clearly documented.

## CI Strategy

Pixel 4 proof cannot be replaced by CI, so CI must focus on cheap, deterministic regression detection.

Recommended CI layers:

1. Repository/query microbenchmarks with large synthetic datasets.
2. Playwright wall-clock budgets for Docker-backed web scenarios.
3. Maestro scenario timing on Android emulator for coarse regressions.
4. App-level timing assertions on ingest/query/filter hot paths.
5. Artifact retention for traces and timing summaries when thresholds are missed.

Do not make CI responsible for proving Pixel 4 budgets. Make CI responsible for catching obvious regressions before a device run.

## Files Prepared In This Pass

- `docs/research/hvsc/performance/hvsc-performance-research-brief-2026-04-05.md`
- `docs/research/hvsc/performance/hvsc-performance-research-prompt-2026-04-05.md`
