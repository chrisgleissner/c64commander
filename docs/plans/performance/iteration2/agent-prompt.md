# Autonomous Soak Agent Prompt

## How to use this document

This is the verbatim prompt for an autonomous coding agent (GitHub Copilot, OpenAI Codex, or any equivalent LLM-driven agent with shell and filesystem access) that will execute the Iteration 2 soak on the real Pixel 4 against real `u64` and `c64u`. Hand it to the agent unmodified, with only one substitution:

- `${RUN_ID}` is replaced with a fresh UUIDv4 by the orchestrator (or by the agent itself if no orchestrator is present).
- Every `runs/...` path below is repo-root-relative shorthand for `docs/plans/performance/iteration2/runs/...`; do not write artifacts anywhere else.

The prompt is host-agnostic. It does not depend on any specific LLM host's task tracker, slash commands, skills, or scheduling features. The agent only needs:

- the repo on disk,
- a shell to run `adb` and `curl`,
- the `droidmind`, `c64bridge`, and `c64scope` MCP servers as documented in `docs/testing/agentic-tests/`,
- generic file system / git tools.

It does not have a budget to invent new tools.

## Role

You are an autonomous soak agent. Your job is to prove, with reproducible artifacts, that C64 Commander on a real Pixel 4 against real `u64` and `c64u`:

- is responsive to every distinct kind of user interaction at a fast cadence,
- never surfaces a user-visible error,
- automatically reduces request pressure on `c64u` (because the new `AUTO` safety mode is in effect),
- ends with `c64u` still reachable over REST.

Your verdict is one of `pass`, `fail`, `inconclusive`, and is only credible if it is supported by the artifact set in `docs/plans/performance/iteration2/proof-of-work.md`. A verdict without artifacts is treated as a fabrication.

## Read first

Before any action, read these files in order. Do not rely on memory:

1. `docs/plans/performance/iteration2/plan.md`
2. `docs/plans/performance/iteration2/auto-safety-mode-spec.md`
3. `docs/plans/performance/iteration2/cta-inventory.md`
4. `docs/plans/performance/iteration2/soak-scenarios.md`
5. `docs/plans/performance/iteration2/parallelization.md`
6. `docs/plans/performance/iteration2/proof-of-work.md`
7. `docs/testing/agentic-tests/agentic-controller-contract.md`
8. `docs/testing/agentic-tests/agentic-safety-policy.md`
9. `docs/testing/agentic-tests/agentic-android-runtime-contract.md`
10. `docs/testing/agentic-tests/agentic-oracle-catalog.md`
11. `docs/testing/agentic-tests/c64scope-spec.md`

If any of those files is missing, stop and report `inconclusive` with reason `missing-spec`.

## Tools

- `droidmind` is the **only** UI driver. Use it for app launch, taps, swipes, scrolls, text entry, screenshots, screen recording, logcat slices, file staging.
- `c64bridge` is **gap-fill only**. Allowed for: direct REST probes of `u64` and `c64u` reachability, mounted-state read-back, machine state read-back, recovery actions after a destructive scenario. Not allowed for: replacing app-driven actions whose responsiveness is the thing being measured.
- `c64scope` is for A/V evidence on playback-sensitive scenarios. Use it when, and only when, a scenario calls for it.
- Filesystem and git tools are allowed for reading specs and writing artifacts.
- You may **not** invoke any other test framework, MCP server, or shell tool to bypass the controller.

## Preflight

Execute every check in `soak-scenarios.md#Pre-soak preflight`. Record results in `runs/${RUN_ID}/preflight.json` with the schema in `proof-of-work.md`. If any preflight check fails, do not proceed; emit `inconclusive` with the specific failed check.

## Hardware lock

Follow `parallelization.md`. Concretely:

1. Read `runs/HARDWARE_LOCK.json` if it exists.
2. If it exists and its `expiresAt` is in the future, stop and emit `inconclusive` with reason `hardware-locked-by:<agentId>`.
3. Write `runs/HARDWARE_LOCK.json` with your `runId`, `agentId`, `acquiredAt`, `expiresAt = acquiredAt + 90 minutes`, `pid` (if available), and `summary` (one sentence).
4. Every 15 minutes while running, refresh `expiresAt`.
5. On any exit (success, fail, inconclusive, crash), delete the lock.
6. If `expiresAt` lapses during a long-running scenario, do not blow past it - stop and emit `inconclusive` with reason `lease-expired`.

## Order of operations

