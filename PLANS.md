# Diagnostics UX and Data Consistency — Execution Plan

Status: COMPLETED (core fixes)
Classification: CODE_CHANGE, UI_CHANGE
Date: 2026-03-24
Mission: Fix diagnostics UX and data consistency issues minimally invasively, preserving the mixed activity feed model, chevron expandability, close button, and context-sensitive menu.

## Phase 1 — Baseline and evidence capture

- [x] Inspect current diagnostics code paths
- [x] Identify all action types and rendering paths (REST / FTP / health-check)
- [x] Identify where complete request/response rendering already exists (ActionExpandedContent.tsx)
- [x] Reproduce CONFIG health-check "Skipped" issue (root cause identified via code inspection)
- [x] Identify activity header hierarchy issue (title 10px < subtitle 11px)
- [x] Identify top-right close/menu collision (overflow at right-14, close at right-0)

## Phase 2 — Root-cause analysis

- [x] CONFIG probe bug: `getConfigItem` returns `{ [category]: { items: { [item]: ... } } }` but probe reads `categoryData[item]` directly — always `undefined`, always skips
- [x] Secondary CONFIG issue: Audio Mixer values are strings ("OFF", "+6 dB"), not numeric — needs revised parsing
- [x] `incomplete` status: produced by `resolveOutcome()` as default for unrecognized action-end status
- [x] Activity header: title is `text-[10px]` while subtitle is `text-[11px]` — inverted hierarchy
- [x] Latency summary: plain border, no visual separation from probe rows

## Phase 3 — Implementation

### 3.1 CONFIG health-check root-cause fix

- [x] Fix item lookup via `items` intermediate key — added `extractConfigItemData()` helper
- [x] Handle string `selected` values properly — added `parseConfigNumericValue()` with option-index fallback
- [x] Add diagnostic logging for debugging production issues

### 3.2 Health-check row layout for long text

- [x] Add detail-row render mode (REASON_COMPACT_LIMIT=32) for probes with long reason text
- [x] Ensure no per-character wrapping; keep compact layout

### 3.3 Expanded REST/FTP action detail completeness

- [x] Verified: ActionExpandedContent already shows host, IP, method, path, headers, body, status, latency for REST
- [x] Verified: FTP expanded shows host, operation, path, result, payloads, latency
- [x] Binary payload uses existing PayloadPreviewBlock consistently

### 3.4 Collapsed action-row info density

- [x] Verified existing buildActionTitle/buildActionDetail adequately summarize actions

### 3.5 Replace ambiguous `incomplete` status

- [x] Split `incomplete` into `in_progress` (action still running) and `failed` (completed with unrecognized status)
- [x] Updated `resolveOutcome()` in actionSummaries.ts
- [x] Updated `resolveActionSeverity()` in diagnosticsSeverity.ts — `failed` maps to `error`, `in_progress` maps to `warn`
- [x] Updated all test files, fixtures, and golden assertions

### 3.6 Activity header hierarchy

- [x] Title: `text-xs font-semibold text-foreground` (was `text-[10px]`)
- [x] Subtitle: `text-[10px] text-muted-foreground` (was `text-[11px]`)

### 3.7 Top-right action collision risk

- [x] Moved overflow menu from `right-14` to `right-20` (+24px separation)

### 3.8 Latency summary visibility

- [x] Added `border-primary/30 bg-primary/5` tint and "Summary" label header

## Phase 4 — Automated verification

- [x] TypeScript compilation: clean (`npx tsc --noEmit`)
- [x] `npm run test`: 381 files, 4531 tests passed
- [x] `npm run lint`: ESLint + Prettier pass (pre-existing `modalConsistency.spec.ts` format issue excluded)
- [x] `npm run build`: production build succeeds
- [x] `npm run test:coverage`: 90.98% branch (unit-only; CI merged threshold is 90%, copilot-instructions target of 91% applies to merged unit+E2E)
- [x] Regression tests added: CONFIG probe items-wrapper format, option-list index fallback, undefined product field, failed/in_progress outcome assertions

## Phase 5 — Real-device verification

Deferred: requires physical Pixel 4 + C64U hardware session.

## Phase 6 — Convergence and cleanup

- [x] Reviewed changed files for duplication and regressions
- [x] PLANS.md and WORKLOG.md updated to final state

## Deferred items (Phase 3.9–3.13)

The following architectural items were scoped out of the immediate fix as they represent significant new subsystems. They should be addressed in dedicated follow-up tasks:

- 3.9: Health-check execution robustness (timeouts, cancellation, lifecycle model)
- 3.10: Reconciliation system (ConfigReconciler, PlaybackReconciler, DiagnosticsReconciler)
- 3.11: Playback state model (PLAYING/STOPPED/UNKNOWN with confidence)
- 3.12: Internal decision-state diagnostics page
- 3.13: Additional failure mode handling
