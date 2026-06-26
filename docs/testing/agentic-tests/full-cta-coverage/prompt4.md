 # C64 Commander / C64U Remote Final Bug-Free Proof Prompt

## Role

You are a Principal Android QA Engineer, agentic tester, LLM engineer, Capacitor engineer, Android HIL automation engineer, and C64 Ultimate integration specialist.

Your job is not to write another handover, not to produce a partial audit, and not to stop after a smoke test. Your job is to **find, fix, and prove the absence of remaining known bugs** in the current C64 Commander Android app and its C64U Remote variant.

C64 Commander and C64U Remote are the same underlying app surface with different branding and feature flags. Test and reason accordingly.

You must operate the real Pixel 4 and real C64 target through the app. You must fix product bugs you find, build and install the fixed app, rerun the relevant HIL tests, and continue until the app satisfies the completion gates in this prompt.

A final completion response is allowed only when the app is proven bug-free within the defined scope. If a hard external blocker prevents proof, you must not claim bug-free completion. You must instead produce a blocker report with exact evidence and continue all independent testing that remains possible.

## Primary objective

Prove that the current app build is bug-free for the following high-value flows:

1. Adding programs, songs, and disks to playlists or libraries.
2. Playing programs, songs, and disks from those playlists or collections.
3. Playback transport:
   - play
   - stop
   - pause
   - resume
   - previous
   - next
   - forward where present
   - rewind where present
   - repeat
   - shuffle
   - rapid transport actions
4. Auto-advance:
   - foreground
   - background
   - screen locked
   - screen unlocked after elapsed deadlines
   - app backgrounded and resumed
   - final-item behavior
   - repeat on/off
   - shuffle on/off
5. Disks collection:
   - local import
   - C64U import/source browsing
   - add to collection
   - mount
   - unmount/eject
   - previous disk
   - next disk
   - disk swapping within groups
   - Drive A
   - Drive B where present
   - Soft IEC where present
6. Filtering:
   - playlists by text
   - playlists by labels/tags where present
   - disk collections by text
   - disk collections by labels/groups where present
   - zero-result, one-result, many-result, unicode, duplicate, long-name cases
7. C64U health:
   - no silent degradation
   - no incorrect “healthy” status while degraded
   - no stale optimistic drive, playback, config, or playlist state
   - no request storm
   - no unbounded retry
   - no app crash or ANR
   - no JavaScript console errors
   - no unhandled promise rejections
   - no native logcat errors attributable to the app
8. Variant safety:
   - C64U Remote must not expose features hidden by its variant flags.
   - Visible text, docs, diagnostics, and branding must match the variant.
9. Cleanup:
   - playback stopped
   - test playlist entries removed
   - test disks ejected
   - test collections restored
   - app settings restored
   - device connection restored
   - final C64U state healthy or explicitly blocked by external firmware/device evidence

## Hard completion rule

You may complete only with:

`BUGFREE-PROVEN`

This final status is allowed only when all of the following are true:

1. Current APK was built from the current source state and installed on the Pixel 4.
2. Installed package identity was captured after installation.
3. App-visible C64U connection was proven through the app UI.
4. C64U did not degrade during the final passing run.
5. If C64U degraded at any point, a defect or firmware-blocker file records:
   - exact UTC
   - app route
   - active flow
   - exact previous actions
   - immediate priority actions
   - screenshots
   - UI hierarchies
   - logcat
   - app diagnostics where reachable
   - direct target health probe as infrastructure evidence
   - whether U64 fallback was used
6. U64 fallback was used only after preserving C64U failure evidence.
7. U64 results are labelled `U64_FALLBACK` and never counted as C64U pass evidence.
8. Every runtime-discovered CTA has a final accounting row.
9. Every high-value flow in this prompt has a final status.
10. Every safe CTA in the high-value flows has been activated through touch where applicable.
11. Every safe critical CTA has been reached and activated through Android key events where applicable.
12. Destructive or irreversible CTAs have discovery, focus, warning, cancel, Back, no-accidental-activation, and safety-block evidence.
13. Every bug found was fixed or explicitly proven to be external and unfixable in-app.
14. Every fix has:
    - focused unit tests
    - `npm run scope:check` pass
    - app rebuild
    - Pixel 4 reinstall
    - HIL regression proof
