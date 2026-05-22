# Iteration 2 - Real-Device Responsiveness Soak and Auto Safety Mode

## Why this iteration exists

Iteration 1 closed three narrow performance gaps:

1. Android bare-hostname stall on saved-device switching.
2. Background-health work competing with foreground switch verification.
3. Eager Diagnostics derivation while the overlay was closed.

Iteration 2 widens scope from "single-flow latency" to **whole-app responsiveness under sustained, fast user interaction on real hardware**. The success criteria are stricter and product-shaped:

- The Android app must remain responsive to every distinct kind of user interaction (taps, sliders, selects, long-presses, inputs, dialogs, swipes, pickers) at a fast, near-adversarial cadence.
- The app must never surface a user-visible error (toast, error banner, error log entry, diagnostics "Errors" tab content, crash, ANR).
- The c64u device, which suffers from a known firmware degradation pattern, must remain reachable for the full duration of any soak. The app must reduce its request rate against the c64u **automatically** rather than relying on a human to remember to switch presets.
- All evidence of pass/fail must be reproducible from artifacts; no agent verdict is accepted on prose alone.

The new **Auto** safety mode is the structural fix that supports that last requirement. Conservative for `C64U`, Balanced for everything else, no human in the loop.

## Documents

| Document | Purpose |
| --- | --- |
| [plan.md](./plan.md) | Iteration plan: scope, phases, gates, exit criteria. Read first. |
| [auto-safety-mode-spec.md](./auto-safety-mode-spec.md) | Functional spec for the new `AUTO` device-safety mode (default after this iteration). |
| [cta-inventory.md](./cta-inventory.md) | Enumeration of every distinct CTA / interaction type the soak must hit at least once. |
| [soak-scenarios.md](./soak-scenarios.md) | Concrete fast-user soak scenarios, per page, with cadence, oracles, and stop conditions. |
| [agent-prompt.md](./agent-prompt.md) | Self-contained prompt for an autonomous coding agent (Copilot, Codex, or equivalent) that drives the soak on the real Pixel 4 against real u64 and c64u. Designed to be invoked verbatim. |
| [implementation-prompt.md](./implementation-prompt.md) | Self-contained prompt for an autonomous coding agent that lands the Phase A code change (Auto safety mode) and closes Phase B. Hand this to your agent first; hand `agent-prompt.md` to a separate session once Phase A and B are green. |
| [parallelization.md](./parallelization.md) | How to farm work out to multiple concurrent agents given that only one Pixel 4, one u64, and one c64u exist. |
| [proof-of-work.md](./proof-of-work.md) | Required artifact schema, file layout, and acceptance gates. |
| [worklog.md](./worklog.md) | Append-only chronological log. Agents write here; reviewers read here. |
| [runs/](./runs/) | Per-run artifact directory (one subdir per `runId`). |

## Quickstart for a human reviewer

1. Read `plan.md` end-to-end.
2. Read `auto-safety-mode-spec.md`. Push back here, not in code, if the resolution rule is wrong.
3. Skim `cta-inventory.md` and `soak-scenarios.md` for coverage holes.
4. Read `proof-of-work.md` to know what evidence to demand from any agent claiming "soak passed".

## Quickstart for an agent

These docs are host-agnostic. They have been validated against autonomous coding agents (GitHub Copilot, OpenAI Codex, and others); no assumption is made about which LLM host is driving the work. The agent only needs filesystem access to this repo, the `droidmind` / `c64bridge` / `c64scope` MCP servers documented under `docs/testing/agentic-tests/`, and a shell.

1. Confirm the lab (Pixel 4 attached over adb, `u64` reachable, `c64u` reachable). See `agent-prompt.md` §Preflight.
2. Acquire the hardware lock (see `parallelization.md`). Refuse to start if the lock is held.
3. Run the soak scenarios from `soak-scenarios.md` in the order they appear.
4. Emit artifacts into `runs/<runId>/` per `proof-of-work.md`.
5. Append a summary line to `worklog.md`.
6. Release the hardware lock.

## Non-goals

This iteration does not change the request scheduler, FTP transport, Telnet transport, or any deep architecture. It is allowed to:

- add the new `AUTO` safety mode and make it the default,
- harden user-visible error surfaces if they leak during soak,
- fix individual bugs the soak exposes.

It is **not** allowed to:

- weaken safety presets to pass a flaky soak,
- ship code without proof-of-work artifacts,
- change Iteration 1's acceptance thresholds.
