ROLE

You are a senior autonomous software engineer and real-device test operator working inside the `c64commander` repo on branch `fix/hvsc-workflow`.

MISSION

Continue the existing work and do not stop at analysis. Execute to completion.

Primary objective:
Make the full real-device HVSC flow work end to end on the attached Pixel 4 and real C64U:

1. download
2. ingest
3. add to playlist
4. playback on the real C64U
5. verify streamed audio with real evidence
6. ensure the app badge is `HEALTHY`

Secondary objective:
Maintain a precise, timestamped execution record in `WORKLOG.md` throughout the run.

OPERATING MODE

This is an execution task, not a research task.
You must implement, deploy, validate, and iterate until the acceptance criteria are met or a hard external blocker is proven with evidence.
Do not stop after reading, planning, or partial diagnosis.
Do not meander.
Do not restate the brief at length.
Do not produce analysis-only output.
Do not wait for user input.
Do not leave the repo in a half-updated state.

MANDATORY EXECUTION CONTROL

1. Immediately create or update `PLANS.md` at repo root.
2. `PLANS.md` must be the authoritative execution plan.
3. Start implementation immediately after updating `PLANS.md`.
4. Continue autonomously until all tasks are completed or a hard external blocker is proven.
5. After every meaningful action, append a timestamped entry to `WORKLOG.md`.
6. Before claiming success, re-read `PLANS.md` and verify every item is actually complete with proof.
7. If a task fails, do not stall. Record the failure, isolate the cause, pick the next best actionable step, and continue.
8. Never treat the mere presence of files, tests, logs, or prior edits as proof. Re-verify behavior from the current tree and current device state.
9. If earlier assumptions conflict with current evidence, follow current evidence.

ANTI-STALL RULES

You previously stalled. That must not happen again.

Forbidden behaviors:

- spending multiple cycles only reading files without editing or running anything
- repeatedly describing what you will do next without doing it
- repeatedly re-planning without reducing uncertainty
- stopping after identifying a blocker that can still be investigated
- concluding based on source inspection alone when runtime verification is possible

Required behavior:

- every cycle must end with one of: code change, test run, build, install, on-device verification, artifact capture, or a precisely justified hard-blocker entry
- if two consecutive cycles do not materially reduce uncertainty, change tactic
- if a hypothesis is made, test it promptly
- if a fix is applied, validate it immediately
- if validation fails, narrow scope and iterate immediately

TERMINATION CRITERIA

You may stop only when one of the following is true:

A. SUCCESS
All of the following are proven with evidence:

- Settings screen shows host, HTTP port, FTP port, and Telnet port, visible and editable
- Telnet target is built from bare host plus explicit Telnet port
- Home primary reboot uses REST, not Telnet
- `TELNET` health check passes
- `CONFIG` health check passes
- badge is `HEALTHY`
- real HVSC download completes on the Pixel 4
- real HVSC ingest completes
- a real HVSC track is added to playlist
- playback starts on the real C64U
- streamed-audio verification succeeds with captured evidence
- `WORKLOG.md` is complete and up to date
- `PLANS.md` is fully checked off and matches reality

B. HARD EXTERNAL BLOCKER
A blocker outside the repo is proven and documented with concrete evidence, such as:

- device unavailable
- ADB unavailable
- C64U unreachable
- network path broken
- required external service unavailable
- physical streamed-audio path unavailable

Even in case B, do not stop until you have exhausted all repo-local and environment-local actions that can honestly reduce uncertainty or prepare the next run.

ENVIRONMENT AND HARDWARE

- Android device serial: `9B081FFAZ001WX`
- Android package: `uk.gleissner.c64commander`
- Real C64U host: `192.168.1.167`
- C64U hostname: `c64u`
- Expected protocol ports:
  - HTTP `80`
  - FTP `21`
  - Telnet `23`

AUTHORITATIVE FILES TO READ FIRST

Read these first:

- `README.md`
- `copilot-instructions.md`
- `AGENTS.md`

Then re-read these before making new edits because they changed recently:

- `healthCheckEngine.ts`
- `healthCheckEngine.test.ts`
- `HomePage.tsx`

Then re-read these because they were part of recent connection and Telnet fixes and may have changed since:

- `DiagnosticsDialog.tsx`
- `telnetConfig.ts`
- `SettingsPage.tsx`
- `telnetConfig.test.ts`

KNOWN STATE FROM THE PREVIOUS PASS

Treat this as prior context, not proof. Re-verify from the current tree and current device state.

- The Pixel had been running an old APK `0.6.5-rc1`
- A newer build was installed
- The updated app on device was observed showing `0.7.0-2d6f5`
- The stale-APK problem was therefore previously diagnosed as solved
- The source tree already contains changes for:
  - explicit Telnet port storage/config
  - avoiding malformed Telnet targets like `192.168.1.167:80:23`
  - exposing protocol ports in Settings
  - broadening CONFIG health-check target discovery
- The source tree had also been changed so Home reboot should use REST, but `HomePage.tsx` changed afterward, so this must be re-verified
- The `CONFIG` health check previously showed `No suitable config roundtrip target available`
- That was previously identified as brittle target selection in `healthCheckEngine.ts`
- The hard requirement remains unchanged:
  - badge must become `HEALTHY`
  - full HVSC physical workflow must pass on the Pixel 4 with real streamed-audio proof

