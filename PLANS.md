# Review 6 Rollout Execution Plan

## Objective

Implement and verify every task in `doc/research/review-6/review-6-rollout-plan.md`.

## Execution Model

- Authoritative tracker: this file
- Workflow: read -> plan -> implement -> test -> verify -> record -> continue
- Phase discipline: do not mark a phase complete until its exit criteria are verified

## Phase Status

- [x] Phase 0 - Baseline Alignment
- [x] Phase 1 - Web Rollout Safety
- [x] Phase 2 - Release Metadata and Documentation Hygiene
- [ ] Phase 3 - Dependency and Platform Security Hygiene
- [x] Phase 4 - Playlist Persistence Hardening
- [ ] Phase 5 - Maintainability Hardening
- [ ] Phase 6 - Coverage Closeout
- [ ] Final verification and rollout plan closeout

## Phase 0 - Baseline Alignment

Implementation targets:

- `AGENTS.md`
- `README.md`
- `doc/research/review-6/review-6-rollout-plan.md`

Tasks:

- [x] Remove stale Android release-signing TODO wording from `AGENTS.md`
- [x] State the iOS sideload-only release scope explicitly in `README.md`
- [x] State that Android Play upload is already operational in `README.md`
- [x] Record the device transport boundary (HTTP/FTP) in one canonical location and reference it nearby
- [x] Record that GitHub Actions version-tag usage is an intentional contributor-facing policy

Verification:

- [x] Search docs for stale Android publishing TODO wording
- [x] Confirm one canonical rollout-boundary section exists and nearby docs point to the current state

## Phase 1 - Web Rollout Safety

Implementation targets:

- `public/sw.js`
- `src/lib/startup/serviceWorkerRegistration.ts`
- `tests/unit/startup/serviceWorkerRegistration.test.ts`
- web deployment documentation in `README.md` and/or `doc/`

Tasks:

- [x] Replace fixed service-worker cache names with build-versioned cache names
- [x] Stop cache-first handling for `/` and `/index.html`
- [x] Add deterministic regression coverage for shell invalidation on deployment
- [x] Add deterministic regression coverage for activation-time cache eviction
- [x] Document deploy, hard-refresh, and rollback behavior for operators

Verification:

- [x] Run targeted service-worker tests
- [x] Confirm shell requests bypass stale cache after activation

## Phase 2 - Release Metadata and Documentation Hygiene

Implementation targets:

- `package.json`
- `vite.config.ts`
- `.github/workflows/web.yaml`
- `README.md`
- `tests/contract/README.md`
- `docs/privacy-policy.md`

Tasks:

- [x] Choose one canonical app version source and enforce it in build metadata
- [x] Remove mismatch-tolerant publish behavior from `.github/workflows/web.yaml`
- [x] Update README artifact examples to the current naming convention
- [x] Update contract-test runtime documentation to Node 24
- [x] Remove the remote crash-reporting SDK from runtime, dependencies, and current docs
- [x] Align the privacy policy with the no-crash-reporting runtime behavior

Verification:

- [x] Run targeted tests for build/version helpers if changed
- [x] Validate workflow version check logic by inspection and lint/build usage

## Phase 3 - Dependency and Platform Security Hygiene

Implementation targets:

- `package.json`
- `package-lock.json`
- Android manifest and backup policy XML files
- rollout worklog in this file

Tasks:

- [x] Triage `npm audit` findings into upgrade, replace, or accepted-risk buckets
- [ ] Upgrade or replace vulnerable direct dependencies, starting with `@capacitor/cli`, `ftp-srv`, `ajv`, and `jsdom`
- [x] Refresh overrides if still required after upgrades
- [x] Capture post-remediation `npm audit` results in the worklog
- [x] Make Android backup posture intentional and implement it in manifest/XML rules

Verification:

- [ ] Run `npm audit` after dependency changes
- [ ] Build/test after dependency changes
- [ ] Validate Android manifest/resources still build

## Phase 4 - Playlist Persistence Hardening

Implementation targets:

- `src/lib/playlistRepository/**`
- playlist persistence consumers under `src/pages/playFiles/**`
- `doc/db.md`
- playlist unit tests

Tasks:

- [x] Define the persisted playlist query model and migration strategy in code/docs
- [x] Move filtering, sorting, and pagination into repository-backed indexed/queryable structures
- [x] Preserve recovery artifacts for schema mismatch and parse/migration failures
- [x] Add deterministic regression tests for corruption and migration recovery
- [x] Add deterministic regression tests for large playlist query behavior

