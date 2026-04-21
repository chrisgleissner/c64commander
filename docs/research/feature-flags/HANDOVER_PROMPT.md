# Feature Flag Unification Handover Prompt

Date: 2026-04-19
Type: Strict continuation prompt
Expected change classification: `DOC_PLUS_CODE`, `UI_CHANGE`

## Read first

- `docs/research/feature-flags/feature-flags.md`
- `docs/research/feature-flags/plan.md`
- `docs/research/feature-flags/prompt.md`
- `README.md`
- `.github/copilot-instructions.md`
- `docs/ux-guidelines.md`

Keep handover-only notes in `docs/research/feature-flags/`. Do not create or update unrelated planning artifacts elsewhere unless the user asks.

## Current state

This work is not fully done.

The feature-flag architecture itself appears to be substantially implemented already:

- `src/lib/config/feature-flags.yaml` exists and is the authored registry.
- `src/lib/config/featureFlagsRegistry.generated.ts` exists and is generated from the YAML registry.
- `src/lib/config/featureFlags.ts` already resolves registry defaults, persisted overrides, and developer-mode visibility/editability.
- `src/lib/config/appSettings.ts` no longer contains a legacy CommoServe rollout key or `loadCommoserveEnabled` / `saveCommoserveEnabled` helpers.
- The current registry contains:
  - `hvsc_enabled`
  - `commoserve_enabled`
  - `lighting_studio_enabled`
- The registry currently defines two groups:
  - `stable`
  - `experimental`

Related test/harness work also already landed in the current tree:

- `scripts/run-unit-coverage.mjs`
  - includes `coverageRunMaxAttempts = 2`
  - retries failed coverage shards
  - wraps shard execution with a temp-dir keepalive loop
- `playwright/uiMocks.ts`
  - seeds developer mode plus `hvsc_enabled`, `commoserve_enabled`, and `lighting_studio_enabled` by default for Playwright UI tests
- `playwright/featureFlags.spec.ts`
  - opts out of default feature seeding where the spec needs to validate defaults explicitly
- `playwright/swipe-navigation.spec.ts`
  - explicitly seeds `c64u_enable_swipe_navigation = 1`, which restored the swipe suite

## Important current facts

Treat the current file contents as authoritative. The user explicitly noted that some files were edited between turns, and those files were re-read before creating this handover prompt.

Files re-read because they were flagged as changed:

- `tests/unit/scripts/runUnitCoverage.test.ts`
- `playwright/uiMocks.ts`
- `scripts/run-unit-coverage.mjs`
- `src/lib/telnet/telnetScreenParser.ts`
- `tests/unit/telnet/telnetScreenParser.test.ts`

Other directly relevant files re-read for this handover:

- `src/lib/config/featureFlags.ts`
- `src/lib/config/appSettings.ts`
- `src/lib/config/feature-flags.yaml`
- `src/lib/config/featureFlagsRegistry.generated.ts`
- `playwright/featureFlags.spec.ts`
- `playwright/swipe-navigation.spec.ts`
- `tests/unit/c64apiSidUpload.test.ts`

## Current blocker

There is at least one real compile error in the current tree, so this thread is not in a fully closed state.

Current diagnostics:

- `tests/unit/scripts/runUnitCoverage.test.ts`
  - around the `dedicatedRuns` filter, `runConfig.files` is accessed on a union type without narrowing
  - later, `unitCoverageRuns[0].files[0]` is also accessed without narrowing

This is the concrete issue currently reported by editor diagnostics and is the most likely reason the last `npm run lint` run failed.

Do not assume the last lint failure was just formatting in `playwright/uiMocks.ts`; the current diagnostics point at `tests/unit/scripts/runUnitCoverage.test.ts` instead.

## Validation status at handover time

Known recent results from this thread:

- `npm run build` passed.
- `cd android && ./gradlew test` passed.
- A previous `npm run test` run passed earlier in the session, but that result is stale because files changed afterward.
- A previous standalone `playwright/swipe-navigation.spec.ts` rerun passed after seeding `c64u_enable_swipe_navigation = 1`.

