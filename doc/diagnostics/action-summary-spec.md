# C64 Commander – Action Summary Specification

## 1. Purpose and Scope

This document defines **Action Summaries**, a derived, presentation-oriented view of the existing tracing system.

Action Summaries provide a concise, human-readable representation of application behavior by collapsing each **Action Trace** (one `correlationId`) into a single summarized entry.

This specification is strictly additive and **does not modify**:

- Trace emission
- Trace schemas
- Trace tests or golden traces
- Tracing semantics or lifecycle

Action Summaries are a **projection**, not a source of truth.

---

## 2. Relationship to Tracing Specification

This specification depends on and is aligned with:

- *C64 Commander – Tracing Specification*

Key relationships:

| Tracing Concept | Action Summary Concept |
|----------------|------------------------|
| Trace Event | Input only |
| Action Trace | One-to-one source |
| Correlation ID | Primary key |
| Origin | Collapsed for presentation |
| REST / FTP events | Rendered as effects |

---

## 3. Terminology

- **Action Summary**  
  A derived, condensed representation of a single Action Trace, produced by aggregating all trace events sharing the same `correlationId`.

- **Effect**  
  A summarized representation of an external interaction (REST or FTP) caused by an Action Trace.

- **Summary Origin**  
  A presentation-level classification of action drivers: `HUMAN` or `MACHINE`.

---

## 4. Derivation Model

### 4.1 Grouping Rule

All trace events are grouped by:

```
correlationId
```

Each group yields **at most one** Action Summary.

No Action Summary may span multiple correlation IDs.

---

### 4.2 Required Source Events

For a complete Action Summary, the following events MUST exist:

- `action-start`
- `action-end`

If either is missing, the Action Summary MUST be marked as **INCOMPLETE**.

---

## 5. Action Summary Origin

### 5.1 Trace-Level Origin

Action Traces define:

```
origin ∈ { user | automatic | system }
```

This value is preserved in raw traces.

---

### 5.2 Summary-Level Origin Mapping

For Action Summaries, origins are collapsed as follows:

```
HUMAN   ← origin == user
MACHINE ← origin == automatic or system
```

This mapping is presentation-only.

The original origin MAY be retained as auxiliary metadata.

---

## 6. Effects

### 6.1 Supported Effect Types

```
EffectType ∈ { REST, FTP }
```

Effects are derived solely from trace events within the same `correlationId`.

---

### 6.2 REST Effect Derivation

A REST Effect exists if the correlation contains a `rest-request`.

Derived fields:

- Method: `rest-request.data.method`
- Path: `rest-request.data.normalizedUrl`
- Target: `rest-request.data.target`
- Status:
  - `rest-response.data.status` if present
  - otherwise derived from `action-end.status`
- Duration:
  - `rest-response.data.durationMs` if present
- Error:
  - `rest-response.data.error` or `action-end.data.error`

Each REST request produces exactly one REST Effect.

---

### 6.3 FTP Effect Derivation

A FTP Effect exists if the correlation contains a `ftp-operation`.

Derived fields:

- Operation: `ftp-operation.data.operation`
- Path: `ftp-operation.data.path`
- Target: `ftp-operation.data.target`
- Result: `ftp-operation.data.result`
- Error: `ftp-operation.data.error`

REST-to-FTP proxying and native indirection MUST NOT be exposed.

---

## 7. Action Summary Data Model

Conceptual structure:

```
ActionSummary {
  correlationId

  actionName
  summaryOrigin        // HUMAN | MACHINE
  originalOrigin       // optional: user | automatic | system

  startTimestamp
  endTimestamp
  durationMs

  outcome              // SUCCESS | ERROR | BLOCKED | TIMEOUT | INCOMPLETE
  error                // optional

  effects: Effect[]
}
```

```
Effect {
  type                 // REST | FTP
  label
  target
  durationMs           // optional
  status               // protocol-specific
  error                // optional
}
```

---

## 8. Outcome Classification

The Action Summary outcome is derived from `action-end.data.status`:

| action-end.status | Action Summary Outcome |
|------------------|------------------------|
| success          | SUCCESS                |
| error            | ERROR                  |
| blocked          | BLOCKED                |
| timeout          | TIMEOUT                |
| missing          | INCOMPLETE             |

---

## 9. Ordering Rules

Action Summaries MUST be ordered by:

1. `startTimestamp`
2. `correlationId` (tie-breaker)

Ordering MUST be deterministic.

---

## 10. UI Integration (Normative)

### 10.1 Navigation

The diagnostics UI MUST expose Action Summaries under a tab labeled:

```
Actions
```

Example:

```
Errors | Logs | Traces | Actions
```

---

### 10.2 Visual Encoding

#### Row-level (by Summary Origin)

| Summary Origin | Visual Style |
|---------------|--------------|
| HUMAN         | Blue         |
| MACHINE       | Neutral / Grey |

#### Effect-level Indicators

| Effect Type | Color |
|------------|-------|
| REST       | Green |
| FTP        | Yellow |

---

## 11. Error Visibility

- Errors MUST be visible at the Action Summary level.
- Protocol-specific errors MAY be repeated at the Effect level.
- Internal routing, guards, and backend-decision events MUST NOT be shown.

---

## 12. Compatibility Guarantees

Action Summaries:

- Do not alter tracing behavior
- Do not affect Playwright helpers
- Do not participate in golden trace comparison
- Require no schema or storage changes

They are a pure, deterministic projection of existing traces.

---

## 13. Non-Goals

- Replacing Trace Events or Action Traces
- Introducing new trace semantics
- Cross-action aggregation
- Heuristic inference of intent
- Distributed tracing
- Analytics or metrics aggregation

---

## 14. Summary

Action Summaries provide a concise, human-oriented representation of Action Traces while preserving the tracing system as the single semantic source of truth.

They improve debuggability and cognitive clarity without compromising determinism, testability, or architectural integrity.
