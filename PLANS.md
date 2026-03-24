# Telnet Integration — Execution Plan

Status: PHASE 1 IN PROGRESS
Date: 2026-03-24
Classification: CODE_CHANGE

## Phase Overview

| Phase | Description               | Status      |
| ----- | ------------------------- | ----------- |
| 0     | Document ingestion        | ✅ COMPLETE |
| 1     | Architecture integration  | 🔄 ACTIVE   |
| 2     | VT100 screen parser       | ⬜ PENDING  |
| 3     | Menu navigator            | ⬜ PENDING  |
| 4     | Action execution layer    | ⬜ PENDING  |
| 5     | UI integration            | ⬜ PENDING  |
| 6     | Screenshots               | ⬜ PENDING  |
| 7     | Test coverage enforcement | ⬜ PENDING  |
| 8     | Final validation          | ⬜ PENDING  |

## Spec Reference

- `doc/c64/telnet/c64u-telnet-integration-spec.md` — Implementation-ready specification

## Phase 1 — Architecture Integration

### Modules to create

1. `src/lib/telnet/telnetTypes.ts` — shared types
2. `src/lib/telnet/telnetClient.ts` — transport abstraction
3. `src/lib/telnet/telnetSession.ts` — session lifecycle
4. `src/lib/telnet/telnetScreenParser.ts` — VT100 buffer parser
5. `src/lib/telnet/telnetMenuNavigator.ts` — label-based navigation
6. `src/lib/telnet/telnetActionExecutor.ts` — high-level action API
7. `src/lib/telnet/telnetMock.ts` — deterministic mock
8. `src/lib/native/telnetSocket.ts` — Capacitor plugin bridge

### Integration points

1. `deviceInteractionManager.ts` — add telnetScheduler + withTelnetInteraction()
2. `src/lib/tracing/types.ts` — add "telnet-operation" trace event type
3. `src/lib/tracing/traceSession.ts` — add recordTelnetOperation()
4. Android plugin: TelnetSocketPlugin.kt
