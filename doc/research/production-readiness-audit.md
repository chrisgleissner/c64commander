# Production Readiness Audit (feat/iOS-PORT)

## 1. Executive Summary

### Overall assessment

Android (MVP platform) shows strong architecture and broad test investment, but is **not yet production-ready** at the reliability bar requested for background playback and crash resilience.

iOS is structurally integrated but still **forward-looking / non-parity** (not a release blocker for Android MVP, but a major divergence risk for this branch).

### Risk classification

- **Overall risk: High**
- **Android runtime risk: Medium-High**
- **iOS portability risk: High**

### Blockers vs improvements

**Blockers (release-critical):**

- Android background execution service lifecycle can remain sticky with wake lock semantics that are not safety-bounded (`android/app/src/main/java/uk/gleissner/c64commander/BackgroundExecutionService.kt:113`, `android/app/src/main/java/uk/gleissner/c64commander/BackgroundExecutionService.kt:116`, `android/app/src/main/java/uk/gleissner/c64commander/BackgroundExecutionService.kt:164`).
- Locked-screen/background playback reliability is not CI-gated: probe flow exists but is excluded by default and excluded in CI filtering (`.maestro/config.yaml:13`, `.maestro/smoke-background-execution.yaml:6`, `scripts/run-maestro-gating.sh:384`).
- Restored playback session reconstructs `autoAdvanceGuard` but does not restore `autoAdvanceDueAtMs`, so native watchdog due-time is not rehydrated (`src/pages/playFiles/hooks/usePlaybackPersistence.ts:346`, `src/pages/PlayFilesPage.tsx:219`, `src/pages/PlayFilesPage.tsx:340`).

**Important improvements (non-blocking but high value):**

- Race risk in async source navigation state writes (`src/lib/sourceNavigation/useSourceNavigator.ts:68`, `src/lib/sourceNavigation/useSourceNavigator.ts:69`, `src/lib/sourceNavigation/useSourceNavigator.ts:87`).
- Silent error swallowing in config write queue (`src/lib/config/configWriteThrottle.ts:39`).
- Observability inconsistency (`console.warn`) in persistence/cache paths (`src/lib/hvsc/hvscStateStore.ts:57`, `src/lib/hvsc/hvscStatusStore.ts:69`, `src/lib/sourceNavigation/ftpSourceAdapter.ts:41`, `src/lib/sourceNavigation/localSourcesStore.ts:95`).

## 2. Architectural Map

### High-level system overview

- React + Vite app with Capacitor native bridges.
- App entry and routing in `src/App.tsx`.
- Production playback UI path is `PlayFilesPage` (`src/App.tsx:113`).
- Native capability surface via plugins on Android/iOS (`android/app/src/main/java/uk/gleissner/c64commander/MainActivity.kt:16`, `ios/App/App/AppDelegate.swift:18`).

### Playback pipeline

- Core execution router: `buildPlayPlan` + `executePlayPlan` (`src/lib/playback/playbackRouter.ts:59`, `src/lib/playback/playbackRouter.ts:186`).
- Unified source kinds in main pipeline: `local`, `ultimate`, `hvsc` (`src/lib/playback/playbackRouter.ts:32`).
- Song timing and auto-advance guard in `usePlaybackController` (`src/pages/playFiles/hooks/usePlaybackController.ts:311`, `src/pages/playFiles/hooks/usePlaybackController.ts:509`).
- Clock model: `PlaybackClock` (`src/lib/playback/playbackClock.ts:9`).

### HVSC ingestion pipeline

- Runtime orchestrator: `installOrUpdateHvsc` / `ingestCachedHvsc` (`src/lib/hvsc/hvscIngestionRuntime.ts:383`, `src/lib/hvsc/hvscIngestionRuntime.ts:604`).
- Stages: discover -> download -> validate -> extract -> ingest -> ready, with explicit state machine transitions (`src/lib/hvsc/hvscIngestionRuntime.ts:448`, `src/lib/hvsc/hvscIngestionRuntime.ts:366`).
- Stale-recovery on cold start (`src/lib/hvsc/hvscIngestionRuntime.ts:64`).
- Cache marker model for completed archives (`src/lib/hvsc/hvscFilesystem.ts:332`, `src/lib/hvsc/hvscDownload.ts:415`).

### Background execution model

