# Review 7: Production Hardening Audit

## Executive Summary

The repository shows a deliberate production-hardening posture across runtime code, diagnostics, CI, and test breadth. The strongest evidence is in the guarded REST lane in `src/lib/deviceInteraction/deviceInteractionManager.ts`, the structured trace/log/export stack under `src/lib/tracing/` and `src/lib/diagnostics/`, and the Android workflow’s merged coverage and evidence gates in `.github/workflows/android.yaml`.

The audit did not find a single blocking architecture flaw in the shared TypeScript runtime. The most important issues are seam and governance issues:

- Slider propagation during drag exists and is intentional, but the repository still lacks a narrow regression proof that the full stack continues emitting downstream device updates while the drag is in progress.
- Connection freshness is surfaced with misleading wording. `src/components/ConnectivityIndicator.tsx` combines probe activity and device request activity, then labels the result `Last request`, while `src/components/ConnectionController.tsx` only schedules background rediscovery when the app is in demo or offline states.
- Coverage enforcement is inconsistent across repo surfaces. CI and `scripts/check-coverage-threshold.mjs` enforce 91% line and branch coverage, but `docs/code-coverage.md` still documents 90%, and the local `./build --coverage` path still invokes the threshold script with `COVERAGE_MIN=90`.
- Android and web are materially better hardened than iOS. iOS has active CI and native validation, but its FTP bridge surface is thinner, less observable, and less directly tested than Android.

Based on current repository evidence, Android and self-hosted web appear conditionally production-ready for trusted-LAN deployment. Uniform all-platform production readiness is not yet demonstrated.

## Architecture Analysis

The runtime is a shared React 18 + Vite + Capacitor application with route-level lazy loading in `src/App.tsx` and deferred bootstrap work in `src/main.tsx`. Major state and control planes are separated as follows:

- UI and routing: `src/pages/`, `src/components/`, `src/App.tsx`
- Query-backed device data: `src/hooks/useC64Connection.ts` and related hooks
- Device transport: `src/lib/c64api.ts`, `src/lib/deviceInteraction/`, `src/lib/ftp/`, `src/lib/native/`
- Connection lifecycle: `src/lib/connection/connectionManager.ts`, `src/components/ConnectionController.tsx`
- Diagnostics and tracing: `src/lib/logging.ts`, `src/lib/tracing/`, `src/lib/diagnostics/`
- Native integration: `android/app/src/main/java/uk/gleissner/c64commander/`, `ios/App/App/`
- Web deployment runtime: `web/server/src/`

State ownership is mostly explicit:

- Connection lifecycle state lives in `src/lib/connection/connectionManager.ts` and is consumed through `useConnectionState` and `useC64Connection`.
- Device-request state lives in `src/lib/deviceInteraction/deviceStateStore.ts`.
- Diagnostics buffers live locally in logs and trace session stores and are projected into action summaries.
- Playback state and volume override behavior are layered in `src/pages/playFiles/` hooks and reducers rather than mixed into the core transport code.

The main architectural risk is not lack of structure. It is the number of runtime boundaries: browser, web-server proxy, Android native plugins, iOS native plugins, Playwright probes, Maestro flows, Python agents, and c64scope all depend on overlapping contracts.

Critical dependency sketch:

- App startup and route availability depend on `src/main.tsx`, `src/App.tsx`, `src/components/ConnectionController.tsx`
- Live device control depends on `src/lib/c64api.ts`, `src/lib/deviceInteraction/deviceInteractionManager.ts`, `src/lib/connection/connectionManager.ts`
- Diagnostics credibility depends on `src/lib/tracing/traceSession.ts`, `src/lib/diagnostics/actionSummaries.ts`, `src/lib/diagnostics/diagnosticsExport.ts`
- Web deployment depends on `web/server/src/index.ts`, `web/server/src/staticAssets.ts`, `web/server/src/hostValidation.ts`

## Subsystem Deep Dives

