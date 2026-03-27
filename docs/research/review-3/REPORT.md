# Review 3: Production Readiness Report

Date: 2026-02-18
Scope rule: no production code changes were made. Artifacts only under `doc/research/review-3/` plus `PLANS.md` updates.

## 1) Executive summary

### Overall readiness

- **Not ready for low-risk production rollout** without targeted hardening.
- Main blockers are test-system reliability (Android JVM layer), low-resource web payload pressure, and cross-platform behavior mismatch for background execution.

### Top 10 risks (ordered)

| Rank | Risk                                                                             | Severity | Likelihood |
| ---: | -------------------------------------------------------------------------------- | -------- | ---------- |
|    1 | Android JVM native test layer unstable under current toolchain (85/112 failures) | Critical | High       |
|    2 | Large web main chunk + 7z wasm payload for low-resource targets                  | High     | High       |
|    3 | Deterministic Playwright failures from viewport guard vs web project config      | High     | High       |
|    4 | iOS background execution no-op vs Android foreground service behavior            | High     | Medium     |
|    5 | Non-native HVSC ingest can create high JS heap pressure                          | High     | Medium     |
|    6 | Low branch coverage in `web/server/src/index.ts` auth/proxy surface              | High     | Medium     |
|    7 | Broad route/visibility query invalidation can increase churn on constrained CPU  | Medium   | Medium     |
|    8 | Large UI files increase regression and consistency risk                          | Medium   | Medium     |
|    9 | Bottom tab readability/touch-target risk on small screens                        | Medium   | Medium     |
|   10 | No long-duration low-resource endurance run in this review window                | Medium   | Medium     |

Detailed register: `tables/risk-register.md`.

### Verified vs inferred

Verified in this review:

- Web build/bundle outputs, including chunk sizes and warnings.
- Docker constrained runtime smoke (`512 MiB`, `2 CPU @ 2.0` limit) and health checks.
- Startup baseline metrics (Android emulator): TTFSC p50/p95 and startup-request budget checks.
- Unit and coverage runs (`1747` tests passed; global branch `82.05%`).
- Android JVM test run failure signatures.
- Targeted Playwright run failure signatures.
- Static code-path review across startup, connection, REST/FTP, HVSC ingest, native bridges, and UI layout surfaces.

Inferred or partially verified:

- Long-session memory leak behavior on web/mobile (no multi-hour endurance profile run completed here).
- Real-device thermal throttling/battery drain behavior (not measured on physical low-end Android/iOS devices).
- iOS low-memory warning handling under stress (static inspection only in this run).

## 2) Target baselines and mapping rationale

### Web Docker baseline reconciliation

- Concrete target from repo docs: Raspberry Pi Zero 2 W class with >=512 MiB RAM (`README.md`).
- Additional review constraint: artificial worst-case reference `<=512 MB RAM` and `2 cores @ 2 GHz`.
- Reconciliation used in this review:
  - Treat Pi Zero 2 W as **real deployment floor**.
  - Treat `512 MB + 2x2 GHz` as **capacity planning stress reference**.
  - Findings are reported against both: practical Pi-class operation and synthetic CPU headroom assumption.

### Android baseline

- Target baseline used: 5.5-inch class, 3 GB RAM, ~2 cores @ ~2 GHz.
- Review focus: small-screen density/readability, JS/WebView CPU pressure, lifecycle transitions, and memory headroom.

### iOS baseline (chosen)

- Selected baseline: **iPhone 6s**.
- Rationale: 2 GB RAM class, dual-core A9 (~1.84 GHz), and small display pressure.
- Mapping to Android baseline:
  - Less RAM than Android floor (more conservative memory pressure).
  - Similar CPU frequency class.
  - Smaller screen than Android baseline (stricter readability test).
- Details: `metrics/ios-baseline-rationale.md`.

## 3) Findings by category (with evidence)

### A. Performance and memory

1. Web payload size is high for constrained web deployments.

- Evidence: `logs/npm-run-build.log`, `tables/bundle-size-breakdown.md`.
- Main chunk ~1.22 MB minified + 1.65 MB wasm.

2. Docker low-memory smoke was healthy at idle, but this does not prove interaction endurance.

