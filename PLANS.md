# PLAN: Productionization Review Audit

## Objective
Produce an evidence-backed productionization review for cross-platform release readiness in `doc/research/productionization-review.md`.

## Inspection Map

### Subsystems
- HVSC pipeline: `src/lib/hvsc/`, native ingestion bridge (`android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt`), extraction/download helpers, state/status stores, and HVSC tests.
- Device I/O layers: REST in `src/lib/c64api.ts`, FTP client layers (`src/lib/ftp/`, `src/lib/native/ftpClient*.ts`), and native FTP plugins on Android/iOS.
- UX interactions:
  - CTA press/highlight model in `src/lib/ui/buttonInteraction.ts` and button-like components.
  - Slider + mute flow in `src/components/ui/slider.tsx` and `src/pages/playFiles/hooks/useVolumeOverride.ts`.
  - Modal/dialog composition in `src/components/ui/dialog.tsx`, `src/components/ui/alert-dialog.tsx`, and page/dialog consumers.
- RAM save/load flows: `src/lib/machine/ramOperations.ts`, `src/lib/machine/ramDumpStorage.ts`, `src/pages/home/hooks/useHomeActions.ts`.
- Persistence/security/observability: `src/lib/logging.ts`, `src/lib/tracing/*`, secure storage bridges, local persistence repositories.
- Test/CI infrastructure: Vitest/Playwright/Maestro specs, Android JVM tests, telemetry scripts, and `.github/workflows/android.yaml` + `.github/workflows/ios.yaml`.

### Required Documents Inspected
- `README.md`
- `doc/ux-guidelines.md`
- `doc/testing/maestro.md`
- `.github/workflows/android.yaml`
- `.github/workflows/ios.yaml`
- `doc/architecture.md`

## Phases and Checklist

### Phase 1: Baseline Mapping
- [x] Confirm mandatory workflow docs and constraints.
- [x] Build subsystem file inventory and key execution paths.
- [x] Identify platform divergence points (Android/iOS/Web).

### Phase 2: Deep Reliability/Performance/UX Inspection
- [x] HVSC download/ingest reliability and memory behavior.
- [x] REST/FTP resilience (timeouts, retries, idempotency, partial failures).
- [x] Crash surfaces (uncaught promises, lifecycle/plugin exception handling).
- [x] Performance hot paths and resource cleanup.
- [x] CTA press-state consistency.
- [x] Slider/mute state synchronization.
- [x] Modal/dialog consistency and small-screen behavior.
- [x] RAM save/load data integrity and failure handling.
- [x] Security/privacy and logging redaction/storage risk.

### Phase 3: Test and CI Audit
- [x] Inventory existing unit/integration/e2e coverage across critical flows.
- [x] Evaluate crash detection reliability and artifact coverage.
- [x] Evaluate device realism gaps and mitigations.
- [x] Map each validated finding to test gaps or existing test coverage.

### Phase 4: Reporting
- [x] Draft `doc/research/productionization-review.md` with required section structure.
- [x] Populate prioritized backlog table with evidence, reproduction steps, and test recommendations.
- [x] Add “Going Well” evidence-backed notes.
- [x] Finalize ship recommendation and release gating criteria.
- [x] Cross-check report for traceable evidence anchors.

## Candidate Findings (Working Set)
- HVSC non-native memory amplification during download/extraction.
- REST response parsing defaults can mask malformed/non-JSON success responses.
- FTP timeout/retry behavior is inconsistent across web/Android/iOS bridges.
- CI telemetry gates do not fail on process disappearance signal (`exit 3`).
- Coverage gate enforces line-only threshold (80%) and does not gate branch coverage.
- Playlist persistence still writes full JSON blobs to localStorage.
- Slider/mute core hook has no dedicated hook-level tests.
- Android native HVSC ingestion plugin has no direct JVM behavior tests.
- Several localStorage parse failures use `console.warn`, bypassing app diagnostics log store.

## Validated Findings (Evidence-backed)
- `F-01` (P1): Non-native HVSC ingestion path still performs full-buffer archive handling and high-memory extraction patterns.
- `F-02` (P1): CI telemetry gates downgrade monitored process disappearance to warning; jobs can pass despite restart/crash signal.
- `F-03` (P1): REST parser returns synthetic `{ errors: [] }` for non-JSON or parse-failed 200 responses, masking malformed payloads.
- `F-04` (P2): FTP timeout/retry policy is inconsistent and weak in web/native bridges (hard-coded timeout, no explicit retry at bridge level).
- `F-05` (P2): Playlist persistence still stores full JSON playlist blobs in localStorage despite architecture constraints.
- `F-06` (P2): Volume/mute state machine has complex race-handling logic but no dedicated hook-level unit tests.
- `F-07` (P2): Android native `HvscIngestionPlugin` behavior lacks dedicated JVM tests (cancel/error/progress semantics).
- `F-08` (P3): Some storage parse failures log only to `console.warn` and bypass diagnostics log ingestion.

## Going-Well Notes (Evidence-backed)
- Native Android HVSC ingestion is streaming/chunked with cancellation checks and batched DB updates.
- Device interaction manager includes backoff, circuit breaker, cooldown, and request coalescing for REST/FTP.
- RAM save/load flow validates full image size, guards liveness, retries deterministically, and has focused unit/UI tests.
- CTA highlight behavior is centralized, short-lived, and verified by unit + Playwright tests.
- Playwright evidence pipeline validates screenshots/video/signatures and compares golden traces.
- Trace/log systems apply retention and size bounds plus header/payload redaction.

## Scope Adjustments / Dead Ends
- Initial suspicion of missing Android JVM coverage was corrected: JVM tests exist, but not for `HvscIngestionPlugin` behavior itself.

## Acceptance Criteria for “Review Complete”
- `doc/research/productionization-review.md` exists and includes all required headings.
- Every finding includes evidence anchors (file + line or unique snippet), reproduction steps, and a test recommendation.
- Priorities use required P0–P3 rubric and include impact/likelihood/detectability/fix effort.
- Report includes explicit positives (“Going Well”) backed by code/test evidence.
- `PLANS.md` reflects completed phases, validated findings, and scope adjustments.
