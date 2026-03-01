# Execution Prompt: Consolidate Production Readiness Reviews and Execute Phase 1

## ROLE

You are a senior release engineer. You will:

1. Merge two production readiness reviews into one consolidated document.
2. Produce a phased rollout plan.
3. Execute Phase 1 of that plan.

No deviation from this sequence. No shortcuts.

---

## INPUTS

| Input | Path | PRA-ID range | Severity terms used | Effort terms used | Issue count |
|-------|------|-------------|---------------------|-------------------|-------------|
| Review A | `doc/research/review-5/review-5a.md` | PRA-001 – PRA-023 | Blocker, Critical, Major, Minor | S, M, L | 23 |
| Review B | `doc/research/review-5/review-5b.md` | PRA-001 – PRA-033 | Critical, Major, Minor, Trivial | S, M, L | 33 |

Both reviews target the same commit (`cf7d0826`), same date (2026-02-28), same repository.

**Critical fact: PRA-ID ranges collide.** PRA-001 in Review A ("Repository-local signing secret pattern", Blocker) is an entirely different issue than PRA-001 in Review B ("Google Play upload action not SHA-pinned", Major). Every PRA-ID must be treated as scoped to its source document. Never assume that matching PRA numbers refer to the same issue.

---

## PHASE ZERO: CONSOLIDATION (no code changes)

### Output

Create exactly one file:

```
doc/research/review-5/review-5.md
```

Do not modify any source code, test, CI config, manifest, lockfile, or build script during this phase.

### Step 1: Build a cross-reference matrix

Read both documents end-to-end. For every PRA-* entry in each document, extract:

- Source (A or B)
- PRA-ID
- Title
- Verbatim severity
- Verbatim effort
- Verbatim likelihood
- Verbatim user impact
- Verbatim operational impact
- Root cause summary (one sentence)
- Primary evidence references

Produce a working cross-reference table (not included in the final output file—this is an intermediate artifact for your own reasoning).

### Step 2: Semantic deduplication

Compare every pair (one from A, one from B) by root cause. Classify each pair as:

| Classification | Definition | Action |
|----------------|------------|--------|
| **Exact duplicate** | Same root cause, same evidence paths, same scope | Merge into one ISSUE. Retain both PRA-IDs as metadata. Use the more detailed description. |
| **Partial overlap** | Same theme or root cause but different scope or different evidence | Merge into one ISSUE if the scopes are subsets of one another. Otherwise, keep as separate ISSUEs with a `Dependencies` or `Notes on Reconciliation` cross-reference. |
| **Unique** | Appears in only one document | Carry forward as-is into a new ISSUE. |
| **Conflicting recommendation** | Same root problem but different fix strategies or contradictory severity/effort ratings | Merge into one ISSUE. Document the conflict in `Notes on Reconciliation`. Choose the more conservative (higher) severity. For effort, choose the higher estimate unless evidence justifies the lower one—document the rationale. |

Known ID collisions to resolve (non-exhaustive—verify all 56 entries):

