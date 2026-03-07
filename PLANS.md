# Agentic Test Rollout Plan

## Objective

Deliver autonomous agentic tests for C64 Commander that drive the app on a real device, validate behavior against a real Commodore 64 Ultimate through the approved peer MCP servers, and produce deterministic evidence bundles with repeatable pass/fail outcomes.

Current verified constraints:

- Approved peer-server model: mobile controller (`droidmind` role), `c64bridge`, `c64scope`.
- Current physical execution scope: Android only.
- iOS must remain controller-neutral in architecture, but cannot be claimed as physically executed from this Linux host.
- `c64scope/` is implemented as a standalone MCP package with local build, test, and coverage gates.
- Controller lifecycle primitives have been verified on controller-visible target `R5CRC3ZY9XH` (`SM-G990B`), but that target is currently an emulator and is not sufficient for real-hardware completion.
- The preferred physical Android device `9B081FFAZ001WX` is not currently visible to the controller from this Linux host.
- The currently visible controller target launches C64 Commander into demo-mode fallback because no real C64U is reachable from that device context.

## Execution Rules

- Always work the highest-priority incomplete task whose dependencies are satisfied.
- Mark a task complete only after its verification steps succeed.
- Do not use tools outside the documented peer-server set for product-validation test execution.
- Keep blocked work explicitly blocked; do not guess through open questions documented in `doc/testing/agentic-tests/agentic-open-questions.md`.
- Append one WORKLOG entry for every completed task.

## Phase 1: Architecture Validation

Phase objective:
Validate the documented agentic testing architecture against the current repository and execution environment, and freeze the rollout baseline.

Dependencies:

- None.

Tasks:

- [x] AV-001 Read every document under `doc/testing/agentic-tests/` and extract architecture, topology, evidence, safety, runtime, and blocker constraints.
- [x] AV-002 Inspect current repository state, bootstrap prompts, and peer-server placeholders to identify implemented versus missing infrastructure.
- [x] AV-003 Verify current lab visibility for mobile-device execution using the available controller tools.
- [x] AV-004 Validate real-hardware prerequisites from `doc/testing/physical-device-matrix.md` against the current lab state.
- [x] AV-005 Correct stale repository references that still point `c64scope/` at superseded `physical-tests` documentation.

Completion criteria:

- The current architecture baseline, known blockers, and environment state are documented.
- Stale `physical-tests` references are removed or redirected.
- Real-hardware prerequisite gaps are explicit.

Verification steps:

- Re-read affected docs and bootstrap files after updates.
- Confirm no remaining stale `physical-tests` references in active `c64scope` bootstrap files.
- Confirm lab state evidence exists for device visibility and prerequisite checks.

## Phase 2: MCP Server Integration And Verification

Phase objective:
Create and verify the `c64scope` MCP server skeleton so the three-peer-server architecture is runnable and contract-driven.

Dependencies:

- AV-004
- AV-005

Tasks:

- [x] MCP-001 Create a self-contained `c64scope` package in `c64scope/` with explicit runtime, build, and test entrypoints.
- [x] MCP-002 Implement the base MCP server with the required tool groups: `scope_session`, `scope_lab`, `scope_capture`, `scope_assert`, `scope_artifact`, `scope_catalog`.
- [x] MCP-003 Implement resource and prompt surfaces for case metadata, playbooks, assertion catalog, artifact schema, and failure taxonomy.
- [x] MCP-004 Add session persistence, response-envelope helpers, and schema validation for runs, steps, attachments, and assertions.
- [x] MCP-005 Add unit tests that verify tool/resource registration and response-envelope invariants.
- [x] MCP-006 Verify the server starts locally over stdio and exposes the documented contract surface.
- [x] MCP-007 Add a package-local coverage gate and achieve 90%+ statements, branches, functions, and lines coverage for `c64scope`.

Completion criteria:

- `c64scope` starts successfully and lists the required tools/resources/prompts.
- Session creation and step recording work against validated schemas.
- Unit tests cover the contract surface.
- `c64scope` maintains 90%+ statements, branches, functions, and lines coverage under its package-local coverage run.

