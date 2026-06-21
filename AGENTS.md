# Agent Guide

This repository is **C64 Commander**, a React + Vite + Capacitor app for managing and controlling a C64 Ultimate device.

This file is an orientation and execution guide.

## Rule precedence

1. **Primary rules and conventions**: `.github/copilot-instructions.md`
2. **This file**: `AGENTS.md`
3. **Task-specific user prompt**

If instructions conflict, follow `.github/copilot-instructions.md` unless the task explicitly states a narrower requirement that does not violate it.

## Quick orientation

1. Start with `README.md` for overview, local build steps, and Android notes.
2. REST API details live in `docs/c64/c64u-openapi.yaml`.
3. Consult `docs/c64/c64u-telnet.yaml` before any Telnet-related change; treat it as the Telnet menu/source-of-truth reference.
4. Read the UX design in `docs/ux-guidelines.md` before any UX work.
5. Read `docs/testing/maestro.md` before authoring or editing any Maestro flows.
6. UI routes live in `src/pages/` and navigation in `src/components/TabBar.tsx`.
7. Networking and data hooks are in `src/lib/c64api.ts` and `src/hooks/`.
8. Song sources live in `src/lib/sources/` and the HVSC module lives in `src/lib/hvsc/`.
9. Use `.github/copilot-instructions.md` for mandatory workflows. It overrides this file on conflicts.

## Required execution model

Follow this sequence unless the task explicitly requires something narrower.

### Phase 1 - Read before acting

Read the smallest relevant set first:

1. `README.md`
2. `.github/copilot-instructions.md`
3. `docs/ux-guidelines.md` for UI work
4. `docs/testing/maestro.md` for Maestro work
5. additional files directly relevant to the touched area

Do not start making changes before you understand the touched subsystem and validation expectations.

### Phase 2 - Classify the change

Before building, testing, or regenerating screenshots, classify the task using the rules from `.github/copilot-instructions.md`:

- `DOC_ONLY`
- `CODE_CHANGE`
- `UI_CHANGE`
- `DOC_PLUS_CODE`

This classification is mandatory because it controls:

- whether a build is needed
- which test suites are needed
- whether screenshots must be regenerated
- which docs must be updated

### Phase 3 - Map impact before editing

Identify exactly which surfaces are affected:

- source files
- tests
- docs
- screenshot folders under `docs/img/`
- runtime platforms: web, Android, iOS CI-only

Prefer a minimal, explicit impact map over broad speculative edits.

### Phase 4 - Implement with minimal scope

Make the smallest coherent change that fully satisfies the task.

Rules:

- keep repository conventions
- avoid speculative abstraction
- do not widen scope without a concrete reason
- preserve determinism and diagnosability
- add regression tests for bug fixes

### Phase 5 - Stabilize on the real target first

For productionization, hardening, exploratory regression, or device-stabilization
tasks, do not spend the main execution window on broad builds, full-suite tests, or
coverage before the user-facing device deliverables are actually working on the
Pixel 4.

Priority order for these runs:

1. Reproduce and stabilize the behavior on the Pixel 4.
2. Prefer `c64u` when it is available; use `u64` as fallback or comparison.
3. If `c64u` becomes unavailable during testing, assume first that app-driven
   traffic from the Pixel 4 may have caused it. Stop further `c64u` traffic,
   preserve app/request diagnostics, and root-cause the request pattern before
   treating the device as externally flaky.
4. Add focused regression tests for confirmed code defects as the fixes are made.
5. Run full tests and coverage only after the core device deliverables are done
   or explicitly paused/blocked.

### Phase 5a - Validate honestly

Run the smallest validation set that the change classification requires.

- `DOC_ONLY` does **not** require builds or tests unless the task explicitly says otherwise.
- `CODE_CHANGE` requires targeted code validation.
- `UI_CHANGE` requires targeted code validation plus the smallest honest UI validation and screenshot refresh only where needed.
- For productionization/device-stabilization runs, broad suites and coverage are
  finalization gates, not a substitute for real Pixel 4 evidence.

### Phase 5b - Deploy the latest APK before completion

Before declaring any task complete, deploy the most recent built APK from `android/app/build/outputs/apk/` to the attached Pixel 4.

- Prefer the adb-attached Pixel 4 with serial prefix `9B0` when it is present.
- Attempt installation of the newest APK first.
- If installation fails because an earlier installed copy blocks the update, uninstall the existing `uk.gleissner.c64commander` package from that Pixel 4 and retry the installation.
- Launch the newly deployed build on that Pixel 4 and validate the user-visible behavior there for the touched feature area before closing the task.
- Record the deployment and on-device validation result in the completion summary; do not claim the work is finished until this deploy-and-validate step has succeeded or a concrete hardware/adb blocker is documented.

### Phase 5c - Version identity must match Git

