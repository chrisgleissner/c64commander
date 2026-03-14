---
description: Fix issues identified in the latest production audit
---

# Production Audit Remediation

Implement fixes for issues identified in the **most recent production audit**.

Audit reports are stored under:

doc/research/

in folders named:

review-<number>

Example:

doc/research/review-5/
doc/research/review-6/
doc/research/review-7/

Your first task is to:

1. Enumerate folders matching `doc/research/review-*`
2. Determine the **highest numeric review folder**
3. Use the report located at:

doc/research/review-<highest>/review-<highest>.md

This is the audit report you must remediate.

---

# Preparation

Read the audit report.

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

---

# Fix Strategy

For each confirmed issue:

1. Inspect the referenced files.
2. Reproduce or verify the problem.
3. Implement the smallest safe fix.
4. Maintain architectural consistency.
5. Update tests if coverage gaps exist.
6. Update documentation when behavior changes.

Avoid introducing regressions.

Prefer minimal, well-scoped changes.

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
2. Parse the review document.
3. Build a remediation checklist.
4. Implement fixes sequentially.
5. Update tests where coverage is missing.
6. Update documentation when necessary.

If multiple issues affect the same subsystem, consolidate fixes coherently.

---

# Documentation Updates

If documentation drift is identified:

Update:

- README.md
- relevant files in `doc/`
- in-app documentation pages if applicable

Ensure documentation reflects the current implementation.

---

# Testing Expectations

When implementing fixes:

- preserve existing tests
- add tests where the audit identified coverage gaps
- prefer deterministic tests

Examples:

- slider propagation behavior
- connection freshness logic
- device communication flows

---

# Output

Provide a summary including:

1. Fixes implemented
2. Files modified
3. Tests added or updated
4. Documentation changes
5. Any unresolved issues

The goal is to leave the repository in a **more production-ready state than before remediation**.
