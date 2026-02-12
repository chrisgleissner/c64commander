# C64 Commander Research Report: Playback, HVSC, Lifecycle, and Observability

Date: 2026-02-11  
Scope: Static code/test archaeology only (no code execution changes, no test/doc/config modifications beyond this report file).

## 1. Executive Summary

This project has solid functional coverage for foreground playback and several source-loading paths, but it has structural risk around lock/background lifecycle behavior, split observability, and inconsistent error handling discipline.

### High-level findings

1. The active playback implementation is `PlayFilesPage` + `usePlaybackController`, but tracing context is still sourced from legacy `useSidPlayer`, creating a state/trace mismatch risk (`src/App.tsx:98`, `src/App.tsx:109`, `src/components/TraceContextBridge.tsx:27`, `src/hooks/useSidPlayer.tsx:57`).
2. Auto-skip is JS timer-based (`setInterval` and elapsed checks), not tied to native completion callbacks or an explicit lock-state model (`src/pages/PlayFilesPage.tsx:464`, `src/pages/PlayFilesPage.tsx:480`, `src/pages/PlayFilesPage.tsx:492`, `src/pages/PlayFilesPage.tsx:657`).
3. C64U song length propagation exists for ultimate-hosted SID when duration is known: FTP read -> SID+SSL upload path (`src/lib/playback/playbackRouter.ts:168`, `src/lib/playback/playbackRouter.ts:171`, `src/lib/playback/playbackRouter.ts:174`, `src/lib/c64api.ts:1129`, `src/lib/c64api.ts:1132`, `src/lib/sid/sidUtils.ts:15`), but fallback and retry semantics are limited.
4. HVSC ingestion uses a staged runtime with progress/state machine controls (`src/lib/hvsc/hvscIngestionRuntime.ts:339`, `src/lib/hvsc/hvscIngestionPipeline.ts`), but archive handling is memory-heavy (`src/lib/hvsc/hvscArchiveExtraction.ts:58`, `src/lib/hvsc/hvscDownload.ts:230`) and some partial failures are tolerated.
5. Exception handling quality is inconsistent with stated repository standards; multiple silent catches remain in critical paths (examples: `src/lib/hvsc/hvscFilesystem.ts:85`, `src/lib/hvsc/hvscDownload.ts:70`, `src/lib/sourceNavigation/ftpSourceAdapter.ts:39`, `src/lib/sid/sidUtils.ts:45`, `android/app/src/main/java/uk/gleissner/c64commander/FtpClientPlugin.kt:145`, `android/app/src/main/java/uk/gleissner/c64commander/FolderPickerPlugin.kt:71`).

### Most critical risks (ranked)

1. **Critical**: Locked-device auto-skip reliability depends on JS timers that may be throttled/suspended under lock/background.
2. **Critical**: Trace context can diverge from active playback state, reducing incident diagnosability.
3. **Critical**: Silent catch patterns hide root causes during HVSC/source/path failures.
4. **High**: C64U duration propagation is path-dependent with weak idempotent retry behavior for upload failure modes.
5. **High**: HVSC ingestion large-archive memory pressure risk is not stress-validated by existing tests.

---

## 2. Architectural Map

### 2.1 Module responsibilities

- Playback control and queue lifecycle:
  - `src/pages/PlayFilesPage.tsx`
  - `src/pages/playFiles/hooks/usePlaybackController.ts`
  - `src/pages/playFiles/hooks/usePlaybackPersistence.ts`
- Playback routing and execution against C64U:
  - `src/lib/playback/playbackRouter.ts`
  - `src/lib/c64api.ts`
  - `src/lib/sid/sidUtils.ts`
- Source navigation and acquisition:
  - Local/SAF/content URI: `src/lib/sourceNavigation/localSourceAdapter.ts`, `src/lib/native/folderPicker.ts`
  - Ultimate FTP: `src/lib/sourceNavigation/ftpSourceAdapter.ts`, `src/lib/ftp/ftpClient.ts`, `src/lib/native/ftpClient.ts`
  - HVSC source: `src/lib/sourceNavigation/hvscSourceAdapter.ts`
