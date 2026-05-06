# Production Test Architecture

## Purpose

This document is the status quo test architecture for C64 Commander. Its purpose is production readiness: stability, responsiveness, lifecycle recovery, connectivity correctness, and device-safe behavior while controlling a C64 Ultimate.

The test system must catch failures that ordinary happy-path tests miss: UI freeze, stale connection/config state, premature demo fallback, request storms, native Android networking problems, and physical-device regressions.

## Executive Summary

C64 Commander has a broad test estate:

- Vitest covers pure logic, hooks, React components, REST client behavior, config state, diagnostics, tracing, fuzz reporting, and contract-harness logic.
- Playwright covers the web build via Vite preview with Android-like phone/tablet emulation, traces, videos, screenshots, and strict UI monitoring.
- Playwright fuzz explores weighted UI actions in mock-device mode and records classified issues.
- Contract tests under `tests/contract` validate real C64U REST/FTP/Telnet semantics, SAFE/STRESS modes, load matrices, deterministic replay, and breakpoint forensics.
- Maestro covers native WebView smoke and edge flows on Android/iOS runners, with separate raw and curated evidence.
- Android JVM tests cover native plugins and HVSC/FTP/mock-server logic.
- Physical Android + real C64U HIL is a distinct app-first evidence layer; it cannot be replaced by web Playwright or emulator success.

The main production-readiness gaps are not runner availability, but release-blocking assertions: sustained Home CPU slider pressure, repeated checkbox pressure, partial connectivity/config recovery, native lifecycle recovery, and physical C64U safety evidence.

Current coverage requirement for code changes is `npm run test:coverage` with global branch coverage at or above 91%. The local coverage result for this task is recorded in `PLANS.md`.

Current physical status: Pixel 4 evidence proved the app can show `C64U HEALTHY` against the real `c64u` host after the health fixes, but a complete real-device soak PASS is blocked because `c64u` later became unreachable at the network/ARP layer.

## Test Taxonomy

| Layer                       | Role                                                                                 | Ownership                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Unit tests                  | Deterministic pure logic, parsers, reducers, small helpers                           | `tests/unit`, `src/**/*.test.*`, Vitest                                    |
| Integration tests           | Hooks, React state, REST client, request pacing, persistence, connection manager     | `tests/unit`, Vitest with mocks                                            |
| Contract tests              | REST/FTP/Telnet semantics, SAFE/STRESS, latency, concurrency, breakpoint forensics   | `tests/contract`                                                           |
| Playwright E2E              | Web UI workflows and evidence against Vite preview                                   | `playwright/*.spec.ts`                                                     |
| Playwright fuzz             | Weighted exploratory chaos with fail-fast issue capture                              | `playwright/fuzz`, `scripts/run-fuzz.mjs`                                  |
| Structured interaction soak | Deterministic repeated high-risk user workflows with request and convergence budgets | Playwright specs, currently `playwright/structuredInteractionSoak.spec.ts` |
| Performance/startup         | Startup KPI, HVSC performance, latency budgets, responsiveness budgets               | `scripts/startup`, `playwright/hvscPerf*.spec.ts`, `tests/benchmarks`      |
| Maestro Android/iOS         | Native WebView smoke and selected edge coverage                                      | `.maestro`, `scripts/run-maestro-gating.sh`                                |
| Android JVM/instrumentation | Native plugin/unit behavior; connected tests are local/manual                        | `android/app/src/test`, build helper `--android-tests`                     |
| Physical Android + C64U HIL | App-first real networking, hardware safety, and A/V proof with external oracles      | physical-device matrix, agentic docs, `c64scope`                           |

Fuzz and soak are intentionally separate. Fuzz explores a broad action space and fails fast per issue. Soak repeats selected high-risk workflows many times and measures endurance, convergence, request pacing, and sustained responsiveness.

## Existing Test Inventory

