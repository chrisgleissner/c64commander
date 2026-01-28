# Testing infrastructure review (C64 Commander)

## Executive summary

- Playwright E2E currently exercises the **web build via Vite preview**, not a Capacitor WebView or native Android runtime. This means Android-specific networking, permissions, and lifecycle behavior are **not validated** (see playwright.config.ts and .github/workflows/android-apk.yaml).
- Real-device discovery logic is **platform-dependent**: web uses `fetch`, native uses `CapacitorHttp` (see src/lib/connection/connectionManager.ts and src/lib/c64api.ts). The current tests use local Node mock servers and localStorage seeding, so they **cannot detect** failures that only occur on Android (e.g., DNS/mDNS, LAN routing, background/foreground transitions).
- Demo-mode fallback is **enabled by default** and can trigger quickly based on the startup discovery window. Tests frequently **shorten discovery windows and inject mocks**, which makes it easy to miss “real device present but demo fallback” bugs (see playwright/connectionSimulation.spec.ts, playwright/demoMode.spec.ts, src/lib/config/appSettings.ts).
- CI runs Playwright only in headless Chromium with mobile emulation and **does not use an Android emulator**, while Android CI only runs JVM unit tests (no instrumentation). This creates a large coverage gap for native device discovery and networking.

## Current state - what exists today

- **Web unit tests**: Vitest via `npm run test` / `npm run test:coverage` (see package.json).
- **Web E2E**: Playwright against Vite preview (`npm run test:e2e` / `npm run screenshots`), with mobile device emulation (“android-phone”, “android-tablet”) but still web-only (see playwright.config.ts).
- **Playwright evidence**: traces, videos, screenshots, and metadata are collected and validated (playwright/testArtifacts.ts, scripts/validate-playwright-evidence.mjs).
- **Playwright fuzz**: nightly chaos fuzz in web-only mode with `VITE_FUZZ_MODE=1` (see .github/workflows/fuzz-chaos.yaml, scripts/run-fuzz.mjs, src/lib/fuzz/fuzzMode.ts).
- **Android tests**: Gradle JVM unit tests + JaCoCo coverage (`./gradlew testDebugUnitTest`) in CI (see .github/workflows/android-apk.yaml). No Android instrumentation tests are executed in CI. local-build.sh supports `--android-tests` for connected devices/emulators.
- **Mocking strategy**:
  - Web E2E uses Node-based mock servers (`tests/mocks/mockC64Server.ts`) and injects configuration via localStorage (`playwright/demoMode.spec.ts`, `playwright/connectionSimulation.spec.ts`, `playwright/uiMocks.ts`).
  - Demo-mode mock server for native is via `MockC64U` Capacitor plugin (android/app/src/main/java/uk/gleissner/c64commander/MockC64UPlugin.kt), but this is not exercised in Playwright.
  - Web fallback for mock server requires `window.__c64uMockServerBaseUrl` (src/lib/native/mockC64u.web.ts), set explicitly in some Playwright tests.

## Evidence log

### Key commands to reproduce locally

- `npm run test:e2e` (Playwright E2E without screenshots)
- `npm run test:e2e:ci` (E2E + screenshots + evidence validation)
- `npm run screenshots` (Playwright screenshots)
- `npm run cap:build` (web build + Capacitor sync)
- `./local-build.sh --test-e2e` (local E2E flow)
- `./local-build.sh --android-tests` (connected Android instrumentation tests; requires device/emulator)
- `./scripts/android-emulator.sh` (provisions and starts Android emulator)
- `npm run proxy` (local C64U proxy server)

### Key file paths and why they matter

- playwright.config.ts
  - Defines Playwright to run against Vite preview on localhost and uses mobile emulation projects (`android-phone`, `android-tablet`). Confirms **web-only** execution.
- .github/workflows/android-apk.yaml
  - CI runs Playwright in web mode and Android JVM unit tests only. **No Android emulator** or UI tests executed.
- .github/workflows/fuzz-chaos.yaml
  - Nightly Playwright chaos fuzz for web using `VITE_FUZZ_MODE`.
- local-build.sh
  - Provides local-only hooks for Android instrumentation tests and emulator startup, but not used in CI.
- scripts/android-emulator.sh
  - End-to-end emulator setup script (not wired into CI).
- src/lib/connection/connectionManager.ts
  - Implements discovery state machine, demo fallback, and probe logic; core of “real vs mock” behavior.
- src/lib/c64api.ts
  - Uses `CapacitorHttp` on native platforms, `fetch` on web. **Different networking stack**.
- src/lib/native/mockC64u.ts + src/lib/native/mockC64u.web.ts
  - Mock server plugin entry point; web mock requires `window.__c64uMockServerBaseUrl`.
- android/app/src/main/java/uk/gleissner/c64commander/MockC64UPlugin.kt
  - Native mock server implementation used on Android (not exercised by web Playwright).
- playwright/demoMode.spec.ts and playwright/connectionSimulation.spec.ts
  - Tests inject discovery settings via localStorage and use Node mock servers. This ensures deterministic web behavior but can mask native/network differences.
