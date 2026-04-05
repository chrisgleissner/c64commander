# HVSC Decompression & End-to-End Workflow Gap Analysis

Date: 2026-04-03
Classification: `DOC_ONLY`
Scope: Download → 7z extraction → add to playlist → playback → audio verification on real Pixel 4 + U64

## 1. Executive Summary

The end-to-end HVSC workflow — download the ~80 MB HVSC archive, decompress its ~60k `.sid` files on a real Android device, add them to a playlist, play one back on a real C64 Ultimate, and verify audio — **has never been proven to work**. The closest evidence is:

- **HIL Run 1**: HVSC download completed (80 MB cached), but extraction failed because the WASM path was used and the LZMA:336m dictionary exceeds 32-bit WASM address space.
- **HIL Run 2**: SID playback proven on Pixel 4 → C64U, but the SID file was `demo.sid` manually staged on the C64U via FTP — not an HVSC-extracted song.

The root cause is that **the Android native 7z decompression library (Apache Commons Compress `SevenZFile`) has never been tested against the real HVSC archive**, whose real archive profile is now known to be `Method = LZMA:336m PPMD BCJ2`, `Solid = +`, `Blocks = 2`, with 60,737 files across 2 folders and 372,025,688 bytes uncompressed. The only test fixture is still a tiny synthetic `HVSC_LZMA2_tiny.7z`. Whether Apache Commons Compress can handle that real method chain, dictionary size, and solid-block structure on a resource-constrained Pixel 4 remains unproven until direct validation is run.

The research document (`hvcs-7z-decompression-research.md`) recommends embedding upstream 7-Zip via NDK/JNI (Option A) or using PLzmaSDK (Option C) as the only credible parity candidates. The current implementation uses neither — it uses Apache Commons Compress, which is not evaluated in the research at all and has known limitations compared to upstream 7-Zip.

## 2. Issue Register

### GAP-001: Android native extraction never tested against real HVSC archive

- **Severity**: Critical (workflow-blocking)
- **Component**: `android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt` (lines 326–512)
- **Current state**: Android uses `org.apache.commons:commons-compress:1.26.2` with `org.tukaani:xz:1.10` for `SevenZFile`-based extraction. The only 7z test fixture is `android/app/src/test/fixtures/HVSC_LZMA2_tiny.7z` — a synthetic archive with a handful of entries. The real HVSC #84 archive (`HVSC_84-all-of-them.7z`, SHA-256 `9ed41b3a8759af5e1489841cd62682e471824892eabf648d913b0c9725a4d6d3`) is now confirmed to use `Method = LZMA:336m PPMD BCJ2`, `Solid = +`, `Blocks = 2`, with `Physical Size = 83,748,140` and `Size = 372,025,688`.
- **Risk**: Apache Commons Compress may:
  - Fail to allocate the 336 MB dictionary on a Pixel 4 (3 GB RAM, constrained per-app heap).
  - Throw `Unsupported compression method` if the method chain includes filters (BCJ/Delta) not supported by the `xz-java` LZMA2 decoder.
  - Hang or OOM on the solid-block decompression of ~60k entries.
- **Evidence gap**: No test or HIL run has ever executed `SevenZFile` against the real HVSC archive — neither on JVM nor on a real Android device.
- **Required proof**: A Kotlin JVM unit test that downloads (and caches) the real HVSC archive and successfully opens, enumerates, and extracts at least a sample of entries using `SevenZFile`.

### GAP-002: No dedicated Kotlin decompression library with real-archive unit tests

