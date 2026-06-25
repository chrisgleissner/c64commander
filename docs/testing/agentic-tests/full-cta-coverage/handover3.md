ROLE

You are the continuation agent for the C64 Commander full-CTA-coverage certification program. You are a Principal Android QA Engineer, mobile-automation architect, and autonomous test engineer. You are resuming an active HIL/device loop, not starting a new design phase.

This handover is to be stored at:

`docs/testing/agentic-tests/full-cta-coverage/handover3.md`

It extends, but does not replace, `docs/testing/agentic-tests/full-cta-coverage/prompt.md`, `docs/testing/agentic-tests/full-cta-coverage/handover1.md`, `docs/testing/agentic-tests/full-cta-coverage/handover2.md`, and `docs/testing/agentic-tests/full-cta-coverage/runs/progress-ledger.md`.

## Objective

Continue the full CTA coverage certification from the current proven state.

Your immediate objective is to resolve **Gate 3: C64U-primary target resolution** using the app on the Pixel 4. Do not drift into additional scaffolding, broad coverage, mutation testing, or U64 fallback before preserving fresh C64U evidence.

After Gate 3 is either `PROVEN` or freshly `BLOCKED` with complete evidence, continue autonomously to the next nearest incomplete gate in this order:

1. Gate 4 - safe app-local reversible mutation canary.
2. Gate 5 - generic R0/R1 CTA contracts.
3. Gate 6 - page coverage waves.
4. Gate 7 - risky and destructive scenarios only with explicit manifests.
5. Gate 8 - final HIL certification and release decision.

## Required first actions

Before changing code or running any new HIL case:

1. Read these files completely:
   - `docs/testing/agentic-tests/full-cta-coverage/prompt.md`
   - `docs/testing/agentic-tests/full-cta-coverage/handover1.md`
   - `docs/testing/agentic-tests/full-cta-coverage/handover2.md`
   - `docs/testing/agentic-tests/full-cta-coverage/handover3.md`
   - `docs/testing/agentic-tests/full-cta-coverage/runs/progress-ledger.md`
   - `AGENTS.md`
   - `REVIEW.md`
   - `.github/copilot-instructions.md`
2. Run `git status --short`.
3. Create or update `PLANS.md` in the repository root. The filename must be exactly `PLANS.md`. Do not use any other casing.
4. In `PLANS.md`, record:
   - the active gate
   - the exact next proof step
   - the commands you intend to run
   - the artifact paths expected
   - the rollback or cleanup path
5. Immediately begin execution against `PLANS.md`. Do not stop after planning.
6. Update `docs/testing/agentic-tests/full-cta-coverage/runs/progress-ledger.md` before reporting.

Maintain `PLANS.md` as the authoritative execution plan and `progress-ledger.md` as the authoritative certification state. If they disagree, inspect artifacts and correct the stale document.

## Current verified state

Use this as the starting state unless fresh artifacts disprove it.

- Active branch: `test/full-cta-coverage`
- Git SHA: `41b0d368ca06d80f9ffc0e40f10a46e1b11fe380`
- Pixel 4: `PROVEN`
  - Serial: `9B081FFAZ001WX`
  - Android 16, SDK 36, build `BP4A.251205.006`
  - Controllable through DroidMind
  - Latest available APK installed and launched:
    `android/app/build/outputs/apk/debug/c64commander-0.8.9-c102a-debug.apk`
- C64U: still **not proven as the active app-driven certification target**
  - Direct unauthenticated `curl http://c64u/v1/info` returned HTTP 403.
  - The app has shown `C64U HEALTHY` and `Connected to http://192.168.1.167`.
  - That is not enough for Gate 3. You must perform app-driven Save-and-Connect to host `c64u` with password `pwd` and capture fresh app-visible identity evidence.
- U64 fallback: `PROVEN` reachable for fallback health only.
  - `curl http://u64/v1/info` returned HTTP 200 with Ultimate 64 Elite firmware `3.14e`, unique ID `38C1BA`.
  - U64 evidence must be labelled `U64_FALLBACK` and must never be merged into C64U pass status.
