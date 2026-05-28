ROLE

You are an expert senior production engineer working on C64 Commander, a React + Vite + Capacitor
application that controls C64 Ultimate and Ultimate 64 devices over REST, FTP, and Telnet.

This is an IMPLEMENTATION task for docs/research/stabilization/prod-hardening-4/prompt.md.

It is the final polishing pass before a major production release. This is NOT a refactor and NOT a
re-architecture. The goal is an absolutely zero-error, smooth, resilient experience that always
keeps the user in command. Make the smallest coherent changes that fully fix the issues below and
lock them with deterministic regression tests.

Classify this task as CODE_CHANGE with required tests, documentation, coverage, build, and
Android/device validation evidence.

Read these first, in this order:

1. .github/copilot-instructions.md
2. AGENTS.md and CLAUDE.md (if present)
3. docs/research/stabilization/prod-hardening-4/research.md  (the evidence behind every task below)
4. docs/research/stabilization/prod-hardening-3/prompt.md and results.md (the guarantees you must not regress)
5. docs/architecture.md and docs/features-by-page.md
6. docs/c64/c64u-openapi.yaml (REST), docs/c64/c64u-telnet.yaml (Telnet) as needed
7. docs/testing/maestro.md (only if you touch Maestro flows)
8. Current code and tests in the repository

Immediately create docs/research/stabilization/prod-hardening-4/PLANS.md (authoritative execution
plan, kept current) and docs/research/stabilization/prod-hardening-4/WORKLOG.md (what you inspected,
what changed, exact command results, hardware evidence, blockers). Then implement autonomously until
all termination criteria are met. Do not stop after analysis.

CONTEXT — WHAT THIS PASS IS ABOUT

A live real-hardware session (Pixel 4 `9B081FFAZ001WX`; `u64` Ultimate 64 Elite fw 3.14e at
192.168.1.13; `c64u` C64 Ultimate fw 1.1.0 at 192.168.1.167) exercised every page. The app was
very stable: no crashes, no unhandled exceptions, no ANRs. Volume coalescing, duration-driven
auto-advance, cross-device disk playback (device-bound origin), disk/page state consistency, and
exception discipline were all verified correct and MUST NOT regress.

Three issues were found. Full evidence (stack traces, request URLs, timings) is in research.md.

NON-NEGOTIABLE CONSTRAINTS

1. Preserve the approved device-call gateways (REST `withRestInteraction`, FTP `withFtpInteraction`,
   Telnet `withTelnetInteraction`, config writes `scheduleConfigWrite`). Do not add a new transport
   path and do not bypass queues, cooldowns, the circuit breaker, or scheduleConfigWrite.
2. Preserve the `switchDeviceDialog` 10 second full saved-device health cycle exactly.
3. Do not chase the device firmware FTP root cause. Harden the app against the class: assume any
   fast sequence of FTP/REST/Telnet calls can transiently stall a fragile device.
4. Do not weaken tests, loosen assertions, remove guards, skip coverage, or hide failures.
5. Do not refactor unrelated files. Keep visible UX changes minimal and only where needed to make
   state truthful, recoverable, or testable.
6. Preserve every "verified stable" behavior in research.md §3 (volume coalescing bounds,
   auto-advance exactly-once, single-flight play starts, device-bound origin disk play, lifecycle
   via web visibility events).
7. Do not claim hardware validation unless a real target was reached and recorded.

TASKS (deterministic priority order)

TASK 1 (HIGH) — FTP resilience to transient Ultimate connect stalls

Problem (witnessed): listing `/USB2` failed with `SocketTimeoutException: failed to connect to
192.168.1.13:21 ... after 8000ms` immediately after a successful root listing, while the device FTP
was healthy from the host; a manual retry succeeded. There is no automatic retry, the native FTP
connect timeout is 8000 ms (dead time on a LAN), and the failure also affects C64U SID/disk playback
which reads blobs over FTP per track. See research.md §2 F1.

Required behavior:

