# Agent Guide

This repository is **C64 Commander**, a React + Vite + Capacitor app for managing and controlling a C64 Ultimate device.

This file is an orientation and execution guide.

## ⚠️ CRUCIAL — the c64u "network dies until power-cycle" wedge is a DEVICE FIRMWARE defect

Long-standing symptom: a C64 Commander interaction drives the Ultimate (esp. `c64u`) into a
state where **all TCP services die** (HTTP `:80`, FTP `:21`, Telnet `:23` → refused/000) while
**ICMP ping stays fine**, and it **only recovers on a manual power-cycle**.

Root cause (confirmed 2026-06-25, `docs/testing/agentic-tests/full-cta-coverage/defects/S1-C64U-FIRMWARE-TCP-WEDGE-ON-IDLE-RECONNECT.md`):
**a c64u firmware defect** — its embedded (lwIP) TCP stack intermittently and permanently wedges
when handling a connection after the network has been idle for minutes (e.g. the first poll when
the app returns from background). A client cannot permanently kill a healthy server's TCP stack
with normal HTTP GETs, so this is server-side. It is **low-probability per event**, idle-correlated,
and **independent of the app's connection-reuse policy** (it recurred with HTTP keep-alive both on
and off — so do NOT "fix" it by toggling keep-alive; that earlier attempt was reverted as
ineffective). The app can only reduce trigger frequency (fewer connections, fewer request-after-idle
events) and degrade gracefully — **it cannot cure it. The real fix is a c64u firmware update**
(report upstream: see the defect doc + `docs/c64/c64u-firmware-tcp-wedge-report.md`).

A separate, also-firmware issue (NOT this one): a CPU-Speed config write drops the network while
the firmware applies the clock change — mitigated only by single-item sequential writes.

## Rule precedence

1. **Quality bar (what every change must satisfy)**: `REVIEW.md` (repo root)
2. **Entry index**: `.github/copilot-instructions.md`
3. **Execution manual (this file)**: `AGENTS.md`
4. **Task-specific user prompt**

`REVIEW.md` defines _what good looks like_ (review standards, severity, verification,
repository-specific hazards); this file defines _how to execute and validate_. Read
`REVIEW.md` before writing code — the best problem is the one prevented at the keyboard.
If instructions conflict, the narrower, safer rule wins, and a task prompt may narrow
scope only without violating `REVIEW.md`.

## Quick orientation

1. Start with `README.md` for overview, local build steps, and Android notes.
2. Read `REVIEW.md` for the quality bar every change is held to (hazards, severity, verification).
3. REST API details live in the per-device specs: `docs/c64/devices/u64e/3.15alpha/u64e-openapi.yaml`
   for C64U/U64/U64E2 and `docs/c64/devices/u2/3.14a/u2-openapi.yaml` for U2.
4. Consult `docs/c64/c64u-telnet.yaml` before any Telnet-related change; treat it as the Telnet menu/source-of-truth reference.
5. Read the UX design in `docs/ux-guidelines.md` before any UX work.
6. Read `docs/testing/maestro.md` before authoring or editing any Maestro flows.
7. UI routes live in `src/pages/` and navigation in `src/components/TabBar.tsx`.
8. Networking and data hooks are in `src/lib/c64api.ts` and `src/hooks/`.
9. Song sources live in `src/lib/sources/` and the HVSC module lives in `src/lib/hvsc/`.
10. `.github/copilot-instructions.md` is the entry index; `REVIEW.md` is the quality bar and this file is the execution manual.

## Required execution model

Follow this sequence unless the task explicitly requires something narrower.

### Phase 1 - Read before acting

Read the smallest relevant set first:

1. `README.md`
2. `.github/copilot-instructions.md`
3. `docs/ux-guidelines.md` for UI work
4. `docs/testing/maestro.md` for Maestro work
5. additional files directly relevant to the touched area

Do not start making changes before you understand the touched subsystem and validation expectations.

### Phase 2 - Classify the change

Before building, testing, or regenerating screenshots, classify the task. This
classification is mandatory because it controls whether a build is needed, which test
suites run, whether screenshots must be regenerated, and which docs must be updated.
Apply the **smallest validation set that honestly matches the change**.

- **`DOC_ONLY`** — only non-executable docs/prose change (`*.md`, doc comments,
  README/doc updates, guidance files not executed by tooling).
  - Required: verify docs are accurate and internally consistent, fix cross-references,
    keep formatting clean.
  - Do **not** run `npm run build`, `npm run test`, `npm run test:e2e`, `./build`,
    Android build/sync, or screenshot regeneration unless the task explicitly requires it.
