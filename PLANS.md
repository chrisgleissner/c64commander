# PLANS.md

This file is the authoritative execution contract for the device safety defaults update.
Strict loop: plan -> execute -> verify. A task is checked only after implementation and verification.

## 1. Objective
- [x] Update device safety defaults using only empirically validated C64U contract test data (2026-02-07).

## 2. Required Default Changes (Authoritative)

### 2.1 RELAXED mode
- [x] Apply exact RELAXED defaults (rest/ftp concurrency, caches, cooldowns, backoff, circuit breaker, discovery interval, override flag).

### 2.2 BALANCED mode
- [x] Apply exact BALANCED defaults (rest/ftp concurrency, caches, cooldowns, backoff, circuit breaker, discovery interval, override flag).

### 2.3 CONSERVATIVE mode
- [x] Apply exact CONSERVATIVE defaults (rest/ftp concurrency, caches, cooldowns, backoff, circuit breaker, discovery interval, override flag).

### 2.4 TROUBLESHOOTING mode
- [x] Apply exact TROUBLESHOOTING defaults (rest/ftp concurrency, caches, cooldowns, backoff, circuit breaker, discovery interval, override flag).

## 3. Clamping and Limits
- [x] Keep existing clamp ranges/steps unchanged and do not change storage keys or semantics.

## 4. Testing Requirements
- [x] Update tests that assert MODE_DEFAULTS to match new values.
- [x] Add explicit per-mode tests for rest/ftp concurrency, backoff settings, and circuit breaker settings.
- [x] Add at least one test proving REST and FTP concurrency are independent values.
- [x] Ensure tests are deterministic (no real timers or network).

## 5. Validation Checklist
- [ ] Defaults updated exactly as specified.
- [ ] No unrelated refactors.
- [ ] All tests updated or added.
- [ ] Tests pass locally.
- [ ] CI green.
- [ ] PLANS.md fully checked off.

## 6. Prohibitions
- [ ] Do not add new safety modes, heuristics, or public API/storage key changes.
- [ ] Do not silence ECONNRESET errors or introduce timing-based flakiness.

## 7. Contract Mock Service
- [ ] Make the FTP mock configurable for port 2121 reuse in contract tests.
- [ ] Add a contract mock server (REST + FTP) and auto-start it for mock target runs.
- [ ] Keep contract harness output and teardown guarantees intact.

## 8. Test Error Fixes
- [ ] Resolve failing tests introduced or exposed by these changes.
