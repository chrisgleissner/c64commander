# PLANS.md

This plan is the authoritative contract for the C64U interface-contract research work.
Strict loop: plan -> execute -> verify. Do not proceed to the next phase until the current phase is complete.

## Phase 0: Preconditions
- [ ] Confirm access to a real C64U device and its base URL.
- [ ] Confirm whether the device network password is known and whether AUTH OFF is enabled on-device.
- [ ] Confirm firmware source is available via symlink: 1541ultimate/.
- [ ] Confirm run host has Node.js available for the harness.

## Phase 1: Discovery (static)
- [x] Read README and existing docs relevant to REST/FTP behavior.
- [x] Inspect OpenAPI spec: doc/c64/c64u-openapi.yaml.
- [x] Inspect firmware sources under 1541ultimate/ for REST and FTP servers:
  - [x] Locate REST request handlers and auth checks.
  - [x] Locate FTP command handlers, auth checks, and concurrency hints.
  - [x] Record relevant paths, symbols, and constants.
- [x] Extract candidate endpoint list and FTP command list for testing.

## Phase 2: Harness Design
- [x] Create harness layout under scripts/c64u-interface-contract/ per required structure.
- [x] Define config schema (config.schema.json) with mode, auth, ftpMode, concurrency, pacing, outputDir.
- [x] Define output schemas in scripts/c64u-interface-contract/schemas/ (endpoints, cooldowns, concurrency, conflicts, latency).
- [x] Implement core libs:
  - [x] restClient.ts with correlation IDs and auth header support.
  - [x] ftpClient.ts with PASV/PORT, auth support, correlation IDs.
  - [x] health.ts probe + circuit breaker (N=3, T=30s).
  - [x] timing.ts for pacing and cooldown measurement.
  - [x] concurrency.ts for in-flight control.
- [x] Implement scenarios for REST, FTP, and mixed tests.
- [x] Implement output writer, schema validation, and latest/ sync.
- [x] Implement AUTH comparison tool.

## Phase 3: SAFE Execution
- [ ] Prepare SAFE run configuration (AUTH ON).
- [ ] Run SAFE + AUTH ON and collect outputs.
- [ ] If device allows, run SAFE + AUTH OFF and collect outputs.
- [ ] Ensure all SAFE write operations restore previous values.
- [ ] Record run metadata (firmware commit/hash, OpenAPI hash, device info).

## Phase 4: STRESS Execution (opt-in)
- [ ] Determine if STRESS is safe enough to run.
- [ ] If approved, run STRESS with hard caps and abort conditions.
- [ ] Collect outputs and confirm recovery behavior.

## Phase 5: Reporting and Integration Guidance
- [ ] Write report: doc/c64/interface-contract.md with required tables and references.
- [ ] Document SAFE vs STRESS coverage and excluded endpoints with rationale.
- [ ] Provide reproduction commands.
- [ ] Provide integration guidance and optional loader feature flag.

## Phase 6: Verification
- [ ] Validate all output JSON files against schemas.
- [ ] Update test-results/c64u-interface-contract/latest from newest run.
- [ ] Ensure README for harness includes usage examples.
- [ ] Run applicable lint/tests/build if any harness code affects the build.
- [ ] Record exact commands executed and results here.

## Execution Log
- [ ] (fill after runs)
