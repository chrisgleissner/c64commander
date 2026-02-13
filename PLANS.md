# iOS State + Diagnostics + CI Artifact Plan

This document is the authoritative execution plan for iOS state parity, diagnostics export, Maestro integration, and CI artifact validation.

## 1. State Model Refactor
- [x] Identify iOS connection-state source and current state enum/flags.
- [x] Introduce explicit states: `connected`, `disconnected`, `demo`.
- [ ] Ensure `demo` is reachable only when a real demo provider is available.
- [x] Set deterministic disconnected defaults in state model.
- [ ] Verify state transitions are deterministic and test-safe.

## 2. UI Placeholder Elimination
- [ ] Replace disconnected placeholders with explicit strings:
  - [ ] Device: `Not connected`
  - [ ] Firmware: `Not connected`
  - [ ] Drives: `No disk mounted`
  - [x] Video Mode: `Not available`
  - [x] Analog: `Not available`
  - [x] Digital: `Not available`
- [x] Remove raw placeholders (`—`, `...`, uninitialized tokens) from affected iOS-visible UI.
- [x] Remove `C64U DEMO` unless real demo provider is wired.
- [ ] Disable config controls when disconnected while preserving layout.

## 3. Debug Endpoint Implementation
- [x] Locate or create iOS DEBUG-only diagnostics server surface.
- [x] Bind local HTTP server to `127.0.0.1` in DEBUG/CI only.
- [x] Implement `GET /debug/trace` -> `trace.json`.
- [x] Implement `GET /debug/actions` -> `action.json`.
- [x] Implement `GET /debug/log` -> `log.json`.
- [x] Implement `GET /debug/errorLog` -> `errorLog.json`.
- [x] Align JSON schema and field semantics with Android artifacts.

## 4. Maestro Integration
- [x] Update Maestro test execution to produce per-test output folder names.
- [x] Configure screenshots into `artifacts/<test-name>/screenshots/`.
- [x] Add post-test curl collection for all four debug endpoints.
- [x] Save JSON outputs into `artifacts/<test-name>/`.

## 5. CI Artifact Restructure
- [x] Ensure CI creates `artifacts/<test-name>/screenshots/*.png`.
- [x] Ensure CI emits `trace.json`, `action.json`, `log.json`, `errorLog.json` per test.
- [x] Zip full `artifacts/` tree as final bundle.
- [x] Upload zipped artifact in workflow.

## 6. Push + Build Trigger
- [ ] Run required project checks for changed scope.
- [ ] Commit all relevant changes.
- [ ] Push to current branch `feat/ios-port`.
- [ ] Trigger CI build for updated branch.
- [ ] Wait for build completion.

## 7. Artifact Download + JSON Validation
- [ ] Download CI artifacts for latest run.
- [ ] Validate required folder structure per test.
- [ ] Validate all JSON files exist and are non-empty.
- [ ] Validate all JSON files parse correctly.
- [ ] Validate screenshots exist for each test folder.

## 8. PNG Visual Verification
- [ ] Programmatically detect blank/near-blank screenshots.
- [ ] Verify screenshots do not show `—`.
- [ ] Verify screenshots do not show `...` placeholder text.
- [ ] Verify screenshots do not show `C64U DEMO` unless demo provider exists.
- [ ] Verify expected labels visible: `Home`, `Machine`, `Quick Config`.
- [ ] Verify Device/Firmware no longer show placeholder values.

## 9. Determinism Audit
- [x] Ensure debug JSON ordering is stable.
- [x] Sort arrays where order is non-semantic.
- [ ] Normalize or exclude nondeterministic timestamps.
- [ ] Avoid nondeterministic identifiers in debug payloads.
- [ ] Re-run validation and confirm stable outputs.
