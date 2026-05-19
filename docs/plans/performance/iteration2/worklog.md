# Iteration 2 Worklog

Append-only chronological log. One entry per meaningful event: spec change, scenario draft, agent run, triage note, fix landed, re-run, sign-off.

Conventions:

- Entries are date-prefixed (`YYYY-MM-DD HH:MM UTC`).
- Each soak run produces exactly one closing entry with the run's verdict and a link to `runs/<runId>/summary.json`.
- Specs are inputs; if a spec must change, log the change here and amend the spec in the same commit.

## 2026-05-19

- Iteration plan drafted under `docs/plans/performance/iteration2/`.
  - `plan.md` defines phases A-E and gates.
  - `auto-safety-mode-spec.md` defines the new `AUTO` device-safety mode.
  - `cta-inventory.md` enumerates 56 distinct interaction shapes mapped to soak scenarios.
  - `soak-scenarios.md` defines 22 scenarios across Navigation, Home, Play, Disks, Config, Settings, Docs.
  - `agent-prompt.md` is the verbatim handoff for an autonomous soak agent.
  - `parallelization.md` defines Pattern 1 (lock-and-line) as the default; auxiliary agents are read-only.
  - `proof-of-work.md` defines the artifact schema and acceptance gates.
- Implementation has not started. The next agent's job is to land Phase A (Auto safety mode) and then re-read `plan.md` Gate A before moving on.

<!-- Template for future entries:

## YYYY-MM-DD HH:MM UTC

- Event title.
  - Detail, links, runId references.
  - Verdict if this entry closes a soak run.
-->
