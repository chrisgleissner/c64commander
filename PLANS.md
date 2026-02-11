# Refactoring Execution Plan: Restore Build + Finish Modularization

## Objective
Restore a fully working local build and eliminate refactor regressions while completing any remaining modularization for oversized pages, without changing production behavior.

## Execution Plan (Authoritative)
1. **Audit failures**
	- Run `./build` to surface lint, type, and packaging errors.
	- Run unit tests, Playwright tests, and Maestro flows (if present).
	- Capture any TypeScript, ESLint, or test regressions.

2. **Fix regressions deterministically**
	- Resolve lint failures, including `@typescript-eslint/ban-ts-comment` violations.
	- Fix type errors instead of suppressing unless an expectation is clearly required.
	- Repair any unit, Playwright, or Maestro test failures without weakening coverage.

3. **Finish modularization**
	- Identify oversized pages or mixed-concern modules.
	- Extract focused subcomponents/hooks/utilities while preserving behavior.
	- Keep files under size limits and aligned with architecture boundaries.

4. **Verify end state**
	- Re-run `./build` successfully.
	- Re-run unit tests, Playwright tests, and Maestro flows to green.
	- Update this plan with completion notes and results.

## Known Failures (To Verify)
- ESLint `@typescript-eslint/ban-ts-comment` violations previously reported in unit tests.
- Potential TypeScript or test failures caused by refactoring.

## Definition of Done
- `./build` succeeds locally with no parameters.
- All unit tests pass (`npm run test`).
- All Playwright tests pass (`npm run test:e2e`).
- All Maestro tests pass (if present).
- No tests weakened or removed.
- Production behavior unchanged.
- Modularization complete for oversized pages.
- PLANS.md reflects the final executed plan.

## Progress Log
- Updated plan to a strict audit → fix → modularize → verify loop.
