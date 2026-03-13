# Review 6 Rollout Execution Plan

## Objective

Implement and verify every task in `doc/research/review-6/review-6-rollout-plan.md`.

## Execution Model

- Authoritative tracker: this file
- Workflow: read -> plan -> implement -> test -> verify -> record -> continue
- Phase discipline: do not mark a phase complete until its exit criteria are verified

## Phase Status

- [ ] Phase 0 - Baseline Alignment
- [ ] Phase 1 - Web Rollout Safety
- [ ] Phase 2 - Release Metadata and Documentation Hygiene
- [ ] Phase 3 - Dependency and Platform Security Hygiene
- [ ] Phase 4 - Playlist Persistence Hardening
- [ ] Phase 5 - Maintainability Hardening
- [ ] Phase 6 - Coverage Closeout
- [ ] Final verification and rollout plan closeout

## Phase 0 - Baseline Alignment

Implementation targets:

- `AGENTS.md`
- `README.md`
- `doc/research/review-6/review-6-rollout-plan.md`

Tasks:

- [ ] Remove stale Android release-signing TODO wording from `AGENTS.md`
- [ ] State the iOS sideload-only release scope explicitly in `README.md`
- [ ] State that Android Play upload is already operational in `README.md`
- [ ] Record the device transport boundary (HTTP/FTP) in one canonical location and reference it nearby
- [ ] Record that GitHub Actions version-tag usage is an intentional contributor-facing policy

Verification:

- [ ] Search docs for stale Android publishing TODO wording
- [ ] Confirm one canonical rollout-boundary section exists and nearby docs point to the current state

## Phase 1 - Web Rollout Safety

Implementation targets:

- `public/sw.js`
- `src/lib/startup/serviceWorkerRegistration.ts`
- `tests/unit/startup/serviceWorkerRegistration.test.ts`
- web deployment documentation in `README.md` and/or `doc/`

Tasks:

- [ ] Replace fixed service-worker cache names with build-versioned cache names
- [ ] Stop cache-first handling for `/` and `/index.html`
- [ ] Add deterministic regression coverage for shell invalidation on deployment
- [ ] Add deterministic regression coverage for activation-time cache eviction
- [ ] Document deploy, hard-refresh, and rollback behavior for operators

Verification:

- [ ] Run targeted service-worker tests
- [ ] Confirm shell requests bypass stale cache after activation

## Phase 2 - Release Metadata and Documentation Hygiene

Implementation targets:

- `package.json`
- `vite.config.ts`
- `.github/workflows/web.yaml`
- `README.md`
- `tests/contract/README.md`
- `docs/privacy-policy.md`

Tasks:

- [ ] Choose one canonical app version source and enforce it in build metadata
- [ ] Remove mismatch-tolerant publish behavior from `.github/workflows/web.yaml`
- [ ] Update README artifact examples to the current naming convention
- [ ] Update contract-test runtime documentation to Node 24
- [ ] Remove Sentry from runtime, dependencies, and current docs
- [ ] Align the privacy policy with the no-crash-reporting runtime behavior

Verification:

- [ ] Run targeted tests for build/version helpers if changed
- [ ] Validate workflow version check logic by inspection and lint/build usage

## Phase 3 - Dependency and Platform Security Hygiene

Implementation targets:

- `package.json`
- `package-lock.json`
- Android manifest and backup policy XML files
- rollout worklog in this file

Tasks:

- [ ] Triage `npm audit` findings into upgrade, replace, or accepted-risk buckets
- [ ] Upgrade or replace vulnerable direct dependencies, starting with `@capacitor/cli`, `ftp-srv`, `ajv`, and `jsdom`
- [ ] Refresh overrides if still required after upgrades
- [ ] Capture post-remediation `npm audit` results in the worklog
- [ ] Make Android backup posture intentional and implement it in manifest/XML rules

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

- [ ] Define the persisted playlist query model and migration strategy in code/docs
- [ ] Move filtering, sorting, and pagination into repository-backed indexed/queryable structures
- [ ] Preserve recovery artifacts for schema mismatch and parse/migration failures
- [ ] Add deterministic regression tests for corruption and migration recovery
- [ ] Add deterministic regression tests for large playlist query behavior

Verification:

- [ ] Run targeted playlist repository tests
- [ ] Confirm large playlist queries no longer depend on full scan/sort of all rows at query time

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

- [ ] Define and record the extraction order for hotspot files
- [ ] Split `src/lib/c64api.ts` into request/domain modules
- [ ] Split `src/pages/SettingsPage.tsx` by settings area
- [ ] Split `src/pages/PlayFilesPage.tsx` by browsing, playlist, and playback concerns
- [ ] Split `src/components/disks/HomeDiskManager.tsx` by collection, dialog, and mount-control concerns
- [ ] Split `src/lib/hvsc/hvscIngestionRuntime.ts` by ingestion stage and runtime/persistence concerns
- [ ] Re-enable a documented subset of stricter TypeScript checks without breaking the build
- [ ] Replace silent Gradle catches with explicit logging or contextual failure

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

- [ ] Include shipped `web/server/**` runtime in enforced coverage reporting or add an equivalent enforced server gate
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

## Audit / Verification Notes

- Pending: baseline `npm audit` triage and direct dependency upgrade plan
- Pending: hotspot file size baseline capture for refactor closeout
- Pending: full build/test/coverage closeout after all phases
