# Agentic Testing Gap Analysis Research 1

## Scope

This package analyzes why the current agentic stack does not exercise C64 Commander deeply and reliably, and why it is biased toward bypassing the app in favor of direct `c64bridge` and lower-level device access.

Evidence sources:

- `docs/testing/agentic-tests/**`
- `.github/prompts/agentic-test.prompt.md`
- `c64scope/**`
- `c64bridge/**`
- `src/**`
- `playwright/**`
- `.maestro/**`
- `android/app/src/test/**`
- `c64scope/artifacts/**`

Conventions:

- `Fact`: directly supported by repository evidence.
- `Inference`: reasoned conclusion from multiple facts.
- `Recommendation`: proposed change.

## Executive Summary

Fact:

- The documented architecture is app-first and peer-based: `droidmind` should drive C64 Commander, `c64scope` should manage capture and session artifacts, and `c64bridge` should be limited to narrow gap-fill and recovery.
- The implemented executable stack in this repo does not match that architecture. `droidmind` is not implemented here, while `c64bridge` is fully implemented and heavily prompt-primed, and `c64scope` ships its own validation runners that use ADB plus direct REST/FTP/device-memory access.
- The current executable `c64scope` validation cases for Play and Disks do not drive the app. They run PRGs directly, read memory directly, browse FTP directly, and then attach an Android screenshot as secondary evidence.
- The app itself already exposes substantial testability: stable selectors, diagnostics, trace infrastructure, background-execution hooks, playlist persistence, HVSC progress reporting, and broad existing Playwright/Maestro prior art.
- Long-running-state hygiene is weak in the current agentic runner. It resets the C64 after each case, but it does not reset app state, playlist state, HVSC summary/cache state, disk library state, or device lock/screen state in a case-specific way.

Inference:

- The main failure is not that the app is fundamentally untestable. The main failure is that the implemented autonomous path makes direct device control much easier, more explicit, and more executable than app-driven control.
- The stack can currently claim broad feature coverage while proving mostly that the hardware and low-level interfaces work, not that the app exercised those behaviors.

## Architecture Reconstruction

### Intended Architecture

Fact:

- `docs/testing/agentic-tests/agentic-test-architecture.md` defines a three-peer model:
  - `droidmind`: app lifecycle, UI interaction, screenshots, log access, diagnostics access
  - `c64bridge`: narrow direct-C64 gap-fill, recovery, calibration
  - `c64scope`: capture, assertions, timeline, artifacts
- `.github/prompts/agentic-test.prompt.md` and `docs/testing/agentic-tests/c64scope-spec.md` both restate the same app-first policy.
- `docs/testing/agentic-tests/agentic-safety-policy.md` explicitly says to use the app path first and not use direct tools to bypass the behavior under test.

### Actual Architecture In Code

Fact:

- `droidmind` IS configured as an MCP server in `.vscode/mcp.json` (`uvx --from git+https://github.com/hyperb1iss/droidmind`), and a `droidmind/` directory exists as a gitignored symlink. However, the `c64scope` validation pipeline does not call `droidmind` through MCP. It uses direct ADB commands (`am start`, `pm list packages`, `run-as`, `logcat`) in validation helper functions. The validation runner writes `peerServer: "mobile_controller"` to session records even though the actual interaction is raw ADB, not a `droidmind` MCP tool call.
- A fourth MCP server, `mobile-mcp` (`@mobilenext/mobile-mcp`), is also configured in `.vscode/mcp.json` but is not referenced by the validation pipeline at all.
- `c64bridge` is fully implemented, documented, prompt-backed, and ships broad direct-control tooling for system, config, disk, drive, sound, stream, memory, and program execution.
- `c64scope` includes:
  - MCP tools for sessions, catalog, capture, assertions, and artifacts
  - a separate validation runner under `c64scope/src/validation/**`
  - hardware-validation and autonomous-validation scripts that call ADB, curl, FTP, direct memory reads, and direct PRG execution
- `c64scope/src/validation/cases/playback.ts` defines Play cases that:
  - build PRGs
  - call `runPrgOnC64u`
  - read C64 memory directly
  - capture streams directly
- `c64scope/src/validation/cases/storage.ts` defines Disks cases that:
  - query `/v1/drives`
  - browse FTP paths directly
  - read config directly
- `c64scope/src/validation/runner.ts` hardcodes “LLM decision trace” and “peerServersUsed” metadata even though the runner is a local scripted harness, not an actual LLM orchestrator using a real `droidmind` MCP server.

### Intended vs Actual Mismatch

