# PLANS: Review-3 Production Readiness Audit

## Mission
Deliver an evidence-driven production-readiness review for C64 Core Commander without modifying production code. Final outputs must be written under `doc/research/review-3/` and include `REPORT.md`, required tables, metrics, logs, and artifacts.

## Hard Rule
- No production code changes are allowed.
- Allowed edits are limited to:
  - `PLANS.md`
  - files under `doc/research/review-3/`

## Stage 0: Setup and Guardrails
Status: `completed`

### Tasks
- Create/verify artifact directories:
  - `doc/research/review-3/artifacts/`
  - `doc/research/review-3/metrics/`
  - `doc/research/review-3/logs/`
  - `doc/research/review-3/screenshots/`
  - `doc/research/review-3/tables/`
- Initialize command chronicle in `doc/research/review-3/logs/commands-run.md`.
- Capture environment snapshot (tool versions, OS, Node, npm, Java if present).

### Checkpoint
- Artifact tree exists and command log has first entries.

### Acceptance Criteria
- All required directories exist.
- Repro environment details captured.

## Stage 1: Architecture + Hot-Path Mapping (Static)
Status: `completed`

### Tasks
- Read architecture-critical files and map top sensitive flows:
  - startup/first interactive
  - navigation among main pages
  - discovery/connection lifecycle
  - REST + FTP interaction patterns
  - HVSC/large ingest paths
  - dense rendering surfaces (Home/Play lists)
- Produce suspect module inventory and risk hypotheses.

### Data Capture
- `doc/research/review-3/tables/top-suspect-modules.md`
- Notes in `doc/research/review-3/artifacts/static-hot-path-notes.md`

### Checkpoint
- Each required flow mapped to concrete files/components.

### Acceptance Criteria
- Every target flow includes involved components, potential bottlenecks, memory/I-O notes.

## Stage 2: Empirical Web + Docker Readiness Analysis
Status: `completed`

### Tasks
- Build and inspect bundle/chunks.
- Measure startup and key timing proxies available in existing scripts.
- Review web server runtime configuration and memory behavior assumptions.
- Assess low-resource constraints:
  - concrete Pi Zero 2 W target
  - artificial worst-case reference `<=512 MB RAM`, `2 cores @ 2 GHz`

### Commands (planned)
- `npm run build`
- `npm run build:web-server`
- `npm run startup:baseline` (if runnable)
- `npm run test:web-platform` (if useful)
- inspect `dist/` and `web/server/`

### Data Capture
- `doc/research/review-3/metrics/web-bundle-sizes.txt`
- `doc/research/review-3/metrics/web-runtime-notes.md`
- optional exported artifacts in `doc/research/review-3/artifacts/`

### Checkpoint
- Bundle and runtime observations recorded with evidence.

### Acceptance Criteria
- Web Docker section includes verified measurements + explicit gaps.

## Stage 3: Android + iOS Runtime Risk Review
Status: `completed`

### Tasks
- Android: review Capacitor bridge overhead surfaces, lifecycle transitions, memory-pressure risk points, JSON payload handling.
- iOS: review WKWebView + bridge lifecycle constraints and platform-specific pitfalls from source + existing CI/workflows.
- Select and justify a low-resource iOS baseline comparable to Android baseline.

### Commands (planned)
- `npm run cap:build` (if feasible)
- `cd android && ./gradlew test`
- `npm run ios:build:sim` (if feasible in environment)
- inspect native plugin code under `android/` and `ios/`.

### Data Capture
- `doc/research/review-3/metrics/android-jvm-tests.txt`
- `doc/research/review-3/metrics/ios-baseline-rationale.md`
- logs excerpts in `doc/research/review-3/artifacts/native-risk-notes.md`

### Checkpoint
- Android/iOS findings grounded in code and runnable evidence where possible.

### Acceptance Criteria
- Baseline mapping and lifecycle/perf risk statements marked verified vs inferred.

## Stage 4: Test Adequacy + Flakiness Investigation
Status: `completed`

