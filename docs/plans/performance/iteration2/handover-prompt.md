# Iteration 2 End-to-End Takeover Prompt

You are taking over an in-progress Iteration 2 session in:

- Repo: `/home/chris/dev/c64/c64commander`
- Branch: `fix/performance-iteration-2`

Your job is **not** to finish a tiny leftover task and stop. Your job is to drive Iteration 2 to a state where it is **proven complete with hardware-backed evidence**.

That means:

1. finish any remaining code or validation work that blocks the soak,
2. run the real Android HIL loop on the Pixel 4 against `u64` and, if healthy/available at preflight, `c64u`,
3. fix any product bugs the soak surfaces,
4. add regression coverage for every bug fix,
5. redeploy and rerun until one end-to-end artifact set proves that all CTA shapes and required scenarios are green.

You must keep working until one of these is true:

1. **Full completion is proven** by artifacts and clean reruns, or
2. **A real external blocker** prevents completion and is documented with concrete evidence.

Anything else is an invalid stopping point.

---

## Read first - mandatory order

Do not rely on memory. Read these in order before acting:

1. `CLAUDE.md`
2. `.github/copilot-instructions.md`
3. `docs/plans/performance/iteration2/README.md`
4. `docs/plans/performance/iteration2/plan.md`
5. `docs/plans/performance/iteration2/auto-safety-mode-spec.md`
6. `docs/plans/performance/iteration2/cta-inventory.md`
7. `docs/plans/performance/iteration2/soak-scenarios.md`
8. `docs/plans/performance/iteration2/parallelization.md`
9. `docs/plans/performance/iteration2/proof-of-work.md`
10. `docs/plans/performance/iteration2/agent-prompt.md`
11. `docs/plans/performance/iteration2/worklog.md`
12. this file

---

## Important scope guard

- **Ignore the earlier joystick / keyboard injection latency request.** The user explicitly said that message belonged to another project and must not shape this work.

---

## What Iteration 2 is actually trying to achieve

The real target is the one described by the Iteration 2 docs:

- a **full deep-dive HIL verification** on a real Pixel 4,
- against real `u64`,
- and against real `c64u` whenever it is healthy/available at preflight,
- proving that **all routed pages, all features in scope, all distinct CTA / interaction shapes, and all required oracles** hold up under fast real-user cadence,
- with **zero unexpected user-visible errors**, **zero crashes**, **zero ANRs**,
- while `AUTO` safety mode correctly resolves to:
  - `BALANCED` on `u64` / `U64*`
  - `CONSERVATIVE` on `c64u` / `C64U`
- and with `c64u` still REST-reachable at end of soak.

Do **not** reduce this to “finish a small diagnostics tweak” or “run one smoke test”.

---

## Definition of done

You are done only when all of the following are true:

1. Any outstanding code or UX follow-up needed for the soak is implemented, validated, deployed, and committed.
2. There is a fresh `runs/<runId>/` artifact directory under `docs/plans/performance/iteration2/runs/`.
3. That artifact set satisfies `proof-of-work.md`.
4. CTA coverage is complete:
   - every interaction shape in `cta-inventory.md` was exercised at least once,
   - every required scenario/leg from `soak-scenarios.md` was exercised as required.
5. The final run meets the responsiveness budgets in `plan.md`.
6. The final run has:
   - zero unexpected user-visible errors,
   - zero crashes,
   - zero ANRs.
7. `AUTO` safety mode is active for the run, and the safety trail proves correct resolution on every device leg.
8. `c64u` is reachable at end-of-run if it was healthy at preflight.
9. `worklog.md` has the required append-only entries reflecting what happened.
10. Your final response points to the exact run directory and exact commit SHAs that prove completion.

If you do not have all of the above, you are not done.

---

## Current repository state

Already completed and committed:

1. `6dc4813d` — `Implement AUTO device safety mode`
2. `0b869db2` — `Audit Phase B CTA inventory`

Interpret that as:

- **Phase A is complete.**
- **Phase B is complete.**

The current worklog already includes Phase A and Phase B entries.

### Current uncommitted worktree state

At handoff time, the remaining uncommitted files are:

1. `src/components/diagnostics/ActionExpandedContent.tsx`
2. `tests/unit/components/diagnostics/ActionExpandedContent.test.tsx`

These edits are a legitimate follow-up and should be treated as real work, not noise:

- show the **full REST request URL** in diagnostics expanded content,
- preface the REST section with a one-line user-action summary,
- preserve pretty JSON bodies,
- suppress hex/ascii payload preview when a decoded body is already available,
- still show the preview when there is no decoded body.

### Validation already completed for that follow-up

These already passed after those uncommitted edits:

1. Focused tests:
   - `tests/unit/components/diagnostics/ActionExpandedContent.test.tsx`
   - `tests/unit/components/diagnostics/DiagnosticsDialog.test.tsx`
2. `npm run lint`
3. `npm run build`
4. `npm run cap:build`

### Validation still required for that follow-up

The clean validation still required is:

1. `npm run test:coverage`
2. Pixel 4 verification of the REST diagnostics rendering
3. A separate commit for that follow-up if it still stands after validation

Do not trust any stale/interrupted coverage run from the prior session.

---

## Device and lab state known at handoff

- Pixel 4 serial: `9B081FFAZ001WX`
- Hosts:
  - `u64`
  - `c64u`
- A recent debug APK was built and installed successfully from:
  - `android/app/build/outputs/apk/debug/c64commander-0.7.9-rc1-debug.apk`

Phase A on-device verification already succeeded in this session:

- Settings showed `Auto (Conservative for C64U, Balanced for others) - recommended`
- Diagnostics showed:
  - `Balanced` for `u64`
  - `Conservative` for `c64u`

That proves the lab was functional at that point. It does **not** replace the final soak evidence.

---

## How you must execute from here

### Stage 1 - Close the remaining uncommitted follow-up cleanly

1. Re-read the two uncommitted files and confirm they still match the user ask.
2. Run the required validation:
   - `npm run test:coverage`
   - any targeted tests you need if coverage reveals failures
3. Deploy the latest APK to the Pixel 4.
4. Verify on-device that diagnostics expanded REST content now shows:
   - the full request URL,
   - a one-line user activity prefix,
   - readable pretty JSON request body / response body.
5. Commit that follow-up separately if valid.

Do not let this stage consume the entire mission. It is a prerequisite clean-up step, not the objective.

### Stage 2 - Execute Phase C / D as real HIL work

After the follow-up is closed, move directly into the real HIL verification loop:

1. Acquire hardware lock per `parallelization.md`.
2. Generate a fresh `runId`.
3. Run full preflight exactly as required by:
   - `soak-scenarios.md`
   - `proof-of-work.md`
   - `agent-prompt.md`
4. If `c64u` is degraded at preflight:
   - do **not** pretend completion,
   - do **not** claim Iteration 2 pass,
   - continue all work that can honestly proceed,
   - record the blocker and treat final status as blocked/inconclusive unless/until `c64u` is healthy enough for its legs.
5. Run the soak scenarios in the required order and capture the full artifact set.

### Stage 3 - Treat the first failing soak as input, not as the finish line

If the first real HIL run fails:

1. Identify each product defect from artifacts.
2. Fix it in code.
3. Add a regression test that fails before the fix and passes after.
4. Run the relevant validation.
5. Redeploy to Pixel 4.
6. Re-run the relevant scenario(s), or the full soak if the fix touches global/shared infrastructure.
7. Repeat until one end-to-end run is clean.

Do **not** stop after the first failing soak with “here are the bugs”.
That is not completion. That is just triage.

---

## Rules for stopping

You may stop only for one of these reasons:

1. **Clean completion**:
   - all required code follow-ups are merged,
   - one final artifact-backed run proves Iteration 2 complete.
2. **Hard external blocker**:
   - Pixel 4 missing/offline,
   - `u64` unreachable,
   - `c64u` unavailable or degraded in a way that prevents its required legs,
   - hardware lock conflict you cannot resolve,
   - missing mandatory tool/server required by the documented plan.

If blocked, your output must include:

- the exact blocker,
- evidence you captured,
- which stages completed,
- what remains once the blocker is removed.

You may **not** stop because:

- “the remaining work is just soak”
- “the first failing soak already found bugs”
- “the prompt file already exists”
- “the code change was already committed”
- “u64-only looked good”
- “c64u was skipped but probably would be fine”

Those are all invalid stop conditions.

---

## Artifact discipline

For the final credible run, you must produce the full artifact structure described in `proof-of-work.md`, including at least:

- `preflight.json`
- `device-info.json`
- `logcat.txt`
- `logcat.errors.ndjson`
- `screen.mp4` (rotated if needed)
- `steps.ndjson`
- `oracles/`
- `safety/safety-mode-trail.ndjson`
- `safety/c64u-reachability.ndjson`
- `timings/*.csv`
- `summary.json`

Every verdict claim must be derivable from those files.

If artifacts do not support the verdict, the verdict is invalid.

---

## Worklog discipline

Append to `docs/plans/performance/iteration2/worklog.md` only. Never rewrite prior entries.

You must append entries for:

1. the REST diagnostics follow-up close-out,
2. each meaningful soak run,
3. each fix/rerun cycle that materially changes product state,
4. the final conclusive clean run or final blocker state.

---

## Commit discipline

Keep commits coherent:

1. Phase A and Phase B are already done — do not rewrite them.
2. The current REST diagnostics follow-up should be its own commit if validated.
3. Any soak-found product bug should get its own minimal fix commit with regression coverage.
4. Include the required Copilot co-author trailer on commits.

---

## Pixel 4 / WebView verification tip

The app is a WebView, so deep inspection is easier through WebView devtools than raw UI taps.

This pattern already worked in the prior session:

1. Get PID:
   - `adb -s 9B081FFAZ001WX shell pidof uk.gleissner.c64commander`
2. Forward socket:
   - `adb -s 9B081FFAZ001WX forward tcp:9222 localabstract:webview_devtools_remote_<PID>`
3. List targets:
   - `curl -s http://127.0.0.1:9222/json/list`
4. Evaluate JS with Python `websocket-client` using `suppress_origin=True`

Use that when it is the cleanest way to verify rendered app state on the real device.

---

## Final response requirements

Your final response, when you are truly done, must name:

1. the commit SHA for the REST diagnostics follow-up, if committed,
2. the commit SHAs for any soak-found bug fixes,
3. the final clean `runId`,
4. the exact path to `runs/<runId>/summary.json`,
5. whether `u64` and `c64u` were both covered in the final conclusive run,
6. any remaining blockers or caveats.

If you cannot supply those, you are probably not done.

---

## Short operational summary

Start by closing the remaining uncommitted diagnostics follow-up.

Then do **not** hand off again and do **not** stop at the first soak result.

Keep going through:

- validation,
- deploy,
- HIL soak,
- bug triage,
- regression fix,
- redeploy,
- rerun,

until Iteration 2 is actually proven complete or a real external blocker makes completion impossible.