- **Severity**: Critical (foundational)
- **Component**: Missing — needs to be created under `android/app/src/main/java/` or a separate module
- **Current state**: Decompression logic is embedded directly in `HvscIngestionPlugin.kt` (a 1049-line Capacitor plugin). There is no reusable, independently testable decompression library. The `SevenZFile` usage is interleaved with Capacitor plugin lifecycle, SQLite metadata writes, progress emission, and staging logic.
- **Risk**: Cannot isolate decompression failures from plugin/bridge failures. Cannot run fast feedback loops on decompression correctness against real archives.
- **Required deliverable**: A standalone Kotlin library (e.g., `HvscArchiveExtractor`) that:
  1. Accepts an archive `File` and output directory.
  2. Handles `.7z` and `.zip` formats.
  3. Streams entries to disk file-by-file.
  4. Reports progress callbacks.
  5. Has unit tests against the real cached HVSC archive (see GAP-003).
  6. Has unit tests against synthetic corrupt/truncated archives.
  7. Is called by `HvscIngestionPlugin` instead of inline extraction code.

### GAP-003: No CI-safe cached HVSC archive test fixture strategy

- **Severity**: High (test infrastructure)
- **Component**: `android/app/src/test/fixtures/`, CI pipeline
- **Current state**: The only 7z fixture is `HVSC_LZMA2_tiny.7z` (tiny synthetic). Real-archive testing requires downloading ~80 MB, which must not happen on every CI build.
- **Required deliverable**: A caching strategy where:
  1. A Gradle task or test setup downloads the real HVSC archive to a local cache directory (e.g., `~/.cache/c64commander/hvsc/HVSC_84-all-of-them.7z`) on first run.
  2. Subsequent runs reuse the cached file (verified by checksum).
  3. Tests that depend on the real archive are annotated (e.g., `@Tag("real-hvsc")`) and skipped in CI unless the cache is pre-populated or a CI environment variable is set.
  4. The cache directory is `.gitignore`d.

### GAP-004: Research recommends upstream 7-Zip or PLzmaSDK; implementation uses neither

- **Severity**: High (architectural mismatch)
- **Component**: `android/app/build.gradle` (lines 182–183), research doc
- **Current state**: The research document (`hvcs-7z-decompression-research.md`) evaluates nine decompression engines and concludes: "only upstream 7‑Zip (native) and a WASM build of the same are credible parity candidates." Apache Commons Compress is not evaluated. The research recommends:
  - **Option A**: Embed upstream 7-Zip C++ via NDK/JNI (highest parity).
  - **Option C**: PLzmaSDK or LZMA SDK for LZMA2-only archives (smaller scope, sufficient if HVSC uses simple method chains).
- **Current implementation**: Uses Apache Commons Compress `SevenZFile` with `xz-java` for LZMA2. This library:
  - Is a Java reimplementation, not the upstream 7-Zip engine.
  - Has known limitations with certain 7z method chains and filters.
  - Is not mentioned in the research evaluation table.
- **Required resolution**: Either:
  - (a) Prove Apache Commons Compress works against the real HVSC archive with acceptable memory and performance on Pixel 4 hardware (GAP-001), OR
  - (b) Replace it with a library recommended by the research (upstream 7-Zip NDK build or PLzmaSDK/LZMA SDK wrapper).
- **Recommended approach**: Start with (a) to capture explicit real-archive evidence, even though the Phase 1 profile already shows a non-trivial method chain (`LZMA:336m PPMD BCJ2`) rather than a simple LZMA/LZMA2-only archive. If Apache Commons Compress fails, proceed with (b). Because the real archive includes `PPMD` and `BCJ2`, any limited-scope replacement must justify those methods explicitly; otherwise upstream 7-Zip remains the safest parity path.

### GAP-005: HVSC archive method chain and dictionary size were unknown

- **Severity**: High (decision prerequisite)
- **Component**: Research and validation input
- **Status**: RESOLVED on 2026-04-04 via local `7z` inspection and integrity validation
- **Observed archive profile**:
  - Cache path: `~/.cache/c64commander/hvsc/HVSC_84-all-of-them.7z`
  - SHA-256: `9ed41b3a8759af5e1489841cd62682e471824892eabf648d913b0c9725a4d6d3`
  - `Method = LZMA:336m PPMD BCJ2`
  - `Solid = +`
  - `Blocks = 2`
  - single-volume archive
  - header listing visible without a password; sampled entries reported `Encrypted = -`
  - `Physical Size = 83748140`
  - `Headers Size = 846074`
  - `Files = 60737`
  - `Folders = 2`
  - `Uncompressed Size = 372025688`
