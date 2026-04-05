# Implementation Plan: HVSC Decompression Library & End-to-End Workflow Proof

Date: 2026-04-03
Companion to: `docs/research/hvsc/gap-analysis-decompression-and-e2e-workflow-2026-04-03.md`

## Execution Contract

Each step references a GAP issue ID from the gap analysis. A step cannot move to the next unless:

1. The specified tests pass.
2. The proof artifacts are captured.
3. The gap analysis document is updated with the outcome.

If a step fails and the failure is non-recoverable, the plan branches to the documented fallback path.

## Step 1: Inspect the Real HVSC Archive Headers

**Resolves**: GAP-005
**Prerequisite for**: GAP-004, GAP-001, GAP-002

### Actions

1. Download the HVSC #84 complete archive from the known mirror to a local cache:

   ```bash
   mkdir -p ~/.cache/c64commander/hvsc
   cd ~/.cache/c64commander/hvsc
   # Download if not already cached
   [ -f HVSC_84-all-of-them.7z ] || curl -L --fail --output HVSC_84-all-of-them.7z https://hvsc.sannic.nl/HVSC%2084/HVSC_84-all-of-them.7z
   ```

2. Run header inspection:

   ```bash
   7z l -slt HVSC_84-all-of-them.7z | head -100
   7z l -slt HVSC_84-all-of-them.7z | grep -E '^(Method|Solid|Blocks|Encrypted|Size|Packed Size)' | sort | uniq -c | sort -rn | head -20
   ```

3. Run integrity test:

   ```bash
   7z t HVSC_84-all-of-them.7z
   ```

4. Record the "HVSC archive profile" in the gap analysis:
   - Exact `Method` chain (e.g., `LZMA:24` or `LZMA2:336m`)
   - Dictionary size in bytes
   - `Solid` flag and `Blocks` count
   - Header encryption (yes/no)
   - Multi-volume (yes/no)
   - Total entry count
   - Total uncompressed size

### Exit criteria (GAP-005)

- [x] Archive profile documented with exact method chain, dictionary size, and solid block info.
- [x] Integrity test passes.

### Observed result (2026-04-04)

- Cache path: `~/.cache/c64commander/hvsc/HVSC_84-all-of-them.7z`
- SHA-256: `9ed41b3a8759af5e1489841cd62682e471824892eabf648d913b0c9725a4d6d3`
- `Method = LZMA:336m PPMD BCJ2`
- `Solid = +`
- `Blocks = 2`
- `Physical Size = 83748140`
- `Headers Size = 846074`
- `Files = 60737`
- `Folders = 2`
- `Uncompressed Size = 372025688`
- Integrity: `Everything is Ok`

### Decision gate

Based on the archive profile:

- If method chain is `LZMA` or `LZMA2` only (no BCJ/BCJ2/Delta/PPMd filters): Apache Commons Compress + xz-java is a credible candidate → proceed to Step 2a.
- If method chain includes filters not supported by Commons Compress: proceed to Step 2b (alternative library).

The observed HVSC #84 archive does include additional methods (`PPMD` and `BCJ2`). That removes the simple-method happy path. Even so, the execution contract for this pass still requires Step 2a real-archive validation against the current engine so the keep-or-replace decision is based on explicit evidence rather than theory alone.

## Step 2a: Prove Apache Commons Compress Against Real Archive (Happy Path)

**Resolves**: GAP-001, GAP-003
**Prerequisite for**: GAP-002

### Actions

1. Create a Gradle test configuration for real-archive tests:
   - Add a `realHvsc` source set or use JUnit 5 `@Tag("real-hvsc")`.
   - Configure Gradle to look for the archive at `~/.cache/c64commander/hvsc/HVSC_84-all-of-them.7z`.
   - Skip these tests when the archive is not present (CI-safe).

2. Write a Kotlin JVM test (`HvscRealArchiveExtractionTest.kt`) that:
   - Opens the real HVSC archive with `SevenZFile`.
   - Enumerates all entries and counts `.sid` files (expect ~57,000+).
   - Extracts the first 100 `.sid` entries to a temp directory.
   - Verifies each extracted file starts with `PSID` or `RSID` magic bytes.
   - Extracts at least one `Songlengths.md5` or `Songlengths.txt` entry.
   - Measures peak heap usage during extraction.
   - Logs wall-clock time for full enumeration and sample extraction.