| Category               | Purpose                                                   | Location                                               | Commands                                                                                                                                               | CI/nightly/local/manual            | Hardware                             | Evidence                                                                    | Runtime                 | Proves                                                        | Does not prove                               |
| ---------------------- | --------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- | ------------------------------------ | --------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------- | -------------------------------------------- |
| Unit                   | Pure logic and small modules                              | `tests/unit`, `src/**`                                 | `npm run test`                                                                                                                                         | CI                                 | None                                 | Vitest logs                                                                 | Minutes                 | deterministic code behavior                                   | native runtime, physical C64U                |
| Integration            | Hooks, app state, API client, request pacing, persistence | `tests/unit`                                           | `npm run test`, targeted `vitest run <file>`                                                                                                           | CI                                 | None                                 | Vitest logs                                                                 | Minutes                 | state transitions and mocked REST behavior                    | LAN, CapacitorHttp, Android lifecycle        |
| Coverage               | Branch coverage gate                                      | unit + e2e LCOV                                        | `npm run test:coverage`, `npm run coverage:gate`                                                                                                       | CI/local required for code changes | None                                 | `coverage/lcov.info`, `coverage/lcov-merged.info`                           | Medium                  | branch coverage threshold                                     | physical readiness                           |
| Contract SAFE          | Real REST/FTP/Telnet semantics                            | `tests/contract`                                       | `npx tsc -p tests/contract/tsconfig.json`; `node tests/contract/dist/run.js --config tests/contract/config.sample.json`                                | Manual/HIL                         | Real C64U                            | `test-results/contract/runs/*`                                              | Medium                  | real firmware contract and latency                            | app UI, native lifecycle                     |
| Contract STRESS        | Controlled disruptive API stress                          | `tests/contract`                                       | `node tests/contract/dist/run.js --config tests/contract/config.stress.matrix.quick.json`                                                              | Manual/HIL                         | Real C64U                            | matrix artifacts, `logs.jsonl`                                              | Medium/long             | load boundaries and health aborts                             | app UI                                       |
| Contract breakpoint    | Deterministic SID volume breakpoint                       | `tests/contract/scenarios/rest/breakpointSidVolume.ts` | `node tests/contract/dist/run.js --config tests/contract/config.stress.breakpoint.sample.json`                                                         | Manual/HIL                         | Real C64U                            | `breakpoint-stages.json`, `failure-summary.json`, `request-trace-tail.json` | Focused STRESS          | request-rate failure boundary                                 | app UI workflow                              |
| Contract replay/parity | Replay traces, compare real/mock                          | `tests/contract/replay.ts`, `parity.ts`                | see `tests/contract/README.md`                                                                                                                         | Manual                             | Real C64U for online replay/parity   | replay manifests and parity diffs                                           | Varies                  | deterministic request intent                                  | raw TCP timing                               |
| Playwright E2E         | Web UI workflows                                          | `playwright/*.spec.ts`                                 | `npm run test:e2e`; `PLAYWRIGHT_DEVICES=phone npx playwright test <spec>`                                                                              | CI                                 | None                                 | traces/videos/screenshots                                                   | Medium                  | web UI behavior and request routing to mock                   | CapacitorHttp, Android DNS, physical device  |
| Playwright screenshots | Documentation screenshots and evidence validation         | `playwright/screenshots.spec.ts`                       | `npm run screenshots`; `npm run test:e2e:ci`                                                                                                           | CI                                 | None                                 | `test-results/evidence/playwright`                                          | Medium/long             | visible documented UI                                         | native runtime                               |
| Playwright fuzz        | Chaos exploration                                         | `playwright/fuzz`, `scripts/run-fuzz.mjs`              | `npm run fuzz`; `VITE_FUZZ_MODE=1 node scripts/run-fuzz.mjs --fuzz-seed 4242 --fuzz-time-budget 5m --fuzz-concurrency 1 --fuzz-platform android-phone` | Nightly/CI workflow                | None, mock only                      | `test-results/fuzz/**`                                                      | 5m CI, longer local     | crashes/freezes/classified issues in web mock mode            | physical safety, native networking           |
| Structured soak        | Deterministic repeated UI pressure                        | `playwright/structuredInteractionSoak.spec.ts`         | `PLAYWRIGHT_DEVICES=phone npx playwright test playwright/structuredInteractionSoak.spec.ts --project=android-phone`                                    | CI-safe targeted                   | None, mock only                      | Playwright evidence plus mock request assertions                            | Target <10s/spec        | endurance, convergence, request bounds for selected workflows | native/physical behavior                     |
| Performance            | HVSC and startup budgets                                  | scripts and perf specs                                 | `npm run test:bench`, `npm run test:perf:quick`, `npm run startup:baseline`, `npm run startup:gate`, `npm run startup:gate:hvsc`                       | CI/nightly/manual                  | Startup commands need Android device | perf JSON/logcat                                                            | Varies                  | budgets and regressions                                       | broad UI correctness                         |
| Maestro Android        | Native smoke and selected edge flows                      | `.maestro`, `scripts/run-maestro-gating.sh`            | `npm run maestro:gating`; `./build --test-maestro-ci`; `./build --test-maestro-all`                                                                    | CI/local                           | Emulator/device                      | `test-results/maestro`, `test-results/evidence/maestro`                     | CI target under minutes | native WebView launch/smoke/HVSC                              | real LAN hostname unless physical configured |
| Android emulator Node  | ADB-driven emulator specs                                 | `tests/android-emulator`                               | `tests/android-emulator/run.mjs` via local scripts                                                                                                     | Local/manual                       | Emulator                             | emulator evidence/logcat                                                    | Varies                  | Android runtime edge checks                                   | real hardware                                |
| Android JVM            | Native plugin and JVM logic                               | `android/app/src/test`                                 | `cd android && ./gradlew testDebugUnitTest jacocoTestReport`; `npm run android:apk` for APK                                                            | CI                                 | None for JVM                         | Gradle/Jacoco                                                               | Medium                  | plugin logic and native helpers                               | app UI, connected Android                    |
| Connected Android      | Instrumentation                                           | `android`                                              | `./build --android-tests`; `cd android && ./gradlew connectedDebugAndroidTest`                                                                         | Local/manual                       | Device/emulator                      | Gradle output                                                               | Varies                  | connected runtime                                             | physical C64U unless configured              |
| Physical HIL           | Production evidence                                       | `docs/testing/physical-device-matrix.md`, agentic docs | `node scripts/run-pixel4-c64u-soak.mjs`, `npm run startup:baseline`, `scope:hil:evidence`, app-first droidmind/c64scope/c64bridge runs                 | Manual/HIL                         | Pixel 4 + real C64U                  | c64scope timelines, screenshots, logcat, app diagnostics, A/V assertions    | Long                    | real networking, safety, A/V                                  | CI-only repeatability                        |

