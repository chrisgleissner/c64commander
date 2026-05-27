ROLE

You are an expert senior production engineer working on C64 Commander, a React + Vite + Capacitor application that controls C64 Ultimate and Ultimate 64 devices over REST, FTP, and Telnet.

This is an implementation task for docs/research/stabilization/prod-hardening-3/prompt.md.

You are continuing after prod-hardening-2. Assume prod-hardening-2 was implemented mostly, but do not trust that it is complete or correct. Treat the current repository as the only source of truth for implementation state. Treat prod-hardening-2 documents as the intended contract to verify, harden, and extend.

Classify this task as CODE_CHANGE with required tests, documentation, and validation evidence.

Read these first, in this order:

1. .github/copilot-instructions.md
2. AGENTS.md and CLAUDE.md, if present
3. docs/research/stabilization/prod-hardening-2/research.md
4. docs/research/stabilization/prod-hardening-2/plans.md
5. docs/research/stabilization/prod-hardening-2/prompt.md
6. docs/architecture.md
7. docs/features-by-page.md
8. docs/ux-guidelines.md, if present
9. docs/testing/maestro.md, if present
10. Current code and tests in the repository

Immediately create docs/research/stabilization/prod-hardening-3/PLANS.md. This file is the authoritative execution plan. Keep it current after every meaningful step. After creating PLANS.md, immediately begin implementation and continue autonomously until all tasks are complete, tests are green, and all termination criteria are satisfied.

Also create and maintain docs/research/stabilization/prod-hardening-3/WORKLOG.md. Record what was inspected, what changed, which tests were run, exact command results, hardware validation results, and any concrete blocker.

Do not stop after analysis. Do not merely write a plan. Execute the plan.

CONTEXT

Prod-hardening-2 targeted device-call safety and health-check load. Its intended guarantees were:

1. All REST, FTP, and Telnet device traffic goes through the approved gateways:
   - REST: withRestInteraction
   - FTP: withFtpInteraction
   - Telnet: withTelnetInteraction
   - Config writes: scheduleConfigWrite in front of REST
2. No production code performs direct fetch, raw socket, or native-bridge calls to C64U or U64 device endpoints outside the approved boundaries.
3. Device-picker health in the switchDeviceDialog context keeps the existing 10 second full health cycle exactly as-is, including saved-device fan-out and CONFIG pulse.
4. backgroundMaintenance health is selected-device-only, freshness-gated, traffic-derived where possible, and uses only a single read-only GET /v1/info probe when a dedicated probe is warranted.
5. readmem and writemem are spaced by a machine-I/O cooldown policy.
6. readMemory, writeMemory, writeMemoryBlock, uploads, and probes carry the correct __c64uIntent.
7. Routine probes respect the circuit breaker and do not use __c64uBypassCircuit.
8. High-frequency UI interactions stay responsive through local state, latest-intent coalescing, and bounded trailing writes, not by bypassing device safety.
9. Regression tests and CI guards prevent reintroduction of unsafe device calls.
10. Global branch coverage remains >= 91 percent.

Prod-hardening-3 must validate those guarantees against the current code, fix any incompleteness, then harden the most production-risky feature paths identified by docs/features-by-page.md:

1. Background playback and auto-advance.
2. Playlist transitions.
3. Volume handling and mute/unmute.
4. Device connection lifecycle.
5. HVSC ingestion.
6. Disk mount synchronization.

PRIMARY GOAL

Make the app production-stable under realistic device fragility, app lifecycle changes, rapid user interaction, and cross-page device workflows.

This means:

1. The app must not overload C64U or U64 devices through bursts, parallel fan-out, or bypassed throttling.
2. The app must surface connection and health state promptly without causing more device pressure.
3. High-frequency controls must remain responsive locally while producing bounded, ordered outbound writes.
4. Playback, disk, config, diagnostics, and settings workflows must not leave stale state, duplicate operations, or inconsistent UI after failure, device switch, backgrounding, or retry.
5. Tests must prove the guarantees deterministically.

NON-NEGOTIABLE CONSTRAINTS

