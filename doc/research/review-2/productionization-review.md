# Productionization Review

## 1. Executive Summary

### Release confidence assessment

Release confidence: **medium** for Android, **medium-low** for broader cross-platform release (Android+iOS+Web).

Justification:

- Core device-control paths, RAM operations, CTA consistency model, and evidence tooling are generally solid.
- Remaining risk is concentrated in non-native HVSC memory behavior, malformed-success response masking, and CI crash gate softness.
- Test coverage is broad, but a few high-risk behaviors are not directly gated (native HVSC plugin behavior, volume/mute hook race logic, telemetry crash semantics).

### Top 5 highest priority issues

1. **F-01 (P1)**: Non-native HVSC download/extraction uses memory-amplifying buffer patterns and can still hit pressure/OOM on large archives.
2. **F-02 (P1)**: CI telemetry gates treat process disappearance/restart signal as warning and allow pipeline pass.
3. **F-03 (P1)**: REST response parsing returns synthetic `{ errors: [] }` on non-JSON or parse failures, masking malformed success payloads.
4. **F-04 (P2)**: FTP timeout/retry behavior is inconsistent and weak at bridge/plugin layer.
5. **F-05 (P2)**: Playlist persistence still writes full JSON blobs to localStorage despite architecture constraints for large scale.

## 2. System Overview (from code inspection)

### Architecture

- App shell/UI: React + Vite + Capacitor (`src/App.tsx`, `src/pages/*`, `src/components/*`).
- REST client and connection routing: `src/lib/c64api.ts` plus interaction guards in `src/lib/deviceInteraction/deviceInteractionManager.ts`.
- FTP layers:
  - TS orchestrator: `src/lib/ftp/ftpClient.ts`
  - Capacitor bridge contract: `src/lib/native/ftpClient.ts`
  - Web bridge implementation: `src/lib/native/ftpClient.web.ts`
  - Native plugins: Android `android/app/src/main/java/uk/gleissner/c64commander/FtpClientPlugin.kt`, iOS `ios/App/App/NativePlugins.swift`, `ios/App/App/IOSFtp.swift`.
- HVSC pipeline:
  - Download/extraction/runtime: `src/lib/hvsc/hvscDownload.ts`, `src/lib/hvsc/hvscArchiveExtraction.ts`, `src/lib/hvsc/hvscIngestionRuntime.ts`, `src/lib/hvsc/hvscIngestionPipeline.ts`.
  - Native ingestion plugin (Android): `android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt`.
- Persistence/caching:
  - localStorage/sessionStorage state stores (`src/lib/hvsc/*Store.ts`, playback persistence hook, playlist localStorage repository).
  - Playlist repository abstraction (`src/lib/playlistRepository/*`).
- Observability:
  - Logs: `src/lib/logging.ts`
  - Traces and redaction: `src/lib/tracing/traceSession.ts`, `src/lib/tracing/redaction.ts`
  - Native diagnostics bridges: Android/iOS plugins.

### Platform divergences

- Android registers native plugins including HVSC ingestion and background execution (`android/app/src/main/java/uk/gleissner/c64commander/MainActivity.kt:17`, `android/app/src/main/java/uk/gleissner/c64commander/MainActivity.kt:22`).
- iOS registers FTP/secure storage/diagnostics/background plugins but no HVSC ingestion plugin; background execution plugin is explicit no-op (`ios/App/App/AppDelegate.swift:47`, `ios/App/App/AppDelegate.swift:53`, `ios/App/App/NativePlugins.swift:889`).
- Web uses Capacitor web fallbacks (`src/lib/native/ftpClient.ts:43`, `src/lib/native/backgroundExecution.ts:28`, `src/lib/native/backgroundExecution.web.ts:14`).
- Runtime capability detection and probe override logic are centralized in `src/lib/native/platform.ts`.

## 3. Reliability Review

### HVSC download/ingest pipeline

What is strong:

- Android native ingestion is stream-oriented with chunked IO and cancellation checks during iteration (`android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt:299`, `android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt:346`, `android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt:462`).
- Runtime has explicit pipeline state machine and stale state recovery after restart (`src/lib/hvsc/hvscIngestionPipeline.ts:27`, `src/lib/hvsc/hvscIngestionRuntime.ts:66`).

What remains risky:

- Non-native path still accumulates full archive and then concatenates (`src/lib/hvsc/hvscDownload.ts:393`, `src/lib/hvsc/hvscDownload.ts:430`).
- Fallback path uses full `arrayBuffer()` (`src/lib/hvsc/hvscDownload.ts:385`).
- Zip extraction builds an in-memory list of all extracted entries before processing (`src/lib/hvsc/hvscArchiveExtraction.ts:70`, `src/lib/hvsc/hvscArchiveExtraction.ts:106`).
- 7z extraction writes full archive bytes into wasm FS up front (`src/lib/hvsc/hvscArchiveExtraction.ts:157`, `src/lib/hvsc/hvscArchiveExtraction.ts:158`).

### Network error handling (REST/FTP)

- REST request loop has timeout handling and conditional retry, but retry is tightly scoped to idle-recovery methods (`src/lib/c64api.ts:580`, `src/lib/c64api.ts:581`, `src/lib/c64api.ts:723`).
- REST response parser returns synthetic success-like shape for non-JSON/parse-failed 200s (`src/lib/c64api.ts:497`, `src/lib/c64api.ts:505`).
- FTP reliability scaffolding exists in interaction manager (backoff/circuit/cooldown/coalescing) (`src/lib/deviceInteraction/deviceInteractionManager.ts:222`, `src/lib/deviceInteraction/deviceInteractionManager.ts:387`), but bridge/plugin layer behavior is inconsistent:
  - Web bridge hard-codes 3s abort with no retry (`src/lib/native/ftpClient.web.ts:20`, `src/lib/native/ftpClient.web.ts:63`).
  - Android plugin uses plain connect/login/retrieve without explicit timeout configuration in plugin code (`android/app/src/main/java/uk/gleissner/c64commander/FtpClientPlugin.kt:68`, `android/app/src/main/java/uk/gleissner/c64commander/FtpClientPlugin.kt:148`).
  - iOS plugin has 30s command timeout but no higher-level retry (`ios/App/App/IOSFtp.swift:14`, `ios/App/App/NativePlugins.swift:648`).

### Crash surfaces

- App-level handlers exist for `window.error` and unhandled promise rejection, with trace+error logging (`src/App.tsx:150`, `src/App.tsx:171`).
- React render boundary logs crashes (`src/App.tsx:220`, `src/App.tsx:227`).
- CI telemetry monitors detect process disappearance and emit exit code 3 (`ci/telemetry/android/monitor_android.sh:310`, `ci/telemetry/ios/monitor_ios.sh:297`), but workflow gates currently convert this to warning/pass (`.github/workflows/android.yaml:965`, `.github/workflows/ios.yaml:440`).

## 4. Performance and Memory Review

### Hot paths and large allocations

- HVSC TS download/extraction has the largest allocation risk on non-native paths (`src/lib/hvsc/hvscDownload.ts:394`, `src/lib/hvsc/hvscArchiveExtraction.ts:73`).
- Playback persistence serializes full playlist to JSON on every persistence cycle (`src/pages/playFiles/hooks/usePlaybackPersistence.ts:373`, `src/pages/playFiles/hooks/usePlaybackPersistence.ts:390`).

### UI rendering and event storms

- Slider component coalesces async updates through `createSliderAsyncQueue` and microtask scheduling (`src/components/ui/slider.tsx:88`, `src/lib/ui/sliderBehavior.ts:66`).
- Volume/mute synchronization has explicit “defer/clear/apply” guard logic to avoid immediate overwrite races (`src/pages/playFiles/hooks/useVolumeOverride.ts:423`, `src/pages/playFiles/playbackGuards.ts:28`).

### Resource cleanup

- CTA tap-flash timers are cleared on re-application and timeout completion (`src/lib/ui/buttonInteraction.ts:34`, `src/lib/ui/buttonInteraction.ts:45`).
- Volume update timer cleanup on unmount exists (`src/pages/playFiles/hooks/useVolumeOverride.ts:433`).
- Dialog primitives enforce bounded viewport height and scroll overflow (`src/components/ui/dialog.tsx:51`, `src/components/ui/alert-dialog.tsx:45`).

### Mobile constraints assumptions

- Android startup logs memory class (`android/app/src/main/java/uk/gleissner/c64commander/MainActivity.kt:30`).
- Non-native HVSC path still assumes memory headroom for full archive+entry buffering; this assumption is weakest on iOS/Web low-memory devices.

