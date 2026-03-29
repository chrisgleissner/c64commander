# REU And CommoServe Refined Brief

This brief replaces the stale assumptions in `docs/plans/ux/ram-reu-commoserve-convergence-steering.md` for work that is specifically limited to:

- CommoServe preset UX and search form behavior
- REU save/load workflow
- screenshots for the affected UI only

It is written to match the current codebase as it exists today.

## Role

You are a senior autonomous software engineer working inside `c64commander`.

Execute a focused implementation and validation task with strict convergence:

1. implement the CommoServe preset UX and session-cache behavior
2. audit and harden the REU save/load workflow
3. regenerate only the screenshots that are made inaccurate by those changes

Do not widen scope beyond those surfaces.

## Read First

Read the smallest relevant set before editing:

1. `README.md`
2. `.github/copilot-instructions.md`
3. `AGENTS.md`
4. `docs/ux-guidelines.md`
5. `src/hooks/useOnlineArchive.ts`
6. `src/components/archive/OnlineArchiveDialog.tsx`
7. `src/pages/HomePage.tsx`
8. `src/pages/home/dialogs/ReuProgressDialog.tsx`
9. `src/pages/home/dialogs/RestoreSnapshotDialog.tsx`
10. `src/lib/reu/reuWorkflow.ts`
11. `src/lib/reu/reuTelnetWorkflow.ts`
12. `src/lib/reu/reuSnapshotStorage.ts`
13. `tests/unit/hooks/useOnlineArchive.test.tsx`
14. `tests/unit/components/archive/OnlineArchiveDialog.test.tsx`
15. `tests/unit/lib/reu/reuWorkflow.test.ts`
16. `tests/unit/pages/HomePage.ramActions.test.tsx`

## Classification

Treat the implementation as:

- `DOC_PLUS_CODE`
- `UI_CHANGE`

## Current Code Reality

Design and validation must align with these facts:

1. CommoServe presets are loaded by `useOnlineArchive()`.
2. The app already uses seeded presets plus an in-memory session cache keyed by archive config.
3. The preset refresh path is one `getPresets()` request returning the full preset set.
4. The current seeded presets are incomplete and need refinement.
5. CommoServe search and execution are direct HTTP flows, not Telnet flows.
6. REU save/load is already modeled by `createReuWorkflow()`.
7. REU save uses FTP list/read plus a Telnet-triggered `Save REU Memory` action in `/Temp`.
8. REU restore uses local-file read, FTP upload to `/Temp`, then Telnet file-context actions in `/Temp`.
9. FTP upload support already exists in the current stack.
10. REU snapshots are already stored as native files, not in the legacy localStorage RAM snapshot store.
11. The Home page already shows a blocking `ReuProgressDialog` while a REU workflow is running.
12. Success currently ends with a toast and closes the progress dialog. Failure currently ends with `reportUserError(...)` and closes the progress dialog.

Do not reintroduce requirements that contradict those facts.

## Scope Constraints

Hard constraints:

- no architectural refactor
- no unrelated Home quick-action work
- no transport rewrites outside the REU path
- no speculative cleanup
- minimal, surgical edits only

## Task List

Use a deterministic task list with at most 8 tasks:

1. refine CommoServe seeded presets and verification behavior
2. preserve CommoServe selections across preset verification
3. add the required download-page legal notice above `Search`
4. audit REU save workflow for `/Temp`, polling, transfer, persistence, and error termination
5. audit REU restore workflow for local read, FTP upload, Telnet apply, and error termination
6. tighten REU workflow logging and diagnostics so a run can be reconstructed
7. add or update narrow regression tests
8. regenerate only the affected screenshots

Maintain `WORKLOG.md` if and only if the task explicitly requires execution logging. Do not create ceremonial files for a documentation-only prompt update.

## Task 1: CommoServe UX Contract

CommoServe must have two user-visible data conditions:

1. `seeded`
2. `verified`

Use those terms in docs and tests. Do not invent a more complicated state model than the hook and dialog need.

### Seeded

The dialog must render immediately from local defaults with no blocking network dependency.

Required seeded values:

- `Category`: `Apps`, `Demos`, `Games`, `Graphics`, `Music`
- `Date`: every year from `1980` through the current year
- `Type`: `crt`, `d64`, `d71`, `d81`, `sid`, `t64`, `tap`
- `Sort`: `Name`, `Year`
- `Order`: `Ascending`, `Descending`

Rules:

- no sheet-level loading spinner
- no render blocking
- no form reset when the background refresh starts or finishes
- search must remain usable with seeded values if the refresh fails

### Verified

After first open per app launch, issue one background preset request for the active archive config.

Rules:

- do not make one request per preset type or category
- update the displayed option sets only when the verified values differ
- preserve the current user selection even if preset verification resolves later
- cache the verified result in memory until app restart
- if verification fails, keep the seeded values and surface no disruptive UI

