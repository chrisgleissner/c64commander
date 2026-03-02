# Coverage Remediation Execution Contract

## Objective

Raise Codecov-reported overall coverage (README badge metric) from ~80% to >=95% while preserving correctness and keeping CI green.

## Baseline Snapshot (Codecov-relevant, merged web coverage)

Collection command: `PLAYWRIGHT_PORT=4273 npm run test:coverage:all`

- Unit LCOV (`coverage/lcov.info`):
  - Line: 94.35% (5580/5914)
  - Branch: 90.16% (2153/2388)
- Playwright E2E LCOV (`coverage/e2e/lcov.info`):
  - Line: 71.98% (11235/15609)
  - Branch: 57.74% (5037/8724)
- Merged LCOV uploaded to Codecov (`coverage/lcov-merged.info`):
  - Line: 80.81% (14767/18274)
  - Branch: 64.87% (7195/11091)

## Coverage Propagation Model (what affects README/Codecov)

- Primary metric source: Codecov upload from `.github/workflows/android.yaml` job `web-coverage-merge`.
- Upload artifact: `coverage/lcov-merged.info` (unit + Playwright NYC merge).
- CI gate alignment fix applied: `COVERAGE_FILE` updated from `coverage/lcov.info` to `coverage/lcov-merged.info`.
- Maestro status:
  - iOS Maestro flows currently validate product behavior and evidence, but do not emit JS LCOV consumed by Codecov.
  - They impact release confidence, not current README badge percentage.

## Per-Subsystem Baseline (lowest merged coverage first)

- `src/lib/deviceInteraction/*`: 38.41% line / 19.61% branch (high risk)
- `src/lib/observability/*`: 40.00% / 16.67% (medium-high risk)
- `src/pages/SettingsPage.tsx`: 48.10% / 43.90% (high risk)
- `src/lib/native/*`: 57.06% / 35.71% (high risk)
- `src/lib/hvsc/*`: 60.83% / 42.02% (high risk)
- `src/lib/c64api.ts`: 71.11% / 55.88% (critical branch risk)
- `src/pages/home/*`: 74.64% / 67.14% (high user-impact)

## Lowest-Coverage Files (ranked)

1. `src/lib/diagnostics/networkSnapshot.ts` — 5.71% / 0.00%
2. `src/pages/home/components/MachineControls.tsx` — 14.29% / 84.62%
3. `src/lib/config/settingsTransfer.ts` — 14.67% / 0.00%
4. `src/lib/diagnostics/webServerLogs.ts` — 17.65% / 6.25%
5. `src/lib/diagnostics/nativeDebugSnapshots.ts` — 22.81% / 5.26%
6. `src/lib/deviceInteraction/deviceInteractionManager.ts` — 26.07% / 3.31%
7. `src/lib/native/secureStorage.web.ts` — 26.47% / 0.00%
8. `src/lib/diagnostics/diagnosticsExport.ts` — 33.33% / 43.48%
9. `src/lib/native/diagnosticsBridge.ts` — 36.00% / 0.00%
10. `src/lib/observability/sentry.ts` — 40.00% / 16.67%

## Coverage Buckets

- Files below 70% line coverage: 38
- Files between 70% and 85% line coverage: 43
- Files with low branch coverage (<70%) despite non-trivial line coverage: 84

## Highest Uncovered Branch Concentrations

- `src/lib/c64api.ts` (165 uncovered branches)
- `src/components/disks/HomeDiskManager.tsx` (148)
- `src/lib/deviceInteraction/deviceInteractionManager.ts` (117)
- `src/lib/hvsc/hvscDownload.ts` (98)
- `src/lib/hvsc/hvscIngestionRuntime.ts` (96)
- `src/pages/SettingsPage.tsx` (92)

## Risk Classification

- High: core API and state orchestration (`c64api`, device interaction, settings page, home actions, disk manager).
- Medium: diagnostics export/snapshot and native bridge wrappers.
- Low: UI-only wrappers with simple rendering logic once branch matrix is validated.

## Untested Branch Themes

- Error and timeout propagation (`networkSnapshot`, `webServerLogs`, `settingsTransfer`).
- Platform guards and native/web bridge divergence (`secureStorage.web`, diagnostics bridge).
- Multi-step async orchestration with fallback behavior (`deviceInteractionManager`, HVSC download/runtime).
- State transition combinatorics in major pages (`SettingsPage`, `HomeDiskManager`, `PlayFilesPage`).

## High-Value Test Candidates

1. Playwright: diagnostics pathways to execute network snapshot, web logs, native debug snapshot read/export behavior.
2. Playwright: settings transfer workflows covering import/export failures and success paths.
3. Unit: pure error-handling modules (`networkSnapshot`, `settingsTransfer`, `webServerLogs`) with deterministic fault injection.
4. Unit + integration-style hook tests: `deviceInteractionManager` and `useHomeActions` branch matrix.
5. Playwright: settings and home edge-path interaction matrices for branch-heavy UI logic.

## Strategy by Test Layer

- Unit (fast branch gain): cover pure logic, failure branches, serialization/validation paths.
- Playwright (merged metric gain): ensure all executed E2E specs persist NYC output; add targeted flows for currently cold branches.
- Maestro (quality gate support): keep as behavioral guardrails; no direct LCOV contribution in current pipeline.

## CI Workflows Impacted

- `.github/workflows/android.yaml`
  - `web-unit`
  - `web-e2e`
  - `web-coverage-merge`
  - Codecov upload step (`c64-commander-web-coverage`)
- `.github/workflows/web.yaml` (web platform behavior; indirect confidence)
- `.github/workflows/ios.yaml` (Maestro validation; non-LCOV today)

## Iteration Log

- Added missing Playwright NYC persistence hooks to:
  - `playwright/accessibility.spec.ts`
  - `playwright/buttonHighlightProof.spec.ts`
  - `playwright/debugDemo.spec.ts`
  - `playwright/verifyUserTracing.spec.ts`
  - `playwright/video.spec.ts`
  - `playwright/webPlatformAuth.spec.ts`
- Added branch-focused unit tests:
  - `tests/unit/lib/diagnostics/networkSnapshot.test.ts`
  - `tests/unit/lib/diagnostics/webServerLogs.test.ts`
  - `tests/unit/lib/diagnostics/actionSummaries.test.ts`
- Aligned CI threshold input with merged coverage artifact:
  - `.github/workflows/android.yaml` now enforces threshold on `coverage/lcov-merged.info`.
- Coverage delta after current iteration:
  - Merged line coverage: `80.69% -> 80.81%`
  - Merged branch coverage: `64.70% -> 64.87%`

## Exit Criteria

Complete only when all are true:

1. Codecov overall >=95% (README badge metric).
2. CI workflows green (unit/e2e/build/lint/platform jobs).
3. No flaky additions (stable repeated test runs).
4. No skipped tests added without explicit, justified reason.
5. `PLANS.md` updated with final coverage deltas and remaining risk = none/accepted.