### UI Event Propagation

The maintainer signal about slider propagation is supported by code evidence. The UI slider wrapper and slider behavior utilities expose continuous drag handling, not release-only handling:

- `src/components/ui/slider.tsx` exposes `onValueChange`, `onValueChangeAsync`, and commit callbacks.
- `src/lib/ui/sliderBehavior.ts` provides the throttled async queue used during movement.
- `src/lib/ui/sliderDeviceAdapter.ts` updates local UI synchronously and coalesces device writes via microtask scheduling.
- `src/pages/playFiles/hooks/useVolumeOverride.ts` and `src/pages/playFiles/components/VolumeControls.tsx` add higher-level preview and commit semantics for playback volume.

This means the drag pipeline is intentionally incremental. The remaining risk is proof, not implementation intent. The existing tests cover slider utilities and volume behavior, but the repository still lacks a deterministic test that asserts repeated downstream device writes occur before pointer release after all pacing layers are applied.

### Device Communication

REST communication is comparatively mature:

- `src/lib/c64api.ts` centralizes base URL, password, request IDs, timeouts, retryable SID upload handling, read dedupe, and malformed-response handling.
- `src/lib/deviceInteraction/deviceInteractionManager.ts` serializes REST writes through a single lane, applies cooldowns for machine control and config mutation, maintains cache and circuit-breaker state, and records device-guard trace events.
- `src/lib/query/c64PollingGovernance.ts` centralizes minimum refresh pacing and background rediscovery backoff.

FTP handling is platform-dependent:

- Web: `src/lib/native/ftpClient.web.ts` uses a 5-second request timeout and up to 3 retry attempts against the web bridge.
- Android: `android/app/src/main/java/uk/gleissner/c64commander/FtpClientPlugin.kt` runs on a single-thread executor, but it does apply connect, socket, and data timeouts and logs failures.
- iOS: `ios/App/App/IOSFtp.swift` uses a serial queue and an internal 30-second deadline in its stream loops.

The cross-platform contract is uneven. `src/lib/native/ftpClient.ts` defines `timeoutMs` and `traceContext` options, Android consumes timeout information and trace context, but the iOS bridge ignores both request-level timeout configuration and trace context input. That is a real platform drift risk for observability and tuning.

Write consistency is guarded better on REST than on FTP. REST writes are single-lane and invalidation-aware. FTP operations are per-platform and do not share the same central guardrail layer.

### Connection Liveness

Connection lifecycle handling is explicit and understandable:

- `src/lib/connection/connectionManager.ts` owns the connection state machine and distinguishes startup, manual, settings-triggered, and background discovery.
- `src/components/ConnectionController.tsx` schedules background rediscovery only when the state is `DEMO_ACTIVE` or `OFFLINE_NO_DEMO`.
- `src/hooks/useC64Connection.ts` only fetches `/v1/info` while connected or in demo mode and rate-limits forced refreshes.

The liveness signal is therefore asymmetric:

- On startup/manual/settings changes, the app actively probes until it decides real, demo, or offline.
- Once a real device is connected, there is no standing background probe loop to keep a freshness clock current.

That matters because `src/components/ConnectivityIndicator.tsx` computes `lastObservedRequestAt` from both `deviceState.lastRequestAtMs` and `snapshot.lastProbeAtMs`, then labels it `Last request`. The value is not strictly a last request, and quiet but healthy connected sessions will naturally show old timestamps because background probing stops in that state.

The code is internally consistent, but the UI wording is misleading for operators.

### Diagnostics and Tracing

Diagnostics are one of the strongest subsystems in the repository:

- `src/lib/tracing/traceSession.ts` defines append-only trace storage and event capture.
- `docs/diagnostics/tracing-spec.md` is specific and aligned with the implementation goals.
- `src/lib/diagnostics/actionSummaries.ts` projects traces into operator-facing summaries instead of treating summaries as the source of truth.
- `src/lib/diagnostics/diagnosticsExport.ts` exports zipped JSON payloads by tab or as a combined bundle.
- `src/lib/diagnostics/webServerLogs.ts` polls web-server logs into the app every 5 seconds.

