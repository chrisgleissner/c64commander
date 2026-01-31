# Tracing Rollout Plan (Playwright E2E)

Date: 2026-01-30
Branch: feat/tracing

## Trace Regression Stabilisation (E2E) - 2026-01-31
- [x] Failing tests inventory (iter-1) (evidence: test-results/evidence/trace-regression/2026-01-31/iter-1/failures.txt)
- [x] Failure classification (assertion mismatch vs timeout vs navigation vs unexpected call) (evidence: test-results/evidence/trace-regression/2026-01-31/iter-1/failures.txt)
- [x] Hypotheses recorded (evidence: test-results/evidence/trace-regression/2026-01-31/iter-1/git-diff-summary.md)
- [x] Fixes applied (trace normalization + noisy GET collapsing, golden refresh for connectionSimulation) (evidence: test-results/evidence/trace-regression/2026-01-31/iter-2/trace-diff-summary.md, test-results/evidence/trace-regression/2026-01-31/iter-3/recording.txt)
- [x] Local verification steps recorded (evidence: test-results/evidence/trace-regression/2026-01-31/iter-3/recording.txt)
- [ ] CI verification steps recorded (evidence: test-results/evidence/trace-regression/2026-01-31/iter-1/ci-verification.md)
- [x] Follow-up hardening items logged (evidence: test-results/evidence/trace-regression/2026-01-31/iter-1/follow-ups.md)

Notes:
- Golden traces re-recorded for connectionSimulation demo fallback tests to reflect stable background discovery/config polling behavior after trace normalization. Evidence: test-results/evidence/trace-regression/2026-01-31/iter-3/recording.txt

## Scope and Compliance Anchors
- Source of truth: [doc/tracing.md](doc/tracing.md)
- Default test mode: `TRACE_ASSERTIONS_DEFAULT=1`
- Evidence root: `test-results/evidence/playwright/<testId>/<deviceId>/`
- Golden root: `playwright/fixtures/traces/golden/<suite>/<testId>/<deviceId>/`

## Coverage Tracker (Playwright Specs)
| Spec | Classification | Justification |
| --- | --- | --- |
| audioMixer.spec.ts | trace-asserted | REST-backed mixer actions must be traced. |
| configVisibility.spec.ts | trace-asserted | REST-backed config visibility checks. |
| connectionSimulation.spec.ts | trace-asserted | REST interactions and backend routing. |
| coverageProbes.spec.ts | trace-exempt | Coverage-only probe routes; no semantic tracing required. |
| ctaCoverage.spec.ts | trace-asserted | CTA flows hit backend routes; must be traced. |
| demoConfig.spec.ts | trace-asserted | Config route + REST-backed content. |
| demoMode.spec.ts | trace-asserted | Demo routing and REST discovery behavior. |
| diskManagement.spec.ts | trace-asserted | Disk management REST flows. |
| featureFlags.spec.ts | trace-asserted | Settings + feature flag persistence via REST. |
| ftpPerformance.spec.ts | trace-asserted | FTP list operations must be traced. |
| homeConfigManagement.spec.ts | trace-asserted | Config load/apply REST flows. |
| hvsc.spec.ts | trace-asserted | HVSC install/download flows include REST/FTP traces. |
| itemSelection.spec.ts | trace-asserted | FTP selection flows require trace coverage. |
| layoutOverflow.spec.ts | trace-exempt | Layout-only validation; no trace assertions required. |
| musicPlayer.spec.ts | trace-exempt | Empty placeholder spec (no tests). |
| navigationBoundaries.spec.ts | trace-asserted | REST routing and navigation edge cases. |
| playback.part2.spec.ts | trace-asserted | FTP playback flows. |
| playback.spec.ts | trace-asserted | REST playback control flows. |
| playlistControls.spec.ts | trace-asserted | REST-backed playlist operations. |
| screenshots.spec.ts | trace-exempt | Visual-only screenshots; tracing disabled. |
| settingsConnection.spec.ts | trace-asserted | REST-backed connection settings. |
| settingsDiagnostics.spec.ts | trace-asserted | Diagnostics REST flows. |
| solo.spec.ts | trace-asserted | Config actions drive REST-backed mixer state. |
| ui.spec.ts | trace-asserted | UI coverage includes REST/FTP activity. |
| uxInteractions.spec.ts | trace-asserted | UX flows exercise backend routing. |

