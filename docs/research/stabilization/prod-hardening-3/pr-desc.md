# PR description

## Summary

- Harden device safety guards, hidden-app background health, slider preview coalescing, playback auto-advance, mounted disk deletion, and HVSC ingestion affordances.
- Add focused regressions for circuit-bypass prevention, bounded slider previews, hidden/resume health checks, mounted-delete eject failures, duplicate/stopped auto-advance, HVSC cancel idempotency, and HVSC ingestion bridge availability.
- Document prod-hardening-3 plan, worklog, results, and validation evidence.

## Validation

- Targeted unit suites passed during implementation.
- `npm run test`
- `npm run lint`
- `npm run build && npm run test:coverage` (91.64% branch coverage)
- Built, installed, and launched `android/app/build/outputs/apk/debug/c64commander-0.8.5-rc1-debug.apk` on Pixel 4 serial `9B081FFAZ001WX`.
- Hardware smoke validation passed against `u64`; `c64u` reset the initial info connection and was not used further.
