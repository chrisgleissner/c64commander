# Agent Prompt - Playback and Volume Control Soak

This prompt is **self-contained**. It is meant to be invoked verbatim by
an autonomous coding agent (Claude Code, GitHub Copilot, OpenAI Codex,
or equivalent) inside the repo at `/home/chris/dev/c64/c64commander`.

The agent has filesystem access to this repo, shell access, and the
following MCP servers documented under `docs/testing/agentic-tests/`:

- `droidmind` for Android device control over adb,
- `c64bridge` to talk to the U64 over its REST/Telnet surface,
- `c64scope` for capture, replay, evidence stewardship.

## Your job

Run the soak defined by `docs/plans/performance/playback-and-volume-control/soak-scenarios.md`
on a real Pixel 4 attached over adb (serial prefix `9B0`) against a
real Ultimate 64 Elite at host `u64`, with AUTO safety mode active
(resolved to BALANCED). Produce a complete artifact set under
`docs/plans/performance/playback-and-volume-control/runs/<runId>/` per
`proof-of-work.md`.

You are running one of two phases:

1. **Phase 2 - Baseline soak.** Goal: reproduce as many of the six
   hypotheses in `root-cause-hypotheses.md` as possible. Failures here
   are **expected** and required. If you cannot reproduce any
   hypothesis, that's a real signal: stop and report.
2. **Phase 4 - Final soak.** Goal: validate that all fixes hold under
   the full scenario set. Zero user-visible errors. Zero crashes.
   Every scenario verdict `PASS`.

The user will tell you which phase to run. If the user doesn't, infer
from the worklog: if no scenario yet has a verdict, run Phase 2.

## Read before acting

1. `docs/plans/performance/playback-and-volume-control/README.md`
2. `docs/plans/performance/playback-and-volume-control/plan.md`
3. `docs/plans/performance/playback-and-volume-control/root-cause-hypotheses.md`
4. `docs/plans/performance/playback-and-volume-control/soak-scenarios.md`
5. `docs/plans/performance/playback-and-volume-control/proof-of-work.md`
6. `docs/plans/performance/playback-and-volume-control/worklog.md`
7. `CLAUDE.md` and `AGENTS.md` at the repo root.

You may **not** start work without reading the above.

## Preflight

Run all of these in order. Any failing step demotes the run to
`INCONCLUSIVE` and stops the soak.

1. **Pixel 4 over adb.** `adb devices` shows a device whose serial
   starts with `9B0` in state `device`. Record the full serial in
   `preflight.json`.
2. **App installed.** `adb shell pm list packages | grep
   uk.gleissner.c64commander` returns a row.
3. **App version.** `adb shell dumpsys package
   uk.gleissner.c64commander | grep versionName`. Record.
4. **U64 reachable.** `adb shell curl -s -o /dev/null -w '%{http_code}
   %{time_total}\n' http://u64/v1/info` returns `200 <1.0`. Record
   reachable-ms.
5. **Battery.** `adb shell dumpsys battery | grep level`. If under
   30%, ask the user to plug in the Pixel 4 before proceeding.
6. **Stored safety mode.** Launch the app, navigate to Settings,
   confirm `Effective preset: Balanced - resolved from active device
   (U64 Elite, verified)`. If not, ask the user to switch AUTO mode
   back on before proceeding.
7. **Screen state.** `adb shell dumpsys power | grep
   mWakefulness` records the screen state.

Write `runs/<runId>/preflight.json` per `proof-of-work.md`.

## Run procedure

1. Mint `runId = $(uuidgen)`. Create the directory
   `runs/<runId>/{oracles,timings,screenshots,safety}`.
2. Start `adb shell logcat -d > runs/<runId>/logcat.txt` rolling
   capture in the background.
3. Start `adb shell screenrecord` in the background, rotating files
   every 170 seconds. Concatenate at the end with `ffmpeg`.
