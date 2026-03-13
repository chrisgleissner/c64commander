# Production Readiness Audit Plan

## Objective

Produce an evidence-based production readiness audit for the full repository and write it to `doc/research/review-6/review-6.md`.

## Execution Phases

- [x] Phase 0a: initial repository discovery and audit-plan setup
- [x] Phase 0b: mandatory documentation ingestion
- [x] Phase 1: repository structure and subsystem discovery
- [x] Phase 2: production code audit
- [x] Phase 3: test infrastructure audit
- [x] Phase 4: build and deployment audit
- [x] Phase 5: security and dependency audit
- [x] Phase 6: documentation accuracy audit
- [x] Phase 7: production readiness verdict and final report
- [x] Phase 8: validation commands and final plan closeout

## High-Level Repository Inventory

- Application targets: Web, Android, iOS via React + Vite + Capacitor
- Shared frontend/runtime code: `src/`
- Android native layer: `android/`
- iOS native layer: `ios/`
- Web server runtime: `web/server/`
- Primary test suites: `tests/`, `android/app/src/test/`, `ios/native-tests/`, `agents/tests/`, `c64scope/tests/`
- CI/CD and automation: `.github/workflows/`, `build`, `ci/`
- Documentation roots: `README.md`, `doc/`, `docs/`, `ci/telemetry/README.md`, `agents/README.md`, `c64scope/README.md`, `tests/**/README.md`

## Mandatory Documentation Ingestion Checklist

Status: completed on 2026-03-13

All files listed in the required pre-read set below were read during Phase 0b using direct file reads plus section-by-section digests for large schemas, manifests, and repeated prompt documents.

### Required pre-read set

These files must be read before the main code audit proceeds.