## 5. UX Consistency Review

### CTA pressed/highlight behavior

- Single global model is implemented and mounted app-wide (`src/lib/ui/buttonInteraction.ts:79`, `src/App.tsx:99`, `src/App.tsx:197`).
- Shared button and quick action components route through the same interaction hook (`src/components/ui/button.tsx:55`, `src/components/QuickActionCard.tsx:46`).
- Style is centralized (`src/index.css:186`).
- Stateful controls can opt out of transient flash via persistent-active attribute (`src/lib/ui/buttonInteraction.ts:55`, `src/pages/playFiles/components/PlaybackControlsCard.tsx:122`).

### Slider/mute interactions

- Slider/mute paths are significantly more complex than other UI controls and are sensitive to async order.
- Existing E2E coverage validates key behaviors (mute toggles, slider while muted, unmute behavior) (`playwright/playback.spec.ts:1045`, `playwright/playback.part2.spec.ts:1027`), but direct hook-level isolation is missing.

### Modals/dialogs

- Core dialog primitives are consistent and small-screen aware (`src/components/ui/dialog.tsx:51`, `src/components/ui/alert-dialog.tsx:45`).
- Key complex dialog (`ItemSelectionDialog`) applies scroll container and safe-area-aware footer (`src/components/itemSelection/ItemSelectionDialog.tsx:282`, `src/components/itemSelection/ItemSelectionDialog.tsx:393`).
- Layout overflow Playwright coverage is substantial (`playwright/layoutOverflow.spec.ts:25`, `playwright/layoutOverflow.spec.ts:233`).

## 6. Data Integrity and Safety Review

### RAM save/load

- Full image size validation is explicit before load (`src/lib/machine/ramOperations.ts:274`, `src/pages/home/hooks/useHomeActions.ts:193`).
- Read/write operations are retried with deterministic failure semantics and liveness recovery (`src/lib/machine/ramOperations.ts:48`, `src/lib/machine/ramOperations.ts:97`).
- Pause/resume failure composition is explicit and non-silent (`src/lib/machine/ramOperations.ts:224`, `src/lib/machine/ramOperations.ts:256`).
- File pickers enforce `.bin` extension and permission checks (`src/lib/machine/ramDumpStorage.ts:68`, `src/lib/machine/ramDumpStorage.ts:160`).

### Local persistence and migrations

- State stores generally fail closed to defaults on parse failures.
- Several parse failure paths use `console.warn` instead of diagnostics pipeline logging (`src/lib/hvsc/hvscStateStore.ts:57`, `src/lib/hvsc/hvscStatusStore.ts:69`, `src/lib/sourceNavigation/ftpSourceAdapter.ts:41`, `src/lib/playlistRepository/localStorageRepository.ts:82`).
- Architecture doc mandates avoiding large playlist JSON blobs in localStorage at 100k scale (`doc/architecture.md:175`), but playback persistence still writes full blob snapshots (`src/pages/playFiles/hooks/usePlaybackPersistence.ts:373`).

### Security/privacy

- Sensitive header/payload redaction exists for trace capture (`src/lib/tracing/redaction.ts:13`, `src/lib/tracing/redaction.ts:45`).
- Log and trace retention are bounded (`src/lib/logging.ts:28`, `src/lib/tracing/traceSession.ts:28`, `src/lib/tracing/traceSession.ts:30`).
- Native secure storage plugins exist; web implementation uses in-memory value or backend API in web-platform mode (`src/lib/native/secureStorage.web.ts:44`, `src/lib/native/secureStorage.web.ts:63`).

## 7. Test Coverage and Quality Gates Review

### Current test pyramid (repo evidence)

- Unit: extensive Vitest coverage across core libs/hooks/components (examples: HVSC, c64api, device interaction, RAM operations).
- Integration/E2E:
  - Playwright with screenshots/video/traces (`playwright.config.ts:84`, `playwright.config.ts:86`).
  - Maestro Android/iOS flow sets with CI tagging rules (`doc/testing/maestro.md`, `.maestro/config.yaml:11`).
  - Android emulator smoke harness and contract harness exist (`tests/android-emulator/README.md`, `tests/contract/README.md`).
- Android JVM tests cover multiple plugins and fixtures (`android/app/src/test/java/uk/gleissner/c64commander/*`).

