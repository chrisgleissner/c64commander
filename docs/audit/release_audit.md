# C64 Commander Release Audit

## 1. Executive summary
- Release readiness verdict: GO-WITH-RISKS
- Top 5 risks (one line each)
  1. Plaintext device password is persisted in localStorage, creating credential exposure risk on-device. Evidence: [src/lib/c64api.ts](src/lib/c64api.ts#L1120-L1245), [src/hooks/useC64Connection.ts](src/hooks/useC64Connection.ts#L1-L80)
  2. Cleartext HTTP is explicitly enabled on Android while the default base URL uses http, exposing traffic to local network interception. Evidence: [android/app/src/main/AndroidManifest.xml](android/app/src/main/AndroidManifest.xml#L1-L40), [src/lib/c64api.ts](src/lib/c64api.ts#L1-L40)
  3. HVSC archive extraction uses synchronous unzip and 7z wasm operations on the main thread, risking UI stalls during large archives. Evidence: [src/lib/hvsc/hvscArchiveExtraction.ts](src/lib/hvsc/hvscArchiveExtraction.ts#L1-L200)
  4. Android instrumentation tests are not executed in CI, leaving device-only regressions unverified. Evidence: [.github/workflows/android-apk.yaml](.github/workflows/android-apk.yaml#L470-L560), [build](build#L380-L470)
  5. Trace session retains up to 50 MiB in memory, risking memory pressure on lower-end devices during long sessions. Evidence: [src/lib/tracing/traceSession.ts](src/lib/tracing/traceSession.ts#L1-L80)
- Immediate next 3 actions (concrete and repo-specific)
  1. Decide on credential storage policy and update storage to encrypted Android Keystore or remove persistence; add docs note. Evidence: [src/lib/c64api.ts](src/lib/c64api.ts#L1120-L1245), [docs/privacy-policy.md](docs/privacy-policy.md#L1-L80)
  2. Add a CI job for Android instrumentation (connectedDebugAndroidTest) or document release gate that requires manual execution. Evidence: [.github/workflows/android-apk.yaml](.github/workflows/android-apk.yaml#L470-L560), [build](build#L380-L470)
  3. Move HVSC extraction to a worker thread or add progress/cancel handling; add timing spans. Evidence: [src/lib/hvsc/hvscArchiveExtraction.ts](src/lib/hvsc/hvscArchiveExtraction.ts#L1-L200), [src/lib/tracing/traceSession.ts](src/lib/tracing/traceSession.ts#L1-L160)

## 2. Repository inventory (evidence map)
| Area | Key files/folders | Why it matters for release | Notes on confidence |
| --- | --- | --- | --- |
| UI pages | src/pages, src/components | Core user flows, settings, diagnostics UI | High (direct inspection) |
| Networking & device control | src/lib/c64api.ts, src/lib/connection | REST/FTP access, discovery, error handling | High |
| Device safety / throttling | src/lib/deviceInteraction, src/lib/config/deviceSafetySettings.ts | Protects hardware, concurrency/backoff | High |
| Storage & settings | src/lib/config/appSettings.ts, src/lib/uiPreferences.ts, src/lib/ftp/ftpConfig.ts | Defaults, persistence, user overrides | High |
| Tracing & logging | src/lib/tracing, src/lib/logging.ts, doc/tracing.md | Observability, diagnostics, evidence | High |
| Android build & config | android/app/build.gradle, android/variables.gradle, AndroidManifest.xml | SDK levels, signing, permissions | High |
| Tests (unit/e2e) | tests/, playwright/, package.json, playwright.config.ts | Regression coverage, deterministic CI | High |
| CI workflows | .github/workflows/android-apk.yaml | Release gates, coverage enforcement | High |
| Docs | README.md, doc/, docs/ | User guidance, privacy, release notes | Medium (doc/code diff) |

## 3. Audit methodology (deterministic)
### Steps executed
1. Ran the repository build helper to capture full pipeline output and test results.
2. Inspected core runtime modules (REST/FTP, device safety, tracing, logging, settings storage).
3. Reviewed Android build configuration, manifest, and CI workflows.
4. Cross-checked docs vs code for settings, privacy, and release notes.
5. Reviewed test architecture and evidence validation tooling.

### Commands run
- ./build

### Commands that would be run for deeper verification (not executed)
- ./build --android-tests (instrumentation)
- ./build --smoke-android-emulator
- npm run test:coverage
- npm run test:e2e:ci

### Environment assumptions
- Linux host, Node 18+ or 20, JDK 17, Android SDK installed (per [doc/developer.md](doc/developer.md#L1-L120)).
- Android test validation uses emulator (Pixel-class phone and tablet), plus at least one physical device on a local network.
- Network tests assume a local C64 Ultimate device or mock server.

### Scoring model
Severity scores: S0=100, S1=70, S2=40, S3=15, S4=5. Confidence multiplier: High=1.0, Medium=0.7, Low=0.4. User impact multiplier: High=1.0, Medium=0.7, Low=0.4. Release proximity multiplier: Release-blocking=1.0, Not-blocking=0.7. PriorityScore = SeverityScore × ConfidenceMultiplier × UserImpactMultiplier × ReleaseProximityMultiplier.

## 4. Findings (ranked, evidence-backed)

### Finding F-1001: Device password persisted in plaintext storage
- Category: Security/Privacy
- Severity: S2 Major
- Confidence: High
- Impact: Stored network password can be extracted from app storage (localStorage) on compromised or shared devices, enabling unauthorized device control.
- Evidence:
  - Code references: Password persisted to localStorage in `updateC64APIConfig()` and read at startup in `getC64API()`. [src/lib/c64api.ts](src/lib/c64api.ts#L1120-L1245)
  - Code references: Settings and connection state read password directly from localStorage. [src/hooks/useC64Connection.ts](src/hooks/useC64Connection.ts#L1-L80)
- Reproduction:
  - Preconditions: Device password configured in Settings.
  - Steps: Inspect WebView localStorage for key `c64u_password`.
  - Expected vs actual: Expected secure storage; actual plaintext key/value stored.
- Root cause analysis:
  - The app uses localStorage as a persistence layer for `c64u_password`, with no encryption or secure storage abstraction.
  - localStorage is readable by any code within the WebView and potentially by backup or rooted device tooling.
- Recommended fix (release-practical):
  - Minimal viable fix: Store the password in Android Keystore via a Capacitor plugin and keep only a boolean flag in localStorage.
  - Alternative options: Do not persist the password by default; require user opt-in with a warning.
- Verification plan:
  - Add unit tests for the storage adapter to ensure values are written to the secure store and not localStorage.
  - Manual: Configure password, inspect localStorage keys, verify no `c64u_password` present.
- Effort estimate: M 2-3d
- Dependencies/risks:
  - Requires native plugin changes and migration path for existing users.
- PriorityScore: 40.0

### Finding F-1002: Cleartext traffic enabled for core device interactions
- Category: Security/Privacy
- Severity: S2 Major
- Confidence: High
- Impact: HTTP traffic to the device can be intercepted or modified on local networks, exposing credentials and device control actions.
- Evidence:
  - Code references: Default base URL is http and device host is normalized without TLS. [src/lib/c64api.ts](src/lib/c64api.ts#L1-L40)
  - Android config: `usesCleartextTraffic="true"` allows HTTP. [android/app/src/main/AndroidManifest.xml](android/app/src/main/AndroidManifest.xml#L1-L24)
- Reproduction:
  - Preconditions: Device reachable on local network.
  - Steps: Observe network traffic via proxy/sniffer; requests are plain HTTP.
  - Expected vs actual: Expected TLS or explicit warning; actual HTTP allowed by default.
- Root cause analysis:
  - The device API uses HTTP without an alternate secure transport or explicit user warning.
- Recommended fix (release-practical):
  - Minimal viable fix: Add explicit in-app warning when using HTTP and provide a toggle for future TLS/proxy endpoints.
  - Alternative options: Support HTTPS via proxy bridge and pin certificates when configured.
- Verification plan:
  - Add UI test asserting the warning is displayed when `http://` base URL is active.
  - Manual: Configure device host to HTTPS (if supported) and verify cleartext is disabled.
- Effort estimate: S 0.5-1d
- Dependencies/risks:
  - Depends on device firmware capabilities or proxy availability.
- PriorityScore: 28.0

### Finding F-1003: HVSC archive extraction runs synchronously on the main thread
- Category: Performance
- Severity: S2 Major
- Confidence: High
- Impact: Extracting large 7z/zip archives can block UI rendering, causing stutters, ANRs, or perceived hangs.
- Evidence:
  - Code references: `unzipSync()` and `SevenZip.callMain()` are executed inline without worker offload. [src/lib/hvsc/hvscArchiveExtraction.ts](src/lib/hvsc/hvscArchiveExtraction.ts#L1-L200)
  - Test evidence of archive handling: HVSC tests exercise extraction paths with 7z. [tests/unit/hvsc/hvscArchiveExtraction.test.ts](tests/unit/hvsc/hvscArchiveExtraction.test.ts#L1-L120)
- Reproduction:
  - Preconditions: Large HVSC archive download.
  - Steps: Start HVSC install and observe UI responsiveness during extraction.
  - Expected vs actual: Expected responsive UI with progress; actual risk of blocking event loop.
- Root cause analysis:
  - Extraction and filesystem traversal is done synchronously on the JS thread.
- Recommended fix (release-practical):
  - Minimal viable fix: Move extraction to a Web Worker (web) and native thread (Android) or chunk work via `await` + yielding.
  - Alternative options: Use streaming extraction to reduce memory spikes.
- Verification plan:
  - Add performance test that measures UI responsiveness during extraction.
  - Manual: Profile main thread during HVSC update on a mid-tier Android device.
- Effort estimate: M 2-3d
- Dependencies/risks:
  - Requires worker plumbing and updated progress reporting.
- PriorityScore: 19.6

### Finding F-1004: Android instrumentation tests are not executed in CI
- Category: Testing
- Severity: S2 Major
- Confidence: High
- Impact: Device-only regressions (SAF permissions, file access, native plugins) can ship undetected.
- Evidence:
  - CI Android tests run JVM unit tests only (`testDebugUnitTest`), not `connectedDebugAndroidTest`. [./.github/workflows/android-apk.yaml](.github/workflows/android-apk.yaml#L470-L560)
  - Local build helper defaults `RUN_ANDROID_TESTS=false` unless explicitly requested. [build](build#L380-L470)
- Reproduction:
  - Preconditions: CI pipeline run.
  - Steps: Inspect workflow logs; no instrumentation step executed.
  - Expected vs actual: Expected device/emulator instrumentation for release; actual none.
- Root cause analysis:
  - CI is optimized for JVM tests and packaging only; emulator/device tests are opt-in.
- Recommended fix (release-practical):
  - Minimal viable fix: Add a nightly or pre-release CI job that runs `connectedDebugAndroidTest` on an emulator.
  - Alternative options: Enforce a manual release gate requiring `./build --android-tests` with evidence upload.
- Verification plan:
  - CI: Add a new job and require artifacts for release tags.
  - Manual: Run `./build --android-tests` and confirm passing.
- Effort estimate: S 0.5-1d
- Dependencies/risks:
  - Emulator stability and increased CI time.
- PriorityScore: 28.0

### Finding F-1005: Trace session retains up to 50 MiB in memory
- Category: Performance
- Severity: S3 Minor
- Confidence: High
- Impact: Long sessions can increase memory pressure, particularly on lower-end devices.
- Evidence:
  - Code references: `MAX_STORAGE_BYTES = 50 * 1024 * 1024` and `MAX_EVENT_COUNT = 10_000`. [src/lib/tracing/traceSession.ts](src/lib/tracing/traceSession.ts#L1-L80)
  - Tracing spec confirms always-on tracing with retention limits. [doc/tracing.md](doc/tracing.md#L1-L80)
- Reproduction:
  - Preconditions: Extended user session with high trace volume.
  - Steps: Inspect memory usage and trace buffer size.
  - Expected vs actual: Expected smaller footprint on low-memory devices; actual cap allows 50 MiB.
- Root cause analysis:
  - Retention policy prioritizes trace completeness over memory constraints.
- Recommended fix (release-practical):
  - Minimal viable fix: Add adaptive caps based on device memory class; reduce default to 10–20 MiB.
  - Alternative options: Persist to disk when in developer mode only.
- Verification plan:
  - Add unit test for cap enforcement with smaller limit.
  - Manual: Monitor memory usage after stress actions.
- Effort estimate: S 0.5-1d
- Dependencies/risks:
  - Reduced trace availability for support sessions.
- PriorityScore: 7.35

### Finding F-1008: Android emulator smoke tests (Maestro) are not in CI
- Category: Testing
- Severity: S3 Minor
- Confidence: High
- Impact: Device UI regressions can slip without emulator smoke coverage.
- Evidence:
  - Documentation defines Maestro flows and evidence paths. [doc/developer.md](doc/developer.md#L60-L160)
  - CI workflows do not run Maestro flows. [./.github/workflows/android-apk.yaml](.github/workflows/android-apk.yaml#L1-L200)
- Reproduction:
  - Preconditions: CI run.
  - Steps: Inspect workflow logs; no Maestro invocation.
  - Expected vs actual: Expected emulator smoke run for release; actual none.
- Root cause analysis:
  - Emulator smoke is optional and not part of CI gating.
- Recommended fix (release-practical):
  - Minimal viable fix: Add a nightly Maestro job or gate on release tags.
  - Alternative options: Require manual Maestro run with evidence attached to release checklist.
- Verification plan:
  - CI: Add job and confirm evidence artifacts exist.
  - Manual: Run `maestro test .maestro` and review outputs.
- Effort estimate: S 0.5-1d
- Dependencies/risks:
  - Emulator stability and CI resource cost.
- PriorityScore: 7.35

### Finding F-1009: React tests emit act() warnings in SettingsPage
- Category: Testing
- Severity: S3 Minor
- Confidence: High
- Impact: Warnings indicate tests may not fully capture async updates, risking flaky or false-positive tests.
- Evidence:
  - Build output shows act() warnings in SettingsPage tests. Command log in Appendix.
  - SettingsPage performs async state updates triggered by events (e.g., diagnostics, storage updates). [src/pages/SettingsPage.tsx](src/pages/SettingsPage.tsx#L820-L980)
- Reproduction:
  - Preconditions: Run `npm test` or `./build`.
  - Steps: Observe test output warnings for SettingsPage tests.
  - Expected vs actual: Expected no act warnings; actual warnings present.
- Root cause analysis:
  - Tests trigger state updates outside React testing utilities’ `act()` scope.
- Recommended fix (release-practical):
  - Minimal viable fix: Wrap asynchronous interactions in `act()` and await updates.
  - Alternative options: Use `waitFor` from Testing Library to synchronize.
- Verification plan:
  - Re-run `npm test` and confirm warnings absent.
- Effort estimate: XS < 2h
- Dependencies/risks:
  - None; localized test changes.
- PriorityScore: 4.2

### Finding F-1006: FTP recursive listing lacks cancellation and can be long-running
- Category: Performance
- Severity: S3 Minor
- Confidence: Medium
- Impact: Large FTP trees can cause lengthy operations with no user cancellation, increasing battery use and UI latency.
- Evidence:
  - Code references: `listFilesRecursive()` walks the tree and awaits entries with a fixed concurrency, no cancellation token. [src/lib/sourceNavigation/ftpSourceAdapter.ts](src/lib/sourceNavigation/ftpSourceAdapter.ts#L60-L140)
  - Device safety config provides concurrency limits but no cancel hooks. [src/lib/config/deviceSafetySettings.ts](src/lib/config/deviceSafetySettings.ts#L1-L120)
- Reproduction:
  - Preconditions: Large FTP directory tree.
  - Steps: Trigger recursive listing; observe duration and UI responsiveness.
  - Expected vs actual: Expected cancellable operation; actual non-cancellable traversal.
- Root cause analysis:
  - Recursive listing uses a queue and promises without cancellation or timeouts.
- Recommended fix (release-practical):
  - Minimal viable fix: Add cancellation via `AbortSignal` and propagate from UI.
  - Alternative options: Limit recursion depth or require explicit user confirmation.
- Verification plan:
  - Unit test with mock FTP responses and abort path.
  - Manual: Start recursive listing and cancel from UI.
- Effort estimate: S 0.5-1d
- Dependencies/risks:
  - Requires API changes to FTP list path and UI surfaces.
- PriorityScore: 5.25

### Finding F-1007: Demo/Discovery timeouts are fixed and short for slow networks
- Category: Reliability
- Severity: S3 Minor
- Confidence: Medium
- Impact: Slow networks or device wake cycles may cause false offline detection and demo fallback.
- Evidence:
  - Code references: `PROBE_REQUEST_TIMEOUT_MS = 2500` and startup probe interval 700ms. [src/lib/connection/connectionManager.ts](src/lib/connection/connectionManager.ts#L1-L80)
  - Settings UI allows configuration of discovery windows, but timeouts remain internal constants. [src/pages/SettingsPage.tsx](src/pages/SettingsPage.tsx#L440-L560)
- Reproduction:
  - Preconditions: High latency network or device wake.
  - Steps: Launch app, observe discovery with slow device response.
  - Expected vs actual: Expected longer retry window; actual quick failure path.
- Root cause analysis:
  - Probe timeout is hard-coded, not user-configurable, and may be too aggressive for some environments.
- Recommended fix (release-practical):
  - Minimal viable fix: Tie probe timeout to device safety settings or add a settings slider.
  - Alternative options: Implement exponential backoff before demo fallback.
- Verification plan:
  - Add unit test to verify timeout config is applied.
  - Manual: Simulate delayed responses and verify behavior.
- Effort estimate: S 0.5-1d
- Dependencies/risks:
  - Longer timeouts may delay user feedback if device is truly offline.
- PriorityScore: 5.25

### Finding F-1012: Diagnostic logs may expose hostnames and file paths without redaction
- Category: Observability
- Severity: S3 Minor
- Confidence: Medium
- Impact: Shared logs can include device hostnames and file paths, which may be sensitive in some environments.
- Evidence:
  - Logging stores detailed entries in localStorage and supports sharing. [src/lib/logging.ts](src/lib/logging.ts#L1-L120), [src/pages/SettingsPage.tsx](src/pages/SettingsPage.tsx#L820-L940)
  - FTP errors log host and path details. [src/lib/ftp/ftpClient.ts](src/lib/ftp/ftpClient.ts#L1-L80)
- Reproduction:
  - Preconditions: Trigger FTP error and open Diagnostics logs.
  - Steps: Share logs via diagnostics dialog.
  - Expected vs actual: Expected redacted identifiers; actual raw host/path.
- Root cause analysis:
  - Logging does not apply redaction; only tracing has redaction utilities. [src/lib/tracing/redaction.ts](src/lib/tracing/redaction.ts#L1-L120)
- Recommended fix (release-practical):
  - Minimal viable fix: Add log redaction for hostnames and paths before share/export.
  - Alternative options: Add per-log opt-in for sensitive fields.
- Verification plan:
  - Unit test for redaction helper; manual share to confirm redacted output.
- Effort estimate: S 0.5-1d
- Dependencies/risks:
  - Might reduce support detail if over-redacted.
- PriorityScore: 5.25

### Finding F-1010: Settings documentation mismatches implemented connection UI
- Category: Docs
- Severity: S3 Minor
- Confidence: Medium
- Impact: Users and testers may search for Port/Mock settings that are not present, causing confusion in release readiness.
- Evidence:
  - Docs claim Settings includes “Connection settings (IP, Port, Mock mode)”. [doc/ux-guidelines.md](doc/ux-guidelines.md#L200-L230)
  - SettingsPage UI shows host and password only, plus demo mode and discovery windows. [src/pages/SettingsPage.tsx](src/pages/SettingsPage.tsx#L440-L560)
- Reproduction:
  - Preconditions: Open Settings in app.
  - Steps: Look for port and mock mode controls.
  - Expected vs actual: Expected fields per docs; actual missing.
- Root cause analysis:
  - Documentation drift from UI implementation.
- Recommended fix (release-practical):
  - Minimal viable fix: Update docs to match current UI or implement missing settings.
  - Alternative options: Add FAQ note in README.
- Verification plan:
  - Docs review to confirm text alignment with UI.
- Effort estimate: XS < 2h
- Dependencies/risks:
  - None.
- PriorityScore: 4.2

### Finding F-1011: Privacy policy omits local credential and log storage
- Category: Docs
- Severity: S3 Minor
- Confidence: Medium
- Impact: Privacy disclosures do not reflect stored credentials and diagnostic logs, creating policy misalignment.
- Evidence:
  - Privacy policy states no data is collected or stored. [docs/privacy-policy.md](docs/privacy-policy.md#L1-L40)
  - App stores password and logs in localStorage. [src/lib/c64api.ts](src/lib/c64api.ts#L1120-L1245), [src/lib/logging.ts](src/lib/logging.ts#L1-L80)
- Reproduction:
  - Preconditions: Set password, generate logs.
  - Steps: Inspect localStorage keys `c64u_password` and `c64u_app_logs`.
  - Expected vs actual: Expected no stored data; actual stored values.
- Root cause analysis:
  - Policy does not account for on-device storage of diagnostics and credentials.
- Recommended fix (release-practical):
  - Minimal viable fix: Update privacy policy to describe local storage of device credentials/logs.
  - Alternative options: Reduce or remove persistent storage and align policy.
- Verification plan:
  - Document review and update; confirm with legal/owner.
- Effort estimate: XS < 2h
- Dependencies/risks:
  - Requires policy approval.
- PriorityScore: 4.2

### Category coverage note
- Functional: No evidence of issues found. Inspected core REST/FTP paths and settings logic in [src/lib/c64api.ts](src/lib/c64api.ts#L1-L520), [src/lib/connection/connectionManager.ts](src/lib/connection/connectionManager.ts#L1-L200), and [src/pages/SettingsPage.tsx](src/pages/SettingsPage.tsx#L440-L1040).
- Compatibility: No evidence of issues found beyond normal constraints; minSdk/targetSdk defined in [android/variables.gradle](android/variables.gradle#L1-L20) and build config in [android/app/build.gradle](android/app/build.gradle#L1-L140).

## 5. Test and quality gate assessment
### Test inventory and where it runs
| Suite | Scope | How to run | CI coverage | Evidence |
| --- | --- | --- | --- | --- |
| Unit (Vitest) | Web logic/components | npm run test | Yes | [package.json](package.json#L1-L80), [.github/workflows/android-apk.yaml](.github/workflows/android-apk.yaml#L1-L120) |
| E2E (Playwright) | Web UI flows | npm run test:e2e | Yes (sharded) | [playwright.config.ts](playwright.config.ts#L1-L120), [.github/workflows/android-apk.yaml](.github/workflows/android-apk.yaml#L200-L360) |
| Web coverage | Unit + E2E | npm run test:coverage + coverage merge | Yes (threshold enforced) | [.github/workflows/android-apk.yaml](.github/workflows/android-apk.yaml#L320-L410) |
| Android JVM tests | Native Kotlin/Java unit tests | ./gradlew testDebugUnitTest | Yes | [.github/workflows/android-apk.yaml](.github/workflows/android-apk.yaml#L470-L520) |
| Android instrumentation | On-device UI/native | ./build --android-tests | No (manual) | [build](build#L380-L470), [doc/developer.md](doc/developer.md#L80-L160) |
| Maestro smoke flows | Emulator UI smoke | maestro test .maestro | No (manual) | [doc/developer.md](doc/developer.md#L120-L200) |
| Chaos/fuzz | Web UI chaos | npm run fuzz | No (manual) | [package.json](package.json#L1-L80), [doc/developer.md](doc/developer.md#L1-L120) |

### Coverage gaps (concrete, evidence-backed)
1. Android instrumentation tests are not part of CI gating. Evidence: [.github/workflows/android-apk.yaml](.github/workflows/android-apk.yaml#L470-L560), [build](build#L380-L470)
2. Maestro emulator smoke flows are documented but not executed in CI. Evidence: [doc/developer.md](doc/developer.md#L120-L200), [.github/workflows/android-apk.yaml](.github/workflows/android-apk.yaml#L1-L200)
3. Device/SAF behavior is validated only in manual flows; no automated instrumentation coverage. Evidence: [doc/developer.md](doc/developer.md#L120-L200), [src/lib/sourceNavigation/localSourceAdapter.ts](src/lib/sourceNavigation/localSourceAdapter.ts#L1-L200)
4. Real-device network paths are primarily mocked for E2E tests. Evidence: [playwright/mockHvscServer.ts](playwright/mockHvscServer.ts#L1-L120), [playwright.config.ts](playwright.config.ts#L1-L120)
5. Test warnings indicate at least one test suite does not fully synchronize async updates (act warnings). Evidence: Appendix command log; [src/pages/SettingsPage.tsx](src/pages/SettingsPage.tsx#L820-L980)

### Golden trace approach
- What it covers: semantic user action traces with normalization and golden comparisons. Evidence: [playwright/traceComparison.js](playwright/traceComparison.js#L1-L220), [scripts/compare-traces.mjs](scripts/compare-traces.mjs#L1-L120)
- What it cannot cover: device-native code, true network latency, emulator-only behaviors.
- Failure modes: normalization gaps, overfitting to golden traces, flakiness with timing changes. Evidence: normalization rules in [playwright/traceComparison.js](playwright/traceComparison.js#L1-L200)

### Release Quality Gate checklist
| Gate | How to measure | Status | Evidence |
| --- | --- | --- | --- |
| Web unit tests pass | npm run test | PASS (local ./build) | Appendix command log; [build](build#L380-L440) |
| Web E2E tests pass | npm run test:e2e | PASS (local ./build) | Appendix command log; [build](build#L380-L440) |
| Web coverage threshold >= 80% | check-coverage-threshold.mjs | UNKNOWN (not run locally) | [.github/workflows/android-apk.yaml](.github/workflows/android-apk.yaml#L320-L410) |
| Android JVM tests pass | ./gradlew testDebugUnitTest | PASS (local ./build) | Appendix command log; [build](build#L380-L440) |
| Android instrumentation tests | connectedDebugAndroidTest | UNKNOWN (not run) | [build](build#L380-L470) |
| Android APK build | ./gradlew assembleDebug | PASS (local ./build) | Appendix command log; [build](build#L470-L520) |
| Trace evidence validation | npm run validate:evidence | UNKNOWN (not run locally) | [.github/workflows/android-apk.yaml](.github/workflows/android-apk.yaml#L320-L380) |

## 6. Performance and reliability deep dive
### Main-thread risks
- HVSC extraction uses synchronous zip/7z operations on JS thread. Evidence: [src/lib/hvsc/hvscArchiveExtraction.ts](src/lib/hvsc/hvscArchiveExtraction.ts#L1-L200)
- Trace session can accumulate 50 MiB of data in memory. Evidence: [src/lib/tracing/traceSession.ts](src/lib/tracing/traceSession.ts#L1-L80)
- FTP recursive listing can run long without cancellation. Evidence: [src/lib/sourceNavigation/ftpSourceAdapter.ts](src/lib/sourceNavigation/ftpSourceAdapter.ts#L60-L140)

### I/O hotspots and buffering
- REST calls use fixed timeouts (3–5s) and log per-request latency. Evidence: [src/lib/c64api.ts](src/lib/c64api.ts#L240-L520)
- FTP list uses localStorage cache with TTL and max entries. Evidence: [src/lib/sourceNavigation/ftpSourceAdapter.ts](src/lib/sourceNavigation/ftpSourceAdapter.ts#L1-L140)
- Device safety uses caching/cooldown and circuit breakers to reduce load. Evidence: [src/lib/deviceInteraction/deviceInteractionManager.ts](src/lib/deviceInteraction/deviceInteractionManager.ts#L1-L200), [src/lib/config/deviceSafetySettings.ts](src/lib/config/deviceSafetySettings.ts#L1-L120)

### Retry/backoff/timeouts/cancellation
- Backoff and circuit breaker logic exist for REST/FTP with configurable settings. Evidence: [src/lib/deviceInteraction/deviceInteractionManager.ts](src/lib/deviceInteraction/deviceInteractionManager.ts#L1-L200), [src/lib/config/deviceSafetySettings.ts](src/lib/config/deviceSafetySettings.ts#L1-L120)
- REST requests use fixed timeout values and translate network failures into host-unreachable errors. Evidence: [src/lib/c64api.ts](src/lib/c64api.ts#L240-L520)
- FTP recursive listing lacks cancellation/timeout. Evidence: [src/lib/sourceNavigation/ftpSourceAdapter.ts](src/lib/sourceNavigation/ftpSourceAdapter.ts#L60-L140)

### Memory pressure areas
- Trace buffer max size 50 MiB. Evidence: [src/lib/tracing/traceSession.ts](src/lib/tracing/traceSession.ts#L1-L80)
- 7z wasm extraction loads entire archive into memory and FS. Evidence: [src/lib/hvsc/hvscArchiveExtraction.ts](src/lib/hvsc/hvscArchiveExtraction.ts#L40-L140)

### Startup time risks
- Discovery probes run with short timeout and frequent polling. Evidence: [src/lib/connection/connectionManager.ts](src/lib/connection/connectionManager.ts#L1-L80)

### Instrumentation suggestions (tied to repo)
1. Add timing spans around HVSC extraction phases (`getSevenZipModule`, `callMain`, per-file read). Location: [src/lib/hvsc/hvscArchiveExtraction.ts](src/lib/hvsc/hvscArchiveExtraction.ts#L20-L160)
2. Emit per-request queue wait time in device interaction scheduler (REST/FTP). Location: [src/lib/deviceInteraction/deviceInteractionManager.ts](src/lib/deviceInteraction/deviceInteractionManager.ts#L1-L120)
3. Add cancellation telemetry for FTP recursion and log elapsed time. Location: [src/lib/sourceNavigation/ftpSourceAdapter.ts](src/lib/sourceNavigation/ftpSourceAdapter.ts#L60-L140)

## 7. Configurability and supportability audit
### Settings inventory (discovered)
| Setting | Storage key / location | Default | UI surface | Evidence |
| --- | --- | --- | --- | --- |
| Device host | c64u_device_host | c64u | Settings → Connection | [src/lib/c64api.ts](src/lib/c64api.ts#L1-L120), [src/pages/SettingsPage.tsx](src/pages/SettingsPage.tsx#L440-L520) |
| Network password | c64u_password | empty | Settings → Connection | [src/lib/c64api.ts](src/lib/c64api.ts#L1120-L1245), [src/pages/SettingsPage.tsx](src/pages/SettingsPage.tsx#L460-L520) |
| Automatic demo mode | c64u_automatic_demo_mode_enabled | true | Settings → Connection | [src/lib/config/appSettings.ts](src/lib/config/appSettings.ts#L1-L120), [src/pages/SettingsPage.tsx](src/pages/SettingsPage.tsx#L480-L520) |
| Startup discovery window | c64u_startup_discovery_window_ms | 3000 | Settings → Connection | [src/lib/config/appSettings.ts](src/lib/config/appSettings.ts#L1-L120), [src/pages/SettingsPage.tsx](src/pages/SettingsPage.tsx#L510-L540) |
| Background rediscovery interval | c64u_background_rediscovery_interval_ms | 5000 | Settings → Connection | [src/lib/config/appSettings.ts](src/lib/config/appSettings.ts#L1-L140), [src/pages/SettingsPage.tsx](src/pages/SettingsPage.tsx#L530-L560) |
| Device safety mode | c64u_device_safety_mode | BALANCED | Settings → Device Safety | [src/lib/config/deviceSafetySettings.ts](src/lib/config/deviceSafetySettings.ts#L1-L120), [src/pages/SettingsPage.tsx](src/pages/SettingsPage.tsx#L586-L680) |
| REST/FTP concurrency | c64u_device_safety_* | Mode defaults | Settings → Device Safety | [src/lib/config/deviceSafetySettings.ts](src/lib/config/deviceSafetySettings.ts#L1-L120), [src/pages/SettingsPage.tsx](src/pages/SettingsPage.tsx#L640-L760) |
| Backoff/circuit settings | c64u_device_safety_* | Mode defaults | Settings → Device Safety | [src/lib/config/deviceSafetySettings.ts](src/lib/config/deviceSafetySettings.ts#L1-L160), [src/pages/SettingsPage.tsx](src/pages/SettingsPage.tsx#L700-L860) |
| Allow user override circuit | c64u_device_safety_allow_user_override_circuit | true | Settings → Device Safety | [src/lib/config/deviceSafetySettings.ts](src/lib/config/deviceSafetySettings.ts#L1-L160), [src/pages/SettingsPage.tsx](src/pages/SettingsPage.tsx#L820-L860) |
| Debug logging | c64u_debug_logging_enabled | false | Settings → Diagnostics | [src/lib/config/appSettings.ts](src/lib/config/appSettings.ts#L1-L80), [src/pages/SettingsPage.tsx](src/pages/SettingsPage.tsx#L840-L900) |
| Config write spacing | c64u_config_write_min_interval_ms | 500 ms | Settings → Diagnostics | [src/lib/config/appSettings.ts](src/lib/config/appSettings.ts#L1-L80), [src/pages/SettingsPage.tsx](src/pages/SettingsPage.tsx#L900-L960) |
| List preview limit | c64u_list_preview_limit | 50 | Settings → Play and Disk | [src/lib/uiPreferences.ts](src/lib/uiPreferences.ts#L1-L60), [src/pages/SettingsPage.tsx](src/pages/SettingsPage.tsx#L980-L1040) |
| Disk autostart mode | c64u_disk_autostart_mode | kernal | Settings → Play and Disk | [src/lib/config/appSettings.ts](src/lib/config/appSettings.ts#L1-L160), [src/pages/SettingsPage.tsx](src/pages/SettingsPage.tsx#L1010-L1040) |
| Theme | c64u_theme | system | Settings → Appearance | [src/hooks/useTheme.ts](src/hooks/useTheme.ts#L1-L80), [src/pages/SettingsPage.tsx](src/pages/SettingsPage.tsx#L940-L1010) |
| FTP port | c64u_ftp_port | 21 | Not surfaced in Settings | [src/lib/ftp/ftpConfig.ts](src/lib/ftp/ftpConfig.ts#L1-L80) |
| FTP bridge URL | c64u_ftp_bridge_url | empty | Not surfaced in Settings | [src/lib/ftp/ftpConfig.ts](src/lib/ftp/ftpConfig.ts#L1-L80) |
| HVSC feature flag | hvsc_enabled | true | Settings → HVSC Library | [src/hooks/useFeatureFlags.tsx](src/hooks/useFeatureFlags.tsx#L1-L80), [src/lib/config/featureFlags.ts](src/lib/config/featureFlags.ts#L1-L80), [src/pages/SettingsPage.tsx](src/pages/SettingsPage.tsx#L1110-L1170) |

### Gaps in safe defaults and workarounds
- Credential persistence has no opt-out or encryption (see F-1001).
- FTP port/bridge settings exist but are not exposed to users, limiting troubleshooting. Evidence: [src/lib/ftp/ftpConfig.ts](src/lib/ftp/ftpConfig.ts#L1-L80)
- No explicit safe mode toggle for diagnostics (log redaction is manual). Evidence: [src/lib/logging.ts](src/lib/logging.ts#L1-L120)

### Targeted improvements (ranked by release value)
1. Secure password storage (high risk reduction) — see F-1001.
2. Add Android instrumentation or Maestro smoke gate (release quality) — see F-1004/F-1008.
3. Worker offload for HVSC extraction (performance). Evidence: [src/lib/hvsc/hvscArchiveExtraction.ts](src/lib/hvsc/hvscArchiveExtraction.ts#L1-L200)
4. Expose FTP port/bridge settings in UI or add diagnostics guidance. Evidence: [src/lib/ftp/ftpConfig.ts](src/lib/ftp/ftpConfig.ts#L1-L80)
5. Add cancellation UI for long FTP operations. Evidence: [src/lib/sourceNavigation/ftpSourceAdapter.ts](src/lib/sourceNavigation/ftpSourceAdapter.ts#L60-L140)
6. Add configurable probe timeout to reduce false offline. Evidence: [src/lib/connection/connectionManager.ts](src/lib/connection/connectionManager.ts#L1-L80)
7. Add log redaction before sharing diagnostics. Evidence: [src/lib/logging.ts](src/lib/logging.ts#L1-L120)
8. Add settings export/import for support. Evidence: [src/lib/config/appSettings.ts](src/lib/config/appSettings.ts#L1-L160)
9. Add user-facing warning when switching to Relaxed safety mode. Evidence: [src/pages/SettingsPage.tsx](src/pages/SettingsPage.tsx#L600-L660)
10. Add a “Troubleshooting mode” preset to reduce retries and logs. Evidence: [src/lib/config/deviceSafetySettings.ts](src/lib/config/deviceSafetySettings.ts#L1-L120)

## 8. Documentation audit
### Identified doc issues (>=5)
1. Settings doc lists Port/Mock mode controls not present in current UI. Evidence: [doc/ux-guidelines.md](doc/ux-guidelines.md#L200-L230), [src/pages/SettingsPage.tsx](src/pages/SettingsPage.tsx#L440-L560)
2. Privacy policy omits on-device storage of credentials and logs. Evidence: [docs/privacy-policy.md](docs/privacy-policy.md#L1-L40), [src/lib/c64api.ts](src/lib/c64api.ts#L1120-L1245), [src/lib/logging.ts](src/lib/logging.ts#L1-L80)
3. README does not mention cleartext HTTP requirement or risk, despite manifest enabling it. Evidence: [README.md](README.md#L1-L80), [android/app/src/main/AndroidManifest.xml](android/app/src/main/AndroidManifest.xml#L1-L24)
4. Developer docs do not mention FTP bridge settings, despite runtime support. Evidence: [doc/developer.md](doc/developer.md#L1-L120), [src/lib/ftp/ftpConfig.ts](src/lib/ftp/ftpConfig.ts#L1-L80)
5. Troubleshooting docs do not document log redaction or sensitive fields in exports. Evidence: [doc/tracing.md](doc/tracing.md#L1-L80), [src/lib/logging.ts](src/lib/logging.ts#L1-L120)

### Precise edit recommendations
- README.md: Add a note under network setup about cleartext HTTP and local network expectation.
- docs/privacy-policy.md: Add a sentence describing local storage of device credentials and diagnostics logs.
- doc/ux-guidelines.md: Update Settings page bullet to match actual fields (host/password/demo mode).
- doc/developer.md: Add FTP bridge/port troubleshooting note.
- doc/tracing.md: Add a warning on log exports and recommend redaction.

## 9. Release readiness roadmap (next actions)
### Prioritized backlog (sorted by PriorityScore)
| Item | Category | Severity | Confidence | Effort | PriorityScore | Risk reduction rationale | Suggested owner |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Secure password storage (Keystore or no persistence) | Security/Privacy | S2 | High | M | 40.0 | Eliminates plaintext credential exposure | Android |
| Cleartext HTTP warning or secure transport option | Security/Privacy | S2 | High | S | 28.0 | Mitigates MITM/local network risk | Android/Backend |
| Add Android instrumentation CI gate | Testing | S2 | High | S | 28.0 | Catches device-only regressions before release | QA/Android |
| Move HVSC extraction off main thread | Performance | S2 | High | M | 19.6 | Prevents UI stalls during large archive handling | Android/Web |
| Reduce trace buffer memory cap | Performance | S3 | High | S | 7.35 | Lowers memory pressure risk | Android/Web |
| Add Maestro smoke CI or release gate | Testing | S3 | High | S | 7.35 | Ensures emulator UI sanity | QA |
| Add redaction to shared logs | Observability | S3 | Medium | S | 5.25 | Prevents leaking host/path in diagnostics | Web |
| Add FTP recursive cancellation | Performance | S3 | Medium | S | 5.25 | Improves responsiveness on large trees | Web |
| Make discovery probe timeout configurable | Reliability | S3 | Medium | S | 5.25 | Reduces false offline/demo fallback | Web |
| Fix act() warnings in tests | Testing | S3 | High | XS | 4.2 | Improves test fidelity | Web |

### 72-hour release hardening plan
1. Implement secure password storage or disable persistence (F-1001).
2. Add cleartext HTTP warning + docs update (F-1002, doc updates).
3. Run Android instrumentation tests manually and archive evidence; decide on CI gating.
4. Fix SettingsPage test warnings and re-run unit tests.

### 2-week stabilization plan
1. Add emulator-based instrumentation/maestro job in CI.
2. Worker offload for HVSC extraction + progress/cancel UX.
3. Add cancellation support for FTP recursion and timeout tuning.
4. Reduce trace buffer size with memory-class adaptive policy.
5. Update privacy and developer documentation with storage/transport details.

## 10. Appendix
### Command log
- ./build (full output captured in this audit session)

### Most relevant inspected files
- [src/lib/c64api.ts](src/lib/c64api.ts)
- [src/lib/connection/connectionManager.ts](src/lib/connection/connectionManager.ts)
- [src/lib/deviceInteraction/deviceInteractionManager.ts](src/lib/deviceInteraction/deviceInteractionManager.ts)
- [src/lib/config/deviceSafetySettings.ts](src/lib/config/deviceSafetySettings.ts)
- [src/lib/config/appSettings.ts](src/lib/config/appSettings.ts)
- [src/pages/SettingsPage.tsx](src/pages/SettingsPage.tsx)
- [src/lib/hvsc/hvscArchiveExtraction.ts](src/lib/hvsc/hvscArchiveExtraction.ts)
- [src/lib/tracing/traceSession.ts](src/lib/tracing/traceSession.ts)
- [src/lib/logging.ts](src/lib/logging.ts)
- [android/app/build.gradle](android/app/build.gradle)
- [android/variables.gradle](android/variables.gradle)
- [android/app/src/main/AndroidManifest.xml](android/app/src/main/AndroidManifest.xml)
- [.github/workflows/android-apk.yaml](.github/workflows/android-apk.yaml)
- [doc/developer.md](doc/developer.md)
- [doc/ux-guidelines.md](doc/ux-guidelines.md)
- [docs/privacy-policy.md](docs/privacy-policy.md)
- [doc/tracing.md](doc/tracing.md)
- [playwright/traceComparison.js](playwright/traceComparison.js)
- [scripts/compare-traces.mjs](scripts/compare-traces.mjs)

### Glossary of app-specific terms
- C64U: Commodore 64 Ultimate device.
- HVSC: High Voltage SID Collection archive used for SID playback.
- SAF: Android Storage Access Framework.
- Demo Mode: Mock device mode used when hardware is unavailable.
- Trace session: Structured diagnostic event stream for user actions and device interactions.
