# PLANS.md

## Coverage Execution Plan (active)

### Baseline (source of truth)
- **Source preference check**: GitHub Actions latest runs for branch `copilot/improve-test-coverage` are still in progress/queued, so no completed coverage artifact is available yet.
- **Baseline command**: `npm run test:coverage`
- **Baseline output file**: `coverage/lcov.info` and `/tmp/copilot-tool-output-1771763734642-fegg1g.txt`
- **Baseline overall line coverage**: **88.53%** (All files)
- **Gap to 92.00%**: **3.47 points**

### Prioritized below-92 targets (highest uncovered-line impact first)
1. `src/components/disks/HomeDiskManager.tsx` — 82.18% (275 uncovered)
2. `src/lib/c64api.ts` — 86.99% (200 uncovered)
3. `web/server/src/index.ts` — 72.46% (193 uncovered)
4. `src/pages/SettingsPage.tsx` — 87.15% (173 uncovered)
5. `src/pages/HomePage.tsx` — 77.93% (156 uncovered)
6. `src/lib/hvsc/hvscIngestionRuntime.ts` — 86.99% (119 uncovered)
7. `src/pages/home/hooks/useStreamData.ts` — 57.21% (92 uncovered)
8. `src/lib/connection/connectionManager.ts` — 82.95% (90 uncovered)
9. `src/lib/hvsc/hvscBrowseIndexStore.ts` — 77.17% (87 uncovered)
10. `src/lib/hvsc/hvscDownload.ts` — 82.43% (84 uncovered)

### Initial concrete test plan
- **Target A: `src/pages/home/hooks/useStreamData.ts`**
  - Behaviors/branches: validation failures (host/port/endpoint), successful commit path, start/stop happy-path and error-path, edit open/cancel, draft synchronization effect.
  - Approach: add focused hook unit tests with mocked `getC64API`, `useC64ConfigItems`, `toast`, and `reportUserError`.
  - Expected impact: raise this file substantially from 57% by covering currently untested control-flow branches.

- **Target B: `web/server/src/index.ts`**
  - Behaviors/branches: auth logout/status branches, secure-storage GET/DELETE branches, static serving edge cases (directory index, invalid path traversal), diagnostics method rejection, REST proxy upstream failure, FTP read/list errors and host-override denial.
  - Approach: extend existing `tests/unit/web/webServer.test.ts` with integration-style HTTP assertions.
  - Expected impact: meaningful rise in server branch and line coverage.

- **Target C: `src/lib/c64api.ts`**
  - Behaviors/branches: abort-aware helpers, fallback/parse warnings, error wrappers, and untested API helper methods.
  - Approach: extend `tests/unit/c64api.test.ts` with behavior-focused cases hitting uncovered lines/ranges.
  - Expected impact: improve one of the largest denominator contributors.

- **Target D: additional high-impact UI module tests (`HomeDiskManager.tsx` / `HomePage.tsx` / `SettingsPage.tsx`) as needed**
  - Behaviors/branches: currently uncovered error, toggle, and edge interaction paths.
  - Approach: extend existing page/component suites only after re-measuring post A-C.
  - Expected impact: close remaining gap to >=92%.

### Verification plan
1. Run targeted tests immediately after each file change.
2. Run `npm run test:coverage` after each batch and compare per-file deltas.
3. If overall is still below 92%, select next highest uncovered-line target and iterate.
4. Final proof: capture `All files` coverage line from coverage output showing **>=92.00%**.


## Iteration 1 results (current)
- Coverage command rerun: `npm run test:coverage`
- Updated overall line coverage: **88.80%** (from 88.53%, +0.27)
- Remaining gap to 92.00%: **3.20 points**

### Targeted file deltas (Iteration 1)
- `web/server/src/index.ts`: **72.46% -> 80.59%**
  - Added tests for secure-storage GET/DELETE + logout lifecycle, diagnostics route method handling, static directory and path traversal cases, REST proxy upstream failure, and FTP host override denial.
- `src/lib/c64api.ts`: **86.99% -> 88.35%**
  - Added upload failure-path tests for MOD/PRG/CRT helpers to validate error logging and exception behavior.
- `src/pages/home/hooks/useStreamData.ts`: unchanged at **57.20%** (attempted new tests were removed due local runner hang during focused execution; will revisit with a safer approach if needed).

### Next priority candidates
1. `src/components/disks/HomeDiskManager.tsx` (82.17%, 275 uncovered)
2. `src/pages/SettingsPage.tsx` (87.15%, 173 uncovered)
3. `src/pages/HomePage.tsx` (77.93%, 156 uncovered)
4. Additional `web/server/src/index.ts` branches (still below 92%)