15. All final HIL runs have:
    - no app crash
    - no ANR
    - no relevant Android logcat errors
    - no JavaScript console errors
    - no unhandled promise rejections
    - no C64U degraded badge
    - no stale optimistic state
    - no password leakage
16. Cleanup is proven with final screenshots, hierarchies, state readback, and a cleanup report.
17. Final unaccounted CTA count is zero.
18. Final untested high-value flow count is zero.
19. Final open S0/S1/S2 app-defect count is zero.
20. Final open untriaged issue count is zero.

If any item above is false, you are not finished.

## Prior state to respect

Before executing, read these files completely:

- `docs/testing/agentic-tests/full-cta-coverage/prompt.md`
- `docs/testing/agentic-tests/full-cta-coverage/prompt2.md`
- `docs/testing/agentic-tests/full-cta-coverage/handover1.md`
- `docs/testing/agentic-tests/full-cta-coverage/handover2.md`
- `docs/testing/agentic-tests/full-cta-coverage/handover3.md`
- `docs/testing/agentic-tests/full-cta-coverage/handover4.md`
- `docs/testing/agentic-tests/full-cta-coverage/handover5.md`
- `docs/testing/agentic-tests/full-cta-coverage/handover6.md`
- `docs/testing/agentic-tests/full-cta-coverage/handover7.md`
- `docs/testing/agentic-tests/full-cta-coverage/handover8.md`
- `docs/testing/agentic-tests/full-cta-coverage/final-report-3.md`
- `docs/testing/agentic-tests/full-cta-coverage/cleanup-report-3.md`
- `docs/testing/agentic-tests/full-cta-coverage/bug-hunt-report.md`
- `docs/testing/agentic-tests/full-cta-coverage/cleanup-report-bughunt.md`
- `docs/testing/agentic-tests/full-cta-coverage/fix-report.md`
- `docs/testing/agentic-tests/full-cta-coverage/defects/*.md`
- `docs/testing/agentic-tests/full-cta-coverage/runs/progress-ledger.md`
- `PLANS.md`
- `WORKLOG.md`
- `AGENTS.md`
- `REVIEW.md`
- `.github/copilot-instructions.md`

Treat these as starting facts unless fresh evidence disproves them:

- Pixel 4 serial: `9B081FFAZ001WX`.
- Package: `uk.gleissner.c64commander`.
- Primary target: `c64u`.
- Primary target password: `pwd`.
- Primary ports: HTTP `80`, FTP `21`, Telnet `23`.
- U64 fallback: `u64`, password empty.
- Prior exhaustive CTA accounting was incomplete.
- Prior runtime discovery found hundreds of CTAs, but discovery-only rows are not pass evidence.
- Prior S1 Disks/C64U degradation was later attributed to a C64U firmware TCP wedge on idle reconnect.
- The app may mitigate C64U firmware risk, but cannot cure firmware defects.
- The app must still avoid causing unnecessary request bursts, stale optimistic UI, false “OK”, or silent degradation.
- C64U Remote is a variant of the same underlying app, not a separate unrelated product.

## Control boundaries

All Android product actions must go through DroidMind via the existing `DroidmindClient` or c64scope wrappers that internally use `DroidmindClient`.

Allowed product actions through DroidMind:

- start app
- stop app
- tap
- swipe
- scroll
- input text
- press Android key event through `DroidmindClient.pressKey()`
- screenshot
- UI hierarchy capture
- interact with Android pickers
- interact with share sheets
- background, foreground, lock, unlock, relaunch, rotate where supported

Raw ADB is allowed only for infrastructure:

- device identity
- package identity
- APK install
- logcat capture
- file staging
- filesystem evidence that does not replace product validation

Raw REST, FTP, Telnet, and C64Bridge are allowed only for:

- target health probes
- readback support
- fixture staging where no app route exists
- emergency recovery
- firmware-defect evidence

They cannot turn a non-app-driven action into a product pass.

Do not use:

- raw ADB key events for product input
- Playwright or CDP to mutate app state
- DOM mutation
- localStorage mutation
- hidden routes
- mocks
- app internals
- coordinate-only random clicking
- historical screenshots as fresh proof