## Phase 1: Spec + tooling audit (authoritative read)
- [x] Read [doc/tracing.md](doc/tracing.md) sections 4–7, 12–14, 19
- [x] Audit Playwright trace tooling (traceUtils + testArtifacts + compare-traces)
- [x] Confirm current evidence and golden paths are spec-compliant
### Verification
- [x] Record any gaps vs spec in this plan
	- Notes: No deviations observed between compare-traces normalization and spec requirements.

## Phase 2: Full Playwright spec classification
- [x] Inventory every *.spec.ts under playwright/
- [x] Assign each spec a classification in the tracker above
- [x] Ensure each trace-exempt spec has explicit justification
### Verification
- [x] Coverage tracker matches repository file list

## Phase 3: Enforce classification in code
- [x] Add explicit `enableTraceAssertions()` for all trace-asserted specs
- [x] Add explicit `disableTraceAssertions()` for all trace-exempt specs
- [x] Ensure trace reset and evidence capture run in every spec
### Verification
- [x] Grep confirms every spec opts in/out explicitly (musicPlayer.spec.ts is empty by design)

## Phase 4: Golden trace workflow validation
- [ ] Confirm `RECORD_TRACES=1` writes golden traces per spec paths
- [ ] Confirm normalization matches [doc/tracing.md](doc/tracing.md#193-trace-comparison-normalization)
- [ ] Confirm `npm run validate:traces` compares goldens to evidence
### Verification
- [ ] `npm run validate:traces` passes after recording

## Phase 5: Failure-mode hardening checks
- [ ] Validate traces export on failure paths
- [ ] Confirm trace reset isolates tests (no cross-test contamination)
- [ ] Confirm diagnostics are actionable (error-context + request routing)
### Verification
- [ ] Evidence directories contain trace.json, meta.json, error-context.md on failures

## Phase 6: Local verification (full command matrix)
- [ ] npm run test
- [ ] npm run lint
- [ ] npm run build
- [ ] npm run test:e2e
- [ ] npm run test:e2e:ci
- [ ] RECORD_TRACES=1 npm run test:e2e:ci
- [ ] ./build
### Verification
- [ ] No failures in command output

## Phase 7: CI parity verification
- [ ] Confirm CI runs `test:e2e:ci` and trace validation
- [ ] Confirm CI uses committed golden traces
### Verification
- [ ] CI pipeline green with trace validation

## Phase 8: Final coverage audit + closeout
- [ ] Re-run classification grep to confirm opt-in/out per spec
- [ ] Confirm golden traces exist for all trace-asserted specs
- [ ] Mark plan complete
### Completion Gate
- [ ] All phases ticked
- [ ] All required commands green
- [ ] Coverage tracker fully compliant

# Coverage Improvement Plan – ≥92% (Playwright + Unit)

Date: 2026-01-30
Branch: feat/tracing

## Coverage baseline snapshot
- Overall (statement % from coverage/coverage-final.json): 89.01%
- Unit (statement % from coverage/coverage-final.json): 89.01%
- Playwright: Not available in current artifacts (will capture after next `npm run test:e2e:ci` run).

## Lowest-coverage modules (prioritized)
1. src/hooks/useConnectionState.ts (50.00%)
2. src/lib/native/platform.ts (66.67%)
3. src/components/itemSelection/ItemSelectionDialog.tsx (70.56%)
4. src/lib/media-index/localStorageMediaIndex.ts (70.97%)
5. src/lib/sourceNavigation/localSourceAdapter.ts (71.78%)
6. src/lib/hvsc/hvscArchiveExtraction.ts (74.24%)
7. src/lib/config/featureFlags.ts (78.10%)
8. src/lib/disks/diskMount.ts (79.25%)
9. src/lib/sources/localArchiveIngestion.ts (82.14%)
10. src/lib/connection/connectionManager.ts (82.51%)

## Strategy and expected impact
- src/hooks/useConnectionState.ts
	- Why low: hook branches for transitions and retries are untested.
	- Approach: unit tests with mocked dependencies to cover branch transitions and error paths.
	- Estimated impact: +0.2–0.4% overall.
- src/lib/native/platform.ts
	- Why low: platform detection branches not exercised.
	- Approach: unit tests for environment branching (web, native, android).
	- Estimated impact: +0.1–0.2% overall.
- src/components/itemSelection/ItemSelectionDialog.tsx
	- Why low: multiple UI branches (confirm, cancel, selection toggles, edge states) not covered.
	- Approach: extend Playwright UI coverage in existing specs to cover dialog flows and error/empty states.
	- Estimated impact: +0.3–0.5% overall.
- src/lib/media-index/localStorageMediaIndex.ts
	- Why low: localStorage fallbacks and error handling not covered.
	- Approach: unit tests with in-memory storage simulation, cover read/write failure paths.
	- Estimated impact: +0.2–0.3% overall.
- src/lib/sourceNavigation/localSourceAdapter.ts
	- Why low: branchy routing logic and error handling not exercised.
	- Approach: unit tests for branching logic; Playwright for integration-only branches.
	- Estimated impact: +0.3–0.5% overall.
- src/lib/hvsc/hvscArchiveExtraction.ts
	- Why low: extraction error and edge paths untested.
	- Approach: unit tests for success + failure paths using fixtures.
	- Estimated impact: +0.2–0.4% overall.
- src/lib/config/featureFlags.ts
	- Why low: defaulting and override branches untested.
	- Approach: unit tests covering defaults and overrides.
	- Estimated impact: +0.1–0.2% overall.
- src/lib/disks/diskMount.ts
	- Why low: error handling and retry branches not exercised.
	- Approach: unit tests for error paths with mocked API.
	- Estimated impact: +0.1–0.2% overall.
- src/lib/sources/localArchiveIngestion.ts
	- Why low: error and boundary cases untested.
	- Approach: unit tests for boundary handling.
	- Estimated impact: +0.1–0.2% overall.
- src/lib/connection/connectionManager.ts
	- Why low: connection state transitions and failures untested.
	- Approach: unit tests for state transitions and retries.
	- Estimated impact: +0.2–0.4% overall.

## Coverage gap categorization
- Unit-test candidates: src/hooks/useConnectionState.ts, src/lib/native/platform.ts, src/lib/media-index/localStorageMediaIndex.ts, src/lib/sourceNavigation/localSourceAdapter.ts, src/lib/hvsc/hvscArchiveExtraction.ts, src/lib/config/featureFlags.ts, src/lib/disks/diskMount.ts, src/lib/sources/localArchiveIngestion.ts, src/lib/connection/connectionManager.ts
- Playwright candidates: src/components/itemSelection/ItemSelectionDialog.tsx (UI behaviors, empty/error states)
- Edge/error paths: localStorage failures, connection retries, extraction failures, disk mount errors

## Task checklist
- [ ] Add unit tests for `useConnectionState` transitions and error paths
- [ ] Add unit tests for `platform` detection branches
- [ ] Add unit tests for `localStorageMediaIndex` error handling
- [ ] Add unit tests for `localSourceAdapter` branching
- [ ] Add unit tests for `hvscArchiveExtraction` success and failure
- [ ] Add unit tests for `featureFlags` defaults/overrides
- [ ] Add unit tests for `diskMount` error handling
- [ ] Add unit tests for `localArchiveIngestion` boundary paths
- [ ] Add unit tests for `connectionManager` retry/transition logic
- [ ] Extend existing Playwright spec(s) to cover Item Selection dialog empty/error flows
- [ ] Re-run unit coverage and record deltas
- [ ] Re-run Playwright coverage (if available) and record deltas
- [ ] Validate total coverage ≥92%
- [ ] Run CI-equivalent suite locally (lint, test, build, e2e)

## Final validation gate
- [ ] Coverage ≥92% overall
- [ ] All tests pass locally (unit + Playwright)
- [ ] CI green with unchanged thresholds