| Review A PRA-ID | Review A Title | Review B PRA-ID | Review B Title | Expected classification |
|-----------------|---------------|-----------------|---------------|------------------------|
| PRA-001 (A) | Repository-local signing secret pattern | — | No direct equivalent in B | Unique to A |
| PRA-002 (A) | Android cleartext globally enabled | PRA-007 (B) | Android cleartext globally enabled | Exact or partial overlap—verify scope and severity |
| PRA-003 (A) | Plain FTP transport | — | No direct equivalent in B (FTP covered tangentially in PRA-009 B as basic-ftp CVE) | Likely unique to A—transport-layer concern vs dependency CVE |
| PRA-004 (A) | HTTP X-Password credential path | — | No direct equivalent in B (mentioned in narrative but no distinct PRA) | Unique to A |
| PRA-005 (A) | Android backup policy gap | PRA-018 (B) | No Android backup rules | Exact or partial overlap |
| PRA-006 (A) | Android diagnostics broadcast leakage | — | No direct equivalent in B | Unique to A |
| PRA-007 (A) | CI token permissions too broad | PRA-003 (B) | Workflow permissions too broad on PRs | Exact or partial overlap—verify severity conflict (A: Major, B: Minor) |
| PRA-008 (A) | Actions pinned by mutable tags | PRA-001 (B) | Google Play upload not SHA-pinned | Partial overlap—A is general, B is specific to one action |
| PRA-009 (A) | curl\|bash Maestro install in CI | PRA-002 (B) | Maestro CLI curl pipe install | Exact duplicate |
| PRA-010 (A) | Dependabot not configured | PRA-004 (B) | No dependency update automation | Exact duplicate |
| PRA-011 (A) | Critical basic-ftp CVE | PRA-009 (B) | Critical basic-ftp CVE | Exact duplicate |
| PRA-012 (A) | iOS deployment/version mismatch | PRA-021 (B) | iOS deployment target mismatch; PRA-023 (B) | iOS version not CI-managed | Partial overlap—A combines two concerns that B splits |
| PRA-013 (A) | Android release minification disabled | PRA-017 (B) | Android release minification off | Exact duplicate—verify severity conflict (A: Major, B: Major) and effort conflict (A: M, B: S) |
| PRA-014 (A) | Android ABI packaging includes emulator ABIs | — | No equivalent in B | Unique to A |
| PRA-015 (A) | Web no-store caching everywhere | PRA-008 (B) | Web Cache-Control no-store on all | Exact duplicate—verify severity conflict (A: Major, B: Minor) |
| PRA-016 (A) | Large first-load web bundle | — | No equivalent in B (mentioned in narrative) | Unique to A |
| PRA-017 (A) | Browser zoom disabled | — | No equivalent in B (mentioned in narrative, touch targets PRA-016 B is related but distinct) | Unique to A |
| PRA-018 (A) | Localization readiness gap | PRA-015 (B) | No localization infrastructure | Exact duplicate—verify severity conflict (A: Major, B: Minor) |
| PRA-019 (A) | Data reset fallback without migration | PRA-012 (B) | No incremental data migration | Exact duplicate |
| PRA-020 (A) | Coverage policy mismatch | — | No equivalent in B | Unique to A |
| PRA-021 (A) | License metadata mismatch | PRA-029 (B) | README license badge mismatch | Exact duplicate—verify severity conflict (A: Minor, B: Major) |
| PRA-022 (A) | Android build verification limitation | — | No equivalent in B (B succeeded at building Android) | Unique to A—may be N/A given B's evidence |
| PRA-023 (A) | iOS local build limitation on Linux | — | No equivalent in B | Unique to A |
| — | — | PRA-005 (B) | No CODEOWNERS file | Unique to B |
| — | — | PRA-006 (B) | No web server security headers | Unique to B |
| — | — | PRA-010 (B) | Rollup path traversal (dev dep) | Unique to B |
| — | — | PRA-011 (B) | Gradle and AGP significantly outdated | Unique to B |
| — | — | PRA-013 (B) | No remote crash reporting | Unique to B |
| — | — | PRA-014 (B) | No automated a11y testing | Unique to B |
| — | — | PRA-016 (B) | Touch targets below 44px | Unique to B |
| — | — | PRA-019 (B) | Android JVM tests fail on Java 25 | Unique to B |
| — | — | PRA-020 (B) | Deprecated MediaSession APIs | Unique to B |
| — | — | PRA-022 (B) | No iOS audio background mode | Unique to B |
| — | — | PRA-024 (B) | NativePlugins.swift >1000 lines | Unique to B |
| — | — | PRA-025 (B) | No iOS entitlements file | Unique to B |
| — | — | PRA-026 (B) | No service worker for PWA | Unique to B |
| — | — | PRA-027 (B) | Incomplete PWA manifest | Unique to B |
| — | — | PRA-028 (B) | Web server single 843-line file | Unique to B |
| — | — | PRA-030 (B) | No SPDX license identifier | Unique to B |
| — | — | PRA-031 (B) | No Commodore trademark disclaimer | Unique to B |
| — | — | PRA-032 (B) | No iOS native unit tests | Unique to B |
| — | — | PRA-033 (B) | E2E tests skip native runtime | Unique to B |

This table is a starting point. You must verify every row by reading the full issue entry in both documents. If your analysis disagrees with the "Expected classification" column, document why and use your determination.

### Step 3: Normalize severity

Map every issue to exactly one severity level using this unified taxonomy:

| Unified Severity | Weight | Mapping from Review A | Mapping from Review B |
|------------------|--------|-----------------------|-----------------------|
| Blocker | 5 | Blocker | — (not used in B; if a B issue warrants Blocker based on evidence, promote and document) |
| Critical | 4 | Critical | Critical |
| Major | 3 | Major | Major |
| Minor | 2 | Minor | Minor |
| Trivial | 1 | — (not used in A; if an A issue warrants Trivial based on evidence, demote and document) | Trivial |

When two sources assign **different severities** to the same root problem:

1. Default to the **higher** severity.
2. Exception: if the lower-severity source provides concrete evidence that the higher rating is disproportionate (e.g., B rates Android cleartext as Minor because the hardware only supports HTTP, while A rates it Critical assuming general cleartext exposure), document both perspectives and choose the one supported by stronger evidence. Explain the decision.

### Step 4: Normalize effort

Map every issue to exactly one effort level:

| Unified Effort | Weight | Definition |
|----------------|--------|------------|
| XS | 1 | < 1 hour, config-only or one-line change |
| S | 2 | ≤ 0.5 day |
| M | 3 | 0.5–2 days |
| L | 4 | 2–5 days |
| XL | 5 | > 5 days |

When two sources assign different efforts to the same issue, choose the higher unless the lower-effort source provides a specific implementation path that credibly achieves the fix in less time. Document the decision.

### Step 5: Normalize likelihood and impact

- Retain `Likelihood` (High / Medium / Low) and `Impact` (High = 3, Medium = 2, Low = 1) from source entries.
- If only one source provides Likelihood or Impact for a merged issue, use that value.
- If neither source provides an explicit value, infer it based on the evidence and mark it as `(inferred)`.
- If both sources provide conflicting values, use the higher value and note the conflict.

### Step 6: Assign stable ISSUE-IDs

Assign new sequential identifiers: `ISSUE-001`, `ISSUE-002`, …, `ISSUE-NNN`.

Rules:
- IDs are assigned in descending priority score order (computed in Step 7).
- Original PRA-IDs are preserved **only** as metadata (`Original IDs` field).
- No ISSUE-ID may be reused or skipped.

### Step 7: Compute priority scores

For every issue, compute:

```
Priority Score = (Severity Weight × Impact Weight) ÷ Effort Weight
```

Where:
- Severity Weight: Blocker=5, Critical=4, Major=3, Minor=2, Trivial=1
- Impact Weight: High=3, Medium=2, Low=1
- Effort Weight: XS=1, S=2, M=3, L=4, XL=5

Sort all issues by Priority Score descending. Break ties by Severity descending, then Effort ascending.

### Step 8: Assign categories

Every issue belongs to **exactly one** primary category from this list:

1. Security
2. Supply Chain
3. CI/CD
4. Android
5. iOS
6. Web
7. Data Integrity
8. Performance
9. Observability
10. UX & Accessibility
11. Testing
12. Legal & Licensing
13. Architecture & Maintainability

Cross-cutting concerns must be handled via `Dependencies` or `Notes on Reconciliation` fields—not by assigning an issue to multiple categories.

### Step 9: Write the consolidated document

Structure of `doc/research/review-5/review-5.md`:

```markdown
# Consolidated Production Readiness Assessment — C64 Commander

Date: 2026-02-28
Commit: cf7d0826a429802524b6ee86beb73e81449f4e04
Sources: review-5a.md, review-5b.md

## Consolidation Method
<Describe the merge process, conflict resolution principles, and any deviations from this prompt.>

## Executive Summary
<Unified shipping recommendation. If A says "Do not ship" and B says "Ship with mitigations", resolve the conflict by evaluating the consolidated Blocker/Critical issue set. State the recommendation with explicit conditions.>

## Priority Table
<All issues sorted by Priority Score descending. Columns: Rank, ISSUE-ID, Title, Category, Severity, Impact, Likelihood, Effort, Priority Score, Source.>

## Top 10 Highest Priority Issues
<Subset of priority table with one paragraph per issue explaining why it ranks highest.>

## Low-Effort / High-Impact Subset
<All issues where Effort ∈ {XS, S} AND (Severity ∈ {Blocker, Critical} OR Impact = High). Table format.>

## Issue Register

### 1. Security
### 2. Supply Chain
### 3. CI/CD
### 4. Android
### 5. iOS
### 6. Web
### 7. Data Integrity
### 8. Performance
### 9. Observability
### 10. UX & Accessibility
### 11. Testing
### 12. Legal & Licensing
### 13. Architecture & Maintainability

<Within each category, issues sorted by Priority Score descending. Each issue uses this exact format:>

#### ISSUE-NNN: <Title>

- **Original IDs:** PRA-XXX (review-5a) | PRA-YYY (review-5b) | N/A
- **Source:** review-5a | review-5b | both
- **Category:** <exactly one from list above>
- **Description:** <merged description>
- **Root Cause:** <one sentence>
- **Impact:** High | Medium | Low [+ (inferred) if applicable]
- **Likelihood:** High | Medium | Low [+ (inferred) if applicable]
- **Severity:** Blocker | Critical | Major | Minor | Trivial
- **Effort:** XS | S | M | L | XL
- **Priority Score:** <computed value>
- **Risk of Change:** <what could go wrong if the fix is applied>
- **Dependencies:** <ISSUE-IDs this depends on, or "None">
- **Evidence:** <file paths with line ranges, command IDs>
- **Recommended Resolution:** <concrete fix steps>
- **Verification:** <how to confirm the fix>
- **Notes on Reconciliation:** <conflicts between A and B for this issue, decisions made, rationale—or "No conflicts" if clean merge>

## Reconciliation Log
<A complete table of every conflict encountered and how it was resolved. Columns: ISSUE-ID, Conflict Type, Review A Position, Review B Position, Resolution, Rationale.>

## Effort-Impact Matrix
<2×2 matrix (Low Effort / High Effort vs High Impact / Low Impact) listing ISSUE-IDs in each quadrant.>

## Coverage Checklist
<Same structure as review-5a section 18, confirming all inspection areas are covered.>
```

### Step 10: Self-check before proceeding

Before moving to Phase 1, verify:

1. Every PRA-* from Review A appears in exactly one ISSUE entry's `Original IDs`.
2. Every PRA-* from Review B appears in exactly one ISSUE entry's `Original IDs`.
3. No ISSUE-ID is duplicated.
4. ISSUE-IDs are sequential with no gaps.
5. Every issue has exactly one category.
6. Priority Scores are correctly computed (spot-check at least 5).
7. The priority table is sorted correctly.
8. The Reconciliation Log has one row for every conflict encountered.
9. The Executive Summary shipping recommendation is consistent with the consolidated Blocker/Critical set.
10. No source code was modified.

If any check fails, fix it before proceeding.

---

## PHASE 1: ROLLOUT PLAN CREATION (no code changes)

### Output

Create exactly one file:

```
doc/research/review-5/ROLLOUT-PLAN.md
```

### Structure

```markdown
# Rollout Plan — C64 Commander Production Readiness

Source: doc/research/review-5/review-5.md
Created: <date>

## Phase 0 — Precondition & Safety Controls
<Tasks that establish the safety net before any production changes.
Examples: secret scanning, backup verification, CI dry-run.>

## Phase 1 — Critical & Blocker Mitigation
<All issues with Severity ∈ {Blocker, Critical}.
Plus any issue with Priority Score in the top 10 that has Effort ∈ {XS, S}.>

## Phase 2 — Major Risk Reduction
<All remaining Major-severity issues, sorted by Priority Score.>

## Phase 3 — Structural Improvements
<Architecture, maintainability, and testing infrastructure issues.>

## Phase 4 — Performance & UX Enhancements
<Performance, UX, accessibility, and localization issues.>

## Phase 5 — Governance & Long-Term Hardening
<Legal, observability, and forward-looking items.>
```

### Task format

Every task must use this exact format:

```markdown
- [ ] TASK-NNN: <Imperative verb phrase describing a single atomic action>
  - **Addresses:** ISSUE-XXX [, ISSUE-YYY only if tightly coupled]
  - **Acceptance criteria:**
    - <Measurable condition 1>
    - <Measurable condition 2>
  - **Validation:** <Exact command(s) or manual step(s) to confirm>
  - **Rollback:** <How to revert if the change causes regression>
  - **Implementation notes:** <Empty until completed>
```

### Task rules

