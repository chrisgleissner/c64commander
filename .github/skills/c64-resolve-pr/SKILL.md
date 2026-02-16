---
name: c64-resolve-pr
description: Fetch all unresolved pull request review comments for the current branch, validate them, implement confirmed fixes, commit and push changes, and resolve each conversation using the GitHub CLI.
argument-hint: (optional) Additional constraints or scope instructions
user-invokable: true
disable-model-invocation: true
---

# Skill: PR Review Resolution Workflow

## Purpose

This skill processes all unresolved review comments on the current pull request and brings the PR to a fully resolved state.

It performs:

- Comment retrieval via `gh`
- Technical validation of each comment
- Implementation of confirmed fixes
- Atomic commits and push
- Review reply and conversation resolution via `gh`

This skill is designed for structured, production-grade resolution workflows.

---

## Preconditions

- The current branch has exactly one open pull request.
- `gh` CLI is installed and authenticated.
- The working tree is clean.
- Tests can be executed locally.

If any precondition fails, stop and report.

---

## Execution Workflow

### Step 1: Identify the Current Pull Request

Use:

- `gh pr view --json number,headRefName,state`
- Confirm:
  - PR exists
  - State is open
  - Head branch matches current branch

---

### Step 2: Fetch All Review Threads

Retrieve:

- All review comments
- All review threads
- Only unresolved conversations

Use:

- `gh api`
- Or `gh pr view --json reviews,comments`

Build a structured list of unresolved threads.

---

### Step 3: Process Each Unresolved Thread

For each thread:

1. Read the full comment context.
2. Analyze the referenced code.
3. Assume the reviewer is correct by default.
4. Perform codebase search and reasoning before deciding.

---

## Decision Logic

### Case A - Issue Is Valid

If the comment identifies a real issue:

- Implement the minimal, correct, production-grade fix.
- Maintain architectural consistency.
- Avoid speculative refactors.
- Add or update tests if required.
- Ensure tests pass.

Then:

- Create an atomic commit specific to that issue.
- Push to the current branch.
- Post a reply to the review thread explaining the fix.
- Resolve the conversation using `gh`.

---

### Case B - Issue Is Not Valid

If after careful analysis the issue is not valid:

- Do not change the code.
- Prepare a technical explanation:
  - Reference exact code
  - Provide reasoning
  - Be concise and evidence-based
- Post the explanation using `gh`.
- Resolve the thread.

---

## Commit Rules

- One logical issue per commit.
- Clear commit message referencing the PR number.
- No batching of unrelated fixes.
- Ensure working tree is clean after each push.

---

## Safety Constraints

- Do not rewrite git history.
- Do not force push.
- Do not modify unrelated files.
- Do not skip any unresolved thread.

---

## Completion Criteria

The workflow is complete only when:

- All review threads are resolved.
- `gh pr view` reports zero unresolved conversations.
- All changes are committed and pushed.
- The working tree is clean.
- Tests pass.

Continue until all threads are processed.

Do not stop early.