Coordinates may be used only after a semantic target was identified from hierarchy, label, resource id, role, test id, text, or stable bounds.

## Product-code change policy

This is both a bug hunt and a fix task.

You must fix product app defects discovered during this run unless the defect is proven external to the app, such as a C64U firmware wedge. For each app fix:

1. Preserve failing evidence first.
2. Write or update a defect file.
3. Identify suspected component.
4. Make the smallest safe product change.
5. Add or update unit tests.
6. Run focused tests.
7. Run `npm run scope:check`.
8. Rebuild the APK.
9. Install on Pixel 4.
10. Rerun the exact HIL reproduction.
11. Rerun neighboring regression flows.
12. Update defect file with fix verification.
13. Continue bug hunt.

Do not modify product behavior merely to hide the bug. Do not weaken assertions. Do not bypass UI workflows.

## Required state files

Maintain these continuously:

- `PLANS.md`
- `WORKLOG.md`
- `docs/testing/agentic-tests/full-cta-coverage/runs/progress-ledger.md`
- `docs/testing/agentic-tests/full-cta-coverage/runs/final-bugfree-ledger.md`
- `docs/testing/agentic-tests/full-cta-coverage/exhaustive-cta-ledger-final.md`
- `docs/testing/agentic-tests/full-cta-coverage/flow-ledger-final.md`

`PLANS.md` must always contain:

- branch
- Git SHA
- dirty source files
- current APK build identity
- installed package identity
- Pixel 4 identity
- C64U identity
- U64 fallback identity
- active phase
- active route
- active overlay
- active flow
- current blocker list
- remaining CTA count
- remaining high-value flow count
- remaining negative-path count
- remaining lifecycle count
- remaining cleanup tasks
- exact next command or DroidMind action

`WORKLOG.md` must record:

- every material command
- every runner invocation
- every DroidMind action group
- every C64 health probe
- every artifact path
- every bug candidate
- every fix
- every retest
- every cleanup action
- every decision and evidence basis

`final-bugfree-ledger.md` must include one row per route, overlay, flow, CTA group, bug candidate, fix, and cleanup task.

Allowed ledger statuses:

- `NOT_STARTED`
- `IN_PROGRESS`
- `BUG_FOUND`
- `FIX_IN_PROGRESS`
- `FIXED_NEEDS_HIL_RETEST`
- `FIXED_AND_HIL_VERIFIED`
- `NO_BUG_FOUND_AFTER_EXHAUSTIVE_TEST`
- `BLOCKED_WITH_EVIDENCE`
- `SAFETY_BLOCKED_NOT_EXECUTED`
- `INCONCLUSIVE_REPLAY_REQUIRED`
- `NOT_PRESENT_WITH_REASON`
- `SPEC_GAP_WITH_EVIDENCE`

Do not use vague statuses such as `done`, `checked`, `looks fine`, `reviewed`, or `probably ok`.

## Required first execution sequence

Execute in order:

1. Run `git status --short`.
2. Run `git branch --show-current`.
3. Run `git rev-parse HEAD`.
4. Read the current state files and prior defect files listed above.
5. Update `PLANS.md` with this run’s current plan.
6. Update `WORKLOG.md` with session start, assumptions, and first actions.
7. Create or update `final-bugfree-ledger.md`.
8. Run `npm run scope:check`.
9. Build the current APK from the current source state unless you prove the installed APK corresponds exactly to current source and desired variant.
10. Install the current APK on Pixel 4.
11. Capture installed package identity:
    - versionName
    - versionCode
    - firstInstallTime
    - lastUpdateTime
    - package path
    - APK checksum
    - signing info if practical
12. Launch through DroidMind.
13. Capture baseline screenshot.
14. Capture baseline UI hierarchy.
15. Capture logcat from before launch through stable app state.
16. Run direct `c64u` health probe as infrastructure evidence only.
17. Resolve app-visible target state.
18. If app-visible target is not green `C64U`, run app-driven Save-and-Connect:
    - host `c64u`
    - password `pwd`
    - HTTP `80`
    - FTP `21`
    - Telnet `23`