- HVSC lifecycle:
  - Runtime orchestration: `src/lib/hvsc/hvscIngestionRuntime.ts`
  - Pipeline state machine: `src/lib/hvsc/hvscIngestionPipeline.ts`
  - Download/readback: `src/lib/hvsc/hvscDownload.ts`
  - Archive extraction: `src/lib/hvsc/hvscArchiveExtraction.ts`
  - Filesystem + markers: `src/lib/hvsc/hvscFilesystem.ts`
  - Status/state stores: `src/lib/hvsc/hvscStatusStore.ts`, `src/lib/hvsc/hvscStateStore.ts`
- Cross-cutting safety/interaction scheduler:
  - `src/lib/deviceInteraction/deviceInteractionManager.ts`
- Observability:
  - Logs: `src/lib/logging.ts`
  - Tracing: `src/lib/tracing/traceSession.ts`, `src/lib/tracing/traceBridge.ts`
  - Trace context adapter: `src/components/TraceContextBridge.tsx`

### 2.2 JS/TS -> Capacitor -> Kotlin boundary map

- SAF / content URI path:
  - JS invokes `FolderPicker` (`src/lib/native/folderPicker.ts:90`)
  - Kotlin handles operations in `FolderPickerPlugin.kt` (`android/.../FolderPickerPlugin.kt:26`)
- FTP path:
  - JS invokes `FtpClient` (`src/lib/native/ftpClient.ts:40`)
  - Kotlin handles operations in `FtpClientPlugin.kt` (`android/.../FtpClientPlugin.kt:26`)
- Background execution path:
  - JS invokes `BackgroundExecution` (`src/lib/native/backgroundExecution.ts:16`)
  - Kotlin plugin/service: `BackgroundExecutionPlugin.kt:20` and `BackgroundExecutionService.kt:32`

### 2.3 Active vs legacy playback paths

- Active route for `/play`: `PlayFilesPage` (`src/App.tsx:109`)
- App still wraps with legacy `SidPlayerProvider` (`src/App.tsx:127`)
- Trace playback context reads `useSidPlayer` (`src/components/TraceContextBridge.tsx:27`)

Implication: playback execution and playback tracing are not guaranteed to be the same state machine.

### 2.4 Sequence: Local playback

1. User selects files/folders from local source or SAF; `addFileSelections` resolves `LocalPlayFile` via runtime file map, URI, or tree URI (`src/pages/playFiles/handlers/addFileSelections.ts:340` to `src/pages/playFiles/handlers/addFileSelections.ts:345`).
2. Playlist item is constructed in `PlayFilesPage` (`src/pages/PlayFilesPage.tsx:401`).
3. `usePlaybackController.playItem` resolves local SID metadata and duration (`src/pages/playFiles/hooks/usePlaybackController.ts:238` to `src/pages/playFiles/hooks/usePlaybackController.ts:244`).
4. `buildPlayPlan` and `executePlayPlan` route to local upload (`src/lib/playback/playbackRouter.ts:56`, `src/lib/playback/playbackRouter.ts:181`, `src/lib/playback/playbackRouter.ts:186`).
5. Playback guard (`dueAtMs`) is set for auto-next (`src/pages/playFiles/hooks/usePlaybackController.ts:302` to `src/pages/playFiles/hooks/usePlaybackController.ts:307`).

### 2.5 Sequence: C64U-hosted playback

1. Ultimate source is listed via FTP adapter (`src/lib/sourceNavigation/ftpSourceAdapter.ts:93`).
2. For SID with known duration and source `ultimate`, router tries FTP readback of SID bytes (`src/lib/playback/playbackRouter.ts:171`) then uploads SID + SSL (`src/lib/playback/playbackRouter.ts:174`).
3. Multipart field `file` carries SID first and optional SSL second (`src/lib/c64api.ts:1130` to `src/lib/c64api.ts:1132`).
4. If FTP fetch is unavailable/fails, playback falls back to `PUT /v1/runners:sidplay?file=...` (`src/lib/playback/playbackRouter.ts:178`, OpenAPI `doc/c64/c64u-openapi.yaml:207`).

### 2.6 Sequence: HVSC playback

1. HVSC is ingested/downloaded through runtime pipeline (`src/lib/hvsc/hvscIngestionRuntime.ts:274`).
2. HVSC source adapter lists folders/songs via `getHvscFolderListing` (`src/lib/sourceNavigation/hvscSourceAdapter.ts:30`).
3. Selected HVSC song is materialized to `LocalPlayFile` by fetching base64 song payload (`src/pages/playFiles/hooks/useHvscLibrary.ts:173` to `src/pages/playFiles/hooks/useHvscLibrary.ts:181`).
4. Playback enters same `playItem`/`playbackRouter` path, but duration resolution path differs from explicit local/ultimate branching.

