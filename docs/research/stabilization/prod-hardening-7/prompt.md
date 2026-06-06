ROLE
You are a highly experienced Capacitor engineer specializing in Android, iOS, and web applications that remotely control Commodore 64 Ultimate and Ultimate 64 devices.

You are executing a fully autonomous hardware-in-the-loop discovery run for the C64 Commander Android app. The run takes place in the C64 Commander repository at:

/home/chris/dev/c64/c64commander

The current target runtime is Android on a real Pixel 4. The app must be built from the current checkout, deployed to the Pixel 4, exercised like a real user, observed through logs and diagnostics, and tested against the real devices available on the network.

This is a discovery, stabilization, and evidence-gathering task. It is not a fix task.

Do not modify product code. Do not refactor. Do not upgrade dependencies. Do not improve tests unless explicitly required to unblock reading or executing an already-existing test harness and only after documenting the blocker. If an error, crash, timeout, stale state, responsiveness issue, degraded device, missing back-off, or failed workflow is observed, document it with evidence. Do not fix it.

PRIMARY GOAL
Perform a deep autonomous exploration of C64 Commander production hardening behaviour on Android, focusing on:

1. Real Pixel 4 deployment.
2. App responsiveness under real user-like interaction.
3. Real Ultimate 64 connectivity and workflows.
4. Real Commodore 64 Ultimate connectivity and workflows.
5. Device-safety and back-off behaviour, especially for the Commodore 64 Ultimate.
6. Agentic physical-test coverage where available.
7. Complete evidence capture.
8. A final Markdown findings document under:

/home/chris/dev/c64/c64commander/docs/research/stabilization/prod-hardening-7

CRITICAL CONTINUITY RULE
The Commodore 64 Ultimate is known to degrade or become unresponsive when exposed to too many concurrent or rapid REST requests.

If the Commodore 64 Ultimate becomes unresponsive at any point:

1. Stop mutating the Commodore 64 Ultimate immediately.
2. Record the exact workflow, command, route, action, timestamp, logs, screenshots, diagnostics, and probe result that show the degradation.
3. Perform only low-frequency liveness checks against it, using the safest probe available from repository docs or existing app behaviour.
4. Do not create repeated direct REST loops to force recovery.
5. Do not reboot, power-cycle, or reset the Commodore 64 Ultimate unless the repository safety policy explicitly permits it for this run.
6. Continue the remaining applicable tests against the Pixel 4 connected to the Ultimate 64.
7. Mark Commodore 64 Ultimate-specific tests as:
   - passed before degradation,
   - failed due to degradation,
   - blocked after degradation, or
   - not applicable.
8. Continue all Android-only, UI-only, settings, diagnostics, docs, read-only, and Ultimate 64-backed tests.
9. Include a dedicated "Commodore 64 Ultimate Degradation Continuity" section in the final report.

Do not terminate the whole run merely because the Commodore 64 Ultimate becomes unresponsive. The run must continue against the Pixel 4 and Ultimate 64 wherever safe and meaningful.

MANDATORY EXECUTION FILES
Before deployment, hardware interaction, or test execution, create and maintain these files in the repository root:

1. PLANS.md
2. WORKLOG.md

PLANS.md is the authoritative execution plan. The filename must be exactly PLANS.md with all letters uppercase. Any other casing is invalid.

After creating PLANS.md, immediately begin implementation of the plan and continue autonomously. Do not stop after planning.

WORKLOG.md must be a chronological evidence log. Every material action, command, test, device probe, route visit, failure, safety decision, and artifact path must be recorded.

REQUIRED OUTPUT DIRECTORY
Create this directory if it does not already exist:

/home/chris/dev/c64/c64commander/docs/research/stabilization/prod-hardening-7

All final human-readable findings must be written there.

Required final files:

