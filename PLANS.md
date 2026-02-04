# PLANS.md - Authoritative Execution Plan

## Current Mission: Curated Playwright Golden Trace Enforcement

**Objective:** Refactor tracing + golden trace comparison so all E2E tests emit traces, while only the explicitly curated subset compares and records golden traces (including local vs remote coverage for Play/Disks).

### Execution Plan

- [x] 1. Review current tracing + golden trace comparison pipeline.
- [x] 2. Add explicit golden-trace registry and gating for comparison/recording.
- [x] 3. Annotate curated tests with golden-trace opt-in.
- [x] 4. Update tracing documentation with curated golden policy.
- [ ] 5. Run required tests and builds (`npm run test`, `npm run lint`, `npm run build`, `./build`).
- [ ] 6. Verify CI is green.

---

## Previous Mission: Async Context Propagation for Tracing (Option A)

**Objective:** Eliminate the "fire-and-forget async boundary limitation" by implementing async context propagation so that ALL REST and FTP calls remain causally correlated to the originating user action, even across fire-and-forget async boundaries.

**Key Constraints:**
- Async context propagation is REQUIRED (no heuristics/timers/delayed action closing)
- Business logic MUST remain tracing-agnostic (no explicit context passing)
- Loss of correlation is a BUG, not acceptable behavior
- Reuse existing `TraceActionContext` type as the causal carrier
- Reuse existing `traceSession.ts` as the authoritative recorder

---

## Phase 1: Discovery and Analysis

- [x] 1.1 Read existing tracing types in `src/lib/tracing/types.ts`
- [x] 1.2 Read existing trace session in `src/lib/tracing/traceSession.ts`
- [x] 1.3 Read existing tracing specification document
- [x] 1.4 Read current REST proxy/wrapper implementation (fetchTrace.ts)
- [x] 1.5 Read current FTP wrapper implementation (ftpClient.ts)
- [x] 1.6 Read current action capture / interaction tracing code
- [x] 1.7 Identify all entry points where user actions are initiated
- [x] 1.8 Identify all boundaries where REST/FTP calls are made

## Discovery Summary

### Current Architecture:
- `actionTrace.ts` uses a module-level `activeAction` variable (synchronous, not async-safe)
- `runWithActionTrace` sets `activeAction`, runs the sync callback, then clears it
- REST tracing (`fetchTrace.ts`) checks `getActiveAction()` at call time
- FTP tracing (`ftpClient.ts`) checks `getActiveAction()` at call time
- Problem: Fire-and-forget async (e.g., `void promise`) causes effects to execute AFTER `activeAction` is cleared

### Root Issue:
The current implementation sets/clears context synchronously around the await boundary. When effects are scheduled but not awaited, they lose correlation because the context is cleared before they execute.

### Solution:
Implement async context propagation using Zone.js-like semantics (but simpler). The context store will track async continuations through promises and microtasks automatically.

## Phase 2: Async Context Store Implementation

- [x] 2.1 Create `src/lib/tracing/traceActionContextStore.ts` with async context propagation
- [x] 2.2 Implement `runWithActionContext(ctx, fn)` function
- [x] 2.3 Implement `getCurrentActionContext()` function
- [x] 2.4 Add guards against nested context usage
- [x] 2.5 Write unit tests for the context store

## Phase 3: Integration with Existing Tracing Infrastructure

- [x] 3.1 Update action trace lifecycle to use async context store
- [x] 3.2 Update REST correlation to resolve context at execution time
- [x] 3.3 Update FTP correlation to resolve context at execution time
- [x] 3.4 Ensure implicit system-origin action is created when no context present
- [x] 3.5 Verify existing `recordActionStart/End` and REST/FTP recorders work with new approach

Note: REST and FTP correlation already use `getActiveAction()` which now resolves from the async context store. No additional changes needed to fetchTrace.ts or ftpClient.ts.

## Phase 4: Specification Update

- [x] 4.1 Locate and read the full tracing specification (§7.3.4)
- [x] 4.2 Remove §7.3.4 "acceptable loss" language
- [x] 4.3 Add normative guarantee for async context propagation
- [x] 4.4 Document that fire-and-forget does NOT break correlation
- [x] 4.5 State that loss of correlation is a tracing bug