1. Reduce the FTP **connect** timeout to a LAN-appropriate value (a real connect resolves in
   milliseconds). Keep read/data timeouts generous. Make this explicit and discoverable, not magic.
   The connect timeout may be driven from JS (the gateway already passes `timeoutMs`) and/or the
   native default in `android/.../FtpClientPlugin.kt`; choose the narrowest change that makes the
   connect phase fail fast without shortening legitimate reads.
2. Add a SINGLE bounded automatic retry for transient FTP failures (connect timeout,
   connection-refused/reset during connect; classify via the existing failure taxonomy where
   possible) with a short pre-retry delay so the device can finish closing the prior session. Apply
   it at the FTP gateway/wrapper layer (`src/lib/ftp/ftpClient.ts` / `withFtpInteraction` in
   `deviceInteractionManager.ts`) — not inside the React UI.
3. Guarantee a minimum pacing gap between consecutive FTP connects to the same host (the existing
   `ftpListCooldownMs` covers LIST; ensure connect pacing is honored for the retry and for reads
   too, since the native plugin is single-threaded).
4. The retry MUST respect the circuit breaker and MUST NOT use any bypass flag. When the circuit is
   open, do not retry.
5. Keep error reporting truthful: if the single retry also fails, surface the existing "Browse
   failed" / playback error exactly once (no duplicate toasts, no infinite retry).

Tests:
- Gateway/unit: first FTP attempt rejects with a transient connect-timeout error, second resolves →
  exactly one automatic retry, operation succeeds, one in-flight at a time.
- Non-retryable error (e.g. FTP login failed) → no retry.
- Circuit open → no retry, fails fast.
- Connect-timeout default is the new lower value (assert the constant / the value passed to native).
- A second consecutive transient failure surfaces a single user-facing error and does not loop.

TASK 2 (MEDIUM) — Coalesce rapid manual Next/Previous skips

Problem (witnessed): four rapid Next taps serialized into joyride run_prg → micromys run_prg →
reboot + Giana disk mount + autostart — every intermediate item was booted on the device.
`enqueueUserTransport` (usePlaybackController.ts) is FIFO single-flight but does not supersede
intermediate skips. See research.md §2 F2.

Required behavior:

1. Rapid manual Next/Previous must coalesce so only the NET target item is launched on the device.
   Advance the visible index immediately/locally and debounce the actual `playItem` so intermediate
   indices do not issue runner/reboot/mount calls.
2. Preserve single-flight (no parallel or duplicate runners) — this is a current strength.
3. Do NOT change auto-advance (`source: "auto"`), which already advances exactly one item at a time
   and is verified correct. Coalescing applies to user-initiated transport only.
4. Respect playlist boundaries, Repeat, and Shuffle semantics for the resolved target index.

Tests:
- 4 rapid user Next within the coalescing window → exactly one `playItem` for the final index; zero
  runner/mount calls for skipped intermediate items.
- A single Next still plays the next item normally.
- Auto-advance still fires exactly once per due item (existing tests stay green).
- Coalescing interacts correctly with end-of-playlist + Repeat off (stop) and Repeat on (wrap).

TASK 3 (MEDIUM) — Subscribe the background auto-skip listener once

Problem (witnessed): `BackgroundExecution.addListener`/`removeListener` churned repeatedly
(4 add/remove cycles at startup with nothing playing, and continuously during playback). The effect
at `src/pages/PlayFilesPage.tsx:1137` depends on `[autoAdvanceGuardRef, handleNext, isPaused,
isPlaying, syncPlaybackTimeline]`; async (un)registration leaves a window with no listener attached,
risking a dropped background auto-advance event. See research.md §2 F3.

Required behavior:

1. Register the `backgroundAutoSkipDue` listener ONCE on mount (effect deps limited to platform
   detection), and read volatile values (`isPlaying`, `isPaused`, `handleNext`,
   `syncPlaybackTimeline`, the auto-advance guard) via refs inside the listener body.
2. Keep the unmount cleanup (remove the listener) and the existing cancellation guard.
3. Behavior on a real `backgroundAutoSkipDue` event must be unchanged: sync the timeline, then call
   `handleNext("auto", expectedTrackInstanceId)` with current state, re-arming/clearing the watchdog
   as today.

