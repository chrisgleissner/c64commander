# Playback Hardening Plan

Based on: `doc/research-playback-hvsc-risk-analysis-2026-02-11.md`

## Scope Summary

Address all critical, high, medium, and low findings from the 2026-02-11 risk analysis. Covers: silent exception remediation, observability/tracing unification, locked-device auto-skip reliability, C64U duration propagation hardening, cross-source lifecycle resilience, HVSC ingestion memory safety, and UX consistency. Each phase is ordered by dependency and severity: foundational diagnostics first, then reliability, then polish.

## Assumptions And Constraints

- Phases are ordered by dependency: later phases rely on diagnostics/observability improvements from earlier phases.
- Hardware lock-screen behavior cannot be fully validated in CI; Maestro on emulator + documented manual verification steps are the practical ceiling.
- Memory stress tests for HVSC require representative fixture archives; production-size archives may need to be downloaded or synthesized.
- Open questions from the research document (Section 7) are resolved inline per phase with the most defensible default; deviations require explicit product decision.

## Open Question Resolutions

1. **Q1 (useSidPlayer legacy status)**: Requires research. Phase 2 begins with a code-level audit of all `useSidPlayer` consumers to determine if it has any active, non-trace responsibilities. The likely outcome is deprecation and migration, but the audit must confirm this before removal. No new consumers should be added regardless.
2. **Q2 (authoritative completion signal)**: Requires research. Phase 3 begins with a code-level investigation of what signals are available (JS timers, C64U device status polling, native service callbacks) and selects the most reliable primary signal. The plan assumes JS guard timers + native watchdog as a starting point but the research step may revise this.
3. **Q3 (lock-screen auto-skip scope)**: Required for all playback source kinds (`local`, `ultimate`, `hvsc`). On Android, `local` can be SAF-backed; this is an access mode, not a separate source kind. Phase 3 implements source-agnostic lock survival.
4. **Q4 (ultimate SID without SSL)**: **Not acceptable.** The app must always attempt to propagate song-length information (SSL) to the C64U. Failure to propagate SSL when a `Songlengths.md5` file is available and contains the relevant entry is classified as an **error**. However, playback must still proceed — the song must play even if SSL propagation fails, and the error must be logged with full context. Phase 4 implements strict error handling for this path.
5. **Q5 (Android SAF process recreation guarantees for local sources)**: Best-effort. Playlists must survive app restarts and phone restarts. URI rebinding is attempted on restore for SAF-backed local items; if permissions are revoked, the affected items are marked unavailable with a user-facing indicator. Phase 5 implements this.
6. **Q6 (HVSC partial failure acceptance)**: **No partial failures are accepted.** Every song in the archive must be ingested. The ingestion result must report the exact count of songs successfully ingested and the count that failed. Ingestion is considered **unsuccessful** (state = `failed`) if even a single song cannot be ingested — with one exception: syntax errors in `Songlengths.md5` are tolerated. Songlength syntax errors are ignored during ingestion, shown in the UI as a warning with the count of affected entries, and the import is still considered a success. Phase 6 implements this strict contract.
7. **Q7 (native crash envelope)**: As much detail as possible. Every native failure log must include: operation phase, correlation ID, source kind, error class, affected file/URI, plugin method name, and full stack trace. The more context, the better — do not economize on diagnostic detail. Phase 1 and Phase 2 establish this contract.
8. **Q8 (HVSC source identity in UI)**: **Hugely important.** HVSC must be a fully first-class source. The user should never need to know or care whether a song came from the C64U, a local Android download, or HVSC. All sources feed into a single unified playlist experience. The source distinction must be **transparent** to the user — they simply add songs from C64U, local storage, or HVSC, and the playlist treats them identically. Source-specific icons/labels may appear in browse/source-selection views, but the playlist itself must present a unified, source-agnostic experience. Phase 7 (elevated to High severity) implements this.

---

## Phase 1: Silent Exception Handling Remediation [Critical C3]

**Goal**: Eliminate all silent catch patterns across JS/TS and Kotlin code. Every caught exception must either rethrow with context or log at WARN/ERROR with stack trace and operation context. This is foundational — all subsequent phases depend on proper error visibility.

**Severity**: Critical (release-blocking per repository standards).

**Status (2026-02-11)**: Completed.

### Subtasks

- [x] **1.1 Audit and catalog all silent catches in JS/TS**
  - Grep for `catch` blocks across `src/` and classify each as: silent, logging-only-no-context, rethrowing, or compliant.
  - Known locations from research (non-exhaustive, full grep required):
    - `src/lib/sid/sidUtils.ts:45`
    - `src/lib/sourceNavigation/ftpSourceAdapter.ts:39`, `:48`
    - `src/lib/hvsc/hvscFilesystem.ts:70`, `:85`, `:111`, `:146`, `:233`, `:262`, `:303`, `:314`, `:320`
    - `src/lib/hvsc/hvscDownload.ts:42`, `:52`, `:70`, `:191`, `:204`, `:280`, `:370`
    - `src/lib/connection/connectionManager.ts:233`, `:536`
    - `src/hooks/useSidPlayer.tsx:87`, `:149`
    - `src/lib/hvsc/hvscStateStore.ts:54`
    - `src/lib/hvsc/hvscStatusStore.ts:68`
  - Produce a tracking list with file, line, current behavior, and planned fix.