- JS side:
  - Starts/stops native background execution when playing (`src/pages/PlayFilesPage.tsx:331`).
  - Periodic reconciliation + resume triggers (`src/pages/PlayFilesPage.tsx:538`, `src/pages/playFiles/hooks/usePlaybackResumeTriggers.ts:21`).
  - Handles native due-event listener (`src/pages/PlayFilesPage.tsx:549`).
- Android native side:
  - Foreground service + partial wakelock (`android/app/src/main/java/uk/gleissner/c64commander/BackgroundExecutionService.kt:101`, `android/app/src/main/java/uk/gleissner/c64commander/BackgroundExecutionService.kt:164`).
  - Broadcast watchdog event (`android/app/src/main/java/uk/gleissner/c64commander/BackgroundExecutionService.kt:200`).

### Cross-platform abstraction model

- Capacitor plugin wrapper for background execution (`src/lib/native/backgroundExecution.ts:28`).
- Android implementation functional; iOS implementation currently no-op (`android/app/src/main/java/uk/gleissner/c64commander/BackgroundExecutionPlugin.kt:80`, `ios/App/App/NativePlugins.swift:838`).
- iOS plugin registration exists but capability parity is incomplete (`ios/App/App/AppDelegate.swift:22`).

## 3. Critical Flow Analysis

### HVSC ingestion

**Current state:**

- Strong fail-fast behavior on ingest integrity issues (failed SID writes, deletion failures, songlength reload failures) (`src/lib/hvsc/hvscIngestionRuntime.ts:314`, `src/lib/hvsc/hvscIngestionRuntime.ts:332`, `src/lib/hvsc/hvscIngestionRuntime.ts:347`).
- Crash/restart stale state recovery exists (`src/lib/hvsc/hvscIngestionRuntime.ts:64`).
- Partial download handling uses completion markers and purges unmarked cache artifacts (`src/lib/hvsc/hvscDownload.ts:207`, `src/lib/hvsc/hvscDownload.ts:209`).

**Risks:**

- Memory pressure: full archive read-back into memory (`src/lib/hvsc/hvscDownload.ts:251`) and zip extraction collects all entries before processing (`src/lib/hvsc/hvscArchiveExtraction.ts:70`).
- No native/CI lockstep validation for low-storage / ENOSPC / kill-during-ingest scenarios.

### HVSC playback

**Current state:**

- HVSC tracks are converted to local play files and uploaded through unified SID upload path (`src/pages/playFiles/hooks/useHvscLibrary.ts:177`, `src/lib/playback/playbackRouter.ts:263`).
- Subsong metadata support exists (HVSC source expansion and per-subsong entries) (`src/lib/hvsc/hvscSource.ts:59`).

**Risks:**

- End-to-end native HVSC playback reliability is under-tested in CI because Maestro `hvsc` flows are excluded by default (`.maestro/config.yaml:16`).

### Song length propagation to C64U

**Current state:**

- Ultimate SID: duration present -> FTP fetch + SSL upload; failure -> fallback to `playSid` (`src/lib/playback/playbackRouter.ts:216`, `src/lib/playback/playbackRouter.ts:248`).
- Local/HVSC upload path can include SSL payload when duration exists (`src/lib/playback/playbackRouter.ts:265`).
- Duration resolution in controller uses path lookup then MD5 fallback (`src/pages/playFiles/hooks/usePlaybackController.ts:252`, `src/pages/playFiles/hooks/usePlaybackController.ts:256`).

**Risk:**

- Propagation is best-effort by design; not guaranteed under FTP/upload failures.

### Background playback with locked screen

**Current state:**

- JS reconciliation checks due-time and track-instance guard (`src/pages/PlayFilesPage.tsx:529`).
- Android watchdog event path exists (`android/app/src/main/java/uk/gleissner/c64commander/BackgroundExecutionService.kt:200`, `android/app/src/main/java/uk/gleissner/c64commander/BackgroundExecutionPlugin.kt:38`).

**Risks:**

- Service uses `START_STICKY` without service-side idle stop policy (`android/app/src/main/java/uk/gleissner/c64commander/BackgroundExecutionService.kt:113`, `android/app/src/main/java/uk/gleissner/c64commander/BackgroundExecutionService.kt:116`).
- CI does not enforce locked-screen validation (`.maestro/config.yaml:13`, `scripts/run-maestro-gating.sh:384`).
- Session restore does not rehydrate watchdog due-time state to native plugin (`src/pages/playFiles/hooks/usePlaybackPersistence.ts:346`, `src/pages/PlayFilesPage.tsx:340`).

### UI button state behavior

**Current state:**