Verification steps:

- Run `c64scope` unit tests.
- Start the server locally and inspect tool/resource enumeration.
- Validate sample session JSON against the schema.
- Run `cd c64scope && npm run test:coverage` and confirm all global thresholds are >= 90%.

## Phase 3: Android/iOS Device Orchestration

Phase objective:
Establish the controller boundary and real-device orchestration flow without breaking the Android-first, controller-neutral architecture.

Dependencies:

- MCP-006

Tasks:

- [x] DEV-001 Document the controller contract in executable terms: install, launch, stop, clear, screenshot, logs, file staging, and diagnostics access.
- [x] DEV-002 Verify approved Android device visibility and selection in the lab, including the preferred physical device.
- [ ] DEV-003 Verify app install/launch/terminate flows on the real Android device through the approved controller path.
- [x] DEV-004 Capture Android runtime evidence requirements for logcat, filesystem staging, and diagnostics export.
- [x] DEV-005 Record iOS constraints and deferred physical-execution requirements without claiming unsupported execution from Linux.

Completion criteria:

- The Android controller path is executable end to end on a real device.
- Device-selection rules are explicit.
- iOS is explicitly deferred, not implied.

Verification steps:

- Enumerate the device via approved controller tooling.
- Launch C64 Commander and capture screenshots/runtime evidence.
- Confirm install/terminate cycles behave deterministically.

## Phase 4: Feature Surface Mapping

Phase objective:
Map the real app surface to executable case coverage and separate ready work from blocked work.

Dependencies:

- DEV-003

Tasks:

- [ ] MAP-001 Translate `agentic-feature-surface.md` and `agentic-coverage-matrix.md` into executable case inventory grouped by route and risk.
- [ ] MAP-002 Define test-owned namespaces for app snapshots, disk fixtures, exports, and staged files.
- [ ] MAP-003 Mark blocked features that cannot be executed deterministically because of documented open questions.
- [ ] MAP-004 Create the first prioritized ready-case set spanning navigation, playback, disks, settings, diagnostics, and guarded config/home flows.

Completion criteria:

- Every executable case maps to a documented feature area and oracle pair.
- Test-owned namespaces are explicit.
- Blocked cases are separated from ready cases.

Verification steps:

- Review case inventory against the coverage matrix.
- Confirm each ready case has safety class, oracle class, and cleanup path.

## Phase 5: Agentic Test Framework Construction

Phase objective:
Build the repository-owned framework that lets an LLM run deterministic case flows through the three-peer-server architecture.

Dependencies:

- MAP-004

Tasks:

- [ ] FRM-001 Define case metadata schema covering IDs, feature area, safety class, primary/fallback oracles, cleanup, and dependencies.
- [ ] FRM-002 Add reusable session helpers for run start, step recording, evidence attachment, assertion recording, and finalization.
- [ ] FRM-003 Add case catalog resources and playbooks for the first ready-case slice.
- [ ] FRM-004 Add runner utilities that enforce highest-priority execution, dependency checks, and blocked/inconclusive classification.
- [ ] FRM-005 Add contract tests for case parsing, dependency evaluation, and result classification.

Completion criteria:

- Cases can be loaded, validated, and executed through a consistent session lifecycle.
- The framework rejects invalid or under-specified cases.

Verification steps:

- Run framework unit tests.
- Execute a dry-run case that creates a session, records steps, and finalizes an artifact summary without device interaction.

## Phase 6: Hardware Interaction Observation And Verification Mechanisms

Phase objective:
Implement the signal capture and evidence-attachment path required for hardware-coupled validation.

Dependencies:

- FRM-005

Tasks:

- [ ] OBS-001 Read and apply `doc/c64/c64u-stream-spec.md` and `doc/developer.md` inputs needed for stream and artifact implementation.
- [ ] OBS-002 Implement lab-state reservation and health reporting for capture endpoints.
- [ ] OBS-003 Implement deterministic capture plumbing and artifact storage for video/audio-sensitive runs.
- [ ] OBS-004 Implement external evidence attachment for screenshots, diagnostics, logs, REST snapshots, FTP snapshots, and state refs.
- [ ] OBS-005 Add tests for degraded capture, missing endpoints, and attachment validation.

