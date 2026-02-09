# HVSC Refactoring and Testing Plan

## Phase 0: Refactor Ingestion Pipeline for Testability
- [ ] Extract duplicated ingestion logic into `ingestArchiveBuffer` in `hvscIngestionRuntime.ts`
- [ ] Refactor `installOrUpdateHvsc` to use `ingestArchiveBuffer`
- [ ] Refactor `ingestCachedHvsc` to use `ingestArchiveBuffer`
- [ ] Fix WASM singleton poisoning in `hvscArchiveExtraction.ts` (reject handling)
- [ ] Allow WASM retries after transient failures
- [ ] Add unit test verifying WASM retry behavior
- [ ] Split `hvscIngestionRuntime.ts` by moving download/streaming helpers to `hvscDownload.ts`

## Phase 1: Archive Caching Infrastructure
- [ ] Extract `ensureUpdate84Archive()` into `tests/fixtures/hvsc/ensureHvscUpdateArchive.ts`
- [ ] Implement resolution order: Env var -> Cache dir -> Download
- [ ] Update CI configuration to cache the archive

## Phase 2: Tier 1 - Unit Tests (Pure, Fully Mocked)
- [ ] Create `tests/unit/hvsc/hvscService.test.ts` (10 tests)
- [ ] Create `tests/unit/hvsc/hvscSongLengthService.test.ts` (10 tests)
- [ ] Create `tests/unit/hvsc/hvscSource.test.ts` (7 tests)
- [ ] Create `hvscIngestionRuntime.test.ts` (Status/Active checks)
- [ ] Create `hvscArchiveExtraction.test.ts` (WASM retry)

## Phase 3: Tier 2 - Integration Tests (Real 7z Extraction)
- [ ] Enhance `hvscArchiveExtraction.test.ts` using `ensureUpdate84Archive`
- [ ] Run assertions against `HVSC_Update_84.7z` (Entry paths, normalization, count, consistency, progress, SIDs, songlengths, deletions)
- [ ] Run assertions against `HVSC_Update_mock.7z` (No network)

## Phase 4: Tier 3 - Pipeline Integration Tests
- [ ] Create `tests/unit/hvsc/hvscIngestionPipeline.test.ts` calling `ingestArchiveBuffer`
- [ ] Test happy path, classification, normalization, cancellation, corruption, persistence
- [ ] Create `tests/unit/hvsc/hvscDownload.test.ts`
- [ ] Test chunk concat, length mismatch, progress, cancellation, HTTP errors

## Phase 5: Tier 4 - Playwright E2E
- [ ] Enhance `hvsc.spec.ts` with songlength display test
- [ ] Enhance `hvsc.spec.ts` with multi-subsong expansion test

## Phase 6: Tier 5 - Maestro Performance
- [ ] Reduce Maestro timeouts (LONG 20s, 15s, SHORT 5s)
- [ ] Eliminate retry-based file picker navigation (targeted scroll or adb intent)
- [ ] Consolidate adb commands in `run-maestro.sh`
- [ ] Pre-grant SAF permissions via adb

## Phase 7: Cleanup and Guardrails
- [ ] Remove duplicate test files
- [ ] Consolidate `hvscStatusStore` tests
- [ ] Raise coverage thresholds in `vitest.config.ts` for `src/lib/hvsc/**` to >=90%
- [ ] Update `AGENTS.md` (remove invalid Java paths)
- [ ] Update `doc/testing/maestro.md` (fixture/permission guidance)

## Verification
- [x] npm run test
- [x] npm run test -- --coverage
- [ ] npm run test:e2e
- [ ] Maestro smoke-hvsc-mounted < 90 seconds
- [x] npm run lint
- [ ] npm run build