- [x] **1.2 Fix silent catches in HVSC module (`src/lib/hvsc/`)**
  - For each silent catch in `hvscFilesystem.ts`, `hvscDownload.ts`, `hvscStateStore.ts`, `hvscStatusStore.ts`:
    - Add `console.warn` or `console.error` with: operation name, relevant identifiers (e.g. file path, URL, archive entry), and full error object.
    - Where the function returns a default/fallback value, add a log at WARN level before returning.
    - Where the catch swallows a potentially corrupting error (e.g., filesystem write failure), rethrow with enriched context instead.
  - Do NOT change control flow unless the silent catch masks a state-corruption risk.

- [x] **1.3 Fix silent catches in source navigation and SID utilities**
  - `src/lib/sourceNavigation/ftpSourceAdapter.ts:39`, `:48`: Log error with FTP host, path, and operation context at WARN.
  - `src/lib/sid/sidUtils.ts:45`: Log parse failure with input context (file size, header bytes if available) at WARN.

- [x] **1.4 Fix silent catches in connection manager**
  - `src/lib/connection/connectionManager.ts:233`, `:536`: Log with connection state, host, and operation phase at WARN.

- [x] **1.5 Fix silent catches in legacy SID player hook**
  - `src/hooks/useSidPlayer.tsx:87`, `:149`: Log with playback state context at WARN. If `BackgroundExecution.start/stop` fails, log the error; do not swallow.

- [x] **1.6 Fix silent catches in Android Kotlin plugins**
  - `android/app/src/main/java/uk/gleissner/c64commander/FtpClientPlugin.kt:145`: Replace silent catch with `Log.e(TAG, "...", e)` including operation phase and connection identifiers.
  - `android/app/src/main/java/uk/gleissner/c64commander/FolderPickerPlugin.kt:71`, `:183`: Replace silent catches with `Log.e(TAG, "...", e)` including URI and operation context.
  - Ensure all `call.reject(...)` calls include the exception message string, not just a generic label.

- [x] **1.7 Add unit tests asserting error logging for previously-silent paths**
  - For each fixed catch, add or extend a unit test that:
    - Triggers the failure condition (mock the dependency to throw).
    - Asserts that `console.warn`/`console.error` was called (use `vi.spyOn`).
    - Asserts that the error log contains expected context fields (operation, identifier, error message).
  - For Kotlin: add JVM unit tests asserting that plugin methods produce structured log output on failure.

- [x] **1.8 Run full build and test suite**
  - `npm run lint && npm run test && npm run build && npm run test:e2e`
  - `cd android && ./gradlew test`
  - Fix any regressions before proceeding to Phase 2.

---

## Phase 2: Observability and Tracing Unification [Critical C2 + Section 6]

**Goal**: Align trace context with the active playback engine, establish a cross-layer failure taxonomy, and define a JS-to-native correlation contract. After this phase, incident triage can accurately reconstruct playback state from traces.

**Severity**: Critical (C2) + High (observability gaps from Section 6).

### Subtasks

- [x] **2.1 Audit all useSidPlayer consumers and determine legacy status [Q1 research]**
  - Grep for all imports/usages of `useSidPlayer` across the codebase.
  - For each consumer, determine: is it active production code, trace-only, or dead code?
  - Known consumers from research: `src/components/TraceContextBridge.tsx:27`, `src/App.tsx:98` (provider), `src/hooks/useSidPlayer.tsx` (definition).
  - Determine if `useSidPlayer` holds any runtime state that is not also held by `usePlaybackController` (e.g., background execution start/stop, audio context). Document findings.
  - **Decision gate**: if all active responsibilities can be migrated to `usePlaybackController`, mark `useSidPlayer` as deprecated and plan removal in subtask 2.8. If it has unique active responsibilities, document them and integrate rather than remove.

- [x] **2.2 Migrate TraceContextBridge away from legacy useSidPlayer**
  - In `src/components/TraceContextBridge.tsx`: replace `useSidPlayer()` context reads with state sourced from the active playback engine (`usePlaybackController` or its exposed state).
  - The bridge must read: current track ID/path, playback state (playing/paused/stopped), source kind (`local` | `ultimate` | `hvsc`), elapsed time, and queue position.
  - For Android diagnostics, include an optional `localAccessMode` field when source kind is `local` (`entries` | `saf`), instead of adding a new source kind.
  - Verify that `src/App.tsx` still provides the bridge with correct context after the change.

