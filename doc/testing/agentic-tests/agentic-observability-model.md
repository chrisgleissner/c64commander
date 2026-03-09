# Agentic Observability Model

## Purpose

This file defines how autonomous runs reuse the observability already present in the repo and how that evidence is correlated with `c64scope`.

## Evidence Owners

| Source | Owned by | Best use |
| --- | --- | --- |
| `c64scope` session, capture, assertions, artifacts | `c64scope` | A/V-sensitive physical evidence |
| App logs, traces, action summaries, diagnostics ZIP | C64 Commander app | Async workflow proof and failure attribution |
| Android screenshots, logcat, staged files | mobile controller, currently `droidmind` | Runtime and UI corroboration |
| REST/FTP snapshots and RAM/state refs | app path or `c64bridge` gap-fill | Hardware-visible state corroboration |
| Playwright traces, videos, screenshots, golden traces | existing web E2E | Reusable expected UI flows and evidence patterns |
| Maestro screenshots and native-flow scripts | existing Maestro suite | Native affordance seeds and Android/iOS route knowledge |
| Android JVM plugin tests | existing Gradle test suite | Plugin invariants and failure-mode assumptions |

Important rule:

- `c64scope` is not the only meaningful evidence owner. It is the authority for physical capture and the unified run timeline, but many feature verdicts depend on app-native diagnostics and runtime evidence.

## Correlation Contract

Every autonomous run should maintain:

- one run ID
- one case ID
- one step ID per meaningful action
- timestamps in UTC
- route and feature-area tags

Every recorded step should be attachable to:

- the triggering UI action
- any related diagnostics or log slice
- any related REST/FTP/state snapshot
- any related `c64scope` window or assertion

## Required Reuse From Existing App Observability

- Diagnostics logs.
- Trace events.
- Action summaries.
- Diagnostics ZIP export.
- Global diagnostics overlay behavior.
- Test heartbeat and probe surfaces for lab validation only.

## Required Reuse From Existing External Evidence

- Playwright traces, videos, screenshots, and golden traces for expected web-visible flows.
- Maestro screenshots and flow structure for native affordances, background behavior, and iOS parity references.
- Android logcat and native-plugin logs for background execution, SAF, FTP, mock-server, and diagnostics-bridge issues.
- Android JVM tests as the source of native contract assumptions, not just as build checks.

## Minimum Evidence Per Verdict

For a pass:

- route and feature area
- recorded action step
- primary oracle result
- fallback oracle or explicit statement that none was needed

For a fail:

- route and feature area
- recorded action step
- primary oracle failure
- at least one corroborating app or runtime artifact
- failure class: product, infrastructure, or inconclusive

## Failure Triage Order

1. Check app-native diagnostics and logs.
2. Check runtime evidence such as logcat, plugin warnings, SAF or FTP failures.
3. Check `c64scope` health and A/V artifacts when the case is signal-sensitive.
4. Use Playwright or Maestro prior art only to frame expectation, not as proof of the live physical outcome.

## Probe And Heartbeat Policy

- `TestHeartbeat` and `/__coverage__` are allowed for lab bring-up, probe-health checks, and observability plumbing.
- They must not be cited as product-validation evidence for user-visible behavior.
