# C64 Scope Specification

## Purpose

`c64scope` is the physical-evidence MCP server for autonomous testing of C64 Commander against real hardware.

It exists to provide:

- capture of C64U video and audio streams
- signal-aware assertions
- session timeline and artifact packaging
- failure classification for physical runs

It does not exist to replace the app, the mobile controller, or `c64bridge`.

## Current Execution Scope

- Current physical execution is Android-only.
- The control role is still described in controller-neutral terms so a future iOS controller can fit the same architecture.

## Non-Goals

`c64scope` must not:

- extend `c64bridge`
- extend the mobile controller, currently `droidmind`
- proxy or rename peer-server tools
- become a generic Android UI automation server
- become a direct C64 control server
- become the only evidence owner for non-A/V workflows

## Peer Server Contract

The LLM uses three peer servers directly:

1. mobile controller, currently `droidmind`
2. `c64bridge`
3. `c64scope`

Role split:

- mobile controller drives C64 Commander and gathers Android/runtime evidence
- `c64bridge` fills narrow direct-C64 gaps and recovery paths
- `c64scope` owns physical capture, signal assertions, session timeline, and artifact packaging

`c64scope` must not call the other servers internally.

## App-First Control Policy

For product-validation runs:

- if C64 Commander can perform the action, the LLM should use the app path
- if the app cannot perform the action efficiently enough for the test loop, the LLM may use `c64bridge`

Accepted `c64bridge` gap-fill usage:

- stream start and stop
- RAM or state reads
- emergency recovery
- infrastructure-only calibration

Disallowed `c64bridge` usage for normal product validation:

- direct media start when the app can start it
- direct media stop when the app can stop it
- queue construction or queue progression logic owned by the app

## Evidence Ownership

`c64scope` is authoritative for:

- capture endpoints and receiver health
- signal feature extraction
- A/V assertions
- session timeline schema
- final artifact bundle structure

`c64scope` is not authoritative by itself for:

- settings persistence
- diagnostics export success
- FTP-visible staging state
- general Android runtime health
- any non-A/V verdict that needs app-native evidence

Those outcomes must be attached to the session from the app, the mobile controller, or `c64bridge` state refs.

## When `c64scope` Is Required

Required:

- playback start verification on real hardware
- playback progression verification
- any case whose expected outcome is fundamentally audiovisual

Optional but useful:

- mixed-source runs that need a single session timeline and artifact bundle

Not the primary oracle:

- most Settings, Config, Docs, Licenses, and non-playback disk-library workflows

## Required Tool Groups

`c64scope` should expose these groups:

- `scope_session`
- `scope_lab`
- `scope_capture`
- `scope_assert`
- `scope_artifact`
- `scope_catalog`

## Required Resource Themes

`c64scope` resources should cover:

- case metadata
- assertion catalog
- playbooks
- artifact schema
- failure taxonomy

Case metadata must point back to:

- safety policy
- oracle policy
- runtime contract
- infrastructure reuse map

## Session Contract

Every session should support:

- a run ID
- case ID
- artifact directory
- reserved capture endpoints
- timeline steps from peer-server actions
- state references and external evidence attachments
- assertion results

Minimal rule:

- after every meaningful mobile-controller or `c64bridge` action, the LLM records one semantic step in `scope_session.record_step`

## Artifact Contract

Passing and failing runs should both preserve:

- session metadata
- ordered timeline
- capture health
- signal feature streams when capture was used
- attached external evidence refs
- assertion results
- human-readable summary

Signal-sensitive runs should additionally preserve:

- pinned frames or excerpts as needed
- `recording.mp4` when capture is available

## Failure Classes

`c64scope` should classify physical runs as:

- `product_failure`
- `infrastructure_failure`
- `inconclusive`

Example infrastructure failures:

- packet loss or stale frames above threshold
- wrong UDP target or receiver unavailable
- artifact finalization failure

Example inconclusive failures:

- app evidence and signal evidence disagree
- timeline gaps prevent item attribution

## Response Envelopes

All successful tool responses should include:

```json
{
  "ok": true,
  "runId": "pt-20260307-101530Z",
  "timestamp": "2026-03-07T10:15:30.000Z"
}
```

All failures should include:

```json
{
  "ok": false,
  "runId": "pt-20260307-101530Z",
  "timestamp": "2026-03-07T10:15:30.000Z",
  "error": {
    "code": "capture_unavailable",
    "message": "Video receiver is not running",
    "details": {}
  }
}
```

High-level error codes:

- `invalid_input`
- `session_not_found`
- `session_already_closed`
- `capture_unavailable`
- `capture_degraded`
- `artifact_error`
- `assertion_error`
- `environment_error`
- `internal_error`

## Implementation Constraint

`c64scope` remains repository-owned and isolated in:

```text
c64scope/
```

It should evolve as the physical evidence server, not as a second controller or a duplicate C64 API client.