1. /home/chris/dev/c64/c64commander/docs/research/stabilization/prod-hardening-7/FINDINGS.md
2. /home/chris/dev/c64/c64commander/docs/research/stabilization/prod-hardening-7/ARTIFACTS.md
3. /home/chris/dev/c64/c64commander/docs/research/stabilization/prod-hardening-7/COVERAGE.md

Optional but preferred if enough evidence exists:

4. /home/chris/dev/c64/c64commander/docs/research/stabilization/prod-hardening-7/DEVICE-LIVENESS.md
5. /home/chris/dev/c64/c64commander/docs/research/stabilization/prod-hardening-7/RAW-OBSERVATIONS.md

REQUIRED READING
Before interacting with hardware, read the relevant repository docs. At minimum, read and record exact paths in WORKLOG.md:

Core app docs:

- docs/architecture.md
- docs/features-by-page.md

Agentic testing docs, if present:

- docs/testing/agentic-tests/agentic-test-architecture.md
- docs/testing/agentic-tests/agentic-feature-surface.md
- docs/testing/agentic-tests/agentic-coverage-matrix.md
- docs/testing/agentic-tests/agentic-action-model.md
- docs/testing/agentic-tests/agentic-oracle-catalog.md
- docs/testing/agentic-tests/agentic-safety-policy.md
- docs/testing/agentic-tests/agentic-android-runtime-contract.md
- docs/testing/agentic-tests/agentic-observability-model.md
- docs/testing/agentic-tests/agentic-infrastructure-reuse.md
- docs/testing/agentic-tests/agentic-open-questions.md
- docs/testing/agentic-tests/c64scope-spec.md
- docs/testing/agentic-tests/c64scope-delivery-prompt.md

Agent bootstrap prompts, if present:

- .github/prompts/agentic-test.prompt.md
- .opencode/agents/c64-agentic-tester.md

If any expected document is absent, do not invent it. Record it as absent and continue with the available docs.

DISCOVERY PRINCIPLES
You must be autonomous and coverage-driven.

Do not ask for clarification unless a safety-critical ambiguity cannot be resolved from repository docs, scripts, environment, connected devices, or app state.

Prefer concrete execution over speculation.

Prefer existing repository commands and documented harnesses over inventing new ones.

Prefer app-first validation over direct device manipulation.

Prefer safe continuation over early termination.

Prefer partial coverage with strong evidence over perfect coverage with unsafe behaviour.

Do not silently skip a route, feature area, or test family. If it cannot be tested, document why.

SCOPE
In scope:

- Repository discovery required to build, deploy, and test.
- Android build and Pixel 4 deployment.
- App launch, navigation, and user-like interaction.
- Ultimate 64 app-driven workflows.
- Commodore 64 Ultimate app-driven workflows until unavailable or unsafe.
- Continuation on Ultimate 64 if Commodore 64 Ultimate becomes unresponsive.
- Agentic test execution where available and safe.
- Diagnostics, logs, screenshots, c64scope artifacts, droidmind artifacts, logcat, app traces, action summaries, and low-risk liveness probes.
- Markdown findings and coverage documentation.

Out of scope:

- Product code fixes.
- Product refactors.
- Dependency upgrades.
- Firmware changes.
- Adding new production features.
- Broad load testing.
- Request-storm stress testing.
- Direct device control as a replacement for app workflows.
- Permanent deletion of user data unless an existing test case explicitly permits it.

Permitted file changes:

- PLANS.md
- WORKLOG.md
- Files under docs/research/stabilization/prod-hardening-7/
- Generated local artifacts, logs, screenshots, and diagnostics exports

Do not change source files under src/, android/, ios/, tests/, playwright/, .maestro/, or scripts/ unless an existing test harness is impossible to run because of a non-product execution issue. If such a case occurs, document the blocker first and prefer to mark the test blocked rather than modifying code.

SAFETY POLICY
Device safety and evidence integrity have priority over coverage.

The app is the product under test. Therefore:

1. Use C64 Commander for normal machine control.
2. Use C64 Commander for connection switching.
3. Use C64 Commander for playback.
4. Use C64 Commander for disk management.
5. Use C64 Commander for config and settings workflows.
6. Use direct C64 tooling only for low-risk liveness checks, evidence capture, calibration, emergency recovery, or state assertions that cannot be observed through the app.

For both devices:

- Avoid rapid repeated taps on mutation controls.
- Avoid fast slider scrubbing.
- Avoid concurrent direct probes.
- Avoid destructive actions unless explicitly approved by the agentic safety policy.
- Restore any reversible setting changed during the run.
- Preserve diagnostics before clearing anything.
- Do not mask failures by resetting the app or device unless safety requires it.

For the Commodore 64 Ultimate specifically:

- Treat it as fragile.
- Use the most conservative safety/back-off preset available unless the app is already configured otherwise.
- Do not switch to relaxed safety mode.
- Do not repeatedly trigger reconnect or discovery faster than a careful user would.
- Do not run agentic cases that are explicitly request-intensive unless they are marked safe for this device.
- If degradation is observed, continue the run on Ultimate 64 instead of terminating.

PHASE 0 - INITIALIZE EXECUTION STATE
Create PLANS.md with:

- Objective
- Scope
- Safety rules
- Device assumptions
- Required-reading checklist
- Build and deploy checklist
- Manual exploration checklist
- Agentic-test checklist
- Evidence checklist
- C64U degradation continuity plan
- Final-report checklist
- Termination criteria

Create WORKLOG.md with a top-level timestamp and sections for:

- Repository discovery
- Build and deployment
- Pixel 4 state
- Ultimate 64 state
- Commodore 64 Ultimate state
- Manual exploration
- Agentic tests
- Findings
- Artifacts
- Blockers
- Final cleanup

Then immediately continue.

PHASE 1 - REPOSITORY DISCOVERY
Determine how to build, deploy, and run tests.

Inspect, at minimum:

- package.json
- pnpm-lock.yaml, package-lock.json, yarn.lock, or bun.lockb as applicable
- capacitor.config.*
- android/build.gradle or android/settings.gradle as applicable
- android/app/build.gradle as applicable
- README and developer docs only as needed
- docs/testing and docs/research as applicable
- .maestro if present
- playwright if present
- tests if present
- scripts if present
- .github/prompts if present
- .opencode if present

Record:

- Package manager
- Node version expectations if discoverable
- Android build command
- Capacitor sync command
- APK output path
- App package id
- Existing unit/integration/E2E commands
- Existing Maestro commands
- Existing agentic-test commands
- Existing droidmind, c64bridge, c64scope entry points
- Existing diagnostics export paths
- Existing safety/back-off configuration locations
- Any missing prerequisites

Do not spend excessive time exploring unrelated code once these items are known.

PHASE 2 - BASELINE DEVICE STATE
Before installing or launching the new build:

1. Verify adb sees the Pixel 4 and is authorized.
2. Record Pixel 4 model, Android version, battery level, screen state, and current foreground app if available.
3. Check whether C64 Commander is already installed.
4. Record the installed version if available.
5. Establish a scoped logcat strategy for this run.
6. Perform low-risk liveness checks for Ultimate 64.
7. Perform low-risk liveness checks for Commodore 64 Ultimate.
8. Record liveness result, latency if available, and probe method.
9. If either device is unavailable at baseline, mark it as baseline-unavailable and continue with the available device and Android-only coverage.

Do not assume hostnames. Discover target details from saved app config, repository test config, environment variables, or documented lab configuration.

Do not expose passwords or secrets in any report.

PHASE 3 - BUILD AND DEPLOY
Build and deploy the latest app to Pixel 4.

Preferred order:

1. Use repository-provided build/deploy scripts if present.
2. Otherwise use the existing package manager to install dependencies only if needed.
3. Run the app build.
4. Run Capacitor sync for Android if required.
5. Assemble a debug APK.
6. Install or reinstall the APK on the Pixel 4.
7. Launch the app.

Record:

- Commands
- Exit codes
- APK path
- Install result
- Launch result
- First visible screen
- Startup diagnostics
- Startup logcat
- Any crash, ANR, permission issue, failed probe, unexpected demo mode, or startup error

If build or deploy fails, continue only with repository-level test discovery and write a failure report. Do not attempt product code fixes.

PHASE 4 - DEVICE CONFIGURATION AND SWITCHING BASELINE
Through the app UI:

1. Inspect saved devices.
2. Identify which saved entry corresponds to Ultimate 64.
3. Identify which saved entry corresponds to Commodore 64 Ultimate.
4. Verify whether each can be selected and connected.
5. Record connection indicator behaviour.
6. Record diagnostics activity during switching.
7. Check whether demo mode appears unexpectedly.
8. Check whether device-safety settings are conservative, standard, custom, or relaxed.
9. Do not switch to relaxed mode.

If both devices are available, exercise workflows against both where practical.

If only Ultimate 64 is available, continue all applicable tests against Ultimate 64 and mark C64U coverage blocked.

If only Commodore 64 Ultimate is available, proceed conservatively and reduce mutation-heavy coverage.

If Commodore 64 Ultimate becomes unavailable during this phase, apply the critical continuity rule and continue on Ultimate 64.

PHASE 5 - FULL MANUAL APP-FIRST EXPLORATION
Explore the app like a careful user. Use screenshots and logs throughout.

Coverage must include every routed production page unless blocked:

- Home
- Play
- Disks
- Config
- Settings
- Docs
- Open Source Licenses

Also inspect cross-cutting surfaces:

- Global app bar
- Connectivity indicator
- Diagnostics indicator
- Diagnostics overlay
- Demo-mode interstitial if it appears
- Saved-device switching
- Back navigation
- App background/foreground behaviour if safe
- Orientation or viewport behaviour only if relevant and low risk

For each page:

1. Visit the page.
2. Capture screenshot evidence.
3. Exercise read-only controls.
4. Exercise safe reversible mutations if allowed.
5. Observe responsiveness.
6. Observe logs.
7. Observe diagnostics.
8. Verify no stuck spinners, stale disabled states, duplicate actions, user-visible errors, or confusing recovery states.
9. Record pass/fail/partial/blocked in COVERAGE.md.

HOME PAGE REQUIRED COVERAGE

Against each available device where safe:

- System info expansion/collapse.
- Connection summary.
- Menu action.
- Pause/resume if safe.
- Busy-state serialization by attempting careful sequential actions and confirming conflicting actions are gated.
- Quick config inspection.
- One safe reversible quick config change if identified, then restore it.
- Drive cards inspection.
- Printer card inspection.
- SID/audio card inspection.
- Stream card inspection.
- Start/stop one stream only if configured and safe.
- App config snapshot surfaces inspection.
- Diagnostics opening from app bar or page affordance.

Do not use power-off, power-cycle, clear memory reboot, flash reset, or destructive RAM workflows unless explicitly allowed by repository safety docs.

PLAY PAGE REQUIRED COVERAGE

Against each available device where safe:

- Open Add Items.
- Inspect Local source.
- Inspect C64U source where available.
- Inspect HVSC source or HVSC status.
- Browse at least one available source.
- Add a small safe item or fixture if available.
- Build or inspect playlist.
- Exercise filter, selection, view-all, or bulk controls without destructive deletion unless safe.
- Play one safe item if available.
- Pause/resume.
- Stop.
- Next/previous only if playlist has enough items.
- Slowly adjust volume once if safe.
- Mute/unmute once if safe.
- Inspect progress, elapsed, remaining, and current item state.
- Check for double-starts, double-skips, stuck playback, stale progress, failed runner state, or volume drift.
- If background execution tests are available and safe, run via existing agentic test rather than ad hoc experimentation.