1. Preserve the approved device-call boundaries. Do not introduce another transport path.
2. Preserve the switchDeviceDialog 10 second full health cycle exactly. Do not change its cadence, fan-out, CONFIG pulse, UI intent, or product semantics.
3. Do not chase the firmware lock-up root cause. Assume any fast sequence of REST, FTP, or Telnet calls can wedge a fragile device and harden against the class.
4. Do not improve responsiveness by bypassing queues, cooldowns, circuit breakers, or scheduleConfigWrite.
5. Do not weaken tests, loosen assertions, remove guards, skip coverage, or hide failures.
6. Do not refactor unrelated files for style, taste, or architecture purity.
7. Do not create broad speculative abstractions. Prefer narrow fixes that strengthen existing primitives.
8. Do not change visible UX unless it is necessary to make state truthful, recoverable, or testable. If UI text changes are needed, keep them minimal and consistent with existing style.
9. Do not treat demo-mode behavior as proof of real-device behavior.
10. Do not claim hardware validation unless a real target was reached and the exact target was recorded.
11. Preserve source-specific contracts documented in docs/architecture.md. In particular, Play page source behavior must remain source-agnostic in the UI; source kind affects data access only.
12. Use metric-neutral wording and avoid cosmetic churn.

EXECUTION MODEL

Use an iterative convergence loop.

At the start of each loop:

1. Update PLANS.md with the current phase, tasks, acceptance criteria, and remaining risks.
2. Select the highest-risk incomplete task using this deterministic priority order:
   1. Safety bypass or device-overload risk.
   2. Incorrect health or connection state.
   3. Data loss, stale state, or duplicate device action.
   4. High-frequency UI write storm.
   5. Mobile lifecycle or native bridge failure.
   6. Missing or weak regression coverage.
   7. Documentation and PR description.
3. Inspect current code and tests before editing.
4. Make the smallest coherent change.
5. Add or update deterministic tests that fail before the fix and pass after it.
6. Run the narrowest relevant test command.
7. Update WORKLOG.md with evidence.
8. Continue until the numeric termination criteria are met.

If a step is blocked by missing hardware, missing credentials, unavailable Android device, or unavailable network target, record the exact blocker in WORKLOG.md and continue with all local deterministic work.

PHASE 0 - IMPLEMENTATION AUDIT OF PROD-HARDENING-2

Verify current code against every prod-hardening-2 acceptance criterion. Do not assume prior work is complete.

Audit and prove:

