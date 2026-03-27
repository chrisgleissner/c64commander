---
name: doc-audit
description: Use when auditing README, docs/**, docs/, or in-app documentation for stale guidance, contradictions, undocumented behavior, or screenshot drift in C64 Commander.
argument-hint: (optional) scope such as README, diagnostics, platform docs, or screenshots
user-invocable: true
disable-model-invocation: true
---

# Documentation Audit Skill

## Purpose

Compare implementation against documentation and identify drift that affects contributors or end users.

## Workflow

1. Inventory the documentation surface in scope.
2. Compare documentation claims against the current repository implementation.
3. Classify findings as stale, missing, contradictory, or unverifiable.
4. If the task asks for fixes, update the smallest accurate set of documents.
5. Regenerate screenshots only when the visible documented UI actually changed.

## Check

Compare implementation against documentation.

Check:

- README
- docs/***\*
- docs/\*\*
- in-app docs

Identify:

- undocumented features
- stale documentation
- contradictions between docs and implementation
- screenshots that no longer match the documented UI

## Output

Report:

- affected documents
- confirmed discrepancies
- any screenshot updates required
- unresolved questions or evidence gaps