Completion criteria:

- Capture can be reserved, started, stopped, and reported.
- Non-A/V evidence can be attached to the same run timeline.
- Failure modes are classified deterministically.

Verification steps:

- Run observation-layer tests.
- Exercise capture lifecycle and evidence attachments in a dry-run session.

## Phase 7: Autonomous Exploration Capability

Phase objective:
Teach the framework how to explore routes and case flows safely rather than hard-coding one playback path.

Dependencies:

- OBS-005

Tasks:

- [ ] EXP-001 Encode route-entry, dialog, recovery, and escape rules from `agentic-action-model.md` into executable helpers.
- [ ] EXP-002 Add route-shell discovery cases for Home, Play, Disks, Config, Settings, Docs, and Licenses.
- [ ] EXP-003 Add bounded exploration helpers for read-only discovery, guarded mutations, and destructive-case refusal.
- [ ] EXP-004 Add exploration traces that preserve route, preconditions, visible controls, chosen action, and cleanup outcome.

Completion criteria:

- Exploration can discover the public route shell and perform documented safe actions.
- Unsafe or under-specified actions are rejected with explicit classification.

Verification steps:

- Run exploration unit tests.
- Execute a read-only discovery dry run and inspect recorded exploration steps.

## Phase 8: Deterministic Assertion And Validation Strategy

Phase objective:
Implement strong pass/fail/inconclusive classification using the documented oracle model.

Dependencies:

- EXP-004

Tasks:

- [ ] ORC-001 Encode oracle classes and weak-oracle rejection rules from `agentic-oracle-catalog.md`.
- [ ] ORC-002 Implement assertion primitives for UI, diagnostics/logs, filesystem, REST/FTP/state refs, and A/V evidence.
- [ ] ORC-003 Implement pairwise-oracle enforcement for guarded and destructive actions.
- [ ] ORC-004 Implement explicit classification into `product_failure`, `infrastructure_failure`, and `inconclusive`.
- [ ] ORC-005 Add tests covering weak-oracle rejection and conflicting-evidence classification.

Completion criteria:

- Cases cannot pass on weak single-signal evidence where stronger corroboration is required.
- Conflicting or insufficient evidence produces deterministic non-pass outcomes.

Verification steps:

- Run oracle-layer tests.
- Execute sample assertion scenarios for pass, fail, and inconclusive classifications.

## Phase 9: Test Execution Infrastructure

Phase objective:
Wire the framework into repository scripts, artifacts, and validation workflows.

Dependencies:

- ORC-005

Tasks:

- [ ] EXE-001 Add repository scripts to build, test, and run `c64scope` and the agentic framework.
- [ ] EXE-002 Add artifact-directory conventions for session bundles, logs, and summaries.
- [ ] EXE-003 Add bootstrap documentation so a human or LLM can start the agentic stack without restating architecture.
- [ ] EXE-004 Add CI-safe dry-run coverage for schema, framework, and no-device execution.
- [ ] EXE-005 Add preflight checks that fail early when no real device or required peer server is available.

Completion criteria:

- The repo can build and test the agentic stack locally.
- Preflight catches missing lab prerequisites before product-validation execution starts.

Verification steps:

- Run the new build/test scripts.
- Execute a preflight run with and without required prerequisites.

## Phase 10: Real Hardware Validation Runs

Phase objective:
Execute multiple autonomous agentic tests against real hardware through the approved peer-server model.

Dependencies:

- EXE-005
- DEV-003

Tasks:

- [ ] RUN-001 Establish a healthy real-lab baseline: Android device connected, C64U reachable, approved peer servers running.
- [ ] RUN-002 Execute a read-only route and connection-validation case on the real device.
- [ ] RUN-003 Execute an app-driven mixed-format playback case with `c64scope` signal assertions.
- [ ] RUN-004 Execute a settings/diagnostics persistence case using non-A/V oracles.
- [ ] RUN-005 Execute a disk or playlist management case with deterministic cleanup.
- [ ] RUN-006 Execute one deliberate failure case and verify correct failure classification and artifact completeness.

