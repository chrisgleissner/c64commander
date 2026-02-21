# PLANS

## Observed CI failures (Phase 1)

Failing specs reported in CI:
- `playwright/fuzz/chaosRunner.fuzz.ts`
- `playwright/featureFlags.spec.ts`
- `playwright/homeConfigManagement.spec.ts` (multiple @layout tests)

Common failure pattern:
```
console error: Failed to load resource: the server responded with a status of 404 (Not Found)
```

Exact failing URL (proven from prior CI evidence):
- `http://127.0.0.1:4173/doc/c64/c64u-config.yaml` (GET 404)
  (port 4173 is the default `PLAYWRIGHT_PORT`; CI may override via `PLAYWRIGHT_PORT` env var)

The built `dist/` directory does not contain `doc/c64/c64u-config.yaml` as a static file.
When `mockConfig.ts` ran in the browser it issued a fetch to that path, received 404, which triggered
a browser console.error, which caused `assertNoUiIssues` to throw, failing all tests that visit pages
using the demo-config mock.

## Diff summary vs main (Phase 2)

Root-cause fix applied in this branch:
- `src/lib/mock/mockConfig.ts`: `loadRawConfig` now attempts `import('../../../doc/c64/c64u-config.yaml?raw')`
  via `loadBundledConfigYaml()` **before** falling back to a network fetch. Vite bundles the YAML as a JS
  module (`dist/assets/c64u-config-*.js`), so no HTTP request is ever made in the built app.
- `playwright/testArtifacts.ts`: added `network404s` and `requestFailures` arrays to the strict UI tracker;
  when a test fails these are emitted as `diagnostic network 404: ...` / `diagnostic request failed: ...` lines
  to make future 404 URLs immediately visible in CI logs.

## Hypotheses (ranked)

1. **[CONFIRMED + FIXED]** `mockConfig` startup fetch to `/doc/c64/c64u-config.yaml` -> 404 ->
   browser console.error -> `assertNoUiIssues` throw. Fix: bundle YAML via `?raw` import and load it first.
2. ~~Base-path mismatch for Android device profiles~~ - ruled out; `baseURL` uses `127.0.0.1` consistently.
3. ~~SPA routing fallback missing~~ - ruled out; `vite preview` serves SPA correctly.
4. ~~Service worker precache mismatch~~ - not present in this app.

## Reproduction (Phase 3)

Commands used to reproduce and verify locally:
```bash
VITE_COVERAGE=true VITE_ENABLE_TEST_PROBES=1 npm run build
PLAYWRIGHT_SKIP_BUILD=1 VITE_COVERAGE=true VITE_ENABLE_TEST_PROBES=1 \
  TRACE_ASSERTIONS_DEFAULT=1 npx playwright test \
  playwright/featureFlags.spec.ts \
  playwright/homeConfigManagement.spec.ts \
  playwright/fuzz/chaosRunner.fuzz.ts \
  --project=android-phone --project=android-tablet
```

## Root cause analysis (Phase 4)

Category: **Static asset 404** (category A).

Trace:
1. `src/lib/mock/mockConfig.ts: resolveYamlUrl()` builds URL `<origin>/doc/c64/c64u-config.yaml`.
2. `loadYamlFromAssets()` issues `fetch(resolveYamlUrl())`.
3. `dist/` does not contain `doc/c64/c64u-config.yaml` - only bundled JS assets exist.
4. Vite preview server returns HTTP 404 for the path.
5. Browser logs `Failed to load resource: the server responded with a status of 404 (Not Found)`.
6. `startStrictUiMonitoring` captures this as a `consoleError`.
7. `assertNoUiIssues` throws, failing every test that navigates to a page consuming the mock config.

## Fix applied (Phase 5)

Minimal fix in `src/lib/mock/mockConfig.ts`:
- `loadBundledConfigYaml()` dynamically imports `doc/c64/c64u-config.yaml?raw` (Vite inline asset).
- `loadRawConfig()` calls `loadBundledConfigYaml()` first; only falls back to network fetch if the bundled
  content is empty.
- Vite produces `dist/assets/c64u-config-*.js` containing the YAML as a string literal - no HTTP request.

Additional hardening in `playwright/testArtifacts.ts`:
- `network404s` array records every HTTP 404 response with method, URL, and resourceType.
- `requestFailures` array records every failed request with method, URL, and errorText.
- When `assertNoUiIssues` throws, both arrays are appended as `diagnostic ...` lines so CI logs show the
  exact offending URL without requiring a trace viewer.

## Verification (Phases 6, 7, 8)

### Phase 6 - targeted failing specs

```bash
PLAYWRIGHT_SKIP_BUILD=1 VITE_COVERAGE=true VITE_ENABLE_TEST_PROBES=1 TRACE_ASSERTIONS_DEFAULT=1 \
npx playwright test playwright/featureFlags.spec.ts playwright/homeConfigManagement.spec.ts \
playwright/fuzz/chaosRunner.fuzz.ts --project=android-phone --project=android-tablet
```

Result: **18/18 passed** (android-phone: 11, android-tablet: 7). No console 404 errors.

### Phase 7 - full e2e suite

```bash
PLAYWRIGHT_SKIP_BUILD=1 VITE_COVERAGE=true VITE_ENABLE_TEST_PROBES=1 TRACE_ASSERTIONS_DEFAULT=1 \
npm run test:e2e
```

Result: **337/337 passed** (android-phone + android-tablet). No console 404 errors. No new failures.

### Screenshot tests

```bash
PLAYWRIGHT_SKIP_BUILD=1 VITE_COVERAGE=true VITE_ENABLE_TEST_PROBES=1 TRACE_ASSERTIONS_DEFAULT=1 \
npx playwright test --grep @screenshots --workers 1 playwright/screenshots.spec.ts
```

Result: **10/10 passed**.

### Unit tests

```bash
npm run test:coverage
```

Result: **1828/1831 passed**. The 3 failures are pre-existing network-dependent HVSC tests
(`hvscArchiveExtraction`, `hvscIngestionPipeline`) that require DNS access to `hvsc.brona.dk` -
blocked in the sandbox environment, unrelated to this fix.

### Lint

```bash
npm run lint
```

Result: **0 errors**.

## Phase 8 - hard assertions

1. **No 404 errors in console logs** - confirmed. The `mockConfig` bundled-first path eliminates the fetch.
2. **No network request returns 404** - confirmed. `dist/assets/c64u-config-*.js` is served instead.
3. **All Android Playwright tests pass** - confirmed (337/337).
4. **All screenshot tests pass** - confirmed (10/10).
5. **No unrelated test failures introduced** - confirmed. Only pre-existing HVSC network tests fail.

## Risk register

| ID   | Risk                                                | Mitigation                                               |
|------|-----------------------------------------------------|----------------------------------------------------------|
| KR-1 | `?raw` import silently fails in future Vite update  | Error logged via `console.warn`; fallback present        |
| KR-2 | Bundled YAML becomes stale vs filesystem copy       | Single source of truth; both paths read same file        |
| KR-3 | New 404-causing path introduced later               | `network404s` diagnostics emit full URL on test failure  |
