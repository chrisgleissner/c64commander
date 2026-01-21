# CI + Coverage Progress Log

## Local verification summary
- 2026-01-21: Ran ./scripts/collect-coverage.sh (unit + e2e + merge)
  - Unit coverage (Vitest): 71.73% lines (from vitest output)
  - E2E coverage (nyc report): 78.6% lines (coverage/e2e/lcov.info)
  - Merged coverage (coverage/lcov-merged.info): 80.12% lines (4268 / 5327)
  - Artifacts present: coverage/lcov.info, coverage/e2e/lcov.info, coverage/lcov-merged.info, coverage/e2e/lcov-report/index.html

- 2026-01-21: Re-ran after additional unit tests
  - Merged coverage (coverage/lcov-merged.info): 80.12% lines (4268 / 5327)

- 2026-01-21: Android unit tests + Jacoco
  - Command: JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 ./gradlew testDebugUnitTest jacocoTestReport
  - Result: BUILD SUCCESSFUL

## Evidence collection
- Playwright evidence generation validated via finalizeEvidence hooks.

## CI timings
- Workflow emits per-step durations to GITHUB_STEP_SUMMARY for before/after comparison.

### Timing table (local logs)

Baseline (user-reported): ~10 minutes CI wall time.

Latest local run (./scripts/collect-coverage.sh):
- Unit tests with coverage: ~6s (vitest duration)
- Playwright E2E with coverage: ~3.0m (playwright run duration)
- Merge coverage: <1s

CI timing capture:
- Each job writes step durations to GITHUB_STEP_SUMMARY to compare against the baseline.
