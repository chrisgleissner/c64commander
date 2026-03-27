---
description: Remediate the latest production audit findings while keeping remediation history and unresolved carry-forward items ready for the next review cycle.
---

# Production Audit Remediation

Remediate issues identified in the **most recent production audit**.

Audit reports are stored under:

docs/research/

in folders named:

review-<number>

Examples:

docs/research/review-5/
docs/research/review-6/
docs/research/review-7/

The audit report itself must **never be modified**.

All remediation results must be recorded in a separate remediation log and reflected in the carry-forward file.

---

# Review Discovery

First determine the latest review.

1. Enumerate folders matching `docs/research/review-*`.
2. Extract the numeric suffix from each folder name.
3. Determine the **highest numeric review number**.
4. Treat this folder as the **source review folder**.

Example:

docs/research/review-7/

The audit report is located at:

docs/research/review-<highest>/review-<highest>.md

---

## Remediation Artifacts

Do NOT create a new review folder.

Instead create or update the remediation log:

docs/research/review-<highest>/remediation-log.md

This file records **all fixes implemented after the audit**.

If the file already exists, append a new remediation entry.

Also create or update:

docs/research/review-<highest>/carry-forward.md

This file is the durable list of unresolved, blocked, deferred, and resolved items for the current review cycle.

---

## Preparation

Read the source audit report.

Read the existing `carry-forward.md` and `remediation-log.md` when present.

Identify actionable items from the following sections:

- Required Fixes
- Recommendations
- Production Risk Assessment
- Security Evaluation
- CI/CD Evaluation
- Documentation Consistency Audit
- Test Coverage Evaluation

Extract concrete remediation tasks.

Do not assume the audit is perfectly accurate.

Confirm each finding against the repository before implementing changes.

If the carry-forward file already contains unresolved items, treat them as mandatory inputs even when they are not repeated verbatim in the latest chat request.

---

## Fix Strategy

For each confirmed issue:

1. Inspect the referenced files.
2. Verify the problem exists.
3. Implement the smallest safe fix.
4. Maintain architectural consistency.
5. Update tests if coverage gaps exist.
6. Update documentation when behavior changes.

Avoid introducing regressions.

Prefer minimal, well-scoped fixes.

---

## Carry-Forward Rules

`carry-forward.md` must survive every remediation pass.

For every item attempted in this run:

- keep its stable item ID when one already exists
- update its status to `resolved`, `open`, `blocked`, or `deferred`
- record concise evidence of the current state
- record the next action when the item is not resolved

If you discover a new issue while fixing an existing finding, add it to `carry-forward.md` instead of burying it in prose.

Never remove an unresolved item without explicitly marking how it was closed or why it no longer applies.

If all items are resolved, leave `carry-forward.md` in place and state that no open items remain.

---

## Areas That May Require Fixes

Typical areas include:

- runtime interaction behavior
- device communication logic
- connection liveness or probes
- diagnostics and tracing
- CI/CD enforcement
- test coverage gaps
- documentation inconsistencies
- security weaknesses

Prioritize issues listed under **Required Fixes**.

---

## Implementation Process

Execute remediation in this order:

1. Determine the latest review folder.
2. Read the audit report.
3. Extract remediation tasks from both the review report and any existing open carry-forward items.
4. Implement fixes sequentially.
5. Update tests where coverage is missing.
6. Update documentation where necessary.
7. Update `remediation-log.md` and `carry-forward.md` before finishing.

If multiple issues affect the same subsystem, consolidate fixes coherently.

---

## Documentation Updates

If documentation drift is identified:

Update:

- README.md
- relevant files under `docs/`
- in-app documentation pages where applicable

Ensure documentation matches the current implementation.

---

## Testing Expectations

When implementing fixes:

- preserve existing tests
- add tests where coverage gaps exist
- prefer deterministic tests

Example areas:

- slider propagation behavior
- connection freshness logic
- device communication flows

---

## Output

Append a remediation entry to:

docs/research/review-<highest>/remediation-log.md

Each entry must contain:

- Timestamp
- Issues addressed
- Fixes implemented
- Files modified
- Tests added or updated
- Documentation changes
- Remaining unresolved issues

Update `docs/research/review-<highest>/carry-forward.md` in the same run.

Remaining unresolved issues must be clearly listed there so future remediation passes and the next review cycle can inherit them automatically.

---

## Goal

The repository should be left in a **more production-ready state** than before remediation while maintaining a clear historical audit trail.