Diagnostics remain usable in degraded device/network situations because they are stored and exported locally from app-side state. The main gap is not exportability; it is semantic precision in what the connection UI claims about freshness.

### Platform Integrations

Platform integration coverage is uneven but transparent:

- Android has multiple plugin tests under `android/app/src/test/java/uk/gleissner/c64commander/`, including `FtpClientPluginTest.kt`, diagnostics bridge tests, secure storage tests, and background execution tests.
- iOS native validation exists under `ios/native-tests/`, but the tests cover host validation, path sanitization, and FTP path resolution rather than the live `FtpClientPlugin` behavior in `ios/App/App/IOSFtp.swift`.
- The web server enforces host validation and session handling in `web/server/src/index.ts` and `web/server/src/hostValidation.ts`.

The biggest platform-specific production risk is therefore not Android. It is iOS parity around FTP behavior, tuning, and observability.

## Documentation Consistency Audit

The canonical docs are generally useful and current, especially `README.md`, `docs/architecture.md`, `docs/developer.md`, `docs/c64/c64u-rest-api.md`, and `docs/c64/c64u-ftp.md`. The following consistency issues were verified:

1. Coverage thresholds are documented inconsistently.
	- `docs/code-coverage.md` still states 90% line and branch enforcement.
	- `docs/developer.md`, `.github/workflows/android.yaml`, `scripts/check-coverage-threshold.mjs`, and `scripts/collect-coverage.sh` enforce or document 91%.
	- The local `build` helper still runs coverage enforcement with `COVERAGE_MIN=90`.

2. Trusted-LAN and insecure-transport assumptions are documented consistently.
	- `README.md` explicitly states that REST remains HTTP and file operations remain plain FTP because of firmware behavior.
	- `README.md` also correctly warns against exposing the web deployment directly to the public internet.

3. Platform rollout language is mostly aligned, but parity should not be overstated.
	- `README.md` clearly scopes iOS to SideStore/sideload distribution.
	- The repo evidence still shows Android receiving stronger native test coverage and stronger operational gates.

4. Historical research documents remain present and useful, but they contain stale threshold values and prior-state conclusions.
	- This is acceptable as history, but it increases the need to keep canonical docs precise.

The most concrete documentation fix is to reconcile the 90/91 coverage story across `docs/code-coverage.md`, `build`, and any related prompts or helper docs.

## Test Coverage Evaluation

The repository has unusually broad test coverage for its size and runtime count.

Observed suites include:

- 247 `tests/**/*.test.ts` files surfaced from the workspace search, covering connection, c64api, device interaction, tracing, diagnostics, HVSC, startup, web server, and more.
- 34 in-source `.test.ts` files and 5 in-source `.test.tsx` files.
- 41 Playwright specs under `playwright/`.
- 16 Android JVM test files under `android/app/src/test/java/uk/gleissner/c64commander/`.
- 3 iOS native validation test files under `ios/native-tests/Tests/NativeValidationTests/`.
- 9 Python agent tests under `agents/tests/`.

High-risk flows with explicit regression evidence:

- Connection state machine: `tests/unit/connection/connectionManager.test.ts`
- Hook-level connection behavior: `tests/unit/hooks/useC64Connection.test.ts`
- REST API client behavior: `tests/unit/c64api.test.ts`, `tests/unit/c64api.branches.test.ts`, `tests/unit/c64apiSidUpload.test.ts`
- Device interaction scheduling and circuit behavior: `tests/unit/lib/deviceInteraction/deviceInteractionManager.test.ts`
- Slider and pacing primitives: `tests/unit/ui/sliderDeviceAdapter.test.ts`, `tests/unit/lib/ui/sliderBehavior.test.ts`, `src/components/ui/slider.test.tsx`
- Playback/volume flows: `playwright/audioMixer.spec.ts`, `playwright/playback.spec.ts`, `playwright/playback.part2.spec.ts`
- Diagnostics export and summaries: `tests/unit/lib/diagnostics/diagnosticsExport.test.ts`, `tests/unit/diagnostics/actionSummariesGolden.test.ts`, `playwright/homeDiagnosticsOverlay.spec.ts`
- Web server behavior: `tests/unit/web/webServer.test.ts`

