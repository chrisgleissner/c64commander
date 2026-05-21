# Handover Prompt - Playback and Volume Control

You are picking up an in-progress iteration of the C64 Commander
performance program. Specifically, the work in:

- Repo: `/home/chris/dev/c64/c64commander`
- Branch: whatever the working branch is at handover time (likely
  `fix/playback-and-volume-control` or similar; if not, check
  `git branch --show-current` and continue on the active branch).
- Iteration directory:
  `/home/chris/dev/c64/c64commander/docs/plans/performance/playback-and-volume-control`

Your job is to **continue from the current artifact-backed state and
drive this iteration to actual completion**: not to summarize, not to
stop at another partial soak, and not to treat the latest in-progress
run as done just because some scenarios are already green.

## Read first

Read all of these before acting:

1. `docs/plans/performance/playback-and-volume-control/README.md`
2. `docs/plans/performance/playback-and-volume-control/plan.md`
3. `docs/plans/performance/playback-and-volume-control/root-cause-hypotheses.md`
4. `docs/plans/performance/playback-and-volume-control/soak-scenarios.md`
5. `docs/plans/performance/playback-and-volume-control/regression-tests.md`
6. `docs/plans/performance/playback-and-volume-control/proof-of-work.md`
7. `docs/plans/performance/playback-and-volume-control/agent-prompt.md`
8. `docs/plans/performance/playback-and-volume-control/worklog.md`
9. `CLAUDE.md` and `AGENTS.md` at the repo root.
10. This file.

You may not start work without reading the above.

## What is already complete

Inspect `worklog.md` and `runs/`. For each entry in `worklog.md`:

- Identify the `runId` and its `summary.json` path.
- Confirm the verdict by reading `summary.json` directly. Do not
  trust the worklog line alone; the worklog is a pointer, not the
  source of truth.
- Cross-reference with `git log` to identify which fixes are
  committed and which are still pending.

For each hypothesis in `root-cause-hypotheses.md`:

- Check the file:line citation. If the file has been refactored,
  re-locate the same code path and update the hypothesis with the
  new citation.
- Look for a commit message that ties to the hypothesis. A commit
  like "Fix slider snap-back on commit reconciliation" maps to H1.
- Look for a regression test that ties to the hypothesis per
  `regression-tests.md`.

If a hypothesis has a commit but no test, **stop and add the test
before continuing**.

## What is outstanding

At minimum, the following must be true before the iteration closes:

1. Every confirmed hypothesis has:
   - a regression test that fails before the fix and passes after,
     at the layer specified in `regression-tests.md`;
   - a focused commit on the working branch;
   - a scenario re-run in `runs/` proving the fix.
2. A single Phase 4 run exists with `overallVerdict: "PASS"` and a
   complete artifact set per `proof-of-work.md`.
3. `npm run test:coverage` passes globally at >= 91% branch coverage.
4. `npm run lint`, `npm run build`, `npm run cap:build` all pass.
5. The latest APK from `android/app/build/outputs/apk/` has been
   deployed to the attached Pixel 4 (serial prefix `9B0`) and the
   smoke-soak from `plan.md` Phase 5 has been performed.
6. `worklog.md` has appended entries for every commit and every
   run.

## Recommended continuation sequence

1. Read `worklog.md` and `runs/` directories. Decide whether the
   active run is salvageable or should be closed as `INCONCLUSIVE`
   and a fresh run started.
   - Salvage only if: capture (screenrecord + logcat) is still
     valid, you trust artifact continuity, and you can re-establish
     the Pixel 4 + `u64` lab state cleanly. Otherwise: write
     `summary.json` for the active run as `INCONCLUSIVE`, append a
     worklog entry, mint a fresh `runId`, and start over.
2. Re-establish capture (logcat tail, screenrecord rotation).
3. Confirm preflight per `agent-prompt.md`. If any preflight check
   fails, demote and stop.
4. Continue from the last unfinished scenario per the order in
   `soak-scenarios.md`. Do not restart finished scenarios in this
   run; their artifacts are already final.
5. After all scenarios complete, finalize artifacts and `summary.json`.
6. If any scenario failed, switch to the fix loop:
   - Confirm hypothesis maps to the failure.
   - Write regression test per `regression-tests.md`.
   - Implement minimal fix.
   - Commit, push to branch (do not open PR yet).
   - Deploy APK to Pixel 4 (`./build --install-apk` or equivalent
     per `CLAUDE.md`).
   - Re-run the failing scenario(s). If they pass, continue.
7. Once all scenarios pass in one run, that is the Phase 4 run.
   Perform Phase 5 (deploy validation + smoke-soak).
8. Run the coverage gate (`npm run test:coverage`). Add tests
   until >= 91%.
9. Append the final `worklog.md` entry. Stop.

## Hard requirements for the next agent

- Do **not** stop at another first-failing soak.
- Do **not** throw away the artifact-backed history already in
  `runs/`.
- Do **not** claim completion without:
  - exact final `runId`,
  - exact `summary.json` path,
  - commit SHAs for the soak-found fixes,
  - proof that the Pixel 4 + `u64` were both healthy at run-start
    and run-end.
- Do **not** lower coverage thresholds, weaken safety presets, or
  delete failing tests.
- Do **not** edit `MEMORY.md` or other personal notes.
- Keep `worklog.md` append-only.
- Preserve the coherent separate fix commits already on the branch.
- If you discover an unexpected file in the worktree, keep it as-is.
  It may be in-progress work from a concurrent session.

## Minimal truthful state summary

Before you start work, write a one-paragraph "state at handoff"
summary in `worklog.md` as a comment block. Include:

- The branch name and current HEAD SHA.
- The number of runs in `runs/` and their verdicts.
- Which hypotheses are confirmed, refuted, or unproven.
- Whether the on-device APK is current with the branch HEAD.
- Whether the Pixel 4 is currently attached and `u64` is reachable.

This block exists so the human reviewer can see, without reading the
entire worklog, what the agent thought the state was when it
started. Be honest. "Unknown" is allowed; "passing" without evidence
is not.