---

## 3. Coverage Matrix

Legend: **F** Fully covered, **P** Partially covered, **N** Not covered.

### 3.1 Source x Lifecycle x Playback transition matrix

| Source type | Foreground play/pause/resume | Backgrounded | Locked device | Process recreation | Auto-skip completion | Notes |
|---|---|---|---|---|---|---|
| Local app storage (web file/directory) | F | P | N | N | P | Strong Playwright foreground coverage in `playwright/playback.spec.ts` and `playwright/playback.part2.spec.ts`; no explicit lock-state completion scenario. |
| Android device sources (SAF/content URI) | P | N | N | N | N | SAF browse/scan flows covered (`playwright/playback.part2.spec.ts:354`, `:421`, `:461`; `tests/unit/sourceNavigation/localSourceAdapter.test.ts:74`), but playback/lifecycle parity under lock/restart is untested. |
| C64U-hosted source (ultimate FTP path + REST) | P | P | N | N | P | Unit verifies FTP->upload fallback logic (`tests/unit/playbackRouter.test.ts:112`, `:123`), but no lock-state completion or full e2e retry/idempotency path. |
| HVSC source | P | P | N | N | N | HVSC install/ingest/play tested (`playwright/hvsc.spec.ts:552`, `:574`, `:620`), but pause/resume parity and locked auto-skip are not explicitly asserted. |

### 3.2 Source x Network/failure matrix

| Scenario | Local | SAF/content URI | C64U source | HVSC | Coverage status | Evidence |
|---|---|---|---|---|---|---|
| Offline/connection lost at play start | P | P | P | P | Partial | Error surfaces in Playwright for playback failures (`playwright/playback.spec.ts:340`), but no full matrix per source/lifecycle. |
| Mid-transition failure (next/auto-next) | P | N | P | N | Partial | Next failure handling covered (`playwright/playback.spec.ts:834`); not source- and lifecycle-complete. |
| FTP read failure | N/A | N/A | P | N/A | Partial | Unit fallback covered (`tests/unit/playbackRouter.test.ts:123`). |
| REST upload failure (`playSidUpload`) | P (local upload path) | P | N | P | Partial | API upload error covered (`tests/unit/c64api.test.ts:669`), but duration-propagation-specific ultimate path failure taxonomy not covered end-to-end. |
| HVSC download interruption/cancel | N/A | N/A | N/A | P | Partial | HVSC cancel/fail flows in Playwright (`playwright/hvsc.spec.ts:608`, `:799`, `:809`) and runtime unit tests. |
| HVSC extract/index memory stress | N/A | N/A | N/A | N | None | No stress-scale tests for large archives or low-memory constraints. |

### 3.3 Playback state-transition matrix

| Transition | Local | SAF/content URI | C64U source | HVSC | Coverage |
|---|---|---|---|---|---|
| Play | F | P | F | P | Partial by source depth |
| Pause | F | N | P | N | Incomplete parity |
| Resume | F | N | P | N | Incomplete parity |
| Stop | F | N | F | P | Incomplete parity |
| Next/Previous (user) | F | N | F | P | Incomplete parity |
| Complete -> auto-next | P | N | P | N | Major gap |

### 3.4 Existing test asset mapping highlights

- Strong foreground transport and queue transition validation:
  - `playwright/playback.spec.ts:204`, `:621`, `:793`, `:814`
  - `playwright/playback.part2.spec.ts:297`, `:1271`
- SAF/source adapter validation:
  - `tests/unit/sourceNavigation/localSourceAdapter.test.ts:74` onward
  - `playwright/playback.part2.spec.ts:354`, `:421`, `:461`
- Duration propagation core primitives:
  - `tests/unit/playbackRouter.test.ts:112`
  - `tests/unit/sidUtils.test.ts:21`
  - `tests/unit/c64api.test.ts:676`
- HVSC ingestion/control-flow:
  - `tests/unit/hvsc/hvscIngestionRuntime.test.ts`
  - `playwright/hvsc.spec.ts:552` onward