- **`CODE_CHANGE`** — affects executable code, build scripts, config, tests, or runtime
  assets (`src/`, `android/`, `agents/`, `package.json`, `vite.config.*`, Playwright /
  Maestro / Vitest / Gradle / Python test code).
  - Run the validation relevant to the touched layer(s); typical baseline:
    ```bash
    npm run lint
    npm run test
    npm run build
    ```
  - Add targeted suites when appropriate (`npm run test:agents`,
    `cd android && ./gradlew test`). Do **not** regenerate screenshots for non-visible changes.
- **`UI_CHANGE`** — affects visible rendered UI, navigation, labels, layout, controls,
  icons, colors, or screenshots.
  - Run the `CODE_CHANGE` baseline plus the smallest UI validation that proves the change
    (`npm run test:e2e`, `npm run cap:build`), and regenerate **only** the screenshots for
    surfaces whose visible output actually changed.
- **`DOC_PLUS_CODE`** — both docs and executable code changed; treat as a code change and
  also update the relevant docs.

### Phase 3 - Map impact before editing

Identify exactly which surfaces are affected:

- source files
- tests
- docs
- screenshot folders under `docs/img/`
- runtime platforms: web, Android, iOS CI-only

Prefer a minimal, explicit impact map over broad speculative edits.

### Phase 4 - Implement with minimal scope

Make the smallest coherent change that fully satisfies the task.

Rules:

- keep repository conventions
- avoid speculative abstraction
- do not widen scope without a concrete reason
- preserve determinism and diagnosability
- add regression tests for bug fixes

### Phase 5 - Stabilize on the real target first

For productionization, hardening, exploratory regression, or device-stabilization
tasks, do not spend the main execution window on broad builds, full-suite tests, or
coverage before the user-facing device deliverables are actually working on the
Pixel 4.

Priority order for these runs:

1. Reproduce and stabilize the behavior on the Pixel 4.
2. Prefer `c64u` when it is available; use `u64` as fallback or comparison.
3. If `c64u` becomes unavailable during testing, assume first that app-driven
   traffic from the Pixel 4 may have caused it. Stop further `c64u` traffic,
   preserve app/request diagnostics, and root-cause the request pattern before
   treating the device as externally flaky.
4. Add focused regression tests for confirmed code defects as the fixes are made.
5. Run full tests and coverage only after the core device deliverables are done
   or explicitly paused/blocked.

### Phase 5a - Validate honestly

Run the smallest validation set that the change classification requires.

- `DOC_ONLY` does **not** require builds or tests unless the task explicitly says otherwise.
- `CODE_CHANGE` requires targeted code validation.
- `UI_CHANGE` requires targeted code validation plus the smallest honest UI validation and screenshot refresh only where needed.
- For productionization/device-stabilization runs, broad suites and coverage are
  finalization gates, not a substitute for real Pixel 4 evidence.

### Phase 5b - Deploy the latest APK before completion

Before declaring any task complete, deploy the most recent built APK from `android/app/build/outputs/apk/` to the attached Pixel 4.

- Prefer the adb-attached Pixel 4 with serial prefix `9B0` when it is present.
- Attempt installation of the newest APK first.
- If installation fails because an earlier installed copy blocks the update, uninstall the existing `uk.gleissner.c64commander` package from that Pixel 4 and retry the installation.
- Launch the newly deployed build on that Pixel 4 and validate the user-visible behavior there for the touched feature area before closing the task.
- Record the deployment and on-device validation result in the completion summary; do not claim the work is finished until this deploy-and-validate step has succeeded or a concrete hardware/adb blocker is documented.

### Phase 5c - Version identity must match Git

The app version shown by built APK/IPA artifacts and in-app diagnostics must be
derived from the latest Git tag plus the current Git commit ID. Do not let
`package.json`, Gradle defaults, Xcode defaults, or stale environment values produce
a different displayed version from the source revision being built.

### Phase 6 - Report precisely

At completion, summarize:

- what changed
- which tests/builds were run
- which screenshot files or folders were updated, if any
- why broader validation or screenshot refresh was not needed, when relevant

## Source of truth

- **Quality bar / review standards**: `REVIEW.md` (repo root)
- **Entry index**: `.github/copilot-instructions.md`
- **REST API docs**: `docs/c64/devices/u64e/3.15alpha/u64e-openapi.yaml` for C64U/U64/U64E2
  and `docs/c64/devices/u2/3.14a/u2-openapi.yaml` for U2. Gate U64-family-only surfaces such as
  Streams and `machine:input` on runtime capabilities; U2 has no Streams/Input/poweroff.
- **Telnet menu reference**: `docs/c64/c64u-telnet.yaml` (consult before Telnet-related code or test changes)
- **CTA inventory & keypad map**: `docs/cta-inventory.md` (authoritative per-page list of every interactive control and its keypad/D-pad/T9 reachability; keep current — see "CTA inventory upkeep")
- **App entry**: `src/main.tsx`, `src/App.tsx`
- **UI**: `src/pages/`, `src/components/`, `src/components/ui/`
- **App config state**: `src/hooks/useAppConfigState.ts`, `src/lib/config/`
- **Song sources**: `src/lib/sources/`
- **HVSC module**: `src/lib/hvsc/`
- **SID player utilities**: `src/lib/sid/`