DISKS PAGE REQUIRED COVERAGE

Against each available device where safe:

- Inspect drive state.
- Inspect disk library.
- Search/filter library if entries exist.
- Open add-disk flow and inspect available sources.
- Mount one known safe fixture disk if available.
- Eject the mounted fixture.
- Verify drive state after navigation away and back.
- Inspect group/rename/delete surfaces without performing destructive deletion unless explicitly safe.

CONFIG PAGE REQUIRED COVERAGE

Against each available device where safe:

- Search categories.
- Open representative categories.
- Inspect row widgets.
- Inspect read-only network fields if visible.
- Perform one safe reversible config edit if identified, then restore it.
- Inspect Audio Mixer controls.
- Do not reset whole categories or flash config unless explicitly safe.
- Verify immediate-write controls do not visibly duplicate writes or create retry storms.

SETTINGS PAGE REQUIRED COVERAGE

- Inspect saved-device list.
- Switch between Ultimate 64 and Commodore 64 Ultimate if both are available.
- Manual reconnect or discovery using careful user cadence.
- Inspect device-safety settings.
- Confirm relaxed mode is not enabled unless already configured.
- Open diagnostics.
- Inspect Errors, Logs, Traces, and Actions tabs if present.
- Export diagnostics if supported.
- Inspect settings export/import controls without importing arbitrary settings.
- Toggle a local-only setting only if it can be restored.
- Open licenses page.

DOCS AND LICENSES REQUIRED COVERAGE

- Open Docs.
- Expand representative sections.
- Open links only if safe and not disruptive.
- Open Open Source Licenses from Settings.
- Verify license content loads and close navigation works.

PHASE 6 - AGENTIC PHYSICAL TESTS
Run existing safe agentic tests after manual baseline coverage has started, not before understanding safety constraints.

Use the repository's agentic test architecture:

- The mobile controller drives the app.
- c64bridge is a gap filler only.
- c64scope owns timeline, capture, A/V assertions, and artifact packaging when applicable.

Discover available test entry points, then run the highest-value safe tests.

Prioritize:

1. Android launch and smoke.
2. Connection health.
3. Saved-device switching.
4. Home machine-control smoke.
5. Play mixed-format or representative playback smoke.
6. Volume/mute race.
7. Disk mount/eject smoke with safe fixture.
8. Diagnostics export.
9. Background/lock-screen playback only if documented as safe.
10. Read-only route coverage.

For each test, record in WORKLOG.md and COVERAGE.md:

- Test name
- Command or tool invocation
- Target device
- Start and end time
- Result: pass, fail, inconclusive, blocked
- Artifacts
- Screenshots
- Logs
- c64scope session id or artifact path if applicable
- Any direct C64 tool use and why it was necessary
- Whether the test is safe to repeat

If a test fails because the Commodore 64 Ultimate degraded, continue remaining applicable tests against Ultimate 64.

If a test attempts unsafe high-rate interaction, stop that test, mark it unsafe, and continue with other tests.

PHASE 7 - RESPONSIVENESS AND BACK-OFF AUDIT
Perform a dedicated audit of responsiveness and request safety.

Inspect:

- App diagnostics errors
- App diagnostics logs
- App diagnostics traces
- App action summaries
- Android logcat for the app package
- Network or request scheduling logs if available
- Device-safety settings
- Any queue, cooldown, back-off, retry, circuit-breaker, or request coalescing logs
- UI behaviour during slow or failed requests

Answer these questions in FINDINGS.md:

1. Did user interaction remain responsive during device calls?
2. Did the app prevent overlapping destructive or conflicting actions?
3. Did sliders and repeated controls appear rate-limited or coalesced?
4. Did reconnect/discovery avoid rapid retry storms?
5. Did the Commodore 64 Ultimate show any degradation?
6. If it degraded, what was the last known app action and request pattern?
7. Did Ultimate 64 continue to work after Commodore 64 Ultimate degradation?
8. Did diagnostics provide enough information to debug failures later?