- Major missing direct unit harness:
  - `tests/unit/pages/PlayFilesPage.test.tsx:11` is placeholder only.

---

## 4. Detailed Risk Analysis

### 4.1 Pause / Resume

#### Code-evident behavior

- Pause/resume mutates both machine state and audio mixer state in `usePlaybackController` (`src/pages/playFiles/hooks/usePlaybackController.ts:435` to `:495`).
- Resume recomputes `dueAtMs` from `durationMs - elapsedMs` (`src/pages/playFiles/hooks/usePlaybackController.ts:463` to `:467`).
- Timeline sync depends on periodic JS ticking + visibility/focus/pageshow hooks (`src/pages/PlayFilesPage.tsx:477` to `:500`).

#### Risks

- If elapsed state and machine state diverge during background/lock, `dueAtMs` can become stale and fire too early/late.
- No explicit audio focus/noisy-route handling in active path was identified.
- Source asymmetry:
  - Local SID has explicit metadata readability guard (`src/pages/playFiles/hooks/usePlaybackController.ts:238` to `:244`).
  - Ultimate SID has explicit duration resolution branch (`src/pages/playFiles/hooks/usePlaybackController.ts:245` to `:261`).
  - HVSC path does not have equivalent explicit branch inside `playItem`; it relies more on pre-applied metadata.

#### Test confidence

- Foreground pause/resume confidence: moderate.
- Cross-lifecycle/source parity confidence: low.

### 4.2 Locked device auto-skip

#### Current implementation model

- Auto-advance trigger is local wall-clock guard (`dueAtMs`) and periodic check (`src/pages/PlayFilesPage.tsx:472` to `:474`, `:480`).
- Additional check on `elapsedMs` effect (`src/pages/PlayFilesPage.tsx:652` to `:658`).
- Lock is not modeled explicitly; lifecycle handling uses browser visibility/focus events.

#### Native background service relationship

- Android foreground service exists and is lock-survival oriented (`android/.../BackgroundExecutionService.kt:25` to `:30`, `:79`, `:126`), but active `PlayFilesPage` path does not call the bridge.
- Legacy `useSidPlayer` does call `BackgroundExecution.start/stop` (`src/hooks/useSidPlayer.tsx:87`, `:149`).

#### Risks

- On real devices, timer throttling during lock can delay/skip auto-next.
- Emulator behavior may overestimate reliability compared with OEM battery policies.
- Service presence without active-path integration increases ambiguity in expected lock behavior.

### 4.3 C64U song-length propagation (FTP -> compute/send SSL)

#### Current path

- OpenAPI supports SID upload with optional second SSL multipart file (`doc/c64/c64u-openapi.yaml:228` to `:259`).
- Router branch for ultimate SID with duration:
  - `tryFetchUltimateSidBlob` -> `api.playSidUpload(ftpBlob, songNr, sslBlob)` (`src/lib/playback/playbackRouter.ts:171` to `:175`).
  - fallback `api.playSid(path, songNr)` (`src/lib/playback/playbackRouter.ts:178`).
- SSL payload encoding is mm:ss BCD bytes (`src/lib/sid/sidUtils.ts:15` to `:21`).

#### Risks and semantics

- Duration authority is app-side computed/enriched, not device-side authoritative.
- If FTP fetch fails, fallback path may play without explicit length propagation.
- Request-layer retries are limited for mutating methods; idle recovery retries are only for `GET/HEAD/OPTIONS` (`src/lib/c64api.ts:36`, `src/lib/c64api.ts:513` to `:514`).
- No explicit idempotency contract around repeated SID+SSL uploads is visible.

#### Coverage status

- Unit branch coverage exists (`tests/unit/playbackRouter.test.ts:112`, `:123`).
- End-to-end failure taxonomy and retry semantics remain weakly covered.

### 4.4 HVSC ingestion stability

#### Pipeline strengths

- Explicit staged transitions and transition validation (`src/lib/hvsc/hvscIngestionRuntime.ts:339`, `src/lib/hvsc/hvscIngestionPipeline.ts`).
- Cold-start stale-state recovery (`src/lib/hvsc/hvscIngestionRuntime.ts:61` to `:84`).
- Progress/status summarization and failure categories in store/UI hooks (`src/lib/hvsc/hvscStatusStore.ts:91`, `src/pages/playFiles/hooks/useHvscLibrary.ts:139`).

