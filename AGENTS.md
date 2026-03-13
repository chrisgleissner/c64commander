# Agent Guide (LLM / Copilot / Cursor)

This repository is **C64 Commander**, a React + Vite + Capacitor app for managing and controlling a C64 Ultimate device.

## Quick orientation

1. Start with `README.md` for overview, local build steps, and Android notes.
2. REST API details live in `doc/c64/c64u-openapi.yaml`
3. Read the UX design in `doc/ux-guidelines.md` before any UX work.
4. Read `doc/testing/maestro.md` before authoring or editing any Maestro flows.
5. UI routes live in `src/pages/` and navigation in `src/components/TabBar.tsx`.
6. Networking + data hooks are in `src/lib/c64api.ts` and `src/hooks/`.
7. Song sources live in `src/lib/sources/` and the HVSC module lives in `src/lib/hvsc/`.
8. Use `.github/copilot-instructions.md` for mandatory workflows (it overrides this file on conflicts).

## Source of truth

- **Primary rules & conventions**: `.github/copilot-instructions.md`
- **REST API docs**: `doc/c64/c64u-openapi.yaml`
- **App entry**: `src/main.tsx`, `src/App.tsx`
- **UI**: `src/pages/`, `src/components/`, `src/components/ui/`
- **App config state**: `src/hooks/useAppConfigState.ts`, `src/lib/config/`
- **Song sources**: `src/lib/sources/`
- **HVSC module**: `src/lib/hvsc/`
- **SID player**: `src/pages/MusicPlayerPage.tsx`, `src/hooks/useSidPlayer.tsx`, `src/lib/sid/`

## Architecture map

- **UI**: `src/pages/`, `src/components/`
- **Hooks + data fetching**: `src/hooks/`, `src/lib/c64api.ts`
- **Song sources**: `src/lib/sources/` (local FS + HVSC)
- **HVSC ingestion + metadata**: `src/lib/hvsc/` (service/types/native bridge)
- **Native bridges**: `src/lib/native/`, `src/lib/hvsc/native/`
- **SID playback utilities**: `src/lib/sid/`

## Tests and fixtures

- **Unit**: `npm run test` (Vitest) with specs in `src/**` and `test/`
- **E2E**: `npm run test:e2e` with specs in `playwright/` and fixtures in `playwright/fixtures/`
- **Android JVM**: `cd android && ./gradlew test` with tests in `android/app/src/test/java/com/c64/commander/hvsc/`
- **Android fixtures**: `android/app/src/test/fixtures/hvsc/`
- **Python agents**: `npm run test:agents` (pytest) with specs in `agents/tests/`; requires ≥90% branch coverage
- **Maestro**: Read `doc/testing/maestro.md` before creating or updating flows under `.maestro/`

## Release tag APKs

- CI builds a debug APK for all runs.
- Android Play upload is already operational.
- Tag builds still rely on signing secrets when a signed release artifact must be produced in CI.
- GitHub Actions version tags are an intentional repository policy. Keep release tags aligned with `package.json`.

## MANDATORY: Prettier formatting

All TypeScript, TSX, and JSON files must be formatted with Prettier before committing.

- Config: `.prettierrc.json` (`singleQuote: true`; all other options are Prettier v3 defaults).
- **Check**: `npm run format:check:ts` (also runs as part of `npm run lint`).
- **Fix**: `npm run format:ts` (or `npx prettier --write .`).
- Every code change you write must already be Prettier-compliant — do not rely on a post-hoc format pass.
- YAML files are checked separately via `npm run format:check:yaml`.

## MANDATORY: Code Style

