# Test Coverage Strengthening Plan

## Status: DRAFT

Created: 2026-03-30

## Executive summary

C64 Commander has substantial test infrastructure: 5205 unit tests across 447 files, ~45 Playwright E2E specs, ~45 Maestro mobile flows, Android JVM tests, agent tests, and contract tests. However, several high-value, multi-step, and brittle features have coverage gaps that reduce confidence in production correctness. This plan identifies those gaps and prescribes concrete, targeted additions that strengthen production confidence without significantly extending test execution time.

## Audit methodology

- Mapped all source modules in `src/lib/`, `src/hooks/`, `src/pages/` to their test files
- Cross-referenced critical user-facing flows against unit, E2E, and device test inventories
- Identified modules with high complexity (>200 LOC) and low test-to-complexity ratios
- Focused on multi-step stateful flows that are most likely to break in production

---

## 1. Critical gaps: Multi-step flows never proven end-to-end on real hardware

### 1.1 HVSC download -> ingest -> playlist -> playback (HIGHEST PRIORITY)

**Problem**: This is the flagship HVSC experience and the user has never seen it work end-to-end on a real device. The individual steps have unit tests and Playwright mocked E2E tests, but nothing proves the full chain on Android with a real C64 Ultimate.

**Current coverage**:
- Unit: `hvscDownload.test.ts` (97 tests), `hvscIngestionRuntime.test.ts` (78 tests), `hvscService.test.ts` (55 tests), `useHvscLibrary.test.tsx` (21 tests), `usePlaybackController.test.tsx` (43 tests)
- Playwright: `hvsc.spec.ts` (18 tests) - all using mock HVSC server and mock C64U
- Maestro: `smoke-hvsc.yaml`, `smoke-hvsc-mounted.yaml`, `smoke-hvsc-lowram.yaml` - verify browse/import UI but NOT actual download or playback

**What's missing**:
- No test proves the native 7z extraction path (Android `HvscIngestion` plugin) → SQLite/filesystem ingestion → browse index → song selection → SID upload → C64U playback
- The Playwright HVSC tests use `window.__hvscMock__` which bypasses the entire native bridge
- No Maestro flow exercises download (it relies on pre-cached or skips entirely)

**Concrete additions**:

| # | Test | Type | File | What it proves | Est. time |
|---|------|------|------|---------------|-----------|
| 1a | HVSC baseline download + native extraction + ingest on Android emulator | Maestro | `.maestro/edge-hvsc-full-lifecycle.yaml` | Native 7z extraction, filesystem write, browse index creation. Uses a tiny test HVSC archive (~2 MB) hosted on local mock HTTP server. Verifies browse UI shows ingested songs afterward. | ~45s |
| 1b | HVSC ingested → add to playlist → play SID on real C64U | Agentic | Agentic test case catalog | Requires real device + real C64U. Post-ingest: browse HVSC, add song to playlist, press play, verify SID upload REST call and A/V output via c64scope. | ~60s |
| 1c | HVSC update archive applies on top of existing baseline | Unit | `tests/unit/hvsc/hvscIngestionRuntime.update.test.ts` | The `ingestArchiveBuffer` function correctly processes update archives: deletes removed files, adds new files, updates songlengths. Currently only the baseline path has deep unit tests. | <1s |
| 1d | HVSC ingestion failure mid-stream recovers on retry | Unit | `tests/unit/hvsc/hvscIngestionRuntime.recovery.test.ts` | Existing `hvscIngestionRecovery.test.ts` covers stale state detection; add tests for mid-extraction failure → state rollback → successful retry. | <1s |

### 1.2 CommoServe search -> download -> play (HIGH PRIORITY)

**Problem**: The archive client (`src/lib/archive/client.ts`, 397 LOC) and execution module (`src/lib/archive/execution.ts`, 89 LOC) have unit tests but no E2E test proves the full user flow: search → select result → download binary → detect file type → upload to C64U → playback.

**Current coverage**:
- Unit: `archive/client.test.ts` (31 tests), `archive/execution.test.ts` (7 tests), `useOnlineArchive.test.tsx` (16 tests)
- Playwright: no dedicated CommoServe spec
- Maestro: none