- Stateless tap flash is transient (200 ms attr-based) (`src/lib/ui/buttonInteraction.ts:14`, `src/lib/ui/buttonInteraction.ts:29`).
- CSS mutation is scoped to transient attr only (`src/index.css:186`).
- Unit and Playwright checks exist for transient flash and focus clearing (`src/lib/ui/buttonInteraction.test.ts:18`, `playwright/homeInteractivity.spec.ts:254`).

**Risk:**

- No broad visual-regression assertions specifically guarding against permanent border/highlight regressions app-wide.

## 4. Test Coverage Audit

### Coverage strengths

- **Unit tests:** 178 files under `tests/unit` with explicit coverage thresholds (80/80/80/80) (`vitest.config.ts:84`).
- **HVSC unit depth:** focused tests for ingestion runtime, recovery, download, extraction, songlength service (`tests/unit/hvsc/hvscIngestionRuntime.test.ts`, `tests/unit/hvsc/hvscIngestionRecovery.test.ts`, `tests/unit/hvsc/hvscDownload.test.ts`).
- **Playback router depth:** strong SID/SSL propagation and fallback coverage (`tests/unit/playbackRouter.test.ts:125`, `tests/unit/playbackRouter.test.ts:168`, `tests/unit/playbackRouter.test.ts:190`).
- **E2E web coverage:** 32 Playwright spec files with trace and artifact collection (`playwright.config.ts:65`, `playwright.config.ts:79`).
- **Golden trace stewardship present:** 24 golden trace fixtures under `playwright/fixtures/traces/golden`.

### Coverage gaps

- `PlayFilesPage` page-level unit test is a placeholder only (`tests/unit/pages/PlayFilesPage.test.tsx:12`).
- No Android JVM/instrumented tests for `BackgroundExecutionService` behavior (due scheduling, restart semantics, wake lock lifecycle).
- Android emulator tests are limited to 2 connection-smoke specs (`tests/android-emulator/specs/connection.spec.mjs`, `tests/android-emulator/specs/real-target.spec.mjs`).
- Locked-screen/background Maestro probe is excluded from CI default run (`.maestro/config.yaml:13`, `scripts/run-maestro-gating.sh:384`).
- HVSC Maestro flows are excluded by default (`.maestro/config.yaml:16`).

### Missing scenarios (critical)

- App/process kill during active playback with service restart behavior.
- Process restart while playback session restore is active and due-time watchdog needs rehydration.
- HVSC ingestion under low storage / ENOSPC / large archive stress on real Android devices.
- Mid-download network interruption and resume semantics at scale (native path).
- Native FTP failure/recovery loops under real network jitter.

### Fragile tests

- Several Maestro flows rely on optional taps and resilient fallbacks; useful for smoke, weaker for strict regression detection.
- Web timer-throttling simulation (Playwright) does not fully model OEM lock-screen power policies.

### Platform-specific blind spots

- Android: native background-service correctness is not directly tested.
- iOS: no native test suite; CI flows are smoke-level and mostly structural.

## 5. Crash Risk Analysis

### Identified failure modes

- **Background service lifecycle drift:** sticky restart + wake lock behavior can persist beyond intended playback window.
- **State race in source browsing:** stale async responses can overwrite newer navigation state.
- **Config persistence error masking:** config queue intentionally swallows rejected queue chain.
- **Ingestion memory pressure:** large buffers and extraction materialization can trigger OOM/pressure faults.

### Potential unhandled / under-context exceptions

- Silent swallow in queue chain (`src/lib/config/configWriteThrottle.ts:39`).
- Empty catch blocks in Android Gradle version discovery (`android/app/build.gradle:34`, `android/app/build.gradle:51`).
- Multiple core storage/cache modules still use `console.warn` rather than canonical structured logging path.

### Resource exhaustion risks

- Archive download + read-back + extraction can duplicate large payloads in memory (`src/lib/hvsc/hvscDownload.ts:251`, `src/lib/hvsc/hvscArchiveExtraction.ts:70`).
- Service wake lock lifetime depends on higher-layer stop signals; no hard timeout/idle policy in service code.

## 6. Concurrency and Lifecycle Analysis

### Race condition risk

- `useSourceNavigator` token gating is only applied to loading-indicator visibility, not to `setEntries`/`setPath`; out-of-order async completion can overwrite newer state (`src/lib/sourceNavigation/useSourceNavigator.ts:68`, `src/lib/sourceNavigation/useSourceNavigator.ts:69`, `src/lib/sourceNavigation/useSourceNavigator.ts:87`).

