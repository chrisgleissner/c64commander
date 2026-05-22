# Implementation Kickoff Prompt

## How to use this document

This is the verbatim prompt for the **implementation** agent that lands Iteration 2's code (Phase A and Phase B). It is distinct from `agent-prompt.md`, which is the verbatim prompt for the **soak** agent that runs Phase C and Phase D on real hardware.

The prompt is host-agnostic. It has been validated against GitHub Copilot and OpenAI Codex; it does not assume any specific LLM host's task tracker, slash commands, skills, or scheduling features. The agent only needs:

- the repo on disk,
- a shell to run `npm`, `git`, and `adb`,
- network access to `u64` and `c64u` for the Phase 5a smoke step,
- the attached Pixel 4 over adb for the Phase 5a smoke step.

Order of use:

1. Paste the prompt below into a fresh session of your chosen agent (Copilot, Codex, or equivalent) running in the repo root. This agent lands the `AUTO` safety mode and closes Phases A and B.
2. When that agent reports Phase A and B complete, start a separate session and paste `agent-prompt.md` to kick off the soak (Phases C and D).

Keep these two prompts separate. Phase A is small and code-shaped; the soak is hours-long and hardware-bound. Mixing them in one context window invites the implementation agent to start running the soak before its own code is verified.

## The prompt