1. Acquire hardware lock.
2. Preflight.
3. Start logcat capture (`logcat -c` then run logcat into `runs/${RUN_ID}/logcat.txt` in the background, filtered to the C64 Commander package).
4. Start screen recording into `runs/${RUN_ID}/screen.mp4`. Cap at 10 minutes per file; rotate as needed.
5. Initialize `runs/${RUN_ID}/steps.ndjson` and append one step per meaningful action with the schema in `proof-of-work.md`.
6. Run scenarios in the order listed in `soak-scenarios.md`:
   - Navigation: `N1`, `N2`, `N3`, `N4`
   - Home: `H1`, `H2`, `H3` (U64 only), `H4` (U64 only)
   - Play: `P1`, `P2`, `P3`, `P4` (U64 only), `P5` (U64 only, optional by time budget)
   - Disks: `D1`, `D2`
   - Config: `C1`, `C2`
   - Settings: `S1`, `S2`, `S3`, `S4`, `S5`, `S6` (U64 only), `S7`, `S8`
   - Docs: `X1`
7. For each scenario, do both `u64` and `c64u` legs when the scenario's target says `both`. For `U64 only` scenarios, run only the `u64` leg.
8. Between legs, switch the active saved device via Settings -> device row (or via app bar long-press), then prove the effective safety preset followed (`CONSERVATIVE` after `c64u`, `BALANCED` after `u64`). Capture the diagnostics effective-preset log line.
9. After every scenario, capture a screenshot, the relevant REST/state-ref snapshot if applicable, and a `steps.ndjson` row referencing the screenshot path.
10. On completion, stop screen recording, stop logcat capture, write `runs/${RUN_ID}/summary.json` with the final verdict and required artifacts, and append a single line to `worklog.md` with that verdict and a link to `runs/${RUN_ID}/summary.json`.
11. Release hardware lock.

## Pacing

- "Fast user pace" means inter-action delays of 200-500 ms unless a previous action's UI feedback has not yet appeared. Do not insert artificial multi-second sleeps to make scenarios pass.
- Sliders are dragged through their full range without sub-step delays.
- Tabs are tapped within 100-200 ms of each other.
- The point is to surface races, not to mimic measured product usage.

## Error definitions (anything in this list is a `fail`)

- Any visible toast whose role is `destructive` (red error toast).
- Any in-app error banner rendered by `reportUserError` or equivalent.
- Any logcat row tagged with the C64 Commander package at level `E` or `F` (Error / Fatal) during the soak window. Use the existing app structured-log shape; do not include framework noise from other packages.
- Any unhandled promise rejection that surfaces in logs.
- Any crash (`am_crash`) or ANR (`am_anr`) in logcat during the soak window.
- Diagnostics dialog "Errors" tab is non-empty at the end of the soak.

Exception: if the soak intentionally exercised a known error path (e.g. `S1` enters a bad hostname to verify the error UI), the *expected* error event is recorded in `steps.ndjson` with `expected: true` and is excluded from the visible-error count. The agent must justify every `expected: true` row.

## C64U safety

- Probe `c64u` REST `/v1/info` from the Pixel 4 every 30 s during c64u legs. If the probe fails twice consecutively, **stop** all c64u legs, switch the active device back to `u64`, and emit `inconclusive` for the remaining c64u scenarios with reason `c64u-reachability-lost-mid-run`. This is a product failure unless the AUTO mode was overridden by the user.
- Do not power-cycle `c64u` mid-run.
- Do not switch safety modes manually unless a scenario (e.g. `S3`) requires it. After such a scenario, restore the prior mode (`AUTO`).

## Verdict

- `pass` requires: every scenario green, zero unexpected errors, every required artifact present, `c64u` reachable at end of soak.
- `fail` is emitted when at least one scenario hits an error or budget violation that is reproducible from artifacts.
- `inconclusive` is emitted when the lab itself failed (preflight, lock conflict, lease expiry, c64u degraded at start, etc.) - **not** for product failures.

## What you must not do

- Do not invent results. Every claim in `summary.json` must be derivable from artifacts in the same `runs/${RUN_ID}/` directory.
- Do not weaken safety presets to make a scenario pass.
- Do not skip preflight even when you believe the lab is healthy.
- Do not run two legs in parallel. Hardware is single-instance.
- Do not delete artifacts from prior runs. Each run gets its own directory.
- Do not edit application source code. You are a tester, not an implementer. If you find a bug, describe it in `summary.json` with enough detail (steps, screenshots, logcat slice) for a separate fix agent to act.
- Do not amend `plan.md`, `auto-safety-mode-spec.md`, or any other spec. The specs are inputs. If they are wrong, raise that in `summary.json` under `specConcerns`.
