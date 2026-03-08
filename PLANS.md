# Agentic Gap-Analysis Implementation Plan

## Goal

Implement an app-first, evidence-complete autonomous validation path aligned with `doc/testing/agentic-tests/gap-analysis/research1/*` and prove it on real hardware.

## Phase 1: Baseline And Logging

- [x] Read entire `doc/testing/agentic-tests/gap-analysis` package.
- [x] Create this phased plan with executable checklists.
- [x] Create a dedicated work log file for implementation evidence.
- [x] Capture current runner gaps and map them to concrete code tasks.

## Phase 2: Control-Path Enforcement

- [x] Reclassify direct-control validation cases as non-product calibration or remove them from product runs.
- [x] Add runtime guardrails that block forbidden `c64bridge` primary actions in product validation.
- [x] Record explicit bridge-usage justification metadata when bridge calls are allowed.

## Phase 3: App-First Runner

- [x] Implement/extend an app-first runner path that drives C64 Commander first.
- [x] Add deterministic step model with explicit step IDs and per-step artifact hooks.
- [x] Add state reset tiers (app + C64) and pre/post checks.

## Phase 4: Evidence Completeness Gate

- [x] Enforce per-step app screenshots (>=1 per step).
- [x] Enforce per-step C64 screenshots (>=1 per step).
- [x] Enforce one MP4 spanning the full run.
- [x] Fail run classification if any evidence requirement is missing.

## Phase 5: Session Trust And Classification

- [x] Remove synthetic peer-server claims from reports/traces.
- [x] Ensure peer attribution derives from real executed actions.
- [x] Ensure pass runs never serialize `failureClass: product_failure`.

## Phase 6: Real Hardware Execution

- [x] Run at least one full app-first validation run on a real Android device and C64 Ultimate.
- [x] Use droidmind for Android app control/evidence capture.
- [x] Use c64scope evidence tooling for session/artifact orchestration.
- [x] Use c64bridge only for allowed fallback categories (if required).

## Phase 7: Verification And Closure

- [x] Verify results folder contains:
- [x] Multiple app screenshots, one per step.
- [x] Multiple C64 screenshots, one per step.
- [x] Full-run MP4 covering start to finish.
- [x] Run required validation/build commands and record outcomes.
- [x] Update work log with executed commands, artifacts, and final proof.
