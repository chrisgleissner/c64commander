# Review 3 Implementation Plan (Autonomous Multi-Phase)

Date baseline: 2026-02-18  
Source findings: `docs/research/review-3/REPORT.md`

## Purpose

Execute a productionization program that fixes all issues identified in Review 3 across Android, iOS, and Web/Docker, with measurable quality and performance gates.

## Autonomous Agent Operating Contract

- Work autonomously for long-running sessions until all phases complete.
- Prefer smallest safe change set that closes each risk with evidence.
- Do not skip failing tests. Fix root cause.
- Keep repository buildable at every checkpoint.
- Preserve existing behavior unless a change is explicitly required by this plan.
- For each phase, update a running journal under `docs/research/review-3/implementation-journal.md`.

## Mandatory Constraints

- Follow repository instructions in `AGENTS.md` and `.github/copilot-instructions.md`.
- Before declaring done on any code-change phase, run:
  - `npm run test:coverage` and keep global branch coverage >= 82%.
  - Relevant platform test commands listed in each phase.
- No silent exception swallowing. Any catch must rethrow with context or log stack+context.

## Inputs

- `docs/research/review-3/REPORT.md`
- `docs/research/review-3/tables/risk-register.md`
- `docs/research/review-3/tables/coverage-matrix.md`
- `docs/research/review-3/metrics/*`
- `docs/research/review-3/logs/*`

## Final Outputs Required

- Code and tests implementing all accepted remediations.
- Updated docs for any changed behavior.
- New evidence bundle under `docs/research/review-3/post-fix/`:
  - `metrics/`
  - `logs/`
  - `tables/`
  - `screenshots/`
  - `SUMMARY.md`

## Global Acceptance Criteria

- All critical and high risks from `risk-register.md` are resolved or downgraded with evidence.
- Android JVM test layer is green in supported toolchain configuration.
- Web payload and startup behavior show measurable improvement for constrained targets.
- Playwright configuration failures are eliminated.
- Coverage remains >= 82% branches globally, with improved branch coverage on `web/server/src/index.ts`.
- At least one constrained endurance run is completed and documented.

## Phase 0: Baseline Lock and Repro Harness

Goal: establish reproducible starting point and prevent moving targets.

### Steps

1. Create branch and snapshot current baseline metrics/logs.
2. Create `docs/research/review-3/implementation-journal.md` with timestamped entries.
3. Re-run baseline commands to verify starting deltas.

### Commands

```bash
npm install
npm run build
npm run test
npm run test:coverage
npm run test:web-platform
cd android && ./gradlew test || true
```

### Artifacts

- `docs/research/review-3/post-fix/logs/phase-0-baseline.log`
- `docs/research/review-3/post-fix/metrics/phase-0-baseline-summary.md`

### Exit Criteria

- Baseline run is reproducible.
- Known failures are confirmed and documented.

## Phase 1: Fix Android JVM Test Toolchain (Critical Risk #1)

Goal: restore reliable Android native regression signal.

### Steps

1. Identify incompatibility between JDK, Gradle, JaCoCo/ASM, and Robolectric setup.
2. Align versions/configuration to supported combination.
3. Ensure tests are not disabled; remove only infra-caused breakage.
4. Verify full Android JVM suite passes.

### Commands

```bash
cd android
./gradlew -v
./gradlew clean test --stacktrace --info
```

### Implementation Notes

- Prefer build config/tooling fixes over test-content modifications.
- If CI uses a different Java version than local, standardize toolchain in Gradle config and CI.

### Artifacts

- `docs/research/review-3/post-fix/logs/phase-1-android-jvm.log`
- `docs/research/review-3/post-fix/metrics/phase-1-android-jvm-summary.md`

### Exit Criteria

- `cd android && ./gradlew test` exits 0.
- No broad infra-only failures remain.

## Phase 2: Unblock E2E Gate Reliability (High Risk #3)

Goal: eliminate deterministic Playwright configuration failures.

### Steps

1. Reconcile viewport validation policy with project/device definitions.
2. Ensure `web` project and mobile/tablet projects are validated correctly.
3. Re-run previously failing targeted suites.
4. Keep strict UI monitoring but avoid false positives.

### Commands

```bash
npx playwright test --project=web playwright/navigationBoundaries.spec.ts
npx playwright test --project=web playwright/webPlatformAuth.spec.ts
npm run test:e2e
```

### Artifacts

- `docs/research/review-3/post-fix/logs/phase-2-playwright.log`
- `docs/research/review-3/post-fix/screenshots/phase-2/`

### Exit Criteria

- Prior deterministic failures no longer occur.
- Full configured E2E suite passes or only non-regression known flakes remain with root-cause tickets.

## Phase 3: Web Payload and Startup Optimization (High Risk #2, #5)

Goal: reduce constrained-device startup and memory pressure.

### Steps

1. Profile bundle composition and identify largest startup-critical imports.
2. Move heavy HVSC/7z paths behind true lazy boundaries.
3. Validate that dynamic imports are effective (no static import leakage).
4. Rebuild and compare size/perf deltas.

### Commands

```bash
npm run build
npm run build:web-server
npm run docker:web:build
```

### Validation Experiments

1. Constrained Docker run at `512MB` and `2 CPUs`.
2. Measure startup timings and health readiness.
3. Compare idle and interaction memory profile before/after.

### Artifacts

- `docs/research/review-3/post-fix/tables/bundle-delta.md`
- `docs/research/review-3/post-fix/metrics/docker-constrained-after.txt`
- `docs/research/review-3/post-fix/logs/phase-3-web-opt.log`

### Exit Criteria

- Main startup-critical bundle reduced materially.
- Constrained-run metrics improve and remain stable.
- No functional regressions in HVSC workflows.