Completion criteria:

- Multiple autonomous cases execute successfully on real hardware.
- At least one case uses `c64scope` signal evidence and at least one uses non-A/V evidence.
- A deliberate failure run is classified correctly with diagnosable artifacts.

Verification steps:

- Inspect each run bundle for timeline, evidence, assertions, and summary.
- Confirm actions were driven through the app path unless explicitly allowed gap-fill was used.

## Phase 11: Stability And Repeatability Validation

Phase objective:
Prove that real-hardware agentic tests are repeatable and not one-off successes.

Dependencies:

- RUN-006

Tasks:

- [ ] REP-001 Re-run the initial real-hardware case set multiple times under unchanged lab conditions.
- [ ] REP-002 Measure pass/fail/inconclusive rates and identify infrastructure versus product instability.
- [ ] REP-003 Tighten timeouts, retries, and cleanup where repeatability data shows avoidable flakiness.
- [ ] REP-004 Re-verify after fixes until the baseline case set is repeatably successful.

Completion criteria:

- Repeat runs show stable success for the baseline ready-case set.
- Remaining failures are explained and classified, not hand-waved.

Verification steps:

- Review run history across repeated executions.
- Compare artifact summaries and assertion outcomes for consistency.

## Phase 12: Coverage Expansion Across The Full Feature Set

Phase objective:
Expand from the initial ready-case slice toward the full documented feature surface without violating safety or blocker constraints.

Dependencies:

- REP-004

Tasks:

- [ ] COV-001 Add additional ready cases for Home, Play, Disks, Config, Settings, Docs, and Licenses according to the coverage matrix.
- [ ] COV-002 Promote previously partial areas only after their expected-behavior blockers are resolved.
- [ ] COV-003 Track blocked features separately until product/spec decisions close the open questions.
- [ ] COV-004 Re-run stability validation on every expanded coverage slice.

Completion criteria:

- Coverage grows according to the documented feature surface and safety policy.
- Blocked work remains explicit until the underlying blocker is resolved.

Verification steps:

- Review case catalog against `agentic-coverage-matrix.md`.
- Re-run repeatability checks for each new slice.

## Current Task Priority

1. DEV-003 Verify app install/launch/terminate flows on the real Android device through the approved controller path.
2. DEV-004 Capture Android runtime evidence requirements for logcat, filesystem staging, and diagnostics export.
3. DEV-005 Record iOS constraints and deferred physical-execution requirements without claiming unsupported execution from Linux.

## Blockers

- B-001 No approved real Android device is currently visible to the controller from this Linux host; only emulator `R5CRC3ZY9XH` is visible, so DEV-003 cannot complete on real hardware.
- B-002 iOS physical execution cannot be completed from this Linux host and remains explicitly deferred to macOS-hosted execution.
- B-003 Several feature areas remain intentionally blocked by `doc/testing/agentic-tests/agentic-open-questions.md` and must not be guessed through.

## WORKLOG

### 2026-03-07T00:00:00Z AV-001

- Summary: Read every document under `doc/testing/agentic-tests/` and extracted the intended architecture, peer-server topology, controller contract, oracle policy, safety policy, runtime contract, evidence model, implementation constraints, and documented blockers.
- Files created or modified: none.
- Commands executed:
  - `wc -l doc/testing/agentic-tests/*.md`
- Observations and results:
  - The design is explicitly three-peer-server and app-first.
  - `c64scope` is specified but not implemented.
  - Real physical execution is Android-only today.
  - Several feature areas are intentionally partial or blocked and must remain separate from ready work.
- Verification performed:
  - Read all files in `doc/testing/agentic-tests/`, including the full `agentic-test-review.md` in three chunks.

### 2026-03-07T00:00:00Z AV-002

