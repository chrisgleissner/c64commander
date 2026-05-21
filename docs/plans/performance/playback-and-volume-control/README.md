# Playback and Volume Control - Production-Quality Hardening

## Why this iteration exists

Iteration 2 closed on whole-app responsiveness and AUTO safety mode.
Two user-facing surfaces survived that work with known residual friction:

1. **Volume control** on the Play page (and to a lesser degree on the
   Home page audio mixer and the Config page sliders), including the
   dedicated mute button. Reports: slider snap-back on release, stuck
   thumb mid-drag, glitch on rapid mute/unmute toggling.
2. **Play page transport**: Play, Pause, Resume, Skip Next / Previous,
   and auto-advance-while-backgrounded with the Pixel 4 screen off.

This iteration is a narrow, soak-backed hardening pass on exactly those
two surfaces, on a real Pixel 4 driving a real Ultimate 64 Elite (`u64`).
It does **not** add features, redesign the UI, or relax any prior gate.

## Documents

| Document | Purpose |
| --- | --- |
| [plan.md](./plan.md) | The plan. Scope, phases, gates, exit criteria. Read first. |
| [root-cause-hypotheses.md](./root-cause-hypotheses.md) | Falsifiable hypotheses for the six known issues, tied to source file:line ranges. |
| [soak-scenarios.md](./soak-scenarios.md) | Volume scenarios V1-V4 and playback scenarios P1-P5, with cadence, oracles, stop conditions. |
| [regression-tests.md](./regression-tests.md) | Tests every fix must add. Vitest + Android JVM + Maestro coverage map. |
| [proof-of-work.md](./proof-of-work.md) | Required artifacts per run. Reviewer rejects verdicts without these. |
| [agent-prompt.md](./agent-prompt.md) | Self-contained prompt for the agent driving the baseline soak (Phase 2) and the final soak (Phase 4). |
| [handover-prompt.md](./handover-prompt.md) | Self-contained prompt for an agent picking up mid-flight. |
| [worklog.md](./worklog.md) | Append-only chronological log of work done. |
| [runs/](./runs/) | Per-run artifact directory. |

## Quickstart for a human reviewer

1. Read `plan.md` end-to-end.
2. Read `root-cause-hypotheses.md`. Push back here, not in code, if a
   hypothesis is wrong - if the cited file:line is off or the
   suggested mechanism doesn't match the implementation.
3. Skim `soak-scenarios.md` for coverage holes - are there real user
   gestures that don't end up under the agent's hands?
4. Read `proof-of-work.md` to know what evidence to demand from any
   agent claiming "soak passed".

## Quickstart for an agent

1. Confirm the lab: Pixel 4 attached over adb (serial prefix `9B0`),
   `u64` reachable at `http://u64/v1/info`. See `agent-prompt.md`
   §Preflight.
2. Mint a `runId` (UUIDv4) and create `runs/<runId>/`.
3. Run the scenarios from `soak-scenarios.md` in the order they
   appear.
4. Emit artifacts into `runs/<runId>/` per `proof-of-work.md`.
5. Append a summary line to `worklog.md`.

## Non-goals

This iteration does not:

- change the request scheduler, FTP transport, Telnet transport, or
  any deep architecture beyond the volume + transport surfaces;
- introduce a new visual design;
- change Iteration 1 or Iteration 2 acceptance thresholds;
- relax safety presets to pass a flaky soak;
- ship code without proof-of-work artifacts;
- run on `c64u` - that target's known firmware degradation would
  conflate slider regressions with transport degradation. A follow-up
  iteration can re-enable `c64u` once the `u64` surfaces are clean.

## Relationship to prior iterations

This iteration is the third in the performance program:

- `../iteration1/` - saved-device switching latency, diagnostics
  derivation cost.
- `../iteration2/` - whole-app responsiveness, AUTO safety mode.
- `./` (this directory) - production-quality volume + playback.

It assumes Iteration 2's AUTO mode is in place and active.
