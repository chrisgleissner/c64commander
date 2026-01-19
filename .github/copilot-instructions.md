# Copilot Instructions for c64commander

## Non-negotiables (READ FIRST)

1. **Agent entrypoint**: also see [AGENTS.md](../AGENTS.md).
2. **Never skip tests or ignore failures**:
    - Do NOT add skips or comment out failing code/tests.
    - Fix root causes.
3. **Keep the repo buildable**:
    - If changes break builds, fix them before declaring work complete.
4. **Before declaring work complete**:
    - Ensure relevant docs are updated (`README.md`, `doc/`, `docs/`).
    - Run tests and build steps that apply to your change set.

## Quick discovery

- **High-level context**: `README.md`
- **REST API docs**: `doc/c64/c64u-openapi.yaml`, `doc/c64/c64u-rest-api.md`
- **UI pages**: `src/pages/`
- **Core API client**: `src/lib/c64api.ts`
- **Hooks**: `src/hooks/`
- **Song sources**: `src/lib/sources/`
- **HVSC module**: `src/lib/hvsc/`, `android/app/src/main/java/com/c64/commander/hvsc/`
- **SID player**: `src/pages/MusicPlayerPage.tsx`, `src/hooks/useSidPlayer.tsx`, `src/lib/sid/`

## Project overview

React + Vite + Capacitor app for managing a C64 Ultimate device. Supports configuration, device control, and SID playback.

## Architecture boundaries

- **UI**: `src/pages/`, `src/components/`
- **Data/hooks**: `src/hooks/`, `src/lib/c64api.ts`
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

### Formatting
- Use existing formatting and lint rules.
- Do not reformat unrelated code.

### Documentation
- Keep technical docs in `doc/`.
- Keep user-facing docs in `README.md`.

## Build & test (local)

```bash
npm install
npm run lint
npm run test
npm run build
```

## Tests and fixtures

- **Unit**: `npm run test` (Vitest) with specs in `src/**` and `test/`
- **E2E**: `npm run test:e2e` with specs in `playwright/` and fixtures in `playwright/fixtures/`
- **Android JVM**: `cd android && ./gradlew test` with tests in `android/app/src/test/java/com/c64/commander/hvsc/`
- **Android fixtures**: `android/app/src/test/fixtures/hvsc/`

## Android (local)

```bash
npm run cap:build
./local-build.sh --install
```

## Release tag APKs

- Tag builds attempt a release APK only when signing secrets are present.
- TODO: set `ANDROID_KEYSTORE_BASE64`, `KEYSTORE_STORE_PASSWORD`, `KEYSTORE_KEY_PASSWORD`, and `KEYSTORE_KEY_ALIAS` before enabling signed release distribution.

## CI expectations

- Keep `package.json` scripts green.
- Avoid committing generated Android assets unless explicitly required.