- c64scope lab readiness: `BLOCKED`
  - Mobile controller is healthy.
  - C64Bridge is degraded because it points to VICE at `127.0.0.1:6502`.
  - Capture infrastructure is unknown.
  - Lab ready is false.
- Latest validation:
  - `npm run scope:check` passed: 51 files, 349 tests.
  - No coverage run was performed. Do not run broad coverage merely for ceremony while HIL gate work is pending.
- Latest Gate 2 keypad canary:
  - Command:
    `npm run scope:cta:keypad -- --serial 9B081FFAZ001WX --target c64u --case CTA-GATE2-KEYPAD-CANARY --start-app --include-dpad --settle-ms 1800`
  - Result: 11/11 passed.
  - Artifact:
    `c64scope/artifacts/cta-20260624T113125Z-pixel4-c64u-41b0d368ca06/keypad-canary.json`
  - Per-step screenshots and hierarchies exist under the same artifact directory.
  - Intermediate failed oracle-calibration keypad artifacts were preserved.

## Gate status snapshot

Treat these as the latest known statuses:

| Gate or section | Status | Evidence | Constraint |
| --- | --- | --- | --- |
| Gate 0 - harness foundation | `PROVEN` for current smoke scope | `npm run scope:check`, `scope:cta:*` smoke artifacts, MCP capability artifact | Keep green after changes. |
| Gate 1 - Pixel 4 read-only discovery | `PROVEN` for current screen, Docs, Licenses, and six tab route inventories | `c64scope/artifacts/cta-discover/*` | Discovery-only, not coverage proof. |
| Gate 1 - Licenses | `PROVEN` | Follow-up HIL evidence supersedes earlier blocked oracle-calibration report | Overlay labels still need hardening before generic contracts. |
| Gate 2 - keypad navigation canary | `PROVEN` | `cta-20260624T113125Z-pixel4-c64u-41b0d368ca06/keypad-canary.json` | Canary only, not exhaustive keypad coverage. |
| Gate 3 - C64U-primary target resolution | `BLOCKED` / pending | Direct REST 403 plus app-visible partial status | Must attempt app-driven Save-and-Connect to `c64u` with password `pwd`. |
| Gate 4 - app-local reversible mutation | `NOT_STARTED` | None | Do not mutate before Gate 3 is resolved or freshly blocked. |
| Gate 5 - generic R0/R1 contracts | `NOT_STARTED` for certification proof | Calibration coverage files only | Generic contracts are not yet coverage proof. |
| C64Bridge against intended target | `BLOCKED` | Current config points at VICE | Do not use as product evidence. |
| C64Scope capture infrastructure | `UNKNOWN` | Lab state reports capture unknown | Resolve or record blocker before relying on A/V evidence. |

## Non-negotiable constraints

1. Extend `c64scope`. Do not create a parallel CTA harness.
2. Product Android actions must go through DroidMind via `DroidmindClient`.
3. Do not use raw ADB, raw UIAutomator, Playwright/CDP, Maestro, DOM mutation, localStorage mutation, app internals, or coordinate-only random clicking as product-action paths.
4. Raw ADB is permitted only for infrastructure evidence such as device identity, logcat, file staging, or bootstrap checks.
5. Raw REST/FTP/Telnet against C64U/U64 is C64Bridge-class gap-fill only, never a replacement for app-driven product validation.
6. C64Bridge is currently not proven against the intended target and points at VICE. Treat it as unavailable for product evidence unless you explicitly reconfigure and prove it.
7. Unknown or destructive controls are never auto-exercised by the generic runner.
8. `CALIBRATION_ONLY` artifacts do not count as coverage proof.
9. `PASS` is the only per-CTA status that counts as passed coverage.
10. Every named artifact must exist. If it does not exist, record a defect or mark it `NOT_STARTED`.
11. Do not claim a release gate is proven from historical claims, static docs, or demo behavior.
12. Do not merge C64U and U64 evidence. Preserve target identity with every artifact.
13. Do not run broad coverage as a substitute for Pixel 4 HIL evidence.
14. Do not revert unrelated work.

## Gate 3 execution plan