```
You are implementing Iteration 2 of the C64 Commander performance/responsiveness
plan. The plan, specs, and acceptance criteria are already written. Your job is
to land the code, not to redesign anything. Treat the spec documents as
authoritative inputs; if you think a spec is wrong, raise it in chat before
amending it.

READ FIRST (in order, do not skip):
  1. CLAUDE.md and .github/copilot-instructions.md  (mandatory project rules)
  2. docs/plans/performance/iteration2/README.md
  3. docs/plans/performance/iteration2/plan.md
  4. docs/plans/performance/iteration2/auto-safety-mode-spec.md
  5. docs/plans/performance/iteration2/proof-of-work.md
  6. docs/plans/performance/iteration2/cta-inventory.md
  7. docs/plans/performance/iteration2/soak-scenarios.md
  8. docs/plans/performance/iteration2/parallelization.md
  9. docs/plans/performance/iteration2/agent-prompt.md
 10. docs/plans/performance/iteration2/worklog.md

EXECUTION ORDER (strict - do not interleave phases):

PHASE A - Land Auto safety mode
  Implement exactly what auto-safety-mode-spec.md describes. The touched files
  are:
    - src/lib/config/deviceSafetySettings.ts  (add AUTO to the union, add
      resolveAutoSafetyMode, change DEFAULT_DEVICE_SAFETY_MODE to "AUTO",
      extend loadDeviceSafetyConfig to resolve at read time, return optional
      `resolution` field)
    - src/lib/savedDevices/store.ts  (add getSelectedSavedDeviceProductFamilySync
      and emit a safety-config-update broadcast on selected-device change and on
      completeSavedDeviceVerification)
    - src/lib/deviceInteraction/deviceInteractionManager.ts  (no structural
      change - confirm it re-runs loadDeviceSafetyConfig on the new broadcast)
    - src/pages/SettingsPage.tsx  (Auto as the first SelectItem, marked
      recommended, with the resolved-preset line and provisional flag rendered
      when applicable)
    - src/lib/config/settingsTransfer.ts  (accept "AUTO" on import/export)
    - diagnostics: emit one info-level log line whenever the effective preset
      changes, with mode/resolvedPreset/provisional/activeProduct/activeDeviceId

  Add unit tests covering acceptance tests 1-7 from auto-safety-mode-spec.md.
  Do not change RELAXED/BALANCED/CONSERVATIVE/TROUBLESHOOTING numeric presets.

  Gate A: targeted unit tests pass, `npm run test:coverage` global branch
  coverage >= 91%, `npm run lint` clean, `npm run build` clean.

  Phase A also includes:
    - Run `npm run cap:build` and deploy the resulting APK to the attached
      Pixel 4 (serial prefix 9B0). Launch the app, verify Settings -> Device
      Safety shows "Auto" as the first option, switch the active saved device
      between u64 and c64u, and confirm via the Diagnostics dialog that the
      effective-preset line follows the rule (BALANCED for u64, CONSERVATIVE
      for c64u).
    - Append a worklog entry to docs/plans/performance/iteration2/worklog.md
      recording Phase A completion (date, files touched, test counts,
      coverage %, on-device verification result).

  Commit Phase A as a single coherent change with a precise commit message.
  Do NOT proceed to Phase B in the same commit.

PHASE B - Lock in CTA coverage (docs-only)
  Re-read cta-inventory.md. Verify every row has a concrete instance and a
  scenario ID. If any row is TBD or stale relative to current source, amend
  the inventory before proceeding. Log the diff in worklog.md.

PHASE C - Dry-run the agent prompt (does not require code changes)
  STOP HERE. Do not execute the soak yourself. Phase C and Phase D are owned
  by the autonomous soak agent described in agent-prompt.md, and execution is
  user-triggered. Hand control back to the user with a one-paragraph status
  report:
    - What Phase A landed (commit SHA, files touched).
    - Confirmation that the Pixel 4 deploy + on-device verification succeeded.
    - Confirmation that Phase B left cta-inventory.md green.
    - The exact command/prompt the user should hand to the soak agent to start
      Phase C (cite agent-prompt.md verbatim).

RULES
  - Follow .github/copilot-instructions.md and CLAUDE.md without exception.
    The Phase 5a "deploy the latest APK before completion" rule applies at the
    end of Phase A and any later code change.
  - The fast-deploy exception (FAST_ANDROID_DEPLOY etc.) does NOT apply here.
    Run full test+coverage+lint per the mandatory coverage gate.
  - Every bug fix that the soak later surfaces gets its own regression test
    that fails before the fix and passes after.
  - Do not run the soak yourself. Do not invent results. Do not amend
    plan.md, auto-safety-mode-spec.md, soak-scenarios.md, proof-of-work.md,
    or parallelization.md unless you are explicitly fixing an inconsistency
    you discovered while implementing - and if so, log the change in
    worklog.md in the same commit.
  - Migration safety: existing installs keep their stored mode. Only fresh
    installs see AUTO as default. Add a unit test that covers this.
  - Settings export from a Phase A build must round-trip a stored mode of
    "AUTO" through import on the same build.

DELIVERABLES (Phase A close-out)
  1. A single commit landing the Phase A spec.
  2. New unit tests under tests/unit/config/ covering acceptance tests 1-7.
  3. Updated worklog entry.
  4. APK deployed and verified on Pixel 4 against u64 and c64u.
  5. A status report back to the user describing the above and naming the
     prompt to invoke for Phase C.

If at any point a precondition fails (Pixel 4 not attached, u64 unreachable,
c64u unreachable at start of verification), STOP and report - do not paper
over it.

Begin with Phase A.
```

## Why this prompt is split out from `agent-prompt.md`

| Concern | `implementation-prompt.md` (this doc) | `agent-prompt.md` (soak) |
| --- | --- | --- |
| What it produces | Source code, unit tests, a commit | Artifact directory under `runs/<runId>/` |
| Touches the Pixel 4? | Yes, only for the Phase 5a smoke deploy | Yes, continuously for hours |
| Touches `u64` / `c64u`? | Briefly, to verify the Auto-mode resolution UI | Continuously, soak-shaped load |
| Allowed to edit source code? | Yes (that is the whole job) | No |
| Hardware lock required? | No (single-step deploy, short window) | Yes (`HARDWARE_LOCK.json`) |
| Wallclock | ~30 minutes including build | ~70 minutes per full run |
| Exit | Commit + status report + handoff sentence | Verdict + artifact set |

If you ever feel tempted to merge the two, re-read this table.