### Download Page Copy

Immediately above the `Search` button, show:

`You agree you have a necessary license or rights to download any software.`

## Task 2: REU Workflow Contract

Do not force REU into a fake generic `STARTING -> TELNET -> FTP -> FINALIZING` pipeline. The workflow already has operation-specific steps, and those steps map cleanly to the real transport boundaries.

### Shared Terminal States

Use these high-level outcomes:

- `idle`
- `running`
- `success`
- `error`

### Authoritative Save Steps

The save flow must follow this exact step sequence:

1. `preparing`
2. `scanning-temp`
3. `saving-reu`
4. `waiting-for-file`
5. `downloading`
6. `persisting`
7. `complete`

Transport mapping:

- `saving-reu` is the Telnet phase
- `waiting-for-file` and `downloading` are FTP-observed phases
- `persisting` is local-device storage finalization

### Authoritative Restore Steps

The restore flow must follow this exact step sequence:

1. `reading-local`
2. `uploading`
3. `restoring`
4. `complete`

Transport mapping:

- `uploading` is the FTP phase
- `restoring` is the Telnet phase

### UX Contract

The blocking progress UI must:

- open immediately when the workflow begins
- report forward movement by step, not just a static spinner
- keep the existing explicit `about 30 seconds` guidance
- terminate immediately on `success` or `error`
- never leave background work running after the UI has declared completion

If broader grouped labels are needed for screenshots or copy, map them from the real steps:

- `Preparing`: `preparing`, `scanning-temp`, `reading-local`
- `Applying on device`: `saving-reu`, `restoring`
- `Transfer`: `waiting-for-file`, `downloading`, `uploading`
- `Finalizing`: `persisting`

Do not replace the step identifiers already used by `ReuProgressState`.

## Task 3: REU Transport Invariants

These rules are mandatory:

1. Always stage remote REU files in `/Temp`.
2. Save means `device -> /Temp -> FTP download -> local native storage`.
3. Restore means `local native storage -> FTP upload to /Temp -> Telnet apply`.
4. No silent failure.
5. No stale-file reuse.
6. No duplicate success reporting.
7. No UI success before the transport work has actually completed.

Audit specifically for:

- timeout handling while polling for the saved `.reu` file
- partial or failed FTP transfer propagation
- wrong remote path construction
- wrong fallback file naming
- stale `/Temp` detection when older `.reu` files already exist
- UI state desync between the workflow promise and the progress dialog

## Task 4: REU Observability

Add structured diagnostics that complement the existing FTP/Telnet traces instead of duplicating them blindly.

Each REU operation must allow a reviewer to reconstruct:

- operation: `save` or `restore`
- step: the exact `ReuProgressState.step`
- transport: `local`, `ftp`, or `telnet`
- remote path when applicable
- local path when applicable
- duration
- success or failure
- error context with message and phase

Log on step transition and terminal outcome.

## Task 5: Validation

Required validation for the implementation:

- `npm run lint`
- `npm run test`
- `npm run test:coverage`
- `npm run build`

If unrelated failures remain, isolate them with evidence and continue the scoped work.

Minimum regression coverage:

1. CommoServe renders seeded presets immediately.
2. CommoServe performs exactly one background preset verification request per config per app session.
3. CommoServe does not reset the current selection after verification.
4. REU save emits the expected step order.
5. REU restore emits the expected step order.
6. REU save fails cleanly on timeout waiting for the new `/Temp` file.
7. REU restore fails cleanly on FTP upload or Telnet apply failure.

## Task 6: Screenshots

Use the existing screenshot pipeline only.

Do not request screenshot states that the current UI cannot actually show.

### CommoServe

Capture:

1. initial seeded render
2. verified render after preset refresh

### REU

Capture states that correspond to real UI surfaces:

1. progress dialog during `saving-reu` or `reading-local`
2. progress dialog during `downloading` or `uploading`
3. success outcome as the post-run UI state that actually exists today
4. error outcome as the post-run error surface that actually exists today

Do not script an artificial persistent `SUCCESS` dialog if the implementation closes the progress dialog on completion.

All screenshot entry points must be deterministic and must not depend on manual timing guesses.

## Termination Criteria

Do not stop until all of the following are true:

1. CommoServe opens instantly with the required seeded values.
2. CommoServe verifies presets in the background with session reuse and no selection reset.
3. The download-page legal notice is present in the correct location.
4. REU save and restore follow the real transport-aware step model above.
5. REU errors terminate cleanly and visibly.
6. Structured REU diagnostics are sufficient to reconstruct a run.
7. Required tests and build steps pass, or unrelated failures are documented precisely.
8. Only the affected screenshots are refreshed.
