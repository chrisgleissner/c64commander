# Corrected Follow-Up Execution Prompt

Date: 2026-04-06
Type: Strict execution and convergence prompt
Classification: `DOC_PLUS_CODE` only if implementation or screenshots actually change; otherwise `DOC_ONLY`

## Prompt

ROLE

You are a staff-level engineer working on C64 Commander.

This is a strict execution and convergence task.
It is not a research task.
It is not a planning task.
It is not a partial-progress task.

You must complete all required work fully, with source-backed evidence, before moving on.

---

## GLOBAL EXECUTION RULES

1. `PLANS.md` is the execution ledger and current status source of truth.
2. `WORKLOG.md` must receive a timestamped entry after every meaningful action, validation run, measurement run, or keep/discard decision.
3. Do not skip ordered phases.
4. Do not mark a task done without proof in the tree, tests, artifacts, `PLANS.md`, and `WORKLOG.md`.
5. Do not proceed to the next task until the current one is fully complete or explicitly blocked with evidence.
6. Prefer modifying existing files over creating parallel implementations.
7. Follow `.github/copilot-instructions.md` and `AGENTS.md` exactly, including change classification and minimal screenshot scope.
8. If code changes, run `npm run test:coverage` and keep global branch coverage at `>= 91%`.
9. Regenerate screenshots only for visible UI states that actually changed.
10. Fail fast on inconsistencies between implementation, screenshots, `PLANS.md`, `WORKLOG.md`, and the HVSC audit package.
11. Do not create fake follow-up paths such as `docs/research/hvsc/performance/audit2/*`. Use the existing audit package under `docs/research/hvsc/performance/audit/`.

---

## OBJECTIVE

Converge three domains against the current repository state:

1. Play-page Add Items source-chooser correctness, specifically CommoServe icon sizing/alignment if it is still wrong in the live tree.
2. HVSC performance audit correctness, using the actual research and audit files that exist in this workspace.
3. Remaining-work execution closure, by updating the existing convergence prompt to match the current audit and current implementation state.

The task is complete only when all three domains are internally consistent and evidence-backed.

---

## AUTHORITATIVE INPUTS

Read these before editing:

1. `.github/copilot-instructions.md`
2. `AGENTS.md`
3. `README.md`
4. `docs/ux-guidelines.md`
5. `PLANS.md`
6. `WORKLOG.md`
7. `docs/research/hvsc/performance/audit/audit.md`
8. `docs/research/hvsc/performance/audit/convergence-prompt.md`
9. `docs/research/hvsc/performance/hvsc-performance-research-brief-2026-04-05.md`
10. `docs/research/hvsc/performance/hvsc-performance-research-prompt-2026-04-05.md`
11. `docs/research/hvsc/performance/hvsc-performance-research-report-2026-04-05.md`
12. `docs/research/hvsc/performance/hvsc-performance-convergence-prompt-2026-04-05.md`

Inspect these implementation surfaces as needed:

- `src/components/FileOriginIcon.tsx`
- `src/components/itemSelection/ItemSelectionDialog.tsx`
- `tests/unit/components/FileOriginIcon.test.tsx`
- `tests/unit/components/itemSelection/ItemSelectionDialog.test.tsx`
- `playwright/screenshots.spec.ts`
- `src/lib/hvsc/`
- `src/pages/playFiles/`
- `src/lib/playlistRepository/`
- `scripts/hvsc/`
- `playwright/hvscPerf.spec.ts`
- `playwright/hvscPerfScenarios.spec.ts`
- `.maestro/perf-hvsc-baseline.yaml`
- `ci/telemetry/android/`

---

## PHASE 0 - CLASSIFY THE CHANGE HONESTLY

Before modifying anything, classify the work using repository rules:

- `DOC_ONLY` if you only update prompts, audits, plans, or worklogs.
- `DOC_PLUS_CODE` if you also change UI code, tests, or screenshots.

This classification controls validation. Do not run builds, coverage, or screenshot flows for ceremony.

Exit criteria:

- Classification is recorded in `PLANS.md`.
- Validation scope is stated before implementation starts.

ONLY THEN proceed.

---

## PHASE 1 - ADD ITEMS SOURCE-CHOOSER CORRECTNESS

TASK ID: `UI-SOURCE-001`