#### Crash-prone vectors

- Archive readback decodes full file to memory (`src/lib/hvsc/hvscDownload.ts:224` to `:230`).
- ZIP extraction via `unzipSync` loads entries in memory (`src/lib/hvsc/hvscArchiveExtraction.ts:58`).
- 7z extraction involves wasm FS copy/read for all files (`src/lib/hvsc/hvscArchiveExtraction.ts:101` to `:133`).

#### Determinism/diagnostic risks

- Some failures are logged but ingestion can continue/complete (for example deletion failure loop and songlengths reload failure) (`src/lib/hvsc/hvscIngestionRuntime.ts:227` to `:255`).
- Silent catches in filesystem/download/status stores can hide corrupted/partial-cache states (`src/lib/hvsc/hvscFilesystem.ts:85`, `src/lib/hvsc/hvscDownload.ts:191`, `src/lib/hvsc/hvscStateStore.ts:54`, `src/lib/hvsc/hvscStatusStore.ts:68`).

### 4.5 Observability gaps

#### Structural gaps

- Trace playback context uses legacy player state (`src/components/TraceContextBridge.tsx:27`) while route `/play` uses `PlayFilesPage` state machine.
- Native plugin/service logs are not correlated to JS trace correlation IDs.

#### Logging quality gaps

- JS logs are localStorage bounded (`src/lib/logging.ts:27`, `src/lib/logging.ts:45`).
- Trace store is in-session JS event stream (`src/lib/tracing/traceSession.ts:29`, `:121`).
- Native plugins mostly return `call.reject` without rich structured context and contain silent catches in some branches.

#### Failure classification gaps

- Multiple catches return defaults or ignore conditions, collapsing distinct fault classes:
  - `src/lib/sid/sidUtils.ts:45`
  - `src/lib/sourceNavigation/ftpSourceAdapter.ts:39`, `:48`
  - `src/lib/hvsc/hvscFilesystem.ts:70`, `:85`, `:111`, `:146`, `:233`, `:262`, `:303`, `:314`, `:320`
  - `src/lib/hvsc/hvscDownload.ts:42`, `:52`, `:70`, `:191`, `:204`, `:280`, `:370`
  - `src/lib/connection/connectionManager.ts:233`, `:536`
  - `src/hooks/useSidPlayer.tsx:87`, `:149`
  - `android/.../FtpClientPlugin.kt:145`
  - `android/.../FolderPickerPlugin.kt:71`, `:183`

---

## 5. Test Gap Analysis

Severity bands: Critical, High, Medium, Low.

### Critical

#### C1. Locked completion does not reliably auto-skip

- Scenario: Song reaches completion while device is locked/backgrounded.
- Why current coverage is insufficient: Auto-next is tested mainly in foreground simulated timing (`playwright/playback.spec.ts:793`) and not under true lock-state lifecycle semantics.
- Likely failure mode: JS interval/effect checks are delayed, queue stalls on completed track.
- Impact: Core transport reliability regression in real-world mobile use.

#### C2. Active playback traces do not reflect active playback engine

- Scenario: Incident triage for playback under `/play` route.
- Why current coverage is insufficient: Trace bridge uses legacy context from `useSidPlayer` while active playback is `PlayFilesPage`.
- Likely failure mode: False timeline narratives and incorrect root-cause attribution.
- Impact: High MTTR, low confidence diagnostics.

#### C3. Silent exception handling masks root causes

- Scenario: HVSC/storage/source corruption or plugin-level edge failures.
- Why current coverage is insufficient: Tests do not assert failure classification under silent catch pathways.
- Likely failure mode: Degraded behavior with missing error context, inconsistent state with no clear fault category.
- Impact: Release-blocking diagnosability and reliability risk.

### High

#### H1. Ultimate SID duration propagation failure matrix is incomplete

- Scenario: FTP read fails, upload fails, duration parse/enrichment fails in combinations.
- Why current coverage is insufficient: Unit branch checks exist, but no end-to-end behavior verification for retries and final queue semantics.
- Likely failure mode: Playback occurs without intended song length payload; UI/device timing diverges.
- Impact: Incorrect queue progression and inconsistent user experience.

#### H2. SAF/content URI playback across process recreation