**What's missing**:
- No test exercises the Capacitor HTTP path for archive binary download (native vs web divergence)
- No test proves file type detection → extension mapping → play plan construction → C64U upload for archive-sourced files
- The `buildArchivePlayPlan` function has error paths (unsupported file, validation failure) with only 7 tests total

**Concrete additions**:

| # | Test | Type | File | What it proves | Est. time |
|---|------|------|------|---------------|-----------|
| 2a | CommoServe search → download → play SID end-to-end | Playwright | `playwright/commoserve.spec.ts` | Mock archive API returns search results, user selects entry, binary downloads, file type detected, SID uploaded to mock C64U, playback starts. | ~5s |
| 2b | CommoServe search → download → play disk image (d64) | Playwright | `playwright/commoserve.spec.ts` | Same flow but with a disk image: verifies mount + autostart sequence. | ~5s |
| 2c | Archive binary download with Capacitor HTTP fallback | Unit | `tests/unit/archive/client.nativeDownload.test.ts` | Tests `decodeNativeBinaryData` with all input shapes (ArrayBuffer, typed array, base64 string, byte array). Tests signal abort error handling. | <1s |
| 2d | Archive execution edge cases | Unit | `tests/unit/archive/execution.extended.test.ts` | `buildArchivePlayPlan` with: extensionless filename + detected type, validation failure for corrupt bytes, all supported file type → extension mappings. | <1s |

### 1.3 Auto-advance / auto-playback chain (HIGH PRIORITY)

**Problem**: The playback controller (`usePlaybackController.ts`, 958 LOC) manages auto-advance guards, subsong progression, duration-based transitions, and concurrent playback coordination via `machineTransitionCoordinator`. Several race conditions are possible.

**Current coverage**:
- Unit: `usePlaybackController.test.tsx` (43 tests), `autoAdvanceGuard.test.ts` (exists)
- Playwright: `playback.spec.ts` tests stop/pause/resume but auto-advance is only implicitly tested

**What's missing**:
- No test proves: song A finishes (duration expires) → auto-advance fires → song B starts → song B finishes → playlist wraps or stops
- No test for subsong auto-advance within a multi-subsong SID
- The `machineTransitionCoordinator` supersede logic (concurrent play requests cancel earlier ones) has only 1 test file

**Concrete additions**:

| # | Test | Type | File | What it proves | Est. time |
|---|------|------|------|---------------|-----------|
| 3a | Multi-song auto-advance chain (3+ songs) | Unit | `tests/unit/playFiles/usePlaybackController.autoAdvance.test.tsx` | Playlist of 3 songs with known durations. Verify: song 1 expires → advance → song 2 expires → advance → song 3 expires → stops (no repeat) or wraps (repeat enabled). | <1s |
| 3b | Subsong auto-advance within multi-subsong SID | Unit | `tests/unit/playFiles/usePlaybackController.subsong.test.tsx` | SID with 3 subsongs, each with known duration. Verify subsong 1→2→3→next track progression. | <1s |
| 3c | Concurrent play supersedes earlier transition | Unit | `tests/unit/playFiles/usePlaybackController.concurrency.test.tsx` | User clicks play on track A, then immediately clicks track B. Verify track A's play plan is cancelled via `SupersededMachineTransitionError` and track B plays. | <1s |
| 3d | Auto-advance during pause does not fire | Playwright | `playwright/playback.spec.ts` (add test) | Start song with duration, pause before expiry, wait past expiry, verify no advance. | ~3s |

---

## 2. Stateful hooks with insufficient unit coverage

### 2.1 `usePlaylistManager` (105 LOC, 0 tests)

**Problem**: Zero direct tests. Manages shuffle logic with retry-on-same-order, selection pruning, and reshuffle animation state.

**Concrete additions**:

| # | Test | Type | File | What it proves | Est. time |
|---|------|------|------|---------------|-----------|
| 4a | Shuffle produces different order | Unit | `tests/unit/playFiles/usePlaylistManager.test.tsx` | `reshufflePlaylist` with 5 items: result differs from input. Current item stays at its index. | <1s |
| 4b | Shuffle with 2 items swaps guaranteed | Unit | same | With only 2 items, shuffle always produces different order (swap fallback logic). | <1s |
| 4c | Selection pruning on playlist change | Unit | same | Add items to selection, remove items from playlist, verify selection is pruned. | <1s |