1. Tasks are numbered sequentially: TASK-001, TASK-002, …
2. Each task must be atomic: independently implementable and testable.
3. A task may reference at most 2 ISSUE-IDs, and only when those issues share a single code change.
4. No vague tasks. Forbidden examples: "Improve security", "Harden CI", "Fix issues".
5. Tasks within each phase are ordered by Priority Score of their primary ISSUE-ID.
6. Each ISSUE-ID must be addressed by at least one TASK.
7. No ISSUE-ID may be silently dropped.

### Phase assignment rules

| Phase | Inclusion criteria |
|-------|-------------------|
| 0 | Safety controls and preconditions that must exist before any production change. |
| 1 | Severity ∈ {Blocker, Critical} OR (Priority Score in top 10 AND Effort ∈ {XS, S}). |
| 2 | Severity = Major AND not already in Phase 1. |
| 3 | Category ∈ {Architecture & Maintainability, Testing} AND Severity ∈ {Minor, Trivial}. |
| 4 | Category ∈ {Performance, UX & Accessibility} AND Severity ∈ {Minor, Trivial}. |
| 5 | Everything else not assigned to Phases 0–4. |

If an issue's phase assignment is ambiguous, assign it to the earlier phase.

---

## PHASE 2: EXECUTE PHASE 1 TASKS (code changes begin)

After both `review-5.md` and `ROLLOUT-PLAN.md` are created and self-checked:

### Execution protocol

1. Work through Phase 1 tasks in TASK-NNN order.
2. For each task:
   a. Mark `- [ ]` as `- [x]` in ROLLOUT-PLAN.md when complete.
   b. Add implementation notes under the task.
   c. Run `npm run test` after each task. If tests fail, fix before proceeding.
   d. Run `npm run lint` after each task. If lint fails, fix before proceeding.
   e. Run `npm run build` after each task. If build fails, fix before proceeding.
   f. Do not modify files unrelated to the current task.
3. If a task is blocked:
   a. Document the blocker as an implementation note on the task.
   b. Do not mark the task as complete.
   c. Add a `BLOCKED:` prefix to the task description.
   d. Continue with the next task.
4. After all Phase 1 tasks are attempted:
   a. Run `npm run test:coverage` to verify ≥ 82% branch coverage.
   b. Run `npm run build` for a final green build confirmation.
   c. Update ROLLOUT-PLAN.md with a Phase 1 completion summary at the end of the Phase 1 section.

### Constraints during execution

- Do not start Phase 2 tasks.
- Do not refactor code beyond what the current task requires.
- Do not add skip annotations or comment out failing tests.
- If a test was passing before your change and fails after, the change is wrong—fix it.
- Preserve existing formatting in files you modify. Do not reformat unrelated code.
- Keep commit-ready state after every task: build + lint + test must pass.

### Blocker handling

If a task requires:
- Network access not available in the sandbox → Document as blocked, propose offline mitigation.
- macOS/Xcode → Document as blocked, confirm CI handles it.
- Secret material → Document as blocked, describe what the secret holder must do.
- A dependency not present in the lockfile → Document as blocked, describe the required `npm install` step.

---

## COMPLETION CRITERIA

Work is complete when all of the following are true:

1. `doc/research/review-5/review-5.md` exists and passes the self-check in Step 10.
2. `doc/research/review-5/ROLLOUT-PLAN.md` exists with all phases populated.
3. Every Phase 1 task in ROLLOUT-PLAN.md is either `[x]` (completed) or prefixed with `BLOCKED:` (with documented blocker).
4. `npm run test` passes.
5. `npm run lint` passes.
6. `npm run build` passes.
7. `npm run test:coverage` reports ≥ 82% branch coverage.
8. No unrelated files were modified.

---

## ANTI-PATTERNS (do not do these)

- Do not invent issues not present in either source document.
- Do not drop issues silently because they seem low priority.
- Do not use marketing language ("best-in-class", "robust", "comprehensive").
- Do not use conversational tone ("Let's", "We should", "I think").
- Do not guess at file paths or evidence—cite exactly what the source documents cite.
- Do not merge two unrelated issues into one ISSUE-ID to reduce count.
- Do not assign the same ISSUE-ID to two different problems.
- Do not create tasks that span multiple unrelated issues.
- Do not skip the self-check steps.
- Do not modify code during the consolidation phase (Phase Zero).
- Do not declare completion without running the full validation suite.