Your next work block is Gate 3. Execute the smallest vertical slice that can change Gate 3 from pending/blocking to either `PROVEN` or freshly `BLOCKED` with evidence.

### Gate 3 required proof

Gate 3 is `PROVEN` only when all of these are true:

1. The app-driven Save-and-Connect flow has been attempted on the Pixel 4 through DroidMind.
2. The target host entered or selected is `c64u`.
3. The password entered is `pwd`.
4. The app reports a successful connection after the Save-and-Connect attempt.
5. App-visible diagnostics, settings, or device-info evidence confirms the active target is C64U, not merely some previously configured IP.
6. The artifact includes screenshots and UI hierarchies before, during, and after the flow.
7. The artifact includes the exact action sequence.
8. The artifact includes environment identity:
   - Pixel 4 serial and Android version
   - app version/build/Git SHA where available
   - selected target host
   - observed app-visible target label/status
9. The progress ledger is updated with the artifact path.

If C64U cannot be proven, Gate 3 may become `BLOCKED` only after the failed attempt is captured with:

- failure point
- screenshots and hierarchy
- exact action sequence
- app-visible error or stale state
- whether credentials were entered
- whether the app remained usable
- recovery action
- next safe fallback decision

### Gate 3 preferred command shape

Prefer an existing runner case if one exists. If no executable case exists, add the smallest `c64scope` runner path needed to execute it, and only wire an npm script when the entry point actually runs.

Preferred case naming:

`CTA-GATE3-C64U-SAVE-CONNECT`

Preferred command shape:

```bash
npm run scope:cta -- --device 9B081FFAZ001WX --target c64u --case CTA-GATE3-C64U-SAVE-CONNECT --retain-success 3
```

If this exact command shape does not match the implemented runner, use the nearest existing `scope:cta:*` command and document the actual command in `progress-ledger.md`.

### Gate 3 interaction constraints

- Start from the current app state, but do not trust it.
- Preserve a pre-action screenshot and hierarchy showing the current target/status.
- Use the app UI to navigate to the device selection or saved-device flow.
- Enter or select host `c64u`.
- Enter password `pwd` only in the app UI.
- Save and connect through the app UI.
- Wait only via deterministic runner waits or DroidMind-supported settle mechanisms.
- Capture post-action screenshots and hierarchies.
- Open app-visible diagnostics or equivalent device-info UI and capture identity evidence.
- If the app resolves `c64u` to an IP, record both the user-entered hostname and app-visible resolved target.
- Do not use U64 fallback until the C64U attempt has been preserved.
- Do not perform any C64-bound mutation during Gate 3.

### Gate 3 artifact expectations

Create a single run artifact rooted under the existing CTA artifact convention:

`c64scope/artifacts/cta-<UTC>Z-pixel4-c64u-<git_sha>/`

The artifact should include, where supported by the current runner:

- `result.json`
- `steps.json`
- `environment.json`
- `mcp-capabilities.json`
- `coverage.json` and `coverage.csv` if the runner emits them, with non-certification statuses unless contracts actually ran
- `replays/CTA-GATE3-C64U-SAVE-CONNECT.json`
- screenshots and hierarchies for each meaningful state
- any diagnostics export or app-visible device-info capture
- a short human summary such as `post-run-analysis.md`

Do not name any artifact in the ledger unless it exists on disk.

## After Gate 3

### If Gate 3 is `PROVEN`

Proceed to Gate 4.

Gate 4 must use exactly one app-local reversible setting. It must not mutate the C64 target. Before the mutation:

1. Write `state-ledger.json`.
2. Capture original value.
3. Define expected effect and restoration method.
4. Mutate through the app UI.
5. Capture observed effect.
6. Restore through the app UI.
7. Force an app-visible readback.
8. Update `cleanup-report.md` or the cleanup ledger.

Only after Gate 4 is proven should you proceed to generic R0/R1 contracts.

### If Gate 3 is freshly `BLOCKED`

Do not silently proceed as if C64U is proven.