## Phase 4: Web Server Hardening and Branch Coverage Lift (High Risk #6)

Goal: improve confidence in auth/proxy surface and raise branch coverage.

### Steps

1. Add tests for untested branches in `web/server/src/index.ts`:
   - auth lockout edge cases
   - session expiry/cleanup paths
   - FTP host restriction behavior
   - proxy and static serve error paths
2. Refactor only when it simplifies testability without behavior changes.
3. Re-run web platform tests and coverage.

### Commands

```bash
npm run test:web-platform
npm run test:coverage
```

### Artifacts

- `docs/research/review-3/post-fix/tables/web-server-coverage-delta.md`
- `docs/research/review-3/post-fix/logs/phase-4-web-server.log`

### Exit Criteria

- `web/server/src/index.ts` branch coverage significantly improved from 58.1% baseline.
- No regression in web auth/proxy behavior.

## Phase 5: Cross-Platform Lifecycle Parity (High Risk #4)

Goal: reduce Android/iOS behavior divergence for background-sensitive flows.

### Steps

1. Define explicit parity contract for background execution semantics.
2. Implement iOS-side behavior consistent with product intent, or explicit feature gating with clear UX fallback.
3. Add tests validating lifecycle transitions and background scheduling expectations per platform.
4. Update docs to state supported behavior per platform.

### Commands

```bash
npm run test
npm run test:e2e
npm run ios:build:sim || true
```

### Artifacts

- `docs/research/review-3/post-fix/tables/platform-parity-matrix.md`
- `docs/research/review-3/post-fix/logs/phase-5-lifecycle.log`

### Exit Criteria

- Platform behavior differences are intentional, documented, and covered by tests.
- No silent no-op mismatch that can surprise users.

## Phase 6: UI Density and Small-Screen Readability Fixes (Medium Risks #8, #9)

Goal: improve 5.5-inch usability with small, low-risk changes.

### Steps

1. Set explicit minimum touch target sizes for bottom nav and key action controls.
2. Improve tab label readability without major layout disruption.
3. Add/extend Playwright layout assertions for target size and overflow.
4. Validate on phone and tablet projects.

### Commands

```bash
npx playwright test --project=android-phone playwright/layoutOverflow.spec.ts playwright/ui.spec.ts
npx playwright test --project=android-tablet playwright/layoutOverflow.spec.ts
```

### Artifacts

- `docs/research/review-3/post-fix/screenshots/phase-6/`
- `docs/research/review-3/post-fix/logs/phase-6-ui.log`

### Exit Criteria

- No new overflow regressions.
- Touch target and readability checks pass on targeted screen classes.

## Phase 7: Endurance and Observability Closeout (Medium Risk #10 + #7)

Goal: prove long-run stability and improve diagnosis paths.

### Steps

1. Create constrained endurance scenario for web and Android emulator.
2. Run for 1-2 hours with representative navigation/interaction loops.
3. Capture memory, CPU, retries, queue depth, and error rates.
4. Add lightweight diagnostics where blind spots remain.

### Commands

```bash
# Example skeleton; adapt to repository scripts
npm run docker:web:build
# run constrained container
# execute scripted interaction loop
# collect docker stats + app diagnostics over time
```

### Artifacts

- `docs/research/review-3/post-fix/metrics/endurance-web.md`
- `docs/research/review-3/post-fix/metrics/endurance-android.md`
- `docs/research/review-3/post-fix/logs/phase-7-endurance.log`

### Exit Criteria

- No leak/crash/ANR signatures in endurance window.
- Retry/backoff behavior remains bounded and explainable.

## Phase 8: Maestro Stability Hardening

Goal: reduce flakiness in high-risk flows while preserving coverage.

### Steps

1. Replace fragile selectors with stable identifiers where possible.
2. Remove avoidable static sleeps; use deterministic waits.
3. Re-run critical Maestro tagged suites multiple times.
4. Document residual flakes with root-cause and mitigation.

### Commands

```bash
./build --test-maestro-ci
./build --test-maestro-tags "+device,+file-picker,-slow"
```

### Artifacts

- `docs/research/review-3/post-fix/tables/maestro-stability-report.md`
- `docs/research/review-3/post-fix/logs/phase-8-maestro.log`

### Exit Criteria

- Critical Maestro suite stable across repeated runs.

## Phase 9: Final Quality Gate and Release Readiness

Goal: provide final pass/fail decision with evidence.

### Required Command Set

```bash
npm run lint
npm run test
npm run test:coverage
npm run test:web-platform
npm run test:e2e
npm run build
cd android && ./gradlew test
```

### Mandatory Thresholds

- Global branch coverage >= 82%.
- No failing critical/high-priority suites.
- Web constrained checks pass.

### Final Deliverables

- `docs/research/review-3/post-fix/SUMMARY.md`
- `docs/research/review-3/post-fix/tables/final-risk-status.md`
- `docs/research/review-3/post-fix/tables/before-after-kpis.md`

### Exit Criteria

- All critical/high risks from Review 3 are closed or downgraded with hard evidence.
- Remaining medium risks have explicit owner, mitigation, and follow-up plan.

## Work Sequencing and Dependency Order

1. Phase 0
2. Phase 1
3. Phase 2
4. Phase 3
5. Phase 4
6. Phase 5
7. Phase 6
8. Phase 7
9. Phase 8
10. Phase 9

## Autonomous Execution Loop (for LLM)

For each phase:

1. Restate phase goal and constraints.
2. Implement smallest coherent change set.
3. Run phase command set.
4. Save logs/metrics/screenshots under `post-fix/`.
5. Update journal with pass/fail and next action.
6. If gate fails, iterate immediately on root cause.

Stop only when all phase exit criteria are satisfied or a true external blocker is proven and documented.