- Summary: Inspected the repository and adjacent peer-server assets to determine current implementation coverage and reusable patterns.
- Files created or modified: none.
- Commands executed: none.
- Observations and results:
  - `c64scope/` currently contains only a placeholder README.
  - `.github/prompts/agentic-test.prompt.md` and `.opencode/agents/c64-agentic-tester.md` already bootstrap the documented architecture.
  - The placeholder `c64scope/README.md` still points at superseded `physical-tests` docs and requires correction.
  - `c64bridge` exposes a TypeScript MCP server pattern that `c64scope` can follow.
  - `android-mcp-server` exposes a simple Python FastMCP pattern but no attached device is configured here.
- Verification performed:
  - Listed `c64scope/`, `.github/prompts/`, and `.opencode/agents/`.
  - Read `c64scope/README.md`, `.github/prompts/agentic-test.prompt.md`, `.opencode/agents/c64-agentic-tester.md`, `c64bridge/package.json`, `c64bridge/src/mcp-server.ts`, `android-mcp-server/pyproject.toml`, and `android-mcp-server/server.py`.

### 2026-03-07T00:00:00Z AV-003

- Summary: Verified current mobile-controller visibility in the lab.
- Files created or modified: none.
- Commands executed: none.
- Observations and results:
  - `mcp_mobile_list_available_devices` returned zero devices.
  - Real-device execution is blocked until the approved Android device is attached and visible to the controller tooling.
- Verification performed:
  - Called the mobile-device enumeration tool and recorded the empty device set.

### 2026-03-07T12:40:53Z AV-004

- Summary: Validated the documented real-hardware prerequisites against the current lab state.
- Files created or modified: none.
- Commands executed:
  - `date -u +%Y-%m-%dT%H:%M:%SZ`
  - `command -v adb`
  - `adb devices`
- Observations and results:
  - `adb` is installed at `/home/chris/platform-tools/adb`.
  - `adb devices` returned no attached devices.
  - `scripts/startup/stage-local-assets-adb.sh` exists and enforces the expected staged-asset types.
  - The physical-device matrix prerequisites are not currently satisfied because no Android device is attached.
- Verification performed:
  - Confirmed `adb` availability.
  - Confirmed device enumeration failure.
  - Read the staging script to verify the required asset and target-path assumptions.

### 2026-03-07T12:40:53Z AV-005

- Summary: Corrected stale `c64scope` bootstrap references to point at the current agentic testing document set.
- Files created or modified:
  - `c64scope/README.md`
- Commands executed: none.
- Observations and results:
  - `c64scope/README.md` previously referenced superseded `doc/testing/physical-tests/*` documents.
  - The README now points at the current `doc/testing/agentic-tests/*` architecture, spec, implementation plan, and delivery prompt.
- Verification performed:
  - Searched `c64scope/**` for `physical-tests` references before the change.
  - Updated the README to the current authoritative document paths.

### 2026-03-07T12:46:42Z MCP-001

- Summary: Created a self-contained `c64scope` package with package metadata, TypeScript build configuration, Vitest configuration, and package-local ignore rules.
- Files created or modified:
  - `c64scope/.gitignore`
  - `c64scope/package.json`
  - `c64scope/package-lock.json`
  - `c64scope/tsconfig.json`
  - `c64scope/vitest.config.ts`
- Commands executed:
  - `cd /home/chris/dev/c64/c64commander/c64scope && npm install`
- Observations and results:
  - `c64scope` is now independently installable and runnable as a package.
  - The package exposes explicit `build`, `test`, `check`, and `mcp` entrypoints.
- Verification performed:
  - Installed dependencies successfully with no reported vulnerabilities.

### 2026-03-07T12:46:42Z MCP-002

- Summary: Implemented the base `c64scope` MCP server skeleton and registered the required tool groups.
- Files created or modified:
  - `c64scope/src/server.ts`
  - `c64scope/src/tools.ts`
  - `c64scope/src/index.ts`
- Commands executed: none.
- Observations and results:
  - The server now exposes the required `scope_session`, `scope_lab`, `scope_capture`, `scope_assert`, `scope_artifact`, and `scope_catalog` tool groups.
  - Tool handlers are app-first and contract-oriented; they do not proxy peer-server behavior.
- Verification performed:
  - Build and test validation passed after aligning tool responses with the MCP SDK call-tool result type.

### 2026-03-07T12:46:42Z MCP-003

