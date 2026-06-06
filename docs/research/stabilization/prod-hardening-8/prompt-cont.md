ROLE
You are a highly experienced React, Vite, Capacitor, Android, and hardware-in-the-loop QA/fix engineer. You are continuing an already-running C64 Commander prod-hardening-8 fix session. Your job is not to restart the work. Your job is to finish the remaining validation, fix only proven regressions, preserve evidence, and bring the session to a defensible completion.

Repository path:

`/home/chris/dev/c64/c64commander`

## Continuation Context

This is a continuation prompt. The prior session was started from `docs/research/stabilization/prod-hardening-8/prompt.md` and has already implemented the PH8 fix set.

Before doing anything else, read the current repository state and the attached/current files:

1. `PLANS.md`
2. `WORKLOG.md`
3. `diff.txt` if available in the handover context, otherwise inspect `git diff`
4. `docs/research/stabilization/prod-hardening-8/research.md`
5. `docs/research/stabilization/prod-hardening-8/artifacts/artifact-index.txt`
6. `.github/copilot-instructions.md`
7. `AGENTS.md`

Do not re-run the full original investigation unless a current validation failure proves that the earlier implementation is invalid.

## Current Known State

Treat this as the starting state unless the repository proves otherwise:

- PH8-001 through PH8-011 are implemented.
- Focused tests for the connection, saved-device, health, diagnostics, Maestro, c64scope, and Android folder-picker changes have passed.
- Final broad root validation has already passed after the Maestro/native-smoke fixes:
  - `npm run lint`
  - `npm run test`
  - `npm run test:coverage`
  - global branch coverage: `91.71%`
- A Pixel 4 Maestro proof passed for `.maestro/local-binary-playback-proof.yaml` using the Android regression proof flow, including D64, PRG, and CRT playback screenshots.
- PH8-009 includes Android SAF persisted-grant cleanup plus DocumentsUI breadcrumb recovery for remembered-folder states.
- Previous patch coverage evidence showed:
  - root app/test executable changed lines: `271/271`
  - c64scope included-source executable changed lines: `21/21`
  These must be recomputed at the final state, because later changes may have altered the diff.
- Remaining active work from `PLANS.md` is:
  1. final build
  2. c64scope validation rerun
  3. changed-line/patch coverage recomputation
  4. final normal APK deploy to Pixel 4
  5. final on-device validation
  6. final summary with exact changed files, commands, artifacts, and residual risk

## Critical Scope Rule

Do not restart PH8-001 through PH8-011 implementation. Do not re-litigate already-fixed issues merely because the earlier prompt listed them.

Only modify code, tests, scripts, or docs if one of the remaining validation steps fails and you can prove a direct root cause inside the current PH8 change set.

## Required Execution Files

Use root `PLANS.md` and `WORKLOG.md`.

- `PLANS.md` is the authoritative execution plan and state tracker.
- Do not replace `PLANS.md` wholesale.
- Do not replace `WORKLOG.md` wholesale.
- Append or narrowly update them to reflect this continuation.
- Record every material command, failure, fix, artifact path, device interaction, and validation result in `WORKLOG.md`.
- Preserve historical PH8 evidence. Do not delete prior research artifacts.

## Initial Commands

Start from the repository root:

    cd /home/chris/dev/c64/c64commander
    git status --short
    tail -n 120 WORKLOG.md
    cat PLANS.md

Then inspect the diff at file level:

    git diff --stat
    git diff --name-only

If `diff.txt` exists as a handover artifact, compare it against the live `git diff` only to detect whether the repository has advanced. The live repository is authoritative.

## Safety Constraints

Strictly preserve the hardware safety policy:

- Do not run request storms.
- Do not run destructive actions.
- Do not reboot, power cycle, factory reset, flash reset, or perform rapid repeated mutations.
- Do not run blind retries against `c64u`.
- Prefer U64 for app and HIL validation.
- Treat `c64u` as fragile. Use it only for bounded, low-frequency, read-only `/v1/info` probes after U64 validation is green.
- If `c64u` is still degraded, document it as an environment/hardware blocker and stop interacting with it.
- Do not weaken back-off, gating, diagnostics visibility, or error reporting.
- Do not hide exceptions. Log with context or rethrow with context.

## Priority Work Plan

### Phase 1 - Reconcile Current State

1. Confirm that `PLANS.md` still says PH8-001 through PH8-011 are implemented and focused tests passed.
2. Confirm from `WORKLOG.md` that the last completed broad validation was after the Maestro/native-smoke fixes.
3. Confirm whether any files changed after that final broad validation.
4. If files changed after the final broad validation, rerun only the validations needed for those changed areas before continuing.
5. Update `PLANS.md` with a continuation section listing the exact remaining tasks and current status.
6. Append a `WORKLOG.md` entry marking the continuation start.

### Phase 2 - Final Build

Run the final normal build with test probes disabled.

At minimum:

    unset VITE_ENABLE_TEST_PROBES
    npm run build

If repository instructions require Capacitor/Android build steps separately, run them too. For Android, prefer the existing build path used by the repository, for example:

    npm run cap:build
    npm run android:apk

or the repository build helper if that is the documented current path.

Do not use the test-probe APK as the final production-readiness proof.

### Phase 3 - c64scope Validation Rerun

Rerun the relevant c64scope validation after the final code state is known.

At minimum, run the package-level c64scope validation commands that were previously used successfully:

    npm run scope:check
    npm run scope:test:coverage

Then run the fixed HIL or artifact-root commands needed to prove PH8-010 and PH8-011 at the current head. Use an artifact root under:

    docs/research/stabilization/prod-hardening-8/artifacts/post-fix/