- [x] **2.3 Define and implement a cross-layer failure taxonomy enum**
  - Create `src/lib/errors/failureTaxonomy.ts` with an enum/union type covering:
    - `user-cancellation`: User explicitly cancelled an operation.
    - `network-transient`: Transient network error (timeout, connection reset).
    - `network-unreachable`: Host/service unreachable.
    - `io-read-failure`: File/stream read error.
    - `io-write-failure`: File/stream write error.
    - `parse-failure`: Data format/parse error (SID header, JSON, archive entry).
    - `metadata-absent`: Expected metadata not found (duration, songlength, HVSC index entry).
    - `permission-denied`: OS/SAF permission revoked or insufficient.
    - `resource-exhausted`: Memory, storage, or quota exceeded.
    - `plugin-failure`: Native plugin returned an error.
    - `playback-device-error`: C64U returned an error response.
    - `unknown`: Unclassifiable error.
  - Export a `classifyError(error: unknown, context?: string): FailureClass` helper that maps common error shapes (e.g., `AxiosError` codes, `DOMException` names, native plugin rejection patterns) to taxonomy entries.

- [x] **2.4 Integrate failure taxonomy into key catch blocks**
  - In all catch blocks modified in Phase 1, call `classifyError(e, operationContext)` and include the resulting class in the log output.
  - In `src/lib/playback/playbackRouter.ts`: classify FTP fetch failure, upload failure, and fallback separately.
  - In `src/lib/hvsc/hvscIngestionRuntime.ts`: classify download, extraction, and indexing failures separately.
  - In `src/lib/c64api.ts`: classify REST call failures with the taxonomy.

- [x] **2.5 Add correlation ID pass-through to native plugin interfaces**
  - Extend the JS->native bridge call signatures in `src/lib/native/ftpClient.ts` and `src/lib/native/folderPicker.ts` to accept an optional `correlationId: string` parameter.
  - In the Kotlin plugins (`FtpClientPlugin.kt`, `FolderPickerPlugin.kt`), read the correlation ID from `call.getString("correlationId")` and include it in all `Log.d`/`Log.e` entries.
  - In `BackgroundExecutionPlugin.kt` / `BackgroundExecutionService.kt`, accept and log a correlation ID for start/stop lifecycle events.
  - Generate the correlation ID from `src/lib/tracing/traceSession.ts` before invoking native plugins and include it in trace events.

- [x] **2.6 Add lifecycle state context to trace events**
  - In `src/lib/tracing/traceSession.ts`, add a `lifecycleState` field to trace event payloads. Possible values: `foreground`, `background`, `locked`, `unknown`.
  - Source the lifecycle state from browser visibility/focus events (`document.visibilityState`, `document.hasFocus()`) and from the `BackgroundExecution` native bridge state if available.
  - Emit lifecycle state in all playback-related trace events.

- [x] **2.7 Add source-kind and queue-identifier context to trace events**
  - Ensure every playback trace event includes: `sourceKind` (`local` | `ultimate` | `hvsc`), `trackInstanceId`, and `playlistItemId`.
  - For Android local playback diagnostics, include optional `localAccessMode` (`entries` | `saf`) when source kind is `local`.
  - Update `src/lib/tracing/traceBridge.ts` and `TraceContextBridge.tsx` to populate these fields from the active playback engine state.

- [x] **2.8 Remove or gate legacy SidPlayerProvider wrapping**
  - Based on findings from subtask 2.1:
    - If `useSidPlayer` has no remaining active responsibilities beyond trace context (now migrated in 2.2), remove `SidPlayerProvider` from `src/App.tsx` entirely.
    - If `useSidPlayer` has unique active responsibilities (e.g., background execution lifecycle), migrate those to `usePlaybackController` or a dedicated hook, then remove the provider.
    - If migration is complex, gate the provider behind a feature flag for safe rollout.
  - In all cases: add `@deprecated` annotation to `useSidPlayer.tsx` and ensure no new consumers are added.

- [x] **2.9 Unit and E2E tests for trace context accuracy**
  - Add unit tests for `TraceContextBridge` verifying it reads from the active playback engine, not `useSidPlayer`.
  - Add unit tests for `classifyError` covering each taxonomy entry with representative error shapes.
  - Extend Playwright trace-related tests to assert that playback trace events contain `sourceKind`, `trackInstanceId`, and `lifecycleState` fields.
  - Verify correlation ID presence in mock-native-plugin test scenarios.

- [x] **2.10 Run full build and test suite**
  - `npm run lint && npm run test && npm run build && npm run test:e2e`
  - `cd android && ./gradlew test`
  - Fix any regressions.

---

## Phase 3: Locked-Device Auto-Skip Reliability [Critical C1 + Medium M3]

**Goal**: Ensure song completion triggers auto-advance reliably when the device is locked or the app is backgrounded across all playback source kinds (`local`, `ultimate`, `hvsc`), including SAF-backed Android local playback.

**Severity**: Critical (C1) + Medium (M3).

### Subtasks