| Area | Intended | Actual |
| --- | --- | --- |
| Mobile controller | `droidmind` drives app | `droidmind` configured in `.vscode/mcp.json` but validation pipeline uses direct ADB helpers instead of MCP tool calls |
| Play coverage | App starts playback and manages queue | Current executable cases post PRGs and inspect memory/streams directly |
| Disk coverage | App imports, mounts, renames, deletes, rotates | Current executable cases query drives and FTP directly |
| Session evidence | Real peer-server timeline | Timeline fields are manually written by local runner code |
| Case selection | Metadata-driven app journeys in catalog | Executed runner uses a separate case set under `c64scope/src/validation/cases` |

Inference:

- The repo contains two incompatible agentic-testing stories:
  - a documentation story centered on app-driven autonomous testing
  - an implementation story centered on direct-device scripted validation with `c64scope` journaling

That mismatch is the core reason the LLM keeps bypassing the app.

## Answers To The Required Analysis Questions

### 1. Tooling Control-Path Analysis

Fact:

- `c64bridge` is easier to use than the app path because it is implemented, richly documented, and ships direct examples for running programs, reading screen/memory, controlling drives, and streaming.
- `c64bridge/README.md` explicitly promotes a “C64 agent” that steers Copilot toward `c64bridge` workflows for playback, drive operations, printing, streaming, and device control.
- `c64bridge/AGENTS.md` recommends a plan-run-verify loop around direct `c64_program`, `c64_memory`, and `c64_system` usage.
- `c64scope/src/validation/cases/playback.ts` and `storage.ts` demonstrate direct device control as the executable path for Play and Disks.
- `droidmind` is configured as an MCP server and available to IDE-based LLM sessions, but it is not wired into the `c64scope` validation pipeline. The validation code uses direct ADB calls instead. This means LLM sessions using the IDE could potentially use `droidmind`, but the scripted validation harness bypasses it entirely.

Inference:

- The stack is not merely allowing bypass. It is teaching bypass by example and by ergonomics.

Which actions genuinely require `c64bridge`:

- Stream start/stop reservation and emergency cleanup
- RAM/state reads used as secondary oracles
- Direct recovery when the app path is no longer viable
- Infrastructure-only calibration cases

Which actions should be forced through the app:

- Playlist construction and playback
- Disk library creation, grouping, mount/eject, rename, delete
- HVSC enable/download/install/ingest/browse/play
- Background playback and lock-screen continuation
- Settings, diagnostics, config, and Home workflows

### 2. Surface-Area Coverage Analysis

Fact:

- The app exposes broad surfaces under Home, Play, Disks, Config, Settings, Docs, and Licenses.
- The app contains stable `data-testid` and `aria-label` selectors across many relevant controls.
- Existing Playwright and Maestro suites already cover many high-value flows:
  - playlist construction/manipulation
  - disk list “View all”, rename, remove, mount
  - HVSC browse/download/install/ingest/play
  - background execution and lock behavior
- `c64scope/src/catalog/cases.ts` contains app-aligned metadata for many of these journeys.
- The executable autonomous runner does not execute those metadata-driven cases. It executes a much thinner scripted case set that bypasses the app for Play and Disks.

Inference:

- The main surface-area problem is not missing target definition. It is missing executable app-driven orchestration.

See:

- [inventory.md](./inventory.md)
- [coverage-matrix.md](./coverage-matrix.md)

### 3. Observability And Oracle Analysis

Fact:

- The app already emits strong signals:
  - diagnostics logs and traces
  - action summaries
  - background-execution error logging
  - HVSC progress and status summaries
  - playlist persistence keyed by device
  - IndexedDB playlist repository state
- `c64scope` is strong for A/V capture and artifact packaging.
- The current runner often ignores better app-native oracles and substitutes direct REST/FTP/memory checks.
- `c64scope/src/oraclePolicy.ts` currently returns `failureClass: "product_failure"` even when all assertions pass, which corrupts classification semantics.

Inference:

- The stack has enough raw observability for many flows, but the implemented runner chooses the wrong evidence owners and does not model intermediate assertions well.

### 4. Session And State Analysis

Fact:

- `c64scope/src/validation/runner.ts` resets the C64 after each case, but does not clear app state, playlist state, disk library state, HVSC cache/summary state, device lock state, or local storage/IndexedDB state.
- Playlists persist in local storage, session storage, and IndexedDB.
- Disk library state persists per device.
- HVSC “reset” in `useHvscLibrary` clears summary UI state, not the actual downloaded cache.
- Existing Maestro/emulator harnesses already perform force-stop and `pm clear` flows that the agentic runner does not reuse.

Inference:

- Long-running flakiness is structurally expected because the runner treats hardware reset as sufficient cleanup even when the app persists significant local state.

### 5. Prompting And Policy Analysis

Fact:

- The docs state the right policy, but the executable examples contradict it.
- There is no enforced justification requirement around `c64bridge` use in actual execution.
- `c64scope` session recording accepts arbitrary `peerServer` strings and relies on caller honesty.
- The repo ships much stronger operational guidance for `c64bridge` than for app-driving through a real controller.

Inference:

- The policy is advisory, not enforceable. The practical prompt hierarchy currently favors direct control.

### 6. Architecture And Implementation Analysis

Fact:

- Missing or weak pieces:
  - no repo-local `droidmind` implementation or contract test
  - no executable adapter from case metadata to app-driven controller actions
  - no enforced separation that prevents `c64scope` validation code from acting like controller plus direct bridge
  - no runner-level state reset contract for app/HVSC/playlists/disks/device lock
  - no automatic attribution that proves a device state change originated from the app
- The app itself already has many needed selectors and diagnostics.

Inference:

- The bottleneck is the orchestration/tooling layer more than the app layer.

### 7. Flow-Specific Deep Dives

See [coverage-matrix.md](./coverage-matrix.md) and [failure-modes.md](./failure-modes.md) for detailed treatment of:

- disk list creation and execution
- playlist creation and execution
- autoplay continuation with locked screen
- HVSC download flow
- cache reuse after download
- playlist generation from downloaded songs
- end-to-end playback verification for downloaded and cached content

## Main Root Causes

1. `droidmind` is configured as an MCP server but not used by the validation pipeline, while `c64bridge` is both configured and deeply integrated into the executable validation code.
2. `c64scope` includes executable validation runners that directly control hardware and label the result as app-related coverage.
3. The strongest examples in the repo for “Play” and “Disks” are direct-device examples, not app-driven ones.
4. State reset is hardware-centric, not app-centric.
5. Existing app observability and prior-art tests are underused.
6. Session metadata and failure classification are not trustworthy enough for rigorous autonomous diagnosis.

## Proposed Tool-Precedence Policy

Use this policy text verbatim for app-driven product-validation runs:

> **Tool precedence policy for C64 Commander autonomous product validation**
>
> 1. Default to the mobile controller for every user-facing workflow in C64 Commander.
> 2. Treat C64 Commander as the only allowed primary control path for Play, Disks, Home, Config, Settings, Docs, and Licenses.
> 3. Use `c64scope` for session lifecycle, capture orchestration, A/V assertions, artifact packaging, and timeline correlation only.
> 4. Allow `c64bridge` only for these explicitly enumerated edge cases:
>    - stream reservation/start/stop needed for capture plumbing
>    - RAM/state reads used as secondary oracles
>    - emergency recovery when the app path is no longer viable
>    - infrastructure-only calibration cases that are explicitly not product-validation runs
> 5. Disallow `c64bridge` for:
>    - playback start/stop/next/previous/pause when the app can do it
>    - playlist construction or playlist progression
>    - disk library creation, grouping, rename, delete, mount, or rotation
>    - HVSC download, ingest, browse, or playback
>    - settings/config mutations that the app exposes
> 6. Every `c64bridge` call during a product-validation run must record:
>    - the explicit allowed category above
>    - why the app path was insufficient
>    - why the call does not invalidate the product claim
> 7. If the required action cannot be completed through the mobile controller and the call does not meet an allowed `c64bridge` category, the case must stop as `blocked` or `inconclusive`, not silently bypass through direct control.

## Highest-Priority Fixes

See [remediation-plan.md](./remediation-plan.md). The highest-priority items are:

1. Remove or reclassify `c64scope` direct-control validation cases so they cannot be mistaken for app-driven product validation.
2. Add a real executable mobile-controller integration layer and contract tests for it.
3. Enforce `c64bridge` usage policy at runtime, not just in prose.
4. Build a deterministic reset harness for app storage, playlists, disk library state, HVSC state, device lock state, and capture state.
5. Convert the high-value Play/Disks/HVSC/lock-screen journeys into executable app-driven cases using the existing selectors and Maestro/Playwright prior art.

## Evidence Gaps That Remain

Fact:

- `.vscode/mcp.json` configures `droidmind` as an MCP server, so IDE-based LLM sessions (Copilot, Cursor) CAN access `droidmind` tools for UI interaction when the server is running. However, the scripted `c64scope` validation pipeline does not use this path.
- The `droidmind/` directory exists as a gitignored symlink. Its tools include `android_ui` (tap, swipe, input_text), `android_device`, `android_log`, `android_app` (start, stop, clear), `screenshot`, and `shell_command`. These are sufficient for basic app-driving.
- The analysis cannot fully verify how real LLM orchestration sessions balance `droidmind` MCP calls against raw ADB access in practice, because no session transcripts or LLM invocation logs from real agentic test runs are checked into the repo.
- Some operational behavior (real LLM session routing, actual MCP call patterns) may live outside this repo.

Inference:

- The analysis proves that the repository's scripted validation pipeline bypasses the app, and that the implemented examples and prior art heavily favor direct-device control.
- IDE-based LLM sessions have access to `droidmind` MCP tools, but the lack of strong app-driving examples, the presence of strong direct-control examples, and the absence of runtime enforcement still bias those sessions toward bypass.