Current incomplete validation state:

- `npm run lint` most recently exited `1`.
- `npm run test:coverage` most recently exited `1`.
- A later `npm run coverage:gate` rerun got much farther:
  - unit coverage completed all `37` scheduled runs
  - build completed successfully
  - the E2E coverage phase started and was passing early Playwright cases
  - that long run was intentionally stopped before finishing the full `443`-test sweep

Interpretation:

- The original `.cov-unit/.../.tmp/coverage-*.json` flake was addressed in `scripts/run-unit-coverage.mjs`.
- The repo is still not honestly closed because fresh lint / coverage confirmation on the current tree is missing.

## What appears already done

These items from the original feature-flag plan look implemented in code and should be treated as probably complete unless validation proves otherwise:

- YAML-authored registry exists.
- Generated registry exists.
- Resolver supports defaults, overrides, and developer mode semantics.
- Legacy CommoServe app-settings path appears removed from `appSettings.ts`.
- Playwright harness reflects enabled-by-default feature policy.
- Swipe-navigation Playwright regression was fixed by seeding the swipe-navigation setting.

Do not reopen already-landed migration work casually unless you find a real failing test or a concrete behavioral regression.

## Remaining work

### 1. Fix the current compile break

Start with:

- `tests/unit/scripts/runUnitCoverage.test.ts`

Expected fix direction:

- add proper narrowing or a type predicate for `unitCoverageRuns` entries that contain `files`
- avoid direct property access on the union without narrowing

Keep the change minimal and focused.

### 2. Re-run the honest validation chain

After fixing the compile break, run the smallest honest set required by the current tree:

```bash
npm run lint
npm run test
npm run test:coverage
```

If those pass, then re-run:

```bash
npm run coverage:gate
```

The point of the final gate rerun is not to rediscover the already-fixed swipe issue. It is to verify the current tree end-to-end after the last edits.

### 3. Treat the coverage gate result carefully

When `coverage:gate` runs:

- expected stderr from budget-script tests is normal during unit coverage
- do not mistake lines like these for a failing shard by themselves:
  - `Android HVSC perf budgets FAILED: ...`
  - `HVSC web secondary perf budgets failed: ...`
- earlier in this thread, those lines appeared inside passing unit-coverage shards

Only treat the gate as failed if the command exits nonzero or the log shows an actual failing test / threshold failure.

### 4. Re-baseline the task list honestly

The old task list is partly stale.

In particular:

- `Remove legacy CommoServe key` looks already done in `src/lib/config/appSettings.ts`
- `Update affected regression tests` is partly done, but `tests/unit/scripts/runUnitCoverage.test.ts` still needs a type-safe fix
- `Rerun lint and full tests` and `Rerun coverage gate` still remain open

Update the task tracking based on what the current tree actually shows, not what the earlier todo list said.

## Suggested next commands

```bash
npm run lint
npm run test -- --run tests/unit/scripts/runUnitCoverage.test.ts
npm run test
npm run test:coverage
npm run coverage:gate
```

If you need to inspect the previous interrupted gate run:

```bash
tail -n 200 .tmp/phase7-coverage-gate.log
```

## Files most likely to matter next

- `tests/unit/scripts/runUnitCoverage.test.ts`
- `scripts/run-unit-coverage.mjs`
- `playwright/uiMocks.ts`
- `playwright/featureFlags.spec.ts`
- `playwright/swipe-navigation.spec.ts`
- `tests/unit/c64apiSidUpload.test.ts`
- `src/lib/config/featureFlags.ts`
- `src/lib/config/appSettings.ts`

## Completion rule

Do not call this work fully done until all of the following are true:

- the current compile error in `tests/unit/scripts/runUnitCoverage.test.ts` is fixed
- `npm run lint` passes
- `npm run test` passes on the current tree
- `npm run test:coverage` passes on the current tree
- `npm run coverage:gate` is either green, or an exact external blocker is documented clearly enough that the user does not need to rediscover it
