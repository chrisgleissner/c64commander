name: c64-parity
description: Use when auditing or enforcing feature and behavior parity across Android, iOS, and Web routes in C64 Commander.
argument-hint: (optional) specific feature or module
user-invocable: true
disable-model-invocation: true

---

# Skill: C64 Platform Parity Audit

## Purpose

Ensure functional parity across:

- Android
- iOS
- Web

Android remains the reference implementation.

---

## Execution Workflow

Before changing anything, record the current changed-file baseline and avoid unrelated edits.

### Step 1 - Inventory Features

Identify:

- Import flows
- Playlist management
- Disk mounting
- HVSC ingestion
- Share-target ingestion
- FTP browsing
- Configuration management

---

### Step 2 - Detect Platform Divergence

For each feature:

- Compare platform-specific code paths.
- Identify Android-only logic.
- Identify iOS-only conditions.
- Identify Web-only fallbacks.

Document differences.

---

### Step 3 - Classify Differences

Each difference must be categorized as:

1. Intentional platform constraint
2. Missing implementation
3. Behavioral inconsistency
4. UI-only variance

---

### Step 4 - Remediation

If missing or inconsistent:

- Implement minimal parity correction.
- Add tests where behavior differs.
- Avoid duplicating tests for identical logic.
- Preserve Android as baseline.

---

## Constraints

- Do not introduce speculative features.
- Do not refactor architecture unless required.
- Do not degrade Android route stability.
- Maintain deterministic Maestro and Playwright behavior.

---

## Completion Criteria

- All core features aligned.
- No unintended platform drift.
- Platform-specific behavior explicitly justified.
- Tests updated where required.
- Unrelated worktree changes remain untouched.