Verification:

- [x] Run targeted playlist repository tests
- [x] Confirm large playlist queries no longer depend on full scan/sort of all rows at query time

## Phase 5 - Maintainability Hardening

Implementation targets:

- `src/lib/c64api.ts`
- `src/pages/SettingsPage.tsx`
- `src/pages/PlayFilesPage.tsx`
- `src/components/disks/HomeDiskManager.tsx`
- `src/lib/hvsc/hvscIngestionRuntime.ts`
- `tsconfig.json`
- `tsconfig.app.json`
- `android/app/build.gradle`

Tasks:

- [x] Define and record the extraction order for hotspot files
- [ ] Split `src/lib/c64api.ts` into request/domain modules
- [ ] Split `src/pages/SettingsPage.tsx` by settings area
- [ ] Split `src/pages/PlayFilesPage.tsx` by browsing, playlist, and playback concerns
- [ ] Split `src/components/disks/HomeDiskManager.tsx` by collection, dialog, and mount-control concerns
- [ ] Split `src/lib/hvsc/hvscIngestionRuntime.ts` by ingestion stage and runtime/persistence concerns
- [ ] Re-enable a documented subset of stricter TypeScript checks without breaking the build
- [x] Replace silent Gradle catches with explicit logging or contextual failure

Verification:

- [ ] Run TypeScript/lint/build validation after modularization
- [ ] Confirm hotspot files are materially smaller than baseline
- [ ] Confirm Gradle version derivation no longer swallows failures silently

## Phase 6 - Coverage Closeout

Implementation targets:

- `vitest.config.ts`
- `scripts/collect-coverage.sh`
- `scripts/check-coverage-threshold.mjs`
- `codecov.yml`
- rollout worklog in this file

Tasks:

- [x] Include shipped `web/server/**` runtime in enforced coverage reporting or add an equivalent enforced server gate
- [ ] Update coverage scripts and Codecov config to match the chosen gate
- [ ] Record the resulting measured line and branch baseline in the worklog

Verification:

- [ ] Run `npm run test:coverage`
- [ ] Run `npm run test:coverage:all`
- [ ] Run `npm run lint`
- [ ] Run `npm run build`

## Execution Worklog

| Date | Phase | Entry | Status |
| --- | --- | --- | --- |
| 2026-03-13 | Planning | Replaced the stale audit-only `PLANS.md` with the rollout execution tracker tied to phases 0-6, verification steps, and live completion markers. | done |
| 2026-03-13 | Planning | Completed initial implementation discovery for docs, service worker, workflow versioning, Android backup config, playlist repository, coverage scripts, and hotspot files. | done |
| 2026-03-13 | Phase 0-2 | Aligned rollout docs, made `package.json` the canonical app version source, removed mismatch-tolerant web publish behavior, and removed the remote crash-reporting SDK plus its privacy-policy contradictions. | done |
| 2026-03-13 | Phase 1 | Switched service-worker registration and caches to build-versioned behavior, stopped cache-first shell handling, and added deterministic lifecycle regression coverage. | done |
| 2026-03-13 | Phase 3-4 | Upgraded `ajv`/`jsdom`/`tar`, disabled Android backup at the manifest level, replaced silent Gradle catches with warnings, moved playlist queries to persisted indexes, and added migration/recovery coverage. | done |
| 2026-03-13 | Phase 3-6 | Hardened the shared slider against invalid bounds exposed by the `jsdom` upgrade, stabilized HomePage and structured-recovery tests on quick-action test ids, and included `tests/unit/web/**` + `web/server/**` in enforced unit coverage. | done |

## Audit / Verification Notes

- Residual `npm audit` risk after upgrades: `ftp-srv`/`ip` remain in contract-test infrastructure, while older `ajv` and `minimatch` copies remain under upstream tooling trees.
- Hotspot extraction order recorded from repo exploration: `src/lib/c64api.ts` host-resolution split first, then `src/pages/SettingsPage.tsx` diagnostics panel, then `src/lib/hvsc/hvscIngestionRuntime.ts` core pipeline extraction, followed by `src/pages/PlayFilesPage.tsx` playback/browsing split and `src/components/disks/HomeDiskManager.tsx` drive/library/dialog split.
- `runTests` now passes the unit suite but still reports broader Playwright/environment failures outside the rollout-specific changes; final lint/build/coverage closeout remains pending.