### Cancellation safety

- HVSC ingestion cancellation checks are explicit and frequent (`src/lib/hvsc/hvscDownload.ts:282`, `src/lib/hvsc/hvscDownload.ts:388`, `src/lib/hvsc/hvscIngestionRuntime.ts:157`).
- FTP recursive listing supports abort signals and waits pending tasks on abort (`src/lib/sourceNavigation/ftpSourceAdapter.ts:132`, `src/lib/sourceNavigation/ftpSourceAdapter.ts:172`).

### Android lifecycle compliance

- Foreground service is declared correctly for media playback and non-exported (`android/app/src/main/AndroidManifest.xml:39`, `android/app/src/main/AndroidManifest.xml:41`).
- Plugin registers/unregisters receiver with error logging (`android/app/src/main/java/uk/gleissner/c64commander/BackgroundExecutionPlugin.kt:45`, `android/app/src/main/java/uk/gleissner/c64commander/BackgroundExecutionPlugin.kt:53`).

### Background service correctness

- Functionally correct watchdog scheduling path exists (`android/app/src/main/java/uk/gleissner/c64commander/BackgroundExecutionService.kt:190`).
- Correctness risk remains around `START_STICKY` restart semantics and no service-level self-termination condition.

## 7. Android Production Readiness

### Permissions and manifest

- Present: `INTERNET`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, `WAKE_LOCK` (`android/app/src/main/AndroidManifest.xml:46`).
- Service config is aligned with background playback intent (`android/app/src/main/AndroidManifest.xml:41`).

### Background playback compliance

- Architecture includes foreground notification + partial wake lock (`android/app/src/main/java/uk/gleissner/c64commander/BackgroundExecutionService.kt:101`, `android/app/src/main/java/uk/gleissner/c64commander/BackgroundExecutionService.kt:164`).
- JS and native due-at watchdog integration is implemented (`src/pages/PlayFilesPage.tsx:340`, `android/app/src/main/java/uk/gleissner/c64commander/BackgroundExecutionService.kt:200`).

### Battery optimization risks

- No explicit system-level battery optimization exemption flow in codebase.
- Known OEM constraints are documented (`doc/developer.md:123`) but not enforced via automated device-level reliability gates.

### Additional readiness concerns

- Cleartext traffic is globally enabled (`android/app/src/main/AndroidManifest.xml:11`), acceptable for LAN device workflows but raises broader transport-hardening concerns for production environments.

## 8. iOS Forward-Looking Assessment

### Structural portability issues

- Plugin registration and bridge scaffolding are in place (`ios/App/App/AppDelegate.swift:18`).
- Background execution plugin is currently no-op (`ios/App/App/NativePlugins.swift:838`).
- No `UIBackgroundModes` capability is present in inspected iOS plist/project files.

### Capacitor plugin gaps

- Background execution parity gap is explicit.
- FTP/folder/security plugins exist, but parity depth is not proven via native tests.

### Build configuration risks

- iOS CI exists with simulator build + Maestro smoke lanes (`.github/workflows/ios-ci.yaml:70`, `.github/workflows/ios-ci.yaml:375`).
- Rollout policy marks iOS progression as staged/informational (`.github/workflows/ios-ci.yaml:18`).

### Anticipated platform divergence

- Android-specific reliability mechanisms (foreground service + wake lock + due broadcast) currently have no iOS equivalent; playback behavior under lock/background will diverge until platform-specific strategy is implemented.

## 9. Determinism and Reliability Assessment

### Playback timing determinism

- Positive:
  - Absolute due-time model (`dueAtMs`) and `trackInstanceId` guard reduce duplicate/cascade transitions (`src/pages/playFiles/hooks/usePlaybackController.ts:311`, `src/pages/playFiles/hooks/usePlaybackController.ts:514`).
- Residual risk:
  - JS timer/lifecycle dependence remains primary; native watchdog is supplemental and not always active after restored sessions.

### Song length propagation guarantee

- Not guaranteed for Ultimate SIDs: explicit fallback to direct play when FTP/SSL path fails (`src/lib/playback/playbackRouter.ts:240`, `src/lib/playback/playbackRouter.ts:248`).

### Retry bounds

- REST idle recovery retries bounded (`src/lib/c64api.ts:558`).
- SID upload retries bounded (`src/lib/c64api.ts:37`, `src/lib/c64api.ts:1190`).

### Ingestion resumability / idempotency