- tests/mocks/mockC64Server.ts
  - Node HTTP mock server used by Playwright; not equivalent to real device discovery in Android runtime.
- proxy/server.mjs
  - Local proxy for C64U API; relevant for network routing and `X-C64U-Host` header usage in web.

## Failure analysis - why bugs were not caught

- **Platform mismatch**: Playwright runs a Vite preview web build on localhost. Real device discovery in native uses `CapacitorHttp`, while Playwright uses `fetch` (src/lib/connection/connectionManager.ts, src/lib/c64api.ts). Any Android-specific DNS, routing, or permission issues are invisible to web tests.
- **Mock-only discovery path**: E2E tests use Node mock servers and localStorage seeding to drive discovery (playwright/demoMode.spec.ts, playwright/connectionSimulation.spec.ts, tests/mocks/mockC64Server.ts). This ensures deterministic outcomes but does not validate real-device discovery semantics or fallback decision logic under real network conditions.
- **Demo-mode bias in tests**: Many E2E tests shorten the startup discovery window and enable automatic demo mode. This can mask scenarios where a real device becomes reachable slightly later, causing false “demo fallback” behavior to go undetected (src/lib/config/appSettings.ts, playwright/connectionSimulation.spec.ts).
- **No Android runtime validation**: CI does not run an emulator or connected device tests. Even locally, instrumentation tests are optional and require manual setup (local-build.sh, scripts/android-emulator.sh). As a result, background/foreground lifecycle and Android network stack behavior are untested.
- **Observability gap for native issues**: Playwright collects traces/screenshots/videos for the web context (playwright/testArtifacts.ts), but there is no Android logcat capture, native plugin logging, or Capacitor bridge telemetry attached to CI artifacts.
- **No LAN environment control**: Tests execute on localhost with mock servers, not on a realistic LAN. Device discovery behavior (e.g., DNS for `c64u`, local hostname resolution, or mDNS) is not validated.

## Constraints and target platforms

- Must work across **Android (device + limited emulator)**, **web (future target)**, **iOS (future path)**, and **Docker-based CI**.
- Emulator usage is allowed but must be **scoped to high-value edge cases**.
- Avoid rewrites; prefer incremental, low-risk improvements.
- CI is Ubuntu-based with no Dockerfiles in repo; any Docker solution must integrate with GitHub Actions and Playwright dependencies.

## Improvement options

1. **Explicit environment selection for “real vs mock”**
   - What: Introduce a uniform test-time switch to force “real device only”, “mock only”, or “auto” discovery. Drive it via a single env flag and expose it to both web and native.
   - Improves: Prevents silent fallback to mock when real device is expected; makes tests deterministic.
   - Cost: S (small changes in config + testing hooks).
   - Platform coverage: Android + Web + iOS path + Docker.
   - Risk: Low.
   - Incremental rollout: Start with web E2E, then apply to Android runtime configuration.

2. **Platform-agnostic contract tests for discovery logic**
   - What: Add unit/contract tests for `discoverConnection` and `probeOnce` decision paths (mockable transport interface) in Node/Vitest, validating “real vs demo” transitions.
   - Improves: Validates core decision logic independent of platform UI.
   - Cost: M.
   - Platform coverage: All (logic-level).
   - Risk: Low.
   - Incremental rollout: Start with state machine tests and probe timing/timeout cases.

3. **Standardized diagnostics bundle for E2E failures**
   - What: Extend evidence collection to include app logs, C64 API logs (already recorded by addLog), and network request summaries in a single artifact.
   - Improves: Faster root-cause analysis for discovery failures.
   - Cost: M.
   - Platform coverage: Web now, Android/iOS with log export hooks.
   - Risk: Low.
   - Incremental rollout: Web-only first (bundle console logs), then Android logcat capture in emulator runs.

4. **Targeted Android emulator E2E suite (edge cases only)**
   - What: A small test group (e.g., 3–5 cases) that exercises discovery and demo fallback in a real WebView, focusing on high-value issues.
   - Improves: Validates native networking, CapacitorHttp, and lifecycle.
   - Cost: M–L.
   - Platform coverage: Android now; path for iOS later.
   - Risk: Medium (flakiness, runtime).
   - Incremental rollout: Separate CI job, nightly or on-demand.

5. **Test harness for “real device present” simulation**
   - What: Simulate a “real device reachable” state via configurable host mapping or local proxy (proxy/server.mjs) and ensure demo mode does not activate if probe succeeds in time.
   - Improves: Catches the “real device available but demo fallback” class of bugs in web and emulator runs.
   - Cost: M.
   - Platform coverage: Web + Android emulator; iOS path feasible.
   - Risk: Low.
   - Incremental rollout: Add to Playwright web tests first.

6. **Background/foreground lifecycle validation**
   - What: Add tests that simulate background/foreground and verify background rediscovery transitions and state updates.
   - Improves: Catches Android lifecycle-related discovery regressions.
   - Cost: M.
   - Platform coverage: Android emulator + iOS path; limited web simulation.
   - Risk: Medium.
   - Incremental rollout: Emulator-only tests.

