# Tool Gap Analysis

## Summary

Primary tooling blockers for full app-first coverage are remediated. Current coverage run (`fac-20260308T113632Z`) completed with `PASS:23`, `FAIL:0`, `BLOCKED:0`.

## Remediated Gaps

1. App-first route ambiguity in droidmind navigation
- Status: fixed
- Root cause class: `tool`, `determinism`
- Fix: bottom-tab-specific route tapping + stronger Home markers (`Save RAM`, `QUICK CONFIG`) in `c64scope/src/validation/appFirstPrimitives.ts`.
- Evidence: prior false-home failures removed; `AF-004` now PASS on hardware.

2. Route assertion brittleness when Android reports no focused tab
- Status: fixed
- Root cause class: `tool`, `determinism`
- Fix: route verification now accepts marker-confirmed pass when tab focus signal is absent, while still rejecting mismatched focused tab when present.
- Evidence: flaky `AF-002`/`AF-003` failures in `fac-20260308T113247Z` converged to PASS in `fac-20260308T113632Z`.

3. Missing app-first orchestration substrate in repo-owned runner
- Status: fixed
- Fixes already in place:
  - `droidmind` MCP client integration
  - app-first runtime primitives (unlock/launch/restart/navigation)
  - product vs calibration track separation
  - full feature executor manifest binding
  - typed bridge-fallback enforcement + product bridge policy gate

## Non-Blocking Improvement Opportunities

1. Deep behavior assertions
- Current state: many features are validated at route/surface level with deterministic marker evidence.
- Next step: extend per-feature cases to include mutation round-trips and persistence deltas.

2. Richer per-route diagnostics
- Current state: failures include route and marker details.
- Next step: attach UI XML snapshots on route-assertion failures for faster triage.
