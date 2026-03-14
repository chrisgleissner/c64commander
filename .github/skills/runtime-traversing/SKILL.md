---
name: runtime-traversing
description: Use when tracing runtime behavior in C64 Commander from UI events through state updates, async queues, throttling, and device requests.
argument-hint: (optional) feature or flow to trace
user-invocable: true
disable-model-invocation: true
---

# Runtime Tracing Skill

## Purpose

Explain how a user action propagates through runtime layers and where fragile timing or queue behavior may exist.

## Workflow

1. Identify the triggering UI event or external input.
2. Trace state ownership and derived state updates.
3. Trace async queues, throttling, debouncing, retries, and cancellation.
4. Follow the request path into device communication or native bridges.
5. Summarize failure modes, race conditions, and coverage gaps.

## Trace

Trace the path:

UI event → state change → async queue → device request.

Identify:

- throttling
- debouncing
- async queues
- request batching
- race conditions
- missing regression coverage
