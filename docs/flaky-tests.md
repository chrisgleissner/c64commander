# Flaky tests — retry stop-gap (high visibility)

> **This is a temporary stop-gap, not a feature.** Retries keep the build green
> when a test is intermittently flaky, but every retry is surfaced loudly so
> flakiness is tracked and paid down — never silently normalised into "more and
> more flaky tests".

## What is configured

| Suite                        | Retries (CI)       | Retries (local) | Visibility reporter                               |
| ---------------------------- | ------------------ | --------------- | ------------------------------------------------- |
| Playwright E2E / screenshots | **2** (3 attempts) | 0               | `playwright/reporters/flakyVisibilityReporter.ts` |
| Vitest unit                  | **2** (3 attempts) | 0               | `tests/reporters/vitestFlakyReporter.ts`          |

- Playwright retries: `playwright.config.ts` → `retries`.
- Vitest retries: `vitest.config.ts` → `test.retry` (applies under the coverage
  runner too; `scripts/run-unit-coverage.mjs` injects the reporter explicitly
  because it overrides `--reporter`).
- **Local runs use 0 retries on purpose** — a test that is flaky on your machine
  should fail in your face, not be hidden.

## How a retry is made impossible to miss

When a test passes **only** after a retry (Playwright "flaky" outcome / vitest
`retryCount > 0` with a passing result), the reporters emit, on every run:

1. **A `::warning::` GitHub annotation per flaky test.** GitHub aggregates these
   at the **top of the workflow run** across every shard — one glance shows the
   full flaky set for the run.
2. **A section in the GitHub job summary** (`$GITHUB_STEP_SUMMARY`) with a table
   of test · location · retries.
3. **A loud console banner** in the test step log (also visible locally if you
   opt into retries).
4. **A JSON drop** at `test-results/flaky/flaky-*.json` for tooling.

Because the build stays green, these warnings are the _only_ signal — so they are
designed to be unignorable. If the flaky list grows run over run, that growth is
visible on every PR.

## What you must do when you see a flaky warning

1. **Do not ignore it.** A green check with flaky warnings is a debt, not a pass.
2. Open an issue (or pick up the existing one) for the named test.
3. Root-cause it — most flakiness here is a race (await the state, not a sleep),
   a shared-fixture leak, or a timing-sensitive assertion. Reproduce locally with
   retries off:

   ```bash
   PLAYWRIGHT_DEVICES=phone npx playwright test <file> -g "<title>" --repeat-each 10
   # or, for unit tests:
   npx vitest run <file> -t "<title>" --repeat-each 10
   ```

4. Fix the test (or the product bug it exposes) and confirm it is stable across
   repeats. The fix removes it from the flaky report automatically.

## Retiring the stop-gap

When the flaky report is consistently empty, lower `retries` back toward `1`/`0`
so genuine regressions fail fast again. Track remaining offenders so the count
only goes down.
