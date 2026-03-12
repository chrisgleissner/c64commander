# Plan: Volume Control Reliability And Diagnostics Export

## Scope

- Resolve Play page volume slider instability, stale state rollback, incorrect REST write behavior, and mute/unmute unreliability.
- Improve diagnostics export with UTC timestamped filenames and a top-level Share All ZIP export.
- Keep the change set minimal and focused.

## Execution Plan

### 1. Investigation

- [done] Inspect `.tmp/volume-change-diagnostics/` and reconstruct the exact user session, UI transitions, and REST traffic.
- [done] Trace the Play page volume slider, mute/unmute, device-state propagation, request scheduling/coalescing, and diagnostics instrumentation paths.
- [done] Trace diagnostics export, ZIP generation, and diagnostics overlay actions.

### 2. Implementation

- [done] Apply the minimum reliable fix for volume drag preview, final commit-on-release, stale response protection, and mute/unmute interaction.
- [done] Confirm the existing diagnostics evidence is sufficient; no extra instrumentation was required for this fix.
- [done] Add Share All export plus UTC timestamped JSON and ZIP filenames without regressing per-tab share.

### 3. Verification

- [done] Add or update targeted regression tests for volume write ordering, drag stability, mute/unmute, and diagnostics export naming/content.
- [done] Run relevant targeted tests.
- [done] Run `npm run test:coverage`.
- [done] Run `npm run lint`.
- [done] Run `npm run build`.
- [done] Run `./build`.

### 4. Documentation

- [done] Update the most relevant existing documentation with the actual slider transmission model, stale-state protection rules, and diagnostics export behavior.

## Notes

- Final report must explicitly answer the ten required investigation questions.
- `PLANS.md` remains the authoritative plan and must be updated as statuses change.