- [x] **3.1 Research authoritative completion signal options [Q2 research]**
  - Investigate what completion signals are actually available:
    1. **JS guard timers** (`dueAtMs` + `setInterval`): current mechanism. Subject to WebView throttling.
    2. **C64U device status polling**: check if the C64U REST API exposes a "playback finished" or "idle" status endpoint (review `doc/c64/c64u-openapi.yaml` for runner status or player state endpoints).
    3. **Native service callbacks**: check if `BackgroundExecutionService.kt` can provide a timer-fired callback to JS.
  - **Decision gate**: select primary signal (most reliable under lock) and secondary watchdog. Document rationale in `doc/developer.md`.
  - If C64U status polling is available and reliable, consider it as the primary signal (device-authoritative). If not, JS timers + native watchdog remain the approach.

- [x] **3.2 Analyze current timer and lifecycle hook behavior**
  - Read and document the exact auto-skip timing mechanism in `src/pages/PlayFilesPage.tsx` (lines ~464-500, ~652-658).
  - Read and document the `setInterval`/`setTimeout` usage and `visibilitychange`/`pageshow`/`focus` event handlers.
  - Identify which timers are subject to browser throttling or suspension when the page is hidden or the device is locked (behavior varies by Android version, OEM, and power state).

- [x] **3.3 Validate and harden visibility-aware timer reconciliation**
  - `PlayFilesPage.tsx` already wires `visibilitychange`, `focus`, and `pageshow` to `syncPlaybackTimeline()`.
  - Verify this path reliably triggers immediate auto-next when `dueAtMs` has passed (without waiting for an interval tick) and make behavior consistent if logic is split between page and hook layers.
  - Consolidate timer-reconciliation ownership (page vs controller) so there is one authoritative auto-next path.

- [x] **3.4 Integrate Android foreground service with active playback path**
  - In `usePlaybackController.ts` (or a new hook `useBackgroundPlayback.ts`):
    - Call `BackgroundExecution.start()` (via `src/lib/native/backgroundExecution.ts`) when playback begins.
    - Call `BackgroundExecution.stop()` when playback stops or the queue is exhausted.
    - Pass a correlation ID to the native service for log correlation (Phase 2.4 contract).
  - This wakelock/foreground-service keeps the WebView process alive and reduces timer throttling severity on Android.
  - The legacy `useSidPlayer` calls to `BackgroundExecution` should be removed or no-op'd to prevent double-start.

- [x] **3.5 Add a native heartbeat/watchdog mechanism**
  - In `BackgroundExecutionService.kt`:
    - Accept an expected `dueAtMs` timestamp via the plugin bridge.
    - If the service is running and `dueAtMs` has passed without a JS `stop()` or `renew()` call, fire a local broadcast or Capacitor event (`backgroundAutoSkipDue`) to wake the WebView.
  - In JS: listen for the `backgroundAutoSkipDue` event and trigger auto-next if the queue state confirms the track should have completed.
  - This is a secondary safety net, not the primary mechanism.

- [x] **3.6 Handle OEM battery optimization edge cases**
  - Document in `doc/developer.md`: known OEM restrictions (Doze, App Standby, battery saver) and their impact on foreground services and WebView timers.
  - In the app: when `BackgroundExecution.start()` fails or the service is killed, log at WARN with lifecycle context (Phase 2.5) and continue with JS-only timers as fallback.
  - Do not crash or stall the queue if the native service is unavailable.

- [x] **3.7 Add tests for lock-state auto-skip behavior**
  - **Unit tests** (`usePlaybackController` or `PlayFilesPage` test):
    - Mock `document.visibilityState` to `hidden`, advance fake timers past `dueAtMs`, then set visibility to `visible`. Assert auto-next fires immediately on visibility change.
    - Test that `dueAtMs` recomputation after resume is correct (not double-counting elapsed time).
  - **Playwright tests**:
    - Existing foreground auto-skip tests remain.
    - Add a test simulating `visibilitychange` (via `page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')) })` after page hidden override) and verifying auto-next.
  - **Maestro (manual validation)**:
    - Document a manual Maestro flow that locks the device (`adb shell input keyevent 26`), waits for song duration, unlocks, and verifies the queue advanced.
    - This cannot be fully automated in CI but should be runnable locally.

- [x] **3.8 Run full build and test suite**
  - `npm run lint && npm run test && npm run build && npm run test:e2e`
  - `cd android && ./gradlew test`
  - Fix any regressions.

---

## Phase 4: C64U Duration Propagation Hardening [High H1]

**Goal**: Ensure SSL (song-length) information is **always** propagated to the C64U when a `Songlengths.md5` is available. Failure to propagate when data is available is an **error**, not an acceptable degradation. However, playback must always proceed regardless — the song must play even if SSL upload fails, and the failure must be logged with full context and classified error. Retry transient failures. Build complete failure-mode test coverage.

**Severity**: High (elevated: strict requirement per Q4).

### Subtasks