## Architecture map

- **UI**: `src/pages/`, `src/components/`, `src/components/ui/`
- **Hooks + data fetching**: `src/hooks/`, `src/lib/c64api.ts`
- **Config state and mapping**: `src/hooks/useAppConfigState.ts`, `src/lib/config/`
- **Song sources**: `src/lib/sources/` (local FS + HVSC)
- **HVSC ingestion + metadata**: `src/lib/hvsc/` (service/types/native bridge)
- **Native bridges**: `src/lib/native/`, `src/lib/hvsc/native/`
- **Android HVSC engine**: `android/app/src/main/java/com/c64/commander/hvsc/`
- **SID playback utilities**: `src/lib/sid/`

## Audio output: on-device playback and the A/V mirror share one native path

Both routes reach the speaker through the same native `AudioPipeline`. This is not a tidiness
preference — they sounded materially different when they did not, and the reasons are worth keeping.

**Timbre and loudness come from which AudioFlinger path is used, not from the SID emulation.**
On-device playback used to go out through Web Audio in the WebView, which lands on a _direct_ output
that bypasses the mixer's effect chain; on a Pixel 4 that chain is the speaker's own EQ and loudness
processing. Measured with a microphone at the speaker, same tune, same volume: Web Audio was 7.5 dB
quieter with **0.10%** of its energy in 120–300 Hz against the mirror's **3.33%**. Both declared
`AUDIO_CONTENT_TYPE_MUSIC` / `AUDIO_USAGE_MEDIA`; the difference was `Flags: 00004001` (MMAP/direct)
versus `00000004` (`AUDIO_OUTPUT_FLAG_FAST`). Before blaming a filter or a chip model for how
something sounds, check `dumpsys media.audio_policy` for which output the track actually got.

The SID settings were ruled out by measurement, twice, with two tools: the filter curve moved the
spectral distance from 0.160 to 0.164 dB across its whole range, `combinedWaveforms` changed nothing
at all, and the model default already in use was closer to the Ultimate than any alternative.

**Buffer deeply on the on-device path; do not try to be punctual.** The mirror never drops out
because its PCM arrives on a native receive thread and goes straight into the ring — JavaScript is
not in the delivery path. Web Audio had the same property for a different reason: once
`AudioBufferSourceNode.start(when)` is called, Chrome's audio thread owns playback and the JS thread
only had to be _early_. Pushing PCM across the Capacitor bridge puts JS back _in_ the delivery path,
on the same thread as the WASM renderer and the UI, where it has to be _punctual_. Several attempts
to fix the resulting stutter by adjusting punctuality — slice sizes, write lead times, estimating the
drain between writes — all failed, because punctuality was the wrong thing to adjust. What works is a
ring holding **seconds**, so JS only has to be roughly on time again.

Consequences to respect when touching this path:

- Writes cost per _call_, not per byte: a payload carrying 43 ms of audio cost 17 ms, one carrying
  1067 ms cost 36 ms. Small writes starve the pipeline.
- Never estimate the queue depth by subtracting elapsed time from your own last figure. That puts
  pacing back on `setTimeout` on a busy thread. Ask the pipeline (`readAudioStats`) instead.
- A deep ring makes pause, seek and track changes lag by its depth unless flushed —
  `flushAudioTrack` exists for exactly that.
- The pipeline's ring depth and `AudioTrack` buffer are parameters (`maxRingMs`, `trackBursts`), not
  constants: the mirror wants them shallow because depth is input latency, on-device playback wants
  them deep because nothing is waiting on it.

Going further would mean rendering the SID natively too (an NDK build of libsidplayfp), which would
remove JS from the path entirely, as it already is for the mirror.

## Build, test, and screenshot decision rules

This section exists to make agent behavior explicit.

### When no build is required

A build is not required when the task is truly `DOC_ONLY`, for example:

- only Markdown files changed
- only textual documentation changed
- only comments changed
- only non-executable prose or guidance files changed

In those cases, do not run builds for ceremony.

### When a build is required

A build is required when the task affects executable behavior or build outputs, for example:

- application code
- tests
- configuration that can affect runtime or build behavior
- assets that are packaged into the app
- generated outputs that are required to stay in sync

### When screenshots must be regenerated

Regenerate screenshots only when visible documented UI changed.

### When screenshots must not be regenerated

Do not regenerate screenshots when the visible documented UI is unchanged, even if internal code changed.

### Minimal screenshot rule

If a task changes only one page or one documented state, update only the corresponding screenshot files or folders under `docs/img/`.

Never refresh the entire screenshot corpus unless explicitly required by the task.

### CTA inventory upkeep (MANDATORY)

