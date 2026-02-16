# Fuzz Testing Stabilization Plan

Last updated: 2026-02-16
Owner: Copilot coding agent
Branch: test/improve-coverage

## Objective

Stabilize fuzz testing so that 5-minute runs produce continuous UI progression, long-lived sessions (>=4 min), >=500 interactions, no >10s stagnation, and pass automated artifact validation.

## Diagnosis

### Root Cause 1: `minSessionSteps` terminates sessions prematurely

The main chaos loop breaks when `sessionSteps >= minSessionSteps` (default 200). This kills sessions after ~200 steps regardless of remaining time budget. For a 5-minute run, sessions rarely exceed 60--120 seconds because they hit min-steps and exit.

### Root Cause 2: `sessionTimeoutMs` capped at 60 seconds

`sessionTimeoutMs` uses `Math.min(60_000, ...)`, preventing sessions from running longer than 60s even when the time budget is 5+ minutes.

### Root Cause 3: Stabilize key-burst loop

When `sessionActivityCount < requiredActivitiesPerSession` (20), the code enters a post-loop that presses random keys to pad the count. This produces `stabilize key-burst` log spam with zero navigation or visual progress.

### Root Cause 4: Visual stagnation threshold too low (5s)

`MAX_VISUAL_STAGNATION_MS = 5000` triggers recovery mode too aggressively. Normal page transitions, loading states, and modal animations can take several seconds without pixel changes.

### Root Cause 5: Recovery exhaustion terminates sessions

When 6 recovery ladder steps and 2 structured recovery attempts fail, the session terminates (`recovery-exhausted`). The recovery ladder is one-shot: once exhausted, the session dies rather than resetting and retrying.

### Root Cause 6: No recovery loop reset

After exhausting recovery steps, there is no mechanism to reset the ladder and try navigating to a different page. The session just ends.

### Root Cause 7: `localStorage` SecurityError unhandled

`addInitScript` catches all errors silently. If `localStorage` access fails, the app never receives fuzz mode config, leading to unexpected behavior.

## Architecture Changes

### 1. Long-lived sessions

- Remove `minSessionSteps` as session termination criterion.
- Remove `requiredActivitiesPerSession` and the stabilize key-burst loop entirely.
- Increase `sessionTimeoutMs` to match time budget minus grace: `Math.max(60_000, timeBudgetMs - shutdownBufferMs)`.
- Sessions run until time budget expires or a fatal error occurs.

### 2. Visual stagnation threshold raised to 10s

- Change `MAX_VISUAL_STAGNATION_MS` from 5000 to 10000.
- Update assertions to match new threshold.

### 3. Resilient recovery with loop reset

- When recovery ladder exhausts, navigate home and reset the ladder counter.
- Allow up to 3 full recovery cycles before terminal session exit.
- Add tab-click recovery: iterate through tab-bar buttons.
- Add explicit route navigation as recovery step.

### 4. Remove stabilize key-burst loop

- Delete the post-loop `requiredActivitiesPerSession` padding code.
- Sessions with fewer than 20 activities are already pruned by run-fuzz.mjs.

### 5. Hardened timeouts

- `stateProbeTimeoutMs` increased for reliability.
- `SecurityError` caught and logged rather than silently ignored.

### 6. CI workflow updates

- Add push trigger on `test/improve-coverage` branch.
- Add deterministic seed CI job alongside random seed job.

## Implementation Checklist

- [x] Create PLANS.md
- [ ] Remove `minSessionSteps` session termination
- [ ] Remove stabilize key-burst loop
- [ ] Increase `sessionTimeoutMs` for long runs
- [ ] Raise `MAX_VISUAL_STAGNATION_MS` to 10000
- [ ] Implement recovery ladder reset with 3 full cycles
- [ ] Add tab-cycle and route-navigate recovery steps
- [ ] Harden `localStorage` SecurityError handling
- [ ] Update `run-fuzz.mjs` session timeout defaults
- [ ] Update CI workflow with branch trigger
- [ ] Update visual stagnation assertions
- [ ] Run local 5m fuzz validation
- [ ] Run tests and build
- [ ] Verify CI green

## Verification Checklist

- [ ] 5-minute local fuzz shows continuous UI progression
- [ ] At least one session >= 240 seconds
- [ ] No >10s visual stagnation
- [ ] Interaction count >= 500
- [ ] No stabilize key-burst log entries
- [ ] Artifact validation passes
- [ ] CI fuzz job passes

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Long sessions accumulate memory | High | Browser restart between sessions if needed |
| Recovery loop infinite cycle | Medium | Cap at 3 full ladder resets, then terminal exit |
| Removing min-steps breaks infra test | Low | infra mode has separate config path |
| CI timeout increase | Medium | Keep total workflow timeout at 150 min |
