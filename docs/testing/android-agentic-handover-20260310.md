# Android Agentic Handover Prompt (2026-03-10)

## Role

You are a staff-level Android HIL test executor operating inside the C64 Commander repository.

Use:

- `droidmind` as the primary app driver
- `c64scope` for session management, evidence correlation, and A/V assertions when needed
- `c64bridge` only for read-only corroboration or emergency recovery

Execute. Do not advise. Do not broaden scope.

## Read First

Read these files before taking any action:

1. `doc/testing/agentic-tests/agentic-test-architecture.md`
2. `doc/testing/agentic-tests/agentic-action-model.md`
3. `doc/testing/agentic-tests/agentic-oracle-catalog.md`
4. `doc/testing/agentic-tests/agentic-safety-policy.md`
5. `doc/testing/agentic-tests/agentic-android-runtime-contract.md`
6. `doc/testing/agentic-tests/agentic-observability-model.md`
7. `doc/testing/agentic-tests/agentic-infrastructure-reuse.md`
8. `doc/testing/agentic-tests/full-app-coverage/prompts/F005-home-ram-workflows.md`
9. `doc/testing/agentic-tests/full-app-coverage/prompts/F013-playback-queue-and-volume.md`
10. `doc/testing/agentic-tests/full-app-coverage/prompts/F014-songlength-duration-subsong.md`
11. `doc/testing/agentic-tests/full-app-coverage/prompts/F015-hvsc-download-ingest.md`
12. `doc/testing/agentic-tests/full-app-coverage/prompts/F016-hvsc-cache-reuse.md`
13. `doc/testing/agentic-tests/full-app-coverage/prompts/F017-lock-screen-autoadvance.md`
14. `doc/testing/agentic-tests/full-app-coverage/prompts/F023-persistence-and-recovery.md`
15. `doc/developer.md`:
    - `HVSC ingestion completeness contract`
    - `Playback auto-advance under lock/background`
16. `doc/internals/duration-propagation.md`

Important context:

- The full-app coverage run on March 8, 2026 closed route and surface reachability.
- It did not close the deep behavior missions below.
- Do not spend time re-proving route markers except as prerequisites.

## Scope

Drive only these six missions:

1. playback auto-advance continuity across in-app navigation, Home/background, app switching, and lock/unlock
2. HVSC download, install, and ingest through the built-in app workflow
3. full mirrored-HVSC root import from Local or C64U without long stalls
4. volume and mute correctness during and after navigation or transport changes
5. Songlengths.md5 duration adherence across prolonged interaction
6. Home-page RAM save and restore

Do not do a generic app tour. Do not reopen already-closed shallow coverage as the main activity.

## Hard Rules

- Android physical execution only.
- Three MCP servers only: `droidmind`, `c64scope`, `c64bridge`.
- App-first always. `c64bridge` is forbidden for primary playback, queue construction, HVSC actions, volume changes, or RAM save/restore.
- No code changes. No repo edits except run artifacts and one concise run summary.
- Do not create `PLANS.md`.
- Each mission ends `PASS`, `FAIL`, `BLOCKED`, or `INCONCLUSIVE`.
- One bounded retry max per mission, and only for a clear infrastructure or determinism fault.
- Never pass on a toast, one screenshot, or absence of a crash.
- Capture a baseline before every destructive step.
- If demo mode appears, recover to real-device mode before continuing.
- Do not mutate Device Safety settings.

## Lab Precheck

1. Select exactly one Android device and one C64U host. If selection is ambiguous, stop.
2. Verify:
   - package `uk.gleissner.c64commander` is installed
   - the app launches into a real-device session, not demo mode
   - `droidmind`, `c64scope`, and `c64bridge` all respond
3. Verify staged local media on Android:
   - expected Android-visible root: `/sdcard/Download/c64commander-assets`
   - expected staged formats: `.sid`, `.mod`, `.crt`, `.prg`, `.d64`, `.d71`, `.d81`, and `Songlengths.md5`
4. Verify the C64U mirror:
   - root: `/USB2/test-data`
   - SID root: `/USB2/test-data/SID`
5. Discover both corpora before any playback:
   - top-level entries
   - counts by format
   - approximate SID count
   - multi-disk directories
   - whether `test-data/sid/hvsc` resolves through a symlink
   - whether symlink loops are handled safely
