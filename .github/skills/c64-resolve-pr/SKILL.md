name: c64-resolve-pr
description: Use when triaging unresolved pull request review comments on the current branch, validating them, and preparing or applying confirmed fixes; only perform remote GitHub mutations when explicitly authorized.
argument-hint: (optional) Additional constraints or scope instructions
user-invocable: true
disable-model-invocation: true

---

# Skill: PR Review Resolution Workflow

## Purpose

This skill processes all unresolved review comments on the current pull request and drives them to a validated local resolution state, with remote GitHub resolution performed only when explicitly authorized.

It performs:

- Comment retrieval via `gh`
- Technical validation of each comment
- Implementation of confirmed fixes
- Optional commit, push, review reply, and conversation resolution when the invoking task explicitly authorizes remote GitHub mutations

This skill is designed for structured, production-grade resolution workflows.

---

## Preconditions

- The current branch has exactly one open pull request.
- `gh` CLI is installed and authenticated.
- Record the current changed-file baseline and avoid unrelated edits.
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

- If the task explicitly authorizes remote mutations:
  - Create an atomic commit specific to that issue.
  - Push to the current branch.
  - Post a reply to the review thread explaining the fix.
  - Resolve the conversation using `gh`.
- Otherwise:
  - Leave changes local.
  - Prepare the exact reply text and resolution rationale for the user.

---

### Case B - Issue Is Not Valid

If after careful analysis the issue is not valid:

- Do not change the code.
- Prepare a technical explanation:
  - Reference exact code
  - Provide reasoning
  - Be concise and evidence-based
- If the task explicitly authorizes remote mutations, post the explanation using `gh` and resolve the thread.
- Otherwise, prepare the exact response text for the user without mutating GitHub state.

---

## Commit Rules

- Only apply when the task explicitly authorizes commits and pushes.
- One logical issue per commit.
- Clear commit message referencing the PR number.
- No batching of unrelated fixes.
- Preserve unrelated worktree changes.

---

## Safety Constraints

- Do not rewrite git history.
- Do not force push.
- Do not modify unrelated files.
- Do not skip any unresolved thread.

---

## Completion Criteria

The workflow is complete only when:

- Every unresolved thread has been analyzed.
- Confirmed fixes are implemented and validated locally.
- If remote GitHub mutations were explicitly authorized, all review threads are resolved and `gh pr view` reports zero unresolved conversations.
- Tests pass.
- Unrelated worktree changes remain untouched.

Continue until all threads are processed.

Do not stop early.
