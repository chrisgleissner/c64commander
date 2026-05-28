ROLE

You are an expert senior production engineer working on C64 Commander, a React +
Vite + Capacitor application that controls C64 Ultimate and Ultimate 64 devices
over REST, FTP, and Telnet.

This is an IMPLEMENTATION task for
`docs/research/stabilization/prod-hardening-5/prompt.md`. It is a surgical
hardening pass after prod-hardening-4. The goal is to close four evidence-backed
gaps without re-architecting any subsystem and without regressing the guarantees
captured by prod-hardening-1 through prod-hardening-4.

Classify this task as CODE_CHANGE with required deterministic regression tests,
lint, build, coverage, and Android/device validation evidence (per repository
policy, hardware validation may be recorded as a concrete blocker if the target is
unreachable).

Read these first, in this order:

1. `.github/copilot-instructions.md`
2. `CLAUDE.md` (project block; user-private block is loaded automatically).
3. `docs/research/stabilization/prod-hardening-5/research.md` (the evidence behind
   every task below).
4. `docs/research/stabilization/prod-hardening-5/issue-ledger.md`
5. `docs/research/stabilization/prod-hardening-5/feature-audit.md`
6. `docs/research/stabilization/prod-hardening-5/test-matrix.md`
7. `docs/research/stabilization/prod-hardening-4/prompt.md` and `results.md`
   (the verified-stable contract you must not regress).
8. `docs/architecture.md` and `docs/features-by-page.md`
9. `docs/c64/c64u-openapi.yaml` and `docs/c64/c64u-telnet.yaml` only as needed.
10. `docs/testing/maestro.md` only if you touch Maestro flows (not expected here).
11. Current code and tests in the repository.

Immediately create:

- `docs/research/stabilization/prod-hardening-5/PLANS.md` (the authoritative
  execution plan; keep it current).
- `docs/research/stabilization/prod-hardening-5/WORKLOG.md` (what you inspected,
  what changed, exact command results, hardware evidence, blockers).

These two files already exist from the analysis pass. Append to them rather than
overwriting; preserve the analysis-pass content as historical record. Then begin
implementation immediately and continue autonomously until all termination
criteria are satisfied. Do not stop after analysis. Do not merely update a plan.

CONTEXT — WHAT THIS PASS IS ABOUT

The static and dynamic evidence captured in `research.md` shows the app is in
strong shape after PH4: all four approved gateways are in place, background health
is selected-device-only with full guard chain, FTP retry/timeouts landed, rapid
Next/Previous coalesces, the background auto-skip listener is registered once with
stable refs, snapshot keys cover all persisted fields, and exception discipline is
intact.

Four remaining items merit a surgical hardening pass:

1. PH5-04 — Late native FTP/SAF results delivered after a saved-device switch can
   still mutate the active playlist/disk library. The existing
   `addItemsAbortControllerRef` is only aborted on user Cancel, and no generation
   guard exists on the playlist/disk-library setters.
2. PH5-05 — The PH4-F3 fix (background auto-skip listener registered once via
   stable refs) is correct but lacks a deterministic add/remove counter test at
   the PlayFilesPage layer. Pin the contract so a future regression fails fast.
3. PH5-06 — `src/lib/playlistRepository/indexedDbRepository.ts` still emits five
   raw `console.warn(...)` calls on IndexedDB load failures. Route them through
   `addLog("warn", ...)` to keep the WebView console quiet while preserving
   structured diagnostics.
4. PH5-01 — The current worktree has in-flight concurrent edits to
   `src/lib/deviceInteraction/deviceInteractionManager.ts`,
   `src/pages/playFiles/hooks/usePlaybackController.ts`, and
   `tests/unit/playFiles/usePlaybackController.concurrency.test.tsx`. They must be
   coordinated with PH5 rather than ignored.

NON-NEGOTIABLE CONSTRAINTS

1. Preserve the approved device-call gateways (REST `withRestInteraction`, FTP
   `withFtpInteraction`, Telnet `withTelnetInteraction`, config writes
   `scheduleConfigWrite`). Do not add a new transport path and do not bypass
   queues, cooldowns, the circuit breaker, or `scheduleConfigWrite`.