- [ ] **4.1 Map the complete duration propagation failure taxonomy**
  - Document all failure points in `src/lib/playback/playbackRouter.ts` for the ultimate-source branch:
    1. FTP readback of SID blob fails (`tryFetchUltimateSidBlob`).
    2. SID blob is fetched but SSL computation fails (parse error in `sidUtils.ts`).
    3. SID + SSL upload (`playSidUpload`) fails with transient error (timeout, 5xx).
    4. SID + SSL upload fails with permanent error (4xx, malformed request).
    5. Fallback `playSid(path, songNr)` fails.
  - For each: define expected behavior (retry? fallback-with-error? abort?), error classification (Phase 2 taxonomy), and trace event.
  - Key distinction: if `Songlengths.md5` data was available for this track and SSL could not be propagated, this is a **classified error** (`ssl-propagation-failure`), not informational.

- [ ] **4.2 Add retry for idempotent upload failures**
  - In `src/lib/c64api.ts`: the current retry config (`src/lib/c64api.ts:36`, `:513-514`) only retries safe methods (GET/HEAD/OPTIONS).
  - `playSidUpload` is a POST to `/v1/runners:sidplay` which is functionally idempotent (uploading the same SID+SSL again has no side effect beyond restarting playback).
  - Add a specific retry policy for this endpoint: retry up to 2 times on transient failures (network timeout, 502/503/504) with exponential backoff.
  - Log each retry attempt with failure class and attempt number.

- [ ] **4.3 Implement strict error-on-missing-SSL path**
  - In `src/lib/playback/playbackRouter.ts`:
    - When the SID+SSL upload fails and the fallback `playSid(path, songNr)` succeeds:
      - **If `Songlengths.md5` data was available** for this track: emit an **error-level** trace event: `{ type: 'ssl-propagation-failure', level: 'error', reason: 'upload-failed-with-songlength-available', sourceKind: 'ultimate', trackId, songlengthEntry }`. Log at `console.error`.
      - **If no songlength data was available** (track not in `Songlengths.md5` or no HVSC context): emit an info-level trace event: `{ type: 'playback-no-duration', level: 'info', reason: 'no-songlength-entry', sourceKind, trackId }`. This is not an error.
    - In both cases: **playback must proceed**. The song plays; the error/info is recorded.
  - When the fallback `playSid` also fails, classify and propagate the error to the caller with full context.

- [ ] **4.4 Harden SSL computation edge cases**
  - In `src/lib/sid/sidUtils.ts`:
    - Ensure `createSslPayload` has an explicit, tested contract for: zero duration, very long durations (>99:59), negative inputs, and non-finite values.
    - Keep behavior deterministic and fail-fast for invalid input classes where clamping is not acceptable.
    - Add boundary-value unit tests for these cases.

- [ ] **4.5 Add end-to-end tests for duration propagation failure modes**
  - In `tests/unit/playbackRouter.test.ts`:
    - Add test: FTP fetch fails, songlength available -> fallback `playSid` called -> assert **error-level** trace event with `ssl-propagation-failure`.
    - Add test: FTP fetch fails, no songlength data -> fallback `playSid` called -> assert info-level trace event (not an error).
    - Add test: FTP fetch succeeds, upload fails with transient error -> retried -> succeeds on retry -> no error event.
    - Add test: FTP fetch succeeds, upload fails with permanent error -> fallback `playSid` called -> assert error-level trace event.
    - Add test: both upload and fallback fail -> error propagated to caller with classified error.
    - Add test: SSL computation fails (parse error) -> error logged, fallback plays without SSL, error trace event emitted.
  - In Playwright: extend existing ultimate-source playback tests to assert trace events contain duration propagation status.

- [ ] **4.6 Run full build and test suite**
  - `npm run lint && npm run test && npm run build && npm run test:e2e`
  - Fix any regressions.

---

## Phase 5: Cross-Source Lifecycle Resilience [High H2 + Medium M1, M2]

**Goal**: Harden pause/resume parity across all playback source kinds (`local`, `ultimate`, `hvsc`), ensure playlists survive app restarts and phone restarts (per Q5: best-effort persistence, SAF URI rebinding for local Android items with user-facing errors on permission loss), and close auto-next race conditions.

**Severity**: High (H2) + Medium (M1, M2).

### Subtasks

- [ ] **5.1 Implement playlist persistence across app and phone restarts**
  - In `src/pages/playFiles/hooks/usePlaybackPersistence.ts`:
    - Ensure the full playlist state (items, queue position, elapsed time, playback state) is persisted to durable storage (e.g., `localStorage` or Capacitor `Preferences`) on every meaningful state change.
    - On app launch / rehydration, restore the persisted playlist state.
    - For SAF/content URI items: validate that persisted URIs are still accessible (attempt a lightweight read/stat via `FolderPicker` bridge).
    - If a SAF URI is inaccessible (permission revoked or file deleted):
      - Mark the playlist item with a `status: 'unavailable'` flag.
      - Log at WARN with the URI, permission state, and classified error.
      - Display a user-visible indicator on the playlist item (e.g., dimmed with tooltip "File no longer accessible").
    - If the entire source root is inaccessible, show a toast/banner: "Source folder access was revoked. Re-add the folder to continue playback."
    - For HVSC items: validate that the HVSC database is still installed; if not, mark items as unavailable.
    - For ultimate items: no file validation needed (device may be offline); items remain in the playlist and errors surface at play time.
  - In `src/lib/sourceNavigation/localSourcesStore.ts`: add a `validateSource(sourceId): Promise<boolean>` method that checks accessibility.

