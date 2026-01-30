# C64 Commander – Tracing Specification

## 1. Purpose and Scope

This document defines the **Tracing** system for the C64 Commander Capacitor-based application (Web, Android, iOS).

Tracing provides a structured, append-only, machine-readable record of:

- Semantic user, automatic, and system actions
- Resulting REST and FTP interactions
- Backend target selection and fallback decisions
- Causality, ordering, and outcomes required for debugging and automated verification

This specification is the **single source of truth** for implementation, testing, and diagnostics.

Tracing is **not** a replacement for logs. Logs remain message-oriented and human-readable. Traces are structured and machine-oriented.

---

## 2. Design Principles

1. **Always-on, rolling session**
   - One in-memory trace session per app process
   - Rolling retention window of 20 minutes
   - Time-based eviction only

2. **Zero-noise integration**
   - No explicit lifecycle calls in business logic
   - No tracing-specific control flow
   - No per-line or per-call instrumentation
   - Tracing must never reduce code readability

3. **Semantic focus**
   - Only meaningful actions are traced
   - Low-level UI events and rendering noise are excluded

4. **Strict causality**
   - Every backend interaction is causally linked to exactly one action
   - Correlation is explicit and mandatory

5. **Deterministic testability**
   - Traces are designed for semantic assertions
   - Byte-for-byte comparison is explicitly out of scope

6. **Safety by construction**
   - Credentials are redacted at capture time
   - Sensitive data never enters the trace buffer

---

## 3. Terminology

- **Trace Session**
  - The rolling, in-memory collection of trace events

- **Trace Event**
  - A single structured record describing one meaningful occurrence

- **Action Trace**
  - A root semantic trace representing a logical operation

- **Correlation ID**
  - A UUID linking an action trace to all downstream effects

- **Origin**
  - One of `user`, `automatic`, or `system`

---

## 4. Trace Session Lifecycle

### 4.1 Creation

- Created automatically at app startup

### 4.2 Retention

- Maximum retention window: 20 minutes
- Retention is time-based

### 4.3 Clearing

- User-triggered via **Settings → Diagnostics → Traces → Clear Traces**
- Clears all retained events without restarting the session

### 4.4 Programmatic Clearing

- Exposed to Playwright and test tooling
- Clears the rolling buffer without restarting the app

---

## 5. Event Envelope

All trace events share a common envelope:

```json
{
  "id": "uuid",
  "timestamp": "ISO-8601",
  "relativeMs": 123,
  "type": "event-type",
  "origin": "user | automatic | system",
  "correlationId": "uuid",
  "data": {}
}
```

- `timestamp` is absolute and diagnostic
- `relativeMs` is milliseconds since session start and is the primary ordering key for tests

---

## 6. Action Tracing Model

### 6.1 Action Traces

An **Action Trace** represents a single logical operation, for example:

- Play, pause, stop
- Playlist mutation
- HVSC installation
- Device reset
- Background system tasks

Each Action Trace:

- Creates a new `correlationId`
- Has a clear start and end
- Captures contextual metadata automatically
- Owns all child traces (REST, FTP, scoped sub-actions)

Nested Action Traces are not permitted.

Sequential actions produce sequential correlations.

---

### 6.2 Action Trace Origins

Each Action Trace declares an **origin** describing why the action started.

Origin is required and MUST be one of:

- `user` – initiated by explicit user interaction
- `automatic` – initiated as a direct consequence of prior state or action
- `system` – initiated independently of any specific user action

Origin is descriptive only and does not alter causality or ownership rules.

---

## 7. Zero-Noise Action Tracing API

### 7.1 Public API

```ts
useActionTrace(componentName?: string): (fn: Function) => Function
```

Example:

```ts
const trace = useActionTrace('PlayFilesPage');

const handlePlay = trace(async () => {
  await playItem(playlist[currentIndex]);
});
```

Characteristics:

- No string identifiers required
- No manual start or end calls
- No explicit error handling for tracing
- No additional nesting or indentation

### 7.2 Action Name Inference

Action name resolution order:

1. Explicit component name passed to `useActionTrace`
2. Wrapped function variable name
3. React component display name
4. Fallback: `anonymousAction`

Example:

```
PlayFilesPage.handlePlay
```

---

## 8. Automatic Context Enrichment

Each Action Trace automatically captures:

### 8.1 UI Context

- Current route and query parameters
- Platform (web, android, ios)
- Feature flag snapshot

### 8.2 Playback Context (when applicable)

- Playlist length
- Current index
- Current item identifier
- Playing or paused state
- Elapsed playback time

### 8.3 Device Context

- C64 device identifier
- Connection status

No explicit application code is required.

---

## 9. Scoped Sub-Traces (Optional)

For large multi-phase flows only:

```ts
await trace.scope('playlist.add', async () => {
  await scanFiles();
  await resolveSongLengths();
  await updatePlaylist();
});
```

Rules:

- Optional and rare
- One scope per logical phase
- Never deeply nested
- Never used for trivial handlers

---

## 10. Backend Target Semantics

All backend interactions explicitly declare their target:

- `internal-mock` – built into the app, demo mode
- `external-mock` – started by test infrastructure
- `real-device` – physical C64 Ultimate device

IP address and port are informational only.

---

## 11. Backend Decision Event

```json
{
  "type": "backend-decision",
  "data": {
    "selectedTarget": "internal-mock | external-mock | real-device",
    "reason": "reachable | fallback | demo-mode | test-mode"
  }
}
```