### 2.2 `useHvscLibrary` (1031 LOC, 21 tests)

**Problem**: This is the most complex hook in the app. 21 tests is low for 1031 lines covering download progress, ingestion state machine, error recovery, update checks, browsing, and media index management.

**Concrete additions**:

| # | Test | Type | File | What it proves | Est. time |
|---|------|------|------|---------------|-----------|
| 5a | Download progress event forwarding | Unit | `tests/unit/playFiles/useHvscLibrary.progress.test.tsx` | Progress events from runtime update UI state correctly: percentage, stage label, bytes transferred. | <1s |
| 5b | Ingestion state transitions (IDLE→DOWNLOADING→...→READY) | Unit | same | Full state machine traversal with mocked runtime. Verify each intermediate state is reflected in hook output. | <1s |
| 5c | Cancellation mid-download | Unit | same | User cancels during download: verify state resets to IDLE, no ghost progress events fire. | <1s |
| 5d | Update check finds available update | Unit | same | `checkForHvscUpdates` returns `requiredUpdates: [85]`. Verify UI shows update available state. | <1s |
| 5e | Stale ingestion state recovery | Unit | same | On mount, if persisted state is `INGESTING` (stale from crash), verify automatic recovery to IDLE. | <1s |

### 2.3 `useVolumeOverride` (914 LOC, 42 tests)

Decent coverage but 914 LOC with 42 tests leaves room for specific edge cases:

| # | Test | Type | File | What it proves | Est. time |
|---|------|------|------|---------------|-----------|
| 6a | Volume mute/unmute race during song transition | Unit | `tests/unit/playFiles/useVolumeOverride.transition.test.tsx` | During auto-advance, volume restore from mute state races with the new track's volume setup. Verify final volume is correct. | <1s |

### 2.4 `useSonglengths` (517 LOC, ~41 tests across 3 files)

Reasonable coverage. One gap:

| # | Test | Type | File | What it proves | Est. time |
|---|------|------|------|---------------|-----------|
| 7a | Songlengths discovery from HVSC md5 hash fallback | Unit | `tests/unit/playFiles/useSonglengths.md5.test.tsx` | When local songlengths.txt is absent, fall back to HVSC md5 duration lookup. Verify duration updates. | <1s |

---

## 3. Telnet workflow coverage gaps

### 3.1 Telnet session reconnection under real-world conditions

**Current coverage**: `telnetSession.test.ts` (26 tests) covers happy path and max-retry failure. Missing:

| # | Test | Type | File | What it proves | Est. time |
|---|------|------|------|---------------|-----------|
| 8a | Reconnect succeeds on 2nd attempt after transport error | Unit | `tests/unit/telnet/telnetSession.reconnect.test.ts` | Transport fails once on `connect()`, succeeds on retry. Verify session is usable afterward. | <1s |
| 8b | Idle timeout fires disconnect after 5 min | Unit | same | Use fake timers. Advance 5 min. Verify `disconnect()` called on transport. | <1s |
| 8c | Password authentication flow | Unit | same | Connect with password. Verify "Password:" prompt detection → password send → authenticated state. | <1s |

### 3.2 Config telnet workflow end-to-end

**Current**: `configTelnetWorkflow.test.ts` (20 tests). Missing:

| # | Test | Type | File | What it proves | Est. time |
|---|------|------|------|---------------|-----------|
| 9a | Config write via telnet with navigation and confirmation | Unit | `tests/unit/lib/config/configTelnetWorkflow.navigation.test.ts` | Full workflow: connect → navigate to config item → modify value → confirm → disconnect. Uses mock transport. | <1s |

### 3.3 REU telnet workflow

**Current**: `reuTelnetWorkflow.test.ts` (11 tests). Add:

| # | Test | Type | File | What it proves | Est. time |
|---|------|------|------|---------------|-----------|
| 10a | REU snapshot save + restore round-trip | Unit | `tests/unit/lib/reu/reuTelnetWorkflow.roundtrip.test.ts` | Save REU state to named snapshot, then restore it. Verify correct telnet key sequences. | <1s |

---

## 4. Connection and device interaction gaps

### 4.1 `connectionManager.ts` (715 LOC, 55 tests)

Solid coverage. One critical gap:

| # | Test | Type | File | What it proves | Est. time |
|---|------|------|------|---------------|-----------|
| 11a | Startup discovery window expires → demo fallback | Unit | `tests/unit/connection/connectionManager.startup.test.ts` | Device unreachable during startup window. Window expires. Verify transition to `DEMO_ACTIVE` when auto-demo is enabled. | <1s |
| 11b | Background reconnect after network drop | Unit | same | Connected state → probe fails → retry succeeds → verify state returns to `REAL_CONNECTED`. | <1s |

### 4.2 `deviceInteractionManager.ts` (775 LOC, 50 tests)

Key gap is the circuit breaker:

| # | Test | Type | File | What it proves | Est. time |
|---|------|------|------|---------------|-----------|
| 12a | Circuit breaker opens after consecutive failures | Unit | `tests/unit/lib/deviceInteraction/deviceInteractionManager.circuit.test.ts` | N consecutive REST failures → circuit opens → requests rejected without network call → circuit closes after cooldown. | <1s |

---

## 5. Untested modules with non-trivial logic

### 5.1 `ftpDiskImport.ts` (90 LOC, 0 direct tests)

| # | Test | Type | File | What it proves | Est. time |
|---|------|------|------|---------------|-----------|
| 13a | FTP disk import creates disk entries with correct metadata | Unit | `tests/unit/lib/disks/ftpDiskImport.test.ts` | Import from FTP listing → disk entries have correct paths, names, sizes. | <1s |
| 13b | FTP import filters non-disk files | Unit | same | FTP listing with mixed file types → only .d64/.d71/.d81 imported. | <1s |

### 5.2 `configSnapshotStorage.ts` (111 LOC, 0 direct tests)

| # | Test | Type | File | What it proves | Est. time |
|---|------|------|------|---------------|-----------|
| 14a | Save, load, list, delete config snapshot | Unit | `tests/unit/lib/config/configSnapshotStorage.test.ts` | Full CRUD cycle using localStorage mock. | <1s |
| 14b | Corrupt localStorage entry handled gracefully | Unit | same | Invalid JSON in storage → load returns empty / logs error. | <1s |

### 5.3 `HvscManager.tsx` (55 LOC, 0 tests)

Small component but orchestrates HVSC install/browse toggling:

| # | Test | Type | File | What it proves | Est. time |
|---|------|------|------|---------------|-----------|
| 15a | Renders install panel when not ready | Unit | `tests/unit/pages/playFiles/components/HvscManager.test.tsx` | When `hvscStatus.ingestionState !== 'ready'`, renders HvscControls install view. | <1s |
| 15b | Renders browse panel when ready | Unit | same | When ready, renders browse/source navigation view. | <1s |

---

## 6. Playwright E2E strengthening

### 6.1 New CommoServe E2E spec

As described in section 2 (items 2a, 2b). This is the only major feature with zero E2E coverage.

### 6.2 Playback auto-advance E2E proof

| # | Test | Type | File | What it proves | Est. time |
|---|------|------|------|---------------|-----------|
| 16a | 3-song playlist plays through automatically | Playwright | `playwright/playbackAutoAdvance.spec.ts` | Add 3 short-duration SIDs, play first, verify all 3 play in sequence without user interaction. Uses mock C64U with instant "SID accepted" responses and short fixed durations. | ~8s |
| 16b | Repeat mode loops playlist | Playwright | same | Same as above but with repeat enabled. Verify playlist wraps to first song after last. | ~8s |

### 6.3 Disk mount + autostart E2E proof

| # | Test | Type | File | What it proves | Est. time |
|---|------|------|------|---------------|-----------|
| 17a | Mount d64 from FTP browser → autostart | Playwright | `playwright/diskAutostart.spec.ts` | Browse FTP, select .d64, mount to drive, verify autostart sequence written to keyboard buffer via REST. | ~5s |