2. Preserve the `switchDeviceDialog` 10 second full saved-device health cycle
   exactly. Do not change its cadence, fan-out, or CONFIG pulse.
3. Do not chase Ultimate firmware lock-up or FTP root cause. Harden the app
   against transient stalls and stale results, not the device.
4. Do not weaken tests, loosen assertions, remove guards, skip coverage, or hide
   failures.
5. Do not refactor unrelated files. Keep visible UX changes minimal and only
   where needed to make state truthful, recoverable, or testable.
6. Preserve every verified-stable behavior listed in
   `research.md` §7 "Explicit non-regression guarantees".
7. Do not claim hardware validation unless the exact target was reached and
   recorded.
8. Preserve source-specific contracts. The Play page UI must remain source-agnostic.
9. Use GNU/Linux line endings.

EXECUTION MODEL

Use an iterative convergence loop. At the start of each loop:

1. Update PLANS.md with the current phase, tasks, and acceptance criteria.
2. Select the next task in the deterministic priority order below.
3. Inspect current code and tests before editing.
4. Make the smallest coherent change.
5. Add deterministic regression tests that fail before the fix and pass after it.
6. Run the narrowest relevant test command.
7. Update WORKLOG.md with evidence.
8. Continue until termination criteria are met.

DETERMINISTIC PRIORITY ORDER

1. PH5-01 first — confirm whether the in-flight worktree edits are intended; land
   or revert them as a stand-alone decision before adding new code, so PH5 starts
   from a known baseline.
2. PH5-04 — Generation guard on import flows (stale-result isolation).
3. PH5-05 — PH4-F3 listener-once deterministic regression.
4. PH5-06 — IDB console-warn routing through `addLog`.

TASK 1 (LOW, PROCESS) — PH5-01-CONCURRENT-WORKTREE-LANDING

Inspect `git status --short` and `git diff` for the three worktree-modified files:

- `src/lib/deviceInteraction/deviceInteractionManager.ts` (removes an unused
  `ftpCooldownUntil` map; FTP cooldown is now `ftpConnectCooldownUntil` + pacing).
- `src/pages/playFiles/hooks/usePlaybackController.ts` (adds an unmount cleanup
  for `pendingUserSkipRef`).
- `tests/unit/playFiles/usePlaybackController.concurrency.test.tsx` (adds 88
  lines of new test cases).

Required behavior:

1. Run `npm run test -- tests/unit/playFiles/usePlaybackController.concurrency.test.tsx
   tests/unit/lib/deviceInteraction/deviceInteractionManager.test.ts
   tests/unit/lib/ftp/ftpClient.test.ts` and verify green. The unmount cleanup and
   the unused-map removal must not break any FTP or playback test.
2. If green, leave the edits in place — they become part of the PH5 commit
   boundary. Record the decision in WORKLOG.md.
3. If a test fails, investigate the root cause. If the failure is caused by the
   concurrent edit, revert that specific edit and note the reason in WORKLOG.md.
   Do not revert if the failure is unrelated — fix the unrelated cause first.
4. Do not duplicate functionality (e.g., do not re-add the cleanup elsewhere if
   the concurrent edit already added it).

TASK 2 (MEDIUM) — PH5-04-IMPORT-CANCEL-GENERATION

Problem: A recursive Play import or Disk import in progress, started against
saved device `u64`, can have late native FTP/SAF results delivered after the user
switches to `c64u` because `addItemsAbortControllerRef` is only aborted on user
Cancel. The gateway-level `resetInteractionState("saved-device-switch")` cancels
queued REST/FTP/Telnet work, but native callbacks already in flight or already
returned at the JS layer can still trigger `appendPlayableFile` /
`useDiskLibrary.addDisks` and append ghost items bound to the previous device.

Required behavior:

1. Make import cancellation switch-aware. Pick the narrowest viable approach:
   - Option A: Subscribe the active import's `AbortController` to a
     saved-device-switch event published by `useSavedDeviceSwitching`. Existing
     work uses `SAVED_DEVICE_SWITCH_METRICS_EVENT` or similar.
   - Option B: Add a generation token (e.g., the saved-device id at import start)
     and refuse to mutate playlist/disk-library state when the active selected
     device id has changed.
   - Either option is acceptable. Pick the one that adds the smallest surface
     area and is easiest to test deterministically.
