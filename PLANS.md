# PLANS.md - Authoritative Execution Plan

## Mission
Implement sticky real-device connectivity and a new Diagnostics Actions tab with deterministic Action Summaries, plus tests and full verification until CI is green.

## Phase 0: Spec ingestion (mandatory)

### Actions
- [x] Locate tracing spec under doc/diagnostics (resolved: doc/diagnostics/tracing-spec.md).
- [x] Locate action summary spec under doc/diagnostics (resolved: doc/diagnostics/action-summary-spec.md).
- [x] Read both specs in order and capture key normative requirements here.

### Notes (normative summary)
- Tracing spec: one in-memory trace session per process, deterministic IDs, correlation per action, exactly one backend-decision per correlation, targets limited to internal-mock/external-mock/real-device, do not change envelope or semantics.
- Action summary spec: group by correlationId, one summary per action, requires action-start + action-end, derive REST/FTP effects from events only, summary origin mapping: HUMAN for user, MACHINE for automatic/system, outcome from action-end.status, deterministic ordering, projection only.
- UI visual encoding in this task supersedes spec colors (task-specific: HUMAN green, MACHINE blue, REST purple, FTP brown, ERROR red). Use task requirements while keeping spec semantics.

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

## Phase 2: Task A - Sticky real-device connectivity

### Actions
- [x] Add in-memory sticky flag set only on confirmed real-device connected/ready.
- [x] Gate backend target selection to prevent any mock fallback while sticky is true.
- [x] Ensure background discovery loop does not override sticky state.
- [x] Maintain backend-decision event semantics with allowed reason.

### Tests
- [x] Unit test: once sticky enabled, backend-decision stays real-device even after failures/timeouts.
- [x] Unit/integration test: no routing to internal/external mock after sticky enabled.
- [x] Trace-based assertion (if used) respects trace normalization rules.

## Phase 3: Task B - Action Summary derivation

### Actions
- [x] Implement pure derivation module: trace events → Action Summary view models.
- [x] Ensure grouping, origin mapping, outcomes, and REST/FTP effects per spec.
- [x] Define deterministic error count derivation and document in code.

### Tests
- [x] Unit tests for derivation (grouping, counts, outcomes, error rules).

## Phase 4: Task B - Actions tab UI

### Actions
- [x] Add Diagnostics tab labeled Actions with parity controls (clear/export/redacted).
- [x] Reuse Traces clear/export/redaction logic.
- [x] Build Actions list view with required badges/colors and collapsible rows.
- [x] Expanded details for action metadata + REST/FTP effects.

### Tests
- [x] Playwright test: Actions tab visible and reachable.
- [x] Playwright test: badge counts and expanded details for known trace fixture/action.

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