19. Capture post-connect screenshot, hierarchy, action log, logcat, and diagnostics if reachable.
20. If C64U remains disconnected in the app while direct health is good, write or update an S1/S2 defect and continue all independent disconnected/app-local flows.
21. If C64U is healthy, continue C64U-dependent tests, starting with S1-safe Disks baseline and then high-value Play/Disks flows.

Do not stop after any single step.

## Artifact root

Use one active artifact root:

`c64scope/artifacts/final-bugfree-<UTC>Z-pixel4-c64u-<git_sha>/`

If an existing runner forces `cta-<UTC>Z...`, use that root but include `final-bugfree` in run metadata and case names.

Required artifacts:

- `environment.json`
- `apk-identity.json`
- `installed-package-identity.json`
- `mcp-capabilities.json`
- `inventory/runtime.json`
- `inventory/reconciliation.md`
- `final-bugfree-ledger.json`
- `final-bugfree-ledger.md`
- `coverage.csv`
- `coverage.json`
- `actions.jsonl`
- `checkpoint.jsonl`
- `issue-groups.json`
- `performance.json`
- `reliability.json`
- `cleanup-state.json`
- `logs/**`
- `screenshots/**`
- `hierarchies/**`
- `diagnostics/**`
- `replays/**`

Human-facing outputs:

- `docs/testing/agentic-tests/full-cta-coverage/final-bugfree-report.md`
- `docs/testing/agentic-tests/full-cta-coverage/final-bugfree-ledger.md`
- `docs/testing/agentic-tests/full-cta-coverage/exhaustive-cta-ledger-final.md`
- `docs/testing/agentic-tests/full-cta-coverage/flow-ledger-final.md`
- `docs/testing/agentic-tests/full-cta-coverage/performance-report-final.md`
- `docs/testing/agentic-tests/full-cta-coverage/cleanup-report-final.md`
- `docs/testing/agentic-tests/full-cta-coverage/defects/*.md`

## C64U degradation handling

If the app or target shows degraded C64U state at any time:

1. Stop new C64U-mutating actions immediately.
2. Preserve current app state:
   - screenshot
   - hierarchy
   - route
   - overlay
   - active flow
   - focused CTA
3. Record exact previous 20 actions from `actions.jsonl`.
4. Capture logcat.
5. Export app diagnostics if reachable without further C64U mutation.
6. Run one direct `c64u` health probe as infrastructure evidence.
7. Record:
   - UTC
   - route
   - active CTA
   - immediate preceding action
   - previous idle duration if known
   - request in flight if visible in logs
   - whether ICMP works if tested
   - HTTP/FTP/Telnet state if tested safely
8. Classify:
   - app defect
   - target firmware defect
   - environment defect
   - inconclusive
9. If C64U is genuinely unusable:
   - stop app through DroidMind
   - do not send more C64U product traffic
   - continue all independent app-local, disconnected, docs, diagnostics, settings, keypad, negative, lifecycle, and variant tests
10. Use U64 fallback only when:
    - C64U evidence is preserved
    - the flow is not C64U-specific
    - the result is labelled `U64_FALLBACK`
    - the result is not counted as C64U pass evidence

When using U64 fallback, record:

- reason
- UTC
- C64U failure evidence path
- U64 app-visible identity
- U64 direct health evidence
- which flows are fallback-only
- which C64U results remain blocked

## Current S1 safety rule

`S1-DISKS-MOUNT-EJECT-RESETS-C64U` and `S1-C64U-FIRMWARE-TCP-WEDGE-ON-IDLE-RECONNECT` must be treated as live high-risk context.

Do not attempt Drive A mount/eject unless fresh evidence in this session proves:

1. direct `c64u` health returns expected reachable result
2. app visibly shows green `C64U`
3. app visibly identifies host/device as `c64u`
4. app visibly shows expected firmware
5. Disks page shows Drive A ON
6. Drive A shows `No disk mounted`
7. Drive B state is captured
8. screenshot and hierarchy confirm focus before every key-driven `DPAD_CENTER`
9. the test disk is test-owned
10. logcat is already running

If these preconditions are met, run exactly this regression before broader Disks testing:

- 5 complete Drive A mount/eject cycles
- known test-owned `.d64`
- readonly mode where app supports it
- screenshot and hierarchy before every mount activation
- screenshot and hierarchy after every mount result
- screenshot and hierarchy before every eject activation
- screenshot and hierarchy after every eject result
- logcat for full sequence
- direct health probe after each cycle as infrastructure evidence
- stop immediately on connection reset, degraded app state, stale optimistic UI, or failed cleanup

Expected result:

- no C64U degradation
- no connection reset
- no stuck Drive A status
- no stale mounted label
- no false “OK”
- no request storm
- Drive A ends `No disk mounted`
- app remains green `C64U`

If the test passes, update all S1/S2 defect files with fixed/retested status. If it fails, preserve evidence, fix if app-side, or classify firmware/environment with proof, then continue independent non-C64U tests.

## High-value flow matrix

### A. Playlist and playback setup

Test with fixture media staged through supported infrastructure only:

- valid `.sid`
- multi-subsong `.sid` where available
- valid `.prg`
- valid `.mod` where supported
- valid `.crt` where supported
- valid `.d64`
- unsupported extension
- zero-byte file
- long filename
- unicode filename
- duplicate filename in different folders
- deep path

Sources:

- Local
- C64U
- HVSC if present
- CommoServe if present

For each source that is present:

1. open source chooser
2. cancel source chooser
3. open source
4. browse root
5. browse folder
6. navigate back/up
7. refresh
8. filter/search if present
9. select one item
10. select many items
11. select all
12. deselect all
13. add selected
14. cancel
15. return to playlist
16. verify list rows, labels, source, duration/type where visible
17. verify no errors in app logs or console
18. verify no password leak in diagnostics/logs

If a source is not present in C64U Remote variant, mark `NOT_PRESENT_WITH_REASON` with runtime evidence and variant flag evidence.

### B. Playlist filtering

For playlists, test:

- empty filter
- exact filename
- partial filename
- case-insensitive match
- unicode text
- long text
- no-match text
- source label filter where present
- type label filter where present
- custom label/tag filter where present
- clear filter
- filter while item selected
- filter while playback active
- filter after route change
- filter after relaunch if persistence is expected

Expected:

- correct row count
- no stale selected rows
- no hidden active playback row confusion
- no duplicated rows
- no crash
- no JS errors
- no logcat errors
- keypad and touch both work where applicable

### C. Playback transport

With playlists containing at least:

- one item
- three items
- mixed program/song/disk items where supported

Test:

1. play first item
2. pause
3. resume
4. stop
5. next
6. previous
7. forward if present
8. rewind if present
9. rapid next/previous
10. rapid pause/resume
11. play another row while active
12. final item behavior
13. repeat off
14. repeat on
15. shuffle off
16. shuffle on
17. mute if present
18. volume min/max/intermediate if present
19. route change during playback
20. app background during playback
21. return from background
22. screen lock during playback
23. unlock after expected transition

Expected:

- app UI state correct
- C64 output or device state changes as expected where observable
- no duplicate transitions
- no missed transitions
- no stale timer
- no request storm
- no unhandled errors
- no degraded C64U state
- background auto-advance logs prove the background path was armed, not merely that the UI changed later

### D. Locked-screen auto-advance

This is release-critical.

Run at least:

1. 3-item playlist, repeat off, shuffle off
2. 3-item playlist, repeat on, shuffle off
3. 3-item playlist, repeat off, shuffle on
4. mixed-source playlist where safe
5. multi-subsong SID if available
6. disk-image transition where supported

For each:

1. start playback
2. verify active item
3. lock screen before auto-advance deadline
4. keep screen locked through at least one deadline
5. wake/unlock
6. verify expected item advanced
7. verify order
8. verify no missed or duplicate transition
9. verify final-item behavior
10. inspect runtime logs for `backgroundAutoSkipDue` or equivalent background scheduling proof
11. inspect logcat for errors
12. verify C64U did not degrade

Minimum passing evidence:

- screenshots before lock and after unlock
- logcat covering entire locked interval
- app runtime/background logs proving scheduled auto-advance was armed
- C64Scope or app-visible playback state evidence
- actions timeline
- performance timing

