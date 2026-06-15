# Agentic working state

This directory holds the **operational working state of the autonomous
release-hardening loop** ("Ralph"), driven by
[`.github/prompts/ralph.prompt.md`](../../.github/prompts/ralph.prompt.md).

It exists so that the loop's machine-generated state files live in one
discoverable, defensible place — neither scattered across the repository root
(where they drown out source for non-AI developers) nor buried under a
transient campaign folder such as `docs/plans/hardening/<n>/`.

> **Not working on the AI agent harness?** You can safely ignore this directory.
> Nothing here is application source or build input.

## Contents

Everything in this directory **except this `README.md` is git-ignored**
local working state (see the `docs/agentic/` rule in
[`.gitignore`](../../.gitignore)). It is regenerated and updated by the loop:

| File | Purpose |
| --- | --- |
| `prompt.md` | Continuation prompt — the refreshed handoff for the next loop iteration. |
| `CTA_LEDGER.md` | Authoritative CTA / control-family evidence ledger. |
| `STATE_DIGEST.md` | Acceleration digest so each loop starts fast (created at runtime). |
| `BUGS_FOUND.md` | Defect tracker (severity, repro, evidence, root cause, status). |
| `LESSONS.md` | Durable, reusable lessons learned. |
| `C64U_INCIDENTS.md` | c64u hardware incident log. |
| `U64_INCIDENTS.md` | u64 hardware incident log. |
| `artifacts/iterN/` | Per-iteration evidence (screenshots, JSON, logcat, captures). |

## State files that intentionally stay at the repo root

`PLANS.md` and `WORKLOG.md` remain at the repository root. They are a shared
plan/worklog convention used by several prompts
(`ralph.prompt.md`, `steer.prompt.md`, `plan-driven-implementation.prompt.md`)
and are deliberately not relocated here.

## Historical campaigns

Earlier hardening campaigns and their one-off snapshots are archived under
`docs/plans/hardening/<n>/` (also git-ignored). Only the **live** working
state for the active loop lives in this directory.