7. **Deterministic network latency and timeout controls**
   - What: Parameterize probe timeouts and discovery windows for tests, and validate behavior at boundary conditions (e.g., slow responses).
   - Improves: Prevents premature demo fallback under realistic latency.
   - Cost: S–M.
   - Platform coverage: Web + Android + iOS path.
   - Risk: Low.
   - Incremental rollout: Start with contract tests and web E2E.

8. **Docker-compatible Playwright base image + CI job**
   - What: Add a documented Docker target or CI job that runs Playwright in a container mirroring production CI.
   - Improves: Ensures portability and future-proof Docker-based CI.
   - Cost: M.
   - Platform coverage: Web; Android emulator can be added later with nested virtualization caution.
   - Risk: Medium.
   - Incremental rollout: Start with web-only Playwright in Docker.

9. **Future iOS path guardrails**
   - What: Keep mock/real selection and discovery contracts platform-agnostic; avoid Android-specific assumptions in test harnesses.
   - Improves: Avoids dead-end Android-only solutions.
   - Cost: S.
   - Platform coverage: iOS path.
   - Risk: Low.
   - Incremental rollout: Apply to new test utilities and env flags.

## Bang-for-buck ranking

| Improvement | Problem(s) addressed | Effort (S/M/L) | Impact (S/M/L) | CI cost (S/M/L) | Platform coverage | Why it’s worth it | Suggested phase |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Explicit environment selection for “real vs mock” | Silent fallback to demo; non-deterministic discovery | S | L | S | Android, Web, iOS path, Docker | Makes tests deterministic and prevents accidental mock usage | Phase 0 |
| Contract tests for discovery logic | Decision logic not validated independently of platform | M | L | S | All | High confidence in core logic without emulator | Phase 0 |
| Deterministic timeout/latency controls | Premature demo fallback under slow networks | S–M | M | S | All | Mirrors real network slowness and prevents false positives | Phase 1 |
| Standardized diagnostics bundle | Poor observability of discovery failures | M | M | S | Web now, Android/iOS later | Faster triage; actionable evidence | Phase 1 |
| Real-device-present simulation via proxy | “Real device available but demo fallback” not covered | M | M | S | Web + Android emulator | Directly targets reported bug class | Phase 1 |
| Targeted Android emulator E2E suite | Missing native networking + WebView behavior | M–L | L | M–L | Android now, iOS path later | Catches native-only regressions with minimal scope | Phase 2 |
| Lifecycle background/foreground tests | Native lifecycle discovery failures | M | M | M | Android emulator + iOS path | Validates critical lifecycle behavior | Phase 2 |
| Docker-compatible Playwright job | Future Docker CI portability | M | M | M | Web, Docker | Ensures CI portability and repeatability | Phase 3 |
| iOS path guardrails | Avoid platform dead-ends | S | M | S | iOS path | Prevents future refactors and keeps parity | Phase 0 (ongoing) |

## Recommended path forward

**Phase 0 (1–2 weeks): Determinism + logic coverage**

- Add an explicit discovery mode selector (“real-only / mock-only / auto”) shared by web and native configuration.
- Add contract tests for `discoverConnection` transitions and `probeOnce` outcomes, including boundary timing and auto-demo conditions.
- Document expected behavior in tests (e.g., how “real vs mock” must be asserted).

**Phase 1 (2–4 weeks): Observability + realistic network controls**

- Extend Playwright evidence to include network summaries and connection-state snapshots.
- Add “real device present” simulation in web E2E using the proxy or host-mapped mock server to ensure demo is not selected when probe succeeds in time.
- Add deterministic latency/timeout fixtures for discovery (slow response cases).

**Phase 2 (4–6 weeks): Minimal Android emulator coverage**

- Introduce a small Android emulator suite focused on: (1) discovery on startup, (2) demo fallback, (3) background rediscovery.
- Capture logcat + Capacitor plugin logs in artifacts for emulator runs only.

**Phase 3 (future): Docker + iOS readiness**

- Add a Docker-based Playwright job (web-only) and document emulator constraints in containers.
- Keep discovery environment selection and contract tests platform-agnostic to enable a future iOS pipeline with minimal changes.

## Risks and mitigations

- **Emulator flakiness and CI runtime**: Limit emulator tests to a small, high-value set and run nightly or on-demand; keep core coverage in contract tests.
- **Platform-specific configuration drift**: Centralize environment selection and discovery settings to reduce divergence between web and native.
- **Docker-in-container limits for emulators**: Keep emulator runs outside Docker; reserve Docker for web-only Playwright.
- **Over-mocking hides regressions**: Require at least one “real-device-present” simulation path in E2E to validate selection logic.

## Appendix - repo map

- playwright/ — Playwright tests and utilities (e2e + fuzz)
- tests/mocks/ — Node mock servers (C64U, FTP, etc.)
- src/lib/connection/ — Discovery and connection state machine
- src/lib/native/ — Capacitor plugin wrappers, including MockC64U
- android/app/src/main/java/uk/gleissner/c64commander/ — Native Android plugins and bridge
- .github/workflows/ — CI for web tests, Android unit tests, and fuzz
- scripts/ — Local build, emulator, and test tooling