Blind spots that still matter:

1. No narrow regression asserts that a drag gesture continues to produce downstream device writes before commit across the full pacing stack.
2. No narrow regression locks in the intended meaning of connection freshness during long-idle but healthy real-device sessions.
3. iOS FTP plugin behavior is not covered by equivalent native tests, despite Android having direct plugin tests.

Coverage enforcement posture is strong but inconsistent:

- CI and the threshold script enforce 91% lines and 91% branches.
- `scripts/collect-coverage.sh` uses 91/91.
- The local `build` helper still uses 90 for coverage mode.

That inconsistency weakens confidence in local reproduction of CI outcomes.

## CI/CD Evaluation

CI/CD is materially stronger than average and covers the major surfaces:

- `.github/workflows/android.yaml` runs notice drift checks, unit coverage, screenshot generation, sharded Playwright runs, merged LCOV verification, 91% coverage enforcement, Android tests, and artifact uploads.
- `.github/workflows/web.yaml` builds and tests multi-arch Docker images, runs health checks, runs a focused web-platform Playwright auth test, and publishes GHCR images on tags.
- `.github/workflows/ios.yaml` builds the prepared iOS workspace, runs Swift native tests, exports Swift lcov, and supports a rollout-stage model where iOS jobs are informative by default and become blocking later.
- `.github/workflows/fuzz.yaml` runs scheduled and manual fuzz jobs with telemetry capture.

Strengths:

- Playwright evidence validation is explicit.
- Coverage artifacts are merged and verified before threshold enforcement.
- Web Docker smoke tests include health endpoint validation.
- Release tag format and package version alignment are enforced in web publish.

Weaknesses:

1. Coverage threshold governance is split between CI, scripts, docs, and the local build helper, and they do not currently agree.
2. iOS gating is intentionally softer than Android because rollout stage A is informative by default.
3. No dedicated repository-local workflow was found for dependency vulnerability scanning or secret scanning.

## Security Evaluation

Security posture is appropriate for the documented trusted-LAN model, with important limitations that are mostly explicit.

Positive controls confirmed in code:

- Native password storage goes through `src/lib/secureStorage.ts` and platform secure-storage plugins; local storage only keeps a presence flag.
- The web runtime uses authenticated sessions and login throttling in `web/server/src/index.ts`.
- `web/server/src/hostValidation.ts` rejects malformed hosts and constrains insecure-trust logic to local/private/trusted hosts by default.
- The README clearly warns that the product follows the firmware’s HTTP and plain-FTP model and should not be exposed directly to the public internet.

Material risks confirmed in code:

1. Web deployment persists the network password in `/config/web-config.json` through `web/server/src/index.ts`. This is convenient and documented, but it is still plaintext secret-at-rest in the mounted config volume.
2. The product does not add transport-layer encryption over the firmware’s REST and FTP protocols. This is documented and acceptable only within the trusted-LAN boundary.
3. The optional secure-cookie flag on web sessions depends on environment (`WEB_COOKIE_SECURE` or production mode), so reverse-proxy deployment discipline matters.

No silent-exception defect was found in the current `web/server/src/staticAssets.ts`; non-`ENOENT` failures are logged before returning a 500.

## Production Risk Assessment