The app version shown by built APK/IPA artifacts and in-app diagnostics must be
derived from the latest Git tag plus the current Git commit ID. Do not let
`package.json`, Gradle defaults, Xcode defaults, or stale environment values produce
a different displayed version from the source revision being built.

### Phase 6 - Report precisely

At completion, summarize:

- what changed
- which tests/builds were run
- which screenshot files or folders were updated, if any
- why broader validation or screenshot refresh was not needed, when relevant

## Source of truth

- **Primary rules and conventions**: `.github/copilot-instructions.md`
- **REST API docs**: `docs/c64/c64u-openapi.yaml`
- **Telnet menu reference**: `docs/c64/c64u-telnet.yaml` (consult before Telnet-related code or test changes)
- **CTA inventory & keypad map**: `docs/cta-inventory.md` (authoritative per-page list of every interactive control and its keypad/D-pad/T9 reachability; keep current — see "CTA inventory upkeep")
- **App entry**: `src/main.tsx`, `src/App.tsx`
- **UI**: `src/pages/`, `src/components/`, `src/components/ui/`
- **App config state**: `src/hooks/useAppConfigState.ts`, `src/lib/config/`
- **Song sources**: `src/lib/sources/`
- **HVSC module**: `src/lib/hvsc/`
- **SID player utilities**: `src/lib/sid/`

## Architecture map

- **UI**: `src/pages/`, `src/components/`, `src/components/ui/`
- **Hooks + data fetching**: `src/hooks/`, `src/lib/c64api.ts`
- **Config state and mapping**: `src/hooks/useAppConfigState.ts`, `src/lib/config/`
- **Song sources**: `src/lib/sources/` (local FS + HVSC)
- **HVSC ingestion + metadata**: `src/lib/hvsc/` (service/types/native bridge)
- **Native bridges**: `src/lib/native/`, `src/lib/hvsc/native/`
- **Android HVSC engine**: `android/app/src/main/java/com/c64/commander/hvsc/`
- **SID playback utilities**: `src/lib/sid/`

## Build, test, and screenshot decision rules

This section exists to make agent behavior explicit.

### When no build is required

A build is not required when the task is truly `DOC_ONLY`, for example:

- only Markdown files changed
- only textual documentation changed
- only comments changed
- only non-executable prose or guidance files changed

In those cases, do not run builds for ceremony.

### When a build is required

A build is required when the task affects executable behavior or build outputs, for example:

- application code
- tests
- configuration that can affect runtime or build behavior
- assets that are packaged into the app
- generated outputs that are required to stay in sync

### When screenshots must be regenerated

Regenerate screenshots only when visible documented UI changed.

### When screenshots must not be regenerated

Do not regenerate screenshots when the visible documented UI is unchanged, even if internal code changed.

### Minimal screenshot rule

If a task changes only one page or one documented state, update only the corresponding screenshot files or folders under `docs/img/`.

Never refresh the entire screenshot corpus unless explicitly required by the task.

### CTA inventory upkeep (MANDATORY)

`docs/cta-inventory.md` is the authoritative, hierarchical inventory of every CTA
(interactive control) in the app and how each is reached/operated by keypad /
D-pad / T9. It is part of the keypad accessibility contract — a CTA that is not
in the inventory is treated as unverified.

You **must** update `docs/cta-inventory.md` in the **same change** whenever a CTA
or the CTA hierarchy changes, including when you:

- add, remove, rename, or change the `data-testid` of an interactive control;
- change a control's **type** (e.g. button → select, checkbox → slider);
- change focus **grouping/order/nesting** (`useFocusItem`/`useFocusGroup`,
  `data-section-label`, `data-focus-group`) or which scope a control lives in;
- add/remove a route/page, dialog, sheet, or menu that exposes controls;
- change a control's keypad reachability, activation, or default
  enabled/disabled state.

Keep the per-page counts in §3 and the per-page hierarchy in §4 consistent with
the code. The fastest check: re-run the on-device/DOM scope enumeration described
in §7 and reconcile any delta. A `UI_CHANGE` or `DOC_PLUS_CODE` task that touches
controls but leaves this file unchanged is **incomplete**. When in doubt, update
it — an over-listed control is cheaper than a missing one.

## Tests and fixtures

- **Unit**: `npm run test` (Vitest) with specs in `src/**` and `test/`
- **Coverage**: `npm run test:coverage`
- **E2E**: `npm run test:e2e` with specs in `playwright/` and fixtures in `playwright/fixtures/`
- **Android JVM**: `cd android && ./gradlew test` with tests in `android/app/src/test/java/com/c64/commander/hvsc/`
- **Android fixtures**: `android/app/src/test/fixtures/hvsc/`
- **Python agents**: `npm run test:agents` (pytest) with specs in `agents/tests/`; requires ≥90% branch coverage
- **Maestro**: read `docs/testing/maestro.md` before creating or updating flows under `.maestro/`

