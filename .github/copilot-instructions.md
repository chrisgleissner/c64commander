# Copilot Instructions for c64commander

## Non-negotiables (READ FIRST)

1. **Agent entrypoint**: also see `AGENTS.md`.
2. **Never skip tests or ignore failures**:
   - Do NOT add skips or comment out failing code/tests.
   - Fix root causes.
3. **Keep the repo buildable**:
   - If changes break builds, fix them before declaring work complete.
4. **Before declaring work complete**:
   - Ensure relevant docs are updated (`README.md`, `doc/`, `docs/`).
   - Run tests and build steps that apply to your actual change set.
   - Do **not** run a build, test suite, screenshot flow, or asset regeneration step that is irrelevant to the files you changed.
   - If work only affected Markdown or other non-executable documentation files, do **not** run build steps purely for ceremony.
   - If work affected executable code, configuration, assets consumed at runtime, or generated outputs that must stay in sync, run the relevant validation and fix any errors before saying work is done.
5. **Every bug fix needs a dedicated regression test**:
   - Add or update a precise regression test for the bug you fixed.
   - Name the test after the edge condition or acceptance criterion it locks in.
   - Prefer the narrowest deterministic test that proves the fix, and add additional layer-specific tests when a bug spans multiple layers.
6. **Never silently swallow exceptions**:
   - It is forbidden to catch an exception and ignore it.
   - Whenever an exception is caught, either rethrow it with added context or log it at WARN/ERROR level with stack trace and relevant identifiers.
7. **Do not revert unrelated worktree changes**:
   - If unrelated changes appear, assume they may belong to a concurrently running LLM unless the task explicitly instructs otherwise.

## Change classification (MANDATORY FIRST STEP)

Before running builds, tests, or screenshot flows, classify the task into one or more of these categories and let that classification control validation scope.

### 1. `DOC_ONLY`

Changes only affect non-executable documentation or prose, for example:

- `*.md`
- documentation comments only
- README/doc updates
- textual guidance files that are not executed by tooling

### 2. `CODE_CHANGE`

Changes affect executable code, build scripts, configuration, tests, or runtime assets, for example:

- `src/`
- `android/`
- `agents/`
- `package.json`
- `vite.config.*`
- Playwright, Maestro, Vitest, Gradle, or Python test code

### 3. `UI_CHANGE`

Changes affect visible rendered UI, navigation, labels, layout, interactive controls, icons, colors, or screenshots.

### 4. `DOC_PLUS_CODE`

If both documentation and executable code changed, treat the task as a code change and also update the relevant docs.

## Validation matrix

Apply the smallest validation set that honestly matches the change.

### For `DOC_ONLY`

Required:

- verify the docs are accurate and internally consistent
- update cross-references if needed
- ensure formatting stays clean

Do **not** run any of these unless the task explicitly requires them:

- `npm run build`
- `npm run test`
- `npm run test:e2e`
- `./build`
- Android build/sync flows
- screenshot regeneration

### For `CODE_CHANGE` that is **not** a visible UI change

Run the validation relevant to the touched layer(s). Typical examples:

```bash
npm run lint
npm run test
npm run build
```

Add more targeted validation when appropriate, for example:

```bash
npm run test:agents
cd android && ./gradlew test
```

Do **not** regenerate screenshots unless visible UI output changed.

### For `UI_CHANGE`

Run the normal code validation for the touched layer(s), and also run the smallest UI validation that can prove the change.

Typical baseline:

```bash
npm run lint
npm run test
npm run build
```

Add targeted UI validation as needed, for example:

```bash
npm run test:e2e
npm run cap:build
```

Only regenerate screenshots for UI surfaces whose visible output actually changed.

## Screenshot and documentation image policy (MANDATORY)

Documentation screenshots live under `doc/img/`.

They are part of the repository's user-visible documentation and must stay accurate, but they must be updated with discipline.

### When screenshots MUST be updated

Update screenshots only when the visible UI changed in a way that makes existing documentation images inaccurate, including changes to:

- page layout
- labels or headings
- buttons, controls, or icons
- page sections appearing or disappearing
- navigation structure visible in the screenshot
- colors, spacing, or styling where the difference is visible and relevant in docs
- empty states, dialogs, or overlays that are explicitly documented

### When screenshots MUST NOT be updated

Do **not** update screenshots for changes that do not alter the documented visible UI, including:

- Markdown or documentation-only changes
- refactors with identical UI output
- API/client/internal state changes with no visible difference
- non-UI test changes
- backend logic changes with unchanged UI
- dependency or tooling updates with unchanged UI
- unrelated pages that were not affected by the task

### Minimal screenshot update rule

Regenerate **only** the smallest screenshot subset needed to bring docs back to accuracy.

Examples:

- If only the Home page changed, only update screenshots under the Home-related folder(s).
- If only one dialog changed, only update screenshots that show that dialog.
- If a change affects dark mode but not light mode, only regenerate the impacted mode's screenshots.

Never bulk-regenerate all screenshots just because a screenshot tool is available.

### Screenshot mapping discipline

Before regenerating screenshots:

1. Identify exactly which page(s), state(s), and mode(s) changed.
2. Identify the corresponding files under `doc/img/`.
3. Replace only those files unless the task explicitly requires broader refresh.
4. Preserve existing file names and folder structure unless documentation structure itself changed.

### Screenshot evidence rule

If screenshots were updated, the completion summary must state exactly which screenshot files or folders were regenerated and why.

