# HVSC Download/Ingestion OOM Elimination Plan

## Root Cause
- Crash occurs when Capacitor Filesystem `readFile()` materializes full archive bytes and Base64 payload in memory.
- This creates multiple very large heap allocations (`byte[]` + Base64 string + bridge copies), deterministically exceeding Android heap limits on constrained devices.

## Architectural Correction
1. Remove all HVSC archive reads through Capacitor `Filesystem.readFile()` and any equivalent Base64 bridge path.
2. Keep HVSC archive entirely in app-private storage and pass only file path/URI between layers.
3. Implement Android-native streaming ingestion entrypoint (`ingestHvsc(path)`), executed on `Dispatchers.IO`.
4. Stream archive entries via `InputStream`-based decompression; never hold full archive or full entry set in memory.
5. Parse SID metadata incrementally and persist to SQLite in bounded batches (target: 500 rows/transaction).
6. Emit progress events to JS every fixed interval (target: every 250 files) with deterministic totals.
7. Support cancellation and deterministic resource cleanup (`use {}`/`finally`) to prevent leaks and ANRs.

## Memory Model
- Bounded ingestion memory target: constant-size buffers + one in-flight entry parse object + one DB batch list.
- No unbounded lists of entries, no JS arrays containing full corpus, no Base64 strings for archive contents.
- Add pre-ingestion file size validation.
- Add hard guard: reject/throw when large-file path attempts to use `Filesystem.readFile()` (>5 MB).
- Log `memoryClass` and `largeMemoryClass` at startup and optional periodic heap snapshots during ingestion in debug mode.

## Execution Steps
1. Identify and remove current Base64 HVSC ingestion path in JS + native bridge layers.
2. Implement/extend Capacitor HVSC plugin native method for fully streaming ingestion.
3. Refactor DB write strategy to batched transactions and post-bulk index handling as appropriate.
4. Add plugin progress events, cancellation support, and ANR-safe yielding.
5. Add regression guard test to fail if HVSC path uses `Filesystem.readFile()`.
6. Add constrained emulator CI configuration for ingestion validation:
   - `hw.ramSize=512`
   - `vm.heapSize=128`
   - `hw.cpu.ncore=1`
   - `hw.device.lowram=yes`
   - cold boot/no snapshot
7. Add Maestro flow to validate constrained-device download+ingestion survivability and completion.
8. Run validation suite (`npm run lint`, `npm run test`, `npm run test:coverage`, `npm run build`) and relevant Android tests.
9. Update this file with risks, mitigations, and final verification evidence.

## Test Strategy
- Unit tests for path guards, batch persistence behavior, and cancellation semantics.
- Integration tests for native ingestion with fixture archive verifying deterministic row thresholds.
- Regression test asserting no `Filesystem.readFile()` usage for HVSC archive path.
- CI scenario on constrained emulator with Maestro ensuring process liveness and ingestion completion.

## Risk Analysis
- Risk: incomplete migration leaves hidden Base64 paths. Mitigation: code search + regression test + plugin API contract update.
- Risk: transaction size too large for low-RAM devices. Mitigation: fixed bounded batch size and flush-on-threshold.
- Risk: long-running parse causes UI starvation. Mitigation: background dispatcher, progress events, cancellation checks, cooperative yields.
- Risk: CI emulator instability. Mitigation: deterministic launch flags, cold boot, explicit timeouts, and health checks.

## Verification Results
- Implemented native Android plugin `HvscIngestionPlugin` with streaming archive ingestion for `.7z` and `.zip` via file path only (`relativeArchivePath`), no archive Base64 bridge.
- Integrated runtime fallback routing: Android native path uses `HvscIngestion.ingestHvsc`, non-native path keeps existing JS extractor behavior.
- Added cancellation wiring (`cancelHvscInstall` → native `cancelIngestion`) and progress forwarding (`hvscProgress` listener).
- Added 5 MB bridge-read guards for HVSC archive reads (`hvscDownload.readArchiveBuffer`, `hvscFilesystem` guarded reads).
- Added startup memory class logging in Android `MainActivity` (`memoryClass`, `largeMemoryClass`).
- Added constrained emulator CI profile in `.github/workflows/android.yaml` and `scripts/run-maestro-gating.sh` (`512 MB RAM`, `128 MB heap`, `1 core`, low-RAM flag, cold boot/no snapshot).
- Added Maestro constrained-ingestion flow `.maestro/smoke-hvsc-lowram.yaml`.
- Added regression tests in `src/lib/hvsc/hvscBridgeGuards.test.ts` and updated HVSC runtime/recovery test mocks for native plugin bridge.
- Validation executed:
   - `npm run lint` ✅
   - `npm run test` ✅
   - `npm run test:coverage` ✅ (`All files` branch coverage `80.12%`)
   - `npm run build` ✅
   - `cd android && ./gradlew :app:compileDebugKotlin :app:compileReleaseKotlin` ✅
   - `./build` ✅
- Remaining architectural gap vs requested target:
   - None. SQLite batched metadata ingestion is implemented natively via bounded transactions (`dbBatchSize`, default `500`) with row-threshold validation (`minExpectedRows`) and reported metadata stats (`metadataRows`, `metadataUpserts`, `metadataDeletes`).