## Failure Modes This Architecture Must Catch

- UI freeze or action timeout.
- UI lag under repeated control input.
- Slider non-response or snap-back.
- Checkbox burst instability.
- App/device detachment while some actions still work.
- Stale connection state after failed probes.
- Stale config state or permanent empty categories.
- `No categories available` while the device is reachable.
- Config-backed controls staying greyed out after recovery.
- Health check false negatives.
- Partial connectivity where `/v1/info` works but config fetch fails.
- Failed recovery after suspend/resume.
- Demo-mode fallback when a real device is reachable.
- Premature fallback under slow response.
- Unbounded REST request bursts, retries, or polling.
- Request storms during slider drag.
- Device overload caused by client behavior.
- Native Android networking failures hidden by web tests.
- Emulator success masking physical-device failure.

## Gap Analysis

| Symptom                                          | Existing tests that should have caught it             | Why not enough                                                   | Required test                                                          | Correct layer              | CI-safe                       | Hardware                     | Release blocker |
| ------------------------------------------------ | ----------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------- | ----------------------------- | ---------------------------- | --------------- |
| Home CPU slider fragile under repeated movement  | Hook tests, Home unit tests, Playwright smoke         | Mostly single-interaction coverage                               | repeated CPU slider soak with request bounds; latest-intent unit burst | Playwright + Vitest        | Yes                           | No for CI, yes for final HIL | Yes             |
| Slider drag request storm                        | `useDeviceBoundSlider` small throttle tests           | No sustained 100-step budget assertion                           | long-drag hook test and Home soak                                      | Vitest + Playwright        | Yes                           | No                           | Yes             |
| Checkbox toggling stale or stormy                | `configWriteThrottle` two-write test, Home unit tests | No sustained burst/final-state coverage                          | checkbox-style burst pacing and Home repeated checkbox soak            | Vitest + Playwright        | Yes                           | No                           | Yes             |
| Config page empty after transient failure        | config hook partial failure tests                     | Existing tests did not prove reconnect retry after total failure | failed snapshot then disconnect/reconnect recovery                     | Vitest hook                | Yes                           | No                           | Yes             |
| Health false negative while other endpoints work | health diagnostics tests                              | Mostly model-level, not full partial-connectivity workflow       | partial REST/config failure tests plus HIL diagnostics                 | Vitest/Playwright/HIL      | Partial                       | HIL for production           | Yes             |
| Premature demo fallback                          | connection manager and Playwright demo tests          | Need slow-success-before-deadline boundary                       | startup slow successful probe test                                     | Vitest                     | Yes                           | No                           | Yes             |
| Native Android DNS/lifecycle failure             | Playwright connection tests                           | Web uses `fetch`, not native WebView/CapacitorHttp path          | Maestro/emulator lifecycle and physical HIL                            | Maestro/HIL                | Emulator yes, physical manual | Yes                          | Yes             |
| C64U overload under API storm                    | contract STRESS                                       | App UI pressure and contract load were separate                  | app-side pacing tests plus contract breakpoint/matrix                  | Vitest/Playwright/contract | CI-safe for mock only         | Real C64U for STRESS         | Yes             |

