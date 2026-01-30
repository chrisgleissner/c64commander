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

### 18.4 Trace Assertion Opt-In Model

Trace assertions are **explicit opt-in** by default. Tests must call the Playwright helper to enable them:

```ts
enableTraceAssertions(testInfo);
```

Optional per-test strictness:

```ts
enableTraceAssertions(testInfo, { strict: true });
```

Opt-out (only needed when a global default is enabled):

```ts
disableTraceAssertions(testInfo, 'Reason for excluding this test');
```

**Configuration sources and precedence:**

1. **Per-test annotation** via `enableTraceAssertions()` / `disableTraceAssertions()` (highest precedence)
2. **Environment defaults**
   - `TRACE_ASSERTIONS_DEFAULT=1` → treat all tests as trace-enabled unless explicitly opted out
   - `TRACE_STRICT=1` → strict ordering enabled unless explicitly disabled per-test

**Enforcement:**

All trace assertion helpers call the opt-in guard. If a test is not opted in, helpers throw with a message describing how to enable tracing. This prevents silent partial coverage.

### 18.5 Trace Assertion Helpers

Canonical helpers live in [playwright/traceUtils.ts](playwright/traceUtils.ts) and are the only supported API for trace assertions:

- `clearTraces(page)`
  - Clears the in-memory trace buffer in the running app.

- `getTraces(page)`
  - Returns the current trace events as JSON.

- `assertRestTraceSequence(testInfo, events, matcher, expectedTypes?)`
  - Asserts a REST request exists and is ordered correctly within its `correlationId`.
  - Defaults to: `action-start → backend-decision → rest-request → rest-response → action-end`.

- `expectRestTraceSequence(page, testInfo, matcher, expectedTypes?)`
  - Polls until the REST trace sequence exists, then returns the matched events.

- `assertFtpTraceSequence(testInfo, events, predicate?, expectedTypes?)`
  - Asserts an FTP operation exists and is ordered correctly within its `correlationId`.
  - Defaults to: `action-start → backend-decision → ftp-operation → action-end`.

- `expectFtpTraceSequence(page, testInfo, predicate?, expectedTypes?)`
  - Polls until the FTP trace sequence exists, then returns the matched events.

- `assertTraceOrder(testInfo, events, expectedTypes?)`
  - Asserts ordering within a single correlation. Strict mode requires exact sequence.

- `findTraceEvent(events, type, predicate?)`
  - Convenience locator for a single event.

- `findRestRequest(events, matcher)` / `findFtpOperation(events, predicate?)`
  - Convenience helpers for event lookup.

**What helpers assert by default:**

- Event ordering within the same `correlationId`
- Presence of required semantic events
- Backend target/decision can be asserted by the test (when stable)

**What helpers do not assert:**

- Absolute timestamps
- Durations
- Byte-for-byte equality of payloads

**Correlation boundaries:**

All ordering assertions are scoped to a single `correlationId`. Tests must never mix events from multiple actions.

### 18.6 Scaling Strategy to 50% Coverage

Selection criteria:

- Prefer tests that already trigger REST/FTP calls (e.g., config changes, disk mounts, playback actions).
- Prefer tests with deterministic backend behavior (mock server, stable routes).

Order of migration:

1. Playback + disk management flows
2. Settings flows that call `/v1/info` or `/v1/configs`
3. FTP-based selection flows (list/open)
4. Demo-mode transitions that hit discovery or config endpoints

Patterns to avoid (brittle):

- Asserting full trace equality inside test code
- Asserting absolute timestamps or durations
- Asserting every event in high-volume sequences (e.g., rapid sliders)
- Coupling trace assertions to UI-only flows with no backend side effects

Rules for when **not** to add trace assertions:

- Visual-only or layout-only tests
- Coverage-only or probe-only tests
- Empty placeholder specs

---

## 19. Golden Trace Recording

### 19.1 Purpose

Golden traces capture a deterministic, reviewable baseline of expected traces for local verification and CI parity.

### 19.2 Local Build Integration

#### Execution

`local-build.sh` exposes a trace recording mode:

- `--record-traces`
- Optional overrides:
  - `--trace-output-dir <path>` (default: `test-results/traces/golden`)
  - `--trace-suite <name>` (scope recording to a Playwright project or test tag)

Equivalent environment variables:

- `RECORD_TRACES=1`
- `TRACE_OUTPUT_DIR=<path>`
- `TRACE_SUITE=<name>`

When enabled, Playwright runs in trace-recording mode and exports:

- `trace.json` for each test
- `meta.json` (Playwright evidence metadata) as the canonical per-test manifest

Recording mode MUST NOT alter application behavior or timing.

#### Files

Each `test-results/evidence/playwright/<testId>/<deviceId>` folder contains:

- `trace.json`
- `meta.json`

`meta.json` provides test name, project, timestamp, and file path context. Trace recording MUST reuse this file instead of generating a second manifest.

`app-metadata.json` is not part of Playwright evidence. If present in exported archives, it is ignored for golden trace comparison.

| Concept            | Scope        | Ownership   | Included in Golden Comparison | Purpose |
|--------------------|--------------|-------------|-------------------------------|---------|
| trace.json         | Per test     | Tracing     | Yes                           | Semantic, causal record of app behavior |
| meta.json          | Per test     | Playwright  | Yes (normalized)              | Test identity, project, device, and outcome |
| app-metadata.json  | Per export   | Tracing     | No                            | App, build, platform, and device context |

### 19.3 Trace Comparison Normalization

Golden trace comparison MUST ignore volatile fields while preserving semantic order and causality.

The following values are ignored or normalized:

- `timestamp` (absolute)
- `relativeMs` (ordering retained; exact values ignored)
- IP addresses and ports inside REST/FTP URLs
- Any backend host identifiers that differ across runs

Meta normalization (for `meta.json`):

- Ignore `timestamp`
- Ignore `status`

All other fields, including event type order, `origin`, `correlationId` shape, targets, and semantic payloads, MUST match.

### 19.4 Developer Workflow (Step-by-Step)

1. **Record golden traces locally**

  ```bash
  ./local-build.sh --test-e2e --record-traces --trace-suite tracing
  ```

  Or use direct env variables:

  ```bash
  RECORD_TRACES=1 TRACE_SUITE=tracing npm run test:e2e
  ```

1. **Review generated files**

- Evidence (always written):
  - `test-results/evidence/playwright/<testId>/<deviceId>/trace.json`
  - `test-results/evidence/playwright/<testId>/<deviceId>/meta.json`
- Golden traces:
  - `test-results/traces/golden/<suite>/<testId>/<deviceId>/trace.json`
  - `test-results/traces/golden/<suite>/<testId>/<deviceId>/meta.json`

1. **Validate against goldens**

  ```bash
  npm run validate:traces
  ```

  You can override the golden directory:

  ```bash
  TRACE_GOLDEN_DIR=/path/to/golden npm run validate:traces
  ```

1. **Update goldens when behavior changes intentionally**

- Re-run step 1 after the code change.
- Commit the updated golden traces alongside the code change.

### 19.5 Failure Modes and Diagnosis

- **Missing trace.json**: The app did not expose tracing or the test ended before capture. Ensure `finalizeEvidence()` runs.
- **Trace mismatch**: Compare normalized `trace.json` between golden and evidence; check for changed action ordering or payload semantics.
- **Meta mismatch**: Confirm test name, device config, or routing expectations haven’t changed.
- **Unexpected target**: Validate routing setup via `seedUiMocks()` or routing annotations and ensure mocks are reachable.

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