### Flow-specific gap review

- HVSC ingest:
  - Strong TS-side tests for archive/extraction/runtime pipeline.
  - Gap: no dedicated JVM tests for `HvscIngestionPlugin` behavior (cancel/progress/error paths) despite plugin complexity.
- CTA highlighting:
  - Good unit + Playwright proof coverage (`src/lib/ui/buttonInteraction.test.ts:23`, `playwright/buttonHighlightProof.spec.ts:4`).
- Slider/mute:
  - Good component/util + E2E coverage (`src/components/ui/slider.test.tsx`, `playwright/playback.part2.spec.ts:1027`).
  - Gap: no direct unit tests for `useVolumeOverride` race/decision logic.
- RAM save/load:
  - Strong unit/UI tests (`tests/unit/ramOperations.test.ts:69`, `tests/unit/pages/HomePage.ramActions.test.tsx:176`).

### Crash detection and artifacts

- Artifact collection and validation are robust (screenshots/video/signature checks + golden trace compare):
  - `playwright/testArtifacts.ts:187`
  - `scripts/validate-playwright-evidence.mjs:110`
  - `.github/workflows/android.yaml:351`
- Telemetry monitors run on Android/iOS jobs, but process disappearance is not a hard failure condition.

### Coverage gate quality

- Vitest branch threshold currently 80 (`vitest.config.ts:84`).
- CI threshold script enforces line coverage only (`scripts/check-coverage-threshold.mjs:26`, `scripts/check-coverage-threshold.mjs:65`) with `COVERAGE_MIN=90` (`.github/workflows/android.yaml:386`).
- This is weaker than branch-risk gating expected for release-hardening.

### Device realism

- Repo has emulator/simulator/contract paths, but physical-device-specific behavior (actual C64U timing, network jitter, iOS memory pressure) cannot be fully inferred from repository-only evidence.
- Recommended closure action: run a fixed manual matrix on physical devices with telemetry and exported traces as mandatory release artifacts.

## 8. Findings (Prioritized Backlog)

### Priority rubric

- `P0`: likely crash/data loss/device corruption/severe UX break in core flows; weak detection.
- `P1`: major reliability/UX issue in common flows; partial detection.
- `P2`: moderate issue or edge case with workaround.
- `P3`: minor/polish/low-risk hardening.