---

## 7. Agentic tests (real hardware)

These require a real Android device + real C64 Ultimate and use c64bridge/c64scope/droidmind.

| # | Test | Scope | What it proves | Est. time |
|---|------|-------|---------------|-----------|
| 18a | HVSC full lifecycle: download → ingest → browse → play | Real device | Complete HVSC pipeline on Android with real 7z extraction, real filesystem, real C64U SID playback. Captures audio evidence via c64scope. | ~120s |
| 18b | CommoServe search → play SID on real C64U | Real device | Network search, binary download, upload to real C64U, verify audio. | ~30s |
| 18c | FTP browse → mount disk → autostart → verify C64 screen | Real device | FTP to real C64U, mount d64, autostart, capture C64 screen via REST to verify program loaded. | ~30s |
| 18d | Telnet power cycle → reconnect → verify connection restored | Real device | Telnet-based power cycle, wait for C64U to reboot, verify REST API responds, connection state recovers. | ~45s |

---

## 8. Priority and time budget

### Tier 1: Must-do (highest ROI, proves the hardest-to-verify flows)

| Items | Type | Added test time |
|-------|------|----------------|
| 1a, 1c, 1d | HVSC ingestion chain | ~45s + <2s unit |
| 2a, 2b, 2c, 2d | CommoServe E2E + unit | ~10s + <2s unit |
| 3a, 3b, 3c | Auto-advance unit | <3s |
| 4a, 4b, 4c | usePlaylistManager | <3s |
| 16a, 16b | Auto-advance E2E | ~16s |

**Tier 1 total added time**: ~80s (one-time Maestro flow + ~20s Playwright + <10s unit)

### Tier 2: Should-do (fills known unit-test gaps)

| Items | Type | Added test time |
|-------|------|----------------|
| 5a-5e | useHvscLibrary | <5s |
| 6a | Volume override race | <1s |
| 8a-8c | Telnet session | <3s |
| 11a, 11b | Connection manager | <2s |
| 12a | Circuit breaker | <1s |
| 13a, 13b | FTP disk import | <2s |
| 14a, 14b | Config snapshot storage | <2s |

**Tier 2 total added time**: <16s unit

### Tier 3: Nice-to-have (polishing)

| Items | Type | Added test time |
|-------|------|----------------|
| 7a, 9a, 10a | Songlengths/Config/REU | <3s |
| 15a, 15b | HvscManager component | <1s |
| 17a | Disk autostart E2E | ~5s |
| 3d | Pause blocks auto-advance E2E | ~3s |

**Tier 3 total added time**: ~12s

### Tier 4: Agentic (real device, requires lab)

Items 18a-18d. Run time ~225s but run separately from CI.

---

## 9. Non-goals

- **Full page-level render tests for PlayFilesPage (1417 LOC)**: The page is tested transitively through its hooks and Playwright. Adding a monolithic render test would be slow and brittle.
- **Increasing Maestro coverage for iOS**: iOS Maestro already covers the critical persistence paths. The gaps are on Android and the real-device path.
- **Contract test expansion**: The `tests/contract/` suite is already robust for REST/telnet protocol conformance.
- **Exhaustive branch coverage for utility modules**: Modules like `src/lib/ui/`, `src/lib/tracing/`, `src/lib/diagnostics/` already have thorough coverage. Focus on the user-visible feature chains instead.

---

## 10. Implementation notes

- All new unit tests should use Vitest with `vi.useFakeTimers()` for time-dependent tests (auto-advance, idle timeout, circuit breaker cooldown).
- New Playwright specs should use the existing `createMockC64Server()` and `seedUiMocks()` infrastructure.
- The tiny HVSC test archive for Maestro 1a should be committed to `android/app/src/test/fixtures/` (a ~2 MB 7z is acceptable; the baseline fixture is already there).
- CommoServe E2E tests (2a, 2b) need a mock archive HTTP server similar to `playwright/mockHvscServer.ts`. Create `playwright/mockArchiveServer.ts`.
- For agentic tests (Tier 4), follow the contracts in `docs/testing/agentic-tests/`.