- [ ] **5.2 Add persistence lifecycle E2E tests**
  - In Playwright:
    - Simulate app restart by navigating away and back to `/play` with a pre-populated persisted state.
    - Assert playlist items from local (entries and SAF-backed), ultimate, and HVSC sources are correctly rehydrated with full queue position and elapsed time.
    - Assert that an item with a revoked SAF URI shows the unavailable indicator.
    - Assert that an HVSC item with a missing HVSC database shows the unavailable indicator.
  - Add unit tests for `usePlaybackPersistence` rehydration logic covering: valid URIs, revoked URIs, missing files, missing HVSC database, offline C64U.

- [ ] **5.3 Implement pause/resume duration reconciliation per source type**
  - In `usePlaybackController.ts`:
    - On resume, recompute `dueAtMs` based on `Date.now() + (durationMs - elapsedMs)`.
    - For HVSC source: ensure `durationMs` is resolved from pre-applied metadata (same as local path). If `durationMs` is absent (no songlength entry), log at WARN and either skip auto-advance (infinite play) or use a configurable default timeout.
    - For ultimate source: ensure `durationMs` is sourced from the router's resolved duration, not re-fetched on resume.
    - For local source via SAF-backed URI: ensure elapsed tracking persists across pause correctly (no double-count or reset).

- [ ] **5.4 Add pause/resume parity tests per source type**
  - In unit tests (`usePlaybackController` test file):
    - Test pause/resume for each source kind: local, ultimate, HVSC.
    - For `local`, include both local entries and SAF-backed URI variants.
    - Assert that `dueAtMs` after resume equals `now + remainingDuration` in each case.
    - Assert that elapsed time does not jump or reset across pause/resume.
  - In Playwright:
    - Add or extend playback tests to cover pause/resume for HVSC-sourced tracks (currently not asserted per research).

- [ ] **5.5 Close auto-next race condition (manual next vs timer)**
  - In `usePlaybackController.ts` or `PlayFilesPage.tsx`:
    - Use a transition guard: when `playNext()` or `playPrevious()` is invoked manually, cancel any pending `dueAtMs` guard and clear the interval check for the current track.
    - Use an atomic transition token: each track transition gets a unique token; the auto-next check validates the token is still current before firing.
    - This prevents: (a) double-advance when user presses next near the auto-skip threshold, (b) stale auto-next firing after manual navigation.

- [ ] **5.6 Add race condition tests**
  - In unit tests:
    - Simulate: set timer near expiry, invoke manual `playNext()`, advance timer past expiry. Assert only one transition occurred.
    - Simulate: auto-next fires, then manual `playPrevious()` fires in the same tick. Assert final state is the previous track.
  - In Playwright:
    - Add a test that triggers manual next when the progress bar is near 100% and asserts the queue advances exactly once.

- [ ] **5.7 Run full build and test suite**
  - `npm run lint && npm run test && npm run build && npm run test:e2e`
  - Fix any regressions.

---

## Phase 6: HVSC Ingestion Strict Completeness and Memory Safety [High H3]

**Goal**: Enforce strict ingestion completeness: **every** song in the archive must be ingested. Report exact counts of ingested and failed songs. Ingestion is `failed` if any song cannot be ingested — except for `Songlengths.md5` syntax errors, which are tolerated, counted, shown in the UI, and do not block success. Reduce peak memory during archive extraction. Add stress-level validation.

**Severity**: High (elevated: strict completeness requirement per Q6).

### Subtasks

- [ ] **6.1 Profile current memory usage during extraction**
  - Instrument `src/lib/hvsc/hvscArchiveExtraction.ts` and `src/lib/hvsc/hvscDownload.ts` with memory usage logging (`performance.memory` where available, or `process.memoryUsage()` equivalent).
  - Document baseline peak memory for the current test fixture archive size and extrapolate for production HVSC archive (~70MB compressed, ~400MB extracted).

- [ ] **6.2 Implement streaming/chunked extraction for ZIP archives**
  - Replace `unzipSync` (in-memory full decode at `hvscArchiveExtraction.ts:58`) with a streaming alternative:
    - Option A: Use `fflate`'s `Unzip` streaming API which processes entries one at a time.
    - Option B: Use the native `FileSystem` bridge to extract on the Kotlin side where memory is more controllable.
  - If Option A: process entries in batches (e.g., 100 files at a time), yielding to the event loop between batches to avoid blocking.
  - If Option B: add a `ZipExtractPlugin` Kotlin class that extracts to the app's cache directory and returns extracted paths.

- [ ] **6.3 Implement chunked extraction for 7z archives**
  - The current 7z path (`hvscArchiveExtraction.ts:101-133`) copies all files through WASM FS.
  - Implement batched reads: extract N entries at a time from the WASM FS, write them to the target filesystem, then free the WASM buffers before the next batch.
  - Add progress callbacks per batch for UI feedback.