- Scenario: App process recreation while playlist contains SAF-based items.
- Why current coverage is insufficient: Rehydration exists (`usePlaybackPersistence`) but lacks lifecycle-E2E tests validating URI/tree-path rebinding.
- Likely failure mode: “Local file unavailable” after restart despite persisted entries.
- Impact: Session continuity failure and user trust loss.

#### H3. HVSC ingestion memory stress and large archives

- Scenario: Baseline/update archives near production size on constrained Android devices.
- Why current coverage is insufficient: Unit tests mock extraction and avoid large memory envelopes.
- Likely failure mode: OOM/crash or partial ingest with stale status markers.
- Impact: HVSC feature instability in production conditions.

### Medium

#### M1. Pause/resume parity by source type

- Scenario: Pause/resume with local, SAF content URI, ultimate, and HVSC.
- Why current coverage is insufficient: Pause/resume tests are not source-parity complete.
- Likely failure mode: Duration/elapsed drift and inconsistent UI labels by source origin.
- Impact: Intermittent state confusion, moderate UX degradation.

#### M2. Auto-next race boundaries (manual next vs timer trigger)

- Scenario: User presses next near auto-advance threshold.
- Why current coverage is insufficient: Some race-safe tests exist, but not across all lifecycle/source combinations.
- Likely failure mode: Duplicate/late transitions or unexpected stop state.
- Impact: Sporadic queue anomalies.

#### M3. Native background service integration ownership

- Scenario: Expected lock-survival behavior on modern path.
- Why current coverage is insufficient: Service and legacy hook are tested in isolation from active route behavior.
- Likely failure mode: False assumptions that background service protects active playback path.
- Impact: Misaligned QA expectations and field behavior gaps.

### Low

#### L1. Source-origin UI consistency (HVSC labeling/icons)

- Scenario: Playlist details display source identity.
- Why current coverage is insufficient: UI tests focus functionality; source identity semantics are under-asserted.
- Likely failure mode: HVSC entries shown as “This device” in details (`src/pages/playFiles/hooks/usePlaylistListItems.tsx:75`) and local icon path (`src/components/FileOriginIcon.tsx:11`).
- Impact: Low functional risk, moderate UX inconsistency.

#### L2. Subsong/time-display consistency under all sources

- Scenario: Multi-subsong playback and timer display across source types.
- Why current coverage is insufficient: HVSC multi-subsong behavior has limited end-to-end assertions.
- Likely failure mode: Displayed duration/subsong count diverges from selected song context.
- Impact: UX confusion; low crash risk.

---

## 6. Observability and Diagnostics Assessment

### 6.1 Current logging/tracing structure

- JS application logs:
  - Stored in `localStorage` with max-entry cap (`src/lib/logging.ts:27`, `src/lib/logging.ts:28`, `src/lib/logging.ts:58`).
- JS tracing:
  - In-memory trace event stream with retention/size limits (`src/lib/tracing/traceSession.ts:25` to `:27`).
  - REST/FTP operations recorded with correlation IDs (`src/lib/tracing/traceSession.ts:262`, `:301`).
- Native logs:
  - Android plugins/services use Logcat and plugin rejections (`android/.../BackgroundExecutionService.kt:70`, `android/.../FtpClientPlugin.kt:83`).

### 6.2 Android-native logging gaps

- `FolderPickerPlugin.kt` does not emit structured Android logs for many failure paths; failures are mostly `call.reject(...)`.
- `FtpClientPlugin.kt` logs disconnect failures but not richer operation-phase context (connect/login/list/retrieve timing or metadata).
- Silent catch blocks in plugins suppress contextual failure signals (`FtpClientPlugin.kt:145`, `FolderPickerPlugin.kt:71`, `FolderPickerPlugin.kt:183`).

### 6.3 Missing JS-native correlation

- JS traces use correlation IDs internally, but plugin interfaces do not accept/pass correlation IDs.
- No explicit mapping from JS action correlation to native plugin events.
- Incident reconstruction across JS and Logcat requires manual temporal inference.

### 6.4 Actionable crash-context limitations

Missing or weak context dimensions for many failure paths:

- lifecycle state (`foreground/background/locked`) at failure time;
- queue identifiers (`trackInstanceId`, playlist item ID) in native failure logs;
- source kind (`local`, `ultimate`, `hvsc`, SAF URI mode) consistently attached to failures;
- operation phase for FTP and HVSC extraction sub-stages.

