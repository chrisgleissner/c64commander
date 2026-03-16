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
2. REST API details live in `doc/c64/c64u-openapi.yaml`.
3. Read the UX design in `doc/ux-guidelines.md` before any UX work.
4. Read `doc/testing/maestro.md` before authoring or editing any Maestro flows.
5. UI routes live in `src/pages/` and navigation in `src/components/TabBar.tsx`.
6. Networking and data hooks are in `src/lib/c64api.ts` and `src/hooks/`.
7. Song sources live in `src/lib/sources/` and the HVSC module lives in `src/lib/hvsc/`.
8. Use `.github/copilot-instructions.md` for mandatory workflows. It overrides this file on conflicts.

## Required execution model

Follow this sequence unless the task explicitly requires something narrower.

### Phase 1 - Read before acting

Read the smallest relevant set first:

1. `README.md`
2. `.github/copilot-instructions.md`
3. `doc/ux-guidelines.md` for UI work
4. `doc/testing/maestro.md` for Maestro work
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
- screenshot folders under `doc/img/`
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

### Phase 5 - Validate honestly

Run the smallest validation set that the change classification requires.

- `DOC_ONLY` does **not** require builds or tests unless the task explicitly says otherwise.
- `CODE_CHANGE` requires targeted code validation.
- `UI_CHANGE` requires targeted code validation plus the smallest honest UI validation and screenshot refresh only where needed.

### Phase 6 - Report precisely

At completion, summarize:

- what changed
- which tests/builds were run
- which screenshot files or folders were updated, if any
- why broader validation or screenshot refresh was not needed, when relevant

## Source of truth

- **Primary rules and conventions**: `.github/copilot-instructions.md`
- **REST API docs**: `doc/c64/c64u-openapi.yaml`
- **App entry**: `src/main.tsx`, `src/App.tsx`
- **UI**: `src/pages/`, `src/components/`, `src/components/ui/`
- **App config state**: `src/hooks/useAppConfigState.ts`, `src/lib/config/`
- **Song sources**: `src/lib/sources/`
- **HVSC module**: `src/lib/hvsc/`
- **SID player**: `src/pages/MusicPlayerPage.tsx`, `src/hooks/useSidPlayer.tsx`, `src/lib/sid/`

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

If a task changes only one page or one documented state, update only the corresponding screenshot files or folders under `doc/img/`.

Never refresh the entire screenshot corpus unless explicitly required by the task.

## Tests and fixtures

- **Unit**: `npm run test` (Vitest) with specs in `src/**` and `test/`
- **Coverage**: `npm run test:coverage`
- **E2E**: `npm run test:e2e` with specs in `playwright/` and fixtures in `playwright/fixtures/`
- **Android JVM**: `cd android && ./gradlew test` with tests in `android/app/src/test/java/com/c64/commander/hvsc/`
- **Android fixtures**: `android/app/src/test/fixtures/hvsc/`
- **Python agents**: `npm run test:agents` (pytest) with specs in `agents/tests/`; requires ≥90% branch coverage
- **Maestro**: read `doc/testing/maestro.md` before creating or updating flows under `.maestro/`

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

- For Android exploratory or regression investigations, assume a local Android handset is attached over adb and a live C64 Ultimate is reachable at hostname `c64u`.
- Prefer proving Android/C64U fixes against that real-device path before treating emulator-only evidence as sufficient.

## Modularization guardrails

- If a file grows beyond about 600 lines or mixes concerns, split it.
- If a file approaches 1000 lines, refactoring is expected unless there is a strong documented reason not to.