## Release tag APKs

- CI builds a debug APK for all runs.
- Android Play upload is already operational.
- Tag builds still rely on signing secrets when a signed release artifact must be produced in CI.
- GitHub Actions version tags are an intentional repository policy. Keep release tags aligned with `package.json`.

## Mandatory formatting and style reminders

### Prettier formatting

All TypeScript, TSX, and JSON files must be formatted with Prettier before committing.

- Config: `.prettierrc.json` (`singleQuote: true`; all other options are Prettier v3 defaults).
- **Check**: `npm run format:check:ts` (also runs as part of `npm run lint`).
- **Fix**: `npm run format:ts` (or `npx prettier --write .`).
- Every code change must already be Prettier-compliant when written.
- YAML files are checked separately via `npm run format:check:yaml`.

### Code style

- **DRY**: avoid duplication. Extract shared logic only when it improves clarity and current maintainability.
- **KISS**: prefer simple, explicit solutions.
- **Modularity**: keep files cohesive and responsibilities clear.
- **Readability first**: prefer clear naming over commentary.
- **Explicitness**: make configuration, defaults, and assumptions discoverable.
- **Fail fast**: validate inputs early and surface failures with context.
- **Determinism**: avoid hidden state and non-reproducible behavior unless explicitly required.
- **Testability**: structure code for unit and integration testing without excessive mocking.
- **No dead code**: do not leave unused code paths or speculative scaffolding.
- **Consistency**: follow existing project conventions.
- **Minimal dependencies**: add third-party libraries only when clearly justified.
- **Stable public surfaces**: keep public APIs minimal and intentional.

## Mandatory exception handling (SHOWSTOPPER)

It is forbidden to catch an exception silently.

Whenever an exception is caught, do one of the following:

1. **Rethrow it**, enriched with context:
   - what operation was being performed
   - relevant identifiers, paths, or inputs
2. **Log it** at WARN or ERROR level:
   - full stack trace
   - context explaining what failed and why

Unacceptable patterns include:

- `catch (e) {}`
- `catch (e) { /* ignore */ }`
- `catch (e) { return null; }` without logging or rethrowing

Violating this rule is a release blocker.

## Mandatory error investigation

- Always investigate errors, warnings, and assertion failures.
- Fix root causes. Do not skip tests or suppress warnings.
- Keep the repository buildable. If changes break builds, fix them before declaring work complete.
- Exceptions must never be ignored; log them or let them bubble up.

## React effect/setState safety (infinite re-render & coverage-hang prevention)

A `setState` driven from an effect (or a callback the effect invokes) that feeds a
**referentially-unstable but value-equal** value, while that value is an effect
dependency, creates an infinite synchronous re-render loop. It pegs one CPU core
and **starves the event loop, so Vitest's test timeout never fires** — it surfaces
as an indefinite `npm run test:coverage` hang (one file/chunk never finishes), NOT
a failing test. Real regression: `src/pages/ConfigBrowserPage.tsx` fed `items`
(rebuilt fresh each render) straight into `setAudioConfiguredItems` during re-sync.

- **Never** set state from a value that may be a new reference each render when
  that value is also an effect dependency. Stabilize the reference (`useMemo` on
  the true inputs, or a ref), or guard the setter with a value-equality bail so
  React short-circuits: `if (equal(prev, next)) return;`.
- React-query `data` is referentially stable in production (structural sharing),
  but **hook mocks that return a fresh object each render are not**. Write the
  component so an unstable-but-equal upstream cannot loop it — the mock is the
  realistic adversary, not something to paper over in the test.
- A Vitest file/chunk that hangs with a worker pegged at ~100% CPU (and prints no
  further dots) is a synchronous render/compute loop, not an open handle. Bisect
  to the file, then the test/code path, and fix the loop at source — never add a
  timeout. Note: `timeout`-killing a hung run orphans tinypool worker children
  that keep spinning; `pkill -9 -f vitest` between bisect iterations.
- Treat `await refetch()` (and similar query results) defensively: use optional
  chaining (`refreshed?.data`); the result can be undefined in tests and edge cases.

## Mandatory bug-fix regression coverage

- Every bug fix must add or update a dedicated regression test that fails before the fix and passes after it.
- The regression test must target the specific edge condition, acceptance criterion, or failure mode being fixed.
- Test names must describe the locked-in behavior precisely.
- If a fix spans multiple layers, add the narrowest deterministic test at each affected layer instead of relying on a single broad integration test.

## Mandatory coverage gate before completion