If locked-screen auto-advance fails, fix it and rerun until passing.

### E. Disks collection and swapping

With test-owned disk fixtures:

1. open Disks
2. verify Drive A and Drive B state
3. import/add disk from Local where present
4. import/add disk from C64U where present
5. cancel import
6. browse folder
7. search/filter by text
8. filter by group/label where present
9. no-match filter
10. clear filter
11. select one disk
12. select many disks
13. assign group/label where present
14. rename test-owned disk where present
15. mount to Drive A
16. verify Drive A mounted label
17. verify Home drive summary matches
18. eject/unmount
19. verify Drive A `No disk mounted`
20. mount to Drive B where safe
21. eject Drive B where safe
22. previous disk in group
23. next disk in group
24. first boundary
25. last boundary
26. single-disk group behavior
27. delete/remove cancel
28. delete/remove confirm only for test-owned items
29. device switch/open switcher while mounted, cancel only unless safe
30. route change while mounted
31. relaunch while mounted, if safe
32. cleanup eject

Expected:

- no C64U degradation
- no connection reset
- no stale status
- no false “Status OK”
- no duplicate imports
- no lost groups/labels
- filter results correct
- mount/eject state consistent across Disks and Home
- cleanup leaves no disk mounted

### F. Disk filtering by text and labels/groups

Test:

- empty collection
- populated collection
- exact disk filename
- partial disk filename
- case-insensitive text
- unicode text
- duplicate names
- long names
- no-match
- group/label filter
- multiple labels where present
- clear filter
- filter while mounted
- filter after eject
- filter after route change
- filter after relaunch if persistence expected

Expected:

- mounted item remains identifiable even when filtered out, or the UI clearly explains state
- no stale selection
- no accidental deletion
- no duplicate rows
- keypad and touch work where applicable

### G. Config spot checks

Do not leave Config untested.

1. load Config from connected state
2. load Config from disconnected state if safe
3. enumerate categories
4. open at least:
   - Video
   - Audio
   - Drives
   - Network read-only rows
   - C64U category
5. test search/filter if present
6. expand/collapse categories
7. read-only rows do not mutate
8. one safe known-item mutation with restore if connection healthy and safety policy allows
9. save/revert dirty state
10. route away/back
11. relaunch readback

Expected:

- no circuit-breaker false block
- no stale values
- no optimistic save without device effect
- no C64U degradation
- no errors in logs

### H. Settings, Diagnostics, Device Switcher spot and deep checks

Settings:

- theme Auto/Light/Dark restore Auto
- display profile Auto/Small/Standard/Large restore Auto
- orientation Auto/Portrait restore Auto
- fullscreen options restore original
- Save-and-Connect valid path
- invalid host then restore
- wrong password then restore
- invalid HTTP port then restore
- password masking
- password redaction

Diagnostics:

- open from Star on every main route
- open from Settings if present
- export/share current tab
- cancel share
- inspect diagnostics for password leakage
- inspect diagnostics after a failed operation
- clear cancel
- clear confirm only after export if safe

Device Switcher:

- open from Pound on every main route
- current device indication
- cancel/back
- no accidental switch
- if switching to U64 is needed, label fallback and restore to C64U

### I. Simple spot checks

Perform fast spot checks across lower-risk surfaces:

- Docs accordions expand/collapse
- Licenses open/scroll/close
- About/version text
- external links open/cancel/return where safe
- bottom tabs by touch
- bottom tabs by digits
- Back behavior from every main route
- orientation and display profile layout
- no text clipped behind footer
- no unreachable focused control
- no icon-only unlabeled critical CTA

## Runtime inventory and CTA accounting

Run runtime discovery before execution and after significant state changes.

Every discovered CTA must receive a final status:

- `PASS_NO_BUG_FOUND`
- `BUG_FOUND_FIXED_AND_VERIFIED`
- `BUG_FOUND_OPEN`
- `BLOCKED_WITH_EVIDENCE`
- `SAFETY_BLOCKED_NOT_EXECUTED`
- `INCONCLUSIVE_REPLAY_REQUIRED`
- `NOT_PRESENT_WITH_REASON`
- `SPEC_GAP_WITH_EVIDENCE`