- Summary: Added initial resource and prompt surfaces for case metadata, assertion catalog, playbook references, artifact schema, and failure taxonomy.
- Files created or modified:
  - `c64scope/src/catalog.ts`
  - `c64scope/src/resources.ts`
  - `c64scope/src/prompts.ts`
- Commands executed: none.
- Observations and results:
  - `c64scope` now publishes the initial case catalog, assertion catalog, playbook references, artifact schema summary, and failure taxonomy.
  - A bootstrap prompt exists for running a physical case through the three-peer-server architecture.
- Verification performed:
  - Contract tests confirm resource and prompt registration.

### 2026-03-07T12:46:42Z MCP-004

- Summary: Added session persistence, response-envelope helpers, and schema validation for sessions, steps, evidence, capture state, and assertions.
- Files created or modified:
  - `c64scope/src/sessionStore.ts`
  - `c64scope/src/types.ts`
- Commands executed: none.
- Observations and results:
  - Sessions now persist to artifact directories as `session.json` plus a human-readable `summary.md` on finalization.
  - The artifact contract is enforced through runtime schema validation before persistence.
- Verification performed:
  - Contract tests exercised session start, step recording, capture reservation/start, assertion recording, and finalization.

### 2026-03-07T12:46:42Z MCP-005

- Summary: Added unit tests that verify registration and basic lifecycle invariants for the `c64scope` skeleton.
- Files created or modified:
  - `c64scope/tests/server.test.ts`
- Commands executed:
  - `cd /home/chris/dev/c64/c64commander/c64scope && npm run test`
- Observations and results:
  - Tests verify required tool-group presence, resource/prompt presence, and persisted artifact output from a representative session lifecycle.
- Verification performed:
  - `vitest` completed with 2 passing tests.

### 2026-03-07T12:46:42Z MCP-006

- Summary: Verified that the built `c64scope` server starts locally over stdio and remains consistent with the documented contract surface.
- Files created or modified: none.
- Commands executed:
  - `cd /home/chris/dev/c64/c64commander/c64scope && npm run check`
  - `pushd /home/chris/dev/c64/c64commander/c64scope >/dev/null && node dist/index.js`
- Observations and results:
  - The package builds cleanly.
  - The contract tests pass.
  - The stdio server starts without runtime errors when launched from the package directory.
- Verification performed:
  - Successful `tsc` build.
  - Successful `vitest` run.
  - Successful process startup check for `node dist/index.js`.

### 2026-03-07T12:48:11Z DEV-001

- Summary: Documented the controller boundary in executable terms and wired the new contract into the agentic bootstrap prompts.
- Files created or modified:
  - `doc/testing/agentic-tests/agentic-controller-contract.md`
  - `.github/prompts/agentic-test.prompt.md`
  - `.opencode/agents/c64-agentic-tester.md`
- Commands executed:
  - `date -u +%Y-%m-%dT%H:%M:%SZ`
- Observations and results:
  - The controller role is now explicit about device selection, app lifecycle, UI interaction, logs, file staging, diagnostics access, and failure-classification inputs.
  - The bootstrap prompts now instruct agentic execution to read the controller contract before acting.
- Verification performed:
  - Verified no markdown errors in `agentic-controller-contract.md` and `.github/prompts/agentic-test.prompt.md` after the update.

### 2026-03-07T13:02:27Z MCP-007

- Summary: Added a package-local `c64scope` coverage gate, expanded unit coverage across the server boundary and helper layers, and raised `c64scope` coverage above the required 90% thresholds.
- Files created or modified:
  - `c64scope/package.json`
  - `c64scope/vitest.config.ts`
  - `c64scope/src/server.ts`
  - `c64scope/tests/index.test.ts`
  - `c64scope/tests/runtimePrimitives.test.ts`
  - `c64scope/tests/serverHandlers.test.ts`
  - `c64scope/tests/sessionStore.test.ts`
  - `c64scope/tests/toolModules.test.ts`
- Commands executed:
  - `cd /home/chris/dev/c64/c64commander/c64scope && npx vitest run --coverage`
  - `cd /home/chris/dev/c64/c64commander/c64scope && npm run test:coverage`
  - `cd /home/chris/dev/c64/c64commander && npm run build`
  - `cd /home/chris/dev/c64/c64commander/c64scope && npm run check`