- [ ] **6.4 Reduce peak memory in archive download/readback**
  - `src/lib/hvsc/hvscDownload.ts:224-230` decodes the full archive file to memory as base64.
  - Replace with: stream the download directly to a filesystem path (using `Filesystem.writeFile` or native bridge), then extract from the file path rather than from an in-memory blob.
  - If Capacitor `Filesystem` does not support streaming writes, use the `FolderPicker` native bridge or a new `FileWriter` plugin.

- [ ] **6.5 Implement strict ingestion completeness contract**
  - In `src/lib/hvsc/hvscIngestionRuntime.ts`:
    - Track per-song ingestion outcomes: `{ total: number, ingested: number, failed: number, songlengthSyntaxErrors: number }`.
    - Every song extraction/indexing attempt must increment either `ingested` or `failed`. No songs may be silently skipped.
    - On completion:
      - If `failed === 0` (regardless of `songlengthSyntaxErrors`): set state to `ready`. This is a successful ingestion.
      - If `failed > 0`: set state to `failed` with a detailed error message listing the count and first N (e.g., 10) failed file paths.
      - `songlengthSyntaxErrors` are always tolerated; they do not contribute to `failed`.
    - Deletion failures during cleanup: these now set state to `failed` (not `degraded`) since they indicate the ingestion could not complete cleanly.
    - Songlength reload failure: set state to `failed`, not `ready`, as duration data is critical for playback (per Q4).
  - Remove or replace the `degraded` state concept — ingestion is either `ready` (all songs OK) or `failed` (something went wrong) or `in-progress`.

- [ ] **6.6 Implement Songlengths.md5 syntax error tolerance**
  - In the `Songlengths.md5` parser (locate in `src/lib/hvsc/` or `src/lib/sid/`):
    - When a line in `Songlengths.md5` cannot be parsed, do **not** abort ingestion.
    - Instead: increment `songlengthSyntaxErrors`, log at WARN with the line number and raw line content, and continue.
    - After parsing is complete, store the `songlengthSyntaxErrors` count in the HVSC status store.
  - Songs whose songlength entry has a syntax error will play without duration metadata. This is acceptable and does not count as an ingestion failure.

- [ ] **6.7 Implement ingestion result reporting in UI**
  - In `src/pages/playFiles/hooks/useHvscLibrary.ts` and related UI components:
    - After ingestion completes, show a summary: "Ingested X of Y songs. Z songlength parsing errors."
    - If state is `failed`: show an error banner with the failure count and actionable message (e.g., "N songs could not be imported. Check logs for details.").
    - If `songlengthSyntaxErrors > 0` and state is `ready`: show a warning indicator (e.g., yellow badge): "Y songs have no duration data due to Z songlength file parsing errors."
    - If state is `ready` and no errors: show a success message with total song count.

- [ ] **6.8 Add strict ingestion tests**
  - In `tests/unit/hvsc/`:
    - Test: extraction of N songs, all succeed -> state `ready`, counts match.
    - Test: extraction of N songs, 1 fails -> state `failed`, `failed: 1`, `ingested: N-1`.
    - Test: extraction of N songs, all succeed, 3 `Songlengths.md5` syntax errors -> state `ready`, `songlengthSyntaxErrors: 3`.
    - Test: extraction succeeds but cleanup deletion fails -> state `failed`.
    - Test: songlength reload fails -> state `failed`.
  - Create a synthetic test fixture with intentionally malformed `Songlengths.md5` entries to validate syntax error tolerance.

- [ ] **6.9 Add memory stress tests**
  - Create a test fixture: generate a synthetic archive with ~50,000 small files (representative of HVSC entry count) at ~100 bytes each, totaling ~5MB compressed. This simulates the file-count stress without requiring the full 70MB HVSC archive.
  - Add a Vitest test in `tests/unit/hvsc/` that:
    - Extracts the synthetic archive using the new streaming/chunked path.
    - Asserts extraction completes without error.
    - If `performance.memory` is available, asserts peak heap delta stays under a threshold (e.g., 200MB).
  - Add a Vitest test that simulates extraction failure mid-way (mock a write failure on the Nth file) and asserts the runtime transitions to `failed` state with correct counts.

- [ ] **6.10 Run full build and test suite**
  - `npm run lint && npm run test && npm run build && npm run test:e2e`
  - `cd android && ./gradlew test`
  - Fix any regressions.

---

## Phase 7: Source-Transparent Playlist UX [High — Q8 elevated]

**Goal**: Make HVSC a fully first-class source. The user must never need to know or care whether a song came from the C64U, local Android storage, or HVSC. All sources feed into a **single unified playlist** where songs are treated identically. Source-specific distinctions appear only in source-browsing/selection views, not in the playlist itself. Source-specific icons/labels may appear in browse views to help the user find songs, but the playlist presents a **source-agnostic** experience.

**Severity**: High (elevated from Low per Q8 — this is a core UX principle).

### Subtasks

