# PLANS

## Precise reproduction description
1. Checked CI source-of-truth in stacked-base order:
   - Base branch `feat/hardening-4`: android run `22214394010` (failure), ios/web green.
   - Current branch latest android run: `22225572404` (failure), with failing shard including `playback.part2.spec.ts` upload-handler test.
2. Reproduced the target spec locally with CI-like settings:
   - Build: `VITE_COVERAGE=true VITE_ENABLE_TEST_PROBES=1 npm run build`
   - Test: `PLAYWRIGHT_SKIP_BUILD=1 ... npx playwright test playwright/playback.part2.spec.ts --project=android-phone`
3. Targeted test (`upload handler tolerates empty/binary response`) and full `playback.part2.spec.ts` both pass locally under CI-like env.

## Exact failing URLs (verbatim)
From prior evidence-driven run (already fixed path):
- `http://127.0.0.1:5011/app/doc/c64/c64u-config.yaml` (GET 404)

For the currently reported CI failure run (`22225572404`), default CI log output only showed generic browser message:
- `console error: Failed to load resource: the server responded with a status of 404 (Not Found)`

To guarantee actionable URL evidence in subsequent runs, diagnostics were added to strict UI monitor to append full URL + resource type for 404 responses and requestfailed events whenever a test fails.

## Current vs main / base behavioral diff
- Previous root cause path (`mockConfig` startup fetch to `doc/c64/c64u-config.yaml`) is fixed in current branch by preferring bundled YAML first in browser runtime.
- That resolved the previously proven required-resource 404.
- Current blocker is CI-only recurrence without URL visibility in older logs; diagnostics were missing the exact URL in failure output.

## Verified root cause (current actionable scope)
- Historical proven root cause: browser demo-config startup fetch of `doc/c64/c64u-config.yaml` when not present in built output.
- Current CI recurrence cannot be attributed to a new concrete URL from existing logs because CI emitted generic 404 console lines only.
- Added deterministic diagnostics in `playwright/testArtifacts.ts` so next failure includes:
  - `diagnostic network 404: <METHOD> <URL> [resourceType=<type>]`
  - `diagnostic request failed: <METHOD> <URL> [error=<reason>]`

## Concrete fix plan
- [x] Preserve strict policy (no global suppression of console errors).
- [x] Add targeted diagnostics to strict monitor for 404/requestfailed inventory in failing output.
- [x] Validate target test and full `playback.part2.spec.ts` under CI-like env.
- [ ] If CI still fails, extract exact offending URL from new diagnostics and apply minimal root-cause fix at source.

## Strict verification checklist
### A) Build artifact / path assertions
- [x] `mockConfig` bundled-first path remains in production/coverage builds.
- [x] Existing PWA/base-path hardening remains intact.

### B) Runtime network assertions
- [x] Prior missing URL inventory retained and fixed (`doc/c64/c64u-config.yaml`).
- [x] Added first-class 404/requestfailed diagnostics to failure output for future CI occurrences.

### C) Regression assertions
- [x] Targeted failing test on `[android-phone]` passes locally under CI-like env.
- [x] Full `playback.part2.spec.ts` passes locally under CI-like env (38/38).
- [ ] Full Playwright CI green on branch (pending rerun).
- [ ] Web/iOS CI green on branch (pending rerun).

### D) CI source of truth
- [x] Investigated base branch workflow first (per stacked PR instructions).
- [x] Investigated current branch failing run and artifacts.
- [ ] Await rerun with new diagnostics-enabled output.

## Acceptance criteria status
- [x] Root cause documentation maintained and updated.
- [x] Causality proof for prior concrete 404 remains documented.
- [x] Minimal, non-suppressive diagnostics hardening implemented.
- [ ] Current CI report’s exact offending URL eliminated (await rerun diagnostics to confirm any remaining URL).
- [ ] All Playwright CI jobs green.
- [ ] Web CI green.
- [ ] iOS CI green.
