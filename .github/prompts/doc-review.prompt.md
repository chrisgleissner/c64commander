---
description: Perform a doc-only review directly, create the next numbered doc review report, and carry unresolved documentation issues forward without a separate planning step.
---

# Documentation Review

Perform a documentation-only review for this repository.

This prompt performs review only.

Do NOT remediate findings.

Do NOT edit documentation, screenshots, product code, tests, build scripts, or prior review reports.

Doc review reports are stored under:

`docs/research/`

in folders named:

`doc-review-<number>`

## Review Discovery

Your first tasks are to:

1. Enumerate folders matching `docs/research/doc-review-*`.
2. Determine the highest numeric doc review folder as the previous doc review, if one exists.
3. Compute the next doc review number as `highest + 1`, or `1` if no prior doc review exists.
4. Create:

`docs/research/doc-review-<next>/`

5. Treat the previous doc review folder as an input source for:

- `doc-review-<highest>.md`
- `remediation-log.md`
- `carry-forward.md`

when those files exist.

## Required Outputs

Create:

- `docs/research/doc-review-<next>/doc-review-<next>.md`
- `docs/research/doc-review-<next>/carry-forward.md`

## Review Scope

Review only documentation surfaces such as:

- `README.md`
- `docs/`
- `docs/`
- in-app doc or help copy when it materially affects documented behavior
- screenshots under `docs/img/`

Check for:

- stale or contradictory guidance
- undocumented behavior that users or contributors rely on
- missing setup, validation, release, or troubleshooting steps
- screenshots that no longer match the documented UI
- drift between doc and the current implementation

Every finding must:

- reference the exact documentation path involved
- reference implementation evidence when claiming drift
- distinguish confirmed issues from open questions

## Carry-Forward Requirements

Create `docs/research/doc-review-<next>/carry-forward.md`.

Include for each item:

- Item ID
- Source doc review
- Status (`open`, `blocked`, `deferred`, or `resolved`)
- Summary
- Evidence or affected paths
- Next action

Inherited documentation issues must be copied forward with updated status rather than silently dropped.

## Output

Provide a completion summary including:

- the new doc review folder created
- the main documentation findings
- inherited doc issues that remained open
- inherited doc issues verified as resolved
- the new carry-forward file path