4. Run scenarios V1 -> V2 -> V3 -> V4 -> P1 -> P2 -> P3 -> P4 -> P5
   in order. For each scenario:
   - Append a `START` row to `steps.ndjson`.
   - Execute the gestures per `soak-scenarios.md` at the specified
     cadence.
   - Continuously emit oracle rows into the appropriate
     `oracles/*.ndjson` file.
   - Sample `adb shell curl http://u64/v1/info` once per minute and
     append to `safety/c64u-reachability.ndjson` (the file name is
     kept for compatibility with prior iterations even though the
     target here is `u64`).
   - Append an `END` row to `steps.ndjson` with the scenario verdict.
5. After all scenarios complete:
   - Stop screen recording, concatenate clips, save as `screen.mp4`.
   - Snapshot logcat once more; finalize `logcat.errors.ndjson`.
   - Probe `u64` REST one final time; record
     `u64InfoReachableAtEndMs`.
   - Write `summary.json` per `proof-of-work.md`.
6. Append a single conclusive line to `worklog.md`:
   ```
   <YYYY-MM-DDTHH:mm:ssZ> runId=<runId> verdict=PASS|FAIL|INCONCLUSIVE
   scenarios=V1:PASS,V2:PASS,V3:PASS,V4:PASS,P1:PASS,P2:PASS,P3:PASS,P4:PASS,P5:PASS
   notes="..."
   ```
7. Release any hardware locks you acquired (see
   `../iteration2/parallelization.md`).

## Hard requirements

- Do **not** skip scenarios. Every scenario gets a verdict, even if
  it's `INCONCLUSIVE`.
- Do **not** invent oracle rows. Every row must be derived from a
  real trace marker, real screen-recording frame, real logcat line,
  or real device echo.
- Do **not** declare `PASS` if any oracle file shows a non-zero
  failure count.
- Do **not** silently relax cadence. If the agent harness cannot
  reach the required cadence (e.g. 5 taps per second on the mute
  button), record the actual cadence in `notes` and demote to
  `INCONCLUSIVE`.
- Do **not** edit source code during the soak. Source changes belong
  to Phase 3 and have their own commit cadence.
- Do **not** invoke `/ultrareview`, push to a remote, or land any
  PR. The soak run is local-only.
- Do **not** turn the Pixel 4 screen on artificially during P4 or
  P5 except when the scenario explicitly says so.

## Output format

Your final message to the user must include:

1. The full `runId`.
2. Per-scenario verdicts.
3. The overall verdict.
4. The path to `summary.json`.
5. If `FAIL`, a list of file:line citations from
   `root-cause-hypotheses.md` you suspect are responsible, with the
   oracle rows that point at them.
6. Whether `worklog.md` and `summary.json` have been written.

Keep the message under 200 lines. The artifacts are the proof. The
message is a pointer.

## Failure handling

- **Pixel 4 disconnects mid-run.** Stop. Re-check `adb devices`. If
  it returns within 30 s, resume the current scenario from its
  start. If not, demote run to `INCONCLUSIVE` and write a partial
  `summary.json`.
- **U64 unreachable mid-run.** Stop. Power-cycle is **not** allowed
  mid-run. Demote to `INCONCLUSIVE`.
- **App crashes.** Capture the crash and Anr traces under
  `runs/<runId>/logcat.errors.ndjson`. Re-launch the app. Resume the
  current scenario from its start. Crash counts >= 1 fail the run.
- **Unexpected files in worktree.** Per `CLAUDE.md`, keep them as-is
  and continue.
- **Battery drops below 20% mid-run.** Stop. Plug in. Demote to
  `INCONCLUSIVE`.

## What "done" looks like

For a Phase 4 run, "done" means:

- `runs/<runId>/summary.json` exists and parses.
- `overallVerdict: "PASS"`.
- All required artifacts present per `proof-of-work.md`.
- `worklog.md` has the conclusive line.
- The on-device deploy validation from `plan.md` Phase 5 has been
  performed and recorded.
