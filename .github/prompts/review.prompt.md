---
description: Perform a production review directly, create the next numbered review report, and carry unresolved issues forward without requiring a separate planning or verify step.
---

# Production Review

Perform a production hardening review for this repository.

This prompt performs review only.

Do NOT remediate findings.

Do NOT edit product code, tests, build scripts, or prior review reports.

Audit reports are stored under:

`doc/research/`

in folders named:

`review-<number>`

## Review Discovery

Your first tasks are to:

1. Enumerate folders matching `doc/research/review-*`.
2. Determine the highest numeric review folder as the previous review, if one exists.
3. Compute the next review number as `highest + 1`, or `1` if no prior review exists.
4. Create:

`doc/research/review-<next>/`

5. Treat the previous review folder as an input source for:

- `review-<highest>.md`
- `remediation-log.md`
- `carry-forward.md`

when those files exist.

## Required Outputs

Create:

- `doc/research/review-<next>/review-<next>.md`
- `doc/research/review-<next>/carry-forward.md`

The new review report must be the review deliverable for this cycle.

The new carry-forward file must contain every inherited or newly discovered issue that still requires later remediation.

## Review Scope

Review the repository for:

- repository structure and subsystem boundaries
- runtime interaction and state flow risks
- device communication and connection management risks
- diagnostics and observability gaps
- test coverage weaknesses
- CI/CD and release hardening issues
- security and reliability concerns
- documentation drift that materially affects production readiness

Use previous review artifacts when available, but verify claims against the current repository state rather than trusting prior reports blindly.

## Report Requirements

The review report should contain evidence-backed findings for sections like these when they apply:

- Scope And Method
- Inherited Open Items
- Required Fixes
- Recommendations
- Production Risk Assessment
- Security Evaluation
- CI/CD Evaluation
- Documentation Consistency Audit
- Test Coverage Evaluation

Every finding must:

- be verified against the repository state
- reference concrete file paths, commands, tests, or artifacts as evidence
- distinguish confirmed findings from uncertainty or follow-up investigation

Do not make speculative claims.

## Carry-Forward Requirements

Create `doc/research/review-<next>/carry-forward.md`.

Include for each item:

- Item ID
- Source review
- Status (`open`, `blocked`, `deferred`, or `resolved`)
- Summary
- Evidence or affected paths
- Next action

Inherited issues must be copied forward with updated status rather than silently dropped.

New findings that require remediation start as `open`.

## Output

Provide a completion summary including:

- the new review folder created
- the main findings
- inherited items that remained open
- inherited items verified as resolved
- the new carry-forward file path

The goal is to produce the next review report, not to fix it.
