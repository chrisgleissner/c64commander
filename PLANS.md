# Review 11 — Live Device and HVSC Workflow Fix Plan

Status: IN_PROGRESS
Classification: DOC_PLUS_CODE, CODE_CHANGE, UI_CHANGE
Date: 2026-03-23
Source: doc/research/review-11/findings.md

## Phase 1 — HVSC Critical Path (BLOCKER)

### Targets: R11-001, R11-002

- [x] R11-001: Fix `offsetBytes: 0` rejection in `HvscIngestionPlugin.kt`
  - Use `call.data.has("offsetBytes")` + `call.data.getLong()` instead of `call.getLong()`
  - Add AppLogger debug line showing received offsetBytes
  - Guard: missing → reject "offsetBytes is required"; negative → reject "offsetBytes must be >= 0"
- [x] R11-002: Fix `hvscHasCache` to depend on `extraction.status === "success"` not `download.status`
  - File: `src/pages/playFiles/hooks/useHvscLibrary.ts` line 665
- [ ] Add unit tests for the offsetBytes and extraction gate fix

Verification:
- offsetBytes=0 passes; missing fails; negative fails
- Ingest button disabled when extraction has not succeeded

## Phase 2 — Health State Correctness

### Targets: R11-007, R11-008, R11-012

- [ ] Introduce first-successful-REST-response gating in `useHealthState.ts`
  - When `latestResult` is null: only derive UNHEALTHY from traces if at least one successful REST response has been observed
  - Before first success: return Idle state
- [ ] Add unit tests: cold-launch → Idle; first REST success → Healthy; transient failure → not immediately Unhealthy

Verification:
- Badge starts as Idle/Connecting on cold launch
- Transitions to Healthy after first clean REST response

## Phase 3 — Diagnostics Quality

### Targets: R11-004, R11-005, R11-006

- [ ] R11-004: Change action name from `rest.get` to `rest.get /path` in `src/lib/c64api.ts`
- [ ] R11-005: Replace `.slice(0, 8)` with reverse-sorted newest-first rolling window (latest 20)
- [ ] R11-006: Add sections index (Config Drift, Heat Maps, Latency, Health) at top of diagnostics dialog

Verification:
- Collapsed action rows show method + path
- List shows latest entries and updates live

## Phase 4 — Platform Parity: iOS HVSC

### Targets: R11-003, R11-010

- [ ] Implement `HvscIngestionPlugin.swift` in `ios/App/App/`
  - `readArchiveChunk`: read raw file bytes at offset from Capacitor data dir
  - `ingestHvsc`: full 7z extraction + SQLite ingestion using SWCompression
  - `cancelIngestion`, `getIngestionStats`, progress events via `hvscProgress`
- [ ] Add `SWCompression` pod to `ios/App/Podfile`
- [ ] Register plugin in `AppDelegate.swift` or equivalent

Verification:
- iOS HVSC download → extraction → ingestion works
- Progress events fire correctly

## Phase 5 — Platform Parity: Web HVSC

### Target: R11-011

- [ ] Show platform-specific message in `HvscControls.tsx` when HVSC is unavailable
  - Web: "HVSC is not available in web browsers"
  - iOS (if no plugin): handled by Phase 4

## Phase 6 — Playback Error Clarity

### Target: R11-009

- [ ] Fix trailing colon in `new Error(\`HTTP ${status}: ${statusText}\`)` in `src/lib/c64api.ts`
  - Trim statusText; if empty use HTTP status label

## Phase 7 — Documentation

### Target: R11-014

- [ ] Update `src/pages/DocsPage.tsx` to list diagnostics sections and deep-link paths

## Phase 8 — Testing and Coverage

- [ ] Run `npm run test:coverage` — must reach >= 91% branch coverage
- [ ] Run `npm run build` — must pass cleanly
- [ ] Fix any test or lint failures

## Termination Criteria

1. HVSC extraction works end-to-end on Android device (R11-001 fixed)
2. Ingest button disabled unless extraction succeeded (R11-002 fixed)
3. Health badge starts Idle on cold launch, transitions to Healthy after first REST success (R11-007/R11-012)
4. Collapsed diagnostics rows show method + path (R11-004)
5. Diagnostics list shows latest entries, not frozen 8 (R11-005)
6. iOS HVSC fully implemented (R11-003/R11-010)
7. Web HVSC limitation clearly explained (R11-011)
8. Playback errors are non-ambiguous, no trailing colon (R11-009)
9. DocsPage lists diagnostics sections and deep links (R11-014)
10. Coverage >= 91% branch coverage
11. Build passes cleanly