- For any plan/task that includes code changes, run `npm run test:coverage` before declaring completion.
- The run must satisfy a safety margin of at least **91% branch coverage** globally.
- If branch coverage is below 91%, continue adding meaningful tests until it is `>= 91%`.
- For changes under `agents/`, also run `npm run test:agents` and confirm `>= 90%` branch coverage.
- Global coverage is necessary but not sufficient for PR convergence. You must also verify **changed-line (patch) coverage** for the current branch.
- Never infer patch coverage from global totals. Use the CI/Codecov patch report or a local changed-line check against merged coverage output.
- If patch coverage fails, treat it as a blocker even when global branch coverage is above 91%.
- Minimize formatting-only churn in executable files because it creates extra patch lines that must be covered.

### Exception: fast local Android deploy loop

- If the user prompt explicitly includes `FAST_ANDROID_DEPLOY`, `fast deploy`, `quick deploy`, `deploy to device`, `device loop`, `device test`, or `no-coverage deploy`, treat it as a local device-debug workflow.
- In that workflow, skip tests, coverage, lint, and screenshot regeneration unless the user explicitly asks for them.
- Prefer `./build --skip-tests --install-apk` and let the build helper auto-select the attached device unless multiple devices are present.
- If the user establishes an ongoing preference for this workflow, keep using the fast deploy path after each completed task until the user explicitly asks to run tests or widen validation.
- This exception exists only to optimize local deploy/debug turnaround.
- When the user invokes `.github/prompts/pr-converge.prompt.md`, the exception no longer applies and full validation plus coverage are mandatory again.

### Exception: Ralph / Productionization HIL loop

When the active prompt is a Ralph, productionization, hardening,
device-stabilization, Pixel 4 HIL, droidmind, c64scope, or no-coverage device-loop
prompt, do not run `npm run test:coverage` merely because code changes exist.

For these loops:

- Pixel 4 HIL evidence is the primary deliverable.
- Targeted regression tests are required for confirmed code defects.
- Coverage and changed-line coverage are finalization or PR-convergence gates only.
- Do not run coverage while a HIL-capable process is active or while HIL deliverables
  remain open.
- If this provider lacks droidmind/c64scope and another process owns the HIL window,
  do not select code/build/coverage validation work. Update handoff state if needed,
  then stop or schedule the peer-enabled continuation.
- Run coverage only when the selected objective is explicitly final PR/release
  convergence, the user explicitly asks for coverage, or all current HIL deliverables
  are complete or explicitly blocked.

## Mandatory handling of concurrent changes

- If unexpected changes appear in the worktree, keep them as-is and continue.
- Assume they may have been created by a concurrently running LLM unless the task explicitly proves otherwise.

## Output wording rules

- Keep wording short.
- Describe only the current state of documents when changing them.
- Do not claim builds, tests, or screenshot refreshes you did not actually perform.

## Golden trace stewardship

When modifying Playwright tests, REST routing, or tracing logic:

1. Detect changes that affect trace semantics (order, payloads, endpoints, or normalization).
2. If trace semantics change, re-run golden trace recording locally.
3. Commit updated golden traces under `playwright/fixtures/traces/golden`.
4. Never weaken trace assertions to make tests pass; fix the root cause instead.

## Fast path (before a PR)

### Platform build scope

- Only Android can be built locally.
- For iOS, rely on CI (macOS runners) for build and validation.

### Install dependencies

```bash
npm install
```

### Build and test (web)

Use the subset that matches the task. Typical baseline for executable changes:

```bash
npm run test
npm run lint
npm run build
```

### Build and sync Android (local)

```bash
npm run cap:build
```

Set `JAVA_HOME` to a valid JDK install and avoid hardcoded system paths.

### Full local helper (if applicable)

```bash
./build --install-apk
```

## What to optimize for

- responsive UI and clear feedback
- stable network interactions with the C64U
- test reliability and clean error reporting
- minimal, accurately scoped changes
- disciplined screenshot maintenance

## Exploratory investigations

- For Android exploratory or regression investigations, assume a local Android handset is attached over adb and a live C64 Ultimate is reachable.
- **Device preference order**: prefer `u64` (Ultimate 64 Elite, hostname `u64`) over `c64u` (Commodore 64 Ultimate , hostname `c64u`). Always probe `u64` first.
- Probe both `u64` and `c64u` over REST at `http://u64/v1/info` and `http://c64u/v1/info` before device-flow validation.
- If `u64` is reachable, use it. Fall back to `c64u` only if `u64` is unreachable.
- Prefer proving Android/device fixes against a real-device path before treating emulator-only evidence as sufficient.
- For hardware-backed validation, use the adb-attached Pixel 4 when it is present.
- Record which hardware target was chosen and do not claim device validation when neither host is reachable.

## Modularization guardrails

- If a file grows beyond about 600 lines or mixes concerns, split it.
- If a file approaches 1000 lines, refactoring is expected unless there is a strong documented reason not to.
