# Android Coverage Execution Contract

Last updated: 2026-02-15
Owner: Copilot coding agent
Branch: main
Authoritative source: Codecov

## Objective

Raise authoritative Android coverage in Codecov to **>= 92.00%** while keeping tests high-signal, realistic, and non-duplicative.

## Baseline

- Codecov project/branch coverage (main): **65.02%** (`290 / 446` lines covered)
- Source: https://app.codecov.io/gh/chrisgleissner/c64commander
- Exact target: **92.00%**
- Required delta from authoritative baseline: **+26.98 percentage points**

## High-level gap analysis

- Android coverage is concentrated in Kotlin production sources under `android/app/src/main/java/uk/gleissner/c64commander`.
- Current Codecov line totals indicate substantial uncovered paths in Android-side logic and branch-heavy flows.
- Highest-value likely gap areas (to verify with local reports and targeted tests):
  - Import/intent ingestion paths and invalid payload handling
  - Playlist/state transition branches triggered from native bridge calls
  - Disk collection and file-system related decision paths
  - Error/retry handling and network failure branches
  - Permission/Android lifecycle edge paths in native plugins and activity wiring

## File-level prioritization

1. Large logic-heavy Android modules with uncovered branches (especially `MainActivity.kt` and branch-heavy plugins)
2. Service-layer error branches (`BackgroundExecutionService.kt`, network/mock server logic)
3. Stateful plugin flows (`FtpClientPlugin.kt`, `MockC64UPlugin.kt`, `FolderPickerPlugin.kt`, `SecureStoragePlugin.kt`)
4. Smaller files only when they block target attainment with meaningful logic

## Task checklist

- [x] Replace/initialize this `PLANS.md` contract for Android coverage mission
- [ ] Establish local baseline (`./gradlew test` + coverage artifacts)
- [ ] Compare local baseline with Codecov authoritative baseline and document discrepancies
- [ ] Produce file-level undercoverage list (<85%)
- [ ] Produce logic-heavy module undercoverage list (<90%)
- [ ] Add high-value tests for real branch gaps (no trivial getter inflation)
- [ ] Re-run Android JVM tests after each batch
- [ ] Re-run repo-required validations (`npm run lint`, `npm run test`, `npm run build`, `./build`)
- [ ] Recompute local coverage and record progression
- [ ] Verify CI green and Codecov >= 92%
- [ ] Record final authoritative percentage and close checklist

## Verification criteria

- All relevant local validations pass:
  - `cd android && ./gradlew test`
  - `npm run lint`
  - `npm run test`
  - `npm run build`
  - `./build` (repo requirement)
- CI checks pass without skipped/failing critical suites.
- Codecov authoritative Android coverage reports **>= 92.00%**.
- Added tests assert meaningful behavior and branch outcomes.
- No production logic deleted merely to inflate coverage.

## Progress log

- 2026-02-15: Established authoritative external baseline from Codecov at 65.02% and created Android-specific execution contract.