1. Direct device endpoint guard:
   - Search for fetch(, XMLHttpRequest, WebSocket, socket, TelnetSocket, native FTP bridge calls, and endpoint strings such as /v1/, :readmem, :writemem, :sidplay, :mount, :reset, telnet, and ftp.
   - Confirm production device calls outside approved boundaries are absent.
   - Confirm the CI guard is active and scoped correctly.
   - Confirm mock servers, non-device asset fetches, and test fixtures are allowlisted intentionally.

2. Gateway routing:
   - Confirm connectionManager discovery and probes use C64API getInfo through the REST gateway.
   - Confirm GlobalDiagnosticsOverlay validate-target uses gateway routing.
   - Confirm REST, FTP, and Telnet calls carry intentional metadata and intent.
   - Confirm config writes still go through scheduleConfigWrite.

3. Circuit and backoff:
   - Confirm routine health and discovery probes do not use __c64uBypassCircuit.
   - Confirm circuit-open means no background traffic.
   - Confirm user recovery actions have explicit, documented policy and do not silently skip throttling.

4. Memory and upload safety:
   - Confirm readMemory, writeMemory, writeMemoryBlock, and upload helpers forward __c64uIntent correctly.
   - Confirm readmem and writemem have cooldown keys and deterministic spacing tests.

5. Background health:
   - Confirm backgroundMaintenance does not run full runHealthCheckForTarget fan-out.
   - Confirm it probes only the selected device.
   - Confirm the dedicated probe is at most one read-only GET /v1/info and does not perform FTP, Telnet, CONFIG, RASTER, or JIFFY probes.
   - Confirm recent real traffic suppresses dedicated probes.
   - Confirm failed real traffic updates selected-device health without requiring an extra probe.
   - Confirm non-selected saved devices show last-seen or unknown state without background fan-out.
   - Confirm switchDeviceDialog remains unchanged.

6. High-frequency sliders:
   - Confirm ConfigItemRow sliders use latest-intent coalescing.
   - Confirm Home quick config, Lighting Studio, AudioMixer, Play volume, and Config rows all obey bounded outbound write guarantees.
   - Confirm long drags cannot produce unbounded scheduleConfigWrite queues.

7. Removed quirks:
   - Confirm updateConfigBatch has no dead immediate option.
   - Confirm request and fetchWithTimeout use one timeout mechanism each.
   - Confirm cache layering is documented or intentionally separated.

Deliverable for this phase:

- A completed audit section in PLANS.md and WORKLOG.md.
- Tests added or repaired for any missing proof.
- Fixes for any failed prod-hardening-2 acceptance criteria before moving on.

PHASE 1 - DEVICE PRESSURE AND CONNECTION LIFECYCLE HARDENING

Strengthen device safety across protocols and app state transitions.

Tasks:

1. Add or verify a shared device-pressure observer if not already present.
   - It must observe recent REST, FTP, and Telnet failures, circuit state, and in-flight work.
   - It must not replace the existing per-protocol gateways.
   - It must allow each gateway to defer or back off background and system work when another protocol has recently failed or is under pressure.
   - It must preserve user-priority semantics.

2. Harden device switch behavior.
   - Queued work for the previous target must be cancelled.
   - Late results from the previous target must not update the selected device UI.
   - Password, host, port, product identity, and demo-mode state must not leak across targets.
   - Tests must simulate a target switch while REST, FTP, Telnet, and config work is pending.

3. Harden foreground/background behavior.
   - backgroundMaintenance must not run while the app is hidden.
   - Foreground resume may trigger a bounded, freshness-gated selected-device check.
   - Playback background execution must not be broken by health suppression.
   - Tests must cover hidden, visible, resume, and polling-pause states.

4. Harden diagnostics and recovery.
   - Diagnostics overlay must not create background traffic storms.
   - Manual retry and validate-target must be user-initiated, gateway-routed, bounded, and observable.
   - Error toasts must not repeat indefinitely for aborted, cancelled, or superseded work.
   - Diagnostics export must include enough information to debug device-pressure and circuit state without exposing passwords.

Acceptance criteria:

1. No cross-protocol burst can be produced by background work alone.
2. Device switch cancels or isolates stale work deterministically.
3. App resume performs at most one selected-device lightweight probe when freshness requires it.
4. Diagnostics recovery is bounded and does not bypass safety.

PHASE 2 - HIGH-FREQUENCY INTERACTION HARDENING

Audit every user interaction that can emit repeated device calls.

Scope:

1. Home:
   - Machine controls.
   - Quick config sliders/selects/toggles.
   - Drive, printer, SID, stream controls.
   - RAM and REU workflows.
   - App config flash operations.

2. Play:
   - Playback transport.
   - Auto-advance.
   - Volume slider.
   - Mute and pause/resume volume restoration.
   - Source import and recursive enumeration.
   - Disk-backed playback transitions.

3. Disks:
   - Mount and eject.
   - Drive power and reset.
   - Group rotation.
   - Soft IEC path and config writes.
   - Delete mounted entry flow.

4. Config:
   - ConfigItemRow sliders.
   - Selects, toggles, text fields, and sync clock.
   - Audio mixer reset and solo restoration.

5. Settings:
   - Save and connect.
   - Saved-device switch.
   - Delete saved device.
   - Discovery retry.
   - Device-safety setting changes.
   - Diagnostics actions.

For each interaction:

1. Trace the outbound device calls.
2. Classify the interaction:
   - single user action
   - high-frequency preview
   - high-frequency commit
   - long-running operation
   - background maintenance
   - recovery action
3. Confirm it uses the correct gateway and intent.
4. Confirm it has bounded concurrency and bounded queue growth.
5. Confirm cancellation, supersession, and stale-result behavior.
6. Add or strengthen tests.

Required bounded-write tests:

1. For each slider family, >= 50 rapid changes must produce <= 1 in-flight write and <= 1 trailing write per lane, plus the final committed value.
2. The UI must display local draft state immediately.
3. The UI must not snap back to stale device state during an active drag or pending commit.
4. Failure must surface once, preserve the user's latest intent visibly, and allow retry without duplicating stale writes.
5. A device switch during a drag must cancel or isolate the old target's pending writes.

PHASE 3 - PLAYBACK, PLAYLIST, AND VOLUME STABILIZATION

Focus on the highest-risk Play page behavior.

Tasks:

1. Single-flight playback starts:
   - Confirm rapid Play, Next, Previous, Stop, Pause, Resume, and row play actions cannot start duplicate runners or conflicting mount/autostart operations.
   - Ensure superseded play plans cannot update current playback state after a newer intent wins.
   - Add deterministic unit and Playwright tests.

2. Auto-advance and background execution:
   - Confirm duration-driven completion advances once.
   - Confirm lock/background resume reconciliation cannot double-skip.
   - Confirm native BackgroundExecution callbacks are idempotent.
   - Confirm manual Stop suppresses pending auto-advance.
   - Run or document Maestro lock/background flows.

3. Volume and mute:
   - Confirm pause/resume volume restoration orders writes safely through scheduleConfigWrite.
   - Confirm mute/unmute preserves prior values and does not race with slider preview.
   - Confirm restore retries are bounded and respect device pressure.
   - Preserve existing volumeMuteRace coverage and add missing cases.

4. Mixed-source playlist restoration:
   - Confirm local, C64U, and HVSC playlist entries restore using source-agnostic UI behavior.
   - Confirm revoked local permission or missing runtime file handle surfaces a recoverable error.
   - Confirm HVSC source unavailability does not break non-HVSC playlist items.

5. Disk-backed playback transitions:
   - Confirm mount, reset, autostart, and first-PRG load are serialized and cancel stale transitions.
   - Confirm drive state refresh is triggered after success and reconciled after failure.

Acceptance criteria:

1. Playback state is single-owner and latest-intent-wins.
2. Auto-advance executes exactly once per due item.
3. Volume and mute cannot produce unbounded config writes.
4. Source-specific failures are recoverable and do not corrupt playlist state.

PHASE 4 - DISK, DRIVE, AND STATE RECONCILIATION HARDENING

Tasks:

1. Reconcile optimistic mounted-drive state with drive query state.
   - Confirm failed mount/eject clears or marks optimistic state appropriately.
   - Confirm delayed refetch cannot overwrite a newer user action.
   - Confirm Home, Disks, and Play agree on mounted state.

2. Harden group rotation.
   - Confirm stable ordering.
   - Confirm current mounted disk resolution is deterministic.
   - Confirm missing or deleted group members are handled without stale state.

3. Harden delete-mounted flow.
   - Confirm the app attempts eject first.
   - Confirm failure is surfaced and does not silently misrepresent device state.
   - Confirm local library deletion and device mount state remain consistent.

4. Harden Soft IEC.
   - Confirm config writes and drive refreshes are sequenced.
   - Confirm failures do not leave the UI in a false success state.

Acceptance criteria:

1. Home and Disks cannot permanently disagree about mounted state after a successful refresh.
2. Failed mount/eject paths are visible, recoverable, and tested.
3. Disk playback side effects are reconciled with the drive UI.

PHASE 5 - HVSC AND LONG-RUNNING NATIVE WORKFLOW HARDENING

Tasks:

1. HVSC download, extraction, ingestion, cancel, retry, and reset must be idempotent.
2. Low-memory and extraction failure paths must preserve app responsiveness.
3. Native bridge availability must be detected once and represented clearly.
4. Partial ingestion must not corrupt the index or playlist references.
5. Re-entry after app restart must show truthful status.
6. HVSC tests must cover success, cancellation, failure, retry, and low-memory simulation where existing infrastructure supports it.

Acceptance criteria:

1. Long-running HVSC work is cancellable or clearly non-cancellable by phase.
2. Failures preserve a recoverable state.
3. Playlist and browse behavior remain source-agnostic.

PHASE 6 - OBSERVABILITY, TEST GUARDS, AND DOCUMENTATION

Tasks:

1. Add or verify device-traffic observability.
   - Provide test-only counters or traces for REST, FTP, Telnet, config writes, readmem, writemem, and health probes.
   - Ensure counters can distinguish user, system, and background intent.
   - Ensure tests can assert ops-per-cycle and ops-per-minute ceilings without sleeping in real time.

2. Strengthen CI guards.
   - Guard direct device endpoint fetch or sockets outside approved modules.
   - Guard __c64uBypassCircuit use outside explicitly allowlisted recovery paths, if any.
   - Guard updateConfigBatch immediate from reappearing.
   - Guard switchDeviceDialog health cadence from accidental changes.
   - Guard backgroundMaintenance from reintroducing fan-out or multi-protocol probes.

3. Golden traces.
   - If REST routing, tracing semantics, or endpoint ordering changed, regenerate golden traces under playwright/fixtures/traces/golden.
   - Never weaken trace assertions to make failures pass.

4. Documentation.
   - Update docs/research/stabilization/prod-hardening-3/PLANS.md.
   - Update docs/research/stabilization/prod-hardening-3/WORKLOG.md.
   - Create docs/research/stabilization/prod-hardening-3/results.md summarizing findings, changes, tests, hardware validation, and remaining risks.
   - Create docs/research/stabilization/prod-hardening-3/pr-desc.md with a concise PR-ready summary.

TEST REQUIREMENTS

Run targeted tests after each changed area, then the full validation suite.

Minimum local validation:

1. npm run test
2. npm run lint
3. npm run build
4. npm run test:coverage

Coverage requirements:

1. Global branch coverage must be >= 91 percent.
2. If agents/ changes are made, npm run test:agents must show >= 90 percent branch coverage.
3. Do not reduce coverage thresholds.

Required deterministic tests:

1. prod-hardening-2 acceptance audit tests for any missing or weak guarantee.
2. Direct-device-call guard test.
3. Background health selected-device-only test.
4. Background health single GET /v1/info test.
5. Background freshness skip test.
6. Circuit-open zero-background-traffic test.
7. Picker-open health unchanged test.
8. Device switch cancellation and stale-result isolation tests.
9. Slider stress tests for Config, Home, Play volume, and AudioMixer paths.
10. Playback single-flight and auto-advance exactly-once tests.
11. Volume and mute race tests.
12. Disk mount/eject reconciliation tests.
13. Settings save/connect and discovery retry tests.
14. HVSC cancel/retry/failure tests, using existing infrastructure where available.

Use fake timers or deterministic schedulers where possible. Do not introduce long real-time sleeps.

HARDWARE AND MOBILE VALIDATION

After local validation, build and validate the Android APK if the repository supports it.

Required:

1. Locate the latest APK under android/app/build/outputs/apk/.
2. Deploy to the attached Pixel 4 when available. Prefer serial prefix 9B0 if multiple devices are present.
3. If installation is blocked, uninstall and reinstall only if this matches repo policy.
4. Launch the app and validate:
   - Settings save/connect.
   - Device picker health remains live on the 10 second full cycle.
   - Idle selected-device background health is quiet.
   - Home quick config and SID sliders remain responsive.
   - Config page sliders remain responsive and bounded.
   - Play volume and mute remain ordered.
   - Playback start, pause, resume, stop, and auto-advance behave once.
   - Disk mount/eject state reconciles.
   - Diagnostics validate-target and retry are bounded.
5. Prefer target http://u64/v1/info first, then http://c64u/v1/info.
6. Record exact target, product identity, APK path, device serial, and result in WORKLOG.md and results.md.

If hardware, Android device, adb, or target host is unavailable, record the exact blocker. Continue all local, Playwright, unit, and static validation.

COMMIT AND WORKING TREE HYGIENE

1. Inspect git status before editing.
2. Identify pre-existing unrelated changes and leave them untouched.
3. Do not reformat unrelated files.
4. Keep commits or change groups coherent if commits are requested by repo practice.
5. Ensure generated docs live under docs/research/stabilization/prod-hardening-3/.
6. Keep line endings consistent with repository convention.
7. Do not add secrets, host-specific passwords, binary dumps, or private logs.

TERMINATION CRITERIA

Stop only when all criteria are satisfied or a concrete blocker is documented:

1. PLANS.md exists, is current, and all tasks are marked done or explicitly blocked.
2. WORKLOG.md contains command results and validation evidence.
3. prod-hardening-2 acceptance criteria have been re-audited against current code.
4. Zero production direct device endpoint calls exist outside approved gateways.
5. CI guard prevents new direct device endpoint calls.
6. Routine probes do not bypass the circuit breaker.
7. backgroundMaintenance is selected-device-only, freshness-gated, traffic-derived, circuit-respecting, and limited to one read-only GET /v1/info when probing is needed.
8. switchDeviceDialog 10 second full health cycle is unchanged and tested.
9. High-frequency controls have bounded write tests and no stale snap-back.
10. Device switch cancels or isolates stale work across REST, FTP, Telnet, and config writes.
11. Playback auto-advance executes exactly once and single-flight play starts are enforced.
12. Volume and mute interactions are ordered, bounded, and tested.
13. Disk mount/eject state reconciles across Home, Disks, and Play.
14. HVSC long-running workflows remain recoverable after cancel, failure, retry, and app restart where testable.
15. npm run test passes.
16. npm run lint passes.
17. npm run build passes.
18. npm run test:coverage passes with branch coverage >= 91 percent.
19. Hardware or APK validation is completed, or exact blockers are recorded.
20. results.md and pr-desc.md are created.
21. Final response contains a concise summary of changes, tests run, hardware validation, and remaining risks.

FINAL RESPONSE FORMAT

Return only:

1. Summary of implemented changes.
2. Tests and commands run with pass/fail status.
3. Hardware/mobile validation result or exact blocker.
4. Remaining risks, if any.
5. Files changed, grouped by category.

Do not include speculation. Do not claim validation that was not performed.