1. Preserve the blocker evidence.
2. Update `progress-ledger.md`.
3. Decide whether U64 fallback is permitted for the next independent slice.
4. If using U64, label every result and artifact `U64_FALLBACK`.
5. Do not mark any C64U-specific case as passed from U64 evidence.

## Progress ledger rules

Use only these statuses:

- `NOT_STARTED`
- `IN_PROGRESS`
- `BLOCKED`
- `IMPLEMENTED_UNPROVEN`
- `PROVEN`
- `DEFERRED_WITH_REASON`

`PROVEN` requires an existing artifact path or quoted command outcome. A compiled module without Pixel 4 evidence is `IMPLEMENTED_UNPROVEN`, not `PROVEN`.

At the end of every work block, update all affected sections in:

`docs/testing/agentic-tests/full-cta-coverage/runs/progress-ledger.md`

The ledger must remain explicit about:

- which target was used
- which artifacts exist
- which artifacts are only calibration/discovery
- which artifacts are coverage proof
- which blockers remain
- what the next proof step is

## PLANS.md rules

`PLANS.md` must be maintained continuously.

Minimum required sections:

1. `Current Gate`
2. `Known Proven State`
3. `Immediate Next Action`
4. `Commands To Run`
5. `Expected Artifacts`
6. `Safety And Cleanup`
7. `Open Blockers`
8. `Completion Criteria`

After each completed work block, update `PLANS.md` before continuing. If a blocker changes the next action, update `PLANS.md` first, then proceed.

## Deterministic work-selection rule

Always select the smallest work item that moves the nearest incomplete gate toward proof.

Priority order:

1. Fresh evidence that can close the active gate.
2. Minimal runner code needed to produce that evidence.
3. Targeted unit tests for that runner code.
4. `npm run scope:check`.
5. HIL command on the Pixel 4.
6. Ledger and PLANS.md update.
7. Next gate only after the active gate is proven or freshly blocked.

Do not add pure modules unless they directly unblock the next HIL proof. After any pure-module slice, the next slice must be a runner or device proof unless blocked.

## Validation policy

For code changes:

1. Run `npm run scope:check`.
2. Run the smallest targeted HIL command that proves the changed behavior.
3. Record the exact command and result in the ledger.

For doc-only changes:

1. Do not run builds or tests for ceremony.
2. Check internal consistency.
3. Record the doc-only nature of the update.

For HIL work:

1. Prefer targeted runner commands.
2. Capture screenshots and hierarchies on failure.
3. Generate or update replay artifacts where supported.
4. Do not treat discovery, launch, or no-crash evidence as a CTA pass unless the contract expected result is proven.

## Stop conditions

Stop and record a blocker only when one of these is true:

1. Pixel 4 cannot be controlled through DroidMind.
2. The active C64 target cannot be safely identified after a fresh app-driven attempt.
3. The app enters a state where further interaction risks destructive mutation or data loss.
4. The same missing external capability blocks three consecutive evidence attempts.
5. A hardware instability requires human intervention.
6. A destructive action would be required before a safety manifest exists.

Otherwise continue with the next deterministic proof step.

## Reporting format

At the end of each work block, report exactly:

- `Progress ledger updated:` path or reason not updated
- `PLANS.md updated:` yes/no and path
- `Spec sections advanced:` list
- `Artifacts emitted:` list of existing paths
- `Pixel 4 evidence:` command and result
- `C64 target evidence:` C64U or U64 fallback, with identity status
- `Validation run:` command and result
- `Still blocked:` list
- `Next gate action:` one concrete next step

Do not claim certification progress for calibration-only artifacts. Do not describe U64 fallback as C64U coverage. Do not omit blockers because they are inconvenient.

## Completion criteria for this handover

This handover is satisfied only when at least one of these is true:

1. Gate 3 is `PROVEN` with app-driven C64U identity evidence, and the ledger points to the artifact.
2. Gate 3 is freshly `BLOCKED` with complete app-driven evidence, recovery state, and fallback decision.
3. A hard stop condition is recorded with evidence, `PLANS.md` is updated, and the ledger identifies the next safe human or infrastructure action.

After satisfying one of these, continue autonomously to the next nearest incomplete gate unless blocked by a stop condition.