- Evidence: `metrics/docker-runtime-config.json`, `metrics/docker-stats-samples.txt`, `metrics/docker-healthz.json`.
- Idle RSS ~19-20 MiB under 512 MiB limit.

3. HVSC non-native path has explicit memory profiling but still uses in-memory buffers and extracted collections.

- Evidence: `src/lib/hvsc/hvscDownload.ts`, `src/lib/hvsc/hvscArchiveExtraction.ts`, `artifacts/static-hot-path-notes.md`.
- Risk is highest if native ingestion path is unavailable.

4. Startup metrics were within configured budgets in sampled Android baseline run.

- Evidence: `metrics/startup-baseline/startup-baseline.json`, `metrics/startup-budget-check.txt`, `metrics/startup-hvsc-safety-check.txt`.
- TTFSC p50 1520 ms, p95 2484 ms; startup network counters all zero in this sample.

### B. Stability and lifecycle correctness

1. Android background execution path is explicit and robustly structured (foreground service + wake lock), but may increase battery/thermal pressure.

- Evidence: `android/app/src/main/java/uk/gleissner/c64commander/BackgroundExecutionService.kt`.

2. iOS background execution plugin methods are no-op, creating parity risk vs Android behavior.

- Evidence: `ios/App/App/NativePlugins.swift`.

3. iOS app lifecycle handlers are present but largely default (no explicit heavy-state handling in background callbacks).

- Evidence: `ios/App/App/AppDelegate.swift`.

4. Discovery and interaction control paths include cancellation, backoff, and circuit logic, but complexity is high.

- Evidence: `src/lib/connection/connectionManager.ts`, `src/lib/deviceInteraction/deviceInteractionManager.ts`, `src/lib/c64api.ts`.

### C. Test coverage and flakiness

1. Unit test depth is strong; branch gate passes with minimal margin.

- Evidence: `logs/npm-run-test.log`, `logs/npm-run-test-coverage.log`, `metrics/coverage-summary.txt`.
- 206 files and 1747 tests passed; branch 82.05%.

2. Web server branch coverage remains low despite global pass.

- Evidence: `logs/npm-run-test-coverage.log` (`web/server/src/index.ts` branch ~58.1%).

3. Android JVM native tests are currently unreliable under current local toolchain.

- Evidence: `logs/android-gradlew-test.log`, `metrics/android-jvm-tests.txt`.
- Unsupported class file version causes broad failures.

4. Targeted Playwright run shows deterministic configuration failure (viewport guard), not flaky timing.

- Evidence: `logs/playwright-targeted.log`, `playwright/viewportValidation.ts`, `playwright.config.ts`.

5. Maestro flows show static timing/selector fragility patterns and historical failure artifacts, but no full matrix rerun in this review.

- Evidence: `tables/maestro-flaky-suspects.md`, `test-results/maestro/*` artifacts.

### D. UI consistency and small-screen readiness

1. Positive: dedicated overflow and dialog-boundary tests exist for narrow viewport scenarios.

- Evidence: `playwright/layoutOverflow.spec.ts`.

2. Risk: bottom tab labels at 10px and non-explicit touch-target minimum may reduce usability on 5.5-inch class devices.

- Evidence: `src/components/TabBar.tsx`, `src/index.css`, `tables/ui-consistency-audit.md`.

3. Large mixed-concern page files increase consistency drift probability.

- Evidence: `metrics/top-file-line-counts.txt`.

### E. Web Docker distribution readiness

1. Docker image and constrained-run smoke are functional.

- Evidence: `logs/npm-run-docker-web-build.log`, `logs/docker-container.log`, `metrics/docker-runtime-config.json`.

2. Production risk remains due payload size and low-coverage high-complexity server file.

- Evidence: `tables/bundle-size-breakdown.md`, `tables/top-suspect-modules.md`, `logs/npm-run-test-coverage.log`.

## 4) Evidence appendix

### Required outputs

- Risk register: `tables/risk-register.md`
- Coverage matrix: `tables/coverage-matrix.md`
- Command chronology: `logs/commands-run.md`

### Additional tables

- Bundle breakdown: `tables/bundle-size-breakdown.md`
- Top suspect modules: `tables/top-suspect-modules.md`
- Maestro flakiness suspects: `tables/maestro-flaky-suspects.md`
- UI consistency audit: `tables/ui-consistency-audit.md`

