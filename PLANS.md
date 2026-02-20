# PLANS

## Precise reproduction description
1. Build app for a non-root base path and serve output under `/app/`:
   - `npm run build -- --base=/app/`
   - Serve `/tmp/c64-subpath/app` at `http://127.0.0.1:5011/app/`
2. Run Playwright (headless Chromium) with network diagnostics (`response.status()===404` and `requestfailed`) while opening `http://127.0.0.1:5011/app/`.
3. Before fix, browser emitted a required-resource 404; after fix, it did not.

## Exact failing URLs (verbatim)
Before fix:
- `http://127.0.0.1:5011/app/doc/c64/c64u-config.yaml` (GET 404)

Non-404 request failures observed but unrelated to this regression:
- `http://demo.invalid/v1/info` (`net::ERR_NAME_NOT_RESOLVED`)
- `https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap` (`net::ERR_NAME_NOT_RESOLVED`)

## Current vs main behavioral diff
- The failing behavior is runtime/path behavior: app attempted to fetch `doc/c64/c64u-config.yaml` from web root assets during browser startup/demo config loading.
- Built output used by Playwright (`dist/`) does not contain `dist/doc/c64/c64u-config.yaml`.
- This causes browser-level 404 noise that Playwright strict console checks treat as failure.
- Differential verification was performed under identical build/run conditions (same Node/toolchain in this sandbox) using before/after runtime traces.

## Verified root cause
`src/lib/mock/mockConfig.ts` eagerly called `loadYamlFromAssets()` in browser mode, which executes:
- `fetch(new URL('doc/c64/c64u-config.yaml', window.location.origin + BASE_URL))`

When that file is not physically present in the served build output, browser emits a 404 for that URL even though code later catches and falls back. The caught exception does **not** prevent Playwright from seeing the console/network 404.

## Causality proof
- Cause line/path: `loadRawConfig -> loadYamlFromAssets -> fetch(resolveYamlUrl())`.
- Observable effect before fix: exact 404 URL listed above during Playwright-driven runtime.
- Why this causes CI failures: test harness asserts no unexpected console errors; browser logs "Failed to load resource: ... 404" from this missing fetch.
- Why fix works: browser now uses bundled YAML first (already in bundle), avoiding the failing network fetch path and therefore eliminating the 404.

## Concrete minimal fix plan (implemented)
- [x] In `src/lib/mock/mockConfig.ts`, prefer bundled YAML in browser context before any network fetch.
- [x] Keep existing fallback behavior intact (custom loader + fetch fallback + defaults).
- [x] Add/adjust focused unit assertion in `tests/unit/mockConfig.test.ts` to ensure browser path no longer performs unnecessary fetch.

## Strict verification checklist
### A) Build artifact assertions
- [x] Confirmed missing file was not in build output: `dist/doc/c64/c64u-config.yaml` absent.
- [x] Confirmed app no longer requires that missing file at runtime in browser-first path.

### B) Runtime network assertions
- [x] Before fix: captured exact 404 URL above.
- [x] After fix under same reproduction: `TOTAL_404 0`.
- [x] No 404 for required resources in reproduced path.

### C) Regression assertions
- [x] `npm run lint`
- [x] `npm run test -- tests/unit/mockConfig.test.ts`
- [x] `npm run test:e2e` (full): `337 passed`
- [x] `npm run cap:build` (web build + Android/iOS sync)
- [ ] `npm run test` and `npm run test:coverage` full in this sandbox (blocked by external DNS `hvsc.brona.dk`, unrelated to this fix)

### D) CI source-of-truth checks
- [x] Investigated failing base branch workflow first (`feat/hardening-4` run `22214394010`).
- [ ] Await fresh CI run on this PR branch to confirm Playwright/Web/iOS all green post-fix.

## Acceptance criteria status
- [x] Root cause explicitly documented.
- [x] Causality proven from code path + runtime evidence.
- [x] Exact missing URL identified and eliminated in verified reproduction.
- [ ] All Playwright CI jobs green (pending rerun).
- [ ] Web CI green (pending rerun).
- [ ] iOS CI green (pending rerun).
- [x] PLANS.md contains full verification trace.