3. Write a checksum verification test:
   - Compute MD5 of the cached archive.
   - Store the expected checksum in a test constant.
   - Fail if the archive has been corrupted or is a different version.

### Exit criteria (GAP-001)

- [ ] `SevenZFile` successfully opens and enumerates the real HVSC archive.
- [ ] At least 100 SID files extracted and verified.
- [ ] Peak heap usage logged and documented (must be < 512 MB per target envelope).
- [ ] Test is annotated for CI-safe skipping when archive is absent.

### Failure path

If Apache Commons Compress throws `Unsupported compression method`, OOMs, or fails to open the archive:

- Document the exact failure in the gap analysis.
- Proceed to **Step 2b**.

## Step 2b: Replace Decompression Engine (Fallback Path)

**Resolves**: GAP-004
**Only executed if Step 2a fails**

### Option C1: PLzmaSDK via JNI

PLzmaSDK is a portable, patched LZMA SDK that supports 7z including multi-volume, LZMA/LZMA2, AES, and header encryption. It provides C/C++ APIs suitable for JNI wrapping.

1. Add PLzmaSDK as an NDK dependency via CMake.
2. Create a thin JNI wrapper exposing `list`, `test`, and `extract` operations.
3. Re-run the real-archive test (Step 2a tests) against the PLzmaSDK engine.

### Option C2: Upstream 7-Zip NDK build

If PLzmaSDK is insufficient, build upstream 7-Zip's `Alone2` (`7zz`) C++ code as a shared library:

1. Use the Termux build script as a reference (`DISABLE_RAR=1`, `cmpl_clang.mak`).
2. Target `arm64-v8a` and `x86_64` ABIs.
3. Expose extraction via JNI.
4. Re-run real-archive tests.

### Exit criteria (GAP-004)

- [ ] Chosen engine extracts the real HVSC archive successfully.
- [ ] Same test suite from Step 2a passes.
- [ ] Decision documented in gap analysis with rationale.

## Step 3: Create Kotlin Decompression Library

**Resolves**: GAP-002, GAP-011, GAP-009

### Actions

1. Create `android/app/src/main/java/uk/gleissner/c64commander/hvsc/HvscArchiveExtractor.kt`:
   - Public API:

     ```kotlin
     data class ExtractionProgress(
       val processedEntries: Int,
       val totalEntries: Int?,
       val currentFile: String?,
       val songsExtracted: Int,
     )

     data class ExtractionResult(
       val totalEntries: Int,
       val songsExtracted: Int,
       val songlengthFilesWritten: Int,
       val failedPaths: List<String>,
     )

     interface ArchiveExtractor {
       fun probe(archiveFile: File): ArchiveProfile
       fun extract(
         archiveFile: File,
         outputDir: File,
         onProgress: (ExtractionProgress) -> Unit,
         cancellationToken: AtomicBoolean,
       ): ExtractionResult
     }
     ```

   - `ArchiveProfile` data class with method chain, dictionary size, entry count estimate, solid flag.
   - `SevenZipExtractor` and `ZipExtractor` implementations.
   - Shared logic for SID header parsing, path normalization, zip-slip protection, songlength detection.
   - Pre-extraction memory check: estimate `dictionaryBytes + overhead` and compare against `Runtime.getRuntime().maxMemory()`.

2. Create `android/app/src/test/java/uk/gleissner/c64commander/hvsc/HvscArchiveExtractorTest.kt`:
   - Unit tests against synthetic fixtures (`HVSC_LZMA2_tiny.7z`, `HVSC_Update_mock.7z`).
   - Test path normalization, SID header parsing, zip-slip rejection.
   - Test progress callback frequency.
   - Test cancellation mid-extraction.

3. Create `android/app/src/test/java/uk/gleissner/c64commander/hvsc/HvscRealArchiveExtractionTest.kt`:
   - Real-archive tests (from Step 2a), tagged `@Tag("real-hvsc")`.
   - Full enumeration test.
   - Sample extraction test (100 SIDs).
   - Songlength extraction test.
   - Memory profiling test.

