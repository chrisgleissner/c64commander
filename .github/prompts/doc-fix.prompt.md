---
description: Fix confirmed issues from the latest doc review while preserving remediation history and unresolved documentation items for the next doc review cycle.
---

# Documentation Remediation

Remediate issues identified in the most recent documentation review.

Doc review reports are stored under:

`doc/research/`

in folders named:

`doc-review-<number>`

The doc review report itself must never be modified.

All remediation results must be recorded in a separate remediation log and reflected in the carry-forward file.

## Review Discovery

1. Enumerate folders matching `doc/research/doc-review-*`.
2. Extract the numeric suffix from each folder name.
3. Determine the highest numeric doc review number.
4. Treat this folder as the source doc review folder.

The doc review report is located at:

`doc/research/doc-review-<highest>/doc-review-<highest>.md`

## Remediation Artifacts

Do NOT create a new doc review folder.

Instead create or update:

- `doc/research/doc-review-<highest>/remediation-log.md`
- `doc/research/doc-review-<highest>/carry-forward.md`

## Preparation

Read the source doc review report.

Read the existing `carry-forward.md` and `remediation-log.md` when present.

Identify actionable items involving:

- stale or contradictory doc
- missing instructions
- screenshot drift
- inconsistent terminology
- missing contributor or user guidance

Confirm each finding against the repository before implementing changes.

If the carry-forward file already contains unresolved items, treat them as mandatory inputs.

## Fix Strategy

For each confirmed issue:

1. Inspect the referenced doc and any implementation evidence.
2. Verify the problem exists.
3. Implement the smallest accurate documentation fix.
4. Update screenshots only when the documented visible UI has actually changed.
5. Preserve repository terminology and conventions.

## Carry-Forward Rules

For every item attempted in this run:

- keep its stable item ID when one already exists
- update its status to `resolved`, `open`, `blocked`, or `deferred`
- record concise evidence of the current state
- record the next action when the item is not resolved

If all items are resolved, leave `carry-forward.md` in place and state that no open items remain.

## Output

Append a remediation entry to:

`doc/research/doc-review-<highest>/remediation-log.md`

Each entry must contain:

- Timestamp
- Issues addressed
- Fixes implemented
- Files modified
- Screenshot changes
- Remaining unresolved issues

Update `doc/research/doc-review-<highest>/carry-forward.md` in the same run.