### 6.5 Failure classification weaknesses

- Classification logic exists for HVSC summary (`src/lib/hvsc/hvscStatusStore.ts:91`), but lower-level silent catches still collapse many classes to defaults.
- Distinctions often missing between:
  - user cancellation vs recoverable IO/transient network;
  - parse failure vs absent metadata;
  - degraded fallback vs hard playback failure.

### 6.6 Research-level improvement directions (non-implementation)

1. Establish a single cross-layer failure taxonomy that every boundary (UI, playback router, FTP, HVSC runtime, Android plugin) can map to.
2. Define a correlation contract spanning JS action traces and native plugin/service events.
3. Define diagnostic completeness criteria for lock/background incidents (minimum lifecycle + queue + source + transport context).
4. Define authoritative semantics for “duration propagated” vs “played without explicit duration metadata” to remove ambiguity in telemetry and tests.

---

## 7. Open Questions

1. Is `useSidPlayer` intentionally retained as an active runtime component, or should it be treated as legacy-only? Current wrapping/tracing implies mixed ownership.
2. For `/play`, what is the product-authoritative completion signal: JS guard timers, C64U status, or native service callbacks?
3. Is lock-screen auto-skip required for all sources, or only specific source/lifecycle combinations?
4. Is ultimate SID playback without SSL length propagation an acceptable degraded mode, or a defect when duration is expected?
5. What process-recreation guarantees are expected for SAF/content URI playlists under Android permission volatility?
6. During HVSC ingestion, which partial failures are acceptable while still setting state to `ready`?
7. What minimum native crash envelope is required for support triage (fields and classification) for FTP and SAF failures?
8. Should HVSC be represented as a first-class source in all UI source labels/icons to avoid user-facing origin ambiguity?

---

## Appendix A: Key Evidence Index

- Route + provider + trace mismatch:
  - `src/App.tsx:98`, `src/App.tsx:109`, `src/App.tsx:127`
  - `src/components/TraceContextBridge.tsx:27`
- Auto-next timing core:
  - `src/pages/PlayFilesPage.tsx:464`, `:472`, `:480`, `:492`, `:657`
- Playback controller source-specific duration logic:
  - `src/pages/playFiles/hooks/usePlaybackController.ts:238`, `:245`, `:282`, `:302`, `:463`
- Persistence/rehydration:
  - `src/pages/playFiles/hooks/usePlaybackPersistence.ts:89`, `:109`, `:233`, `:239`
  - `src/lib/sourceNavigation/localSourcesStore.ts:48`, `:103`, `:107`
- C64U duration propagation path:
  - `src/lib/playback/playbackRouter.ts:168`, `:171`, `:174`, `:178`
  - `src/lib/c64api.ts:1118`, `:1129`, `:1132`
  - `src/lib/sid/sidUtils.ts:15`
  - `doc/c64/c64u-openapi.yaml:228`
- Retry semantics:
  - `src/lib/c64api.ts:36`, `:513`, `:514`
- HVSC ingestion core:
  - `src/lib/hvsc/hvscIngestionRuntime.ts:61`, `:163`, `:225`, `:243`, `:409`, `:424`
  - `src/lib/hvsc/hvscArchiveExtraction.ts:58`, `:101`, `:127`
  - `src/lib/hvsc/hvscDownload.ts:224`, `:230`, `:257`
- Android background execution artifacts:
  - `android/app/src/main/AndroidManifest.xml:38`, `:47`, `:49`
  - `android/.../MainActivity.kt:16`
  - `android/.../BackgroundExecutionService.kt:25`, `:79`, `:126`
- Representative tests:
  - `playwright/playback.spec.ts:204`, `:295`, `:793`, `:814`
  - `playwright/playback.part2.spec.ts:297`, `:354`, `:421`, `:461`, `:541`
  - `playwright/hvsc.spec.ts:552`, `:574`, `:620`, `:719`, `:799`
  - `tests/unit/playbackRouter.test.ts:112`, `:123`
  - `tests/unit/c64api.test.ts:676`
  - `tests/unit/sidUtils.test.ts:21`
  - `tests/unit/pages/PlayFilesPage.test.tsx:11`
  - `.maestro/smoke-background-execution.yaml:10`
