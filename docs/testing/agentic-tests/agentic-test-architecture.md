# Agentic Test Architecture

## Goal

Enable one LLM to run fully autonomous physical tests against:

- the real Android device running C64 Commander
- the real C64 Ultimate
- the C64 Ultimate video and audio stream when the case is A/V-sensitive

Current execution scope:

- Android only.

Future-compatibility requirement:

- Keep the control boundary generic enough that a future iOS-capable mobile controller can satisfy the same role without rewriting page, action, oracle, or safety semantics.

## Required Reading Order

Before implementation or execution, read:

1. `agentic-feature-surface.md`
2. `agentic-coverage-matrix.md`
3. `agentic-action-model.md`
4. `agentic-oracle-catalog.md`
5. `agentic-safety-policy.md`
6. `agentic-android-runtime-contract.md`
7. `agentic-observability-model.md`
8. `agentic-infrastructure-reuse.md`
9. `agentic-open-questions.md`
10. `c64scope-spec.md`

## Peer Server Model

The LLM is the only orchestrator. The MCP servers remain peers.

| Role | Current implementation | Owns | Must not own |
| --- | --- | --- | --- |
| Mobile controller | `droidmind` on Android | App lifecycle, UI interaction, screenshots, log access, file staging, diagnostics access | Direct C64 control outside the app path, physical verdict logic |
| Direct C64 gap filler | `c64bridge` | Stream start/stop, RAM/state reads, emergency recovery, calibration-only direct control | Primary product-validation control path |
| Physical evidence server | `c64scope` | Capture, signal analysis, session timeline, artifact packaging, A/V assertions | Android control, direct C64 control |

Important note:

- The architecture is controller-neutral even though the current controller implementation is `droidmind`.
- A future iOS controller such as `mobile-mcp` is acceptable if it can satisfy the same interface-level role.

## App-First Product-Validation Rule

The product under test is C64 Commander.

Therefore:

- use the app for normal machine control
- use the app for normal playback and queue behavior
- use the app for normal disk-management and settings workflows
- use `c64bridge` only for narrow gap-filling, recovery, or calibration

Accepted `c64bridge` gaps:

- fast stream start and stop
- fast RAM or state assertions
- emergency recovery when the app path is no longer viable
- direct calibration cases that are explicitly not product-validation runs

## Coverage Model

Mixed-format playback is the baseline physical proof, not the whole coverage claim.

Full autonomous coverage must account for:

- route discovery and read-only surfaces
- connection and demo-mode behavior
- Home machine, RAM, drive, printer, stream, and app-config flows
- Play playlist, transport, background, and HVSC flows
- Disks library, drive control, and destructive management flows
- Config browsing and mutation breadth
- Settings persistence, diagnostics, import/export, and safety controls

The authoritative coverage surface is `agentic-feature-surface.md`, not any single playback case.

## Evidence Model

`c64scope` is not the only meaningful evidence owner.

Evidence for a physical run can come from:

- `c64scope` capture and assertions
- app diagnostics logs, traces, action summaries, and ZIP export
- mobile-controller screenshots and runtime logs
- REST-visible, FTP-visible, filesystem-visible, or RAM/state evidence

`c64scope` is authoritative for:

- capture-window semantics
- A/V assertions
- session-level artifact packaging

It is not authoritative for all non-A/V outcomes by itself.

## Discovery Model

Discovery happens in four layers:

1. Repository docs define feature scope, action rules, oracles, safety, runtime contracts, reuse, and blockers.
2. MCP-native tool discovery exposes primitive tool surfaces.
3. `c64scope` playbooks and case metadata define case-specific artifact and assertion rules.
4. Repository-local bootstrap prompts tell Copilot or OpenCode how to start without human restatement.

Bootstrap files:

- `doc/testing/agentic-tests/c64scope-delivery-prompt.md`
- `.github/prompts/agentic-test.prompt.md`
- `.opencode/agents/c64-agentic-tester.md`

## Session Model

Every autonomous physical run should:

1. Read the relevant case and playbooks.
2. Start a session in `c64scope`.
3. Capture a baseline of connection, runtime mode, and safety-relevant state.
4. Start capture only if the case needs signal evidence.
5. Use the mobile controller to drive the app.
6. Record every meaningful peer-server action in the `c64scope` timeline.
7. Attach app, runtime, REST, FTP, filesystem, or RAM evidence as needed.
8. Finalize a run with pass, fail, or inconclusive plus evidence.

## Valid Control Patterns

### Pattern A: App-driven product validation

- Default pattern.
- The mobile controller drives C64 Commander.
- `c64bridge` is limited to gap-fill operations.
- `c64scope` proves signal-sensitive outcomes and stores the run timeline.

### Pattern B: Direct-C64 calibration

- Infrastructure-only pattern.
- `c64bridge` starts a known fixture directly.
- `c64scope` validates capture and assertion behavior.
- The app is not the product under test in this pattern.

## Safety Model

- Read `agentic-safety-policy.md` before mutating the device or app.
- Destructive actions require explicit case approval and cleanup.
- The agent must stop rather than guess when the safety budget or expected behavior is unclear.

## Controller Contract

The mobile controller role is defined in interface terms:

- app install, start, stop, and clear
- route entry and UI interaction
- screenshots
- runtime logs
- file staging
- diagnostics access

Current mapping:

- Android implementation: `droidmind`

Future compatibility:

- A future iOS controller may implement the same role if it can satisfy the interface contract above.

## Result

This architecture keeps the current work Android-first while avoiding an Android-only dead end:

- three peer MCP servers only
- app-first product validation
- controller-neutral action and oracle semantics
- explicit reuse of existing observability and test infrastructure
- explicit blockers instead of hidden assumptions