6. Write `corpus-manifest.json` and use it to pick fixtures. Never hard-code paths discovered later by trial and error.

## Fixture Selection

Build a deterministic candidate set before the six missions:

- 3 short SIDs with known durations, preferably under 90 seconds
- 1 multi-subsong SID
- 1 additional SID with a visibly different screen or audio signature
- 1 runnable artifact that creates a distinctive machine state for RAM save
- 1 second runnable artifact, or a reset path, that visibly changes machine state after the RAM save
- 1 HVSC browse target near the root for post-ingest smoke browsing

Prefer fixture names that are easy to recognize in screenshots and logs. Record the chosen paths once and reuse them.

## Oracle Policy

Use at least two independent oracles for every mutating mission.

Primary oracles by mission:

- M1 auto-advance: Play UI state + Android background logs or events (`dueAtMs`, background execution armed, `backgroundAutoSkipDue`) + current-item progression; add `c64scope` A/V when practical
- M2 HVSC ingest: HVSC status UI + monotonic progress or counters + diagnostics or log evidence
- M3 full HVSC root import: add-items overlay count or progress + logs + final playlist count
- M4 volume and mute: UI control state + read-back mixer or config state
- M5 songlength endurance: scheduled duration evidence from song metadata + observed per-track timing + logs or timeline
- M6 RAM save and restore: snapshot file artifact + machine-visible screen or state signature restored after deliberate mutation

Weak or forbidden oracles:

- toast alone
- one screenshot alone
- `c64bridge` direct control as proof that the app succeeded
- A/V alone for non-playback missions

## Stall And Retry Policy

- If a long-running step shows no progress signal for 60 seconds, treat it as a stall.
- Progress signal means one of: UI counter changes, phase or status text changes, playlist count changes, log lines advance, or the `c64scope` timeline moves.
- On first stall:
  - capture screenshot, UI hierarchy or XML if available, log slice, and current step ID
  - perform one bounded recovery only if the action has an explicit retry path
- If the same step stalls again, stop that mission and classify it `FAIL` or `INCONCLUSIVE`. Do not loop.

## Mission Order

### M0 Baseline

- Start one `c64scope` session for the run.
- Record device ID, C64U host, app version, connection state, and corpus manifest.
- Capture one Home screenshot and one Play screenshot before mutations.

### M1 Playback Auto-Advance Continuity

Goal: prove exact single-step auto-advance survives page changes, app changes, and lock/background.

Steps:

1. Build a 3-track playlist from short known-duration SIDs.
2. Start playback and prove playback is active.
3. Prove Android background execution is armed before leaving the page. If the app cannot prove this, do not continue.
4. Run four subcases, one at a time, resetting to a known track before each:
   - switch to another tab inside C64 Commander
   - press Home and background the app
   - switch to a second Android app
   - lock the device, wait past due time, unlock
5. After each subcase, verify the playlist advanced exactly one item and did not double-skip.
6. Record whether advancement happened on time, late-but-reconciled on foreground return, or not at all.

Pass:

- every subcase advances exactly one track
- no double-advance
- background path was visibly armed in logs or events before leaving foreground

Fail:

- no advance, double advance, pause or stop, or missing background-armed evidence

### M2 HVSC Download / Install / Ingest

Goal: prove the built-in HVSC lifecycle, not just the presence of the HVSC card.

Steps:

1. Capture initial HVSC status and cache state.
2. Run one full app-driven lifecycle:
   - download
   - install or extract
   - ingest or index
   - browse after ready
   - play one ingested item
3. Capture phase changes and final ingestion counters. Use `HvscStatus.ingestionSummary`-style data if surfaced in UI or logs:
   - `totalSongs`
   - `ingestedSongs`
   - `failedSongs`
   - `songlengthSyntaxErrors`
4. Exercise cancel or reset only if cleanup is deterministic. Otherwise prioritize full completion.

Pass:

- phases are monotonic and coherent
- final state is ready and browseable
- post-ingest browse works through the app path
- one ingested item plays successfully

Fail:

- non-monotonic phase changes
- terminal error
- ready state without browse or play viability
- counter mismatch or obvious partial ingest

### M3 Full Mirrored-HVSC Root Import Stress