If screenshots were **not** updated for a UI-related task, explicitly state why they were unnecessary.

## Quick discovery

- **High-level context**: `README.md`
- **REST API docs**: `doc/c64/c64u-openapi.yaml`, `doc/c64/c64u-rest-api.md`
- **UX guidance**: `doc/ux-guidelines.md`
- **Maestro guidance**: `doc/testing/maestro.md`
- **UI pages**: `src/pages/`
- **Navigation**: `src/components/TabBar.tsx`
- **Core API client**: `src/lib/c64api.ts`
- **Hooks**: `src/hooks/`
- **Song sources**: `src/lib/sources/`
- **HVSC module**: `src/lib/hvsc/`, `android/app/src/main/java/com/c64/commander/hvsc/`
- **SID player utilities**: `src/lib/sid/`

## Project overview

React + Vite + Capacitor app for managing a C64 Ultimate device. Supports configuration, device control, and SID playback.

## Architecture boundaries

- **UI**: `src/pages/`, `src/components/`, `src/components/ui/`
- **Data/hooks**: `src/hooks/`, `src/lib/c64api.ts`
- **App config state**: `src/hooks/useAppConfigState.ts`, `src/lib/config/`
- **Song sources**: `src/lib/sources/` (local FS + HVSC)
- **HVSC ingestion**: `src/lib/hvsc/` (service/types/native bridge)
- **Native bridges**: `src/lib/native/`, `src/lib/hvsc/native/`
- **Android HVSC engine**: `android/app/src/main/java/com/c64/commander/hvsc/`
- **SID playback utilities**: `src/lib/sid/`

## Code guidelines

### Principles

1. **Clarity**: predictable state and UI feedback.
2. **Reliability**: handle network errors and timeouts.
3. **Performance**: avoid unnecessary re-fetches and expensive rendering.
4. **Consistency**: reuse existing UI components and patterns.
5. **Determinism**: prefer explicit state transitions and reproducible behavior.
6. **Fail fast**: validate inputs early and make failures diagnosable.
7. **Minimal scope**: implement only what the task requires.

### Formatting

- All TS, TSX, and JSON files must be formatted with Prettier before committing.
- Config: `.prettierrc.json` (`singleQuote: true`; Prettier v3 defaults otherwise).
- Check: `npm run format:check:ts` (also runs as part of `npm run lint`).
- Fix: `npm run format:ts` or `npx prettier --write .`.
- Every code change must be Prettier-compliant when written - do not rely on a post-hoc format pass.
- YAML files are checked via `npm run format:check:yaml`.

### Documentation

- Keep technical docs in `doc/`.
- Keep user-facing docs in `README.md`.
- When docs embed screenshots, keep image paths and captions aligned with the actual updated files.

## Build and test (local)

Use the smallest honest subset for the change you made.

Typical web validation:

```bash
npm install
npm run lint
npm run test
npm run build
```

## Tests and fixtures

- **Unit**: `npm run test` (Vitest) with specs in `src/**` and `test/`
- **Coverage**: `npm run test:coverage`
- **E2E**: `npm run test:e2e` with specs in `playwright/` and fixtures in `playwright/fixtures/`
- **Android JVM**: `cd android && ./gradlew test` with tests in `android/app/src/test/java/com/c64/commander/hvsc/`
- **Android fixtures**: `android/app/src/test/fixtures/hvsc/`
- **Python agents**: `npm run test:agents` (pytest) with specs in `agents/tests/`; requires ≥90% branch coverage
- **Maestro**: read `doc/testing/maestro.md` before creating or updating flows under `.maestro/`

## Coverage expectations

- For any task that includes code changes, run `npm run test:coverage` before declaring completion.
- Branch coverage must remain at least **91%** globally.
- For changes under `agents/`, also run `npm run test:agents` and keep branch coverage at **≥90%** there.
- Do not add low-value tests merely to inflate coverage. Add meaningful tests that lock behavior.

## Android (local)

```bash
npm run cap:build
./build --install-apk
```

Set `JAVA_HOME` to a valid JDK install and avoid hardcoded system paths.

## Exploratory investigations

- For Android exploratory or regression investigations, assume a local Android phone is attached and a live C64 Ultimate is reachable at hostname `c64u`.
- Use that attached Android + `c64u` path for exploratory validation before falling back to emulator-only evidence.

## Golden trace stewardship

When modifying Playwright tests, REST routing, or tracing logic:

1. Detect changes that affect trace semantics (order, payloads, endpoints, or normalization).
2. If trace semantics change, re-run golden trace recording locally.
3. Commit updated golden traces under `playwright/fixtures/traces/golden`.
4. Never weaken trace assertions to make tests pass; fix the root cause instead.

## Release tag APKs

- CI builds a debug APK for all runs.
- Android Play upload is already operational.
- Tag builds still rely on signing secrets when a signed release artifact must be produced in CI.
- GitHub Actions version tags are an intentional repository policy. Keep release tags aligned with `package.json`.
- TODO: set `ANDROID_KEYSTORE_BASE64`, `KEYSTORE_STORE_PASSWORD`, `KEYSTORE_KEY_PASSWORD`, and `KEYSTORE_KEY_ALIAS` before enabling signed release distribution where required.

## CI expectations

- Keep `package.json` scripts green.
- Avoid committing generated Android assets unless explicitly required.
- Keep completion summaries short and factual.
- Describe only the current repository state, not speculative future states.