`docs/cta-inventory.md` is the authoritative, hierarchical inventory of every CTA
(interactive control) in the app and how each is reached/operated by keypad /
D-pad / T9. It is part of the keypad accessibility contract — a CTA that is not
in the inventory is treated as unverified.

You **must** update `docs/cta-inventory.md` in the **same change** whenever a CTA
or the CTA hierarchy changes, including when you:

- add, remove, rename, or change the `data-testid` of an interactive control;
- change a control's **type** (e.g. button → select, checkbox → slider);
- change focus **grouping/order/nesting** (`useFocusItem`/`useFocusGroup`,
  `data-section-label`, `data-focus-group`) or which scope a control lives in;
- add/remove a route/page, dialog, sheet, or menu that exposes controls;
- change a control's keypad reachability, activation, or default
  enabled/disabled state.

Keep the per-page counts in §3 and the per-page hierarchy in §4 consistent with
the code. The fastest check: re-run the on-device/DOM scope enumeration described
in §7 and reconcile any delta. A `UI_CHANGE` or `DOC_PLUS_CODE` task that touches
controls but leaves this file unchanged is **incomplete**. When in doubt, update
it — an over-listed control is cheaper than a missing one.

## Tests and fixtures

- **Unit**: `npm run test` (Vitest) with specs in `src/**` and `test/`
- **Coverage**: `npm run test:coverage`
- **E2E**: `npm run test:e2e` with specs in `playwright/` and fixtures in `playwright/fixtures/`
- **Android JVM**: `cd android && ./gradlew test` with tests in `android/app/src/test/java/com/c64/commander/hvsc/`
- **Android fixtures**: `android/app/src/test/fixtures/hvsc/`
- **Python agents**: `npm run test:agents` (pytest) with specs in `agents/tests/`; requires ≥90% branch coverage
- **Maestro**: read `docs/testing/maestro.md` before creating or updating flows under `.maestro/`

## Dependency and lockfile changes — validate with `npm ci`, never just `npm install`

Changing any dependency (adding, removing, or bumping in `package.json`) can
leave `package-lock.json` installable on **your** machine yet broken in CI.