| ID   | Area                    | Finding                                                                                                                                         | Evidence                                                                                                                                                                                                                                                   | Impact                          | Likelihood | Detectability | Fix Effort   | Priority | Recommendation                                                                                                            |
| ---- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ---------- | ------------- | ------------ | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| F-01 | HVSC reliability/perf   | Non-native HVSC path still uses full-buffer download + extraction accumulation; risk of memory pressure/OOM on large archives.                  | `src/lib/hvsc/hvscDownload.ts:393`<br>`src/lib/hvsc/hvscDownload.ts:430`<br>`src/lib/hvsc/hvscArchiveExtraction.ts:70`<br>`src/lib/hvsc/hvscArchiveExtraction.ts:157`                                                                                      | High (crash/failed install)     | Medium     | Low           | Medium-Large | P1       | Move non-native path to true streaming extraction and bounded buffering; add memory-soak gate on non-native ingestion.    |
| F-02 | CI crash detection      | Telemetry monitor exit code `3` (process disappearance/restart detected) is downgraded to warning, so CI can pass despite crash/restart signal. | `ci/telemetry/android/monitor_android.sh:310`<br>`ci/telemetry/ios/monitor_ios.sh:297`<br>`.github/workflows/android.yaml:965`<br>`.github/workflows/ios.yaml:440`                                                                                         | High (false release confidence) | Medium     | Low (as gate) | Small        | P1       | Fail telemetry gate on exit code `3` for release branches/tags; keep warning-only mode for dev branches if needed.        |
| F-03 | REST reliability        | `parseResponseJson` returns synthetic `{ errors: [] }` for non-JSON or JSON parse failure on HTTP 200, masking malformed backend responses.     | `src/lib/c64api.ts:495`<br>`src/lib/c64api.ts:497`<br>`src/lib/c64api.ts:505`<br>`tests/unit/c64api.test.ts:247`<br>`tests/unit/c64api.test.ts:381`                                                                                                        | High (silent bad state)         | Medium     | Low           | Medium       | P1       | Treat malformed 200 responses as typed failures (or explicit degraded status), not empty success payload.                 |
| F-04 | FTP resilience          | FTP bridge/plugin behavior is inconsistent: web hard-timeout 3s/no retry; Android/iOS plugin paths lack explicit retry policy at bridge level.  | `src/lib/native/ftpClient.web.ts:20`<br>`src/lib/native/ftpClient.web.ts:63`<br>`android/app/src/main/java/uk/gleissner/c64commander/FtpClientPlugin.kt:68`<br>`ios/App/App/IOSFtp.swift:14`                                                               | Medium                          | Medium     | Medium        | Medium       | P2       | Unify timeout/retry policy and make configurable; add retry-classification tests for transient FTP failures.              |
| F-05 | Persistence scalability | Playlist persistence still writes full JSON blobs to localStorage each cycle, conflicting with architecture rule for large playlists.           | `doc/architecture.md:175`<br>`src/pages/playFiles/hooks/usePlaybackPersistence.ts:373`<br>`src/pages/playFiles/hooks/usePlaybackPersistence.ts:390`                                                                                                        | Medium (performance/quota)      | Medium     | Medium-Low    | Medium       | P2       | Keep repository-backed persistence as source of truth and gate/disable large legacy blob writes by size/count.            |
| F-06 | Slider/mute testability | `useVolumeOverride` contains high-complexity sync/race logic but has no dedicated hook-level tests; current detection relies mostly on E2E.     | `src/pages/playFiles/hooks/useVolumeOverride.ts:266`<br>`src/pages/playFiles/hooks/useVolumeOverride.ts:423`<br>`playwright/playback.spec.ts:1045`<br>`playwright/playback.part2.spec.ts:1027`                                                             | Medium                          | Medium     | Low-Medium    | Small-Medium | P2       | Add focused hook tests for deferred sync decisions, mute/unmute snapshots, timer sequencing, and stale UI target expiry.  |
| F-07 | Native HVSC test gap    | Android has HVSC runtime fixture test, but no direct JVM tests for `HvscIngestionPlugin` ingestion/cancel/error/progress semantics.             | `android/app/src/test/java/uk/gleissner/c64commander/HvscSevenZipRuntimeTest.kt:8`<br>`android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt:274`<br>`android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt:580` | Medium                          | Medium     | Low           | Medium       | P2       | Add plugin-level JVM tests using fixture archives and fake calls for success/cancel/error/progress contract verification. |
| F-08 | Observability           | Some storage parse failures log only to `console.warn`, bypassing diagnostics log ingestion and exported troubleshooting payloads.              | `src/lib/hvsc/hvscStateStore.ts:57`<br>`src/lib/hvsc/hvscStatusStore.ts:69`<br>`src/lib/sourceNavigation/ftpSourceAdapter.ts:41`<br>`src/lib/playlistRepository/localStorageRepository.ts:82`                                                              | Low                             | Medium     | Medium        | Small        | P3       | Route these warnings through `addLog('warn', ...)` with context while preserving fallback behavior.                       |

### Per-finding reproduction and test recommendations

#### F-01 Reproduction steps

1. Run on non-native path (web/iOS simulator where `HvscIngestion` plugin is unavailable).
2. Trigger HVSC install/update with a large archive (`HVSC_Update_84.7z` or larger synthetic archive).
3. Observe JS heap growth during download and extraction; on constrained device/simulator this can stall or crash.

Suggested test:

- Add an automated non-native ingestion stress test that runs with constrained memory and asserts completion without process restart/OOM, plus a bounded peak-memory assertion from instrumentation samples.

#### F-02 Reproduction steps

1. In CI or local workflow simulation, force telemetry monitor condition where app process disappears and monitor exits `3`.
2. Observe workflow gate step logs warning and exits `0`.
3. Pipeline still reports success.

Suggested test:

- Add workflow-level script test fixture that injects `monitor.exitcode=3` and asserts release pipeline fails.

#### F-03 Reproduction steps

1. Mock C64U endpoint returning HTTP `200` with `text/plain` or invalid JSON body.
2. Invoke `C64API` read path.
3. Observe returned value includes `errors: []` instead of failure, potentially treated as success by callers.

Suggested test:

- Add contract-style unit tests asserting malformed success payloads propagate explicit failure state (not synthetic empty success), and validate caller behavior for this error type.

