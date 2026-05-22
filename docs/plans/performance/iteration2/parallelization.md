# Parallelization Plan

## The hardware constraint

There is exactly one Pixel 4, one `u64`, and one `c64u`. They are physical objects. They cannot be virtualized. They cannot be shared across two concurrent processes that each assume exclusive control. This document exists so that "farming work out to multiple concurrent agents" does not produce two agents reaching for the same screen, the same REST endpoint, and the same disk drive at the same time.

There are three workable patterns. They are listed in increasing order of "amount of human supervision needed". An orchestrator (or a single human) picks one pattern per run.

## Pattern 1 - Lock-and-line (recommended default)

Exactly one "actor" agent at any moment. Auxiliary "auditor" agents are read-only and operate on artifacts emitted by the actor.

### Roles

| Role | Touches hardware? | Permitted reads | Permitted writes |
| --- | --- | --- | --- |
| Actor | yes (drives the Pixel 4) | All specs, prior runs, current `runs/${RUN_ID}/` | `runs/${RUN_ID}/*`, `HARDWARE_LOCK.json`, `worklog.md` |
| Auditor | no | Specs, all `runs/`, source under `src/` for cross-reference | `runs/${RUN_ID}/audit/*` (no overwrite of actor output) |
| Reviewer (human) | no | Everything | `worklog.md` (final verdict line) |

### Hardware lock

A file lock at `docs/plans/performance/iteration2/runs/HARDWARE_LOCK.json`. Shape:

```json
{
  "runId": "string (matches the run directory name)",
  "agentId": "string (agent self-identifier)",
  "acquiredAt": "ISO 8601",
  "expiresAt": "ISO 8601 (acquiredAt + 90 minutes)",
  "pid": 12345,
  "summary": "one-sentence description of this run's focus"
}
```

Rules:

1. Before any droidmind action, the actor reads this file. If present and `expiresAt` is in the future, the actor refuses to start and emits `inconclusive` with reason `hardware-locked-by:<agentId>`.
2. To acquire the lock, the actor writes the file. The write must be atomic (create-with-O_EXCL, or `git`-mediated commit-then-pull, or simple "write and immediately re-read to verify identity" - whichever is available).
3. The actor refreshes `expiresAt` every 15 minutes while running.
4. On any exit (success, fail, inconclusive, crash), the actor deletes the lock.
5. If the lock's `expiresAt` lapses while a long-running scenario is mid-flight, the actor stops and emits `inconclusive` with reason `lease-expired`. It does **not** auto-extend past the original 90-minute window. Long-running soaks must be planned to fit, or split.
6. An auditor running in parallel does not touch the lock. The lock exists for hardware contention only.

### What auditors can do in parallel

Auditors are independent processes that read the actor's outputs as they appear and add their own evidence:

- replay `steps.ndjson` against `cta-inventory.md` and flag any shape the actor missed,
- diff `logcat.txt` against a known noise allowlist and flag unfamiliar entries,
- re-classify warnings vs errors,
- compute the responsiveness budget from screen-recording timestamps,
- cross-reference the diagnostics effective-preset trail against the active device switching log,
- propose a `verdict` recommendation in `runs/${RUN_ID}/audit/<auditor-id>.json` (advisory, not authoritative).

Auditors must never modify actor output. If they conflict with the actor's `summary.json`, they say so in their audit file; the human reviewer breaks the tie.

### Worked example

- Agent A acquires the lock, runs Phase D soak end-to-end (~70 min), releases the lock.
- Simultaneously, Agent B watches `runs/${RUN_ID}/` and runs analyses every time a new artifact appears.
- A and B both write to their own paths inside `runs/${RUN_ID}/`. No write conflict.
- When A finishes, B's last audit pass produces `audit/auditor-b.json`. The reviewer reads `summary.json` and `audit/auditor-b.json` together.

## Pattern 2 - Time-slicing

Two or more actor agents take strictly sequential turns. Useful when each turn covers a specific scenario set and the human wants the wallclock to feel parallel.

### How it works

- Each actor agent has a designated scenario set (e.g. Agent A: `N1`-`N4` + Home; Agent B: Play; Agent C: Disks + Config + Settings).
- A queue file at `runs/QUEUE.json` lists pending agent IDs in order.
- Lock acquisition still follows Pattern 1.
- When an agent finishes, it releases the lock and removes itself from the queue.
- The next agent in the queue picks up. It re-runs preflight from scratch.
- All agents land artifacts in the *same* `runs/${RUN_ID}/` if the human treats them as a unified soak, or in separate `runs/${RUN_ID}-<segment>/` directories if not.

### When this is worth it

- Wallclock is the bottleneck and the soak truly is split into independent scenario sets.
- The cost of repeated preflight (perhaps 30 seconds each) is acceptable.

### When this is *not* worth it

- The scenarios share state (e.g. saved-device switching) such that splitting them breaks the oracle. Most of this iteration is in that category. Recommend Pattern 1 unless there's a specific reason to split.

## Pattern 3 - Single-agent multi-session

One agent runs many sequential soaks. Each soak gets its own `runs/<runId>/`. Useful for trend tracking across days but not for parallelism inside a single run. Scheduling is left to the orchestrator (a cron job, a CI nightly, a human, or an LLM-host scheduler if one is available) — this plan does not depend on any specific host's loop or scheduling feature.

## What "concurrent agents" definitely should not do

- Two actors against the same Pixel 4 simultaneously. The droidmind controller serializes commands, but the *test scenarios* don't - one actor's "open Settings" can race another's "tap Reset" mid-action and produce neither's expected oracle.
- Two actors against `u64` from different processes. Even if the Pixel 4 is split, `u64` does not enjoy concurrent REST clients pushing config writes.
- Any actor against `c64u` while another agent is also pushing requests to `c64u`. `CONSERVATIVE` is sized for one client. Two clients defeat it.

## Allowed concurrent work

- One actor on Pixel 4 + one auditor reading artifacts (Pattern 1).
- One actor on Pixel 4 + N reviewers reading `worklog.md` and grading prior runs.
- One actor + an unrelated agent running unit tests / lint / docs (no hardware contact).
- Multiple agents implementing **separate** Iteration 2 source changes in different worktrees, provided they merge serially. None of those agents touches the Pixel 4 - that is reserved for the Phase D soak agent.

## Recovery from a stale lock

If a lock's `expiresAt` is in the past:

1. The newcomer agent does **not** auto-delete the lock. Stale locks may indicate a crashed agent that left the Pixel 4 mid-scenario.
2. The newcomer agent writes a short note to `worklog.md` noting the stale lock and stops with reason `stale-lock-needs-human`.
3. A human inspects the Pixel 4 (return it to a clean app state) and deletes the lock by hand.

This is intentional. Auto-recovery here would race with the prior actor on a transient network blip.
