# PLANS

## Root Cause (Confirmed, Phase 2)

### Primary: Artifact download path mismatch
`upload-artifact@v4` strips the source directory prefix when uploading `path: dist`. The artifact stores files as `index.html`, `assets/*.js` etc. (without `dist/` prefix). But both download steps used `path: .`, which extracted files to workspace root (`./index.html`, `./assets/*.js`) instead of `./dist/`.

Result: `dist/index.html` was never found by the "Ensure build" check, triggering unnecessary rebuilds that used different `__BUILD_TIME__` values — producing inconsistent hash names. Worse, Vite's `build.emptyOutDir` deleted the original `dist/`, then the rebuilt `dist/` had different chunk hashes than what the main bundle referenced. This caused 404s for ALL lazy-loaded JS chunks.

**Proof**: Downloaded the `web-dist-coverage` artifact (ID 5602803186) and confirmed paths are `index.html`, `assets/AppBar-RD3JqkOA.js` etc. (no `dist/` prefix). With old `path: .`, `dist/index.html` was always absent, always triggering a rebuild.

### Secondary: SIGPIPE bug in coverage check (Ensure coverage build exists)
The `Ensure coverage build exists` step used:
```
grep -R "__coverage__" dist/assets 2>/dev/null | head -1 | grep -q "__coverage__"
```
With bash `pipefail` (enabled by default in GitHub Actions), when `head -1` exits after one line it sends SIGPIPE to `grep -R`, causing `grep -R` to exit with status 141. With `pipefail`, the pipeline exit code is 141 (non-zero), so `if ! [pipeline]` = true, triggering a spurious second rebuild even when coverage IS present.

## Fix Applied (Phase 2)

### Fix 1: Correct artifact download path (`android.yaml`)
Both download steps changed from `path: .` to `path: dist`:
- `web-screenshots` job
- `web-e2e` job

This ensures the artifact extracts to `./dist/index.html` and `./dist/assets/*.js` as expected by the "Ensure build" checks and `vite preview`.

### Fix 2: SIGPIPE-safe coverage check (`android.yaml`)
Changed from:
```bash
grep -R "__coverage__" dist/assets 2>/dev/null | head -1 | grep -q "__coverage__"
```
To:
```bash
grep -qr "__coverage__" dist/assets 2>/dev/null
```
`grep -qr` exits immediately on first match without piping, completely avoiding SIGPIPE.

## Verified (Phase 2)

- Local simulation: with `path: dist`, dist/index.html found → no rebuild → assets served as 200 ✓
- Local simulation: `grep -qr` passes without spurious rebuild when coverage exists ✓
- Unit tests: 1828 passed, 3 pre-existing failures (network access blocked in sandbox) ✓

## Observed CI failures (Phase 1, resolved by Phase 2 fix)

Failing specs reported in CI (all due to JS chunk 404s):
- `playwright/fuzz/chaosRunner.fuzz.ts`
- `playwright/featureFlags.spec.ts`
- `playwright/homeConfigManagement.spec.ts` (multiple @layout tests)
- `Web | Screenshots`
- `Web | E2E (sharded)` (11 of 12 shards, shard 4 only passed because it ran `@allow-warnings` tests)

## Previous fix (Phase 1, already merged)

Root-cause fix in `src/lib/mock/mockConfig.ts`:
- `loadBundledConfigYaml()` dynamically imports `doc/c64/c64u-config.yaml?raw` (Vite inline asset).
- `loadRawConfig()` calls `loadBundledConfigYaml()` first; only falls back to network fetch if the bundled
  content is empty.
- Vite produces `dist/assets/c64u-config-*.js` containing the YAML as a string literal - no HTTP request.

Additional hardening in `playwright/testArtifacts.ts`:
- `network404s` array records every HTTP 404 response with method, URL, and resourceType.
- `requestFailures` array records every failed request with method, URL, and errorText.
- When `assertNoUiIssues` throws, both arrays are appended as `diagnostic ...` lines so CI logs show the
  exact offending URL without requiring a trace viewer.