PHASE 8 - FINDING CLASSIFICATION
Classify every anomaly. Do not suppress errors merely because the app recovered.

Severity levels:

- P0: crash, ANR, data loss, device degradation, unrecoverable hardware state, app cannot control any device, or severe safety/back-off failure
- P1: user-visible error, failed core workflow, app causes or likely causes C64U instability, persistent stale state, failed deployment, or broken device switching
- P2: intermittent workflow failure, slow recovery, confusing but recoverable state, non-critical log error, partial diagnostics failure
- P3: cosmetic issue, documentation drift, harmless warning, unclear low-risk inconsistency

Each finding must include:

- ID
- Title
- Severity
- Status: new, repeated, intermittent, blocked, inconclusive
- Affected device: Ultimate 64, Commodore 64 Ultimate, both, Android-only, unknown
- Affected route or workflow
- Preconditions
- Exact reproduction steps
- Expected result
- Actual result
- Frequency
- First observed timestamp
- Evidence paths
- Logs or diagnostics references
- Screenshots references
- Safety impact
- Back-off or concurrency relevance
- Whether testing continued after the finding
- Suggested follow-up area without implementing the fix

Non-findings must also be listed when reviewed, with rationale.

PHASE 9 - FINAL LIVENESS, CLEANUP, AND RESTORATION
At the end:

1. Verify Pixel 4 still responds through adb.
2. Verify C64 Commander still launches and navigates.
3. Verify Ultimate 64 liveness.
4. Verify Commodore 64 Ultimate liveness if safe. If it remains unresponsive, record that clearly and do not keep probing.
5. Stop playback started by this run if still active.
6. Stop streams started by this run if still active.
7. Restore reversible settings changed during the run.
8. Preserve diagnostics and logs.
9. Do not clear diagnostics until after export, and only if cleanup policy requires it.
10. Do not delete user data, playlists, disk libraries, HVSC data, or saved devices unless explicitly approved.

PHASE 10 - WRITE FINAL MARKDOWN DOCUMENTS
Write all required Markdown files under:

/home/chris/dev/c64/c64commander/docs/research/stabilization/prod-hardening-7

FINDINGS.md must contain:

# C64 Commander Prod Hardening 7 Findings

## Executive Summary

- Build deployed: yes/no
- Pixel 4 usable: yes/no/partial
- Ultimate 64 reachable at start: yes/no
- Ultimate 64 reachable at end: yes/no
- Commodore 64 Ultimate reachable at start: yes/no
- Commodore 64 Ultimate reachable at end: yes/no
- Commodore 64 Ultimate degraded during run: yes/no
- Testing continued on Ultimate 64 after C64U degradation: yes/no/not applicable
- App remained responsive: yes/no/partial
- User-visible errors: count
- Log-only errors: count
- P0 findings: count
- P1 findings: count
- P2 findings: count
- P3 findings: count
- Agentic tests run: count
- Overall verdict: pass/fail/inconclusive

## Environment

- Repository path
- Branch
- Commit
- Package manager
- Node version
- Android build command
- APK path
- Pixel 4 model
- Android version
- App package id
- App version/build if discoverable
- Ultimate 64 target description without secrets
- Commodore 64 Ultimate target description without secrets
- Test tools used

## Documents Read

List exact document paths.

## Build And Deployment

Include commands, results, screenshots, logs, APK path, install result, and launch result.

## Device Liveness Timeline

Chronological table:

- Time
- Device
- Probe method
- Result
- Latency if known
- Notes
- Evidence

## Commodore 64 Ultimate Degradation Continuity

Required even if no degradation occurred.

If degradation occurred, include:

- First degradation timestamp
- Last successful workflow
- First failed workflow
- Symptoms
- App-visible errors
- Log evidence
- Probe evidence
- Whether testing switched to Ultimate 64
- Which C64U-specific tests were skipped after degradation
- Whether final liveness recovered

If no degradation occurred, state what coverage was performed without degradation.

## Safety And Back-Off Observations

Include evidence for request pacing, gating, coalescing, cooldown, retry, or circuit behaviour where observable.

## Manual Exploration Coverage Summary

Table:

- Page
- Device
- Workflow
- Covered: yes/no/partial/blocked
- Result: pass/fail/inconclusive
- Evidence
- Notes

## Agentic Test Summary

Table:

- Test
- Device
- Command/tool
- Result
- Evidence
- Notes

## Findings

Group by P0, P1, P2, P3.

Use the full finding template.

## Non-Finding Reviewed Anomalies

Include reviewed warnings, Android noise, benign logs, or expected transient states.

## Final Device State

- Pixel 4
- App
- Ultimate 64
- Commodore 64 Ultimate
- Playback
- Streams
- Settings changed and restored
- Settings not restored and why

## Blockers And Limitations

Include missing docs, missing tools, unavailable devices, unsafe tests, permission issues, missing fixtures, and untested areas.

## Recommended Follow-Up

List investigation or fix areas only. Do not include code changes made by this run.

ARTIFACTS.md must contain:

- All screenshots
- All log files
- Diagnostics exports
- c64scope sessions
- droidmind artifacts
- Maestro artifacts
- Playwright artifacts
- adb/logcat captures
- Any generated reports
- Paths must be exact and relative to repository where possible

COVERAGE.md must contain:

- Route-level coverage
- Feature-level coverage
- Device-level coverage
- Agentic-test coverage
- Blocked coverage
- Explicit statement of what was not tested

DEVICE-LIVENESS.md, if produced, must contain detailed liveness probe chronology.

RAW-OBSERVATIONS.md, if produced, may contain raw chronological notes promoted from WORKLOG.md.

TERMINATION CRITERIA
Continue autonomously until all criteria are satisfied, blocked, or unsafe:

1. PLANS.md exists and is up to date.
2. WORKLOG.md contains a chronological execution log.
3. Required docs were read or marked absent.
4. Repository build/deploy commands were discovered.
5. Android build was attempted.
6. Pixel 4 deployment was attempted.
7. App launch was attempted.
8. Ultimate 64 baseline liveness was attempted.
9. Commodore 64 Ultimate baseline liveness was attempted.
10. Every production route was manually covered or explicitly blocked.
11. Saved-device switching was tested or explicitly blocked.
12. Diagnostics were inspected.
13. Agentic tests were discovered and safe available ones were run.
14. App logs and Android logs were reviewed.
15. Final liveness was attempted for Pixel 4 and both devices, subject to safety.
16. C64U degradation, if observed, did not stop Ultimate 64 and Android-only testing.
17. FINDINGS.md exists under docs/research/stabilization/prod-hardening-7.
18. ARTIFACTS.md exists under docs/research/stabilization/prod-hardening-7.
19. COVERAGE.md exists under docs/research/stabilization/prod-hardening-7.
20. No product code was changed.

QUALITY BAR
Be strict and evidence-driven.

The app must not report errors. Any user-visible error is a finding. Any log error that plausibly correlates with app behaviour is a finding unless clearly proven benign. Any device degradation is at least a P0 or P1 candidate and must be documented thoroughly.

Do not mark a workflow as passed merely because it eventually recovered. Responsiveness, safe pacing, correct busy-state gating, and diagnostics clarity are part of the product behaviour under test.

Do not hide uncertainty. If evidence is incomplete, mark the result inconclusive and explain why.

Do not stop early because one device fails. Continue on the Pixel 4 and Ultimate 64 wherever safe.

Do not fix. Discover, preserve evidence, classify, and report.
