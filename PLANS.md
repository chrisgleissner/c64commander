# Plan: Diagnostics Export And Volume Control Hardening

## Scope

- Verify and harden diagnostics Share All UX, export naming, and ZIP contents.
- Replace simplistic mock timing with a shared realistic single-threaded timing core reused by the external mock server and in-app demo mode.
- Expand volume slider, mute/unmute, Playwright, and Maestro coverage with deterministic rate-limiting assertions.
- Add a configurable volume slider preview interval setting and wire it into runtime behaviour.
- Retake diagnostics screenshots, update docs, and complete full validation.

## Execution Plan

### 1. Baseline Investigation

- [in-progress] Inspect current diagnostics export, Play page volume control, mock server, demo mode, and existing automated coverage.
- [not done] Measure relevant C64U REST endpoint latency against the physical device and derive a bounded reproducible timing profile.
- [not done] Identify current screenshot generation and documentation references for diagnostics overlay.

### 2. Shared Timing Implementation

- [not done] Introduce one shared timing and single-threaded request scheduling core.
- [not done] Reuse that core in the external mock server used by Playwright and in the in-app demo/mock server used by demo mode.
- [not done] Add deterministic tests proving both modes share timing, queueing, and jitter semantics.

### 3. Diagnostics Export Hardening

- [not done] Tighten export helpers around timestamp generation, ZIP assembly, and deterministic naming.
- [not done] Extend unit, integration, and UI tests for per-tab export and Share All export.
- [not done] Retake diagnostics screenshots showing Share All, Clear All, per-tab Share buttons, and populated tabs.

### 4. Volume Control Hardening

- [not done] Add configurable slider preview propagation interval setting with validation and persistence.
- [not done] Ensure slider preview writes are coalesced and rate-limited using the configured interval.
- [not done] Expand mute/unmute and slider behaviour tests across unit, Playwright, and Maestro layers.

### 5. Documentation And Validation

- [not done] Update developer and user documentation for Share All export, export file naming, preview interval, and shared mock/demo timing architecture.
- [not done] Run targeted tests, Playwright screenshots, Playwright suites, Maestro flows, coverage, lint, build, and ./build.
- [not done] Confirm final artifacts and summarize evidence for all required deliverables.

## Notes

- Keep this file current as work progresses.
- Do not weaken assertions; add deterministic clocks, seeds, and request-trace checks where needed.