Root cause seen in practice (PR #299): `npm install` on `linux-x64` **prunes
cross-platform OPTIONAL dependencies** from the lock — e.g. `@emnapi/core`/
`@emnapi/runtime` (required by `@rolldown/binding-wasm32-wasi`), or
platform-specific `sharp`/native binaries. `npm ci` on that same platform does
**not** notice the gap, so it looks fine locally; but `npm ci` on CI's other
platforms then fails with `Missing <pkg>@<version> from lock file`, breaking
**every** job at the install step (Web, Android, iOS, notices, variant — all of
them). A single-arch `npm install` is therefore an unsafe way to regenerate the lock.

After **any** dependency change you MUST:

- **Run `npm ci` (clean, strict install) before pushing — not just `npm install`.**
  `npm ci` is exactly what CI runs; it is the honest gate for `package.json` ↔
  `package-lock.json` sync. Passing `npm ci` locally is necessary but, because of
  the pruning above, **not sufficient** — also confirm the lock still contains the
  cross-platform optional entries a known-good lock had.
- Keep `package.json` and `package-lock.json` in exact sync; a bump in one
  requires the other.
- Treat the lock as cross-platform. Never leave it hand-pruned. If `npm install`
  drops optional entries that the last known-good lock contained, **restore them**
  so the lock is complete for all platforms. Prefer the **smallest honest delta**
  (only the intended bumps) over a full regeneration that reorders or prunes
  unrelated entries.
- Regenerate the notices (`npm run notices:check`) — dependency changes alter
  `THIRD_PARTY_NOTICES.md`.
- Prefer within-major bumps; hold framework-defining majors (React, Tailwind,
  Vite, Vitest, TypeScript, Zod, react-router) for a dedicated, separately
  validated change so a break is isolated and diagnosable.

## Release tag APKs

- CI builds a debug APK for all runs.
- Android Play upload is already operational.
- Tag builds still rely on signing secrets when a signed release artifact must be produced in CI.
- Release tags **drive the build version**: a tag may be created directly from the GitHub Releases UI (no `package.json` bump needed). `scripts/resolve-build-version.mjs` resolves the build identity from the tag (`GITHUB_REF_TYPE=tag`/`GITHUB_REF_NAME`), so the artifact is versioned as the tag regardless of `package.json`.
- `package.json` is the in-tree dev baseline. It does **not** need to equal the latest tag; it only needs to stay internally consistent with `package-lock.json` (enforced by `tests/unit/scripts/releaseVersionMetadata.test.ts`). Do not re-add a test that requires `package.json` to equal the Git tag — that breaks UI-created tag builds.

## Mandatory formatting and style reminders

### Prettier formatting

All TypeScript, TSX, and JSON files must be formatted with Prettier before committing.

- Config: `.prettierrc.json` (`singleQuote: true`; all other options are Prettier v3 defaults).
- **Check**: `npm run format:check:ts` (also runs as part of `npm run lint`).
- **Fix**: `npm run format:ts` (or `npx prettier --write .`).
- Every code change must already be Prettier-compliant when written.
- YAML files are checked separately via `npm run format:check:yaml`.

### Code style

- **DRY**: avoid duplication. Extract shared logic only when it improves clarity and current maintainability.
- **KISS**: prefer simple, explicit solutions.
- **Modularity**: keep files cohesive and responsibilities clear.
- **Readability first**: prefer clear naming over commentary.
- **Explicitness**: make configuration, defaults, and assumptions discoverable.
- **Fail fast**: validate inputs early and surface failures with context.
- **Determinism**: avoid hidden state and non-reproducible behavior unless explicitly required.
- **Testability**: structure code for unit and integration testing without excessive mocking.
- **No dead code**: do not leave unused code paths or speculative scaffolding.
- **Consistency**: follow existing project conventions.
- **Minimal dependencies**: add third-party libraries only when clearly justified.
- **Stable public surfaces**: keep public APIs minimal and intentional.

### Comments

A comment is a code smell. It signals the code failed to explain itself — a name
is wrong, a function does too much, or an abstraction is missing. The fix for an
unclear line is almost never a comment; it is clearer code. Before writing one,
refactor: rename the variable or function, extract a well-named helper, introduce
a type, or split the expression until the intent is self-evident. Reach for a
comment only after that has genuinely failed.

Delete (and never add) comments that:

- **restate the code** — `// increment i`, `// loop over devices`, `// return null`;
- **explain a name** that should have been clearer — fix the name instead;
- **justify a cast or workaround** — refactor so the workaround disappears or the
  cast becomes obviously sound, rather than defending it in prose;
- **narrate verbosely** — a multi-line paragraph describing what the next lines do
  is the strongest sign that block should become a named function;
- **pin a specific implementation detail** the next refactor will silently
  invalidate, leaving a comment that lies.

Worked example — a comment defending a type cast that the code should make
unnecessary:

```ts
// Bad: prose justifying the cast
export const createHvscCancellationError = (message = "HVSC update cancelled"): HvscCancellationError =>
  // Object.assign widens `code` to `string`; the runtime value is the literal code, so the
  // assertion to HvscCancellationError is sound.
  Object.assign(new Error(message), {
    code: HVSC_CANCELLATION_CODE,
    isCancellation: true as const,
  }) as HvscCancellationError;

// Good: build the typed value directly — no cast to defend, so no comment
export const createHvscCancellationError = (message = "HVSC update cancelled"): HvscCancellationError => {
  const error = new Error(message) as HvscCancellationError;
  error.code = HVSC_CANCELLATION_CODE;
  error.isCancellation = true;
  return error;
};
```

Narrow exceptions — keep these, but keep them tight:

- the license header atop each source file (required; never strip it);
- a genuine **why** that code cannot express: a non-obvious external constraint, a
  protocol/hardware quirk, a deliberate deviation, or a link to the bug/spec it
  satisfies. Push as much as possible into a named helper plus a regression test,
  and let the comment carry only the residual code cannot;
- doc comments on intentionally public API surfaces where the convention expects them.

When you touch a file, leave it with fewer comments than you found. Do not add a
comment to satisfy a reviewer — add the clarity the comment was standing in for.

## Mandatory exception handling (SHOWSTOPPER)

It is forbidden to catch an exception silently.

Whenever an exception is caught, do one of the following:

1. **Rethrow it**, enriched with context:
   - what operation was being performed
   - relevant identifiers, paths, or inputs
2. **Log it** at WARN or ERROR level:
   - full stack trace
   - context explaining what failed and why

Unacceptable patterns include:

- `catch (e) {}`
- `catch (e) { /* ignore */ }`
- `catch (e) { return null; }` without logging or rethrowing

Violating this rule is a release blocker.

## Mandatory error investigation

- Always investigate errors, warnings, and assertion failures.
- Fix root causes. Do not skip tests or suppress warnings.
- Keep the repository buildable. If changes break builds, fix them before declaring work complete.
- Exceptions must never be ignored; log them or let them bubble up.

## React effect/setState safety (infinite re-render & coverage-hang prevention)

A `setState` driven from an effect (or a callback the effect invokes) that feeds a
**referentially-unstable but value-equal** value, while that value is an effect
dependency, creates an infinite synchronous re-render loop. It pegs one CPU core
and **starves the event loop, so Vitest's test timeout never fires** — it surfaces
as an indefinite `npm run test:coverage` hang (one file/chunk never finishes), NOT
a failing test. Real regression: `src/pages/ConfigBrowserPage.tsx` fed `items`
(rebuilt fresh each render) straight into `setAudioConfiguredItems` during re-sync.

- **Never** set state from a value that may be a new reference each render when
  that value is also an effect dependency. Stabilize the reference (`useMemo` on
  the true inputs, or a ref), or guard the setter with a value-equality bail so
  React short-circuits: `if (equal(prev, next)) return;`.
- React-query `data` is referentially stable in production (structural sharing),
  but **hook mocks that return a fresh object each render are not**. Write the
  component so an unstable-but-equal upstream cannot loop it — the mock is the
  realistic adversary, not something to paper over in the test.
- A Vitest file/chunk that hangs with a worker pegged at ~100% CPU (and prints no
  further dots) is a synchronous render/compute loop, not an open handle. Bisect
  to the file, then the test/code path, and fix the loop at source — never add a
  timeout. Note: `timeout`-killing a hung run orphans tinypool worker children
  that keep spinning; `pkill -9 -f vitest` between bisect iterations.
- Treat `await refetch()` (and similar query results) defensively: use optional
  chaining (`refreshed?.data`); the result can be undefined in tests and edge cases.

## Mandatory bug-fix regression coverage

- Every bug fix must add or update a dedicated regression test that fails before the fix and passes after it.
- The regression test must target the specific edge condition, acceptance criterion, or failure mode being fixed.
- Test names must describe the locked-in behavior precisely.
- If a fix spans multiple layers, add the narrowest deterministic test at each affected layer instead of relying on a single broad integration test.

## Mandatory coverage gate before completion

- For any plan/task that includes code changes, run `npm run test:coverage` before declaring completion.
- The run must satisfy a safety margin of at least **91% branch coverage** globally.
- If branch coverage is below 91%, continue adding meaningful tests until it is `>= 91%`.
- For changes under `agents/`, also run `npm run test:agents` and confirm `>= 90%` branch coverage.
- Global coverage is necessary but not sufficient for PR convergence. You must also verify **changed-line (patch) coverage** for the current branch.
- Never infer patch coverage from global totals. Use the CI/Codecov patch report or a local changed-line check against merged coverage output.
- If patch coverage fails, treat it as a blocker even when global branch coverage is above 91%.
- Minimize formatting-only churn in executable files because it creates extra patch lines that must be covered.

### Exception: fast local Android deploy loop

- If the user prompt explicitly includes `FAST_ANDROID_DEPLOY`, `fast deploy`, `quick deploy`, `deploy to device`, `device loop`, `device test`, or `no-coverage deploy`, treat it as a local device-debug workflow.
- In that workflow, skip tests, coverage, lint, and screenshot regeneration unless the user explicitly asks for them.
- Prefer `./build --skip-tests --install-apk` and let the build helper auto-select the attached device unless multiple devices are present.
- If the user establishes an ongoing preference for this workflow, keep using the fast deploy path after each completed task until the user explicitly asks to run tests or widen validation.
- This exception exists only to optimize local deploy/debug turnaround.
- When the user invokes `.github/prompts/pr-converge.prompt.md`, the exception no longer applies and full validation plus coverage are mandatory again.

### Exception: Ralph / Productionization HIL loop

When the active prompt is a Ralph, productionization, hardening,
device-stabilization, Pixel 4 HIL, droidmind, c64scope, or no-coverage device-loop
prompt, do not run `npm run test:coverage` merely because code changes exist.

For these loops:

- Pixel 4 HIL evidence is the primary deliverable.
- Targeted regression tests are required for confirmed code defects.
- Coverage and changed-line coverage are finalization or PR-convergence gates only.
- Do not run coverage while a HIL-capable process is active or while HIL deliverables
  remain open.
- If this provider lacks droidmind/c64scope and another process owns the HIL window,
  do not select code/build/coverage validation work. Update handoff state if needed,
  then stop or schedule the peer-enabled continuation.
- Run coverage only when the selected objective is explicitly final PR/release
  convergence, the user explicitly asks for coverage, or all current HIL deliverables
  are complete or explicitly blocked.

## Mandatory handling of concurrent changes

- If unexpected changes appear in the worktree, keep them as-is and continue.
- Assume they may have been created by a concurrently running LLM unless the task explicitly proves otherwise.

## Output wording rules

- Keep wording short.
- Describe only the current state of documents when changing them.
- Do not claim builds, tests, or screenshot refreshes you did not actually perform.

## Golden trace stewardship

When modifying Playwright tests, REST routing, or tracing logic:

1. Detect changes that affect trace semantics (order, payloads, endpoints, or normalization).
2. If trace semantics change, re-run golden trace recording locally.
3. Commit updated golden traces under `playwright/fixtures/traces/golden`.
4. Never weaken trace assertions to make tests pass; fix the root cause instead.

## Fast path (before a PR)

### Platform build scope

- Only Android can be built locally.
- For iOS, rely on CI (macOS runners) for build and validation.

### Install dependencies

```bash
npm install
```

### Build and test (web)

Use the subset that matches the task. Typical baseline for executable changes:

```bash
npm run test
npm run lint
npm run build
```

### Build and sync Android (local)

```bash
npm run cap:build
```

Set `JAVA_HOME` to a valid JDK install and avoid hardcoded system paths.

### Full local helper (if applicable)

```bash
./build --install-apk
```

## What to optimize for

- responsive UI and clear feedback
- stable network interactions with the C64U
- test reliability and clean error reporting
- minimal, accurately scoped changes
- disciplined screenshot maintenance

## Exploratory investigations

- For Android exploratory or regression investigations, assume a local Android handset is attached over adb and a live C64 Ultimate is reachable.
- **Device preference order**: prefer `u64` (Ultimate 64 Elite, hostname `u64`) over `c64u` (Commodore 64 Ultimate , hostname `c64u`). Always probe `u64` first.
- Probe both `u64` and `c64u` over REST at `http://u64/v1/info` and `http://c64u/v1/info` before device-flow validation.
- If `u64` is reachable, use it. Fall back to `c64u` only if `u64` is unreachable.
- Prefer proving Android/device fixes against a real-device path before treating emulator-only evidence as sufficient.
- For hardware-backed validation, use the adb-attached Pixel 4 when it is present.
- Record which hardware target was chosen and do not claim device validation when neither host is reachable.

## Debugging a signal: measure the wire before you read the code

When something _sounds_, _looks_ or _feels_ wrong on a device — audio, video, input latency — measure
the signal at its source before forming a theory about the code. A whole afternoon went into a
"streamed audio is rough" report that was diagnosed from the code four different ways (ordering on
the real-time thread, buffer priming, sample-rate mismatch, channel mismatch) and was none of them.
Five minutes of `socket.recvfrom` on the multicast group had the answer:

    250 pkt/s expected · 500 observed · two interleaved 16-bit sequence counters

**Two Ultimates were streaming into the same multicast group.** Every packet arrived, in order, with
zero loss _from each sender's point of view_, so nothing in the receive path looked wrong.

Rules that follow from it:

- **Count what arrives first.** Packet rate, payload size, and the implied sample rate against the
  expected one. `tools/hil/` has the harnesses; a ten-line `recvfrom` loop is often faster.
- **A/B by removing senders, not by editing code.** Stop the stream on _every_ machine, then start
  one, and measure again.
- **Sequence deltas name the fault.** All `+1` = a clean single sender. Two alternating large deltas
  summing to ~65536 = two senders sharing a group, not packet loss.
- **The multicast groups are shared by every Ultimate** (`239.0.1.64:11000` video,
  `239.0.1.65:11001` audio). A device keeps streaming until something asks it to stop — surviving
  app restarts, device switches and crashes. Suspect an orphaned stream early. See
  [[live-view-device-switch-clean-transition]].
- **Check the phone is awake and foregrounded before concluding anything about async behaviour.** A
  dozing WebView freezes timers and promises, which reads exactly like a hung native plugin: in the
  same session `StreamUdp.bind()` "never resolved" for 90 s purely because the screen was off.
- **Zero underruns does not mean healthy audio.** An over-full buffer never underruns; it silently
  discards what it cannot accept. If a counter can only show starvation, add the one that shows
  overflow before trusting either.

## Build an exact instrument when the complaint is subjective

"It sounds rough" cannot be graded against real music, whose spectrum moves constantly — a
correlation score says only that _something_ differs. `tools/hil/make_tone_ladder_sid.py` emits a
307-byte PSID playing a known C3→C4→C3 ladder that also steps the screen colour in unison with the
notes, and `analyse_tone_ladder.py` reports per-note pitch error in cents and per-note duration.
That turns "rough" into "notes are 0.965 s instead of 0.500 s", which points at a rate problem in
one reading. Prefer building that instrument early over another round of reasoning about the code.

### Calibrate the instrument before you trust it

An instrument that has not been checked against a known-good signal will report faults that are its
own. Every one of these was a _measurement_ bug that looked exactly like a device bug:

- **AC-couple before measuring level.** Gating the SID leaves a DC step, and through the chip's DC
  blocker it rings for ~0.6 s at about 1 Hz. Unweighted that ring measured -13 dBFS — louder than
  half the ladder — so a plain RMS envelope scored it as a note and its click as the onset, and the
  whole ladder mis-aligned. A 2nd-order high-pass at 60 Hz costs the lowest note 0.2 dB. This is why
  ITU-R BS.1770's K-weighting starts with a high-pass; treat it as mandatory, not as polish.
- **Check the reference, not just the reading.** Notes measured a rock-solid 499.0 ms against an
  "expected" 500. The signal was right and the expectation was wrong: PAL is 985248/19656 =
  50.1245 Hz, so 25 frames is 498.76 ms. A constant 1 ms bias, invented by the measurement.
- **Reference a threshold to the thing you are measuring.** Half-rise between the note and the
  preceding floor made onset placement depend on how quiet the _previous_ slot was, so notes after a
  silence were called tens of ms early. Half power below the note's own plateau is the same place on
  every attack.
- **A filter that happens to hide a problem is not a fix.** A `>= 0.12 s` length filter was silently
  discarding spurious onsets. Replacing it with an explicit "a note sustains, a click does not" gate
  fixed the real defect; the accidental filter would have hidden the next one.

Validate against `sidplayfp` renders and a 6502 trace of the player (a ~90-line simulator over the
handful of opcodes involved proves colour and note writes land on the same frame) _before_ pointing
the instrument at hardware. Grade against published standards — ITU-R BT.1359-1 for A/V sync,
BS.1770/EBU R128 for level — so the verdict means something outside this repo, and report median
with IQR rather than a bare mean so one dropout cannot move the headline.

## The hardware that exists — and the Callback 8020, which does not

**The available rig is exactly: the Pixel 4 (adb), the C64U, and the U64.** That is all
of it. Plan every gate, task and acceptance criterion against that list.

**The Callback 8020 does not exist yet.** It is an unreleased handset. Neither it nor
SailfishOS can be tested on, now or by waiting — so:

- **The Pixel 4 stands in for every phone**, the 8020 included. A result proven on the
  Pixel 4 is the phone-side result; report it as measured on the Pixel 4 and move on.
- **Never write a task, gate or "remaining work" item whose venue is the 8020.** Such an
  item is not blocked, it is unrunnable, and it has repeatedly been re-created and
  re-carried across sessions as though hardware were about to arrive.
- Where a spec names the 8020 (e.g. keypad-first / low-power sizing), treat it as a
  _design constraint to build for_, not a device to measure on: satisfy it by
  construction, prove what is provable on the Pixel 4, and say plainly which part is
  unverifiable until the handset ships.
- The same applies to the `c64u-remote` variant's manual, which names the 8020 as the
  target handset: writing for it is fine, testing on it is not.

Physically power-cycling the C64 is a rare, ask-first exception; the U64 may be absent,
so probe it rather than assuming.

## Modularization guardrails

- If a file grows beyond about 600 lines or mixes concerns, split it.
- If a file approaches 1000 lines, refactoring is expected unless there is a strong documented reason not to.

## Manual authoring — the two-manual split and device terminology

The user manual is **generated** by `scripts/build-manuals.mjs` (`npm run manuals:build`) into `docs/manual/<variant>/…` (the `.md` is tracked; the `.pdf`/`.last-build` are git-ignored). It is emitted once **per variant**, and the two editions have deliberately different scope — write for the right one via the naming helpers, never hard-coded device names.

- **C64 Commander** (`c64commander` variant, `variant.id !== "c64u-remote"`) — the **broad** edition. The controlled machine is **the Ultimate-family device** and covers the **Commodore 64 Ultimate**, the **Ultimate 64 / Elite / Elite II**, and the **Ultimate-II+(L)** — the last being a cartridge that lacks streaming, joystick relay, and other Ultimate-only features, so never assert those unconditionally here. The app runs on a **phone, tablet, or self-hosted web** build (iOS/Android/web).
- **C64U Remote** (`c64u-remote` variant) — the **specific** edition for a **Commodore 64 Ultimate** driven by a compact keypad **phone**. The exact phone model (currently the Callback 8020) is named **once**, in "Before You Start", then left implicit — do not repeat it, so the manual survives new supported handsets.

**Device terminology — one machine, named consistently:**

- The controlled machine is **one device**. The C64 Ultimate (and its siblings) **is** the C64 — never write "the Ultimate" and "the C64" as if they were two separate things (e.g. _"the Ultimate can send what your C64 is doing"_ is wrong).
- Refer to the running machine as **"your C64"** for what it does (memory, screen, sound, drives, streams, printer emulation), and as **`targetDeviceShortName(variant)`** ("the connected Ultimate-family device" / "the Commodore 64 Ultimate") only where the **hardware/model or connection** genuinely matters (compatibility, firmware, password, network setup).
- Use **`appDeviceName(variant)`** ("phone or tablet" / "phone") for the device running the app, and precise **model names** (Commodore 64 Ultimate, Ultimate 64 Elite II, Ultimate-II+(L)) only in firmware/compatibility passages.
- New manual prose must go through these helpers, not literal device names. The `buildManuals` unit test enforces some of this (e.g. the broad edition must not name the specific phone).

**Live View** is a first-class chapter (In Depth → "Live View", 6.2, right after Remote Input), not a Content-Explorer sub-section. Keep the immersive keypad keystroke table (pan/zoom/fit/mode) accurate to `RemoteInputSheet`'s `handlePhysicalKeyDown` mapping.