## Structured Interaction Soak Tests

Structured soak tests are deterministic, realistic, repeated, measurable, and bounded. They must not be random fuzz and must not use real hardware by default.

Required scenarios and ownership:

- Home CPU Speed slider repeated movement: `playwright/structuredInteractionSoak.spec.ts`, plus `LatestIntentWriteLane` and `useDeviceBoundSlider` unit tests.
- Config CPU Speed slider repeated movement: Playwright Config page soak when selector/runtime cost is acceptable; currently documented as remaining work unless the current UI exposes a stable CPU Speed config slider.
- Known-fast comparator slider such as SID Socket 1 Pan or a safe lighting intensity slider: Playwright/audio mixer extension candidate; physical Pixel 4 runner `scripts/run-pixel4-c64u-soak.mjs` uses a safe Home slider when the real host is reachable.
- Representative checkbox repeated toggle: Home HDMI Scan Lines in `playwright/structuredInteractionSoak.spec.ts`; low-level burst in `configWriteThrottle.test.ts`.
- Route navigation during or after pending device-backed actions: included in the Home CPU slider soak by navigating Home -> Settings -> Home while writes settle.
- Recovery after simulated network/config failures: `useAppConfigState` reconnect recovery and connection manager slow-success tests; Playwright partial-connectivity recovery remains a planned extension.
- Bounded repeated lifecycle simulation: web simulation belongs in Playwright/connection tests; native background/foreground belongs in Maestro/emulator/HIL.

## Responsiveness Budgets

- UI controls must visually update without waiting for a device round trip.
- Slider drag must not create an unsafe one-request-per-pixel storm.
- Repeated slider input must converge to the final intended value.
- Checkbox toggles must converge to the final intended state.
- Navigation must remain responsive while device requests are pending.
- Health state must recover after transient failure.
- Config-backed UI must repopulate after connectivity recovers.
- Long-running tests must not accumulate unbounded pending requests.
- No test may hang indefinitely; every runner must use explicit action/session/job timeouts.

Concrete CI-safe budgets introduced here:

- 100 hook-level slider movement events with 200 ms preview throttle produce a bounded preview count and exactly one final commit.
- 20 rapid latest-intent writes execute at most one in-flight write and converge to the final intent.
- 12 checkbox-style writes execute with max in-flight 1 and configured inter-write spacing.
- Home CPU soak bounds config batch mutation count while requiring final mock-device state convergence.

## Device Safety And REST Burst Protection

Required client behavior:

- Debounce or throttle high-frequency preview writes.
- Coalesce latest-intent interactive writes where intermediate values are not useful.
- Serialize general config writes through `scheduleConfigWrite`.
- Bound in-flight REST work through `deviceInteractionManager` and write lanes.
- Bound retries; user-triggered requests should not retry into storms.
- Use deterministic backoff for forensics; contract breakpoint profiles must avoid random jitter.
- Converge to final state after rapid input.
- Recover from transient failure without retry storms.
- Keep real hardware out of ordinary CI load tests.

Tests:

- `tests/unit/lib/deviceInteraction/latestIntentWriteLane.test.ts`
- `tests/unit/hooks/useDeviceBoundSlider.test.ts`
- `tests/unit/configWriteThrottle.test.ts`
- `playwright/structuredInteractionSoak.spec.ts`
- `scripts/run-pixel4-c64u-soak.mjs` for manual Pixel 4 + `c64u` evidence with native logcat request-count checks.
- `tests/contract` STRESS matrix and breakpoint profiles for real-device load boundaries.

## Web Vs Native Vs Emulator Vs Physical Device