4. Refactor `HvscIngestionPlugin.kt`:
   - Replace inline `ingestSevenZip()` and `ingestZip()` with calls to `HvscArchiveExtractor`.
   - Plugin remains responsible for: Capacitor lifecycle, SQLite metadata, staging/promotion, progress bridge to JS.
   - Extractor is responsible for: archive I/O, file writing, format detection.

### Exit criteria (GAP-002, GAP-011, GAP-009)

- [ ] `HvscArchiveExtractor` exists as an independently testable Kotlin class.
- [ ] All existing `HvscIngestionPluginTest` tests still pass.
- [ ] `HvscSevenZipRuntimeTest` still passes.
- [ ] New extractor unit tests pass against synthetic fixtures.
- [ ] Real-archive tests pass (when archive is present).
- [ ] `HvscIngestionPlugin.kt` reduced by ~300 lines of duplicated extraction logic.

## Step 4: Add Memory Budget Enforcement

**Resolves**: GAP-010

### Actions

1. Add `probe()` to the extractor that reads archive metadata before extraction:
   - For 7z: open archive, read header properties, estimate dictionary size.
   - For ZIP: no dictionary concern, but estimate total uncompressed size.

2. Add pre-extraction memory check:

   ```kotlin
   val available = Runtime.getRuntime().maxMemory() - Runtime.getRuntime().totalMemory()
   val required = profile.estimatedDictionaryBytes + OVERHEAD_MARGIN
   if (required > available * SAFETY_FACTOR) {
     throw InsufficientMemoryException(required, available)
   }
   ```

3. Add `onTrimMemory` listener in the plugin that sets the cancellation token when the system signals `TRIM_MEMORY_RUNNING_CRITICAL` or higher.

4. Write tests:
   - Mock `Runtime.getRuntime().maxMemory()` scenarios.
   - Verify extraction refuses when budget is exceeded.
   - Verify cancellation on memory pressure signal.

### Exit criteria (GAP-010)

- [ ] Probe returns dictionary size and estimated memory requirement.
- [ ] Extraction refuses with clear error when memory budget is exceeded.
- [ ] Memory pressure listener cancels in-progress extraction.
- [ ] Tests cover all three scenarios.

## Step 5: CI-Safe Cached Archive Test Infrastructure

**Resolves**: GAP-003

### Actions

1. Create `android/app/src/test/java/uk/gleissner/c64commander/hvsc/RealHvscArchiveProvider.kt`:
   - Resolves archive location from environment variable `HVSC_ARCHIVE_PATH` or default `~/.cache/c64commander/hvsc/HVSC_84-all-of-them.7z`.
   - Returns `null` if archive not found (test assumes/skips).
   - Verifies checksum before returning.

2. Add `.gitignore` entry for the cache directory.

3. Add a Gradle task `downloadHvscTestFixture` that:
   - Downloads the archive to the cache location if not present.
   - Verifies checksum.
   - Can be run manually: `./gradlew downloadHvscTestFixture`.

4. Document in `README.md` or `docs/testing/`:
   - How to populate the cache for local development.
   - How to run real-archive tests: `./gradlew test -Pinclude-real-hvsc`.
   - How CI can optionally pre-populate the cache for integration test lanes.

### Exit criteria (GAP-003)

- [ ] Real-archive tests skip cleanly when archive is absent.
- [ ] Real-archive tests run and pass when archive is present.
- [ ] CI builds succeed without the archive (tests skip, not fail).
- [ ] Cache directory is gitignored.
- [ ] Documentation explains the setup.

## Step 6: End-to-End HIL Proof on Pixel 4 + C64U

**Resolves**: GAP-007
**Prerequisites**: GAP-001 (extraction proven), GAP-002 (library exists), Steps 1–3

### Actions

1. Build the app with the new decompression library:

   ```bash
   npm run cap:build
   ```

2. Install on Pixel 4:

   ```bash
   adb install -r android/app/build/outputs/apk/debug/app-debug.apk
   ```

