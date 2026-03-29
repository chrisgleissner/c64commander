# HVSC Remaining Proof Prompt

## Role

You are a senior Android, TypeScript, and test-infrastructure reliability engineer finishing the remaining HVSC proof work in C64 Commander at `/home/chris/dev/c64/c64commander`.

This prompt is intentionally narrower than `docs/plans/hvsc/fix-hvsc-workflow.md`.

Do not restart the full investigation. Focus only on the remaining proof gaps:

1. Prove that automated tests running locally and in CI cover the full HVSC workflow:
   - download
   - ingest
   - add to playlist
   - playback
2. Prove that HIL tests cover the same workflow on a real Pixel 4 and a real C64U, including analysis of the real audio stream returned by the C64U.
3. Ensure your execution model cannot hang indefinitely when commands, device interactions, or captures are slow.

Read and follow `AGENTS.md` and `.github/copilot-instructions.md` first.

## Mandatory Read Order

Read only this minimum set before acting:

1. `docs/plans/hvsc/existing-agentic-test-analysis.md`
2. `docs/plans/hvsc/fix-hvsc-workflow.md`
3. `docs/testing/agentic-tests/agentic-infrastructure-reuse.md`
4. `docs/testing/agentic-tests/agentic-oracle-catalog.md`
5. `docs/testing/agentic-tests/gap-analysis/research1/coverage-matrix.md`
6. `docs/testing/physical-device-matrix.md`
7. `playwright/hvsc.spec.ts`
8. `.maestro/smoke-hvsc.yaml`
9. `.maestro/edge-hvsc-ingest-lifecycle.yaml`
10. `.maestro/edge-hvsc-repeat-cancel-resume.yaml`
11. `android/app/src/test/java/uk/gleissner/c64commander/HvscIngestionPluginTest.kt`
12. `android/app/src/test/java/uk/gleissner/c64commander/HvscSevenZipRuntimeTest.kt`
13. `tests/unit/sourceNavigation/hvscSourceAdapter.test.ts`
14. `tests/unit/components/itemSelection/ItemSelectionDialog.test.tsx`
15. `tests/unit/pages/playFiles/handlers/addFileSelectionsArchive.test.ts`
16. `tests/unit/playFiles/usePlaybackController.test.tsx`
17. `tests/unit/playFiles/usePlaybackPersistence.test.tsx`
18. `tests/unit/hvsc/hvscBrowseIndexStore.test.ts`
19. `c64scope/src/hilEvidenceRun.ts`
20. `c64scope/src/validation/cases/playback.ts`

## Current Repo Reality You Must Account For

- Existing agentic prompts `F015` and `F016` are useful prior art, but they stop short of a full playlist-and-playback proof.
- The deeper gap-analysis matrix still marks playlist generation from downloaded HVSC songs and downloaded-HVSC playback as blocked.
- `playwright/hvsc.spec.ts` exercises the full chain in a mock/web runtime, which is useful for CI-safe flow coverage but not for native/HIL proof.
- The existing Maestro HVSC flows prove native sequence shape and cancel/retry behavior, but not complete artifact correlation and not streamed-audio playback success.
- `HvscIngestionPluginTest.kt` and `HvscSevenZipRuntimeTest.kt` are the right native contract prior art for real archive ingestion, but they do not prove the app UI browse/import/play chain.
- `c64scope/src/validation/cases/playback.ts` already defines the authoritative streamed-audio threshold for non-silent playback: packet count greater than zero and RMS at least `0.005`.
- `docs/testing/physical-device-matrix.md` still under-specifies the HVSC playback requirement. Do not mistake ingest-only evidence for end-to-end proof.

## Non-Hang Execution Policy

This section is mandatory. You must not run any command or wait in a way that can block forever.

### Global Rules

1. Every command must have a bounded runtime.
2. Every long-running phase must have a hard wall-clock budget.
3. Every polling loop must have:
   - a success predicate
   - a slice timeout
   - a maximum number of slices
