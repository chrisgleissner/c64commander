# Root Causes

## Prompt-Level Causes

### RC-P1: Policy is weaker than examples

Facts:

- App-first rules exist in agentic docs.
- `c64bridge` ships much stronger, more concrete direct-control examples than the app-driving stack.
- Executable `c64scope` validation cases model bypass behavior directly.

Inference:

- An LLM following the path of least resistance will pick direct control.

## Tooling-Level Causes

### RC-T1: The most capable implemented tool is the wrong one for product validation

Facts:

- `c64bridge` is mature, broad, and deeply integrated into the validation pipeline.
- `droidmind` IS configured as an MCP server in `.vscode/mcp.json` and its tools include `android_ui` (tap, swipe, input_text), `android_app` (start, stop, clear), `screenshot`, and `android_log`. These are sufficient for basic app-driving.
- However, the `c64scope` validation pipeline does not use `droidmind` via MCP. It calls ADB directly.
- This means there are two execution contexts with different tool access:
  - IDE-based LLM sessions: have `droidmind` MCP, `c64bridge` MCP, `c64scope` MCP, and `mobile-mcp` available.
  - Scripted validation (`autonomousValidation.ts`): uses direct ADB and REST, bypassing MCP entirely.

Inference:

- In IDE-based LLM sessions, the LLM CAN use `droidmind` to drive the app, but the examples, validation cases, and prior art in the repo overwhelmingly demonstrate direct-device control, creating a strong bias toward bypass.
- In scripted validation, bypass is structurally inevitable because MCP is not used.

### RC-T2: `c64scope` is not staying in its evidence lane

Facts:

- `c64scope` includes direct ADB, curl, FTP, memory, and PRG-execution validation flows.
- Docs say `c64scope` must not replace the controller or `c64bridge`.

Inference:

- The observability layer has become a shadow executor.

### RC-T3: Session recording is descriptive, not authoritative

Facts:

- Session tools accept caller-provided metadata.
- Runner code hardcodes peer usage and “LLM trace” output.

Inference:

- Session data can narrate compliance without proving compliance.

## Architecture-Level Causes

### RC-A1: Two incompatible architectures coexist

Facts:

- Metadata and prompts describe app-first execution.
- Validation runners implement direct-device execution.

Inference:

- Teams and agents do not share a single source of truth for what “coverage” means.

### RC-A2: Coverage model is metadata-rich but executor-poor

Facts:

- `caseCatalog` enumerates higher-value user journeys.
- No executor maps those journeys into controller actions.

Inference:

- The design solved taxonomy before execution.

## App-Level Causes

### RC-APP1: Not the primary blocker

Facts:

- The app already exposes many selectors, diagnostics, and persistence structures.
- Existing Playwright and Maestro tests cover many of the target flows.

Inference:

- The app needs some instrumentation improvements, but it is not the main reason the agentic stack bypasses it.

### RC-APP2: Some flows still need more explicit test hooks

Facts:

- No direct app signal cleanly distinguishes “real cache reset” from “summary reset”.
- Some destructive/global settings need better reserved namespaces and reversible setup.

Inference:

- The app should expose clearer test-state and reset affordances for HVSC, playlists, disk collections, and device-safety changes.

## Observability-Level Causes

### RC-O1: Wrong primary oracles are being chosen

Facts:

- The app has logs, traces, action summaries, diagnostics export, progress reporting, and persistence.
- The runner often chooses direct REST/FTP/memory instead.

Inference:

- The system proves device state, not user journey completion.

### RC-O2: Failure-class semantics are corrupted

Facts:

- `oraclePolicy.ts` marks passing runs as `product_failure`.

Inference:

- Run summaries are not reliable inputs for higher-level analysis or confidence tracking.

## State-Management Causes

### RC-S1: Cleanup is incomplete and mismatched to app behavior

Facts:

- Runner cleanup resets the C64 only.
- App state persists in local storage, session storage, IndexedDB, per-device stores, and HVSC filesystem/cache structures.
- Existing emulator/Maestro harnesses already know how to force-stop and clear the app, but the agentic runner does not reuse that.

Inference:

- Long-running autonomy is brittle because persistent app state outlives each case.

### RC-S2: No first-class model for screen-lock, background, and OS handoff states

Facts:

- Background execution exists and is logged.
- Maestro lock/unlock prior art exists.
- Export/share handoff semantics are partially OS-owned.

Inference:

- High-value Android runtime behavior is understood by the app and by prior-art tests, but not elevated into the agentic session model.

## Root-Cause Ranking

| Rank | Root cause | Why it matters most |
| --- | --- | --- |
| 1 | Missing executable mobile-controller path in validation pipeline, while direct-device path is deeply integrated | makes bypass inevitable in scripted runs and strongly biased in LLM sessions |
| 2 | `c64scope` validation runner bypasses the app while presenting product-style coverage | creates false confidence |
| 3 | Weak enforcement around `c64bridge` usage | policy cannot survive pressure |
| 4 | Incomplete reset/state modeling | causes flakiness and state bleed |
| 5 | Underuse of existing app-native observability and prior-art tests | lowers oracle quality and recovery power |

