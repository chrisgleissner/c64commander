# PLANS.md - Authoritative Execution Plan

## Mission
Fix local + CI build so everything is green, starting with `npm ci` lockfile sync. Work is tracked here and updated after every meaningful action.

## Phase 1: Dependency + Lockfile Sync (BLOCKING)

### Hypotheses
- H1: `package.json` has `react-virtuoso@4.18.1` but `package-lock.json` is missing it.
- H2: Lockfile was generated with a different npm version or was not updated after dependency changes.

### Actions
- [x] Inspect `package.json` and `package-lock.json` for `react-virtuoso` entries.
- [x] Regenerate lockfile deterministically with project npm version (if needed).
- [x] Validate `npm ci` locally after lockfile fix.

### Observations
- `package.json` declares `react-virtuoso@^4.18.1`, but `package-lock.json` has no `react-virtuoso` entry.
- Ran `npm install`; lockfile now includes `react-virtuoso@4.18.1` and related node_modules metadata.
- `npm ci` completes successfully (with existing deprecation warnings).

### Decisions / Rationale
- Updated lockfile via `npm install` to align with `package.json` and unblock deterministic `npm ci`.

## Phase 2: Local Build + Test (BLOCKING)

### Hypotheses
- H1: Build and tests should pass once dependencies are aligned.

### Actions
- [x] Run `npm run lint`.
- [x] Run `npm run test`.
- [x] Run `npm run build`.

### Observations
- `npm run lint` fails with 33 `@typescript-eslint/ban-ts-comment` errors in unit tests; requires replacing `@ts-ignore` with `@ts-expect-error`.
- Replaced `@ts-ignore` comments with `@ts-expect-error` in affected unit tests.
- Re-run lint still fails because `@ts-expect-error` directives require a description.
- Added descriptions to all `@ts-expect-error` directives in affected unit tests.
- `npm run lint` now passes.
- `npm run test` fails in `hvscIngestionRuntime_coverage.test.ts` with `Cannot read properties of undefined (reading 'data')` at `ingestCachedHvsc` (reading `archiveData.data`).
- Added `Filesystem.readFile` mock in `hvscIngestionRuntime_coverage.test.ts` for cached archive ingestion.
- Reapplied `extractArchiveEntries` mock implementation in `hvscIngestionRuntime_coverage.test.ts` after `resetAllMocks`.
- `npm run test` now passes.
- `npm run build` completes successfully (with Vite externalized module warning).

### Decisions / Rationale
- Updated unit tests to comply with `@typescript-eslint/ban-ts-comment` and to restore deterministic mocks after `resetAllMocks`.

## Phase 3: Maestro on CI (BLOCKING)

### Hypotheses
- H1: Maestro can run in parallel with other CI phases and still finish within ~6 minutes total wall-clock.
- H2: Emulator startup (~3 minutes) can overlap with build/test steps.

### Actions
- [x] Review CI pipeline for Maestro orchestration and overlap.
- [ ] Ensure Maestro runs without extending total wall time beyond ~6 minutes.

### Observations
- Maestro CI job starts emulator in background before `npm ci`, builds, and Maestro run; job is separate and can overlap with web/Android jobs.

### Decisions / Rationale
- Pending.

## Phase 4: CI Validation

### Actions
- [ ] Confirm CI green (build + tests + Maestro).

### Observations
- Pending.

### Decisions / Rationale
- Pending.
