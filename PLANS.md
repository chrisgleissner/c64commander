# Plan: Diagnostics Export And Volume Control Hardening

## Scope

- Verify and harden diagnostics Share All UX, export naming, and ZIP contents.
- Replace simplistic mock timing with a shared realistic single-threaded timing core reused by the external mock server and in-app demo mode.
- Expand volume slider, mute/unmute, Playwright, and Maestro coverage with deterministic rate-limiting assertions.
- Add a configurable volume slider preview interval setting and wire it into runtime behaviour.
- Retake diagnostics screenshots, update docs, and complete full validation.

## Execution Plan

### 1. Baseline Investigation

- [done] Inspect current diagnostics export, Play page volume control, mock server, demo mode, and existing automated coverage.
- [done] Measure relevant C64U REST endpoint latency against the physical device and derive a bounded reproducible timing profile.
- [done] Identify current screenshot generation and documentation references for diagnostics overlay.

### 2. Shared Timing Implementation

- [done] Introduce one shared timing and single-threaded request scheduling core.
- [done] Reuse that core in the external mock server used by Playwright and in the in-app demo/mock server used by demo mode.
- [done] Add deterministic tests proving both modes share timing, queueing, and jitter semantics.

### 3. Diagnostics Export Hardening

- [done] Verify export helpers around timestamp generation, ZIP assembly, and deterministic naming against the current implementation.
- [done] Extend unit, integration, and UI tests for per-tab export and Share All export.
- [done] Retake diagnostics screenshots showing Share All, Clear All, per-tab Share buttons, and populated tabs.

### 4. Volume Control Hardening

- [done] Add configurable slider preview propagation interval setting with validation and persistence.
- [done] Ensure slider preview writes are coalesced and rate-limited using the configured interval.
- [done] Expand mute/unmute and slider behaviour tests across unit, Playwright, and Maestro layers.

### 5. Documentation And Validation

- [done] Update developer and user documentation for Share All export, export file naming, preview interval, and shared mock/demo timing architecture.
- [in-progress] Run targeted tests, Playwright screenshots, Playwright suites, Maestro flows, coverage, lint, build, and ./build.
- [in-progress] Confirm final artifacts and summarize evidence for all required deliverables.

## Notes

- Keep this file current as work progresses.
- Do not weaken assertions; add deterministic clocks, seeds, and request-trace checks where needed.
- Shared mock timing profile, diagnostics screenshot refresh, lint, targeted tests, full coverage, and direct build validation completed.
- Physical-device latency measurement against a live C64U was completed on 2026-03-12 against hostname `c64u`, and the shared timing profile was recalibrated from those safe REST probes.
- Follow-up timing investigation established that drive-mount latency is route-specific and synchronous: five rebooted live samples for `PUT /v1/drives/b:mount` measured about `753`-`766` ms, and observable `/v1/drives` state completion matched HTTP response timing.
- `./build --skip-install` was blocked by an unrelated flaky Playwright proof on `playwright/buttonHighlightProof.spec.ts` for the `android-phone` project. A direct rerun of that proof passed on `PLAYWRIGHT_PORT=4174`.
