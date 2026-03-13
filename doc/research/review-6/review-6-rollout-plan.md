# C64 Commander Rollout Plan
Review 6 Follow-Up

## Scope Baseline

This rollout plan follows the accepted scope recorded in `review-6.md`:

- Android Play upload is operational.
- iOS remains a sideload-oriented path; a paid Apple Developer signing lane is not in scope for this plan.
- C64 Ultimate transport remains HTTP/FTP because that is what the device currently supports.
- GitHub Actions version-tag usage remains an intentional project policy.

The phases below cover the remaining open items from Review 6.

## Phase 0 - Baseline Alignment

Goal: codify the accepted rollout assumptions so future reviews do not reopen closed scope decisions.

Steps:

1. Update repository docs that currently contradict the accepted scope.
2. Remove stale TODOs that imply Android release publishing is unfinished.
3. Add one canonical note describing the current rollout boundaries.

Tasks:

- [ ] Update `AGENTS.md` to remove the stale Android signing TODO.
- [ ] Update `README.md` release/install wording to state the current iOS sideload scope explicitly.
- [ ] Update `README.md` or a dedicated rollout doc to state that Android Play upload is already operational.
- [ ] Add an explicit note that device transport is HTTP/FTP because that is what current C64 Ultimate firmware supports.
- [ ] Add a short contributor-facing note that GitHub Actions version-tag usage is an intentional policy choice.

Exit criteria:

- No repository doc still describes Android release publishing as incomplete.
- Current rollout scope is stated once in a canonical location and referenced from nearby docs.

## Phase 1 - Web Rollout Safety

Goal: eliminate stale-shell risk during web deploys.

Steps:

1. Change service-worker cache naming so each build can roll forward cleanly.
2. Stop caching the app shell in a way that defeats `index.html` `no-store`.
3. Add regression tests for upgrade and cache-eviction behavior.
4. Document operator deploy and rollback steps.

Tasks:

- [ ] Replace the fixed cache key in `public/sw.js` with build-versioned cache names.
- [ ] Remove cache-first handling for `/` and `/index.html`.
- [ ] Add a regression test that proves a new deployment invalidates the old shell.
- [ ] Add a regression test that proves old caches are deleted on activation.
- [ ] Document web deploy, hard-refresh, and rollback behavior in repository docs.

Exit criteria:

- A deployed web update cannot keep serving an older app shell after activation.
- Service-worker upgrade behavior is covered by automated tests.

## Phase 2 - Release Metadata and Documentation Hygiene

Goal: make versioning and published documentation consistent.

Steps:

1. Pick one canonical version source.
2. Align build surfaces and release docs to that source.
3. Remove stale examples and mismatch-tolerant behavior.

Tasks:

- [ ] Decide whether Git tags or `package.json` own the app version.
- [ ] Align `vite.config.ts` with the chosen version source.
- [ ] Update `.github/workflows/web.yaml` so version mismatches do not silently continue.
- [ ] Update `README.md` artifact examples from `0.5.0` to the current naming convention.
- [ ] Update `tests/contract/README.md` to the Node 24 requirement.
- [ ] Update `docs/privacy-policy.md` so optional Sentry behavior is described accurately.

Exit criteria:

- One version source controls build metadata, release metadata, and user-visible versioning.
- Published docs no longer contain stale artifact names or stale runtime requirements.

## Phase 3 - Dependency and Platform Security Hygiene

Goal: clear the actionable dependency backlog and make Android state-transfer policy explicit.

Steps:

1. Triage direct vulnerable dependencies first.
2. Upgrade, replace, or record accepted residual risk.
3. Decide the intended Android backup posture and implement it.

Tasks:

- [ ] Triage the `npm audit` findings and classify each as upgrade, replace, or accepted risk.
- [ ] Upgrade or replace vulnerable direct dependencies, starting with `@capacitor/cli`, `ftp-srv`, `ajv`, and `jsdom`.
- [ ] Refresh lockfile overrides if they are still needed after upgrades.
- [ ] Rerun `npm audit` and capture the post-remediation result in the worklog.
- [ ] Decide whether Android backups should be fully disabled or selectively scoped.
- [ ] Update `AndroidManifest.xml`, `backup_rules.xml`, and `data_extraction_rules.xml` to match that decision.