3. Execute the full HVSC workflow on the device:
   - Launch app.
   - Navigate to HVSC section.
   - Trigger HVSC download (or use cached archive).
   - Wait for extraction to complete via native path.
   - Browse extracted HVSC songs.
   - Add at least one HVSC song to playlist (not `demo.sid` — a real HVSC entry like `/MUSICIANS/H/Hubbard_Rob/Commando.sid`).
   - Play the song on the C64 Ultimate.
   - Capture evidence: screenshots, logcat, timeline.

4. Verify audio:
   - Screenshot showing timer advancing.
   - C64U HEALTHY status.
   - If c64scope available: packet/RMS proof.

5. Archive artifacts:
   ```
   artifacts/hvsc-e2e-proof-YYYYMMDDTHHMMSSZ/
   ├── TIMELINE.md
   ├── screenshots/
   ├── logcat-full.txt
   ├── c64u-info.json
   └── extraction-summary.json (from plugin result payload)
   ```

### Exit criteria (GAP-007)

- [ ] Archived HIL run proves: HVSC download → native extraction → browse → add HVSC song → playback on C64U.
- [ ] The played song is an HVSC-extracted song (not a manually staged file).
- [ ] Extraction summary shows ~57,000+ songs ingested with 0 failed.
- [ ] Audio evidence captured (timer advancing, HEALTHY status).

## Step 7: Web Platform Decision

**Resolves**: GAP-006
**Independent of Steps 1–6**

### Actions

1. Present the product decision to the project owner:
   - **Option A**: Accept Web cannot do full HVSC ingest. Update `docs/architecture.md` to state this is a permanent limitation. Web users browse/play HVSC only if songs are pre-staged on the C64U or provided via a server-side service.
   - **Option B**: Provide a server-side extraction endpoint that returns individual SID files or pre-extracted bundles.
   - **Option C**: Distribute HVSC as a ZIP (smaller dictionary, browser-compatible) alongside the 7z — if upstream mirrors provide this.

2. Update architecture docs to reflect the decision.

### Exit criteria (GAP-006)

- [ ] Product decision documented.
- [ ] Architecture docs updated.
- [ ] No contradictory statements remain (Web required vs. Web blocked).

## Timeline and Sequencing

```
Step 1 (header inspection)     ─── 1 hour
  │
  ├─ [LZMA/LZMA2 only] ──→ Step 2a (prove Commons Compress) ─── 2-4 hours
  │                            │
  │                            ├─ [SUCCESS] ──→ Step 3 (Kotlin library) ─── 4-8 hours
  │                            ��                   │
  │                            │                   ├──→ Step 4 (memory budget) ─── 2-4 hours
  │                            │                   │
  │                            │                   ├──→ Step 5 (CI caching) ─── 2-4 hours
  │                            │                   │
  │                            │                   └──→ Step 6 (E2E HIL) ─── 4-8 hours
  │                            │
  │                            └─ [FAILURE] ──→ Step 2b (replace engine) ─── 8-16 hours
  │                                               └──→ Step 3, 4, 5, 6
  │
  └─ [filters/exotic methods] ──→ Step 2b directly

Step 7 (Web decision) ��── independent, 1-2 hours
```

## Risk Register

| Risk                                                       | Likelihood | Impact                                                      | Mitigation                                                                      |
| ---------------------------------------------------------- | ---------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Apache Commons Compress cannot handle LZMA:336m dictionary | Medium     | High — requires engine replacement (Step 2b)                | Step 1 header inspection reduces uncertainty; Step 2b fallback is planned       |
| Pixel 4 OOMs during real HVSC extraction                   | Medium     | High — requires memory budget enforcement or library change | Step 4 adds pre-extraction checks; `debugHeapLogging` already exists            |
| Real HVSC mirror is unavailable                            | Low        | Medium — delays testing                                     | Multiple mirrors listed in research; cache strategy (Step 5) reduces dependency |
| C64U unreachable during HIL run                            | Low        | Medium — delays Step 6                                      | Both `u64` and `c64u` are probed; non-device steps are independent              |
| HVSC #84 archive uses unexpected method chain              | Low        | Medium — may require library change                         | Step 1 eliminates this unknown first                                            |
