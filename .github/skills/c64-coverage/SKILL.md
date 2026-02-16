---
name: c64-coverage
description: Raise Codecov-reported test coverage for C64 Commander to a defined target without duplicating tests or degrading signal quality.
argument-hint: target-percentage
user-invokable: true
disable-model-invocation: true
---

# Skill: C64 Coverage Hardening

## Purpose

Increase repository coverage as reported by Codecov to the specified percentage.

Coverage must be meaningful, non-duplicative, and aligned with the project’s Android-first strategy.

---

## Preconditions

- Working tree is clean.
- CI pipeline is functional.
- Coverage is reported to Codecov.
- Tests can be executed locally.

If any precondition fails, stop and report.

---

## Execution Workflow

### Step 1 - Establish Baseline

- Run full test suite.
- Determine current coverage locally.
- Confirm Codecov-reported coverage for the default branch.
- Identify gap to target.

---

### Step 2 - Identify Weak Areas

- Locate files or modules below threshold.
- Prioritize:
  - Core domain logic
  - Error handling
  - Edge cases
  - Parsing logic
  - State transitions

Do not prioritize trivial getters or framework glue.

---

### Step 3 - Add High-Signal Tests

Rules:

- Do not duplicate behavior already covered.
- Avoid coverage inflation via trivial tests.
- Android route is primary.
- Add iOS or Web tests only when platform-specific behavior exists.
- Prefer unit tests.
- Use Playwright only for meaningful integration coverage.

---

### Step 4 - Validate

- Run full test suite.
- Ensure no regressions.
- Confirm coverage meets or exceeds target.
- Confirm Codecov delta is positive.

---

## Constraints

- Do not refactor unrelated code.
- Do not weaken tests.
- Do not suppress coverage warnings.
- Maintain deterministic test behavior.

---

## Completion Criteria

- Coverage ≥ target.
- All tests pass.
- No duplicate or artificial coverage patterns introduced.
- Clean working tree.