Tests:
- The native listener is added once across a sequence of play/pause/next state changes (assert
  add/remove call counts on a mocked BackgroundExecution).
- A simulated `backgroundAutoSkipDue` event still triggers exactly-once auto-advance with the
  current playback state read through refs.

VALIDATION

Run the smallest honest set after each change, then the full suite:

1. npm run test
2. npm run lint
3. npm run build
4. npm run test:coverage  (global branch coverage MUST stay >= 91%; verify changed-line/patch
   coverage for the branch, not just global totals)

If golden-trace semantics change (REST/FTP ordering, payloads, endpoints), regenerate goldens under
playwright/fixtures/traces/golden — never weaken trace assertions.

HARDWARE / MOBILE VALIDATION (required)

1. Build the debug APK and deploy to the Pixel 4 (prefer serial prefix `9B0`). If install is blocked
   by a version downgrade, uninstall `uk.gleissner.c64commander` and reinstall, per repo policy.
2. Probe `http://u64/v1/info` first, then `http://c64u/v1/info`; record which target(s) were live.
3. On device, re-verify the three fixes against the real path:
   - FTP: browse into a deep C64U folder repeatedly; confirm transient connect stalls auto-recover
     within one retry and that no 8 s dead hang + manual re-tap is required for the healthy case.
   - Rapid Next: tap Next 4x fast on a mixed playlist; confirm only the final item boots on the
     device (no intermediate resets/mounts).
   - Background listener: confirm no add/remove churn storm and that background auto-advance still
     fires.
4. Re-confirm the §3 "verified stable" behaviors did not regress (volume coalescing bounded;
   auto-advance exactly-once; cross-device disk play via origin fetch).
5. The cleanest device observability path: forward the WebView DevTools socket
   (`adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`) and watch CDP
   `Runtime.consoleAPICalled` / `Runtime.exceptionThrown` / `Network.*`; also read the persisted
   `c64u_app_logs` localStorage store and `Capacitor/Console` logcat lines. Config writes are
   `CapacitorHttp.request` plugin calls, not `fetch`.
6. Record exact target, product identity, APK path, device serial, and result in WORKLOG.md and
   results.md. If hardware/adb/host is unavailable, record the exact blocker and continue all local
   deterministic work.

DOCUMENTATION DELIVERABLES

1. Keep PLANS.md and WORKLOG.md current.
2. Create results.md (findings, changes, tests, hardware validation, remaining risks).
3. Create pr-desc.md (concise PR-ready summary).
4. No screenshot regeneration unless a documented visible UI surface actually changed (these fixes
   should not change documented UI).

TERMINATION CRITERIA

Stop only when all are satisfied or a concrete blocker is documented:

1. PLANS.md / WORKLOG.md exist and are current; results.md and pr-desc.md created.
2. F1: FTP connect timeout lowered; single bounded retry on transient connect/timeout failures that
   respects the circuit breaker; connect pacing honored; one truthful error on persistent failure;
   deterministic tests cover retry, no-retry, circuit-open, and the lowered timeout.
3. F2: rapid manual Next/Previous coalesce to a single device launch of the net target index;
   single-flight preserved; auto-advance unchanged; tests prove zero intermediate runner/mount calls.
4. F3: background auto-skip listener registered once via refs; tests prove single registration and
   unchanged auto-advance behavior.
5. No regression to research.md §3 verified-stable behaviors (existing tests for volume, auto-advance,
   device switch, single-flight remain green).
6. npm run test, npm run lint, npm run build all pass.
7. npm run test:coverage passes with global branch coverage >= 91% and adequate patch coverage.
8. Android APK built, deployed, launched on the Pixel 4, and the three fixes validated against a
   live target (or an exact blocker recorded).

FINAL RESPONSE FORMAT

Return only:
1. Summary of implemented changes.
2. Tests and commands run with pass/fail status.
3. Hardware/mobile validation result or exact blocker.
4. Remaining risks.
5. Files changed, grouped by category.

Do not include speculation. Do not claim validation you did not perform.
