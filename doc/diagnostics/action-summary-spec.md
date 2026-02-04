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

This specification depends on and is aligned with [C64 Commander – Tracing Specification](./tracing-spec.md).

Key relationships:

| Tracing Concept   | Action Summary Concept     |
| ----------------- | -------------------------- |
| Trace Event       | Input only                 |
| Action Trace      | One-to-one source          |
| Correlation ID    | Primary key                |
| Origin            | Collapsed for presentation |
| REST / FTP events | Rendered as effects        |

---

## 3. Terminology

- **Action Summary**  
  A derived, condensed representation of a single Action Trace, produced by aggregating all trace events sharing the same `correlationId`.

- **Effect**  
  A summarized representation of an external interaction (REST or FTP) caused by an Action Trace.

- **Origin**
  A presentation-level classification of action drivers: `user` or `system`.

---

## 4. Derivation Model

### 4.1 Grouping Rule

All trace events are grouped by:

```text
correlationId
```

Each group yields **at most one** Action Summary.

No Action Summary may span multiple correlation IDs.

---

### 4.2 Grouping Depends on Tracing Correctness

Action Summaries are a **pure projection** of trace data. They apply **no post-processing, heuristics, or cleanup logic** to compensate for incorrect tracing.

**Normative clarifications:**

1. **No correlation merging**  
   Action Summaries MUST NOT merge events from different `correlationId` values, even if they appear semantically related.

2. **No heuristic grouping**  
   Action Summaries MUST NOT apply timing-based or name-based heuristics to group events that have distinct `correlationId` values.

3. **No deduplication**  
   If tracing emits duplicate Action Traces for the same user interaction, Action Summaries will faithfully reflect those duplicates. The fix belongs in the tracing layer, not in Action Summary derivation.

4. **Effect grouping is guaranteed by tracing**  
   Correct grouping of user actions with their effects (REST/FTP operations) is the responsibility of the tracing system. Action Summaries rely strictly on `correlationId` boundaries defined by tracing.

5. **Diagnostic value**  
   If an Action Summary shows a user action separated from its effects (effects appearing as separate system-origin summaries), this indicates either:
   - An intentional async pattern where effects run after the user action completes, or
   - A tracing bug that must be fixed at the source.

---

### 4.3 Required Source Events

For a complete Action Summary, the following events MUST exist:

- `action-start`
- `action-end`

If either is missing, the Action Summary MUST be marked as **incomplete**.

---

## 5. Action Origin

### 5.1 Trace-Level Origin

Action Traces define:

```text
origin ∈ { user | automatic | system }
```

This value is preserved in raw traces.

---

### 5.2 Summary-Level Origin Mapping

For Action Summaries, origins are collapsed as follows:

```text
user   ← origin == user
system ← origin == automatic or system
```

This mapping is presentation-only.

The original origin MAY be retained as auxiliary metadata.

---

## 6. Effects

### 6.1 Supported Effect Types

```text
EffectType ∈ { rest, ftp }
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

```text
ActionSummary {
  correlationId

  actionName
  origin               // user | system
  originalOrigin       // optional: user | automatic | system (only if different from origin)

  startTimestamp
  endTimestamp
  durationMs           // required; wall-clock elapsed time from action start to last effect completion
  durationMsMissing    // required only when durationMs is not calculable

  outcome              // success | error | blocked | timeout | incomplete
  errorMessage         // optional (omitted if null)

  restCount            // optional (omitted if 0)
  ftpCount             // optional (omitted if 0)
  errorCount           // optional (omitted if 0)

  effects: Effect[]    // optional (omitted if empty)
}
```

```text
Effect {
  type                 // rest | ftp
  label
  target
  durationMs           // optional
  status               // protocol-specific
  error                // optional (omitted if null)
}
```

---

## 8. Outcome Classification

The Action Summary outcome is derived from `action-end.data.status`:

| action-end.status | Action Summary Outcome |
| ----------------- | ---------------------- |
| success           | success                |
| error             | error                  |
| blocked           | blocked                |
| timeout           | timeout                |
| missing           | incomplete             |

---

## 9. Ordering Rules

Action Summaries MUST be ordered by:

1. `startTimestamp`
2. `correlationId` (tie-breaker)

Ordering MUST be deterministic.

---

## 9.1 Duration Derivation (Normative)

`durationMs` is **required** for every Action Summary.

It MUST represent **wall-clock elapsed time** from the **action start** to the **last effect completion** (or timeout) triggered by that action.
It MUST NOT be the sum of effect durations, since effects can overlap.

Derive as follows:

1. `startTimestamp`: timestamp of `action-start`.
2. `completionTimestamp`: the latest timestamp among effect completion events within the same `correlationId`:
  - REST: `rest-response.timestamp`
  - FTP: `ftp-operation.timestamp`
3. If no effect completion exists, fall back to `action-end.timestamp`.

If a valid wall-clock duration cannot be calculated (missing timestamps or invalid ordering), then:

- `durationMs` MUST be `null`
- `durationMsMissing` MUST be `true`

If `durationMs` is present, `durationMsMissing` MUST be omitted.

---

## 10. UI Integration (Normative)

### 10.1 Navigation

The diagnostics UI MUST expose Action Summaries under a tab labeled:

```text
Actions
```

Example:

```text
Errors | Logs | Traces | Actions
```

---

### 10.2 Visual Encoding

#### Row-level (by Origin)

| Origin | Visual Style       |
| ------ | ------------------ |
| user   | Green              |
| system | Blue               |

#### Effect-level Indicators

| Effect Type | Color  |
| ----------- | ------ |
| rest        | Green  |
| ftp         | Yellow |

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
