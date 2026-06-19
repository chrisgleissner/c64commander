# Keeping Dependabot PRs green

Routine dependency freshness is delivered as a **single weekly cross-ecosystem
"weekly-rollup" PR** (`.github/dependabot.yml`), restricted to **minor/patch**
bumps — all majors are ignored and taken by hand. The full CI suite (web +
Android + iOS + `c64scope`) runs on every Dependabot PR, so breakages surface in
the PR, not after merge.

This doc is the playbook for keeping those PRs mergeable **without manual
cleanup**. When a rollup PR is red, classify the failure before assuming "just
flaky" — most red rollups are one of the classes below, each with a _durable_
structural fix already in place.

## The guardrails that already exist

| Mechanism                                 | File                                                                  | What it prevents                                                       |
| ----------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Major bumps ignored, single weekly rollup | `.github/dependabot.yml`                                              | Breaking majors + multi-PR lockfile drift                              |
| Toolchain pins + contract tests           | `.github/dependabot.yml`, `tests/unit/ci/dependabotContracts.test.ts` | A pinned dep being silently un-pinned                                  |
| Notices auto-commit                       | `.github/workflows/dependabot-compliance.yaml`                        | `THIRD_PARTY_NOTICES.md` drift failing the `notices` gate              |
| Retry stop-gap + loud flaky reporting     | `playwright.config.ts`, `vitest.config.ts`, `docs/flaky-tests.md`     | Transient flakiness failing the build (while keeping the debt visible) |
| Conformant binary fixtures                | `tests/unit/scripts/generateVariant.test.ts`                          | Native-lib (sharp/libvips) parsers rejecting hand-built fixtures       |
| Public APIs only (no deep imports)        | `scripts/screenshotMetadataDedupe.js`                                 | A dep moving a private internal path                                   |

## Failure classes and their durable fix

**A — Native-lib fixture brittleness (sharp / libvips / libpng).** `sharp` uses
`0.x` versioning, so a Dependabot "minor" carries a breaking libvips/libpng
change. A hand-crafted binary fixture (e.g. a 1×1 PNG) that an old parser
tolerated gets rejected by the new one. _Fix:_ never embed hand-built binary
blobs in tests — generate them with the same library under test (sharp's own
output round-trips across libvips upgrades).

**B — Timing races exposed by load / version churn.** Rollups add shard load and
shift timings, tipping already-tight awaits over the edge — usually a Playwright
`locator.click` timeout. _Fix:_ root-cause the await, do **not** loosen the
timeout. The recurring offender is the inline `Select` triggers on the Home page:
`inlineSelectTriggerClass` hides the chevron and zeroes the padding, so a trigger
**collapses to zero size (Playwright: "not visible") until its config value
loads**. Wait for `toBeVisible()` before reading text or clicking it. The 2-retry
net (`docs/flaky-tests.md`) is the safety layer, not the fix.

**C — Lockfile drift.** Two Dependabot PRs merged together can leave
`package-lock.json` inconsistent with `package.json`, breaking `npm ci`.
_Mitigation:_ `open-pull-requests-limit: 1` + a single weekly rollup means there
is normally only one lockfile-touching PR in flight. If drift still appears,
reconcile with `npm install` in both `/` and `/c64scope` and commit the result.

**D — Toolchain-coupled deps (the gold-standard pattern).** A dep bumped past
what a pinned toolchain supports. Two live examples:

- `kotlinx-coroutines-test` 1.9+ needs the Kotlin 2.2 stdlib; Android still
  compiles with Kotlin 1.9.x.
- The **Gradle wrapper** must move in lockstep with the Android Gradle Plugin.
  Gradle 9.6 broke AGP 8.13.2 (`Failed to apply plugin
'com.android.internal.application' > Failed to create service
'...AndroidProblemReporterProvider'`).

_Fix (replicate this for any toolchain-coupled dep):_

1. Add an `ignore` entry for the dep in `.github/dependabot.yml` with a comment
   explaining the coupling.
2. Keep the pinned version in the manifest (`android/build.gradle`,
   `android/gradle/wrapper/gradle-wrapper.properties`).
3. Assert both in `tests/unit/ci/dependabotContracts.test.ts` so the pin cannot
   be removed without a deliberate, reviewed change.
4. Upgrade the dep + its toolchain together, by hand, in a dedicated PR.

**E — Deep imports of a dependency's private internals.** Importing
`playwright-core/lib/third_party/...` breaks when the dep relocates it. _Fix:_
depend only on public package entry points.

**F — Pinned tool/container tags that must track a bumped package.** A hardcoded
`mcr.microsoft.com/playwright:vX` tag had to be edited every Playwright bump.
_Fix:_ install the browser at runtime (`npx playwright install --with-deps`)
instead of pinning a container tag.

**H — Notices / compliance drift.** Any dependency add/remove changes
`THIRD_PARTY_NOTICES.md`, gated by `git diff --exit-code`. _Already automated:_
`dependabot-compliance.yaml` regenerates and commits the notices back onto the
Dependabot branch.

## Triage checklist for a red rollup

1. `gh pr checks <pr>` — list the failing jobs.
2. For each failure, read `gh run view --job <id> --log-failed` and map it to a
   class above. Android plugin/service errors → class D (Gradle/AGP). A single
   `locator.click` timeout on a Home `Select` → class B. `libpng`/`vips` errors →
   class A.
3. A test that fails **all 3 attempts** is a real failure, not flake — fix it. A
   test that passes on retry is logged by the flaky reporter; root-cause it per
   `docs/flaky-tests.md`, don't normalise it.
4. If the fix is "pin a toolchain-coupled dep", follow class D's four steps so it
   never recurs.