- [ ] **7.1 Audit current source-identity leakage in playlist views**
  - Grep for all places where source kind (`local`, `ultimate`, `hvsc`) is surfaced to the user in playlist-related UI (not source-browsing UI).
  - Known locations from research:
    - `src/pages/playFiles/hooks/usePlaylistListItems.tsx:75`: HVSC items shown as "This device".
    - `src/components/FileOriginIcon.tsx:11`: HVSC items use the local icon.
  - Produce a list of all playlist-view touchpoints that expose source kind.

- [ ] **7.2 Unify playlist item presentation across all sources**
  - In `src/pages/playFiles/hooks/usePlaylistListItems.tsx` and related components:
    - Remove source-specific labels from the playlist item display. Do NOT show "This device", "C64 Ultimate", or "HVSC" in the playlist item row.
    - Display only source-agnostic information: song title (derived from SID filename or HVSC metadata), artist (if available from HVSC), duration, and subsong info.
    - The detail subtitle should show the song's path within its source context (e.g., `/MUSICIANS/Hubbard_Rob/Commando.sid` for HVSC, `Music/mysong.sid` for local) without a source-kind prefix.
  - If a playlist item becomes unavailable (SAF permissions revoked, HVSC database missing), show a generic "unavailable" indicator, not a source-specific one.

- [ ] **7.3 Add distinct source icons in source-browsing views only**
  - In `src/components/FileOriginIcon.tsx`:
    - Add a case for `sourceKind === 'hvsc'` that renders a distinct icon (e.g., a music-library or database icon).
    - This icon is used in **source selection / browsing views** (where the user picks which source to add songs from), NOT in the playlist view.
  - In source-browsing panels (the UI where users browse C64U files, local files, or HVSC): use source-specific icons and labels to help navigation.
  - Ensure the icon choice is consistent with `doc/ux-guidelines.md`.

- [ ] **7.4 Ensure subsong count and duration display consistency across all sources**
  - In the playback UI (`PlayFilesPage.tsx` or its sub-components):
    - When a multi-subsong SID is playing, display the current subsong number and total subsong count (e.g., "Subsong 2/5").
    - When duration is unavailable (no HVSC songlength entry, no computed SSL), display "—:—" instead of "0:00" or blank.
    - Ensure this behavior is identical across local (including SAF-backed items), ultimate, and HVSC sources. The user should not be able to tell the source from the playback display.

- [ ] **7.5 Ensure drag/reorder, remove, and queue operations are source-agnostic**
  - Verify that all playlist manipulation operations (add, remove, reorder, clear, shuffle) work identically regardless of item source.
  - Verify that mixed-source playlists (e.g., 2 local + 3 HVSC + 1 ultimate) are fully supported with no source-specific edge cases in queue management.
  - Add unit tests for mixed-source playlist operations if not already covered.

- [ ] **7.6 Add UI tests for source-transparent playlist**
  - In Playwright:
    - Add a test that creates a mixed-source playlist (local + HVSC + ultimate items via mocks) and verifies:
      - No source-kind labels appear in the playlist view.
      - All items show song title, path, and duration uniformly.
      - Playback transitions seamlessly between sources without UI changes (no source-switching indicators).
    - Add a test for multi-subsong playback displaying "Subsong N/M".
    - Add a test for unknown-duration display showing "—:—".
  - In unit tests:
    - Test `FileOriginIcon` renders the correct distinct icon for each source kind.
    - Test `usePlaylistListItems` returns **no** source-kind label for playlist items from any source.
    - Test that HVSC items show HVSC path as subtitle, not "This device".

- [ ] **7.7 Update UX documentation**
  - In `doc/ux-guidelines.md`:
    - Add a section "Source Transparency" documenting the principle: playlists are source-agnostic; source identity is only visible in source-browsing views.
    - Document the icon assignments for each source kind (used in browse views only).
    - Document the subsong and duration display conventions.

- [ ] **7.8 Run full build and test suite**
  - `npm run lint && npm run test && npm run build && npm run test:e2e`
  - Fix any regressions.

---

## Final Verification

After all phases are complete:

- [ ] `npm run lint` passes.
- [ ] `npm run test` passes (all unit tests).
- [ ] `npm run build` passes.
- [ ] `npm run test:e2e` passes (all Playwright tests).
- [ ] `cd android && ./gradlew test` passes (all Android JVM tests).
- [ ] Manual Maestro lock-screen flow passes on emulator.
- [ ] No silent catches remain (grep validation).
- [ ] Trace events contain `sourceKind`, `lifecycleState`, `correlationId`, and `trackInstanceId` fields (and `localAccessMode` when sourceKind is `local` on Android).
- [ ] HVSC ingestion reports exact song counts (ingested / failed / songlength syntax errors).
- [ ] HVSC ingestion fails if any song (other than songlength syntax errors) cannot be ingested.
- [ ] SSL propagation failure with available `Songlengths.md5` emits an error-level trace event.
- [ ] Playlists survive app restart and phone restart.
- [ ] Mixed-source playlists show no source-kind labels in the playlist view.
- [ ] HVSC memory stress test passes under threshold.
