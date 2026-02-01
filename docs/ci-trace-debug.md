# CI Trace Comparison Debug Notes (2026-02-01)

## Root cause summary
- Trace comparison grouped REST/FTP operations strictly by correlation ID and relied on request/response ordering within the trace array.
- Recent CTA tracing changes separated user actions from downstream REST/FTP correlations, and response events could appear before their request in the trace array.
- This caused mismatched or UNKNOWN request pairing and missing-action failures, especially for FTP list flows.

## Fix summary
- Canonicalize trace comparisons by:
  - Sorting events deterministically.
  - Grouping downstream events by user-origin CTA when present.
  - Filtering out noisy GET polling from CTA grouping.
  - Comparing REST calls for CTA groups by request signatures only (status optional) to avoid response-order volatility.
  - Relaxing ordering checks for user-origin actions while keeping system-order checks intact.
- Emit a machine-readable diff artifact (trace.diff.json) on failure with normalized excerpts.

## Why this is correct
- The comparison now validates that each CTA triggers the expected REST/FTP request set without being brittle to response timing or polling noise.
- It still fails when required downstream requests are missing or unexpected system-level actions appear.
- Ordering checks remain enforced for system actions where order is meaningful, while user-action boundaries are tolerant of async behavior.

## How to reproduce locally
1. Representative test:
   - TRACE_ASSERTIONS_DEFAULT=1 npx playwright test playwright/playback.part2.spec.ts -g "playlist menu shows size and date for C64 Ultimate items"
2. Additional validation:
   - TRACE_ASSERTIONS_DEFAULT=1 npx playwright test playwright/ftpPerformance.spec.ts -g "FTP navigation uses cache across reloads"

## Artifacts
- On failure, trace.diff.json is written to:
  - test-results/evidence/playwright/<testId>/<deviceId>/trace.diff.json

## Changes
- playwright/traceComparison.js: user-CTA grouping, normalization, ordering rules, and diff summaries.
- playwright/testArtifacts.ts: emit trace.diff.json and include summary in error message.
- tests/unit/traceComparisonPromote.test.ts: updated expected result shape.