Goal:

Verify the current Play-page Add Items source chooser and fix it only if the CommoServe icon is still visually inconsistent in the current tree.

Relevant files:

- `src/components/FileOriginIcon.tsx`
- `src/components/itemSelection/ItemSelectionDialog.tsx`
- `tests/unit/components/FileOriginIcon.test.tsx`
- `tests/unit/components/itemSelection/ItemSelectionDialog.test.tsx`
- `playwright/screenshots.spec.ts`

Requirements:

- Treat the current repository state as truth, not stale prompt text.
- The CommoServe icon must share the same outer icon slot/alignment contract as Local, C64U, and HVSC.
- Any size increase must be deterministic and implemented in code, not left to browser or DPI quirks.
- Alignment, padding, and baseline must stay consistent with the existing chooser layout contract from `docs/ux-guidelines.md`.
- If the current implementation is already correct, do not churn code; record that the task was verified rather than reimplemented.

Validation:

- Use the narrowest deterministic regression coverage already established in this repo.
- Update or add unit tests only where they prove the icon-slot contract or chooser layout contract.
- If visible UI changes, refresh only the affected screenshot subset under:
  - `docs/img/app/play/import/01-import-interstitial.png`
  - `docs/img/app/play/import/04-commoserve-search.png`
  - `docs/img/app/play/import/05-commoserve-results-selected.png`
- If the visible interstitial layout changed more broadly, also update the matching profile-specific import screenshots under `docs/img/app/play/import/profiles/` only when they are actually inaccurate.

Exit criteria:

- Current chooser behavior is either verified as correct or fixed.
- The exact changed screenshot files, if any, are listed in `WORKLOG.md`.
- No unrelated screenshot folders were regenerated.

ONLY THEN proceed.

---

## PHASE 2 - SCREENSHOT AND DOC HYGIENE

TASK ID: `UI-DOC-002`

Goal:

Bring documentation imagery and references into sync with the real UI without violating the repository’s minimal-screenshot rule.

Requirements:

- Do not regenerate all of `docs/img/app/`.
- Refresh only screenshots whose visible UI is now inaccurate.
- Remove stale or orphaned files only if they are truly unreferenced and superseded.
- Verify README and docs references for the Play import screenshots.

Minimum reference set to check:

- `README.md`
- `docs/img/app/play/import/01-import-interstitial.png`
- `docs/img/app/play/import/02-c64u-file-picker.png`
- `docs/img/app/play/import/03-local-file-picker.png`
- `docs/img/app/play/import/04-commoserve-search.png`
- `docs/img/app/play/import/05-commoserve-results-selected.png`

Validation:

- Every referenced screenshot must exist.
- No claimed screenshot update may be omitted from `WORKLOG.md`.
- If no screenshot changes are needed, record why broader regeneration was unnecessary.

Exit criteria:

- The screenshot set for the touched Play import states is accurate.
- References are valid.
- No fake “regenerate everything” work was performed.

ONLY THEN proceed.

---

## PHASE 3 - HVSC PERFORMANCE AUDIT CORRECTION

TASK ID: `PERF-AUDIT-003`

Goal:

Update the existing audit so it reflects the current repository truth, including already-landed work and still-open gaps.

Output file:

- `docs/research/hvsc/performance/audit/audit.md`

Do not create:

- `docs/research/hvsc/performance/audit2/audit.md`
- any parallel `audit2/` tree

Strict source set:

1. `docs/research/hvsc/performance/audit/audit.md`
2. `docs/research/hvsc/performance/audit/convergence-prompt.md`
3. `docs/research/hvsc/performance/hvsc-performance-research-brief-2026-04-05.md`
4. `docs/research/hvsc/performance/hvsc-performance-research-prompt-2026-04-05.md`
5. `docs/research/hvsc/performance/hvsc-performance-research-report-2026-04-05.md`
6. `docs/research/hvsc/performance/hvsc-performance-convergence-prompt-2026-04-05.md`
7. `PLANS.md`
8. `WORKLOG.md`
9. Current implementation and artifact paths in the repo

Audit requirements:

- Reconcile the current audit against the live tree, not against stale assumptions.
- Explicitly account for already-landed work visible in `PLANS.md`, `WORKLOG.md`, code, scripts, tests, and workflows.
- For every target, phase, or major claim, provide:
  - ID
  - description
  - expected behavior from the research package
  - actual current implementation status
  - evidence paths
  - status: `DONE`, `PARTIAL`, `NOT DONE`, or `BLOCKED`
  - precise gap analysis
- Explicitly cover:
  - instrumentation coverage
  - web perf harness scope
  - Android perf harness scope
  - Perfetto pipeline state
  - microbenchmark state
  - CI quick/nightly perf scope
  - target closure state for `T1` through `T6`
  - any divergence between `audit.md`, `convergence-prompt.md`, `PLANS.md`, and `WORKLOG.md`

Validation:

- Every claim must point to a real file, real command output already captured in the repo, or a real artifact path.
- Remove stale statements that are no longer true in the current tree.
- Do not leave “not implemented” statements in place when the code or worklog already proves otherwise.

Exit criteria:

- `docs/research/hvsc/performance/audit/audit.md` matches the current repository state.
- The audit is specific enough to drive the next execution pass without hidden assumptions.

ONLY THEN proceed.

---

## PHASE 4 - UPDATE THE EXISTING REMAINING-WORK PROMPT

TASK ID: `PERF-PROMPT-004`

Goal:

Update the existing convergence prompt so it covers only the real remaining work and preserves already-closed items with evidence.

Output file:

- `docs/research/hvsc/performance/audit/convergence-prompt.md`

Do not create:

- `docs/research/hvsc/performance/audit2/prompt.md`
- any parallel `audit2/` prompt tree

Requirements:

- The prompt must be a strict execution prompt, not an exploratory prompt.
- It must enforce `PLANS.md` and `WORKLOG.md` maintenance.
- It must reflect the current audit, not the 2026-04-05 pre-convergence state.
- Closed tasks must remain closed only if the updated audit still supports them.
- Open tasks must be explicit, ordered, dependency-aware, and evidence-gated.
- The prompt must use the real repository artifact layout, including current perf artifact locations such as `ci-artifacts/hvsc-performance/**` when applicable.

Each remaining task must include:

- task ID
- dependency prerequisites
- concrete implementation steps
- required tests or measurement runs
- required artifact paths
- measurable success criteria
- explicit failure conditions
- proof required before changing `[ ]` to `[x]`

The prompt must also include:

- anti-shortcut rules
- blocking rules
- termination conditions
- the requirement to stop claiming scope broader than the implemented benchmark or CI reality

Validation:

- Another engineer must be able to execute the prompt without inventing missing paths or missing file names.
- No remaining task may depend on non-existent files.
- No task may instruct the executor to recreate already-closed Phase 0 or Phase 1 work unless the updated audit proves it is still open.

Exit criteria:

- `docs/research/hvsc/performance/audit/convergence-prompt.md` is current, deterministic, and tied to the updated audit.

ONLY THEN proceed.

---

## PHASE 5 - FINAL CONSISTENCY CHECK

TASK ID: `CLOSE-005`

Goal:

Ensure the touched documents, trackers, tests, and screenshot artifacts agree with one another.

Requirements:

- `PLANS.md` reflects the actual current status.
- `WORKLOG.md` reflects the actual actions taken.
- The updated audit and updated convergence prompt do not contradict each other.
- If Phase 1 changed UI code, the screenshot references and validation summary must match the actual changed files.

Validation:

- Re-read every touched file.
- Verify all referenced paths exist.
- Verify all claimed completed tasks have evidence.

Exit criteria:

1. `UI-SOURCE-001` is verified or fixed with evidence.
2. `UI-DOC-002` is complete with correctly scoped screenshot handling.
3. `PERF-AUDIT-003` is updated in `docs/research/hvsc/performance/audit/audit.md`.
4. `PERF-PROMPT-004` is updated in `docs/research/hvsc/performance/audit/convergence-prompt.md`.
5. All touched artifacts are internally consistent.

---

## EXECUTION LOOP

After each completed task:

1. Update `PLANS.md`.
2. Append to `WORKLOG.md`.
3. Run the smallest honest validation for the current classification.
4. Verify artifacts and referenced paths.
5. Re-evaluate for gaps before continuing.

Do not stop at partial progress.
Do not broaden scope without proof.
Do not invent file paths that do not exist in this workspace.