- **DRY**: Avoid duplication. Extract shared logic into well-defined functions, modules, or utilities.
- **KISS**: Prefer simple, explicit solutions. Do not introduce abstractions or indirection unless they provide clear, measurable value.
- **Modularity**: Structure code into cohesive files and modules with a single, well-defined responsibility and minimal coupling.
- **File Size Limits**: Keep source files under 1000 lines. If a file approaches this limit, refactor by splitting it into smaller, logically coherent units.
- **Readability First**: Code must be self-explanatory. Prefer clear naming over comments. Use comments only for intent, rationale, and non-obvious decisions.
- **Explicitness**: Avoid hidden or implicit behavior. Configuration, defaults, and assumptions must be explicit and discoverable.
- **Fail Fast**: Validate inputs early and fail deterministically. Do not silently ignore errors or rely on undefined behavior.
- **Determinism**: Ensure logic is deterministic and reproducible. Avoid hidden state, time-dependent behavior, and implicit global dependencies unless explicitly required.
- **Testability**: Structure code to support unit and integration testing without excessive mocking or complex setup.
- **No Dead Code**: Do not leave unused code paths, commented-out blocks, or speculative implementations.
- **Consistency**: Follow existing project conventions for naming, formatting, and structure. Do not introduce new patterns without clear justification.
- **Minimal Dependencies**: Introduce third-party libraries only when clearly justified. Prefer standard library solutions where reasonable.
- **No Over-Abstraction**: Do not create abstractions for hypothetical future use. Every abstraction must serve a concrete, current need.
- **Single Responsibility**: Functions and classes must have one clear responsibility and a well-defined scope.
- **Stable Public Surfaces**: Public APIs must be minimal, intentional, and documented. Breaking changes require explicit versioning.

## MANDATORY: Exception Handling (SHOWSTOPPER)

It is absolutely forbidden to catch an exception silently.

Whenever an exception is caught, you must do **one** of the following:

1. **Rethrow it**, enriched with context:
   - What operation was being performed
   - Relevant identifiers, paths, or inputs
2. **Log it** at WARN or ERROR level:
   - Full stack trace
   - Context explaining what failed and why

Unacceptable patterns include:

- `catch (e) {}`
- `catch (e) { /* ignore */ }`
- `catch (e) { return null; }` without logging or rethrowing

Violine this rule is a release blocker.

## MANDATORY: Error investigation

- Always investigate errors, warnings, and assertion failures.
- Fix root causes. Do not skip tests or suppress warnings.
- Keep the repository buildable. If changes break builds, fix them before declaring work complete.
- Exceptions must never be ignored; log them or let them bubble up.

## MANDATORY: Bug-fix regression coverage

- Every bug fix must add or update a dedicated regression test that fails before the fix and passes after it.
- The regression test must target the specific edge condition, acceptance criterion, or failure mode being fixed instead of only broad happy-path behavior.
- Test names must describe the locked-in behavior precisely so future reviewers can tell which bug is being prevented from regressing.
- If a fix spans multiple layers, add the narrowest deterministic test at each affected layer instead of relying on a single broad integration test.

## MANDATORY: Coverage gate before completion

- For any plan/task that includes code changes, run `npm run test:coverage` before declaring completion.
- The run must satisfy a safety margin of at least **91% branch coverage** (global), aligned with CI threshold enforcement.
- If branch coverage is below 91%, continue adding meaningful tests until it is >= 91%.
- For changes under `agents/`, also run `npm run test:agents` and confirm ≥90% branch coverage.

## MANDATORY: Concurrent changes

- If unexpected changes appear in the worktree, keep them as-is and continue. They are created by a concurrently running LLM.

## Output wording rules

- Keep wording short.
- Describe only the current state of documents when changing them.

## Golden Trace Stewardship

When modifying Playwright tests, REST routing, or tracing logic:

1. Detect changes that affect trace semantics (order, payloads, endpoints, or normalization).
2. If trace semantics change, re-run golden trace recording locally.
3. Commit updated golden traces under playwright/fixtures/traces/golden.
4. Never weaken trace assertions to make tests pass; fix the root cause instead.

## Fast path (before a PR)

### Platform build scope

- Only Android can be built locally.
- For iOS, rely on CI (macOS runners) for build and validation.

### Install dependencies

```bash
npm install
```

### Build & test (web)

```bash
npm run test
npm run lint
npm run build
```

### Build & sync Android (local)

```bash
npm run cap:build
```

Set `JAVA_HOME` to a valid JDK install and avoid hardcoded system paths.

### Full local helper (if applicable)

```bash
./build --install-apk
```

## What to optimize for

- Responsive UI and clear feedback.
- Stable network interactions with the C64U.
- Test reliability and clean error reporting.

## Exploratory investigations

- For Android exploratory or regression investigations, assume a local Android handset is attached over adb and a live C64 Ultimate is reachable at hostname `c64u`.
- Prefer proving Android/C64U fixes against that real-device path before treating emulator-only evidence as sufficient.

## Modularization guardrails

- If a file grows beyond ~600 lines or mixes concerns, split it.
