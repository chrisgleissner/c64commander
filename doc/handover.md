# Handover: CTA tracing reconstruction (C64 Commander)

## Goal (non‑negotiable)
Capture every user CTA interaction as event trace. Full parity with golden traces is required.

## Work completed
- Added reconstruction plan, reference analysis, gap analysis, and updated evidence stats in [PLANS.md](../PLANS.md).
- Updated centralized interaction capture to align with reference semantics (GlobalInteraction, capture‑phase listeners, broader target detection, simplified action names). See [src/lib/tracing/userInteractionCapture.ts](../src/lib/tracing/userInteractionCapture.ts).
- Updated explicit wrappers to mark native events as traced without suppressing global capture. See [src/lib/tracing/userTrace.ts](../src/lib/tracing/userTrace.ts).

## Key behavior changes
- Centralized capture now emits `action-start`/`action-end` with component name “GlobalInteraction” and action names like “click <label>” / “change <label>”.
- Double‑tracing is prevented by `nativeEvent.__c64uTraced`, not by timing suppression.

## Evidence / current metrics (latest update)
- Reference aggregates: total traces 295, aggregate traceCount 57,903, aggregate userCount 3,570, typical userCount range 4–16.
- Current aggregates: total traces 296, aggregate traceCount 48,811, aggregate userCount 2,216, typical userCount range 2–10.
- Delta: userCount down 1,354; traceCount down 9,092; extra 1 trace.
- Updated per‑test tables and deltas are in [PLANS.md](../PLANS.md).

## Recent commands run
- Targeted E2E subset run (failed due to trace comparison but produced evidence traces): `npm run test:e2e -- --project=android-phone --grep "repeated add items via C64 Ultimate remains stable"`.
- Evidence traces parsed to update tables in [PLANS.md](../PLANS.md).

## Open gaps / required next actions
1. Restore full CTA coverage:
   - Identify remaining missing GlobalInteraction events (compare golden vs evidence per‑test).
   - Ensure CTA elements not captured via click/change are covered (e.g., pointerup, key‑driven activations).
2. Implement mandatory post‑E2E sanity checker (stdout per test in required format; fail if traceCount < 10 or userCount < 2) + unit tests.
3. Iterative convergence:
   - Re‑run 1 test, then 10 tests, then full suite.
   - Update evidence stats and deltas in [PLANS.md](../PLANS.md) after each step.
4. Golden trace updates:
   - If trace semantics change, re‑record golden traces under playwright/fixtures/traces/golden and keep assertions strict.

## Where to continue
- Tracing sources: [src/lib/tracing/actionTrace.ts](../src/lib/tracing/actionTrace.ts), [src/lib/tracing/traceSession.ts](../src/lib/tracing/traceSession.ts), [src/lib/tracing/userInteractionCapture.ts](../src/lib/tracing/userInteractionCapture.ts), [src/lib/tracing/userTrace.ts](../src/lib/tracing/userTrace.ts), [src/lib/tracing/useActionTrace.ts](../src/lib/tracing/useActionTrace.ts).
- Playwright trace comparison: playwright/traceComparison.js and related fixtures under playwright/fixtures/traces/golden (locate via search if needed).
- Plan and evidence log: [PLANS.md](../PLANS.md).

## Critical reminder
Every CTA interaction must produce a user‑origin trace event pair. Do not accept lower userCount or missing GlobalInteraction events.
