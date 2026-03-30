# Test Coverage Strengthening — Implementation Prompt

You are working on C64 Commander, a React + Vite + Capacitor app. Your job is to implement the test coverage improvements described in the companion plan `docs/plans/tests/test-coverage-strengthening.md`. Read that file first.

## Execution rules

1. **Read before writing**: Before creating any test file, read the source module it targets AND at least one existing test file for that module (or a sibling module) to understand patterns, mocking conventions, and imports.
2. **Follow existing conventions exactly**: This codebase has 5205 tests across 447 files. Match the exact style of neighboring test files — same license header, same import style, same `describe`/`it` nesting, same mock patterns.
3. **Vitest only for unit tests**: All unit tests use Vitest. Use `vi.fn()`, `vi.mock()`, `vi.useFakeTimers()`, `vi.advanceTimersByTime()`. Do NOT use Jest APIs.
4. **Playwright for E2E**: Playwright tests use `@playwright/test`. Use the existing helpers: `createMockC64Server()` from `tests/mocks/mockC64Server`, `seedUiMocks()`/`uiFixtures` from `playwright/uiMocks`, `startStrictUiMonitoring()`/`assertNoUiIssues()`/`finalizeEvidence()` from `playwright/testArtifacts`, trace assertions from `playwright/traceUtils`.
5. **Never skip, never suppress**: Do not use `.skip`, `.todo`, `xdescribe`, or `xit`. Every test you write must pass. If something is genuinely untestable, explain why in a comment and move on.
6. **No silent exception swallowing**: If your test code catches exceptions, it must rethrow or assert on them.
7. **Run tests after each file**: After writing each test file, run it in isolation to confirm it passes: `npx vitest run <path>` for unit tests.
8. **Mandatory coverage gate**: After all tests are written, run `npm run test:coverage` and confirm >= 91% branch coverage globally.

## Implementation order

Work through the plan tiers in order. Within each tier, implement all unit tests first, then Playwright specs. Skip Maestro and agentic tests (Tiers 1a, 1b, 18a-18d) — those require device infrastructure.

### Tier 1: Must-do

#### 1c — HVSC update archive ingestion
- **File**: `tests/unit/hvsc/hvscIngestionRuntime.update.test.ts`
- **Source**: `src/lib/hvsc/hvscIngestionRuntime.ts` (the `ingestArchiveBuffer` function)
- **Read first**: `tests/unit/hvsc/hvscIngestionRuntime.test.ts` for mocking patterns
- **Tests to write**:
  - Update archive processes delete.txt and removes listed files from library
  - Update archive adds new songs to the library and browse index
  - Update archive updates songlengths for changed songs
  - Update archive applied on top of baseline preserves existing songs not in update

#### 1d — HVSC ingestion failure recovery
- **File**: `tests/unit/hvsc/hvscIngestionRuntime.recovery.test.ts`
- **Source**: `src/lib/hvsc/hvscIngestionRuntime.ts`, `src/lib/hvsc/hvscIngestionRuntimeSupport.ts`
- **Read first**: `tests/unit/hvsc/hvscIngestionRecovery.test.ts` for existing recovery patterns
- **Tests to write**:
  - Mid-extraction failure rolls back ingestion state to IDLE
  - After rollback, retry succeeds and reaches READY state
  - Cancellation token stops in-progress ingestion cleanly

#### 2a, 2b — CommoServe E2E
- **File**: `playwright/commoserve.spec.ts`
- **Read first**: `playwright/hvsc.spec.ts` and `playwright/playback.spec.ts` for patterns
- **Also create**: `playwright/mockArchiveServer.ts` (model after `playwright/mockHvscServer.ts`)
- **Tests to write**:
  - CommoServe search returns results and user selects SID → downloads → uploads to mock C64U → playback starts
  - CommoServe search returns results and user selects d64 → downloads → mounts to mock C64U drive → autostart
- **Mock archive server must**:
  - Serve a `/api/v1/search` endpoint returning a canned search result
  - Serve a `/api/v1/entries/{id}` endpoint returning file metadata
  - Serve a `/api/v1/entries/{id}/binary` endpoint returning actual SID/d64 bytes from fixtures
- **Use fixtures**: The existing SID fixtures in `playwright/fixtures/local-play-sids/` can be reused as archive binary responses