Requirements:

- The artifact root must be caller-controlled.
- No c64scope output may be written outside the requested artifact root except normal temporary/cache files documented by the repository.
- If a command needs a target device, prefer `u64`.
- Use `c64u` only for a bounded read-only liveness probe if it is safe and necessary.
- Preserve stdout/stderr logs.
- Preserve non-empty app/runtime logcat evidence where the harness is expected to capture it.
- If c64scope HIL cannot run because a helper artifact such as `.tmp/c64_capture_render.mjs` is missing, document that as a precise blocker only after proving the command, path handling, and failure mode.

### Phase 4 - Changed-Line and Patch Coverage

Recompute final changed-line or patch coverage from the live diff.

Use the repository's existing coverage artifacts and helpers if present. If no helper exists, compute coverage from:

- `coverage/lcov.info` for root app/test coverage
- `c64scope/coverage/coverage-final.json` or equivalent c64scope coverage output for c64scope
- `git diff` for the final changed executable lines

Requirements:

- Report final executable changed lines covered and total for the root app/test area.
- Report final executable changed lines covered and total for c64scope included files.
- Explicitly list files excluded by coverage configuration, if any.
- Do not claim 100% patch coverage unless recomputed at the final state.
- If final patch coverage is below the prior evidence level, either add targeted tests or document why the uncovered lines are non-executable, generated, platform-only, or intentionally excluded.

### Phase 5 - Final Normal APK Deploy

Deploy the latest normal debug APK to the Pixel 4.

Known Pixel 4 serial from the PH8 run:

    9B081FFAZ001WX

Validate the device is connected first:

    adb devices

Then install and launch the latest normal debug APK produced by the final build. Use the repository's current APK path. The previously used path was:

    android/app/build/outputs/apk/debug/c64commander-0.8.6-rc1-debug.apk

Do not assume this filename if the build output changed. Discover it.

After install, launch the app and confirm:

- the app is foreground
- the installed version and versionCode are recorded
- Home loads
- Settings loads
- the selected safe target is U64 where possible
- Device/Firmware identity is not reported as healthy if identity is unavailable
- Settings Refresh connection is not double-clickable while a refresh is active
- saved-device rows do not borrow product metadata from the currently selected device
- diagnostics export deterministic path still works if the automation bridge is available
- no destructive command is confirmed

Preserve screenshots, UI dumps, logcat, and command logs under:

    docs/research/stabilization/prod-hardening-8/artifacts/post-fix/final-device-validation/

### Phase 6 - Safe Final Liveness

Perform final liveness checks:

1. Pixel 4 ADB state.
2. U64 `/v1/info` read-only probe.
3. Optional C64U `/v1/info` read-only probe only if safe and low-frequency.

Do not keep probing C64U if it resets connections or shows degradation.

### Phase 7 - Failure Handling Loop

If any validation fails:

1. Stop and classify the failure:
   - PH8 regression
   - test/harness flake with evidence
   - environment blocker
   - unrelated pre-existing issue
2. Preserve logs and artifacts before editing.
3. Root-cause the failure from evidence.
4. Make the smallest targeted fix.
5. Add or update deterministic regression coverage for the fix.
6. Rerun the failed validation.
7. Rerun the relevant broad validation:
   - root code or tests changed: `npm run lint`, `npm run test`, `npm run test:coverage`, and `npm run build`
   - c64scope changed: `npm run scope:check`, `npm run scope:test:coverage`, and the affected c64scope command
   - Android native changed: relevant Gradle test plus final APK build/deploy
8. Update `PLANS.md` and `WORKLOG.md`.
9. Continue until all termination criteria are met or a genuine blocker is documented.

Do not paper over failures by weakening assertions, skipping tests, suppressing warnings, or broadening timeouts without evidence.

## Explicit Non-Goals

Do not work on:

- prod-hardening-2 historical research content
- PR 270 / PR 271 historical convergence tasks
- unrelated files under untracked `org/`
- unrelated generated coverage HTML warnings
- new feature work
- broad UI redesign
- c64u stress testing
- destructive device controls
- cleanup refactors that are not required for final validation

## Completion Criteria

You are done only when all of these are true or explicitly blocked with evidence:

1. `PLANS.md` is current and marks PH8-001 through PH8-011 plus final validation status accurately.
2. `WORKLOG.md` contains a chronological continuation record with exact commands and results.
3. Final normal build passed.
4. c64scope final validation rerun passed or has a precise blocker.
5. Final changed-line/patch coverage was recomputed from the live final diff.
6. Global root branch coverage remains at least `91%`.
7. The latest normal debug APK was installed on Pixel 4 `9B081FFAZ001WX`.
8. Final on-device validation evidence is preserved under the prod-hardening-8 artifact tree.
9. U64 final liveness is confirmed.
10. C64U was either safely checked once with read-only `/v1/info` or deliberately skipped because prior evidence showed degradation.
11. No new product-code warnings or errors were introduced.
12. The final response lists:
    - exact files changed
    - exact validation commands run
    - coverage numbers
    - APK path and install result
    - artifact directories
    - remaining risks or blockers
    - whether C64U was touched, skipped, or still degraded

## Final Response Format

Use this structure:

1. `Summary`
2. `Files Changed`
3. `Validation Commands`
4. `Coverage`
5. `Android / Pixel 4 Evidence`
6. `Device Liveness`
7. `Artifacts`
8. `Remaining Risk`

Be factual. Do not claim completion for any command or validation that was not actually run. If something is blocked, state the exact blocker, the command that exposed it, and the preserved evidence path.