- [ ] `doc/architecture.md`
- [ ] `doc/code-coverage.md`
- [ ] `doc/db.md`
- [ ] `doc/developer.md`
- [ ] `doc/features-by-page.md`
- [ ] `doc/index.md`
- [ ] `doc/sid-file-format-spec.md`
- [ ] `doc/ux-guidelines.md`
- [ ] `doc/ux-interactions.md`
- [ ] `doc/c64/c64u-config.yaml`
- [ ] `doc/c64/c64u-ftp.md`
- [ ] `doc/c64/c64u-openapi-excerpt.yaml`
- [ ] `doc/c64/c64u-openapi.yaml`
- [ ] `doc/c64/c64u-rest-api.md`
- [ ] `doc/c64/c64u-stream-spec.md`
- [ ] `doc/c64/devices/c64u/3.12a/c64u-config.yaml`
- [ ] `doc/c64/devices/c64u/3.14a/c64u-config.yaml`
- [ ] `doc/c64/devices/c64u/3.14d/c64u-config.yaml`
- [ ] `doc/diagnostics/action-summary-spec.md`
- [ ] `doc/diagnostics/trace-forensic-analysis.md`
- [ ] `doc/diagnostics/tracing-spec.md`
- [ ] `doc/testing/agentic-tests/agentic-action-model.md`
- [ ] `doc/testing/agentic-tests/agentic-android-runtime-contract.md`
- [ ] `doc/testing/agentic-tests/agentic-controller-contract.md`
- [ ] `doc/testing/agentic-tests/agentic-coverage-matrix.md`
- [ ] `doc/testing/agentic-tests/agentic-feature-surface.md`
- [ ] `doc/testing/agentic-tests/agentic-infrastructure-reuse.md`
- [ ] `doc/testing/agentic-tests/agentic-observability-model.md`
- [ ] `doc/testing/agentic-tests/agentic-open-questions.md`
- [ ] `doc/testing/agentic-tests/agentic-oracle-catalog.md`
- [ ] `doc/testing/agentic-tests/agentic-safety-policy.md`
- [ ] `doc/testing/agentic-tests/agentic-test-architecture.md`
- [ ] `doc/testing/agentic-tests/agentic-test-implementation-plan.md`
- [ ] `doc/testing/agentic-tests/agentic-test-review.md`
- [ ] `doc/testing/agentic-tests/c64scope-delivery-prompt.md`
- [ ] `doc/testing/agentic-tests/c64scope-spec.md`
- [ ] `doc/testing/agentic-tests/full-app-coverage/README.md`
- [ ] `doc/testing/agentic-tests/full-app-coverage/feature-inventory.md`
- [ ] `doc/testing/agentic-tests/full-app-coverage/feature-status-matrix.md`
- [ ] `doc/testing/agentic-tests/full-app-coverage/feature-test-catalog.md`
- [ ] `doc/testing/agentic-tests/full-app-coverage/iteration-log.md`
- [ ] `doc/testing/agentic-tests/full-app-coverage/prompts/F001-app-shell-and-launch.md`
- [ ] `doc/testing/agentic-tests/full-app-coverage/prompts/F002-tab-navigation.md`
- [ ] `doc/testing/agentic-tests/full-app-coverage/prompts/F003-home-machine-controls.md`
- [ ] `doc/testing/agentic-tests/full-app-coverage/prompts/F004-home-quick-config-and-led-sid.md`
- [ ] `doc/testing/agentic-tests/full-app-coverage/prompts/F005-home-ram-workflows.md`
- [ ] `doc/testing/agentic-tests/full-app-coverage/prompts/F006-home-config-snapshots.md`
- [ ] `doc/testing/agentic-tests/full-app-coverage/prompts/F007-disks-library-management.md`
- [ ] `doc/testing/agentic-tests/full-app-coverage/prompts/F008-disks-mount-eject.md`
- [ ] `doc/testing/agentic-tests/full-app-coverage/prompts/F009-disks-drive-and-softiec.md`
- [ ] `doc/testing/agentic-tests/full-app-coverage/prompts/F010-play-source-browsing.md`
- [ ] `doc/testing/agentic-tests/full-app-coverage/prompts/F011-playlist-lifecycle.md`
- [ ] `doc/testing/agentic-tests/full-app-coverage/prompts/F012-playback-transport.md`
- [ ] `doc/testing/agentic-tests/full-app-coverage/prompts/F013-playback-queue-and-volume.md`
- [ ] `doc/testing/agentic-tests/full-app-coverage/prompts/F014-songlength-duration-subsong.md`
- [ ] `doc/testing/agentic-tests/full-app-coverage/prompts/F015-hvsc-download-ingest.md`
- [ ] `doc/testing/agentic-tests/full-app-coverage/prompts/F016-hvsc-cache-reuse.md`
- [ ] `doc/testing/agentic-tests/full-app-coverage/prompts/F017-lock-screen-autoadvance.md`
- [ ] `doc/testing/agentic-tests/full-app-coverage/prompts/F018-config-browse-search.md`
- [ ] `doc/testing/agentic-tests/full-app-coverage/prompts/F019-config-edit-and-audio-mixer.md`
- [ ] `doc/testing/agentic-tests/full-app-coverage/prompts/F020-settings-connection-preferences.md`
- [ ] `doc/testing/agentic-tests/full-app-coverage/prompts/F021-settings-diagnostics-safety.md`
- [ ] `doc/testing/agentic-tests/full-app-coverage/prompts/F022-docs-and-licenses.md`
- [ ] `doc/testing/agentic-tests/full-app-coverage/prompts/F023-persistence-and-recovery.md`
- [ ] `doc/testing/agentic-tests/full-app-coverage/runs/README.md`
- [ ] `doc/testing/agentic-tests/full-app-coverage/runs/fac-20260308T103247Z-mcp-probe.json`
- [ ] `doc/testing/agentic-tests/full-app-coverage/runs/fac-20260308T1035-execution-summary.md`
- [ ] `doc/testing/agentic-tests/full-app-coverage/runs/fac-20260308T110559Z-executor-manifest.json`
- [ ] `doc/testing/agentic-tests/full-app-coverage/runs/fac-20260308T110559Z-executor-manifest.md`
- [ ] `doc/testing/agentic-tests/full-app-coverage/runs/fac-20260308T111428Z-executor-manifest.json`
- [ ] `doc/testing/agentic-tests/full-app-coverage/runs/fac-20260308T111428Z-executor-manifest.md`
- [ ] `doc/testing/agentic-tests/full-app-coverage/runs/fac-20260308T113247Z-executor-manifest.json`
- [ ] `doc/testing/agentic-tests/full-app-coverage/runs/fac-20260308T113247Z-executor-manifest.md`
- [ ] `doc/testing/agentic-tests/full-app-coverage/runs/fac-20260308T113632Z-executor-manifest.json`
- [ ] `doc/testing/agentic-tests/full-app-coverage/runs/fac-20260308T113632Z-executor-manifest.md`
- [ ] `doc/testing/agentic-tests/full-app-coverage/tool-gap-analysis.md`
- [ ] `doc/testing/agentic-tests/gap-analysis/research1/README.md`
- [ ] `doc/testing/agentic-tests/gap-analysis/research1/coverage-matrix.md`
- [ ] `doc/testing/agentic-tests/gap-analysis/research1/failure-modes.md`
- [ ] `doc/testing/agentic-tests/gap-analysis/research1/inventory.md`
- [ ] `doc/testing/agentic-tests/gap-analysis/research1/remediation-plan.md`
- [ ] `doc/testing/agentic-tests/gap-analysis/research1/root-causes.md`
- [ ] `doc/testing/android-agentic-handover-20260310.md`
- [ ] `doc/testing/android-emulator-test-structure.md`
- [ ] `doc/testing/chaos-fuzz.md`
- [ ] `doc/testing/contract-breakpoint-stress-prompt.md`
- [ ] `doc/testing/contract-test.md`
- [ ] `doc/testing/dual-resolution.md`
- [ ] `doc/testing/fuzz-iteration-prompt.md`
- [ ] `doc/testing/fuzz-results/fuzz-results-1/README.md`
- [ ] `doc/testing/fuzz-results/fuzz-results-1/fuzz-issue-report.json`
- [ ] `doc/testing/investigations/interactions1/verification-notes.md`
- [ ] `doc/testing/investigations/reliability1/analysis.md`
- [ ] `doc/testing/investigations/reliability1/convergence-report.md`
- [ ] `doc/testing/investigations/reliability1/convergence-status.json`
- [ ] `doc/testing/investigations/reliability1/execution-log.md`
- [ ] `doc/testing/investigations/reliability1/plan.md`
- [ ] `doc/testing/investigations/reliability1/reliability-remediation-plan.md`
- [ ] `doc/testing/investigations/reliability1/work-log.md`
- [ ] `doc/testing/investigations/reliability2/analysis.md`
- [ ] `doc/testing/investigations/reliability2/convergence-report.md`
- [ ] `doc/testing/investigations/reliability2/execution-log.md`
- [ ] `doc/testing/investigations/reliability2/plan.md`
- [ ] `doc/testing/maestro.md`
- [ ] `doc/testing/physical-device-matrix.md`
- [ ] `doc/testing/playwright-test-expansion-results.md`
- [ ] `doc/testing/playwright-ui-audit.md`
- [ ] `doc/testing/testing-extension-research.md`
- [ ] `doc/testing/testing-infrastructure-review.md`
- [ ] `doc/testing/viewport-finalization-summary.md`