4. If a command or wait exceeds its budget, stop it, capture evidence, and classify the step as `FAILED` or `BLOCKED`.
5. Never use an unbounded foreground command for:
   - `adb logcat`
   - `screenrecord`
   - watch modes
   - packet capture
   - server startup that keeps running
   - any `tail -f`-style command

### Terminal and Task Discipline

1. Prefer existing finite tasks only when they are known to terminate on their own.
2. For any command with uncertain duration, run it in a background terminal and poll in slices.
3. If you must use a raw shell command, also wrap it with shell-level `timeout` when available.
4. Never use a foreground terminal call with an unbounded tool timeout.
5. For background commands, always record:
   - terminal id
   - start time
   - expected completion condition
   - hard stop budget

### Required Slice Polling Pattern

For long-running commands, use this pattern:

1. Start in background.
2. Poll every 15 to 30 seconds.
3. After each poll, record whether there is new output or new external progress.
4. If there is no new progress for 120 seconds, treat the step as stalled.
5. Kill the background command after the hard budget expires.

### Hard Budgets

Use these maximum budgets unless you have stronger repo-local evidence for a lower safe bound:

- `npm run lint`: 10 minutes
- `npm run test`: 20 minutes
- `npm run test:coverage`: 30 minutes
- `npm run build`: 10 minutes
- `cd android && ./gradlew test`: 30 minutes
- targeted Playwright suite: 15 minutes
- targeted Maestro flow: 15 minutes
- one cold HVSC download plus ingest attempt: 90 minutes
- one cache-reuse ingest attempt: 30 minutes
- one HIL playback capture window: 3 minutes
- one HIL preflight command: 2 minutes

### Stall Rules for Slow HVSC and HIL Phases

Treat the phase as stalled if any of these is true for 120 seconds:

- no new HVSC progress phase
- no new byte count or percentage movement
- no new log lines tied to the active step
- no new cache or artifact growth where growth is expected
- no UI change after an interaction that should trigger a new state

When a stall happens:

1. save screenshots and logs
2. save terminal output or task output
3. stop the process cleanly if possible
4. classify the fault as one of:
   - app
   - test
   - environment
   - observability
   - determinism
5. do not retry more than once unless the first failure is clearly transient

## Mission

Close the remaining proof gap so the repository has an honest automation story and an honest HIL story for the HVSC workflow.

You are not done until you have both:

1. an automation coverage map that shows how local and CI-safe tests cover every workflow stage
2. a real HIL workflow that drives the app from HVSC download through C64U streamed-audio verification

## Required Deliverables

### Deliverable A: Automation Coverage Map

Create or update a repo-local matrix under `docs/plans/hvsc/` that maps each workflow stage to exact tests and oracles.

Minimum stages:

1. HVSC remote download request
2. archive download completion
3. ingest start and progress
4. ingest completion into the real queryable source
5. HVSC browse in the add-items UI
6. song selection and add-to-playlist
7. playlist persistence and reload
8. playback request routing
9. duration and subsong preservation
10. observable playback success

For each stage, record:

- exact test file(s)
- whether the test is CI-safe
- whether it runs locally
- oracle class used
- what it still does not prove

### Deliverable B: CI-Safe Automated Coverage

Strengthen or add the smallest coherent test set needed so that the combined automated suite covers the full chain.

You must explicitly reuse and, if needed, strengthen these layers:

- JS/TS unit and hook tests for metadata preservation and persistence:
  - `tests/unit/sourceNavigation/hvscSourceAdapter.test.ts`
  - `tests/unit/components/itemSelection/ItemSelectionDialog.test.tsx`
  - `tests/unit/pages/playFiles/handlers/addFileSelectionsArchive.test.ts`
  - `tests/unit/playFiles/usePlaybackController.test.tsx`
  - `tests/unit/playFiles/usePlaybackPersistence.test.tsx`
  - `tests/unit/hvsc/hvscBrowseIndexStore.test.ts`
