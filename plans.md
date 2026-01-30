# Tracing Rollout Plan (Playwright E2E)

Date: 2026-01-30
Branch: feat/tracing

## Scope and Compliance Anchors
- Source of truth: [doc/tracing.md](doc/tracing.md)
- Default test mode: `TRACE_ASSERTIONS_DEFAULT=1`
- Evidence root: `test-results/evidence/playwright/<testId>/<deviceId>/`
- Golden root: `test-results/traces/golden/<suite>/<testId>/<deviceId>/`

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
- [ ] ./local-build.sh
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