2. Treat the resulting cancellation as a clean cancellation: emit the existing
   "Add cancelled" diagnostic, do not produce an unclassified error log, and do
   not surface a duplicate error toast.
3. Preserve every existing import feature: source navigation, SAF/local file
   handles, HVSC ingest, songlengths discovery, AbortSignal threading, progress
   reporting.
4. Preserve the existing user-Cancel behavior independently.

Tests (deterministic, no real hardware required):

- `tests/unit/playFiles/addFileSelections.deviceSwitch.test.ts` —
  recursive import in progress; fire the saved-device switch trigger; verify zero
  post-switch `appendPlayableFile` calls; verify one classified cancellation log;
  verify any items committed before the switch remain.
- Same file: user Cancel still works independently and does not double-fire.
- `tests/unit/hooks/useDiskLibrary.deviceSwitch.test.ts` — same pattern for the
  Disks import path.
- `tests/unit/hooks/useSavedDeviceSwitching.cancelsImport.test.tsx` — confirm
  the switch hook either subscribes to import abort or publishes a switch event,
  asserted via spies.

Do not introduce real-time sleeps; use `vi.useFakeTimers()` and the existing
mocking patterns.

TASK 3 (LOW) — PH5-05-NATIVE-LISTENER-ONCE-PROOF

Problem: PH4-F3 made `backgroundAutoSkipDue` listener registration stable via
refs (`PlayFilesPage.tsx:1149-1218`). The contract is correct on live hardware but
is not pinned by a deterministic unit test at the page layer. A future refactor
reintroducing volatile dependencies could regress silently until the next
hardware probe.

Required behavior:

1. Add a focused unit test (suggested path
   `tests/unit/pages/playFiles/PlayFilesPage.backgroundAutoSkipListener.test.tsx`)
   that:
   - Mounts the Play Files page with a stub `BackgroundExecution.addListener` /
     `removeListener` and a stub `onBackgroundAutoSkipDue`.
   - Drives `isPlaying`/`isPaused`/`currentIndex` transitions to exercise the
     refs read inside the listener.
   - Asserts `addListener` called exactly once and `removeListener` only on
     unmount.
2. Add a second case in the same file that simulates a `backgroundAutoSkipDue`
   event and verifies exactly-once auto-advance via the refs.
3. Do not change `PlayFilesPage.tsx` — this task is test-uplift only.

TASK 4 (LOW) — PH5-06-IDB-CONSOLE-WARN-ROUTING

Problem: `src/lib/playlistRepository/indexedDbRepository.ts` lines 173, 265, 275,
287, and 298 emit raw `console.warn(...)` for IndexedDB open/load/schema-mismatch
failures. The diagnostics console bridge forwards them, but the raw console
emission still contributes to WebView console noise on Android.

Required behavior:

1. Replace each raw `console.warn(...)` call with `addLog("warn", ...)`
   (`import { addLog } from "@/lib/logging";`). Preserve the message text and the
   details payload.
2. Confirm no other module relies on `console.warn` from this file (search the
   codebase if uncertain).
3. Do not change persistence behavior; only change the log channel.

Tests:

- `tests/unit/lib/playlistRepository/indexedDbRepository.consoleQuiet.test.ts` (or
  extend an existing test file in the same directory) — trigger each failure path
  with a stub; spy on `console.warn` and on `addLog`; assert zero
  `console.warn` calls and exactly one `addLog("warn", ...)` per failure with the
  expected message and details.

VALIDATION

Run the smallest honest set after each task, then the full suite:

1. `npm run test`
2. `npm run lint`
3. `npm run build`
4. `npm run test:coverage` — global branch coverage must stay >= 91 percent and
   patch (changed-line) coverage must stay >= 91 percent for executable TS/TSX
   changes. Use the local changed-line check approach from PH4 if no repository
   patch-coverage script exists.

No golden trace regeneration is expected because no REST/FTP routing or trace
semantics change. If you discover an unexpected trace change, regenerate the
goldens under `playwright/fixtures/traces/golden` rather than weakening assertions.

HARDWARE / MOBILE VALIDATION

1. Probe `http://u64/v1/info` first, then `http://c64u/v1/info`; record exact
   outcomes in WORKLOG.md and results.md.
