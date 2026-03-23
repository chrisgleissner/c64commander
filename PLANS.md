# iOS Maestro CI Hardening Plan

Status: IN_PROGRESS
Classification: CODE_CHANGE
Date: 2026-03-23

## Phase 1 - Maestro Syntax Hardening

- Status: DONE
- Objective: remove invalid `scrollUntilVisible` usage and enforce explicit, deterministic scroll contracts across all Maestro YAML.
- Impacted files:
  - `.maestro/subflows/ios-open-play-tab.yaml`
  - `.maestro/subflows/ios-open-settings-tab.yaml`
  - `.maestro/ios-playback-basics.yaml`
  - `.maestro/**/*.yaml` via static contract tests
- Verification method:
  - Parse every Maestro YAML with `js-yaml`
  - Fail tests if any `scrollUntilVisible` command lacks `element`, `direction`, or `timeout`
  - Re-run unit tests covering Maestro syntax contracts

## Phase 2 - Subflow Isolation + Validation

- Status: DONE
- Objective: isolate shared iOS subflows so a single reusable subflow defect is caught by dedicated probe flows before grouped end-to-end flows hide the root cause.
- Impacted files:
  - `.maestro/ios-subflow-open-play-tab-probe.yaml`
  - `.maestro/ios-subflow-open-settings-tab-probe.yaml`
  - `.maestro/ios-subflow-open-play-add-items-probe.yaml`
  - `scripts/ci/validate-ios-maestro-shared-subflows.sh`
  - `.github/workflows/ios.yaml`
  - `tests/unit/maestro/maestroFlowContracts.test.ts`
- Verification method:
  - Static unit tests confirm each shared subflow has a dedicated probe flow
  - CI preflight step runs the shared-subflow probes independently before grouped Maestro flows

## Phase 3 - CI Failure Propagation Fix

- Status: DONE
- Objective: make every Maestro, connectivity, and artifact-contract failure exit non-zero without being swallowed.
- Impacted files:
  - `.github/workflows/ios.yaml`
  - `scripts/ci/ios-maestro-run-flow.sh`
  - `scripts/ci/validate-ios-connectivity.sh`
  - `tests/unit/ci/iosMaestroWorkflowContracts.test.ts`
- Verification method:
  - Unit tests assert workflow contract for non-swallowed connectivity failures and subflow preflight execution
  - Local script tests fail when JUnit or fallback artifact guarantees are removed

## Phase 4 - JUnit Guarantee

- Status: DONE
- Objective: guarantee `junit.xml` exists for every flow even when Maestro exits early or fails before writing reports.
- Impacted files:
  - `scripts/ci/ios-maestro-run-flow.sh`
  - `.github/workflows/ios.yaml`
  - `tests/unit/ci/iosMaestroWorkflowContracts.test.ts`
- Verification method:
  - Wrapper generates fallback JUnit when Maestro output is missing or malformed
  - Unit tests assert fallback-JUnit support is present in the runner

## Phase 5 - Debug Artifact Reliability

- Status: DONE
- Objective: replace empty artifact stubs with non-empty fallback payloads derived from runner evidence when `/debug/*` endpoints are unavailable.
- Impacted files:
  - `scripts/ci/ios-maestro-run-flow.sh`
  - `scripts/ci/validate-ios-connectivity.sh`
  - `tests/unit/ci/iosMaestroWorkflowContracts.test.ts`
- Verification method:
  - Unit tests assert fallback debug payload generation exists and empty-array stubs are gone
  - Connectivity validator recognizes fallback payloads instead of misclassifying them as silent success

## Phase 6 - UI Stability Fixes

- Status: DONE
- Objective: make Play and Settings navigation deterministic on iOS by waiting for page-specific content rather than relying on unstable tab-label visibility.
- Impacted files:
  - `.maestro/subflows/ios-open-play-tab.yaml`
  - `.maestro/subflows/ios-open-settings-tab.yaml`
  - `.maestro/ios-playback-basics.yaml`
  - `tests/unit/maestro/maestroFlowContracts.test.ts`
- Verification method:
  - Static flow tests ensure the hardened shared subflows and probes exist
  - CI preflight runs shared subflows independently

## Phase 7 - Flow Consistency Guarantees

- Status: DONE
- Objective: keep iOS flows deterministic by validating shared entry subflows before grouped runs and preserving per-flow reset behavior already present in the wrapper.
- Impacted files:
  - `scripts/ci/ios-maestro-run-flow.sh`
  - `scripts/ci/validate-ios-maestro-shared-subflows.sh`
  - `.github/workflows/ios.yaml`
- Verification method:
  - Shared-subflow preflight runs against a fresh simulator job before grouped flows
  - Wrapper continues terminating app state before each flow

## Execution Notes

- Linux workspace limitation: real iOS simulator execution is not available locally in this environment, so local verification is limited to unit tests, shell/workflow contract tests, and Maestro YAML parsing. The workflow changes are structured so CI performs the actual simulator validation.
- Completion gate for this task:
  - relevant unit tests pass locally
  - workflow and runner contracts enforce non-zero exit behavior, JUnit generation, and non-empty fallback artifacts
  - `PLANS.md` is updated to `DONE` with final verification evidence after validation

## Verification Evidence

- Shell syntax checks: `bash -n scripts/ci/ios-maestro-run-flow.sh && bash -n scripts/ci/validate-ios-connectivity.sh && bash -n scripts/ci/validate-ios-maestro-shared-subflows.sh`
- Focused regression tests: `npx vitest run tests/unit/maestro/maestroFlowContracts.test.ts tests/unit/ci/iosMaestroWorkflowContracts.test.ts tests/unit/ci/telemetryGateWorkflow.test.ts`
- Focused regression result: 16 tests passed
- Coverage run: `npm run test:coverage`
- Coverage result: 379 test files passed, 4498 tests passed, 91.01% branch coverage
- Formatting check for touched YAML and tests: `npx prettier --check ...` passed
- Lint status: `npm run lint` is currently blocked by a pre-existing repo-wide Prettier issue in `vite.config.ts`, which is unrelated to this Maestro/iOS change set

## Remaining Blocker

- Pending validation outside this Linux environment: run the updated iOS GitHub Actions workflow on macOS to execute the shared-subflow probes and grouped Maestro simulator flows end-to-end.
