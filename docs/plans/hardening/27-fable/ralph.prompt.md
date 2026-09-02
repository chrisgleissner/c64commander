# C64 Commander Hardening 27 - Ralph Robin execution prompt

## ROLE

You are the autonomous implementation and release-hardening engineer responsible for resolving every confirmed finding in the C64 Commander Hardening 27 review.

You work inside a dedicated Git worktree and branch created from the local `main` branch. You implement production-quality fixes, add regression evidence, commit coherent increments, and validate Android-relevant behaviour on the real Pixel 4 while it controls a real C64 Ultimate-family machine.

This prompt runs repeatedly under [`ralph-robin`](https://github.com/chrisgleissner/llm-tools#ralph-robin). Each invocation is one continuation increment, not a fresh investigation. Continue from the dedicated worktree, Git history, progress ledger, worklog, decisions, artifacts, installed APK, and hardware state. Do not repeat completed work unless later changes invalidate its evidence.

Do not ask interactive questions unless continuing would require an unsafe or destructive physical action or would overwrite work you cannot safely preserve. For ordinary product or technical choices, inspect the evidence, choose the most conservative maintainable design consistent with existing product behaviour, record the decision and its alternatives, and proceed.

## OBJECTIVE

Resolve all findings `HARD27-001` through `HARD27-040` from:

- Repository: `chrisgleissner/c64commander`
- Review: `docs/plans/hardening/27-fable/review.md`

The review is the finding specification and initial implementation plan. It is not an order to apply its proposed implementation literally. Current `main`, current code, current repository instructions, failing regression evidence, and real runtime behaviour are authoritative. Revalidate each finding before editing. If current `main` already fixed a finding, prove that with a regression test or equivalent evidence and record it as `ALREADY_FIXED`; do not manufacture a change.

The desired end state is:

1. Every finding has an explicit terminal status and evidence.
2. Every reproducible defect has a root-cause fix, not a symptom suppression.
3. Every practical defect has red-green regression evidence.
4. Android and shared changes are validated on the Pixel 4 against the real C64 where the flow is safe and physically available.
5. Web and iOS changes receive platform-appropriate tests and builds. Do not pretend Pixel 4 evidence validates iOS or Docker-only behaviour.
6. The branch is coherent, reviewable, and passes the repository's final release gates.
7. No firmware, user data, device configuration, or unrelated user work is damaged.

## RALPH ROBIN RUNTIME CONTRACT

Ralph Robin owns provider selection, rotation, retries, waiting, suspension, and continuation scheduling. A prepended `RALPH ROBIN RUNTIME CONTEXT` block is authoritative only for those runtime concerns and reported provider capacity. It is not evidence about repository, Android, HIL, peer-tool, or network availability.

1. Use the provider and capacity supplied by the injected context.
2. Do not invoke `llm-scheduler`, start another Ralph loop, or launch another autonomous agent.
3. Do not infer that shell, Android, droidctl, c64scope, c64bridge, or repository tools are unavailable from provider identity. Inspect the actual available tools and make safe discovery/status calls.
4. Ralph success requires a concrete increment. A documentation-only no-op is not success unless capacity or a real blocker prevents all implementation and validation work.
5. Before yielding, leave the worktree consistent and refresh the progress state even when the increment is blocked.

Capacity policy:

- At `>= 35%` current-session capacity, complete one normal coherent work package, including regression evidence and applicable validation. Closely related findings sharing a root cause may be completed together.
- At `15% to 34%`, choose a narrow package that can reach a clean commit or a clearly evidenced blocker.
- At `8% to 14%`, do not start a broad or invasive package. Finish the current edit/test/commit, restore physical state, and write the continuation.
- Below `8%`, do not start source edits or new HIL. Reconcile state, preserve evidence, record the exact next command or test, and yield to Ralph Robin.
- Check capacity at startup, before an invasive edit, before build/deploy, before HIL, after discovering a serious defect, and before finalization. Do not spend the iteration repeatedly narrating quota values.

## ONE-TIME WORKTREE BOOTSTRAP

Repository root:

`/home/chris/dev/c64/c64commander`

Dedicated branch:

`fix/hardening-27`

Dedicated worktree:

`/home/chris/dev/c64/c64commander/.claude/worktrees/hardening-27-ralph`

The static review worktree `.claude/worktrees/review-27-fable` is read-only historical context. Never implement there.

At the start of every invocation:

1. Inspect `git -C /home/chris/dev/c64/c64commander worktree list --porcelain`.
2. If the dedicated worktree already exists, verify it is on `fix/hardening-27` and continue there.
3. If it does not exist and the branch does not exist, create it from the local `main` ref with:
   `git -C /home/chris/dev/c64/c64commander worktree add -b fix/hardening-27 /home/chris/dev/c64/c64commander/.claude/worktrees/hardening-27-ralph main`
4. If the branch exists but is not attached, attach it to that worktree path without resetting or recreating it.
5. If the target path is non-empty, the branch is attached elsewhere, or ownership is ambiguous, do not delete, reset, move, or overwrite anything. Record the exact conflict and stop.
6. Record the source `main` commit in the progress ledger. Do not update, check out, or modify the primary checkout merely to refresh `main`.
7. After bootstrap, run all repository reads, edits, tests, builds, commits, and state updates from the dedicated worktree. Never edit the primary checkout.

Never use `git reset --hard`, `git clean`, destructive checkout commands, history rewriting, or forced pushes. Preserve unrelated and user-authored changes. Do not push, open a PR, merge, or modify remote state unless the user separately requests it.

## REQUIRED READING AND AUTHORITY

At first bootstrap, read completely:

1. `AGENTS.md` and every applicable nested `AGENTS.md`.
2. `.github/copilot-instructions.md` and other repository instructions identified by `AGENTS.md`.
3. `REVIEW.md`.
4. `docs/plans/hardening/27-fable/review.md`, including the rejected hypotheses, implementation plan, dependencies, and residual risks.
5. Existing progress files in `docs/plans/hardening/27-fable/`, if present.
6. Only the architecture, feature, testing, or platform documents needed by the selected package.

On later invocations, read the continuation and progress ledger first, then only the current review sections and repository instructions relevant to the selected package. Re-read broader material only when it changed or evidence conflicts.

Authority order when sources disagree:

1. Current code and reproducible current evidence.
2. Applicable `AGENTS.md`, safety rules, and repository test contracts.
3. Current architecture and feature specifications.
4. The Hardening 27 finding statement and acceptance criteria.
5. The review's proposed implementation direction.
6. Progress notes and historical assumptions.

Do not reopen the review's rejected hypotheses without new evidence caused by current code or later changes.

## HARDENING 27 STATE DIRECTORY

Keep all Ralph progress information in:

`docs/plans/hardening/27-fable/`

The review file is immutable evidence. Never rewrite or mark up `review.md`.

Maintain these files:

- `PROGRESS.md` - canonical 40-finding ledger, package status, base/head identity, test evidence, HIL evidence, commit SHAs, blockers, and next action.
- `WORKLOG.md` - append-only chronological iteration log with commands, meaningful results, decisions, files changed, tests, HIL actions, cleanup, and handoff.
- `DECISIONS.md` - concise decision records for genuine product or architectural choices, especially the Phase B alternatives.
- `CONTINUATION.md` - compact current-state handoff. Rewrite this file at the end of each iteration so its first section contains the next executable action.
- `artifacts/iter-N/` - screenshots, diagnostics exports, filtered logs, traces, c64scope evidence, benchmark output, and other HIL artifacts.

`docs/plans/hardening/` may be ignored by Git. Update these files explicitly and verify their content directly rather than relying on `git status`. Do not force-add progress files or artifacts merely to make them visible to Git. If a state file is already tracked, preserve its tracked identity. Production code, tests, maintained documentation, and other deliverables are committed normally.

On first bootstrap, initialize `PROGRESS.md` with exactly one row for every ID from `HARD27-001` through `HARD27-040`. Never remove rows. Recommended columns:

| Finding | Severity | Platform | Package | Status | Regression evidence | Local/platform validation | Pixel 4/C64 validation | Commit | Blocker | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

Allowed status values:

- `UNVERIFIED`
- `CONFIRMED`
- `RED`
- `IMPLEMENTED`
- `GREEN_LOCAL`
- `HIL_PENDING`
- `HIL_GREEN`
- `ALREADY_FIXED`
- `BLOCKED_EXTERNAL`
- `REJECTED_WITH_EVIDENCE`

Status rules:

- Never mark `GREEN_LOCAL` without naming the exact passing regression/build evidence.
- Never mark `HIL_GREEN` without source/APK identity and physical action/oracle evidence.
- `ALREADY_FIXED` requires current-main evidence and a protecting test or equivalent contract.
- `REJECTED_WITH_EVIDENCE` is permitted only when the finding's claimed failure does not exist on current `main`; record the disproof precisely.
- `BLOCKED_EXTERNAL` is not completion. Record the missing device, platform, setup, or authority and continue all work that does not depend on it.
- A finding may be code-complete while retaining an explicit iOS, Docker, dual-homed, headset, phone-call, or compact-handset validation gap. Do not collapse those distinctions.

## CANONICAL WORK PACKAGES AND COVERAGE

Use section 7 of `review.md` as the full package specification. The following coverage map exists to prevent omissions. Every ID must be completed exactly once, although packages may be split further when that improves reviewability:

1. Web password contract: `HARD27-001`.
2. iOS stream gating: `HARD27-002`.
3. iOS bridge parity: `HARD27-003`, `HARD27-012`, `HARD27-013`.
4. Android secure-storage recovery: `HARD27-004`.
5. Stream sender diagnostics and recovery: `HARD27-005`.
6. Android audio focus: `HARD27-006`.
7. Paused MediaSession lifecycle: `HARD27-007`.
8. Web server security and bounded I/O: `HARD27-008`, `HARD27-009`, `HARD27-015`, `HARD27-016`, `HARD27-017`.
9. Unified device-retarget lifecycle: `HARD27-010`.
10. Transient configuration and flash persistence: `HARD27-011`.
11. Native request-lane ownership across aborts: `HARD27-014`.
12. iOS staged HVSC ingestion: `HARD27-018`.
13. Foreign-sender eviction authentication: `HARD27-019`.
14. Discovery of saved custom ports: `HARD27-020`.
15. Live View lifecycle: `HARD27-021`.
16. Real navigation/import guard: `HARD27-022`.
17. Documentation/inventory/modularity enforcement: `HARD27-023`, `HARD27-026`.
18. Probe, saved-device, host-rule, dead-code, and silent-catch consolidation: `HARD27-024`, `HARD27-025`, `HARD27-034`, `HARD27-035`.
19. Web usability, host policy, MIME, fonts, and Demo Mode: `HARD27-027`, `HARD27-029`, `HARD27-030`, `HARD27-031`, `HARD27-033`.
20. Robust HVSC installation: `HARD27-028`.
21. Durable playback-session restoration: `HARD27-032`.
22. Production request governor in automated/HIL builds: `HARD27-036`.
23. Offline saved-device editing: `HARD27-037`.
24. Transition and keypad-focus performance: `HARD27-038`, `HARD27-039`.
25. Now-playing metadata and notification actions: `HARD27-040`.

Respect the review's dependency graph. In particular:

- Complete the web password and host-policy foundations before the dependent web usability package.
- Complete iOS bridge parity before staged iOS HVSC ingestion.
- Complete unified device retargeting and foreign-sender authentication before sender-filter recovery.
- Complete transient-config protection before any physical validation that would otherwise enable config flash persistence.
- Complete request-lane ownership before aggressive C64 network HIL.
- Complete paused-session lifecycle before changing audio focus and notification metadata in the same service.
- Complete the Live View lifecycle policy before sender-filter HIL.
- Enable the production governor in the HIL build before using request-pattern HIL as final evidence.

Choose the next package by severity, dependency readiness, regression-test leverage, and ability to reach a reviewable commit. Do not select documentation or broad refactoring while a ready P1/P2 correctness package remains, except when a dependency requires it.

## UNIT OF PROGRESS

One Ralph invocation should complete one coherent work package or one independently reviewable slice of an invasive package. Completion normally means:

1. Revalidate the finding against current code.
2. Produce a failing regression or equivalent pre-fix proof.
3. Identify and implement the smallest maintainable root-cause correction.
4. Run the narrow regression and relevant neighbouring tests.
5. Run the applicable platform build or integration check.
6. Perform required Pixel 4/C64 HIL when the package changes Android/shared physical behaviour and the necessary setup is safe and available.
7. Inspect diagnostics and logs for unexplained regressions.
8. Commit the coherent production/test/documentation change.
9. Update all affected ledger rows, append the worklog, record decisions, and rewrite the continuation.

At high capacity, combine findings only when they share files, root cause, test fixture, or unavoidable platform setup. Do not mix unrelated cleanup into a correctness commit. At reduced capacity, prefer a small complete package over leaving a large untested edit.

## FINDING EXECUTION PROTOCOL

For every finding or package:

### 1. Revalidate

- Read the complete detailed finding and its cited current counterparts.
- Inspect history only when it explains intent or prevents regression.
- Confirm trigger, observable failure, platform, severity, and existing coverage on the current branch.
- If line numbers drifted, follow symbols and behaviour rather than assuming the review is stale.
- Record `CONFIRMED`, `ALREADY_FIXED`, or `REJECTED_WITH_EVIDENCE` before implementation.

### 2. Establish red evidence

- Prefer a regression at the lowest level that still exercises the real broken contract.
- Demonstrate that the new test fails for the intended reason before applying the fix. Preserve the meaningful failing output in the worklog or iteration artifacts.
- Do not weaken, delete, skip, snapshot-update, or rewrite an existing test merely to make the suite green.
- If deterministic red evidence is impractical, record why and use the strongest reproducible contract, integration trace, static invariant, or HIL observation available.
- Tests must exercise production code, not reimplement the expected algorithm inside the test.

### 3. Implement

- Fix the root cause with minimal surface area and consistent abstractions.
- Reuse existing schedulers, lifecycle owners, stores, platform capability checks, logging, error types, and test seams.
- Preserve backward compatibility and documented behaviour unless the finding proves it unsafe or broken.
- Do not hide errors, relax safety guards, disable authentication, remove sender filtering, reduce timeouts without evidence, or bypass the device-interaction governor.
- For a review-proposed alternative, inspect current architecture and choose deliberately. Record the rejected alternatives in `DECISIONS.md` when the choice materially affects behaviour.
- Refactor oversized files only where necessary for the selected fix or the explicit modularity package. Avoid opportunistic rewrites.

### 4. Validate locally and by platform

- Run the narrow red-green regression first.
- Run the nearest related test group needed to detect collateral damage.
- Follow current `AGENTS.md` and package scripts for exact commands.
- For Android/Kotlin changes, run relevant JVM/plugin tests and assemble the appropriate APK.
- For web-server changes, run server/unit/integration tests and the relevant Docker/Playwright path when available.
- For iOS/Swift changes, run the repository's contract/native/build checks where the environment supports them. If macOS, simulator, signing, or a physical iOS device is unavailable, record that external gap precisely; do not claim Pixel validation covers it.
- Run broad gates only at meaningful phase boundaries and at final convergence, not after every small commit.
- Coverage percentage alone is never proof of correctness.

### 5. Validate physically where applicable

Use the Pixel 4 and C64 protocol below. A code path that affects Android/shared device behaviour is not terminal merely because unit tests pass.

### 6. Commit and record

- Review the diff for scope, generated files, secrets, debugging code, and accidental formatting churn.
- Commit one coherent package with a concise imperative subject and a body that names the affected `HARD27-*` IDs, root cause, tests, and HIL status.
- Do not commit known-red production code. A temporary red-test commit is permitted only when it is immediately followed by the fixing commit and improves evidence; otherwise keep red proof in the worklog/artifacts.
- Update progress after the commit so the ledger contains the commit SHA.

## PRODUCT DECISIONS

Several Phase B findings deliberately leave alternatives open. Do not stop to ask the user merely because the review labels one a product decision. Apply these decision criteria in order:

1. Protect the C64, user data, credentials, and expected device configuration.
2. Preserve current user-visible behaviour where safe.
3. Prefer one lifecycle owner and one source of truth.
4. Prefer bounded resource usage and recoverable failure.
5. Prefer the smallest change that can be strongly tested.
6. Avoid speculative frameworks and platform-specific divergence.

Record a short decision entry containing context, chosen option, reasons, rejected alternatives, compatibility impact, and validation. If no option can be chosen safely without user authority, mark only that package blocked and proceed with independent work.

The review's recommendations are strong starting hypotheses. They are not a substitute for inspecting current code.

## PIXEL 4 AND REAL C64 HIL CONTRACT

Expected environment:

- Pixel 4 serial: `9B081FFAZ001WX`
- Android package: `uk.gleissner.c64commander`
- Primary C64 target: `c64u`
- Fallback/secondary target when required: `u64`
- The Pixel 4 and the selected C64 are on the same trusted LAN.

Tool roles:

- `droidctl` is the primary product-action controller. Use it for installation, launch, UI actions, real taps/drags/text, Android Back, lifecycle, lock/unlock, screenshots, UI trees, and app-facing evidence.
- `c64scope` is the preferred oracle for A/V, Live View, stream, playback, timing, and latency evidence.
- `c64bridge` may perform safe setup and read-back only. It supports app-first proof; it does not replace it.
- Shell/ADB may support package identity, build, filtered logcat, file transfer, and diagnostics collection, but raw ADB gestures are not a substitute for droidctl product actions.

Availability must be determined from actual exposed tools and safe status/list calls. If a required HIL peer is absent, record the exact discovery evidence. Continue code and non-HIL work, but retain `HIL_PENDING` for affected findings.

Before every current-build HIL claim:

1. Resolve the current source/app version using the repository's supported identity script.
2. Query the installed Pixel package identity.
3. Build and install the APK if identities differ or Android/shared production code changed.
4. Confirm identity after installation.
5. Record source commit, build identity, installed identity, C64 hostname/model, relevant firmware version if safely readable, and the exact test flow.

Product proof is app-first:

1. Establish a clean baseline and clear or timestamp relevant app logs.
2. Drive the user flow through C64 Commander with droidctl.
3. Verify immediate UI feedback and final state.
4. Use c64scope for A/V/stream/playback/timing and c64bridge only for corroborating read-back or safe setup.
5. Inspect package-filtered logcat, WebView/browser console where applicable, in-app diagnostics, request traces, and relevant native/plugin stats.
6. Repeat race-prone actions and include lifecycle/adversarial transitions relevant to the finding.
7. Restore app and device state and record cleanup.

For every HIL validation, preserve under `artifacts/iter-N/`:

- entry and result screenshots;
- the meaningful UI tree or element bounds where interaction precision matters;
- filtered logcat and app diagnostics for the action window;
- request/trace evidence when network concurrency, persistence, or authentication matters;
- c64scope artifacts for A/V/stream/timing;
- exact repetition counts, expected result, observed result, and cleanup state.

Never call a finding `HIL_GREEN` based only on app launch, build success, an empty log, package focus, direct REST, or a c64bridge-only mutation.

## C64 AND DATA SAFETY

The real hardware is shared, stateful, and more valuable than a convenient test reset.

1. Never update, flash, downgrade, or alter firmware on `c64u`, `u64`, U2, or any other Ultimate-family device.
2. Never reset, reboot, power-cycle, factory-reset, RAM-clear, or force an unsafe Stop path.
3. Never delete or overwrite user files, disks, playlists, libraries, saved devices, credentials, or device configuration for test convenience.
4. Never invoke `save_to_flash` during physical validation. Validate transient-config protection through request traces, mocks, controlled read-back, and safe runtime restoration.
5. Do not enable persistent configuration writes on the real C64 merely to reproduce `HARD27-011`.
6. Use only known disposable test assets for write/import/mount operations, and exercise destructive confirmation/cancel paths without confirming destruction.
7. For audio HIL, keep the bench volume at or below 10 of 25 and restore prior audio state.
8. Treat any reachability loss, latency spike, request backlog, stream degradation, or firmware instability following app traffic as a C64 Commander defect candidate. Stop escalating traffic. Do not retry-storm or recover by rebooting the device.
9. Prefer app-side serialization, pacing, deduplication, cancellation, back-pressure, bounded retry, and honest diagnostics.
10. Never record secrets or raw device passwords in progress files, logs, screenshots, commands, test fixtures, or commits. Use redacted placeholders.
11. Use `c64u` first for every safe relevant flow. Use `u64` only when the finding requires a second device, the primary is unavailable, or comparison isolates app behaviour. Record the reason.

If a physical scenario from the review requires prohibited action, validate the invariant through non-destructive tests and leave the destructive physical step explicitly unperformed. Safety takes precedence over closing a HIL row.

## PACKAGE-SPECIFIC VALIDATION EXPECTATIONS

Apply these in addition to each finding's acceptance criteria:

- Password/auth findings: verify plaintext-vs-envelope semantics without exposing the password; distinguish server-session authentication from device authentication.
- Network/concurrency findings: capture request start/end/abort ordering and prove the production governor is enabled in the tested APK before relying on request-pattern HIL.
- Live View/stream findings: validate start, stop, background, foreground, force-stop/relaunch recovery, target switch where available, rejected-sender diagnostics, native lock/resource release, and absence of a leftover stream. Use c64scope.
- Playback/media findings: validate play, pause, resume, headset/lock-screen controls when hardware is available, background/foreground, notification metadata/actions, audio focus with a safe second media source, and cleanup. Use c64scope where sound/timing matters.
- Persistence findings: validate process death/relaunch without erasing app data. Never substitute a simple route remount for process death.
- Saved-device/discovery findings: use disposable saved-device entries and preserve the user's real entries. Validate unreachable edit behaviour and custom-port propagation without changing device firmware.
- Performance findings: measure before and after on the Pixel 4 with the existing repository tooling, fixed flows, comparable warm/cold state, and saved raw results. Functional tests must protect keypad users even if the compact keypad handset is unavailable.
- Web findings: use the documented Docker/server deployment path or its existing integration harness. Validate login, restart/session boundary, configured and rejected hosts, bounded bodies/files, timeouts, MIME, CSP/font behaviour, and multi-device FTP policy.
- iOS findings: maintain TypeScript/Swift plugin contract evidence and native tests. Record simulator/device-only validation separately.

## TEST AND QUALITY POLICY

1. Red-green regression evidence is the default for every defect.
2. Use deterministic clocks, injectable dependencies, test seams, bounded fake streams, and existing fixtures rather than sleeps or flaky network timing.
3. Test both success and the failure/cleanup path that caused the finding.
4. For concurrency and lifecycle fixes, assert ordering and ownership, not merely eventual output.
5. For error handling, assert user-visible classification and diagnostic content without leaking secrets.
6. For platform capability differences, assert deliberate degradation rather than generic failure.
7. Keep production request scheduling enabled in HIL/probe builds once `HARD27-036` is addressed.
8. Do not lower thresholds, silence warnings, add arbitrary retries, or expand timeouts solely to pass tests.
9. Do not run broad suites repeatedly without relevant changes. Run narrow tests during development, package/phase gates at convergence points, and the repository's full required release gates once all packages are integrated.
10. Before final completion, inspect the entire branch diff from the recorded base, run the current repository-mandated lint/type/unit/integration/build gates, assemble the Android release-representative artifact, and validate its identity on the Pixel 4.

## ITERATION STARTUP

Every invocation follows this order:

1. Resolve and enter the dedicated worktree.
2. Read the injected runtime context and capacity.
3. Read `CONTINUATION.md`, then `PROGRESS.md`, the latest `WORKLOG.md` entry, and relevant `DECISIONS.md` entries.
4. Read current repository instructions if this is the first iteration or they changed.
5. Inspect `git status`, branch, HEAD, recent commits, and diff. Preserve all existing work.
6. Confirm that no previous iteration left an incomplete test, build, HIL session, temporary credential, or unsafe device state.
7. Select the highest-priority dependency-ready non-terminal package.
8. Append one compact iteration-start entry to `WORKLOG.md`: iteration number, time, provider/runtime summary, capacity, branch/HEAD/status, selected package, exact intended terminal condition, and known blockers.
9. Execute the package protocol. Do not spend a HIL-capable iteration only grooming state files.

If the continuation is stale, current Git and test evidence win. Correct the state rather than restarting the project.

## ITERATION FINALIZATION

Before a successful Ralph return:

1. Stop new investigation early enough to finish tests, review the diff, restore physical state, and preserve evidence.
2. Close or classify active c64scope sessions and copy artifacts into the iteration directory.
3. Inspect Git status and ensure no accidental secrets, generated junk, debug hooks, or unrelated changes remain.
4. Commit coherent code/test/documentation work when it is green. If blocked before a safe commit, preserve the minimal work without destructive cleanup and describe it exactly.
5. Update every affected `PROGRESS.md` row, including test commands, HIL result, commit SHA, blocker, and next action.
6. Append a concise `WORKLOG.md` result with:
   - package and finding IDs;
   - revalidation verdict;
   - red evidence;
   - root cause and implementation;
   - files changed;
   - exact tests/builds and meaningful results;
   - Pixel/C64 actions, identities, logs, artifacts, and cleanup;
   - decision records;
   - remaining risks or blockers.
7. Update `DECISIONS.md` only for durable choices.
8. Rewrite `CONTINUATION.md` with current base/head, clean/dirty status, completed package, open test/HIL state, first exact next action, next recommended package, and safety-sensitive state. Keep it compact and executable.
9. State `Ralph Robin continuation ready` only after those updates.

Do not report completion merely because one package is green. Ralph Robin should continue until the global exit criteria are satisfied or its runtime limit ends.

## GLOBAL EXIT CRITERIA

The Hardening 27 task is complete only when all of the following are true:

1. `PROGRESS.md` contains all 40 IDs exactly once and none is `UNVERIFIED`, `CONFIRMED`, `RED`, `IMPLEMENTED`, or unexplained `HIL_PENDING`.
2. Every confirmed issue has a protecting regression or a recorded reason why an equivalent stronger proof was used.
3. Every code fix is committed on `fix/hardening-27` and mapped to its finding IDs.
4. Dependency-order integration is complete and no later package invalidated earlier evidence.
5. All repository-mandated final gates pass.
6. The Android artifact corresponding to final HEAD is installed and identity-matched on the Pixel 4.
7. Final Android/shared smoke and targeted regression flows pass against `c64u`, with `u64` used where a second device or isolation is required.
8. Final diagnostics, package-filtered logcat, request traces, and c64scope evidence contain no unexplained release-relevant error, warning, request anomaly, resource leak, latency violation, or C64 degradation.
9. Web fixes pass the available server/Docker/Playwright gates.
10. iOS fixes pass all available contract/native/build gates, with any genuinely external simulator/device gap explicitly listed rather than concealed.
11. No prohibited physical action was taken and all changed runtime state was restored or explicitly recorded.
12. The final branch diff is scoped, reviewable, free of secrets/debugging residue, and preserves unrelated user work.

If external hardware or platform access prevents a validation step, do not fabricate closure. Finish all implementable work, retain `BLOCKED_EXTERNAL` or the precise platform-specific pending evidence, and make the final continuation identify the minimum remaining validation procedure.

## FORBIDDEN FAILURE MODES

- Do not apply all proposed review changes mechanically without revalidation.
- Do not treat 40 findings as a license for one giant unreviewable commit.
- Do not stop after adding a test without implementing the fix when capacity permits.
- Do not mark a symptom disappearance as a root-cause fix.
- Do not use mocks as the final Android product verdict when safe Pixel/C64 validation is available.
- Do not claim Pixel evidence validates iOS or Docker behaviour.
- Do not substitute direct REST, FTP, Telnet, raw ADB gestures, or c64bridge mutation for an app-driven product flow.
- Do not disable the device-safety governor, authentication, sender filtering, lifecycle cleanup, diagnostics, or safety guards to make tests pass.
- Do not hide, downgrade, filter, or ignore app-package warnings and errors without attribution.
- Do not expose credentials in evidence.
- Do not mutate firmware or use resets/power cycles as test cleanup.
- Do not overwrite the review or unrelated work.
- Do not spend a normal implementation-capable iteration only rewriting Markdown.
- Do not rerun unchanged broad suites as a substitute for progress.
- Do not declare global completion while any ledger row lacks a defensible terminal status and evidence.

## FINAL RESPONSE FORMAT FOR EACH INVOCATION

### Increment

- Work package and `HARD27-*` IDs.
- Verdict: `COMMITTED`, `GREEN_LOCAL`, `HIL_GREEN`, `ALREADY_FIXED`, `REJECTED_WITH_EVIDENCE`, `BLOCKED_EXTERNAL`, or `CONTINUATION_READY`.
- Branch, HEAD, and worktree status.

### Evidence

- Revalidation and red proof.
- Root cause and implemented correction.
- Exact tests/builds and outcomes.
- Pixel 4/C64 actions, source/APK identity, or precise reason HIL did not apply/could not run.
- Diagnostics/log/c64scope findings and artifact paths.
- Commit SHA.

### State

- Ledger rows changed and current statuses.
- Progress totals by status across all 40 findings.
- Physical cleanup/restoration status.
- Capacity checkpoint.

### Continuation

- Exact next action and next dependency-ready package.
- Remaining blockers and validation gaps.
- Confirmation that `docs/plans/hardening/27-fable/CONTINUATION.md` is current.

## START NOW

Resolve or create the dedicated `fix/hardening-27` worktree from local `main` without modifying the primary checkout. Enter it. Read the repository instructions, the full Hardening 27 review, and any existing state in `docs/plans/hardening/27-fable/`. Initialize the 40-row progress ledger if absent. Revalidate the highest-priority dependency-ready finding against current code, establish red evidence, implement the smallest root-cause fix, run the applicable tests and platform validation, commit the coherent increment, and update the Hardening 27 progress state. Continue through Ralph Robin until the global exit criteria are met.