- Observations and results:
  - `c64scope` now exposes a package-local `test:coverage` command with global thresholds of 90% for statements, branches, functions, and lines.
  - The final verified coverage result is 99.33% statements, 95.23% branches, 97.05% functions, and 99.33% lines.
  - Coverage is now backed by direct tests of the MCP request handlers, session-store failure paths, helper functions, registry behavior, and entrypoint startup/error handling.
- Verification performed:
  - `npm run test:coverage` passed with all global thresholds satisfied.
  - `npm run check` passed inside `c64scope`.
  - `npm run build` passed for the repository.

### 2026-03-07T13:09:00Z DEV-002

- Summary: Verified current Android lab visibility, app package presence, and the active device-selection state through the approved controller path.
- Files created or modified:
  - `PLANS.md`
- Commands executed:
  - `adb devices`
  - `ping -c 2 c64u`
- Observations and results:
  - `adb devices` reported attached device `R5CRC3ZY9XH`.
  - The mobile controller reported the same device as online with model `SM-G990B`.
  - `ping c64u` succeeded to `192.168.1.13`, confirming current lab-network reachability.
  - `uk.gleissner.c64commander` is installed on the visible device.
  - The device is PIN-locked, so foreground launch verification is blocked until it is unlocked.
- Verification performed:
  - Enumerated devices through the mobile controller.
  - Verified device visibility through `adb`.
  - Verified C64U reachability through `ping`.
  - Verified app package presence through the mobile controller app listing.

### 2026-03-07T13:20:49Z DEV-004

- Summary: Recorded the Android runtime evidence requirements for agentic testing so logcat, filesystem staging, and diagnostics export are specified in executable terms.
- Files created or modified:
  - `doc/testing/agentic-tests/agentic-android-runtime-contract.md`
  - `PLANS.md`
- Commands executed:
  - `date -u +%Y-%m-%dT%H:%M:%SZ`
- Observations and results:
  - The Android runtime contract now names the repository reference harness for launch/logcat evidence (`scripts/startup/collect-android-startup-baseline.mjs`).
  - The deterministic staging path `/sdcard/Download/c64commander-assets` and required fixture counts are now documented from `scripts/startup/stage-local-assets-adb.sh`.
  - Diagnostics ZIP and trace export semantics are now explicit: Android native writes to `Directory.Cache`, then invokes the Share API, and share-sheet visibility alone is not sufficient proof of export completion.
- Verification performed:
  - Re-read `doc/testing/agentic-tests/agentic-android-runtime-contract.md` after the update.
  - Cross-checked the documented evidence paths against `scripts/startup/collect-android-startup-baseline.mjs`, `scripts/startup/stage-local-assets-adb.sh`, `src/lib/diagnostics/diagnosticsExport.ts`, and `src/lib/tracing/traceExport.ts`.

### 2026-03-07T13:20:49Z DEV-005

- Summary: Recorded the iOS deferral rules for the current Linux-hosted lab while preserving the controller-neutral architecture boundary.
- Files created or modified:
  - `doc/testing/agentic-tests/agentic-controller-contract.md`
  - `PLANS.md`
- Commands executed:
  - `date -u +%Y-%m-%dT%H:%M:%SZ`
- Observations and results:
  - The controller contract now states that iOS physical execution, install verification, and hardware-coupled verdicts must not be claimed from this Linux host.
  - The deferred iOS requirements are now explicit: macOS-hosted execution, an iOS controller matching the Android contract surface, and platform-specific evidence for lifecycle and export behavior.
  - The plan now reflects that iOS remains deferred while DEV-003 is blocked by missing approved real Android hardware visibility rather than by missing controller semantics.
- Verification performed:
  - Re-read `doc/testing/agentic-tests/agentic-controller-contract.md` after the update.
  - Cross-checked the deferral wording against `doc/testing/physical-device-matrix.md`, `doc/testing/maestro.md`, and `.github/workflows/ios.yaml`.