#### 2c — Archive native binary decoding
- **File**: `tests/unit/archive/client.nativeDownload.test.ts`
- **Source**: `src/lib/archive/client.ts` (the `decodeNativeBinaryData` function)
- **Read first**: `tests/unit/archive/client.test.ts`
- **Tests to write**:
  - `decodeNativeBinaryData` handles ArrayBuffer input (passthrough)
  - `decodeNativeBinaryData` handles Uint8Array input (extracts underlying buffer)
  - `decodeNativeBinaryData` handles plain byte array `[0x50, 0x53, ...]` (converts via Uint8Array)
  - `decodeNativeBinaryData` handles base64-encoded string input (decodes via atob)
  - `decodeNativeBinaryData` throws on unsupported input type (number, null)
  - `isUnsupportedSignalError` detects Capacitor signal error message

#### 2d — Archive execution edge cases
- **File**: `tests/unit/archive/execution.extended.test.ts`
- **Source**: `src/lib/archive/execution.ts`
- **Read first**: `tests/unit/archive/execution.test.ts`
- **Tests to write**:
  - `buildArchivePlayPlan` adds `.sid` extension to extensionless filename when bytes are detected as SID
  - `buildArchivePlayPlan` adds `.d64` extension to extensionless filename when bytes are detected as d64
  - `buildArchivePlayPlan` throws for corrupt/invalid bytes that fail validation
  - `buildArchivePlayPlan` throws for completely unsupported file types
  - `getArchiveEntryActionLabel` returns correct labels: "Play" for .sid, "Mount & run" for .d64, "Run" for .prg, "Execute" for unknown
  - All entries in `FILE_TYPE_TO_EXTENSION` map are covered

#### 3a — Multi-song auto-advance chain
- **File**: `tests/unit/playFiles/usePlaybackController.autoAdvance.test.tsx`
- **Source**: `src/pages/playFiles/hooks/usePlaybackController.ts`
- **Read first**: `tests/unit/playFiles/usePlaybackController.test.tsx` for hook rendering and mocking patterns
- **Tests to write**:
  - 3-song playlist with known durations: song 1 timer fires → currentIndex advances to 1 → song 2 timer fires → advances to 2 → song 3 timer fires → isPlaying becomes false (repeat off)
  - Same scenario with repeat enabled: after song 3 timer fires → currentIndex wraps to 0
  - User manually advances (next) during auto-advance timer → previous timer is cancelled, new timer set

#### 3b — Subsong auto-advance
- **File**: `tests/unit/playFiles/usePlaybackController.subsong.test.tsx`
- **Source**: same
- **Tests to write**:
  - Multi-subsong SID (3 subsongs): subsong 1 duration expires → advances to subsong 2 → subsong 2 expires → subsong 3 → subsong 3 expires → next track in playlist

#### 3c — Concurrent play supersedes
- **File**: `tests/unit/playFiles/usePlaybackController.concurrency.test.tsx`
- **Source**: same + `src/lib/deviceInteraction/machineTransitionCoordinator.ts`
- **Tests to write**:
  - Start play on track A, immediately start play on track B → track A's executePlayPlan is aborted/superseded → track B plays successfully
  - Verify SupersededMachineTransitionError is thrown for track A and does NOT surface as user-visible error

#### 4a, 4b, 4c — usePlaylistManager
- **File**: `tests/unit/playFiles/usePlaylistManager.test.tsx`
- **Source**: `src/pages/playFiles/hooks/usePlaylistManager.ts`
- **Read first**: `tests/unit/playFiles/usePlaybackController.test.tsx` for renderHook patterns
- **Tests to write**:
  - `reshufflePlaylist` with 5 items produces a different order (may need to mock Math.random)
  - `reshufflePlaylist` keeps the current item at `lockedIndex`
  - `reshufflePlaylist` with 2 items guarantees swap (fallback logic)
  - `reshufflePlaylist` with 1 item returns same array
  - `reshufflePlaylist` with no locked index shuffles all items
  - Selection set is pruned when playlist items are removed
  - `handleReshuffle` is a no-op when shuffle is disabled
  - `handleReshuffle` is a no-op when playlist is empty