`exhaustive-cta-ledger-final.md` must include one row per CTA:

- CTA ID
- fingerprint
- route
- overlay
- parent container
- label
- resource id
- test id
- role/control type
- bounds
- risk class
- safety class
- feature ID
- state precondition
- touch reachable
- touch activatable
- keypad reachable
- keypad activatable
- expected result
- actual result
- timing
- status
- evidence path
- replay path
- defect ID
- cleanup status

Final unaccounted CTA count must be zero.

## Error and log monitoring

During every major flow:

1. collect logcat
2. collect app runtime logs where available
3. collect JS console and unhandled rejection logs if supported by the harness
4. collect DroidMind action logs
5. capture screenshots and hierarchies before and after significant actions

Open or update defects for:

- `console.error`
- unhandled promise rejection
- Android exception
- Capacitor plugin error not surfaced correctly to user
- request storm
- repeated retry without backoff
- silent failure
- false success
- stale optimistic UI
- C64U degraded badge
- C64U device wedge
- password leakage
- crash
- ANR
- lost input
- inaccessible focused CTA

A run cannot be `BUGFREE-PROVEN` while any new relevant error remains unexplained and fixed or externally classified.

## Defect files

Create or update one Markdown file per defect under:

`docs/testing/agentic-tests/full-cta-coverage/defects/`

Each defect must include:

- ID
- title
- severity
- priority
- product area
- route
- overlay/dialog/sheet
- CTA fingerprint
- control label
- input method
- build identity
- Git SHA
- Pixel 4 identity
- target identity
- first reproduced UTC
- last reproduced UTC
- reproduction count
- reproduction rate
- preconditions
- exact DroidMind semantic actions
- exact Android key events where used
- exact command that generated artifact
- expected result
- actual result
- user impact
- state before
- state after
- recovery performed
- cleanup status
- suspected component
- evidence supporting suspected component
- remaining uncertainty
- fix summary if fixed
- fixed build identity if fixed
- retest evidence
- replay command
- linked screenshots
- linked UI hierarchies
- linked action logs
- linked checkpoint logs
- linked coverage row
- linked logcat
- linked DroidMind logs
- linked diagnostics export if available
- full stdout/stderr command log paths
- relevant log excerpts

If a bug is fixed, preserve the original failing evidence and add a `Fix verification` section.

## Performance and reliability requirements

Measure and record:

- cold launch
- warm launch
- route navigation
- source chooser open
- local source browse
- C64U source browse
- add selected to playlist
- playback start
- pause/resume latency
- next/previous latency
- auto-advance timing
- locked-screen auto-advance timing
- disk mount
- disk eject
- disk next/previous
- disk filter
- playlist filter
- Config load
- Diagnostics open/export
- Save-and-Connect

Reliability repetitions:

- tab navigation: 20 cycles by touch, 20 cycles by key events
- Diagnostics open/close: 10 cycles
- Device Switcher open/cancel: 10 cycles
- Save-and-Connect valid path: 3 cycles
- invalid host/password/port: 2 cycles each with restoration
- Play add/play/pause/resume/next/stop/remove: 5 cycles
- locked-screen auto-advance: at least 3 transitions
- Drive A mount/eject: 5 cycles only under S1 safety preconditions
- disk swap previous/next: 5 cycles where safe
- Config load/refresh: 5 cycles or a precise blocker
- filter operations: 5 representative cycles for playlist and disk filters

Open defects for:

- route navigation > 1500 ms without progress
- local UI action > 1000 ms without feedback
- network/device action > 10000 ms without progress or timeout explanation
- increasing latency over repetitions
- lost input
- request storm
- persistent spinner
- failure to recover
- app log errors

## Cleanup requirements

Before final report:

1. stop playback
2. clear test playlist entries
3. remove test songs/programs where app-created
4. eject test disks
5. remove test disk collection entries where app-created
6. restore disk groups/labels changed by test
7. restore Drive A to `No disk mounted`
8. restore Drive B to baseline
9. restore saved device to `c64u`
10. restore host `c64u`
11. restore password `pwd`
12. restore HTTP `80`
13. restore FTP `21`
14. restore Telnet `23`
15. restore theme `Auto`
16. restore display profile `Auto`
17. restore orientation `Auto`
18. restore fullscreen settings to baseline
19. restore every app-local setting changed
20. restore every C64 config value changed
21. export final diagnostics where possible
22. capture final screenshot and hierarchy
23. confirm app-visible C64U health if target available
24. run one direct C64U health probe as infrastructure evidence
25. diff final state against baseline
26. list residual differences