### Additional `doc/` inventory to cover during the audit

- `doc/internals/`: 5 text documents, 1 image asset
- `doc/research/`: 503 text documents plus binary screenshots and artifacts
- `doc/img/`: binary reference images only

## Documented Expectations To Validate

- Shared-runtime architecture is intentional: React + Vite + Capacitor provides one TypeScript codebase for web, Android, and iOS, with native bridges only where platform capabilities require them.
- The device contract is explicit: REST API version `0.1` over HTTP, optional `X-Password` authentication, FTP on port `21`, and UDP data streams with a TCP control socket for stream setup.
- Playback completion is documented as duration-driven, not device-state-driven: there is no documented authoritative runner-finished endpoint, so JS `dueAtMs` plus Android foreground-service watchdog behavior is the normative design.
- Tracing is specified as an always-on rolling buffer with deterministic IDs, correlation ownership, capture-time redaction, golden-trace comparison, and action-summary derivation that must not repair tracing mistakes heuristically.
- UX rules are strong and normative: Local, C64U, and HVSC sources must share the same browse mechanics; playlist rows must render canonical metadata rather than source-specific UI labels; large playlists are intended to be query-driven and DB-backed at scale.
- Testing expectations are aggressive: 90% merged line/branch coverage in CI, Playwright evidence validation, Maestro flow conventions, Android physical-device validation, contract testing for 48 REST endpoints and 26 FTP commands, fuzz reporting, and agentic full-app coverage based on app-first evidence collection.
- Existing documentation already records known risk areas: REST polling storms, reliability regressions, missing iOS parity, large-file hotspots, and multiple prior production-readiness reviews. The audit needs to verify which of those are now fixed versus still present.

## Execution Log

- 2026-03-13: Replaced a stale prior-task `PLANS.md` with the audit tracker required for review 6.
- 2026-03-13: Completed repository inventory and identified 110 files in the explicit mandatory pre-read set.
- 2026-03-13: Identified additional `doc/` subtrees for later documentation-accuracy analysis: `doc/internals`, `doc/research`, and `doc/img`.
- 2026-03-13: Completed the mandatory pre-read of `doc/` root text docs plus recursive reads of `doc/c64`, `doc/diagnostics`, and `doc/testing`.
- 2026-03-13: Ingested `doc/internals` and the top-level research review documents to seed later documentation-drift checks.
- 2026-03-13: Completed the full repository audit and wrote `doc/research/review-6/review-6.md`.
- 2026-03-13: Ran `npm run test:coverage` successfully and confirmed global branch coverage above the 90% threshold.
- 2026-03-13: Incorporated operator scope clarifications into the final review: iOS paid signing out of scope, Android Play upload operational, C64U HTTP/FTP transport accepted as device-constrained, and GitHub Actions version-tag usage accepted as project policy.
- 2026-03-13: Added the follow-up rollout tracker at `doc/research/review-6/review-6-rollout-plan.md`.

## Findings Backlog

- R6-04: web service-worker cache invalidation and rollout safety
- R6-06: dependency audit backlog
- R6-07: version-source drift
- R6-08: playlist persistence/query scaling and recovery
- R6-09: TypeScript strictness and large-file modularity
- R6-10: Android backup policy
- R6-11: documentation contradictions and stale rollout notes
- R6-12: web-server coverage gate gap
- R6-13: silent Gradle exception handling