- **Integrity proof**: `7z t ~/.cache/c64commander/hvsc/HVSC_84-all-of-them.7z` returned `Everything is Ok`.
- **Impact**: The profile eliminates the prior unknowns and materially changes the engine decision. The archive is not a simple LZMA/LZMA2-only case; it includes `PPMD` and `BCJ2`, so Phase 2 must prove the current engine against the real archive instead of assuming compatibility.

### GAP-006: Web platform cannot extract the real HVSC archive

- **Severity**: High (platform limitation — documented but unresolved)
- **Component**: `src/lib/hvsc/hvscArchiveExtraction.ts`, `7z-wasm`
- **Current state**: HIL Run 1 proved that 7z-wasm (32-bit WASM, 7-Zip 24.09) cannot handle the HVSC archive's LZMA:336m dictionary because the dictionary size exceeds the 32-bit WASM address space. The production guard (`resolveHvscIngestionMode`) now blocks non-native HVSC ingest, which means Web cannot ingest HVSC at all. The audit follow-up marks this as `DONE` (AUD-007) because the guard is explicit, but the architecture doc states Web is a required production target for full HVSC ingest.
- **Contradiction**: Architecture says Web must support full HVSC; runtime blocks Web from HVSC ingest. This is documented but not resolved — the product decision about Web HVSC support has not been made.
- **Required resolution**: Either:
  - (a) Accept that Web cannot do full HVSC ingest and update architecture docs to reflect this as a permanent limitation, OR
  - (b) Provide a server-side extraction service or pre-extracted CDN distribution for Web, OR
  - (c) Negotiate with HVSC distribution to provide archives with smaller dictionary sizes.

### GAP-007: End-to-end HVSC workflow never proven on real hardware

- **Severity**: Critical (acceptance-blocking)
- **Component**: Full stack — download, extract, browse, add to playlist, playback, audio verification
- **Current state**:
  - HIL Run 1: HVSC download OK, extraction FAILED (WASM path used instead of native).
  - HIL Run 2: SID playback proven, but the SID was `demo.sid` staged via FTP on C64U — not an HVSC-extracted song.
  - No run has ever: downloaded HVSC → extracted on Pixel 4 via native path → browsed extracted songs → added an HVSC song to playlist → played it on C64U → verified audio.
- **Required proof**: A single archived HIL run on Pixel 4 + C64U that proves the complete chain:
  1. HVSC archive downloaded (or cache-hit).
  2. Archive extracted successfully via Android native `SevenZFile` path.
  3. HVSC songs visible in browse UI.
  4. At least one HVSC song added to playlist.
  5. Song played back on C64 Ultimate.
  6. Audio verified (timer advancing, HEALTHY device, ideally c64scope RMS).

### GAP-008: iOS loads full archive into memory for extraction

- **Severity**: High (platform risk — previously tracked as AUD-006, still BLOCKED)
- **Component**: `ios/App/App/HvscIngestionPlugin.swift:163-165`
- **Current state**: iOS native path uses `Data(contentsOf:)` to load the entire ~80 MB archive into memory before opening it. For an 80 MB archive with a 336 MB dictionary, peak memory could reach 400+ MB, risking iOS jetsam/OOM kills on devices with 3–4 GB RAM.
- **Status**: BLOCKED — requires macOS for Swift toolchain. Tracked for completeness; resolution requires separate macOS work.

### GAP-009: Plugin test suite does not test real extraction flow

- **Severity**: Medium (test coverage gap)
- **Component**: `android/app/src/test/java/uk/gleissner/c64commander/HvscIngestionPluginTest.kt`
- **Current state**: The plugin test (`HvscIngestionPluginTest`) tests:
  - Parameter validation (missing path, invalid mode).
  - Progress event payload shape.
  - Error message classification.
  - Chunk read semantics.
  - It does NOT test actual archive extraction — no test calls `ingestHvsc` with a real archive and verifies extracted files on disk.