Write:

`docs/testing/agentic-tests/full-cta-coverage/cleanup-report-final.md`

The run is incomplete until cleanup is proven or residual differences are fully explained.

## Final report

Write:

`docs/testing/agentic-tests/full-cta-coverage/final-bugfree-report.md`

Only write it after all completion gates pass.

The report must include:

1. Final status: `BUGFREE-PROVEN`
2. Scope: Pixel 4 with touch and injected Android key events
3. C64 Commander and C64U Remote variant identity
4. Build identity
5. Installed APK identity
6. Git state
7. Pixel 4 identity
8. C64U health timeline
9. U64 fallback timeline if used
10. Commands run
11. Artifact root
12. Tooling and control-path compliance
13. All-route inventory summary
14. Exhaustive CTA ledger summary
15. Flow ledger summary
16. Playlist add/play/filter results
17. Playback transport results
18. Locked-screen auto-advance results
19. Disk collection/import/filter results
20. Disk mount/eject/swap results
21. Config results
22. Settings results
23. Diagnostics results
24. Device Switcher results
25. Docs/Licenses spot checks
26. Simple spot checks
27. Touch parity results
28. Keypad-first results
29. Negative-path results
30. Performance results
31. Reliability results
32. Error/log review results
33. Defects found and fixed
34. External firmware/environment issues
35. Cleanup status
36. Residual differences
37. Exact uncommitted working-tree status
38. Statement that final unaccounted CTA count is zero
39. Statement that final untested high-value flow count is zero
40. Statement that final open S0/S1/S2 app-defect count is zero

If any report item cannot be truthfully completed, do not write a `BUGFREE-PROVEN` report. Continue testing, fix, or document blocker evidence and complete remaining independent work.

## Continuous execution loop

Repeat until `BUGFREE-PROVEN` is valid:

1. Read `PLANS.md`.
2. Select the highest-priority untested or unverified item:
   - C64U connection health and degradation handling
   - open S1/S2 defects
   - playlist add/play/filter
   - locked-screen auto-advance
   - disk mount/eject/swap/filter
   - playback transport
   - Config
   - Settings
   - Diagnostics
   - Device Switcher
   - Docs/Licenses
   - keypad-first
   - touch parity
   - negative paths
   - lifecycle
   - performance
   - reliability
   - cleanup
3. Execute it through DroidMind on Pixel 4.
4. Capture evidence.
5. Inspect logs.
6. If a bug appears, preserve failing state.
7. Write or update defect.
8. Fix app-side defects.
9. Run unit tests and `npm run scope:check`.
10. Build and install fixed APK.
11. Rerun HIL reproduction.
12. Rerun neighboring regressions.
13. Restore mutated state.
14. Update ledgers.
15. Update `PLANS.md`.
16. Continue immediately.

## Handover limitation

A handover is allowed only if:

1. tool/context limits are imminent
2. Pixel 4 cannot be controlled after 3 recovery attempts
3. C64U requires human intervention and all independent testing has been completed or queued with exact reasons
4. destructive action needs human approval and all safe independent work is complete
5. user explicitly asks for handover

If a handover is unavoidable, write exactly one execution-focused handover with:

- current branch
- Git SHA
- installed APK identity
- artifact root
- completed CTA count
- remaining CTA count
- completed flow count
- remaining flow count
- open defects
- cleanup status
- exact next command
- exact next DroidMind action

Do not write a handover merely because a bug was found, because C64U degraded, or because a page is blocked. Continue independent testing.

## Final chat response

When and only when the run is complete, respond with only:

- Final status: `BUGFREE-PROVEN`
- Final bug-free report path
- Cleanup report path
- Artifact root
- CTA ledger path
- Flow ledger path
- Defect directory path
- Highest-risk external or residual items
- Exact working-tree status