### Tasks
- Inventory all test layers (unit, Playwright, Maestro, Android JVM, fuzz, coverage gates).
- Build feature-to-test matrix.
- Run representative suites and coverage.
- Identify flaky patterns (timeouts, sleeps, race-sensitive selectors, nondeterminism).

### Commands (planned)
- `npm run test`
- `npm run test:e2e` (or scoped subset if full run is infeasible)
- `npm run test:coverage`
- inspect Maestro and Playwright configs/flows.

### Data Capture
- `doc/research/review-3/tables/coverage-matrix.md`
- `doc/research/review-3/tables/maestro-flaky-suspects.md`
- `doc/research/review-3/metrics/coverage-summary.txt`

### Checkpoint
- Coverage matrix and flakiness suspects fully populated.

### Acceptance Criteria
- Gaps are concrete, prioritized, and tied to features and risk.

## Stage 5: UI Consistency + Small-Screen Readability Scrub
Status: `completed`

### Tasks
- Audit visual consistency across pages/components against UX guidelines.
- Focus on 5.5-inch screen constraints: typography, spacing, truncation, touch target size, loading/error consistency.
- Use available screenshots and test artifacts; generate additional snapshots if feasible.

### Data Capture
- `doc/research/review-3/tables/ui-consistency-audit.md`
- screenshots under `doc/research/review-3/screenshots/`

### Checkpoint
- High-value small-scope consistency follow-ups identified.

### Acceptance Criteria
- No major refactor proposals; recommendations are incremental and specific.

## Stage 6: Production Rollout Risk Register
Status: `completed`

### Tasks
- Consolidate crash, memory, performance, network resilience, and observability risks.
- Add severity, likelihood, evidence, and mitigation proposals.

### Data Capture
- `doc/research/review-3/tables/risk-register.md`

### Checkpoint
- Top-10 ordered risks ready for executive summary.

### Acceptance Criteria
- Each risk has evidence path and clear rationale.

## Stage 7: Final Report Synthesis
Status: `completed`

### Tasks
- Write `doc/research/review-3/REPORT.md` with all required sections:
  - executive summary + top 10 risks
  - verified vs inferred statements
  - baseline rationale/mapping
  - findings by category with evidence
  - evidence appendix with links
  - prioritized follow-up backlog (impact, effort, validation, rollback risk)
  - reproducibility section with commands/environment assumptions
- Internal consistency check across all artifacts.

### Checkpoint
- Report references existing artifact files only.

### Acceptance Criteria
- Report is complete, evidence-backed, and reproducible.

## Investigation Risks and Mitigations
- Risk: local environment cannot run Android/iOS/Docker profiling fully.
  - Mitigation: mark as partial verification, capture static evidence, and define explicit follow-up experiments.
- Risk: long-running suites exceed time budget.
  - Mitigation: run targeted representative subsets and clearly document limits.
- Risk: noisy/dirty worktree from concurrent agents.
  - Mitigation: do not revert unrelated changes; confine edits to approved paths.

## Progress Ledger
- 2026-02-18: Stage 0 started.
- 2026-02-18: Stage 0 completed (artifact tree + command log + environment snapshot).
- 2026-02-18: Stage 1 started.
- 2026-02-18: Stage 1 completed (hot-path mapping + suspect module table + static notes).
- 2026-02-18: Stage 2 completed (web build + Docker constrained runtime + startup baseline metrics consolidated).
- 2026-02-18: Stage 3 completed (Android/iOS native risk review + iOS baseline rationale captured).
- 2026-02-18: Stage 4 completed (unit + coverage + targeted Playwright + flakiness matrix artifacts).
- 2026-02-18: Stage 5 completed (small-screen/readability audit + screenshot bundle).
- 2026-02-18: Stage 6 completed (prioritized risk register with evidence links).
- 2026-02-18: Stage 7 completed (`REPORT.md` synthesized with reproducibility appendix and follow-up backlog).
