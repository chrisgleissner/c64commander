# Documentation Index

This folder is the canonical location for durable repository documentation.

## Core repository references

- [advanced.md](advanced.md) - network security, web server configuration, authentication, and Linux auto-update
- [architecture.md](architecture.md) - runtime architecture, subsystem boundaries, and external integrations
- [developer.md](developer.md) - contributor workflow, tooling, conventions, and current engineering hotspots
- [features-by-page.md](features-by-page.md) - implemented user-facing feature surface
- [code-coverage.md](code-coverage.md) - coverage generation, aggregation, and CI gate behavior
- [db.md](db.md) - persistent storage strategy and schema notes
- [ux-guidelines.md](ux-guidelines.md) - UX rules and page-level design constraints
- [ux-interactions.md](ux-interactions.md) - detailed interaction inventory and coverage-oriented UX notes

## C64 Ultimate protocol references

- [c64/c64u-openapi.yaml](c64/c64u-openapi.yaml) - REST schema source
- [c64/c64u-rest-api.md](c64/c64u-rest-api.md) - REST behavior notes
- [c64/c64u-ftp.md](c64/c64u-ftp.md) - FTP behavior notes
- [c64/c64u-stream-spec.md](c64/c64u-stream-spec.md) - stream protocol notes

## Diagnostics and tracing

- [diagnostics/action-summary-spec.md](diagnostics/action-summary-spec.md)
- [diagnostics/tracing-spec.md](diagnostics/tracing-spec.md)
- [diagnostics/trace-forensic-analysis.md](diagnostics/trace-forensic-analysis.md)

## Testing and validation

- [testing/maestro.md](testing/maestro.md)
- [testing/contract-test.md](testing/contract-test.md)
- [testing/chaos-fuzz.md](testing/chaos-fuzz.md)
- [testing/android-emulator-test-structure.md](testing/android-emulator-test-structure.md)
- [testing/physical-device-matrix.md](testing/physical-device-matrix.md)

## Research and exploratory designs

Time-scoped analysis and rollout records remain under `docs/research/` and `docs/testing/investigations/`. They are useful as historical evidence, but the current-state reference docs above are the canonical source for present repository behavior.

- [research/callback8020/](research/callback8020/) - Sailfish OS / Commodore Callback 8020 support: keypad-only (touch-free) operation, the C64U Remote variant, the Android compatibility review, the keymap reference, and the emulation/test tooling.