| Risk | Evidence | Severity | Likelihood | Detectability | Assessment |
| --- | --- | --- | --- | --- | --- |
| Connection freshness wording is misleading | `src/components/ConnectivityIndicator.tsx`, `src/components/ConnectionController.tsx` | Medium | High | Medium | Quiet healthy sessions can look stale because the UI label and sampling model do not match. |
| Coverage governance is inconsistent | `docs/code-coverage.md`, `docs/developer.md`, `scripts/check-coverage-threshold.mjs`, `build`, `.github/workflows/android.yaml` | Medium | High | High | Local reproduction can disagree with CI because thresholds are not uniformly configured. |
| Slider drag semantics lack end-to-end regression proof | `src/lib/ui/sliderBehavior.ts`, `src/lib/ui/sliderDeviceAdapter.ts`, `src/pages/playFiles/hooks/useVolumeOverride.ts`, current tests | Medium | Medium | Medium | The implementation exists, but a future pacing change could regress it without a focused test. |
| iOS FTP bridge parity is weaker than Android | `ios/App/App/IOSFtp.swift`, Android plugin tests, iOS native-tests inventory | Medium | Medium | Medium | iOS ignores timeout/trace options from the shared contract and lacks equivalent direct plugin tests. |
| Web password is stored plaintext in config volume | `web/server/src/index.ts`, `README.md` | Medium | Medium | High | Acceptable only when the trusted-LAN and host-disk assumptions are enforced operationally. |

Single points of failure worth noting:

- `src/lib/c64api.ts` and `src/lib/deviceInteraction/deviceInteractionManager.ts` are central to almost every live-device flow.
- `src/lib/connection/connectionManager.ts` is the single authority for demo/real/offline selection.
- `web/server/src/index.ts` is the single deployment gateway for the self-hosted web product.

## Required Fixes

1. Align coverage enforcement everywhere.
	- Update `docs/code-coverage.md` to 91%.
	- Update `build` coverage mode to use the same 91/91 gate as CI and `scripts/check-coverage-threshold.mjs`.

2. Fix connection freshness signaling.
	- Either rename `Last request` to reflect last observed activity, or split it into separate probe and request freshness fields.
	- If real-device freshness is intended to be an active health signal, add a real-connected background probe policy instead of relying on demo/offline-only rediscovery.

3. Add deterministic regression coverage for slider drag propagation.
	- Add a focused test that proves downstream device updates continue during drag before `onValueCommit`.

4. Bring iOS FTP behavior closer to the shared contract.
	- Either honor `timeoutMs` and `traceContext` on iOS or narrow the shared interface so the contract matches reality.
	- Add direct native tests for the iOS FTP plugin behavior.

## Recommendations

Immediate:

1. Reconcile the 90/91 coverage mismatch across docs, scripts, and the local build helper.
2. Correct the connection status wording and decide whether quiet connected sessions should continue to receive background probe freshness.
3. Add one regression test for drag-time slider propagation and one for quiet-session freshness semantics.

Short-term:

1. Add direct iOS FTP plugin tests comparable to `FtpClientPluginTest.kt` on Android.
2. Add explicit documentation for the secret-at-rest implications of `/config/web-config.json` in web deployments.
3. Consider adding a repo-local dependency/security scanning workflow if that gate is expected for production claims.

Longer-term:

1. Continue converging platform behavior so timeout, trace, and diagnostics contracts are identical across Android, iOS, and web.
2. Keep canonical docs limited and current, with historical threshold values clearly isolated in research artifacts.

## Final Verdict

The repository is substantially hardened and demonstrably more production-oriented than a typical multi-runtime side project. Android and self-hosted web are the strongest surfaces and can reasonably be treated as conditionally production-ready for trusted-LAN deployment.

The remaining blockers are not fundamental architecture defects. They are hardening gaps at the seams: connection freshness semantics, coverage-governance drift, missing drag-time slider regression proof, and iOS parity on FTP behavior and testing.

Final verdict: conditionally ready for production on Android and trusted-LAN web deployments after the required fixes above are addressed. A uniform all-platform production-ready claim is not yet supported by the current repository evidence.
