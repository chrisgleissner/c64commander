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
- [x] If device allows, run SAFE + AUTH OFF and collect outputs.
- [x] Ensure all SAFE write operations restore previous values.
- [x] Record run metadata (firmware commit/hash, OpenAPI hash, device info).

## Phase 4: STRESS Execution (opt-in)
- [ ] Determine if STRESS is safe enough to run.
- [ ] If approved, run STRESS with hard caps and abort conditions.
- [ ] Collect outputs and confirm recovery behavior.

## Phase 5: Reporting and Integration Guidance
- [x] Write report: doc/c64/interface-contract.md with required tables and references.
- [x] Document SAFE vs STRESS coverage and excluded endpoints with rationale.
- [x] Provide reproduction commands.
- [x] Provide integration guidance and optional loader feature flag.

## Phase 6: Verification
- [x] Validate all output JSON files against schemas.
- [x] Update test-results/c64u-interface-contract/latest from newest run.
- [x] Ensure README for harness includes usage examples.
- [ ] Run applicable lint/tests/build if any harness code affects the build.
- [x] Record exact commands executed and results here.

## Execution Log
- [x] npm install (lockfile sync after adding Ajv, ajv-formats, @types/js-yaml)
- [x] npx tsc -p scripts/c64u-interface-contract/tsconfig.json
- [x] node scripts/c64u-interface-contract/dist/run.js --config scripts/c64u-interface-contract/config.safe.authoff.json
- [ ] vitest run (via runTests tool) FAILED: localStorage not defined in connectionManager tests; alias @/lib/* not resolved in hvsc and deviceInteraction tests.
- [x] npm run lint
- [x] npm run build (warning: Module "url" externalized for browser compatibility)
