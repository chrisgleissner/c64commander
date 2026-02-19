# PLANS: Focused Hardening Audit and Auto-Closure

## Scope
Validate and harden (only where violated):
1. Visibility-driven config retrieval.
2. Minimal, non-blocking startup.
3. Deterministic capability detection and effect scaling.
4. No warnings/errors/unintended network activity during normal startup.

Repository: `/home/chris/dev/c64/c64commander`

## Execution model
- Phase A: Audit only (no behavior changes).
- Phase B: Minimal corrective changes for failed invariants.
- Phase C: Tests + verification + documented before/after diffs.

## Phase A audit status (completed)

### Environment and target
- Integration target: external mocked C64U at host `c64u`.
- Confirmed reachable: `http://c64u/v1/version`.
- Authoritative browser integration path: web platform proxy (`/api/rest`) to avoid CORS noise.

### Audit artifacts
- Raw preview-path baseline (CORS-noisy, diagnostic only):
  - `ci-artifacts/startup/hardening-audit-baseline.json`
- Authoritative proxy-path baseline:
  - `ci-artifacts/startup/hardening-audit-baseline-webplatform.json`
- Direct `/config` isolation run:
  - `ci-artifacts/startup/hardening-audit-config-direct.json`

### Measured startup timeline (proxy-path, baseline)
Source: `ci-artifacts/startup/hardening-audit-baseline-webplatform.json`
- First paint: `208 ms`
- First contentful paint: `208 ms`
- First REST request: `81 ms`
- Startup bootstrap milestone: `elapsedMs=435`
- Connection state by startup sample: `REAL_CONNECTED`

### Implemented capability/effect logic (as discovered)
- Capability/effect detection implemented in `src/lib/startup/runtimeMotionBudget.ts`:
  - Priority: user override → system reduced motion → low-end heuristic → default.
  - Low-end heuristic uses hardware concurrency, device memory, legacy Android user-agent check.
  - Applies deterministic DOM markers: `data-c64-motion-mode`, `c64-motion-reduced` class.
- Startup ordering implemented in `src/main.tsx`:
  - `initializeRuntimeMotionMode()` before initial render.
  - Deferred bootstrap (`registerTraceBridge`, `registerFetchTrace`, secure storage prime) scheduled after first paint/idle.

## Derived invariants and audit verdict

### A. Visibility-Driven Retrieval
- Invariant A1: `/config` route should fetch only category list until a section is expanded.
  - **FAIL**
  - Evidence: `ci-artifacts/startup/hardening-audit-config-direct.json`
  - Observed: before first expand, requests include many full category fetches (`/api/rest/v1/configs/<category>`), not just `/api/rest/v1/configs`.
- Invariant A2: No hidden/speculative full-config sweep on route entry.
  - **FAIL**
  - Evidence: same artifact.
  - Suspected code path: eager `fetchAllConfig()` in `src/hooks/useAppConfigState.ts`.

### B. Startup Discipline
- Invariant B1: First render occurs before non-essential work.
  - **PASS** (FCP at 208ms; heavy deferred bootstrap after render path).
- Invariant B2: No warnings/errors during normal startup.
  - **FAIL**
  - Evidence: `ci-artifacts/startup/hardening-audit-baseline-webplatform.json`
  - Observed warnings (2x): `Failed to parse fetch trace URL for filtering` for relative `/api/diagnostics/server-logs` URLs.

### C. Capability Awareness
- Invariant C1: Capability detection does not delay startup.
  - **PASS** (purely synchronous lightweight checks; no network/bridge dependency).
- Invariant C2: Override behavior deterministic.
  - **PASS** (explicit precedence implemented in code).

### D. Deterministic Behavior
- Invariant D1: Startup call graph explainable and stable.
  - **PARTIAL FAIL** due hidden full-config sweep and repeated route-entry fan-out.
  - Evidence: baseline proxy artifact + direct config artifact.

## Confirmed deviations to harden
1. Eager full-config snapshot retrieval (`fetchAllConfig`) triggers hidden requests before user intent.
2. Fetch tracing URL parser emits warnings for relative URLs.

## Phase B planned minimal fixes
1. Make initial snapshot capture in `useAppConfigState` demand-driven (no eager full sweep on connect).
2. Keep existing behavior for explicit snapshot-dependent actions by resolving snapshot lazily when needed.
3. Harden fetch tracing URL parsing to support relative URLs without warning noise.

## Phase C verification plan
- Add/extend automated tests to enforce:
  - `/config` pre-expand call graph excludes category subtree fetches.
  - Startup warning/error capture has zero warnings/errors for normal startup (proxy-path integration).
- Re-run baseline capture and produce explicit diffs:
  - startup call graph before vs after,
  - `/config` entry and expand/collapse call graph before vs after,
  - startup phase ordering before vs after.
- Run mandatory validation suite:
  - `npm run test:coverage` (target >= 82% branch coverage)
  - `npm run lint`
  - `npm run test`
  - `npm run build`

## Progress log
- 2026-02-19: Replaced previous unrelated plan with focused hardening audit plan.
- 2026-02-19: Completed audit measurements and invariant derivation.
- 2026-02-19: Identified two concrete, reproducible invariant violations and prepared minimal hardening actions.

## Phase B implementation status (completed)

### Applied minimal hardening changes
1. Demand-driven config route behavior:
  - `src/pages/ConfigBrowserPage.tsx`
  - Removed eager app config snapshot coupling via `useAppConfigState`.
  - Replaced with lightweight dirty-flag update using `updateHasChanges(runtimeBaseUrl, true)` on explicit save.
2. Route-entry invalidation churn reduction:
  - `src/App.tsx`
  - Removed route-change query invalidation path; retained visibility-resume invalidation.
3. Relative URL-safe tracing:
  - `src/lib/tracing/fetchTrace.ts`
  - Added URL parsing fallback base so relative URLs no longer emit parse warnings.

### Related tests updated/added
- Updated: `tests/unit/pages/ConfigBrowserPage.test.tsx`
- Added/expanded: `tests/unit/tracing/fetchTrace.test.ts`

## Phase C verification status (completed)

### After-state audit artifacts
- `ci-artifacts/startup/hardening-audit-after-webplatform.json`
- `ci-artifacts/startup/hardening-audit-config-direct-after.json`
- `ci-artifacts/startup/hardening-audit-diff.json`

### Before/after measured outcomes
1. Enter config from home call burst:
  - Before: `22` REST requests
  - After: `1` REST request
2. Direct `/config` pre-expand retrieval:
  - Before: broad category subtree fetch fan-out
  - After: reduced to base info/config list requests only (no hidden full subtree sweep)
3. Startup warning/error cleanliness:
  - Before: `2` warnings / `0` errors
  - After: `0` warnings / `0` errors

### Mandatory validation runs
- `npm run test:coverage` ✅
  - Global branch coverage: `82.03%` (>= 82% gate)
- `npm run lint` ✅
- `npm run test` ✅ (`214` files passed, `1831` tests passed)
- `npm run build` ✅
- `./build` ✅ (including Playwright suite + Android build workflow)

## Final invariant validation
- A1 Visibility-driven pre-expand retrieval: **PASS**
- A2 No hidden speculative config sweep on `/config` entry: **PASS**
- B1 First render before non-essential work: **PASS**
- B2 Zero startup warnings/errors in normal proxy-path startup: **PASS**
- C1 Capability detection non-blocking: **PASS**
- C2 Deterministic override precedence: **PASS**
- D1 Startup/call-graph determinism with explicit before/after evidence: **PASS**
