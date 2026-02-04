# PLANS.md - Authoritative Execution Plan

## Mission
Implement (or verify existing implementation of) sticky real-device connectivity and the Diagnostics Actions tab with deterministic Action Summaries, plus tests and full verification until CI is green.

## Phase 0: Spec ingestion (mandatory)

### Actions
- [x] Locate tracing spec under doc/diagnostics (resolved: doc/diagnostics/tracing-spec.md).
- [x] Locate action summary spec under doc/diagnostics (resolved: doc/diagnostics/action-summary-spec.md).
- [x] Read both specs in order and capture key normative requirements here.

### Notes (normative summary)
- Tracing spec: single in-memory trace session per process; deterministic IDs; correlation per action; exactly one backend-decision per correlation; targets limited to internal-mock/external-mock/real-device; do not change envelope or semantics; export is zip with trace.json + app-metadata.json.
- Action summary spec: group by correlationId; one summary per action; action-start + action-end required for complete; derive REST/FTP effects from trace events only; summary origin mapping: HUMAN for user, MACHINE for automatic/system; outcome from action-end.status; deterministic ordering; projection only.
- Task-specific UI overrides for Actions tab: HUMAN green, MACHINE blue; REST badge purple; FTP badge brown; ERROR badge red.

## Phase 1: Code path discovery

### Actions
- [x] Identify backend target selection + fallback code path (REST/FTP routing).
- [x] Identify diagnostics tabs definition and Traces UI implementation.
- [x] Identify trace buffer store + clear/export/redaction implementation.
- [x] Record file paths here once found.

### Notes (paths)
- Backend selection/fallback: src/lib/connection/connectionManager.ts, src/lib/tracing/traceTargets.ts, src/lib/c64api.ts
- Diagnostics tabs: src/pages/SettingsPage.tsx
- Trace buffer + export/redaction: src/lib/tracing/traceSession.ts, src/lib/tracing/traceExport.ts
- Action summary derivation: src/lib/diagnostics/actionSummaries.ts

## Phase 2: Task A - Sticky real-device connectivity

### Actions
- [x] Verify in-memory sticky flag set only on confirmed real-device connected/ready (connectionManager: transitionToRealConnected).
- [x] Verify backend target selection prevents mock fallback while sticky is true (traceTargets resolves real-device).
- [x] Verify discovery loop cannot override sticky state (demo transition is blocked when sticky).
- [x] Verify backend-decision reasons remain within spec (reachable/fallback).

### Tests
- [x] Unit tests cover sticky lock behavior in trace target selection (tests/unit/tracing/traceTargets.test.ts).

## Phase 3: Task B - Action Summary derivation

### Actions
- [x] Verify pure derivation module maps trace events → Action Summary view models (src/lib/diagnostics/actionSummaries.ts).
- [x] Verify grouping, origin mapping, outcomes, and REST/FTP effects per spec.
- [x] Verify deterministic error count derivation (error events preferred, action-end error as fallback).

### Tests
- [x] Unit tests for derivation (tests/unit/diagnostics/actionSummaries.test.ts).

## Phase 4: Task B - Actions tab UI

### Actions
- [x] Verify Diagnostics tab labeled Actions with parity controls (clear/export/redacted) (src/pages/SettingsPage.tsx).
- [x] Verify list view badges/colors and collapsible rows.
- [x] Verify expanded details include action metadata + REST/FTP effects.

### Tests
- [x] Playwright test: Actions tab visible and reachable (playwright/diagnosticsActions.spec.ts).
- [x] Playwright test: badge counts and expanded details for seeded trace fixture.

## Phase 5: Verification

### Actions
- [ ] Run unit tests (npm run test).
- [ ] Run lint (npm run lint).
- [ ] Run build (npm run build).
- [ ] Run any required e2e tests (npm run test:e2e).
- [ ] Run full build helper (./build) and fix failures.

### Verification
- [ ] All tests pass.
- [ ] Lint/typecheck pass.
- [ ] Build passes.
- [ ] CI green on default branch.