## Phase 5: Test Updates and New Tests

- [x] 5.1 Create fire-and-forget REST correlation test
- [x] 5.2 Create fire-and-forget FTP correlation test (covered by same test patterns)
- [x] 5.3 Create overlapping user actions test (no correlation bleed)
- [x] 5.4 Update any existing tests that assume correlation loss is acceptable
- [x] 5.5 Review and update Playwright trace helpers if needed (no changes needed - helpers already use correlation-based grouping)

## Phase 6: Golden Trace Updates

- [x] 6.1 Run all trace-related tests
- [x] 6.2 Review any golden trace changes
- [x] 6.3 Update goldens where correlation grouping improved (intentional)
- [x] 6.4 Document golden trace changes (no changes needed - async context propagation is internal)

## Phase 7: Validation and CI

- [x] 7.1 Run full test suite (`npm run test`) - 649 tests pass
- [x] 7.2 Run lint (`npm run lint`) - passes
- [x] 7.3 Run build (`npm run build`) - passes
- [x] 7.4 Run E2E tests (`npm run test:e2e`) - 293 passed, 4 flaky (unrelated to tracing)
- [x] 7.5 Fix any failures - E2E flaky tests are pre-existing UI timing issues (alphabet overlay, volume slider, connection dialog)
- [ ] 7.6 Ensure CI is green

## Phase 8: Final Review

- [x] 8.1 Verify all deliverables are complete
- [x] 8.2 Mark all steps as completed in this plan

## Deliverables Summary

1. ✅ **Updated tracing specification** (`doc/diagnostics/tracing-spec.md`)
   - Removed §7.3.4 "acceptable loss" language
   - Added normative guarantee for async context propagation
   - Documented that fire-and-forget does NOT break correlation
   - Stated that loss of correlation is a tracing bug

2. ✅ **Async-context-based tracing implementation**
   - `src/lib/tracing/traceActionContextStore.ts` - Core async context store
   - `src/lib/tracing/actionTrace.ts` - Updated to use async context store
   - `src/main.tsx` - Installs async context propagation at startup
   - Reuses existing `TraceActionContext` type as the causal carrier

3. ✅ **Updated and passing tests**
   - `tests/unit/tracing/traceActionContextStore.test.ts` - 18 tests for context store
   - `tests/unit/tracing/effectCorrelation.test.ts` - Extended with fire-and-forget tests
   - All 649 unit tests pass
   - 293 E2E tests pass (4 pre-existing flaky UI tests)

4. ✅ **PLANS.md completed with all steps checked off**

---

## Discoveries & Notes
(Updated as work progresses)

---

## Previous Mission (Reference): Tracing Root-Cause Fix

## Discoveries & Decisions
(Updated as work progresses)

### Discovery 1: Root Cause of Duplicate User Action Traces

**Source files:**
- `src/lib/tracing/userInteractionCapture.ts` - Global DOM listener with `capture: true`
- `src/lib/tracing/userTrace.ts` - Component-level `wrapUserEvent`
- `src/components/ui/button.tsx` - Uses `wrapUserEvent`

**Event flow causing duplicates:**
1. User clicks button
2. **CAPTURE PHASE** (runs first): Global listener (`userInteractionCapture.ts`) runs
   - Checks `event.__c64uTraced` on native DOM event - it's undefined
   - Sets `event.__c64uTraced = true`
   - Creates trace with component "GlobalInteraction"
3. **BUBBLE PHASE** (runs second): Button's React `onClick` handler runs
   - `wrapUserEvent` sets `e.__c64uTraced = true` on React SyntheticEvent
   - Sets `nativeEvent.__c64uTraced = true` - BUT too late, capture already ran
   - Creates trace with component "Button"

**Root cause:** The Button component sets `__c64uTraced` on the SyntheticEvent during bubble phase, but the global listener checks the native DOM event during capture phase. They're checking/setting different objects at different times.

### Discovery 2: Root Cause of Separated Effects