2. Build the debug APK and deploy to the Pixel 4 (`9B0` serial prefix preferred).
   If install is blocked by a downgrade, uninstall `uk.gleissner.c64commander` and
   reinstall per repo policy.
3. On device, validate:
   - Settings open, saved-device switch with picker open. The picker still updates
     on the 10 second full cycle and idle background remains quiet.
   - Play imports a small folder of files, then trigger a saved-device switch
     mid-import (use a slow source so the import is still running). Expect zero
     ghost items appended after the switch and one clean "Add cancelled"
     diagnostic.
   - Volume slider, Config slider, and Home lighting slider responsiveness
     remains bounded and ordered.
   - Auto-advance still fires exactly once per due item.
   - Cross-device disk-origin playback proof if `c64u` is reachable.
4. Hardware validation for PH5-04 is desirable but not strictly required —
   deterministic JS-level tests cover the contract. Record blockers explicitly.
5. PH5-05 and PH5-06 are deterministic-only; hardware is not required.

DOCUMENTATION DELIVERABLES

1. Keep `PLANS.md` and `WORKLOG.md` current throughout.
2. Create `results.md` summarising findings, changes, tests, hardware validation,
   and remaining risks.
3. Create `pr-desc.md` with a concise PR-ready summary.
4. No screenshot regeneration is needed because no documented visible UI surface
   changes.

NON-REGRESSION GUARANTEES (must hold)

- All approved device-call gateways unchanged.
- `switchDeviceDialog` 10 s full cycle unchanged.
- Background maintenance selected-device-only with hidden/suppression/polling
  pause/foreground-switch guards.
- Circuit breaker respect on routine probes; no `__c64uBypassCircuit` re-introduced.
- `readmem`/`writemem` cooldown spacing; correct `__c64uIntent` tagging.
- Slider latest-intent coalescing on all device-bound sliders.
- Background auto-skip listener registered exactly once with stable refs.
- FTP transient retry, lowered connect timeout, per-host connect pacing intact.
- Rapid user Next/Previous coalescing to one net target; auto-advance non-coalesced.
- Device-bound disk origin playback after device switch.
- Playlist repository snapshot key derived from full serialized payload.
- Exception discipline (no new bare swallow).
- Production startup quiet (no Google Fonts on native; no test-only smoke probe in
  production).
- Saved-device switch cancels scheduler queues and TanStack queries.

TERMINATION CRITERIA

Stop only when all of the following are satisfied or a concrete blocker is
recorded:

1. `PLANS.md` and `WORKLOG.md` are current; `results.md` and `pr-desc.md` exist.
2. PH5-01: the worktree edits are either landed (test-green) with explicit
   acknowledgement in WORKLOG.md, or reverted with a documented reason.
3. PH5-04: import flows refuse to mutate playlist/disk-library state after a
   saved-device switch; deterministic tests prove zero post-switch mutations and
   one clean cancellation diagnostic; user-Cancel continues to work.
4. PH5-05: a deterministic unit test pins the once-only `backgroundAutoSkipDue`
   listener contract and the exactly-once auto-advance event handling via refs.
5. PH5-06: the five `console.warn(...)` calls in
   `src/lib/playlistRepository/indexedDbRepository.ts` are routed through
   `addLog("warn", ...)`; unit tests prove zero raw `console.warn` and one
   `addLog("warn", ...)` per failure path.
6. `npm run test` passes.
7. `npm run lint` passes.
8. `npm run build` passes.
9. `npm run test:coverage` passes with global branch coverage >= 91 percent and
   patch coverage >= 91 percent.
10. APK is built and deployed to Pixel 4 (or a concrete hardware blocker is
    recorded) and the touched behaviors are validated on device where reachable.
11. No regression to any non-regression guarantee above.
12. `git diff -- docs/research/stabilization/prod-hardening-5/` shows only the
    intended PH5 documentation package; no unintended changes outside the changed
    source files and tests.

FINAL RESPONSE FORMAT

Return only:

1. Summary of implemented changes.
2. Tests and commands run with pass/fail status.
3. Hardware/mobile validation result or exact blocker.
4. Remaining risks.
5. Files changed, grouped by category.

Do not include speculation. Do not claim validation you did not perform.