- Playwright web proves browser/Vite UI behavior, mock routing, DOM responsiveness, and web `fetch` behavior. It does not prove `CapacitorHttp`, Android DNS, LAN routing, background/foreground lifecycle, or physical C64U behavior.
- Android emulator proves native WebView launch, some Capacitor/native plugin integration, and selected lifecycle behavior. It does not prove real Wi-Fi/LAN hostname behavior or real C64U safety.
- Physical Android + real C64U is required for production confidence in native networking, real hardware safety, and A/V-sensitive playback.
- HIL tests must be app-first. `c64bridge` is read-only corroboration, emergency recovery, or narrow gap filling. `c64scope` owns A/V capture, timeline, and artifact packaging, but not all verdicts by itself.

## Contract And Breakpoint Testing

Contract tests are the correct layer for C64U API semantics and request-rate breakpoint forensics because they exercise the shared REST/FTP/Telnet harness directly against firmware and preserve hardware artifacts.

- SAFE validates reversible/read-only behavior and measured latency.
- STRESS is opt-in, disruptive, and must enforce runtime caps and abort conditions.
- Structured matrix profiles probe operation, concurrency, rate, and FTP session combinations.
- Breakpoint profile `rest.breakpoint.sid-volume` ramps `rateRampMs` and `concurrencyRamp` deterministically across real Audio Mixer SID volume targets.
- Health aborts must stop scheduling quickly.
- Breakpoint/device-unresponsive failures skip automatic recovery where preserving forensic state matters.
- Artifacts include `logs.jsonl`, latency stats, concurrency/matrix/breakpoint artifacts, `failure-summary.json`, `request-trace-tail.json`, and optional replay manifests.
- Breakpoint tests belong in `tests/contract`, not in a second runner.

## Evidence Model

| Layer            | Evidence                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| Unit/integration | Vitest assertion output, coverage reports                                                                        |
| Contract         | `logs.jsonl`, `latency-stats.json`, `concurrency.json`, conflicts, matrix/breakpoint artifacts, replay manifests |
| Playwright E2E   | traces, videos, screenshots, metadata, strict UI monitor output                                                  |
| Fuzz             | session logs, videos, screenshots, `README.md`, `fuzz-issue-summary.md`, `fuzz-issue-report.json`                |
| Maestro          | raw `test-results/maestro`, curated `test-results/evidence/maestro`, reports, screenshots/debug output           |
| Android JVM      | Gradle/Jacoco reports                                                                                            |
| Physical HIL     | c64scope timelines, app logs, screenshots, logcat, REST/FTP/RAM evidence, A/V assertions where required          |

## Release Blocker Matrix

| Failure mode                                        | Test layer        | Test name or planned test                           | Command                                                                                                                                                                                          | Status     | Hardware                          | Evidence                   | Release blocker | Current status                                                                       |
| --------------------------------------------------- | ----------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------------------------------- | -------------------------- | --------------- | ------------------------------------------------------------------------------------ |
| CPU slider request storm/stale final value          | Unit + Playwright | `LatestIntentWriteLane` burst; Home structured soak | `vitest run tests/unit/lib/deviceInteraction/latestIntentWriteLane.test.ts`; `PLAYWRIGHT_DEVICES=phone npx playwright test playwright/structuredInteractionSoak.spec.ts --project=android-phone` | CI         | No                                | Vitest + Playwright        | Yes             | Implemented in this task                                                             |
| Slider local lag/preview storm                      | Unit              | `useDeviceBoundSlider` sustained drag               | `vitest run tests/unit/hooks/useDeviceBoundSlider.test.ts`                                                                                                                                       | CI         | No                                | Vitest                     | Yes             | Implemented in this task                                                             |
| Checkbox burst/convergence                          | Unit + Playwright | config throttle burst; Home scan-lines soak         | `vitest run tests/unit/configWriteThrottle.test.ts`; Playwright soak command                                                                                                                     | CI         | No                                | Vitest + Playwright        | Yes             | Implemented in this task                                                             |
| Stale config after transient fetch failure          | Unit              | reconnect recovery test                             | `vitest run tests/unit/hooks/useAppConfigState.test.tsx`                                                                                                                                         | CI         | No                                | Vitest                     | Yes             | Implemented in this task                                                             |
| Premature demo fallback under slow response         | Unit              | slow startup probe before deadline                  | `vitest run tests/unit/connection/connectionManager.startup.test.ts`                                                                                                                             | CI         | No                                | Vitest                     | Yes             | Implemented in this task                                                             |
| Partial connectivity: health fails but config works | Unit + HIL        | health recovery regressions; degraded-state UI plan | `vitest run tests/unit/lib/diagnostics/healthModel.test.ts`; TBD Playwright degraded scenario                                                                                                    | Partial    | HIL for production                | logs + UI                  | Yes             | False unhealthy fixed for expected optional misses and pre-connection gating errors  |
| Android native DNS/LAN failure                      | Maestro/HIL       | startup real-device connection validation           | `./build --test-maestro-ci`; `node scripts/run-pixel4-c64u-soak.mjs`                                                                                                                             | Manual/HIL | Emulator/physical                 | Maestro/logcat/HIL bundle  | Yes             | Pixel 4 showed `C64U HEALTHY`; final full soak blocked because `c64u` is now offline |
| Pixel 4 repeated physical slider/checkbox/buttons   | HIL               | Pixel 4 C64U soak runner                            | `node scripts/run-pixel4-c64u-soak.mjs`                                                                                                                                                          | Manual/HIL | Pixel 4 + `c64u`                  | screenshot + logcat + JSON | Yes             | Implemented; no complete PASS because `c64u` became unreachable                      |
| Android lifecycle recovery                          | Maestro/HIL       | background/foreground recovery edge                 | `.maestro/edge-*` or new lifecycle flow                                                                                                                                                          | Manual/HIL | Emulator/physical                 | Maestro/logcat             | Yes             | Remaining gap                                                                        |
| Real C64U overload                                  | Contract          | stress matrix/breakpoint profiles                   | contract STRESS commands                                                                                                                                                                         | Manual/HIL | Real C64U                         | contract artifacts         | Yes             | Harness exists; execution required                                                   |
| A/V playback proof                                  | Physical HIL      | HVSC/playback proof                                 | physical-device matrix/c64scope                                                                                                                                                                  | Manual/HIL | Physical Android + C64U + capture | c64scope A/V               | Yes             | Requires HIL                                                                         |

