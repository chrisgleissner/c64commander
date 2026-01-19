# Agent Guide (LLM / Copilot / Cursor)

This repository is **C64 Commander**, a React + Vite + Capacitor app for managing and controlling a C64 Ultimate device.

## Quick orientation

1. Start with `README.md` for overview, local build steps, and Android notes.
2. REST API details live in `doc/c64/c64u-openapi.yaml` and `doc/c64/c64u-rest-api.md`.
3. UI routes live in `src/pages/` and navigation in `src/components/TabBar.tsx`.
4. Networking + data hooks are in `src/lib/c64api.ts` and `src/hooks/`.
5. Song sources live in `src/lib/sources/` and the HVSC module lives in `src/lib/hvsc/`.
6. Use `.github/copilot-instructions.md` for mandatory workflows (it overrides this file on conflicts).

## Source of truth

- **Primary rules & conventions**: `.github/copilot-instructions.md`
- **REST API docs**: `doc/c64/c64u-openapi.yaml`
- **App entry**: `src/main.tsx`, `src/App.tsx`
- **UI**: `src/pages/`, `src/components/`, `src/components/ui/`
- **App config state**: `src/hooks/useAppConfigState.ts`, `src/lib/config/`
- **Song sources**: `src/lib/sources/`
- **HVSC module**: `src/lib/hvsc/`, `android/app/src/main/java/com/c64/commander/hvsc/`
- **SID player**: `src/pages/MusicPlayerPage.tsx`, `src/hooks/useSidPlayer.tsx`, `src/lib/sid/`

## Architecture map

- **UI**: `src/pages/`, `src/components/`
- **Hooks + data fetching**: `src/hooks/`, `src/lib/c64api.ts`
- **Song sources**: `src/lib/sources/` (local FS + HVSC)
- **HVSC ingestion + metadata**: `src/lib/hvsc/` (service/types/native bridge)
- **Native bridges**: `src/lib/native/`, `src/lib/hvsc/native/`
- **Android HVSC engine**: `android/app/src/main/java/com/c64/commander/hvsc/`
- **SID playback utilities**: `src/lib/sid/`

## Tests and fixtures

- **Unit**: `npm run test` (Vitest) with specs in `src/**` and `test/`
- **E2E**: `npm run test:e2e` with specs in `playwright/` and fixtures in `playwright/fixtures/`
- **Android JVM**: `cd android && ./gradlew test` with tests in `android/app/src/test/java/com/c64/commander/hvsc/`
- **Android fixtures**: `android/app/src/test/fixtures/hvsc/`

## Release tag APKs

- CI builds a debug APK for all runs.
- Tag builds attempt a release APK only when signing secrets are present.
- TODO: set `ANDROID_KEYSTORE_BASE64`, `KEYSTORE_STORE_PASSWORD`, `KEYSTORE_KEY_PASSWORD`, and `KEYSTORE_KEY_ALIAS` before enabling signed release distribution.

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

## MANDATORY: Error investigation

- Always investigate errors, warnings, and assertion failures.
- Fix root causes. Do not skip tests or suppress warnings.
- Keep the repository buildable. If changes break builds, fix them before declaring work complete.

## Output wording rules

- Keep wording short.
- Describe only the current state of documents when changing them.

## Fast path (before a PR)

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

### Full local helper (if applicable)

```bash
./local-build.sh --install
```

## What to optimize for

- Responsive UI and clear feedback.
- Stable network interactions with the C64U.
- Test reliability and clean error reporting.

## Modularization guardrails

- If a file grows beyond ~600 lines or mixes concerns, split it.
