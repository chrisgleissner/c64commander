# Iteration 2 Continuation / Completion Handover Prompt

You are taking over an in-progress Iteration 2 session in:

- Repo: `/home/chris/dev/c64/c64commander`
- Branch: `fix/performance-iteration-2`
- Iteration directory: `/home/chris/dev/c64/c64commander/docs/plans/performance/iteration2`

Your job is to continue from the current artifact-backed state and either:

1. finish Iteration 2 with an honest conclusive final run, or
2. close the currently open run with a fully evidenced blocker state if the hardware remains unavailable.

Do not summarize and stop. Do not ignore the artifact history already in `runs/`. Do not assume the older handover state is still current.

## Read first

Read these before acting:

1. `docs/plans/performance/iteration2/README.md`
2. `docs/plans/performance/iteration2/plan.md`
3. `docs/plans/performance/iteration2/auto-safety-mode-spec.md`
4. `docs/plans/performance/iteration2/cta-inventory.md`
5. `docs/plans/performance/iteration2/soak-scenarios.md`
6. `docs/plans/performance/iteration2/parallelization.md`
7. `docs/plans/performance/iteration2/proof-of-work.md`
8. `docs/plans/performance/iteration2/agent-prompt.md`
9. `docs/plans/performance/iteration2/worklog.md`
10. this file

## Current repository state at handoff

The worktree is **dirty** at handoff time. Do not revert unrelated changes.

Directly relevant modified files currently include:

- `docs/plans/performance/iteration2/handover-prompt.md`
- `docs/plans/performance/iteration2/worklog.md`
- `src/components/diagnostics/DiagnosticsDialog.tsx`
- `src/components/diagnostics/GlobalDiagnosticsOverlay.tsx`
- `src/pages/ConfigBrowserPage.tsx`
- multiple HVSC / Settings / licenses files and their unit tests
- `package.json`, `package-lock.json`
- generated Capacitor platform files (`android/app/capacitor.build.gradle`, `android/capacitor.settings.gradle`, `ios/App/Podfile`)

There is also an untracked directory:

- `docs/plans/performance/playback-and-volume-control/`

Assume other modified files may belong to concurrent work unless you verify otherwise.

## Validation already completed in this state

These validations have already succeeded on the current dirty state:

1. `npm run test:coverage` — passed at **91.60% branch coverage**
2. `npm run lint` — passed
3. `npm run build` — passed

Important caveats:

- `docs/plans/performance/iteration2/runs/56134e09-e4c5-436c-87b5-48dc1f485277/timings/diagnostics-open.csv` still contains only the header row, so `N3` is **not** honestly complete.
- You should still run `npm run cap:build` and redeploy the latest APK before declaring Iteration 2 done if any additional code changes are made or if you need a final on-device proof after recovery.

## Recent committed fixes that matter

Recent relevant commits already on the branch include:

1. `73dcc2c7da466110d634cff5390477cef77a40c4` — `Skip idle HVSC cache probes before install`
2. `f1c4b3f7b0c69c5bc18bd42b813de47f0c266f4c` — `Skip HVSC songlength probes before install`
3. `241ece686a0981d84a50348e3a60efdccae3ac65` — `Clean up diagnostics header and replay noise`
4. `1b2c61336e34246e3aa7bc83f7146798feaa11f2` — `Correct handling of expected failures`
5. `8f9963c5` — `Improve HVSC settings and licenses layout`
6. `be225f62` — `Record iteration 2 blocker evidence`
7. `96ba4019` — `Fix saved device picker selection`
8. `7764ee37` — `Fix diagnostics soak regressions`

Uncommitted but already validated-in-worktree changes include:

- the `ConfigBrowserPage` clock-month sync fix with regression coverage
- the current Diagnostics open-path performance optimization pass with regression coverage

## Closed runs already on disk

These runs already have `summary.json` and should be preserved:

1. `runs/1f355b53-7cca-49e2-8542-15dc2052d01c/summary.json`
2. `runs/30b99a0b-4847-45e6-b707-29ee78712866/summary.json`
3. `runs/6741550e-a2f4-49ce-bcbf-2dde0af717c9/summary.json`
4. `runs/622d42fb-9371-4bc3-8a2d-815a8efb1761/summary.json`
5. `runs/38cc2862-eb4a-4a6b-bafa-3486e5166968/summary.json`
6. `runs/8678e3b1-eee1-46a2-9ce4-17c294a8bfc2/summary.json`
7. `runs/8dd74636-54ba-4a69-aafa-d9114af8446e/summary.json`

Important clean replay evidence still worth keeping:

1. `runs/b20f8ead-ac6d-4ef2-81d5-082e8289af38/oracles/screenshots/diagnostics-empty-after-switch-replay.png`
2. `runs/b20f8ead-ac6d-4ef2-81d5-082e8289af38/oracles/screenshots/abort-fix-diagnostics-no-abort-row.png`

## Current active run

The currently open run is:

- `docs/plans/performance/iteration2/runs/56134e09-e4c5-436c-87b5-48dc1f485277/`

Important state:

- `summary.json` is still **absent**
- `logcat.txt`, `logcat.errors.ndjson`, `steps.ndjson`, `screen.mp4`, `screen.001.mp4`, `screen.002.mp4`, `safety/*.ndjson`, and `timings/*.csv` are present
- `timings/diagnostics-open.csv` still has only the header row
- `runs/HARDWARE_LOCK.json` still points at `56134e09-e4c5-436c-87b5-48dc1f485277`, but the lock is stale:
  - `acquiredAt`: `2026-05-19T21:39:59.939947Z`
  - `expiresAt`: `2026-05-19T23:09:59.939947Z`

Treat the lock as stale and re-establish safe hardware ownership before doing any device work.

## What the active run has already proven

The open run `56134e09-e4c5-436c-87b5-48dc1f485277` already contains artifact-backed passes for:

1. `S1`
   - `S1-c64u-bad-host-visible-error`
   - `S1-u64-recover-and-delete-throwaway`
2. `S2`
3. `S3`
   - full gauntlet completed for both `u64` and `c64u`
4. `S5`
   - all `c64u` theme/dev-mode legs plus consolidated `u64` pass
5. `S7`
6. `S8`
7. `X1`
   - `u64` and `c64u` legs both recorded
8. `C1`
9. `C2`
   - includes the post-fix successful clock sync replay
10. `D1`
11. `H4`
12. `N4`
13. `P1`
14. `P2`
15. `P3`

The run also contains one successful `S4-u64-to-c64u` step followed by a later **blocking** `S4-postfix-c64u-reset` failure when `c64u` reset again.

## Latest blocker evidence

The last artifact-backed state still points to `c64u` as the hard blocker.

Evidence already on disk:

- `docs/plans/performance/iteration2/runs/56134e09-e4c5-436c-87b5-48dc1f485277/safety/c64u-reachability.ndjson`
- `docs/plans/performance/iteration2/runs/56134e09-e4c5-436c-87b5-48dc1f485277/logcat.txt`
- `docs/plans/performance/iteration2/worklog.md` (`2026-05-20 07:38 UTC` entry)

At the time of this handoff, a fresh ad-hoc live probe from the host produced:

- `u64`: `curl: (28) Connection timed out after 5002 milliseconds`
- `c64u`: `curl: (56) Recv failure: Connection reset by peer`

Do **not** over-trust those two ad-hoc probe results. Re-probe from both host and Pixel at takeover time and record the new truth before choosing whether to continue or close the run.

## What is still outstanding

Iteration 2 is still **not complete**. The remaining work is:

1. Re-establish hardware ownership and current device health honestly.
   - inspect `runs/HARDWARE_LOCK.json`
   - probe `u64` first, then `c64u`
   - verify from both host and Pixel when possible
2. Decide whether `56134e09-e4c5-436c-87b5-48dc1f485277` can still be continued honestly.
   - continue it only if capture continuity and device state are trustworthy
   - otherwise close it `inconclusive` with `summary.json`