Rules:

- Exactly one per correlation
- Must precede any REST or FTP operation

---

## 12. REST Tracing

- REST tracing is transparent
- `getC64API()` returns a Proxy-wrapped client

### REST Request Event

```json
{
  "type": "rest-request",
  "data": {
    "method": "POST",
    "url": "http://host/v1/runners:sidplay",
    "normalizedUrl": "/v1/runners:sidplay",
    "headers": {
      "Authorization": "***"
    },
    "body": {},
    "target": "internal-mock | external-mock | real-device"
  }
}
```

### REST Response Event

```json
{
  "type": "rest-response",
  "data": {
    "status": 200,
    "body": {},
    "durationMs": 34,
    "error": null
  }
}
```

Rules:

- Response immediately follows its request
- Shares the same `correlationId`
- Network passwords are redacted

REST calls outside an Action Trace create implicit root Action Traces.

---

## 13. FTP Tracing

```json
{
  "type": "ftp-operation",
  "data": {
    "operation": "list | get | put | login",
    "path": "/SIDS/HVSC/file.sid",
    "result": "success | failure",
    "error": null,
    "target": "internal-mock | external-mock | real-device"
  }
}
```

Rules:

- FTP credentials are always redacted
- Semantics are equivalent to REST tracing

---

## 14. Error Handling

- Tracing never swallows errors
- Errors propagate unchanged
- Each error is recorded exactly once
- Duplicate logging is suppressed

---

## 15. Redaction Rules

### 15.1 Redacted Data

- Network passwords
- FTP credentials
- Tokens
- Android SAF and filesystem URIs

### 15.2 Timing

- Redaction occurs at capture time
- Sensitive data never enters the trace buffer

---

## 16. Storage and Export

### 16.1 Runtime Storage

- In-memory only
- No serialization on hot paths

### 16.2 Export Triggers

- Explicit user export
- Test completion
- Error scenarios

### 16.3 Export Format

ZIP archive containing:

- `trace.json`
- `app-metadata.json`

`app-metadata.json` is export-only and describes the running app/build/device context (for example: app version, platform, build identifier, and device model). It must not include test-specific fields.

Schema is stable and CI-friendly.

---

## 17. UI Integration

### 17.1 Navigation

Settings → Diagnostics → Traces

### 17.2 Presentation

- Overlay panel
- Raw JSON viewer
- Collapsible nodes
- Read-only

### 17.3 Controls

- Clear Traces
- Share / Export

---

## 18. Playwright Integration

### 18.1 Exposed APIs

- `clearTraces()`
- `getTraces()`

### 18.2 Assertion Strategy

Tests assert:

- Presence of expected events
- Correct ordering
- Correct targets
- Correct payload semantics

### 18.3 Strict Mode

- Optional per-test strictness
- Global override supported

---

## 19. Golden Trace Recording

### 19.1 Purpose

Golden traces capture a deterministic, reviewable baseline of expected traces for local verification and CI parity.

### 19.2 Local Build Integration

#### Execution

`local-build.sh` SHOULD expose a trace recording mode:

- Suggested flag: `--record-traces`
- Optional overrides:
  - `--trace-output-dir <path>` (default: `test-results/traces/golden`)
  - `--trace-suite <name>` (scope recording to a Playwright project or test tag)

When enabled, Playwright runs in trace-recording mode and exports:

- `trace.json` for each test
- `meta.json` (Playwright evidence metadata) as the canonical per-test manifest

Recording mode MUST NOT alter application behavior or timing.

#### Files

Each `test-results/evidence/playwright$/testId` folder needs to contain a `trace.json` file and its existing `meta.json`.

`meta.json` already provides test name, project, timestamp, and file path context. Trace recording MUST reuse this file instead of generating a second manifest.

`app-metadata.json` is not part of Playwright evidence. If present in exported archives, it is ignored for golden trace comparison.

| Concept            | Scope        | Ownership   | Included in Golden Comparison | Purpose |
|--------------------|--------------|-------------|-------------------------------|---------|
| trace.json         | Per test     | Tracing     | Yes                           | Semantic, causal record of app behavior |
| meta.json          | Per test     | Playwright  | Yes                           | Test identity, project, device, and outcome |
| app-metadata.json  | Per export   | Tracing     | No                            | App, build, platform, and device context |

### 19.3 Trace Comparison Normalization

Golden trace comparison MUST ignore volatile fields while preserving semantic order and causality.

The following values are ignored or normalized:

- `timestamp` (absolute)
- `relativeMs` (ordering retained; exact values ignored)
- IP addresses and ports inside REST/FTP URLs
- Any backend host identifiers that differ across runs

All other fields, including event type order, `origin`, `correlationId` shape, targets, and semantic payloads, MUST match.

---

## 20. Relationship to Logs

- Logs are message-oriented and human-readable
- Traces are structured and machine-oriented
- Logs may reference correlation IDs
- Traces must never depend on logs

---

## 21. Non-Goals

- Distributed tracing
- Replay or stub generation
- Compile-time transforms or Babel plugins
- Performance metrics beyond per-call duration
- Visualizations beyond raw JSON

---

## 22. Summary

Tracing provides a deterministic, causal, and test-grade record of application behavior while preserving extreme code readability.

The tracing system adapts to the codebase, not the other way around.