#### F-04 Reproduction steps

1. Configure FTP bridge/network with induced latency >3s or transient packet loss.
2. Trigger list/read operations repeatedly from Play page browse flow.
3. Observe immediate timeout failures without bridge-level retry on web path; compare behavior against native.

Suggested test:

- Add deterministic FTP transient-failure matrix test (timeout, connection reset, delayed response) asserting unified retry/backoff behavior across web and native adapters.

#### F-05 Reproduction steps

1. Seed playlist with very large item count.
2. Perform operations that trigger playlist persistence repeatedly.
3. Observe large `localStorage` blob writes and potential quota/perf degradation.

Suggested test:

- Add stress test that grows playlist beyond threshold and asserts persistence path uses repository-only snapshots (or size-gated fallback) without large legacy blob writes.

#### F-06 Reproduction steps

1. Trigger rapid slider drag + mute/unmute toggles while config updates are in flight.
2. Introduce async jitter in `updateConfigBatch` response timing.
3. Observe occasional deferred sync edge behavior that is currently only covered indirectly through E2E.

Suggested test:

- Add hook-level tests for `scheduleVolumeUpdate`, `resolveVolumeSyncDecision`, snapshot restoration, and timer expiry under fake timers and controlled async ordering.

#### F-07 Reproduction steps

1. Execute Android JVM tests; note HVSC coverage focuses on runtime availability and fixture readability only.
2. Review native ingestion plugin behavior (cancellation/progress/deletion/upsert paths).
3. Confirm no direct plugin contract tests assert those semantics.

Suggested test:

- Add `HvscIngestionPluginTest` with fixture archives and mocked plugin calls validating:
  1. cancellation interrupts processing,
  2. progress events emit expected shape/frequency,
  3. failed SID entries increment failure counters and include paths,
  4. deletion list effects are applied safely.

#### F-08 Reproduction steps

1. Corrupt localStorage payloads for HVSC/FTP/playlist stores.
2. Reload app and trigger store read.
3. Observe warning appears in dev console but may not be present in in-app diagnostics export.

Suggested test:

- Add unit tests asserting parse-failure paths invoke centralized warning logger and that diagnostics export includes those warnings.

## 9. “Going Well” Notes

- **Native HVSC ingestion architecture is robust**: stream/chunk processing, cancellation, DB batching, and deletion application are explicit (`android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt:295`, `android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt:372`, `android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt:424`).
- **REST/FTP safety orchestration is strong**: circuit breaker, backoff, cooldown, and coalescing are centralized and tested (`src/lib/deviceInteraction/deviceInteractionManager.ts:201`, `src/lib/deviceInteraction/deviceInteractionManager.ts:387`, `tests/unit/lib/deviceInteraction/deviceInteractionManager.test.ts:115`).
- **RAM operations are production-minded**: strict size checks, pause/resume discipline, liveness recovery, and deterministic error handling (`src/lib/machine/ramOperations.ts:274`, `src/lib/machine/ramOperations.ts:224`, `tests/unit/ramOperations.test.ts:69`).
- **CTA consistency model is centralized and verified**: shared interaction utility + app-wide registration + unit/E2E coverage (`src/lib/ui/buttonInteraction.ts:79`, `src/App.tsx:99`, `src/lib/ui/buttonInteraction.test.ts:23`, `playwright/buttonHighlightProof.spec.ts:4`).
- **Evidence and trace quality controls are mature**: screenshot/video/zip signature validation and golden trace comparison with diff output (`playwright/testArtifacts.ts:227`, `scripts/validate-playwright-evidence.mjs:110`, `.github/workflows/android.yaml:351`).
- **Trace/log bounding and redaction are present**: event limits, storage cap, sensitive key redaction (`src/lib/tracing/traceSession.ts:28`, `src/lib/tracing/traceSession.ts:82`, `src/lib/tracing/redaction.ts:13`).

## 10. Release Readiness Recommendation

Recommendation: **Ship with conditions**.

Minimal gating criteria before broader release:

1. CI telemetry gate fails on process disappearance (`monitor.exitcode == 3`) for release branches/tags.
2. Non-native HVSC ingestion passes a memory-constrained soak scenario (or is feature-gated on platforms where this is not yet true).
3. Malformed 200-response handling is made explicit (no synthetic silent success).
4. Add targeted tests for `useVolumeOverride` race logic and Android `HvscIngestionPlugin` behavior.
5. Confirm coverage gate policy for release includes branch threshold target (>=82%) or equivalent risk-based gate.