3. Finish the remaining missing scenario coverage:
   - `N1`
   - `N2`
   - `N3` with a **real** `timings/diagnostics-open.csv` row, not the ad-hoc DOM stopwatch
   - `H1`
   - `H2`
   - `H3`
   - `P4`
   - `P5` if budget still allows
   - `D2`
   - `S4` cleanly, without the `c64u` reset failure
   - verify whether `S6` should be appended from existing artifacts or rerun; screenshots/state exist but there is no `S6` step row in `steps.ndjson`
4. Complete CTA coverage against `cta-inventory.md`.
5. Produce the final honest disposition:
   - final conclusive run if both devices recover and the missing scenarios are finished, or
   - final blocker-state closeout if `c64u` remains externally unavailable
6. Finalize artifacts:
   - append any missing `steps.ndjson` rows
   - keep `logcat.errors.ndjson` honest
   - keep `safety/c64u-reachability.ndjson` current during `c64u` legs
   - write `summary.json` for `56134...` or for the fresh replacement run
7. Append `worklog.md` without rewriting history.
   - include the current diagnostics perf / clock-fix progress
   - include the final disposition of run `56134...`
   - include the eventual completion run or blocker closeout
8. Commit the outstanding code changes in coherent commits without collapsing prior fix history.

## Recommended continuation sequence

1. Re-read `worklog.md`, `soak-scenarios.md`, `proof-of-work.md`, and `cta-inventory.md`.
2. Inspect `runs/HARDWARE_LOCK.json` and claim safe ownership explicitly.
3. Re-probe `u64` and `c64u` from the host.
4. If the host probes are ambiguous, re-probe from the Pixel 4 as well.
5. Decide run strategy:
   - if both devices are usable and capture can be re-established cleanly, continue `56134...`
   - if `c64u` is still broken, decide whether any remaining `u64`-only evidence is still worth banking or whether the honest move is to close `56134...` as `inconclusive`
6. If continuing:
   - re-establish logcat and screen capture
   - finish the missing scenarios listed above
   - make sure `N3` gets a real timing-marker artifact
   - keep CTA mapping current while you execute
7. If more product bugs surface:
   - fix the root cause
   - add narrow regression coverage
   - rebuild/redeploy
   - rerun the affected scenario
8. Before declaring Iteration 2 complete:
   - ensure `summary.json` exists for the concluding run
   - ensure both devices are represented in the final truthful story
   - run the required remaining validation for the final code state (`npm run cap:build` plus any deploy/replay steps still needed)

## Hard requirements for the next agent

1. Do **not** discard or overwrite prior run history.
2. Do **not** claim completion without:
   - exact final run ID
   - exact `summary.json` path
   - commit SHAs for the soak-found fixes
   - proof of what was covered on `u64`
   - proof of what was covered on `c64u`
3. Do **not** pretend `N3` passed until `timings/diagnostics-open.csv` contains real measurement rows.
4. Keep `worklog.md` append-only.
5. Preserve separate coherent fix commits.
6. If `c64u` remains degraded, say that plainly and close the run honestly instead of stretching partial evidence into a fake completion.

## Minimal truthful state summary

At handoff time:

- Iteration 2 is still open.
- The current open run is `56134e09-e4c5-436c-87b5-48dc1f485277`.
- That run already contains substantial artifact-backed passes across Settings, Config, Play, Disks, Home (`H4`), Docs, and navigation recovery.
- `S1` and `S3` are no longer outstanding in this run.
- `N3` is still unresolved because the real diagnostics-open timing artifact is missing.
- `S4` still needs a clean final pass without the `c64u` reset.
- `N1`, `N2`, `H1`, `H2`, `H3`, `P4`, `P5` if needed, `D2`, and likely `S6` still need explicit closeout.
- `npm run test:coverage`, `npm run lint`, and `npm run build` have passed on the current dirty state.
- The live hardware picture is currently degraded/uncertain and must be re-probed before the next device action.