## Remaining Gaps

| Gap                                        | Reason                                                            | Risk                                                        | Required next step                                                                  | Blocks release                                                                |
| ------------------------------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Native Android lifecycle recovery          | Web cannot simulate Android background/foreground reliably        | App may detach after suspend/resume                         | Add or run Maestro/HIL lifecycle flow with logcat and app state evidence            | Yes                                                                           |
| Physical LAN hostname/DNS behavior         | Emulator and web localhost do not prove real Wi-Fi/LAN resolution | Real device may fail while web passes                       | Pixel 4 + `c64u` preflight and app-first connection evidence when host is reachable | Yes                                                                           |
| Real C64U request-rate breakpoint evidence | CI-safe tests use mock server only                                | Hardware may still hang under app pressure                  | Run contract matrix/breakpoint profiles with safe config and preserve artifacts     | Yes                                                                           |
| Partial connectivity UI semantics          | Some tests are model-level only                                   | Config can remain empty/disabled while health is misleading | Add Playwright degraded mock scenario and HIL diagnostics case                      | Yes                                                                           |
| Native health false negative on Pixel 4    | Fixed for the observed expected-miss/pre-connection cases         | Other partial-connectivity combinations may remain          | Add Playwright degraded mock scenario and repeat HIL once `c64u` is reachable       | Yes until HIL passes                                                          |
| Config CPU Speed comparator soak           | Stable selector/workflow needs verification                       | Home-specific bug may not generalize                        | Extend structured soak to Config page when fast and stable                          | No if Home and low-level layers pass, but required before broad release claim |
| Physical A/V playback proof                | Requires capture hardware/server                                  | Playback may appear successful without real signal          | Run c64scope-backed app-first playback proof                                        | Yes                                                                           |

## Release Readiness Classification Rules

Use:

- `READY`: all release-blocker tests pass, HIL evidence is complete, no severe untested gaps remain.
- `PARTIALLY READY`: CI-safe release-blocker coverage passes, but manual/HIL blockers remain.
- `NOT READY`: severe known gap remains without a blocker or plan.
- `BLOCKED BY HARDWARE`: required Pixel 4/C64U/capture execution cannot run in the current environment.
- `BLOCKED BY FAILING TESTS`: any release-blocker test fails.
- `BLOCKED BY UNIMPLEMENTED RELEASE-BLOCKER TESTS`: release-blocking scenarios are not yet implemented.

Do not mark `READY` based only on Playwright web, emulator, demo mode, screenshots, toasts, or absence of crashes.