### Supporting metrics/logs

- Build log: `logs/npm-run-build.log`
- Unit tests: `logs/npm-run-test.log`
- Coverage run: `logs/npm-run-test-coverage.log`
- Android JVM tests: `logs/android-gradlew-test.log`
- Playwright targeted: `logs/playwright-targeted.log`
- Docker build/run: `logs/npm-run-docker-web-build.log`, `logs/docker-container.log`
- Startup baseline: `metrics/startup-baseline/startup-baseline.json`
- Runtime notes: `metrics/web-runtime-notes.md`, `metrics/android-jvm-tests.txt`, `metrics/coverage-summary.txt`

### Screenshots

- `screenshots/playwright-navigationBoundaries-viewport-failure.png`
- `screenshots/playwright-webPlatformAuth-health-success.png`
- `screenshots/playwright-ui-home-open-android-phone.png`
- `screenshots/playwright-playlist-view-all-filtered.png`
- `screenshots/maestro-home.png`
- `screenshots/maestro-hvsc-controls.png`

## 5) Recommended follow-up backlog (do not implement here)

| Priority | Follow-up                                                                              | Expected impact                                                 | Effort | Validation strategy                                                          | Rollback risk |
| -------: | -------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------- | ------------- |
|        1 | Fix Android JVM test toolchain compatibility (JaCoCo/ASM + JDK alignment)              | Restores native regression signal in CI/local                   | M      | Re-run `cd android && ./gradlew test`; require zero infra-related failures   | Low           |
|        2 | Reduce initial web payload (split heavy HVSC/7z paths; verify lazy load boundaries)    | Faster cold start on Pi-class targets; less parse/exec pressure | M/L    | Compare bundle table before/after; rerun startup/perf smoke under 512MB cap  | Medium        |
|        3 | Resolve Playwright viewport guard/project mismatch                                     | Restores trust in web E2E gating                                | S      | Re-run failed suite and ensure deterministic pass on intended projects       | Low           |
|        4 | Raise coverage on `web/server/src/index.ts` auth/proxy branches                        | Lowers production regression risk in web runtime                | M      | Add branch-focused tests around auth lockout/session/FTP host constraints    | Low           |
|        5 | Add long-duration constrained endurance scenario (web + Android)                       | Validates leak/churn/ANR risk under realistic load              | M      | 1-2 hour scripted run; collect memory/CPU snapshots and failure counts       | Low           |
|        6 | Define iOS parity strategy for background execution behavior                           | Reduces cross-platform UX/state divergence                      | M      | Add explicit contract tests and lifecycle simulation checks in iOS CI        | Medium        |
|        7 | Harden small-screen nav touch/readability (tab labels/targets)                         | Better usability on 5.5-inch class devices                      | S      | Add Playwright assertions for min target size and text legibility thresholds | Low           |
|        8 | Normalize Maestro selectors for high-risk flows (prefer stable IDs where possible)     | Reduces false failures from text/animation timing               | M      | Re-run tagged Maestro suites multiple times on CI device profile             | Low           |
|        9 | Add explicit field observability counters (memory warnings, retry storms, queue depth) | Improves production diagnosis and rollback confidence           | M      | Verify diagnostics export contains new counters under stress tests           | Low           |
|       10 | Refactor highest-size mixed-concern UI files in small increments                       | Improves maintainability and test precision                     | M/L    | Track defect rate + per-file coverage improvements after split               | Medium        |

## Reproducibility

Environment assumptions and versions: `metrics/environment-snapshot.md`.

Primary commands are logged in chronological form: `logs/commands-run.md`.

Key executed commands in this review set:

- `npm run build`
- `npm run build:web-server`
- `npm run docker:web:build`
- Docker constrained run with `--memory=512m --memory-swap=512m --cpus=2`
- `npm run test`
- `npm run test:web-platform`
- `npm run test:coverage`
- `cd android && ./gradlew test`
- `node scripts/startup/collect-android-startup-baseline.mjs --loops=3 --serial=emulator-5554 --outDir=doc/research/review-3/metrics/startup-baseline`
- `npx playwright test --project=web ...` (targeted suite; see log)