- Playwright web/runtime flow coverage:
  - `playwright/hvsc.spec.ts`
- Android JVM native-ingest coverage:
  - `android/app/src/test/java/uk/gleissner/c64commander/HvscIngestionPluginTest.kt`
  - `android/app/src/test/java/uk/gleissner/c64commander/HvscSevenZipRuntimeTest.kt`

You must prove that the automated suite, taken together, exercises:

- download
- ingest
- browse
- add to playlist
- playback request generation

If one stage is covered only indirectly, say so explicitly and fix it if the gap matters.

### Deliverable C: HIL Workflow Proof

Add or strengthen the HIL case so it proves the app-first flow on a real Pixel 4 and a real C64U.

The HIL run must include:

1. real device preflight
2. real C64U reachability check
3. cold HVSC download and ingest
4. browse HVSC through the app UI
5. add a downloaded HVSC track to the playlist through the app UI
6. play that playlist item through the app UI
7. capture the real C64U audio stream during playback
8. analyze the stream using the repo's existing `c64scope` audio-analysis path
9. correlate the selected track, the playback action timeline, and the audio artifact

### Deliverable D: HIL Audio Proof Rules

For the playback verdict, the primary oracle must include all of the following:

- app action timeline showing the playback initiation
- UI confirmation that the selected HVSC track became the current track
- diagnostics or logs tying the action to the selected source item
- `c64scope` audio capture artifacts for the playback window
- packet count greater than zero
- RMS at least `0.005` unless you change the threshold with regression evidence

Do not declare success from:

- a visible Stop button alone
- highlighted playlist row alone
- a playback request log alone
- local host audio alone

### Deliverable E: State Hygiene and Repeatability

The HIL workflow must explicitly distinguish:

- summary reset
- cache reuse
- real cache clear
- playlist clear

You must prove both:

1. cold path from no installed HVSC state
2. warm path that reuses cache instead of redownloading

If the repo still lacks a deterministic executor for a necessary step, document the smallest missing piece and classify honestly.

## Required Analysis Before Editing

Before you change code or prompts, produce a short written map of:

1. what `F015` proves
2. what `F016` proves
3. what Playwright proves
4. what Maestro proves
5. what Android JVM proves
6. what `c64scope` proves
7. which stage or stages still lack honest proof

You must explicitly acknowledge the contradiction between current PASS markings and the deeper gap-analysis matrix.

## Validation Scope

This task is a `CODE_CHANGE` unless you end up touching only plan docs.

If you touch executable code or tests, run the smallest honest set that covers your change set, with bounded execution:

- `npm run lint`
- `npm run test`
- `npm run test:coverage`
- `npm run build`
- `cd android && ./gradlew test`
- targeted Playwright and Maestro/HIL runs relevant to the changed proof path

If any repo-wide suite fails due to unrelated worktree changes or pre-existing environment issues, isolate that fact with evidence and do not pretend the gate passed.

## HIL Preconditions

Do not continue to a HIL success claim unless all of these are true:

- `adb devices -l` shows a physical device
- the physical device is a real Pixel 4
- the app package is installed
- `c64u` is reachable from the current environment
- the stream-capture path is available

If any precondition fails, stop with `BLOCKED`.

## Completion Gate

You are complete only if all of the following are true:

1. the automation coverage map exists and is accurate
2. the combined local and CI-safe tests honestly cover the HVSC workflow stages listed above
3. the real HIL workflow drives the app from download to streamed-audio playback proof
4. the execution log shows no unbounded waits or hanging commands
5. all artifacts are saved under a stable repo-local path under `docs/plans/hvsc/`

## Completion Output

Your final output must include:

- terminal state: `COMPLETE`, `FAILED`, or `BLOCKED`
- files changed
- exact tests run
- exact HIL runs attempted
- automation coverage map summary
- streamed-audio evidence summary
- any step that still lacks honest proof

If the HIL playback path did not produce real streamed-audio proof from the C64U, say exactly:

`Task is not complete.`
