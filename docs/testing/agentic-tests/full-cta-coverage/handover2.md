# Full-CTA Coverage Continuation Prompt: Progress-Ledger HIL Audit

## Purpose

Use this prompt **with** `docs/testing/agentic-tests/full-cta-coverage/prompt.md`; it does not replace it. The original prompt defines the certification scope and safety model. This continuation prompt adds a stricter execution discipline so the agent can track progress, avoid unproductive drift, and still preserve the evidence quality required for a full HIL-audited CTA certification.

The goal is not to work faster by cutting corners. The goal is to make progress legible: every implementation or HIL step must close a named gap from `prompt.md`, emit a verifiable artifact, and update a progress ledger that makes the remaining work obvious.

## Current Track Assessment

The work is on the right architectural track when it satisfies all of these:

- It extends `c64scope`; it does not create a parallel CTA package.
- Product Android actions go through DroidMind / `DroidmindClient`.
- The deterministic runner, not the LLM, performs bulk CTA census and generic contracts.
- The LLM handles orchestration, risky scenarios, failure replay, triage, and release judgment.
- Runtime-discovered CTAs are not counted as passed unless the applicable contract has evidence.
- HIL evidence comes from the Pixel 4 plus C64U/U64 target identity, not from historical claims.

Known risks to control:

- Building many small pure modules without reaching HIL-audited coverage.
- Treating `CALIBRATION_ONLY` discovery artifacts as certification evidence.
- Deferring the C64U-primary Save-and-Connect resolution too long.
- Producing named artifacts in docs that are not actually written to disk.
- Running broad validation or coverage as a substitute for Pixel 4 evidence.

## First Action In Every Continuation

Before changing code or running more HIL cases:

1. Read `prompt.md`, this `prompt2.md`, `handover1.md` if present, `AGENTS.md`, `REVIEW.md`, and `.github/copilot-instructions.md`.
2. Run `git status --short` and identify work already in progress. Do not revert unrelated work.
3. Inspect the latest `c64scope/artifacts/cta-*` and `c64scope/artifacts/cta-discover/*` runs.
4. Create or update `docs/testing/agentic-tests/full-cta-coverage/runs/progress-ledger.md`.
5. Record a short "Current Position" entry with:
   - active branch and Git SHA
   - Pixel 4 status
   - C64U status
   - U64 fallback status
   - c64scope lab peer status
   - latest runner artifact paths
   - latest validation commands and outcomes
   - open blockers and next proof step

Do not start new feature work until that ledger is current.

## Progress Ledger Rules

Use these statuses only:

- `NOT_STARTED`
- `IN_PROGRESS`
- `BLOCKED`
- `IMPLEMENTED_UNPROVEN`
- `PROVEN`
- `DEFERRED_WITH_REASON`

`PROVEN` requires an artifact path or command output reference. A code module that compiles but has not been exercised on the Pixel 4 is `IMPLEMENTED_UNPROVEN`, not `PROVEN`.

The ledger must contain these sections:

1. `Runner Capability Matrix`
2. `HIL Environment Matrix`
3. `Inventory And CTA Coverage Matrix`
4. `Keypad And Touch Matrix`
5. `Risk And Mutation Matrix`
6. `Page/Feature Matrix`
7. `Defect And Replay Matrix`
8. `Cleanup And Restoration Matrix`
9. `Release Gate Matrix`

Each row must include:

- `Spec section`
- `Status`
- `Evidence path`
- `Blocking issue`
- `Next action`

## Phase Gates

Do not blur phases. A later phase may begin only when the earlier gate is either `PROVEN` or explicitly `BLOCKED` with evidence.

### Gate 0: Harness Foundation

Required proof:

- `npm run scope:check` passes.
- `scope:cta:discover`, `scope:cta`, `scope:cta:resume`, and `scope:cta:replay` exist only if their entry points execute.
- `mcp-capabilities.json` is emitted by the runner and shows required DroidMind capabilities.
- The runner writes every artifact it names, or documents the missing artifact as a defect.

### Gate 1: Pixel 4 Read-Only Discovery

Required proof:

- Pixel 4 serial and Android version recorded.
- App launches after installing the latest available APK.
- Current screen, Docs, Licenses, and all six tab routes produce runtime CTA inventories.
- System UI nodes are excluded from runtime app inventory.
- `docs/cta-inventory.md` counts are compared as tripwires, not pass/fail proof.

### Gate 2: Keypad Navigation Canary

Required proof:

- Digits 1-6 navigate to the six tabs outside text fields.
- Star opens Diagnostics from page context.
- Pound opens Device Switcher from page context.
- D-pad traversal records `KEYPAD_REACHABLE`.
- Center/Enter activation records `KEYPAD_ACTIVATABLE` only when post-action evidence exists.
- Touch activation records `TOUCH_ACTIVATABLE` separately.

### Gate 3: C64U-Primary Target Resolution

Required proof:

- App-driven Save-and-Connect to host `c64u`, password `pwd`, has been attempted through DroidMind.
- App diagnostics or app-visible device info confirms whether the active target is C64U.
- If C64U fails, evidence is preserved before using U64.
- U64 results are labelled `U64_FALLBACK` and never merged into C64U pass status.

### Gate 4: Safe Local Mutation Canary

Required proof:

- Baseline recorded in `state-ledger.json`.
- One app-local reversible setting is changed through the UI.
- Original value, new value, expected effect, observed effect, restoration method, and restoration result are recorded.
- Fresh app-visible readback proves restoration.
- No C64-bound mutation is attempted in this gate.

### Gate 5: Generic R0/R1 Contracts

Required proof:

- Buttons, switches, selects, sliders, and text inputs have deterministic generic contract runners where applicable.
- Every contract has timeout, screenshot/hierarchy capture on failure, checkpoint update, and replay generation.
- `coverage.csv` and `coverage.json` use per-CTA statuses and count only `PASS` as passed.

### Gate 6: Page Coverage Waves

Run pages in this order unless a blocker requires reordering:

1. Docs and Licenses
2. Settings read-only and app-local settings
3. Diagnostics
4. Home read-only controls
5. Disks read-only and safe local-library state
6. Play read-only and local-source fixture flows
7. Config read-only enumeration
8. Config safe known-item mutation with restore
9. C64-bound guarded scenarios
10. Background playback and long-running HIL cases

Each wave must emit a page-level result file and update the ledger.

### Gate 7: Risky And Destructive Scenarios

Required proof before execution:

- Dedicated scenario manifest.
- Approval and safety class recorded.
- Baseline and recovery path recorded.
- Per-family mutation budget available.
- Cleanup plan recorded.

Never let the generic runner auto-exercise R3/R4 controls.

### Gate 8: Final HIL Certification

Required proof:

- Every runtime CTA has an individual result.
- Every result links to evidence.
- Every failure has been replayed through DroidMind unless original evidence proves crash, ANR, or irreversible failure.
- Every S0/S1/S2 candidate has a self-contained defect report.
- Cleanup report shows restored final state or lists residual differences.
- Final report and release decision are written.

## Work Selection Rule

At each step, select the smallest work item that moves the nearest incomplete phase gate toward `PROVEN`.

Prefer vertical slices over isolated scaffolding:

- Good slice: implement a keypad traversal primitive, run it on Docs, emit keypad coverage, update the ledger.
- Weak slice: add three unused pure modules without a runner path or HIL artifact.

Pure modules are acceptable when they directly unblock the next HIL proof and have unit tests. After a pure-module slice, the next slice should normally be a runner or device proof.

## Artifact Discipline

Every named artifact must exist. If an artifact is planned but not emitted yet, mark it `NOT_STARTED`; do not describe it as present.

Required artifact roots:

- Runner artifacts: `c64scope/artifacts/cta-<UTC>Z-pixel4-<target>-<git_sha>/`
- Discover canaries: `c64scope/artifacts/cta-discover/`
- Human progress docs: `docs/testing/agentic-tests/full-cta-coverage/`
- Run manifests worth committing: `docs/testing/agentic-tests/full-cta-coverage/runs/`

Do not create a second artifact tree for the CTA program.

## Defect Quality Bar

A defect report must be sufficient for a developer to reproduce and fix the issue without asking follow-up questions. Include:

- defect ID, severity, priority, release impact
- first and last reproduced UTC
- app version and Git SHA
- Pixel 4 details
- C64U/U64 target identity
- route, overlay, CTA label, fingerprint/test ID
- exact keypad and DroidMind action sequence
- pre-state and post-state
- expected result and actual result
- screenshots, UI hierarchy, diagnostics, C64Scope evidence where relevant
- replay command
- cleanup status
- suspected component and uncertainty

Do not state a root cause as fact unless proven.

## Validation Policy

For code changes:

- Run `npm run scope:check`.
- Run targeted runner commands that prove the changed behavior on the Pixel 4 when the changed behavior is HIL-related.
- Use coverage only for final PR/release convergence or when explicitly requested; do not run broad coverage while HIL deliverables remain open.

For doc-only updates:

- Do not run builds or tests for ceremony.
- Check internal consistency, links, and status wording.

## Reporting Format For Each Work Block

At the end of each work block, report:

- `Progress ledger updated:` path or reason not updated
- `Spec sections advanced:`
- `Artifacts emitted:`
- `Pixel 4 evidence:`
- `C64 target evidence:`
- `Validation run:`
- `Still blocked:`
- `Next gate action:`

Keep the report factual. Do not claim certification progress for calibration-only artifacts.

## Stop Conditions

Stop and record a blocker only when:

- Pixel 4 cannot be controlled through DroidMind.
- The active C64 target cannot be safely identified.
- A hardware instability or destructive-risk condition requires human intervention.
- The same missing external capability has blocked three consecutive attempts.

Otherwise, continue by choosing the next nearest phase-gate proof.
