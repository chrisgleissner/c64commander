---
description: Remediate issues from the latest production audit and create a new review
---

# Production Audit Remediation

Remediate issues identified in the **most recent production audit** and record the remediation results in a **new review folder**.

Audit reports are stored under:

doc/research/

in folders named:

review-<number>

Examples:

doc/research/review-5/
doc/research/review-6/
doc/research/review-7/

---

# Review Discovery

First determine the latest review.

1. Enumerate folders matching `doc/research/review-*`.
2. Extract the numeric suffix from each folder name.
3. Determine the **highest numeric review number**.
4. Treat this as the **source review**.

The source audit report is located at:

doc/research/review-<highest>/review-<highest>.md

---

# Create New Review Folder

Create a new review folder representing the remediation pass.

The new review number must be:

highest + 1

Example:

latest review = review-7
new review = review-8

Create:

doc/research/review-<highest+1>/

The remediation report must be written to:

doc/research/review-<highest+1>/review-<highest+1>.md

---

# Preparation

Read the source audit report.

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
Confirm each finding against the repository before implementing fixes.

---

# Fix Strategy

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

# Areas That May Require Fixes

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

# Implementation Process

Execute remediation in this order:

1. Determine the latest review folder.
2. Create the next review folder.
3. Parse the source review document.
4. Build a remediation checklist.
5. Implement fixes sequentially.
6. Update tests where coverage is missing.
7. Update documentation where necessary.

If multiple issues affect the same subsystem, consolidate fixes coherently.

---

# Documentation Updates

If documentation drift is identified:

Update:

- README.md
- relevant files under `doc/`
- in-app documentation pages where applicable

Ensure documentation matches actual implementation.

---

# Testing Expectations

When implementing fixes:

- preserve existing tests
- add tests where coverage gaps exist
- prefer deterministic tests

Example areas:

- slider propagation behavior
- connection freshness logic
- device communication flows

---

# Output

Write a remediation report to:

doc/research/review-<highest+1>/review-<highest+1>.md

Include:

- Summary of issues addressed
- Fixes implemented
- Files modified
- Tests added or updated
- Documentation changes
- Remaining unresolved issues (if any)

The repository should be left in a **more production-ready state** than before remediation.