#### 16a, 16b — Auto-advance E2E
- **File**: `playwright/playbackAutoAdvance.spec.ts`
- **Read first**: `playwright/playback.spec.ts` for setup patterns
- **Tests to write**:
  - Add 3 local SID files with short fixed durations (use mock songlengths). Play first. Verify all 3 play in sequence (check currentIndex or track title changes). Verify playback stops after last.
  - Same but with repeat enabled. Verify playlist wraps — first song plays again after last finishes.

### Tier 2: Should-do

#### 5a-5e — useHvscLibrary deep coverage
- **File**: `tests/unit/playFiles/useHvscLibrary.progress.test.tsx`
- **Source**: `src/pages/playFiles/hooks/useHvscLibrary.ts`
- **Read first**: `tests/unit/playFiles/useHvscLibrary.test.tsx`
- **Tests**: Progress forwarding, full state machine traversal, cancellation, update check, stale recovery (as described in plan)

#### 6a — Volume mute/unmute race
- **File**: `tests/unit/playFiles/useVolumeOverride.transition.test.tsx`
- **Source**: `src/pages/playFiles/hooks/useVolumeOverride.ts`
- **Read first**: `tests/unit/playFiles/useVolumeOverride.test.tsx`
- **Test**: During auto-advance with volume muted, verify volume is correctly restored for new track

#### 8a-8c — Telnet session reconnection
- **File**: `tests/unit/telnet/telnetSession.reconnect.test.ts`
- **Source**: `src/lib/telnet/telnetSession.ts`
- **Read first**: `tests/unit/telnet/telnetSession.test.ts`
- **Tests**: Reconnect on 2nd attempt, idle timeout disconnect (fake timers), password authentication flow

#### 11a, 11b — Connection manager startup/reconnect
- **File**: `tests/unit/connection/connectionManager.startup.test.ts`
- **Source**: `src/lib/connection/connectionManager.ts`
- **Read first**: `tests/unit/connection/connectionManager.test.ts`
- **Tests**: Discovery window expiry → demo fallback, background reconnect after network drop

#### 12a — Circuit breaker
- **File**: `tests/unit/lib/deviceInteraction/deviceInteractionManager.circuit.test.ts`
- **Source**: `src/lib/deviceInteraction/deviceInteractionManager.ts`
- **Read first**: `tests/unit/lib/deviceInteraction/deviceInteractionManager.test.ts`
- **Test**: N failures → circuit opens → requests rejected → cooldown → circuit closes

#### 13a, 13b — FTP disk import
- **File**: `tests/unit/lib/disks/ftpDiskImport.test.ts`
- **Source**: `src/lib/disks/ftpDiskImport.ts`
- **Read first**: `tests/unit/lib/disks/diskMount.test.ts` for disk-related mocking
- **Tests**: Import creates correct entries, filters non-disk files

#### 14a, 14b — Config snapshot storage
- **File**: `tests/unit/lib/config/configSnapshotStorage.test.ts`
- **Source**: `src/lib/config/configSnapshotStorage.ts`
- **Read first**: `tests/unit/config/appConfigStore.test.ts` for localStorage mocking
- **Tests**: CRUD cycle, corrupt JSON handling

### Tier 3: Nice-to-have

#### 7a — Songlengths md5 fallback
- **File**: `tests/unit/playFiles/useSonglengths.md5.test.tsx`

#### 9a — Config telnet navigation
- **File**: `tests/unit/lib/config/configTelnetWorkflow.navigation.test.ts`

#### 10a — REU round-trip
- **File**: `tests/unit/lib/reu/reuTelnetWorkflow.roundtrip.test.ts`

#### 15a, 15b — HvscManager component
- **File**: `tests/unit/pages/playFiles/components/HvscManager.test.tsx`

#### 17a — Disk autostart E2E
- **File**: `playwright/diskAutostart.spec.ts`

#### 3d — Pause blocks auto-advance E2E
- Add to `playwright/playback.spec.ts`

## Quality checklist before declaring done

- [ ] Every new test file passes in isolation: `npx vitest run <path>`
- [ ] Full unit suite passes: `npm run test`
- [ ] Full lint passes: `npm run lint`
- [ ] Playwright tests pass: `npm run test:e2e`
- [ ] Branch coverage >= 91%: `npm run test:coverage`
- [ ] No `.skip`, `.todo`, or `xdescribe` in any new file
- [ ] No silent exception catches in test code
- [ ] License header present on every new file (copy from any existing test file)
- [ ] Prettier formatting applied: `npm run format:ts`