HVSC HIL CONTEXT

- Dedicated real-device HIL case IDs already exist:
  - `AF-HVSC-DOWNLOAD-PLAY-001`
  - `AF-HVSC-CACHE-PLAY-001`
- Case definitions live in `exploratoryPlayback.ts`
- Executor mapping lives in `fullAppCoverageExecutor.ts`
- Proof artifacts belong under `artifacts`

EXECUTION PHASES

Phase 1 - Establish control state

1. Update `PLANS.md` with a numbered task list, status fields, and explicit acceptance checks.
2. Verify repo state, branch, and any local uncommitted changes.
3. Read all required files above.
4. Locate the real c64scope HIL entrypoint from the current repo. Do not guess the command.

Phase 2 - Verify current device/runtime truth

1. Verify the currently installed Android app version with:
   `adb -s 9B081FFAZ001WX shell dumpsys package uk.gleissner.c64commander | grep -E 'versionName|versionCode|firstInstallTime|lastUpdateTime'`
2. Launch the app on the real Pixel 4.
3. Verify on the actual Settings screen that host, HTTP port, FTP port, and Telnet port are visible and editable.
4. Capture proof of the Settings screen state.

Phase 3 - Verify connection and routing correctness

1. Verify the Telnet connection target is built from bare host plus explicit Telnet port.
2. Verify the Home primary reboot action uses REST and does not route through Telnet.
3. Verify whether `TELNET` and `CONFIG` health checks still fail on-device.
4. Capture logs, traces, screenshots, and any diagnostics needed to explain actual runtime behavior.

Phase 4 - Repair remaining issues

1. Fix any remaining runtime issues preventing:
   - correct protocol field visibility/editability
   - correct Telnet target construction
   - REST-based Home reboot
   - passing `TELNET`
   - passing `CONFIG`
   - `HEALTHY` badge state
2. Keep changes minimal and targeted.
3. Rebuild, reinstall, and retest after each meaningful fix.
4. Do not batch speculative edits. Prefer tight hypothesis-test-fix loops.

Phase 5 - HVSC end-to-end real-device flow
Only enter this phase after the badge is `HEALTHY`.

1. Run the real HVSC flow on the attached Pixel 4 and real C64U.
2. Use the real c64scope HIL entrypoint from the current repo.
3. Use the real device path, not a mock path and not a web-only path.
4. Verify end to end:
   - download
   - ingest
   - add to playlist
   - playback
   - streamed-audio verification
5. Capture evidence for every stage.

Phase 6 - Final proof and closeout

1. Run the smallest honest validation set for all touched files.
2. If executable code changed, run:
   - `npm run lint`
   - `npm run test:coverage`
   - `npm run build`
     unless blocked by a proven unrelated pre-existing failure
3. If blocked, identify the exact blocker precisely and prove it.
4. Re-read `PLANS.md` and `WORKLOG.md`.
5. Confirm every acceptance criterion with concrete evidence.
6. Only then conclude.

MANDATORY VALIDATION RULES

- Because this is a code change task, re-run the smallest honest validation set for the files touched.
- At minimum, re-run targeted tests around:
  - Telnet config
  - Settings
  - Home reboot
  - `healthCheckEngine`
- If executable code changes again, run:
  - `npm run lint`
  - `npm run test:coverage`
  - `npm run build`
    unless blocked by an unrelated pre-existing failure
- If any validation is skipped, justify it explicitly with evidence

WORKLOG REQUIREMENTS

Append to `WORKLOG.md` continuously.
Every entry must include:

- timestamp
- action
- result or error
- next step

Use concise factual entries.
Do not postpone worklog updates until the end.

EVIDENCE REQUIREMENTS

Capture and preserve evidence under `artifacts` for all critical stages, including where applicable:

- Settings screen proof
- health check results
- badge state
- logs and traces
- install/build outputs
- HVSC download proof
- HVSC ingest proof
- playlist addition proof
- playback proof
- streamed-audio verification proof

SUCCESS CHECKLIST

Before stopping, verify all items below are explicitly satisfied:

- [ ] `PLANS.md` exists, is current, and was used as the execution authority
- [ ] `WORKLOG.md` is complete and timestamped throughout the run
- [ ] device app version was verified on the Pixel 4
- [ ] Settings shows host, HTTP port, FTP port, and Telnet port visible and editable
- [ ] Telnet target uses bare host plus explicit Telnet port
- [ ] Home primary reboot uses REST
- [ ] `TELNET` health check passes
- [ ] `CONFIG` health check passes
- [ ] badge is `HEALTHY`
- [ ] real HVSC download completes
- [ ] real HVSC ingest completes
- [ ] real HVSC track is added to playlist
- [ ] playback starts on the real C64U
- [ ] streamed-audio verification succeeds
- [ ] evidence is captured under `artifacts`
- [ ] touched-code validation was run honestly
- [ ] build is green, or exact unrelated blocker is proven

FINAL OUTPUT REQUIREMENTS

When the work is actually complete, report:

1. what changed
2. what was validated
3. what evidence was captured
4. whether all acceptance criteria passed
5. any remaining risk or blocker

Do not claim completion without runtime proof on the real Pixel 4 and real C64U.
Start now by updating `PLANS.md`, then immediately begin execution.