- **Root cause**: Robolectric environment limitations make it hard to run full extraction flows in JVM tests. The `HvscSevenZipRuntimeTest` only verifies that `SevenZFile` can open and enumerate a tiny fixture.
- **Required improvement**: The new Kotlin decompression library (GAP-002) should be independently testable without Robolectric, enabling real extraction tests against both synthetic and real archives.

### GAP-010: No memory profiling or budget enforcement during extraction

- **Severity**: Medium (operational risk)
- **Component**: `HvscIngestionPlugin.kt` extraction path
- **Current state**: The plugin has optional `debugHeapLogging` that logs `Runtime.getRuntime()` heap snapshots, but:
  - No pre-extraction memory budget check based on archive dictionary size.
  - No `onTrimMemory` listener to abort extraction under system memory pressure.
  - No documented memory ceiling for extraction on target devices.
  - The research recommends computing `required = dict + overhead + safetyMargin` before extraction and querying `getMemoryClass()` / `getLargeMemoryClass()`.
- **Required improvement**: The decompression library should include a pre-extraction probe that estimates memory requirements from archive metadata and compares against available device memory.

### GAP-011: Extraction logic duplicated between 7z and ZIP paths

- **Severity**: Low (code quality)
- **Component**: `HvscIngestionPlugin.kt` lines 326–674
- **Current state**: `ingestSevenZip()` and `ingestZip()` are nearly identical ~170-line functions that differ only in archive reader construction and entry iteration. SID header parsing, file writing, deletion list handling, progress emission, and metadata batching are duplicated.
- **Required improvement**: Extract shared logic into the new decompression library (GAP-002), with format-specific adapters for 7z and ZIP.

## 3. Dependency Graph

```
GAP-005 (header inspection)
  └──→ GAP-004 (library choice decision)
         └──→ GAP-002 (Kotlin decompression library)
                ├──→ GAP-003 (cached HVSC test fixture)
                │      └──→ GAP-001 (real-archive extraction test)
                ├──→ GAP-010 (memory profiling)
                └──→ GAP-011 (deduplicate extraction logic)
                       └──→ GAP-009 (plugin extraction tests)
                              └──→ GAP-007 (end-to-end HIL proof)

GAP-006 (Web platform) — independent; product decision required
GAP-008 (iOS memory)   — independent; blocked on macOS toolchain
```

## 4. Relationship to Prior Audit Issues

| Gap ID  | Related AUD ID(s) | Relationship                                                        |
| ------- | ----------------- | ------------------------------------------------------------------- |
| GAP-001 | AUD-004, AUD-005  | Prerequisite for real HVSC HIL proof                                |
| GAP-002 | AUD-008           | Enables testable extraction separate from plugin lifecycle          |
| GAP-003 | AUD-008, AUD-011  | Test infrastructure for real-archive coverage                       |
| GAP-004 | — (new)           | Research-to-implementation alignment                                |
| GAP-005 | — (new)           | Archive characterization prerequisite                               |
| GAP-006 | AUD-007           | Web platform limitation — guard exists but product decision pending |
| GAP-007 | AUD-004, AUD-005  | The actual end-to-end proof that prior issues aimed for             |
| GAP-008 | AUD-006           | iOS memory risk — still BLOCKED                                     |
| GAP-009 | AUD-008           | Plugin test coverage expansion                                      |
| GAP-010 | — (new)           | Memory safety during extraction                                     |
| GAP-011 | — (new)           | Code quality / maintainability                                      |

## 5. Key Finding: The "Extraction Works" Assumption is Unproven

The prior audit follow-up marks AUD-004 and AUD-005 as `DONE` based on HIL Run 2. However, that run proved SID playback from a manually staged file — it did not prove HVSC extraction. The entire chain from "download HVSC archive" to "play an HVSC-extracted song" remains unproven on real hardware. This gap analysis exists because the decompression step — the hardest part of the chain — has never been exercised against the real archive on any platform.