Goal: exercise full-tree add-items import from the mirrored corpus and detect long stalls or pathological slowness.

Important:

- This is not M2. Use the mirrored file trees, not the built-in HVSC downloader.
- Use exactly one lane for the full-root attempt:
  - Local Android mirror if SAF access is healthy
  - otherwise C64U `/USB2/test-data/SID`

Steps:

1. Ramp import pressure instead of jumping straight to the full root:
   - small subtree
   - medium subtree
   - large subtree
   - full SID root
2. Use recurse-folder import through the app UI.
3. At every stage record:
   - start time
   - first visible progress time
   - count after 15 seconds
   - count after 30 seconds
   - count after 60 seconds
   - final count or stall point
4. For the full-root attempt, continue only while progress remains monotonic.

Pass:

- the full-root import completes
- UI remains attributable
- final playlist count is plausibly aligned with discovered SID totals
- no flat stall longer than 60 seconds

Fail:

- reproducible stall
- selection loss
- crash
- unbounded slowdown with flat progress

Inconclusive:

- full-root progress remains monotonic but does not complete within a 25-minute full-root budget

### M4 Volume And Mute

Goal: prove volume and mute are real state changes, not only UI toggles.

Steps:

1. During active playback, set a non-default volume.
2. Mute, wait briefly, then unmute.
3. Navigate away and back.
4. Pause or resume once, or advance once.
5. Read back the mixer or config state through an allowed secondary oracle.

Pass:

- slider state, mute state, and read-back state agree
- unmute restores the intended non-default level
- state survives navigation and one transport transition

Fail:

- slider state drifts
- mute or unmute restores the wrong effective level
- app UI and read-back diverge

### M5 Songlength Endurance

Goal: catch the known long-run duration drift bug.

Steps:

1. Use a playlist whose per-track durations come from Songlengths or HVSC metadata, not manual guesswork.
2. Total planned run time must be at least 6 minutes.
3. During the run, intentionally inject interruptions:
   - route change inside the app
   - background or Home
   - second app switch
   - lock and unlock
4. For every track record:
   - expected duration
   - observed track start
   - observed track advance
   - delta from expected timing
5. Track whether `dueAtMs`-style scheduling evidence was refreshed after interruptions if logs expose it.

Pass:

- every track advances exactly once
- observed duration stays within:
  - 5 seconds of expected timing for uninterrupted foreground transitions
  - 10 seconds of expected timing when the boundary occurs while backgrounded or locked
- cumulative drift across the full run stays under 10 seconds

Fail:

- any track ignores known songlength metadata
- drift accumulates after interruptions
- a resumed track shortens, lengthens, or repeats unexpectedly

### M6 Home RAM Save / Restore

Goal: prove actual state restoration, not only file creation.

Steps:

1. Drive the machine into a visually distinctive state A using an app-driven runnable artifact.
2. Save RAM from Home into a test-owned folder.
3. Mutate the machine into a clearly different state B.
4. Restore the saved RAM snapshot from Home.
5. Verify:
   - snapshot artifact exists in the chosen folder
   - machine state returns from B to A by screen signature or equivalent read-only state ref

Pass:

- snapshot file exists
- restored state matches the pre-save signature well enough to attribute success

Fail:

- save or restore errors
- file exists but restored state does not return to A

Blocked:

- the app can create a file but live hardware restoration cannot be proved with the available oracles

## Cleanup

- stop playback
- stop any reserved C64 streams
- close dialogs
- return the app to a known connected foreground state
- isolate or remove only test-owned RAM dump artifacts
- record whether cleanup fully succeeded

## Deliverables

Create one run folder under `doc/testing/agentic-tests/runs/<utc-run-id>-deep-edge/` containing:

- `corpus-manifest.json`
- `mission-results.json`
- `steps.json`
- `evidence-map.json`
- `runtime-logcat.txt` or equivalent log slices
- `summary.md`

`summary.md` must contain, for each mission:

- classification: `PASS`, `FAIL`, `BLOCKED`, or `INCONCLUSIVE`
- exact failing or blocked step
- primary and secondary oracles used
- whether `c64bridge` was used at all, and why
- smallest next remediation

Begin with the lab precheck and corpus manifest. Do not start M1 until real-device mode, corpus discovery, and staged-asset verification are complete.
