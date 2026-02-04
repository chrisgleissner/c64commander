# Action Summary Golden Fixtures

This directory contains golden action summary fixtures for regression testing
the trace-to-action conversion code (`buildActionSummaries` in `src/lib/diagnostics/actionSummaries.ts`).

## Structure

- `organic/` - Golden actions derived from real Playwright trace fixtures
  - Subdirectories mirror the corresponding Playwright fixture structure
  - Each subdirectory contains `trace.json` (input) and `actions.json` (golden output)
- `synthetic/` - Golden actions derived from handcrafted synthetic traces
  - Each subdirectory contains both `trace.json` (input) and `actions.json` (golden output)

## Updating Golden Fixtures

When the conversion logic changes intentionally, regenerate golden actions:

```bash
UPDATE_GOLDENS=1 npm run test -- tests/unit/diagnostics/actionSummariesGolden.test.ts
```

This will:
1. Load each trace fixture
2. Run the converter
3. Normalize and write the result to `actions.json`

**Important**: Review all golden diffs before committing to ensure changes are intentional.

## Normalization

The following fields are excluded from golden comparisons (non-semantic per tracing spec):
- `startTimestamp`
- `endTimestamp`
- `startRelativeMs`

The following are retained for determinism:
- `correlationId`
- `actionName`
- `origin`
- `durationMs`
- `durationMsMissing` (when durationMs is null)
- `outcome`
- `errorMessage`
- `restCount` (only when > 0)
- `ftpCount` (only when > 0)
- `errorCount` (only when > 0)
- Effect details (method, path, operation, target, status, result, error)

## Adding New Fixtures

### Organic
1. Identify a complex Playwright trace fixture under `playwright/fixtures/traces/golden/`
2. Create a mirrored subdirectory path here (e.g., `organic/test-name/android-phone/`)
3. Run with `UPDATE_GOLDENS=1` to generate the initial `actions.json`

### Synthetic
1. Create a new directory under `synthetic/` with a descriptive name
2. Author `trace.json` with representative events
3. Run with `UPDATE_GOLDENS=1` to generate the initial `actions.json`
