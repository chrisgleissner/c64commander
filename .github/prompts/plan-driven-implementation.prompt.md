---
description: Plan-driven implementation with deterministic convergence and incremental plan extension
---

# Plan-Driven Implementation

Deliver a complete, production-ready implementation using a **plan-first, execution-driven workflow**.

This is an execution prompt, not an analysis prompt.

Do not stop after planning.
Do not stop after partial implementation.
Carry the work through to full completion unless genuinely blocked by an external constraint.

---

# Core Objective

You must:

1. Extend the existing execution plan (PLANS.md)
2. Continue implementation from the current state
3. Execute all remaining tasks to completion
4. Ensure:
   - all tests pass
   - coverage ≥ 91%
   - no partial or placeholder logic remains

---

# Non-Negotiable Rules

- This is an EXECUTION task
- You must act as a deterministic execution engine, not a planner
- You must not stall, summarize, or defer work
- You must not leave tasks partially complete
- You must not overwrite existing valid plans
- You must not stop until convergence criteria are satisfied

---

# Phase 1 — Plan Reconciliation and Extension

You must treat `PLANS.md` as the authoritative execution plan.

## If PLANS.md exists:

You MUST:

1. Read the entire file
2. Identify:
   - completed tasks
   - in-progress tasks
   - remaining tasks
   - gaps or missing work
3. Validate whether the plan is still correct

Then:

- DO NOT rewrite or delete existing content
- ADD a new section at the end:

## Plan Extension — <timestamp>

This section must include:

- newly identified tasks
- corrections to previous assumptions
- missing validation steps
- any reordered or refined tasks (with justification)

If earlier tasks are incorrect, mark them clearly as:

- SUPERSEDED
- or UPDATED (with explanation)

## If PLANS.md does NOT exist:

Create it using the full plan structure:

- task breakdown
- ordering
- dependencies
- validation per task
- DONE criteria
- coverage strategy

---

After updating PLANS.md:
YOU MUST IMMEDIATELY START IMPLEMENTATION

---

# Phase 2 — Execution Loop

You must execute tasks ONE AT A TIME.

Tasks must be selected in this priority order:

1. Incomplete tasks from existing plan
2. Tasks from latest Plan Extension section

---

For each task, follow this exact loop:

## Step 1 — Assert

- Verify current code state
- Identify the exact gap for this task

## Step 2 — Implement

- Apply the smallest correct change
- Do not refactor unrelated areas

## Step 3 — Test

- Add or update tests
- Cover edge cases and regressions

## Step 4 — Validate

Run required validation:

- build
- tests
- lint (if applicable)

## Step 5 — Coverage

- Ensure new logic is covered
- Increase coverage where needed

## Step 6 — Verify

- Confirm task meets DONE criteria

## Step 7 — Record

Append to `WORKLOG.md`:

- timestamp (UTC)
- task name
- action taken
- result
- next step

## Step 8 — Continue

Move to the next task immediately

---

# Execution Constraints

## Single Task Focus

- Only one task may be active at a time
- Do not partially complete multiple tasks

## No Stalling

If you are not modifying code or running validation, you are stalling.

Immediately continue execution.

## No Plan Reset

- Never delete or overwrite PLANS.md
- Only extend or annotate it

## Minimal Changes

- Prefer smallest correct fix
- Avoid unnecessary refactors

## Preserve Stability

- Do not break existing functionality
- Do not remove valid tests

## Explicit Errors

- Never swallow exceptions
- All failures must be visible and testable

---

# Validation Requirements

You must run:

- build
- unit tests
- integration tests (if applicable)
- coverage checks

If any validation fails:

- fix immediately
- do not proceed

---

# Coverage Requirement

You must enforce:

- coverage ≥ 91%

If below threshold:

1. Identify uncovered code
2. Add meaningful tests
3. Re-run coverage

Repeat until threshold is met.

---

# Worklog Requirement

You must maintain `WORKLOG.md`.

Each entry must include:

- timestamp (UTC)
- task
- action
- result
- next step

Update continuously throughout execution.

---

# Convergence Criteria

Stop only when all of the following are true:

- all tasks (including extensions) are DONE
- no active or incomplete tasks remain
- all tests pass
- coverage ≥ 91%
- build succeeds
- no TODOs or placeholders remain
- PLANS.md reflects final completed state
- WORKLOG.md is complete and accurate

If any item above is false, continue working.

---

# Failure Handling

If blocked:

1. Attempt alternative implementation
2. Reduce to minimal viable fix
3. Continue execution

Mark BLOCKED only if:

- external dependency
- cannot be resolved within the repository

If BLOCKED:

- document clearly in PLANS.md
- include reason and evidence

---

# Anti-Patterns (Do Not Do)

Do not:

- overwrite PLANS.md
- remove historical plan entries
- skip incomplete tasks
- leave ambiguous task states

Do not end your run with:

- "Remaining work"
- "Next steps"
- "Plan updated"
- "Partial implementation complete"

If any work remains, you are not done.

---

# Completion Summary

When fully complete, provide:

- summary of implemented tasks
- validation results
- coverage result
- confirmation that all criteria are satisfied
