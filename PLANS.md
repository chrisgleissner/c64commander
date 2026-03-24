# Diagnostics UX and Data Consistency — Execution Plan

Status: IN PROGRESS
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

- [ ] Fix item lookup via `items` intermediate key in `probeConfig()`
- [ ] Handle string `selected` values properly
- [ ] Add diagnostic logging for debugging production issues

### 3.2 Health-check row layout for long text

- [ ] Add detail-row render mode for probes with long reason text
- [ ] Ensure no per-character wrapping; keep compact layout

### 3.3 Expanded REST/FTP action detail completeness

- [ ] Ensure REST expanded shows: host, IP, method, path, headers, body, status, latency
- [ ] Ensure FTP expanded shows: host, operation, path, result, payloads, latency
- [ ] Binary payload: use existing PayloadPreviewBlock consistently

### 3.4 Collapsed action-row info density

- [ ] Show key request info in scrollable collapsed row
- [ ] Center meaningful segment for small-screen visibility

### 3.5 Replace ambiguous `incomplete` status

- [ ] Map `incomplete` to deterministic states (TIMEOUT/FAILED/IN_PROGRESS)
- [ ] Apply consistently across diagnostics/action rendering

### 3.6 Activity header hierarchy

- [ ] Make section title outrank subtitle visually

### 3.7 Top-right action collision risk

- [ ] Increase separation between overflow menu and close button

### 3.8 Latency summary visibility

- [ ] Improve visual separation without height bloat

### 3.9 Health-check execution robustness

- [ ] Per-sub-check and global run timeouts
- [ ] Cancellation support (abort in-flight, mark CANCELLED)
- [ ] Always-restartable (cancel current, start new)
- [ ] Explicit lifecycle model per run and per sub-check
- [ ] Stale-run recovery on screen entry/app resume
- [ ] Observability: timing, state, reason per check

### 3.10 Reconciliation system

- [ ] ConfigReconciler: device as source of truth
- [ ] PlaybackReconciler: confidence-based state
- [ ] DiagnosticsReconciler: lifecycle enforcement
- [ ] User-triggerable "Resync / Repair" action

### 3.11 Playback state under limited observability

- [ ] PLAYING/STOPPED/UNKNOWN with HIGH/MEDIUM/LOW confidence
- [ ] Time decay and error transitions
- [ ] UI reflects uncertainty truthfully

### 3.12 Internal decision-state diagnostics page

- [ ] Accessible via context menu
- [ ] Shows playback, reconciliation, health-check, transport, transitions

### 3.13 Additional failure mode handling

- [ ] Silent request loss, partial FTP, device unavailability
- [ ] Stale cache, race conditions, resume-from-background

## Phase 4 — Automated verification

- [ ] `npm run lint` passes
- [ ] `npm run test` passes
- [ ] `npm run test:coverage` ≥91% branch
- [ ] `npm run build` passes
- [ ] Tests added/updated for CONFIG probe, lifecycle, reconciliation, playback

## Phase 5 — Real-device verification

- [ ] Drive Pixel 4 through diagnostics panel via DroidMind MCP
- [ ] Connect to real C64U via hostname `C64U`
- [ ] Verify CONFIG check executes successfully
- [ ] Verify expanded REST and FTP action details
- [ ] Verify collapsed rows on real device
- [ ] Verify top-right controls, capture evidence

## Phase 6 — Convergence and cleanup

- [ ] Review changed files for duplication and regressions
- [ ] Remove temporary instrumentation
- [ ] Update PLANS.md and WORKLOG.md to final state

## Phase 7 — Self-repair and observability validation

- [ ] Simulate config drift, playback drift, device disconnect
- [ ] Simulate stuck health check, resume after background
- [ ] Verify deterministic recovery, no blocking states
- [ ] Verify correct confidence transitions and reconciliation
- [ ] Verify internal diagnostics page accuracy
