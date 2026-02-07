# PLANS.md

This file is the authoritative execution contract for the C64 Commander build CLI refactor.
Strict loop: plan -> execute -> verify. A task is checked only after implementation and verification.

## Non-Negotiable Process
- [x] Create and maintain `PLANS.md` as authoritative contract for this task.
- [x] Execute all work through plan-execute-verify loop.
- [x] Preserve all existing build script capabilities with new flag model.
- [x] Keep repository-wide references consistent and up to date.

## Primary Action Model (Final)

| Primary Action | Purpose |
| --- | --- |
| (default build) | install deps, build web app + sync, run default tests, build debug APK |
| `--test-unit` | unit tests (Vitest) |
| `--test-e2e` | Playwright E2E tests (no screenshots) |
| `--test-e2e-ci` | CI mirror (screenshots + e2e + evidence validation) |
| `--test-maestro-ci` | Maestro flows tagged `ci-critical` |
| `--test-maestro-all` | all Maestro flows |
| `--test-maestro-tags <tags>` | Maestro flows filtered by tags |
| `--test-fuzz` | Playwright chaos fuzz runner |
| `--test-contract` | C64U contract test harness |
| `--test-smoke` | Android emulator smoke runner (Maestro-based) |
| `--screenshots` | full pipeline + capture screenshots |
| `--screenshots-only` | capture screenshots only |
| `--emulator` | launch Android emulator |
| `--dump-c64u-config` | dump C64U config to doc/c64/c64u-config.yaml |

Exactly one primary action is allowed. If none is provided, the default build lifecycle runs.

## Flag Domains (Final)

| Domain | Flags | Valid Primary Actions |
| --- | --- | --- |
| Build | `--skip-install`, `--skip-build`, `--skip-tests`, `--skip-apk`, `--skip-format`, `--install-apk`, `--apk-path`, `--device-id` | default build only |
| Test modifiers | `--coverage`, `--validate-evidence`, `--record-traces`, `--trace-output-dir`, `--trace-suite`, `--devices`, `--android-tests`, `--skip-android-tests`, `--skip-android-coverage`, `--test-apk-path`, `--test-device-id` | any `--test-*` primary action |
| Fuzz | `--fuzz-seed`, `--fuzz-steps`, `--fuzz-time-budget`, `--fuzz-last-interactions`, `--fuzz-retain-success`, `--fuzz-min-session-steps`, `--fuzz-no-progress-steps`, `--fuzz-progress-timeout` | `--test-fuzz` |
| Contract | `--contract-mode`, `--contract-auth`, `--contract-password`, `--contract-allow-reset`, `--contract-disk`, `--contract-disk-drive`, `--contract-disk-type`, `--contract-disk-mode`, `--contract-sid`, `--contract-sid-song`, `--contract-prg`, `--contract-prg-action` | `--test-contract` |
| C64U target | `--c64u-target`, `--c64u-host` | `--test-contract`, `--test-maestro-*`, `--test-smoke`, `--test-fuzz` |
| Screenshots | none | `--screenshots`, `--screenshots-only` |
| Tooling | none | `--emulator`, `--dump-c64u-config` |

## Validation Rules (Final)

- Primary actions are mutually exclusive; more than one is an error.
- Build-domain flags are valid only with the default build action.
- Test modifiers are invalid without a `--test-*` primary action.
- Fuzz and contract modifiers are invalid without their respective primary action.
- `--c64u-target/--c64u-host` are valid only with contract, Maestro, or smoke tests.
- Fuzz tests must target mock devices; real targets are rejected.
- `--contract-allow-reset` requires `--contract-mode unsafe`.

## Safety Invariants (Final)

- No global `--mode` flag.
- Fuzz tests never run against real hardware.
- Contract tests require explicit opt-in for real hardware (`--c64u-target real`).
- Unsafe contract mode is explicit and never defaulted.

## Contract Test Teardown Guarantees (Final)

- Always issue `/v1/machine:reboot` as the last device command.
- Wait for the device to restart.
- Poll `/v1/info` until success or timeout.
- Fail the run if recovery does not occur within the timeout.

## Execution Checklist

### A - Primary Action Model
- [x] Define primary-action flags and enforce exactly one (or default build).
- [x] Implement domain-scoped modifiers with strict validation rules.
- [x] Replace `--interface-test*` flags with contract test flags.
- [x] Promote fuzz and contract tests to first-class test categories.
- [x] Promote smoke to `--test-smoke`.
- [x] Rewrite `--help` output to match the new model.

### B - Contract Test Safety
- [x] Add contract test teardown: REBOOT, wait, poll `/v1/info`, timeout on failure.
- [x] Enforce explicit opt-in for real hardware via `--c64u-target real`.
- [x] Ensure unsafe mode requires explicit flags and cannot be accidental.
- [x] Guarantee contract tests leave the device responsive.

### C - Repository-Wide Renames
- [x] Rename contract harness directory to `tests/contract/`.
- [x] Rename contract test results to `test-results/contract/`.
- [x] Move contract test doc to `doc/testing/contract-test.md`.
- [x] Replace legacy contract harness terminology with contract test naming.

### D - Global Updates
- [x] Update build invocations, flags, and examples across docs and scripts.
- [x] Update CI and automation references to new paths and flags.
- [x] Ensure no stale references to removed flags, paths, or terminology remain.

### E - Verification
- [x] Validate CLI rejects invalid flag combinations (fail-fast).
- [x] Validate fuzz tests refuse real hardware targets.
- [ ] Validate contract tests always finish with successful device recovery.
- [x] Run unit tests.
- [x] Run lint, build, and `./build` default lifecycle.

## Deliverables
- [x] `PLANS.md` reflects final CLI model, rules, and safety invariants.
- [x] `--help` output matches the new primary-action design.
- [x] Repository has zero stale references and remains buildable.