## 11. Appendix

### Inventory: relevant folders/files inspected

- App/docs/policies:
  - `README.md`
  - `doc/ux-guidelines.md`
  - `doc/testing/maestro.md`
  - `doc/architecture.md`
  - `.github/copilot-instructions.md`
- HVSC:
  - `src/lib/hvsc/hvscDownload.ts`
  - `src/lib/hvsc/hvscArchiveExtraction.ts`
  - `src/lib/hvsc/hvscIngestionRuntime.ts`
  - `src/lib/hvsc/hvscIngestionPipeline.ts`
  - `android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt`
  - `tests/unit/hvsc/*`
- REST/FTP/native:
  - `src/lib/c64api.ts`
  - `src/lib/ftp/ftpClient.ts`
  - `src/lib/native/ftpClient.ts`
  - `src/lib/native/ftpClient.web.ts`
  - `android/app/src/main/java/uk/gleissner/c64commander/FtpClientPlugin.kt`
  - `ios/App/App/NativePlugins.swift`
  - `ios/App/App/IOSFtp.swift`
- UX + playback:
  - `src/lib/ui/buttonInteraction.ts`
  - `src/components/ui/button.tsx`
  - `src/components/QuickActionCard.tsx`
  - `src/components/ui/slider.tsx`
  - `src/lib/ui/sliderBehavior.ts`
  - `src/pages/playFiles/hooks/useVolumeOverride.ts`
  - `src/pages/playFiles/components/PlaybackControlsCard.tsx`
  - `src/components/ui/dialog.tsx`
  - `src/components/ui/alert-dialog.tsx`
  - `src/components/itemSelection/ItemSelectionDialog.tsx`
- RAM + persistence + observability:
  - `src/lib/machine/ramOperations.ts`
  - `src/lib/machine/ramDumpStorage.ts`
  - `src/pages/home/hooks/useHomeActions.ts`
  - `src/pages/playFiles/hooks/usePlaybackPersistence.ts`
  - `src/lib/playlistRepository/*`
  - `src/lib/logging.ts`
  - `src/lib/tracing/*`
- CI/tests:
  - `playwright.config.ts`
  - `playwright/testArtifacts.ts`
  - `playwright/*.spec.ts`
  - `scripts/validate-playwright-evidence.mjs`
  - `scripts/check-coverage-threshold.mjs`
  - `.github/workflows/android.yaml`
  - `.github/workflows/ios.yaml`
  - `ci/telemetry/android/monitor_android.sh`
  - `ci/telemetry/ios/monitor_ios.sh`

### Key state machines/event flows (text summary)

- **HVSC pipeline state machine**
  - `IDLE -> DOWNLOADING -> DOWNLOADED -> EXTRACTING -> EXTRACTED -> INGESTING -> READY`
  - Illegal transitions throw and log (`src/lib/hvsc/hvscIngestionPipeline.ts:44`).
- **REST/FTP device interaction guard flow**
  - Entry checks device state/circuit.
  - Apply backoff/cooldown/coalescing.
  - Execute request and update failure streak/circuit.
  - Emit tracing + diagnostics side effects.
  - Implemented in `src/lib/deviceInteraction/deviceInteractionManager.ts`.
- **Volume sync decision flow**
  - Pending UI target + incoming device state resolves to `apply`, `clear`, or `defer` (`src/pages/playFiles/playbackGuards.ts:28`).
  - Hook uses this to prevent immediate stale-sync overwrites (`src/pages/playFiles/hooks/useVolumeOverride.ts:423`).
- **RAM save/load flow**
  - Liveness gate -> pause machine -> chunked read/write with retries -> resume/recover -> deterministic failure message.
  - Implemented in `src/lib/machine/ramOperations.ts`.

### Explicit unknowns and closure actions

- Physical-device-only behavior (C64U firmware timing under unstable Wi-Fi and prolonged HVSC ingest on iOS/Web hardware) cannot be fully proven from repo inspection.
- Closure action: add a release checklist requiring physical-device telemetry bundles, traces, and pass/fail evidence for HVSC ingest, FTP browse, and RAM load/save scenarios.
