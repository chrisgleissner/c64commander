# Iteration 2 - Whole-App Responsiveness Soak Plan

## Goal

On Android, on a real Pixel 4 connected to a real Ultimate 64 Elite (`u64`) and a real Commodore 64 Ultimate (`c64u`), C64 Commander must be:

- **responsive** to every distinct kind of user interaction, performed at a fast cadence, on every routed page;
- **error-free** - no user-visible error, no toast error, no error log row, no diagnostics "Errors" tab entry, no crash, no ANR;
- **safe by default** against `c64u`, which has a known firmware degradation pattern: a fresh `c64u` answers REST and Telnet for some time, then loses REST reachability if pushed too hard. Reaching that state during a soak is a product failure of this iteration, not an environmental excuse.

## Phases and gates

This iteration is gated. Each phase must pass before the next begins. Failing a gate means stop and triage, not raise the threshold.

### Phase A - Land Auto safety mode

- Implement the spec in `auto-safety-mode-spec.md`.
- `AUTO` is added to `DeviceSafetyMode`.
- `AUTO` is the new default for all newly installed instances. Existing installs keep their stored mode.
- `loadDeviceSafetyConfig()` resolves the effective preset (`CONSERVATIVE` vs `BALANCED`) at call time based on the currently-selected saved device's product family.
- `deviceInteractionManager.updateConfig()` re-fires when the selected saved device changes or when the verified product changes (in addition to existing safety-update broadcasts).
- Settings UI exposes `Auto (Conservative for C64U, Balanced for others)` as the first option, marked recommended, with explanatory copy.

Gate A: targeted unit tests prove that the resolved effective mode follows the verified product through a `U64 -> C64U -> U64` switching sequence, including the case where no verified product yet exists for a freshly-added device.

### Phase B - Lock in CTA coverage

- Use `cta-inventory.md` as the canonical list of interaction types.
- For every entry, name at least one concrete instance on a routed page that the soak will exercise.
- Reject the plan if any interaction type lacks a concrete instance, or if any routed page lacks at least one interaction.

Gate B: `cta-inventory.md` shows zero `TBD` rows.

### Phase C - Dry-run the soak prompt

- Run `agent-prompt.md` once end-to-end against a healthy lab, with both `u64` and `c64u` reachable at start.
- Accept inconclusive product verdicts; reject any run that fails to produce the required artifact set.
- This phase exists to catch agent-side defects (missing oracle, missing screenshot, missing logcat slice) before they pollute the real measurement runs.

Gate C: at least one full run lands artifacts that satisfy every required field in `proof-of-work.md`, regardless of whether bugs were found.

### Phase D - Soak run (the real measurement)

- Execute the soak according to `soak-scenarios.md` against both `u64` and `c64u`, with `AUTO` safety mode active.
- The Pixel 4 stays attached over adb for the duration.
- The agent must follow the parallelization rules in `parallelization.md`: hardware lock acquired, single agent driving the device, optional auxiliary agents only on read-only artifact analysis.

Gate D: zero user-visible errors recorded; `c64u` REST reachability survives the full soak; responsiveness budget (see below) met on every scenario.

### Phase E - Triage and fix loop

- Every defect emitted by the soak becomes its own minimal change, tested with a regression that fails before the fix and passes after.
- After each fix, re-run the relevant scenario *only*; full soak repeats only when the fix touches global infrastructure (e.g. request scheduler).
- Iteration 2 closes when one full Phase D run is clean.

## Responsiveness budget

These numbers are normative for this iteration. They are not aspirational.

| Signal | Budget | Source / how measured |
| --- | --- | --- |
| Tap-to-visible-feedback for a quick action card | p50 < 150 ms, p95 < 350 ms | screen recording timestamps cross-referenced with `requestDiagnosticsOpen`/trace marker timestamps |
| Slider drag to first applied write | p50 < 200 ms, p95 < 500 ms | trace event `config-write` minus drag-start marker |
| Page nav (tab tap to first paint of new route) | p50 < 250 ms, p95 < 500 ms | trace `route-change` to first useful paint screenshot |
| Diagnostics open-to-first-visible | p50 < 250 ms, p95 < 400 ms | inherits Iteration 1 Stage 3 |
| Saved-device switch (healthy leg) | p50 < 250 ms, p95 < 500 ms | inherits Iteration 1 Stage 1 |
| Visible-error count during soak | 0 | toast surface + diagnostics "Errors" tab + logcat ERROR from app package |
| Crash / ANR count during soak | 0 | logcat + `am dumpsys activity` |
| `c64u` REST `/v1/info` reachability at end of soak | reachable in < 1000 ms | direct adb-shell probe |

## What is in scope this iteration

- New `AUTO` safety mode and its plumbing.
- Soak harness specification (this document set).
- Bug fixes triggered by the soak, scoped narrowly.
- Hardening of error surfaces that leak during soak (e.g. uncaught fetch error -> error toast that was previously silent).
- Regression coverage for the above.

## What is explicitly out of scope

- Broad refactors of `deviceInteractionManager`, `c64api`, or any transport.
- New visual design or page reorganization.
- iOS execution. iOS continues to rely on CI; Iteration 2 is Android-only.
- Replacing `droidmind` / `c64bridge` / `c64scope`. Those are the controller, gap-fill, and observability tools as documented in `docs/testing/agentic-tests/`. The plan reuses them and does not extend them.
- "Make c64u work harder". The strategy is the opposite: slow C64U down to a rate it can sustain, automatically.

## Risk register

| Risk | Mitigation |
| --- | --- |
| `c64u` is already degraded before a run starts | Mandatory preflight REST probe of `c64u` from the Pixel 4; if degraded, mark `c64u` legs as inconclusive and run only `u64` legs. Power-cycle of `c64u` is allowed only between full soak runs, never mid-run. |
| Single Pixel 4 forces serialization | See `parallelization.md`: hardware lock + read-only auxiliary agents. |
| Agent invents a passing summary without artifacts | `proof-of-work.md` makes evidence mandatory and machine-checkable. Reviewer is allowed (and expected) to reject any verdict without artifacts. |
| AUTO mode resolves wrong because verified product is not yet known | Spec says: if no verified product, fall back to `BALANCED`, but mark the resolution as "provisional" in diagnostics so the soak can pick it up. |
| Soak destabilizes `c64u` despite AUTO | This is a product failure of Iteration 2 and must be fixed by tightening `CONSERVATIVE`, not by relaxing the soak. |
| User had previously selected a non-AUTO mode | Existing installs keep their stored mode. Migration does not force AUTO on top of an explicit user choice. Soak must record the mode that was in effect. |

## Exit criteria for Iteration 2

All of the following must be true on a single end-to-end run, captured in one `runs/<runId>/` directory:

1. `AUTO` is the active safety mode for the run.
2. Effective mode resolved correctly throughout the run: `BALANCED` while `u64` is selected, `CONSERVATIVE` while `c64u` is selected. Verified via diagnostics trace.
3. Every CTA type in `cta-inventory.md` was exercised at least once and the action's primary oracle landed.
4. Responsiveness budget met for every signal in the table above.
5. Zero user-visible errors. Zero crashes. Zero ANRs.
6. `c64u` REST `/v1/info` is reachable from the Pixel 4 at the end of the run.
7. Artifact directory passes the `proof-of-work.md` checklist.
8. `worklog.md` has a single conclusive entry for this run.

Anything less is a fail, and the agent or human running it must say so.