- Cache marker model + stale-state recovery provide good restart safety (`src/lib/hvsc/hvscFilesystem.ts:332`, `src/lib/hvsc/hvscIngestionRuntime.ts:64`).
- Updates track applied versions and skip already applied updates (`src/lib/hvsc/hvscIngestionRuntime.ts:433`).

### State persistence safety

- Playlist and session persistence are robustly wrapped with error logging (`src/pages/playFiles/hooks/usePlaybackPersistence.ts:383`, `src/pages/playFiles/hooks/usePlaybackPersistence.ts:424`).
- One critical state-sync gap: restored auto-advance guard is not mirrored into native due-time state.

## 10. Actionable Findings (Prioritized)

| Priority | Severity | Finding | Affected modules | Why it matters | Recommended mitigation type | Missing test coverage |
|---|---|---|---|---|---|---|
| 1 | High | Background service restart/lifetime is not safety-bounded (`START_STICKY` + wakelock) | `android/app/src/main/java/uk/gleissner/c64commander/BackgroundExecutionService.kt` | Battery/performance risk and unpredictable background behavior after process lifecycle events | Service lifecycle hardening and restart-policy validation | Yes |
| 2 | High | Locked-screen/background playback path is not CI-enforced | `.maestro/config.yaml`, `scripts/run-maestro-gating.sh`, `.maestro/smoke-background-execution.yaml` | Critical regression class can ship undetected | Promote lock-screen flow to required Android CI gate | Yes |
| 3 | High | Restored playback session does not rehydrate native watchdog due-time | `src/pages/playFiles/hooks/usePlaybackPersistence.ts`, `src/pages/PlayFilesPage.tsx` | Auto-advance reliability drops after restore when app is backgrounded/locked | State rehydration consistency between restored guard and native due clock | Yes |
| 4 | Medium-High | Async source-navigation stale result race | `src/lib/sourceNavigation/useSourceNavigator.ts` | Wrong folder contents can appear and drive wrong file selection | Request token gating for state writes and race-focused tests | Yes |
| 5 | Medium | Config write queue swallows queue-chain errors | `src/lib/config/configWriteThrottle.ts` | Hidden persistence failures and poor diagnosability | Error propagation/structured logging in queue continuation | Yes |
| 6 | Medium | Observability is inconsistent across core stores/adapters (`console.warn`) | `src/lib/hvsc/hvscStateStore.ts`, `src/lib/hvsc/hvscStatusStore.ts`, `src/lib/sourceNavigation/ftpSourceAdapter.ts`, `src/lib/sourceNavigation/localSourcesStore.ts` | Makes root-cause analysis harder in production diagnostics exports | Standardize on structured logging envelope | Partial |
| 7 | Medium | Ultimate SID length propagation is best-effort only | `src/lib/playback/playbackRouter.ts`, `src/pages/playFiles/hooks/usePlaybackController.ts` | Deterministic device-side timing is not guaranteed under FTP/upload failures | Reliability policy + telemetry/assertion strategy for fallback path | Partial |
| 8 | Medium | HVSC ingestion memory profile has high-pressure hotspots | `src/lib/hvsc/hvscDownload.ts`, `src/lib/hvsc/hvscArchiveExtraction.ts` | OOM/slowdown risk on constrained devices | Memory-pressure hardening and stress/soak test strategy | Yes |
| 9 | Medium | Android native background-service tests are absent; emulator suite is narrow | `android/app/src/test/java`, `tests/android-emulator/specs` | Lifecycle regressions likely to escape detection | Add service-focused native tests and broaden emulator scenarios | Yes |
| 10 | Medium | iOS background parity is missing (plugin no-op, no background mode) | `ios/App/App/NativePlugins.swift`, `ios/App/App/Info.plist` | High divergence risk as iOS branch progresses | Capability parity plan + platform-specific behavior tests | Yes |
| 11 | Low-Medium | Empty catches in Gradle scripts | `android/app/build.gradle` | Violates strict exception hygiene and obscures build diagnostics | Structured warning/error logging in catch blocks | No |
| 12 | Low | Very large files increase regression and review risk | `src/pages/SettingsPage.tsx`, `src/components/disks/HomeDiskManager.tsx`, `src/lib/c64api.ts`, `src/pages/PlayFilesPage.tsx` | Lower maintainability and higher defect probability during refactors | Modularization/refactor roadmap | Partial |

---

### Scope and method note

This audit was static, repository-wide, and included production code, tests, manifests, Capacitor/native bridges, CI workflows, Android and iOS scaffolding, and test harnesses. No source, test, or build logic was modified.
