---
description: Execute a repository production audit
---

ROLE

Execute the production hardening audit for this repository.

Read:

PLANS.md

Rules:

- Work through phases sequentially
- Tick tasks as completed
- Base conclusions only on repository evidence
- Avoid speculation

During investigation focus on:

- UI event propagation
- device communication
- connection liveness
- diagnostics and tracing
- documentation consistency
- CI/CD enforcement
- test coverage completeness

Maintainer signals to investigate:

- slider propagation during drag
- connection freshness display
- background health probes

After all tasks are complete, produce:

doc/research/review-7/review-7.md

Include:

Executive Summary
Architecture Analysis
Subsystem Deep Dives
Documentation Consistency Audit
Test Coverage Evaluation
CI/CD Evaluation
Security Evaluation
Production Risk Assessment
Required Fixes
Recommendations
Final Verdict