Exit criteria:

- The dependency backlog is either fixed or explicitly accepted with written justification.
- Android backup behavior is intentional and documented.

## Phase 4 - Playlist Persistence Hardening

Goal: move playlist storage toward the documented query-backed model and make recovery explicit.

Steps:

1. Design the target storage/query shape.
2. Implement storage-backed filtering, sorting, and paging.
3. Improve migration and corruption recovery behavior.
4. Add regression coverage for large collections and failure paths.

Tasks:

- [ ] Define the target playlist persistence model and migration strategy.
- [ ] Move filtering, sorting, and pagination into the storage layer.
- [ ] Preserve recovery artifacts when playlist state cannot be parsed or migrated.
- [ ] Add deterministic tests for schema mismatch, parse failure, and recovery handling.
- [ ] Add deterministic tests for large playlist query behavior.

Exit criteria:

- Playlist browsing no longer relies on full in-memory scans for the documented large-scale path.
- Recovery behavior is explicit, observable, and regression-tested.

## Phase 5 - Maintainability Hardening

Goal: reduce risk in the largest hotspots and tighten static guarantees incrementally.

Steps:

1. Split the largest files by responsibility.
2. Ratchet TypeScript settings without destabilizing the build.
3. Remove silent exception swallowing from Gradle.

Tasks:

- [ ] Define the extraction order for `src/lib/c64api.ts`, `src/pages/SettingsPage.tsx`, `src/pages/PlayFilesPage.tsx`, `src/components/disks/HomeDiskManager.tsx`, and `src/lib/hvsc/hvscIngestionRuntime.ts`.
- [ ] Split `src/lib/c64api.ts` into smaller request/domain modules.
- [ ] Split `src/pages/SettingsPage.tsx` by settings area.
- [ ] Split `src/pages/PlayFilesPage.tsx` by browsing, playlist, and playback concerns.
- [ ] Split `src/components/disks/HomeDiskManager.tsx` by collection, dialog, and mount-control concerns.
- [ ] Split `src/lib/hvsc/hvscIngestionRuntime.ts` by ingestion stage and persistence/runtime concerns.
- [ ] Re-enable stricter TypeScript checks incrementally, starting with a documented subset of flags.
- [ ] Replace silent catches in `android/app/build.gradle` with explicit logging or rethrows.

Exit criteria:

- The largest hotspot files are materially smaller and easier to review.
- The compiler catches more nullability and implicit-any regressions than it does today.
- Gradle version derivation failures are no longer silent.

## Phase 6 - Coverage Closeout

Goal: bring all shipped web runtime code under measurable coverage enforcement.

Steps:

1. Decide whether to merge `web/server/**` into the main gate or add a dedicated enforced server gate.
2. Update scripts and CI to enforce that decision.
3. Record the new measured baseline.

Tasks:

- [ ] Remove `web/server/**` from the Vitest exclusion list or add a dedicated enforced server threshold.
- [ ] Update `scripts/collect-coverage.sh` and `scripts/check-coverage-threshold.mjs` as needed.
- [ ] Update `codecov.yml` if a separate server gate is introduced.
- [ ] Run the coverage pipeline and record the resulting branch/line percentages in the worklog.

Exit criteria:

- Shipped web-server code is included in enforced coverage reporting.
- Coverage policy and repository behavior match.

## Worklog

| Date | Phase | Entry |
| --- | --- | --- |
| 2026-03-13 | Planning | Created the Review 6 rollout plan from the accepted findings in `review-6.md`. |
| 2026-03-13 | Phase 0 | Recorded that future follow-up must codify the accepted scope decisions to prevent reopened closed issues. |

## Completion Rule

This rollout plan is complete when every task above is checked off, the worklog records the remediation sequence, and `review-6.md` no longer has any open issue whose corrective action lacks a completed phase entry here.