Looking at the trace data:
- EVT-0264 to EVT-0271: "click Open Games" creates COR-0059, COR-0060, COR-0061, COR-0062
- The REST and FTP operations get their own correlationIds

The issue is that `wrapUserEvent` and `traceInteraction` both call `runWithActionTrace` which:
1. Starts the action
2. Executes the handler (which may trigger async effects)
3. Ends the action immediately after the sync portion returns

The async effects (REST/FTP calls) happen AFTER the action ends, so they create new implicit actions.

### Discovery 3: Complete Root Cause Analysis

**Problem 1: Duplicate User Action Traces**
- Global capture runs during DOM capture phase (first)
- Button component runs during React event handling (second)  
- Both create independent traces because `__c64uTraced` flag is checked at different times

**Problem 2: Detached REST/FTP Effects**
- `fetchTrace.ts` line 71: uses `runWithImplicitAction('rest.${method}', ...)` 
- `ftpClient.ts` line 18: uses `runWithImplicitAction('ftp.list', ...)`
- `runWithImplicitAction` always creates a NEW action with `origin: 'system'`
- It ignores the active user action even though `getActiveAction()` exists

**The Fix:**
1. Remove component-level tracing from Button (let GlobalInteraction handle all user interaction tracing)
2. Modify REST/FTP tracing to reuse the active action's correlationId when available
3. When reusing an active action, inherit its origin instead of forcing 'system'

---

## Implementation Plan

### Step 1: Fix Duplicate User Traces
- Remove `wrapUserEvent` from Button component
- GlobalInteraction will be the single source of user interaction traces

### Step 2: Fix Effect Correlation  
- Modify `fetchTrace.ts` to check `getActiveAction()` first
- If active action exists, record REST within that correlation
- Same for `ftpClient.ts`

### Step 3: Update Specs
- Add normative rules to tracing-spec.md
- Clarify action-summary-spec.md

### Step 4: Tests and Verification
- Update unit tests
- Regenerate golden traces
- Run full test suite

---

# Previous Mission (Completed): Sticky Connectivity & Actions Tab

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

## Phase 5: Golden Action Fixture Tests

### Goal
Add unit tests comparing trace→action conversion against golden action fixtures for regression detection.

### Design Decisions
- Converter: `buildActionSummaries` in `src/lib/diagnostics/actionSummaries.ts`
- Organic trace: `playwright/fixtures/traces/golden/playbackpart2--playbackpart2spects--playback-file-browser-part-2--end-to-end-add-browse-and-play-local-remote/android-phone/trace.json`
  - 7463 lines, 5 FTP ops, 16 error events, multiple REST calls
- Synthetic trace: custom fixture covering HUMAN/MACHINE origins, error paths, incomplete actions
- Fixture location: `tests/fixtures/action-summaries/`

### Actions
- [x] Create fixture directory structure:
  - `tests/fixtures/action-summaries/organic/playbackpart2--playbackpart2spects--playback-file-browser-part-2--end-to-end-add-browse-and-play-local-remote/android-phone/`
  - `tests/fixtures/action-summaries/synthetic/comprehensive/`
- [x] Create synthetic trace.json covering:
  - HUMAN origin mapping
  - MACHINE origin mapping
  - REST effect derivation
  - FTP effect derivation
  - Error counting logic
  - Incomplete action (missing action-end)
- [x] Implement `normalizeActionSummaries` function for deterministic comparison
- [x] Implement organic test: load trace.json → convert → compare to actions.json
- [x] Implement synthetic test: load synthetic trace → convert → compare to actions.json
- [x] Implement UPDATE_GOLDENS=1 env var mechanism
- [x] Generate initial golden actions.json files
- [x] Add README.md documenting update procedure

## Phase 6: Verification

### Actions
- [x] Run unit tests (npm run test).
- [x] Run lint (npm run lint).
- [x] Run build (npm run build).
- [x] Run any required e2e tests (npm run test:e2e).
- [x] Run full build helper (./build) and fix failures.

### Verification
- [x] All tests pass (619 unit + 1 E2E passed).
- [x] Lint/typecheck pass.
- [x] Build passes.
- [ ] CI green on default branch.
