# Agent Guide

This repository is **C64 Commander**, a React + Vite + Capacitor app for managing and
controlling a C64 Ultimate device.

`REVIEW.md` defines _what good looks like_ (review standards, severity, verification,
repository-specific hazards); this file defines _how to execute and validate_. Read
`REVIEW.md` before writing code — the best problem is the one prevented at the keyboard.

## Contents

1. [Non-negotiables](#non-negotiables)
2. [Precedence and where things live](#precedence-and-where-things-live)
3. [Execution model](#execution-model)
4. [Validation: what to run, and what CI actually runs](#validation-what-to-run-and-what-ci-actually-runs)
5. [Hardware in the loop](#hardware-in-the-loop)
6. [UI requirements](#ui-requirements)
7. [Screenshots](#screenshots)
8. [Code style](#code-style)
9. [Subsystem knowledge earned on hardware](#subsystem-knowledge-earned-on-hardware)
10. [Dependencies, release identity, and the manual](#dependencies-release-identity-and-the-manual)

## Non-negotiables

These are the rules whose violation has cost hardware, hearing comfort, or a release.
Each is stated in full here and not restated elsewhere.

### Never raise the Pixel 4's media volume above 10 of 25

**Hard limit. 10 is the maximum the device may ever be set to, for any reason.**

Someone sits next to that phone and listens to it directly. This rule exists because an agent
raised the volume from 14 to 23 to improve the signal-to-noise ratio of a microphone measurement,
and had to be stopped: "This is much too loud. I cannot deal with such volume." It is a comfort and
hearing-safety constraint, so it outranks any measurement that would be easier with more level.

If you change it at all, restore it to 10 or below immediately and say so in your report.
`tools/hil/merge_gate.mjs` enforces the ceiling (`MAX_VOLUME = 10`) and runs its audible stages at
5 of 25 (`--volume`). Measuring at that level works — see
[Audio discipline](#audio-discipline) for the band-limiting that makes it work.

### Never wedge the device

- **Single-item config writes go over `PUT /v1/configs/{cat}/{item}?value=`, never the
  body-buffering `POST /v1/configs` batch path.** See `REVIEW.md` §2 for why.
- **A `Turbo Control` + CPU-speed batch is split into sequential single-item writes.** A
  CPU-Speed config write drops the network while the firmware applies the clock change;
  combined POSTs coincided with the Ultimate dropping off the network mid-write twice
  (BUG-010 on u64 3.14e, and on c64u 1.1.0). The split lives in `src/lib/c64api.ts`
  (`U64_TURBO_CONTROL_ITEM`, `U64_CPU_SPEED_DEPENDENT_ITEMS`) and is locked in by
  `tests/unit/c64api.test.ts`. Do not re-merge those writes into one request.
- If a device "goes flaky" during a change, suspect the app's request pattern first and
  root-cause it before blaming the hardware.

### Never catch an exception silently

Whenever an exception is caught, do one of the following:

1. **Rethrow it**, enriched with context: what operation was being performed, and the
   relevant identifiers, paths, or inputs.
2. **Log it** at WARN or ERROR level, with the full stack trace and context explaining
   what failed and why.

Unacceptable: `catch (e) {}`, `catch (e) { /* ignore */ }`, and
`catch (e) { return null; }` without logging or rethrowing. Violating this is a release blocker.

### Always investigate errors, warnings and assertion failures

Fix root causes. Do not skip tests or suppress warnings. Keep the repository buildable: if
your change breaks a build, fix it before declaring the work complete.

### Every bug fix ships a regression test that fails without the fix

- The test must target the specific edge condition, acceptance criterion, or failure mode.
- Test names must describe the locked-in behavior precisely.
- If a fix spans multiple layers, add the narrowest deterministic test at each affected
  layer instead of one broad integration test.
- Revert the fix and watch the test fail. See
  [A test that does not fail without the fix is not a test](#a-test-that-does-not-fail-without-the-fix-is-not-a-test).

### Leave concurrent changes alone

- If unexpected changes appear in the worktree, keep them as-is and continue.
- Assume they may have been created by a concurrently running LLM unless the task
  explicitly proves otherwise.

### Report only what you actually did

- Keep wording short.
- Describe only the current state of documents when changing them.
- Do not claim builds, tests, or screenshot refreshes you did not actually perform.

## Precedence and where things live

### Rule precedence

1. **Quality bar (what every change must satisfy)**: `REVIEW.md` (repo root)
2. **Entry index**: `.github/copilot-instructions.md`
3. **Execution manual (this file)**: `AGENTS.md`
4. **Task-specific user prompt**

If instructions conflict, the narrower, safer rule wins, and a task prompt may narrow
scope only without violating `REVIEW.md`.

### Read before acting

Read the smallest relevant set first, and understand the touched subsystem and its
validation expectations before changing anything:

1. `README.md` — overview, local build steps, Android notes.
2. `REVIEW.md` — the quality bar every change is held to.
3. `.github/copilot-instructions.md` — the entry index.
4. `docs/ux-guidelines.md` — before any UX work.
5. `docs/testing/maestro.md` — before authoring or editing Maestro flows under `.maestro/`.
6. `docs/c64/c64u-telnet.yaml` — before any Telnet-related change; it is the Telnet
   menu source of truth.
7. Additional files directly relevant to the touched area.

### Where things live

| Subject                       | Path                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------- |
| App entry                     | `src/main.tsx`, `src/App.tsx`                                                     |
| UI                            | `src/pages/`, `src/components/`, `src/components/ui/`                             |
| Navigation                    | `src/components/TabBar.tsx`, `src/lib/navigation/`                                |
| Hooks and data fetching       | `src/hooks/`, `src/lib/c64api.ts`                                                 |
| App config state and mapping  | `src/hooks/useAppConfigState.ts`, `src/lib/config/`                               |
| Song sources                  | `src/lib/sources/` (local FS + HVSC)                                              |
| HVSC ingestion and metadata   | `src/lib/hvsc/`                                                                   |
| Native bridges                | `src/lib/native/` (including the HVSC bridge, `src/lib/native/hvscIngestion.ts`)  |
| Android HVSC engine           | `android/app/src/main/java/uk/gleissner/c64commander/hvsc/`                       |
| SID playback utilities        | `src/lib/sid/`, `src/lib/playback/`                                               |
| Streams (Live View)           | `src/lib/streams/`                                                                |
| REST API spec, U64 family     | `docs/c64/devices/u64e/3.15alpha/u64e-openapi.yaml` (C64U/U64/U64E2)              |
| REST API spec, U2             | `docs/c64/devices/u2/3.14a/u2-openapi.yaml`                                       |
| Telnet menu reference         | `docs/c64/c64u-telnet.yaml`                                                       |
| CTA inventory and keypad map  | `docs/cta-inventory.md`                                                           |
| Hardware merge gate           | `tools/hil/`, `docs/testing/hil-merge-gate.md`                                    |

Gate U64-family-only surfaces such as Streams and `machine:input` on runtime
capabilities; U2 has no Streams, Input, or poweroff.

## Execution model

Follow this sequence unless the task explicitly requires something narrower. It starts
after [Read before acting](#read-before-acting).

### Phase 1 — Classify the change

Classifying before you build, test, or regenerate screenshots is mandatory, because the
classification controls whether a build is needed, which suites run, whether screenshots must be regenerated, and
which docs must be updated. Apply the **smallest validation set that honestly matches the
change**. The commands themselves are in
[Validation](#validation-what-to-run-and-what-ci-actually-runs).

- **`DOC_ONLY`** — only non-executable docs/prose change (`*.md`, doc comments,
  README/doc updates, guidance files not executed by tooling).
  - Required: verify docs are accurate and internally consistent, fix cross-references,
    keep formatting clean.
  - Do **not** run builds, tests, Android build/sync, or screenshot regeneration unless
    the task explicitly requires it.
- **`CODE_CHANGE`** — affects executable code, build scripts, config, tests, or runtime
  assets (`src/`, `android/`, `agents/`, `package.json`, `vite.config.*`, Playwright /
  Maestro / Vitest / Gradle / Python test code).
  - Run the validation relevant to the touched layer(s). Do **not** regenerate
    screenshots for non-visible changes.
- **`UI_CHANGE`** — affects visible rendered UI, navigation, labels, layout, controls,
  icons, colors, or screenshots.
  - Run the `CODE_CHANGE` baseline plus the smallest UI validation that proves the change
    (`npm run test:e2e`, `npm run cap:build`), and regenerate **only** the screenshots for
    surfaces whose visible output actually changed.
- **`DOC_PLUS_CODE`** — both docs and executable code changed; treat as a code change and
  also update the relevant docs.

A build is **not** required when only Markdown, textual documentation, comments, or other
non-executable prose changed. Do not run builds for ceremony. A build **is** required when
the change touches application code, tests, configuration that can affect runtime or build
behavior, assets packaged into the app, or generated outputs that must stay in sync.

### Phase 2 — Map impact before editing

Identify exactly which surfaces are affected: source files, tests, docs, screenshot folders
under `docs/img/`, and the runtime platforms (web, Android, iOS CI-only). Prefer a minimal,
explicit impact map over broad speculative edits.

### Phase 3 — Implement with minimal scope

Make the smallest coherent change that fully satisfies the task.

- keep repository conventions
- avoid speculative abstraction
- do not widen scope without a concrete reason
- preserve determinism and diagnosability
- add regression tests for bug fixes

### Phase 4 — Stabilize on the real target first

For productionization, hardening, exploratory regression, or device-stabilization tasks, do
not spend the main execution window on broad builds, full-suite tests, or coverage before the
user-facing device deliverables are actually working on the Pixel 4.

1. Reproduce and stabilize the behavior on the Pixel 4.
2. Choose the Ultimate per [Device preference](#device-preference).
3. If the chosen Ultimate becomes unavailable during testing, assume first that app-driven
   traffic from the Pixel 4 may have caused it. Stop further traffic to it, preserve
   app/request diagnostics, and root-cause the request pattern before treating the device
   as externally flaky.
4. Add focused regression tests for confirmed code defects as the fixes are made.
5. Run full tests and coverage only after the core device deliverables are done or
   explicitly paused/blocked.

### Phase 5 — Validate honestly

Run the smallest validation set the classification requires. For
productionization/device-stabilization runs, broad suites and coverage are finalization
gates, not a substitute for real Pixel 4 evidence.

### Phase 6 — Deploy the latest APK before completion

Before declaring any task complete, deploy the most recent built APK from
`android/app/build/outputs/apk/` to the attached Pixel 4.

- Prefer the adb-attached Pixel 4 with serial prefix `9B0` when it is present.
- Attempt installation of the newest APK first.
- If installation fails because an earlier installed copy blocks the update, uninstall the
  existing `uk.gleissner.c64commander` package from that Pixel 4 and retry. **Do this through
  droidctl** (`droid_app.install_app`, `droid_app.uninstall_app`) — see
  [Device automation goes through droidctl](#device-automation-goes-through-droidctl-never-raw-adb).
  `install_app`'s `allowDowngrade` will not, by itself, get past `INSTALL_FAILED_VERSION_DOWNGRADE`
  on a retail/`user`-build phone (only a `userdebug` device honors that flag from either client);
  `uninstall_app` then `install_app` is the correct sequence there, same as any other device.
- Launch the newly deployed build and validate the user-visible behavior there for the
  touched feature area before closing the task.
- Record the deployment and on-device validation result in the completion summary. Do not
  claim the work is finished until this has succeeded or a concrete hardware/adb blocker is
  documented.

### Phase 7 — Version identity must match Git

The app version shown by built APK/IPA artifacts and in-app diagnostics must be derived from
the latest Git tag plus the current Git commit ID (`scripts/resolve-build-version.mjs`). Do
not let `package.json`, Gradle defaults, Xcode defaults, or stale environment values produce
a different displayed version from the source revision being built.

### Phase 8 — Report precisely

At completion, summarize:

- what changed
- which tests/builds were run
- which screenshot files or folders were updated, if any
- why broader validation or screenshot refresh was not needed, when relevant

## Validation: what to run, and what CI actually runs

### Platform build scope

- Only Android can be built locally.
- For iOS, rely on CI (`.github/workflows/ios.yaml`, macOS runners) for build and validation.

### The commands

```bash
npm ci                 # install; NOT `npm install` — see Dependency and lockfile changes
npm run lint           # format:check:ts + eslint + typecheck + generated-artifact drift checks
npm run test           # Vitest: tests/unit/**, tests/contract/**, src/**/*.test.*
npm run build          # Vite production build
npm run cap:build      # build + Capacitor sync (Android)
./build --install-apk  # full local helper: build, then install on the attached device
```

Set `JAVA_HOME` to a valid JDK install and avoid hardcoded system paths.

Targeted suites:

| Suite            | Command                              | Location                                                |
| ---------------- | ------------------------------------ | ------------------------------------------------------- |
| Unit + contract  | `npm run test`                       | `tests/unit/`, `tests/contract/`, `src/**/*.test.*`      |
| Unit coverage    | `npm run test:coverage`              | unit only — see [Coverage gates](#coverage-gates)        |
| E2E              | `npm run test:e2e`                   | `playwright/`, fixtures in `playwright/fixtures/`        |
| Android JVM      | `cd android && ./gradlew test`       | `android/app/src/test/java/uk/gleissner/c64commander/`   |
| Android fixtures | —                                    | `android/app/src/test/fixtures/hvsc/`                    |
| Python agents    | `npm run test:agents`                | `agents/tests/` (pytest, `fail_under = 90` branch)       |
| HIL analysis     | `python3 -m pytest tools/hil/tests/` | `tools/hil/tests/` (needs `numpy`)                       |
| c64scope         | `npm run scope:test`                 | `c64scope/`                                              |
| Maestro          | `npm run test:e2e:native`            | `.maestro/` — read `docs/testing/maestro.md` first       |

### What CI actually runs

Workflows live in `.github/workflows/`. Read them before claiming CI covers something.

- **`npm run lint` is run by no workflow, and by no git hook.** Neither is `eslint`,
  `npm run format:check`, nor any of the generated-artifact drift checks that `lint`
  chains. Nothing catches a lint or formatting regression for you — run it yourself
  before pushing.
- CI does run `npm run typecheck` (`web-unit` job in `android.yaml`).
- The web unit/E2E/screenshot/coverage jobs live in **`android.yaml`**, not `web.yaml`.
  `web.yaml` covers the Docker web-platform image and its smoke tests.
- CI installs with `npm ci`, in every job.
- CI runs the Android unit tests as `./gradlew testDebugUnitTest jacocoTestReport`, which
  is narrower than the local `./gradlew test`.
- CI also runs the c64scope suite and `pytest tools/hil/tests/`, which are easy to forget
  locally.
- The `notices` job runs `npm run notices:generate`, then `npm run notices:check`, then
  `bash scripts/package-third-party-notice.sh --check`, and fails on drift.
- `.github/workflows/manual.yaml` typesets the manual and attaches it to a release.
- The git hooks in `.githooks/` add nothing: `pre-commit` only runs
  `scripts/revert-identical-pngs.mjs`, and `pre-push` delegates to an optional,
  untracked machine-local hook and otherwise exits 0.

### Coverage gates

- For any plan/task that includes code changes, run coverage before declaring completion.
- **`npm run test:coverage` is unit-only.** It sets its own Vitest thresholds to 0 and
  enforces nothing. It is not the CI gate.
- **The CI gate is 91% lines and 91% branches on the merged unit + E2E LCOV.** It is
  `scripts/check-coverage-threshold.mjs` with `COVERAGE_MIN=91 COVERAGE_MIN_BRANCH=91
  COVERAGE_FILE=coverage/lcov-merged.info`, run by the `web-coverage-merge` job. Reproduce
  it locally with `npm run coverage:gate` (which runs `npm run test:coverage:all` first,
  i.e. unit + instrumented build + E2E + merge).
- For changes under `agents/`, also run `npm run test:agents`; `agents/pyproject.toml` sets
  `fail_under = 90` on branch coverage.
- Global coverage is necessary but not sufficient for PR convergence. **Changed-line (patch)
  coverage is a separate gate**: `codecov.yml` sets both project and patch targets to
  **0.91** with a 0% threshold, and `if_not_found: error` on patch.
- Never infer patch coverage from global totals. Use the Codecov patch report or a local
  changed-line check against the merged coverage output.
- If patch coverage fails, treat it as a blocker even when global coverage is above 91%.
- Minimize formatting-only churn in executable files: it creates extra patch lines that
  must be covered.

### Exception: fast local Android deploy loop

- If the user prompt explicitly includes `FAST_ANDROID_DEPLOY`, `fast deploy`, `quick deploy`, `deploy to device`, `device loop`, `device test`, or `no-coverage deploy`, treat it as a local device-debug workflow.
- In that workflow, skip tests, coverage, lint, and screenshot regeneration unless the user explicitly asks for them.
- Prefer `./build --skip-tests --install-apk` and let the build helper auto-select the attached device unless multiple devices are present.
- If the user establishes an ongoing preference for this workflow, keep using the fast deploy path after each completed task until the user explicitly asks to run tests or widen validation.
- This exception exists only to optimize local deploy/debug turnaround.
- When the user invokes `.github/prompts/pr-converge.prompt.md`, the exception no longer applies and full validation plus coverage are mandatory again.

### Exception: Ralph / Productionization HIL loop

When the active prompt is a Ralph, productionization, hardening,
device-stabilization, Pixel 4 HIL, droidctl, c64scope, or no-coverage device-loop
prompt, do not run `npm run test:coverage` merely because code changes exist.

For these loops:

- Pixel 4 HIL evidence is the primary deliverable.
- Targeted regression tests are required for confirmed code defects.
- Coverage and changed-line coverage are finalization or PR-convergence gates only.
- Do not run coverage while a HIL-capable process is active or while HIL deliverables
  remain open.
- If this provider lacks droidctl/c64scope and another process owns the HIL window,
  do not select code/build/coverage validation work. Update handoff state if needed,
  then stop or schedule the peer-enabled continuation.
- Run coverage only when the selected objective is explicitly final PR/release
  convergence, the user explicitly asks for coverage, or all current HIL deliverables
  are complete or explicitly blocked.

## Hardware in the loop

### Device automation goes through droidctl, never raw adb

**For all Android device work, `droidctl` is the interface. Not raw `adb`, not a hand-rolled
wrapper script.** This is what PR #400 ("Migrate every caller to droidctl and retire the
third-party device server") established, and it is easy to violate by accident: several
existing docs and skills still describe raw `adb` invocations because they predate `droidctl`,
and `droidctl`'s own tool surface covers more than it looks like at a glance
(`droid_app.install_app` / `uninstall_app` with `allowDowngrade` / `tolerateMissing`, not just
launch/stop).

Load the `droidctl` skill before any Android device task — it is the single canonical reference
and states the policy in one place instead of scattering it. If a task genuinely needs a raw
`adb` call because `droidctl` has no equivalent (rare — `droid_device.run_shell` is itself a
`droidctl` call and covers most gaps), say so explicitly and name what's missing; do not
silently drop to `Bash` + `adb` because it is the reflex. `docs/agentic/hil-rc4/taptid.sh` and
similar locally-generated, git-ignored helper scripts predate `droidctl` and still shell out to
raw `adb` internally — that is a known gap in local scratch tooling, not sanctioned guidance to
follow elsewhere.

One thing `droidctl` cannot do: evaluate JavaScript inside the app's WebView over CDP (use `node
scripts/bughunt-cdp.mjs eval`, per the `hil-attach` skill) — this is the one place raw tooling
outside `droidctl` is expected, not a loophole.

### The hardware that exists — and the keypad handset, which does not

**The available rig is exactly: the Pixel 4 (adb), the C64U, and the U64.** That is all
of it. Plan every gate, task and acceptance criterion against that list.

**The compact keypad handset the `c64u-remote` variant targets does not exist yet.** It
is unreleased and cannot be tested on, now or by waiting — so:

- **The Pixel 4 stands in for every phone**, that handset included. A result proven on
  the Pixel 4 is the phone-side result; report it as measured on the Pixel 4 and move on.
- **Never write a task, gate or "remaining work" item whose venue is that handset.** Such
  an item is not blocked, it is unrunnable, and it has repeatedly been re-created and
  re-carried across sessions as though hardware were about to arrive.
- Where a spec assumes it (e.g. keypad-first / low-power sizing), treat that as a
  _design constraint to build for_, not a device to measure on: satisfy it by
  construction, prove what is provable on the Pixel 4, and say plainly which part is
  unverifiable until the handset ships.
- The same applies to the `c64u-remote` variant's manual: writing for a keypad handset is
  fine, testing on one is not.

Physically power-cycling the C64 is a rare, ask-first exception; the U64 may be absent,
so probe it rather than assuming.

### Device preference

Two rules apply, and they are scoped to different work. Do not generalize either one.

- **HIL merge-gate and device-stabilization runs target `c64u`.** That is the default host
  of `tools/hil/merge_gate.mjs` (`--host`, default `c64u`), and the reference numbers in
  `docs/testing/hil-merge-gate.md` were taken there.
- **General Android exploratory and regression investigations probe `u64` first.** Probe
  both over REST at `http://u64/v1/info` and `http://c64u/v1/info` before device-flow
  validation; use `u64` (Ultimate 64 Elite, hostname `u64`) if it answers, and fall back to
  `c64u` (Commodore 64 Ultimate, hostname `c64u`) only if it does not.

For all device work: assume a local Android handset is attached over adb and a live C64
Ultimate is reachable; use the adb-attached Pixel 4 for hardware-backed validation when it
is present; prefer proving Android/device fixes against a real-device path before treating
emulator-only evidence as sufficient; record which hardware target was chosen; and do not
claim device validation when neither host is reachable.

### The hardware merge gate

Some of what this app does cannot be checked anywhere but on the rig: a held joystick direction
reaching a real CIA, a tone ladder coming out of a real speaker, the latency of a real Wi-Fi link.
Every one of those has shipped broken while CI was green.

**Whenever the user asks to "complete a PR", converge a PR, make something merge-ready, ship, or
release, run the hardware merge gate and report its table:**

```bash
node tools/hil/merge_gate.mjs --host c64u --iface <this host's LAN ip> --json artifacts/hil-gate.json
```

See `docs/testing/hil-merge-gate.md` for what each stage asserts and the reference numbers
from this rig.

- Green CI is necessary and not sufficient for a change to input relay, Live View, audio, playback
  or the streaming pipeline.
- Nine stages are wired: `preflight`, `input`, `search-latency`, `wire`, `av-clarity`,
  `av-latency`, `sid-remote`, `sid-local`, `crossfade`. The three playback stages
  (`sid-remote`, `sid-local`, `crossfade`) need two generated tone tunes in the app's
  playlist and a microphone close enough to the grille to grade them; they report
  `TOO QUIET TO GRADE` rather than a pipeline defect when the level is not there.
- If no rig is attached, say that plainly in the PR and in the completion summary, and name the
  stages that were not run. Do not describe the work as verified.
- `--quiet-check` runs everything that makes no sound, for iterating without disturbing anyone.
- `--only <stage,stage>` runs a subset. Baseline the base commit with `--only` before
  blaming a stage failure on your own branch.

### Audio discipline

Every audio measurement is heard by whoever is working next to the Pixel 4, and runs last
minutes and repeat dozens of times. The volume ceiling of 10 of 25 is a
[non-negotiable](#never-raise-the-pixel-4s-media-volume-above-10-of-25). Three further rules:

- **Use the lowest volume that still measures**, which is 5 of 25 for the gate's graders.
- **Play calm music.** Choose a **Chill / Ambient** or **Melodic** station. Never Fast-Paced.
- **Play only while measuring.** Silence the C64 between stages with `machine:reset` rather
  than leaving a stimulus running, and keep each recording as short as its grader allows.

**Band-limit the analysis, or you will wrongly conclude the microphone is unusable** — an
earlier agent did exactly that. The room's noise is almost all below 300 Hz (desk and fan
rumble), a band a phone speaker barely reproduces. Measured with the microphone 4 mm from a
Pixel 4 grille, in silence:

```
    0- 120 Hz   -40.8 dBFS     <- the rumble that dominates a broadband reading
  120- 300 Hz   -46.7 dBFS
  300- 700 Hz   -83.9 dBFS
    3-   6 kHz  -77.1 dBFS
```

So a broadband RMS reads a -41 dBFS floor while the floor **in the 300-6000 Hz band the speaker
actually uses** is -73 dBFS. Judging signal-to-noise broadband understates it by more than 30 dB.

Band-limited to 300-6000 Hz, at phone volume 10 with the microphone 4 mm from the grille, a real
measurement over 98 s of SID playback gave **27 dB median SNR and 33 dB on loud passages** — ample.
The same recording judged broadband looked like 6 dB and appeared hopeless.
`tools/hil/local_vs_mirror_mic.py` already band-limits for this reason; follow it.

Detecting a dropout still needs more than a level threshold, because SID music has real rests that
reach the floor. Require a fast collapse *and* a fast recovery *and* loud music either side: an
underrun is a step within about a buffer period, where a musical decay is exponential over tens to
hundreds of milliseconds. A plain threshold at 16 dB broadband SNR produced 400 false candidates.

## UI requirements

Two constraints apply to every UI change. Neither is a preference and neither is
negotiable against fitting more on screen.

### Touch and non-touch devices are equally supported

The app runs on hardware with a touchscreen and on hardware driven entirely by
physical keys — a T9 keypad and a directional pad, where touch may be absent,
secondary, or awkward. **Both are first-class.** A control that can only be reached by
tapping does not exist for half the users.

So, for anything you add or change:

- It must be reachable and operable using the focus ring alone — arrow keys to move,
  OK to activate — with no pointer involved.
- When the ring selects it, it must be **scrolled into view**. A selection the user
  cannot see is not navigable, and short screens make this easy to get wrong.
- Anything focusable or tappable must be at least **44x44 CSS pixels**. That is the
  WCAG 2.5.5 target size, and it is as much about the focus ring having something
  visible to draw around as it is about fingers.
- Do not solve a layout problem by shrinking a hit box.

`playwright/keypadOnlyNavigation.spec.ts` enforces the walk without ever calling
`click()` or `tap()`. `playwright/smallScreenErgonomics.spec.ts` enforces the size
(`MIN_TARGET_PX = 44`).

### The smallest text on screen must still be comfortable to read

Assume the reader is a sighted adult of around sixty with ordinary eyesight, holding
the device at a normal distance. At that age reduced near focus is universal and
contrast sensitivity is measurably lower. The app should be enjoyable to use, not an
eye test.

- **14 CSS pixels is a hard floor for any rendered text**, and **16 for body text** —
  anything the user reads rather than glances at. `playwright/smallScreenErgonomics.spec.ts`
  enforces both (`MIN_TEXT_PX = 14`, `MIN_BODY_TEXT_PX = 16`).
- These are floors, not targets. A CSS pixel is density-independent, so 14px is about
  2.2mm tall on any phone and its x-height subtends roughly 11 arcminutes at a normal
  viewing distance, against the 16 to 18 that comfortable sustained reading wants.
- **Never step type down to make something fit.** The answer to "it does not fit" is
  reflow, scroll, or fewer things — never smaller text.
- Prefer a named scale step (`text-xs` and up). `text-[11px]` is the smallest arbitrary
  size allowed, because it is the only one `src/index.css` compensates on the compact
  profile; `npm run lint:font-size-floors` rejects anything smaller.
- The smallest supported screen is **320x426 CSS pixels**, which resolves to the
  `compact` display profile. Measure there: it is the `compact` entry in
  `playwright/displayProfileViewports.ts`, and it is the size the docs screenshots
  for that profile are captured at.

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

`npm run lint:reference-docs` (part of `npm run lint`) enforces the mechanical half
of this rule without a device. It scans `src/pages` and `src/components` for a
`data-testid` on an interactive element and fails when the inventory does not
mention it. Controls that were already undocumented when the check landed are
listed in `UNDOCUMENTED_BASELINE` in `scripts/check-reference-docs.mjs`; that list
may only shrink, so documenting one means deleting its baseline entry in the same
change. The check cannot judge keypad reachability, so it does not replace the
on-device pass — it only stops the gap from growing.

### User-visible text casing

Sentence case for every piece of UI text: dialog and sheet titles, section headings, control
labels, button labels, and the short descriptions under quick-action buttons. Capitalise only the
first word.

Three kinds of text keep their capitals, and they cover most of what looks like title case today.

1. **Product feature names**, which are proper nouns: Live View, Remote Input, Game Mode, Lighting
   Studio, Context Lens, Demo Mode, Online Archive, SID Radio, Device Safety.
2. **Acronyms**: SID, RAM, REU, HVSC, HDMI, FTP, REST, IEC, CPU, C64.
3. **Device config item names**, verbatim as the machine reports them: Turbo Control, Badline
   Timing, Video Mode, HDMI Scan Lines, Serial Bus Mode, Cartridge Preference, User Port Power,
   RAM Expansion, SuperCPU Detect, Music Detect, SID Select, Color Scheme, WASD Cursors. These
   MUST NOT be re-cased. A user reading a label in the app has to be able to find the same setting
   in the machine's own setup menu, and the machine spells it that way — including its American
   "Color". The same applies to values the device supplies.

So "Manage app configs" but "Save REU memory"; "Switch device" but "Open Lighting Studio".

Why sentence case rather than title case: it is what Material, Fluent, Primer, Polaris and Carbon
all specify, and this app follows Android conventions rather than Apple's; there is no judgement
call about which words count as major, so it can actually be applied consistently; and it survives
translation into languages that have no title case.

Two conventions the app deliberately keeps alongside this: quick-action button LABELS are single
Title-Case words ("Save", "Load", "Reset"), and `SectionHeader` renders its title in upper case.

### Spelling: American English

All user-visible text and the manual use American English. Not British. color, behavior, organize,
recognize, center, license (noun and verb), analog, catalog, gray, while (not "whilst"), toward
(not "towards"), canceled, traveled.

This is also what the machine itself uses — its config items are named "Color Scheme" and "Adjust
Color Clock" — so the app and the device read as one system rather than two.

## Screenshots

### When to regenerate, and when not to

- Regenerate only when visible documented UI changed. Internal code changes with unchanged
  visible output do not warrant a refresh.
- If a task changes only one page or one documented state, update only the corresponding
  screenshot files or folders under `docs/img/`.
- Never refresh the entire screenshot corpus unless explicitly required by the task.

### The corpus does not reproduce byte-identically here

`npm run screenshots` rewrote **207 of the 208 PNGs the corpus then held** on this machine, and
the prune step reverted one. (The corpus is larger now — around 399 PNGs under `docs/img/` — so
expect the same ratio at a larger scale.) Almost none of that is UI change: the largest diffs are
non-deterministic _content_ — a mock VIC frame, live fps and timer readouts — or the scroll
position a capture happened to settle at. Committing the lot buries a real change in noise and can
commit a worse screenshot than the one it replaced (one capture landed mid-scroll, mostly empty).

So: regenerate, then measure per-file diffs, and **open the handful you intend to keep and check each
one shows the change it is meant to show**. Four kept out of 207 was the right ratio for a change
touching two screens.

Revert the rest **scopedly**, never with a bulk `git checkout -- docs/img/`. That path is shared, a
concurrent agent may have legitimate work in it, and this file tells you elsewhere to leave unexpected
worktree changes alone — a bulk revert there quietly breaks that promise. `npm run screenshots` already
runs `scripts/revert-identical-pngs.mjs` for the byte-identical ones; for the drifted files it missed,
list them explicitly:

    git checkout -- docs/img/app/<each>/<file>.png

If the list is long enough that naming the files feels tedious, derive it from the per-file diff
measurement you have already taken and exclude your keepers — still explicit, still incapable of
touching anything you did not measure.

### Pruning a whole-corpus regeneration

`npm run screenshots` already reverts captures that are byte-identical to their
committed version. That does not help after a regeneration on a different machine:
anti-aliasing and font hinting shift a few pixels by a shade, so nearly every file
differs in bytes while looking the same, and the diff becomes unreviewable.

Run `npm run screenshots:prune-drift` after such a regeneration
(`scripts/revert-visually-identical-pngs.mjs`). It compares pixels rather than bytes and
reverts anything below a perceptual threshold, leaving only the captures a human should
actually look at. It keeps anything new, deleted, differently sized, or genuinely different,
and takes `--baseline <ref>` (default `origin/main`), `--dir`, `--fuzz`, `--threshold` and
`--dry-run`.

## Code style

### Prettier formatting

All TypeScript, TSX, and JSON files must be formatted with Prettier before committing.

- Config: `.prettierrc.json` — `printWidth: 120`, plus a YAML override setting
  `tabWidth: 2`. Everything else is a Prettier v3 default, so strings use double quotes.
- **Check**: `npm run format:check:ts` (also runs as the first step of `npm run lint`).
- **Fix**: `npm run format:ts`.
- **Never run `prettier --write .` or any unscoped Prettier invocation.** Markdown in
  `docs/` is not Prettier-formatted here and `.prettierignore` does not exclude it: an
  unscoped run rewrites about 138 tracked docs files plus this one. The `format:*` scripts
  are scoped on purpose.
- YAML is checked separately via `npm run format:check:yaml`.
- Every code change must already be Prettier-compliant when written.

### Style principles

- **DRY**: avoid duplication. Extract shared logic only when it improves clarity and current maintainability.
- **KISS**: prefer simple, explicit solutions.
- **Modularity**: keep files cohesive and responsibilities clear. `REVIEW.md` section 9 sets the
  line: split a file that mixes concerns or grows past ~600 lines, and a file approaching ~1000
  lines is expected to be refactored. `npm run lint:file-sizes` (part of `npm run lint`) enforces
  the 1000-line end of that. Files that were already over it when the check landed carry a
  recorded ceiling in `GRANDFATHERED` in `scripts/check-file-sizes.mjs`. A ceiling only ratchets
  down: it never rises, a real split has to lower its entry, and adding a new entry to that list is
  not the way to pass the check. A file may sit up to `GROWTH_ALLOWANCE_LINES` (25) above its
  recorded ceiling, which is there so a defect fix in one of these files is possible at all; it is
  a one-off headroom above a fixed number, not a budget that renews per change.
- **Readability first**: prefer clear naming over commentary.
- **Explicitness**: make configuration, defaults, and assumptions discoverable.
- **Fail fast**: validate inputs early and surface failures with context.
- **Determinism**: avoid hidden state and non-reproducible behavior unless explicitly required.
- **Testability**: structure code for unit and integration testing without excessive mocking.
- **No dead code**: do not leave unused code paths or speculative scaffolding.
- **Consistency**: follow existing project conventions.
- **Minimal dependencies**: add third-party libraries only when clearly justified.
- **Stable public surfaces**: keep public APIs minimal and intentional.

### Modularization guardrails

- If a file grows beyond about 600 lines or mixes concerns, split it.
- If a file approaches 1000 lines, refactoring is expected unless there is a strong documented reason not to.

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

### React effect/setState safety

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

## Subsystem knowledge earned on hardware

### Audio output: on-device playback and the A/V mirror share one native path

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
drain between writes — all failed, because punctuality was the wrong thing to adjust. The direction
that helps is a ring holding **seconds**, so JS only has to be roughly on time again.

Two further pieces are needed to make a deep ring work, and both were learned the hard way:

- **Priming must be separate from the target** (`primeMs`). The pipeline waits for its target depth
  before the first sound, which is right at 120 ms and absurd at 15 s. Worse, the writer has to stop
  short of the target or it would overfill — so playback never began at all. That was silence on the
  device, twelve seconds sitting in a ring waiting for fifteen. Priming at ~200 ms starts playback
  promptly and the ring fills behind it, like the anti-shock buffer in a portable CD player.
- **Counters are necessary, not sufficient.** A steady ring with zero underruns and zero drops was
  reported through two builds a listener could plainly hear dropping out. Confirm by ear, or with the
  barcode SID graded per note.

Detectors that do NOT work here, each tried and each wrong: an envelope/level dropout detector cannot
see a stall that repeats audio, because the level stays flat; spectral self-similarity does see a
freeze but flags sustained chords too, reporting 140 "freezes" in a minute of ordinary music; and
aligning a recording against a reference render to find pauses reports phantom stalls, because
repetitive music matches in several places at once. The barcode SID remains the only instrument that
settles it, and a listener remains the arbiter.

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

### Seeking costs a full re-render, so design around that rather than into it

libsidplayfp cannot rewind. Reaching a position means rendering everything before it and discarding
it — roughly 150 ms of CPU per second of audio on a Pixel 4, so a position a minute in is fifteen to
twenty seconds of work with chunk delivery gated shut throughout. Consequences that were each learned
by shipping the opposite:

- **Never seek on a gesture sample.** A drag emits a position per pointer move; one seek each queued
  minutes of work for positions the listener had already passed. The gesture moves the bar; the
  release seeks once.
- **Do not race the pre-render — wait for it.** A full pre-render of the tune is usually already
  running and rendering exactly the audio a forward seek needs. Waiting for it to reach the target
  costs nothing extra and plays sooner than a second render of the same span.
- **Say so while it waits.** The progress bar carries a translucent fill for how far the tune is
  rendered (which is exactly how far a seek can land instantly) and a marker at a target being waited
  for. Silence with visible progress is loading; silence without it is a fault.
- **A partial cache must hand over, not end.** Running off the end of a cached lead-in is not the end
  of the tune, and treating it as one cut every warmed song off after its opening.
- **Cache keys outlive the tune that set them.** Opening a tune tears the previous one down, and that
  teardown clears the key — so a key assigned before opening is null for the whole tune, and every
  consumer of the cache silently takes its slow path.

### Concealment: an unfilled gap does not merely omit itself

It pulls everything after it earlier. Capping concealment at eight packets on the reasoning that a
longer gap is "an outage we should not invent audio for" turned notes the C64 held for 160 ms into
78 ms and 132 ms — the timeline compressed. Wi-Fi loses multicast in clumps, so twenty-packet gaps
are ordinary here. Fill them, fading toward silence past ~30 ms so a long gap cannot become a drone.

### Async guards, gates and supervisors

Most "playback wedged" reports in this repo have been one shape: something that suppresses work, left
set by a path nobody wrote a release for. Ten separate defects across two rounds of hardware testing
were all instances of it, so treat these as rules rather than advice. The instances are in
[[local-sid-stall-root-causes]]; what follows is what they have in common.

- **A guard is released in `finally`, or it is not released.** Single-flight flags, loading flags and
  "gesture in progress" refs all latched on an await that never returned, and each one disabled a
  control until relaunch.
- **Every wait is bounded.** A promise with no timeout is a permanent state change waiting for a bad
  network, a busy worker or a dozing WebView.
- **A single-slot pending resolver must be handed over, not dropped.** Replacing `pending` with a
  newer request orphans the old resolver and its caller awaits forever. Resolve the superseded one —
  it genuinely is over.
- **A gate that suppresses output needs a reopener that is not its happy path.** A flag that
  discards rendered audio until a matching reply arrives will, the one time that reply is lost,
  discard everything for the rest of the session. Ask what reopens it when the reply never comes.
- **Prefer engine-owned cadence to caller-driven polling.** Anything published as a side effect of a
  getter stops being published when the page that polls it unmounts — while the subsystem keeps
  running. State that outlives a page must be produced by something that also outlives it.
- **A supervisor must exempt every legitimate silence, and each exemption must carry its own bound.**
  A stall detector that cannot tell "working, slowly" from "dead" will kill the work: an open, a seek
  and a deliberate wait for a pre-render all look identical to a five-second timer. Whichever is
  outstanding owns that failure, and owns bounding it.
- **A strictly-ordered worker supersedes, it does not queue.** One promise chain means a new tune's
  `open` waits out every render and seek in front of it, then blows its own timeout and is written
  off as unresponsive. Skip superseded work; still answer it, so no caller waits out a timeout.

### A test that does not fail without the fix is not a test

The repo already requires a regression test per bug fix. This is the failure mode that requirement
does not catch on its own: a test that **reimplements** the logic it is meant to guard. Four tests for
an audio-signal decision recomputed the arithmetic locally and passed against the unfixed production
code — reviewed, merged, and worthless.

- **Call the production symbol.** If the logic is inline and unreachable, export it. A small exported
  pure function is a better answer than a test that models what the code is believed to do.
- **Revert the fix and watch the test fail.** Every time. It is thirty seconds and it is the only thing
  that distinguishes a regression test from a description.
- **Pick inputs where the fixed and broken code actually differ.** Two of these tests were rewritten
  twice before that was true: the buffer selection turned out to be arithmetically identical to the
  `min()` it replaced, so only one input range could tell them apart, and it needed a dependency the
  harness could not inject.
- **Abandon a test that cannot discriminate rather than adding production seams to prop it up.** A
  seam whose only purpose is a test that still does not work is worse than the honest, smaller test.

Applies to generated fixtures too: a corrected value in a build script needs something reading it
back. A stimulus whose declared hardware was wrong for months could not be caught by anything grading
playback, because the property was never exercised by the signal.

### Diagnostics that cannot report the fault

- **Ask whether a metric is structurally able to be non-zero.** A "Dropped pkts" readout sat at zero
  for the life of the feature because it counted sequence gaps in packets the native plugin had
  stopped forwarding once it owned playback. A reassuring number from a counter with nothing to count
  is worse than no number.
- **Log transitions, not state.** "This library is too large for a snapshot" is a state, and
  re-announcing it on every five-second save put **313 of the log's 500 entries** on one sentence,
  pushing out everything worth reading. Announce on the edge, and again on the way back.

### Debugging a signal: measure the wire before you read the code

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
- **Check the phone is awake and foregrounded before concluding anything about async behavior.** A
  dozing WebView freezes timers and promises, which reads exactly like a hung native plugin: in the
  same session `StreamUdp.bind()` "never resolved" for 90 s purely because the screen was off.
- **Zero underruns does not mean healthy audio.** An over-full buffer never underruns; it silently
  discards what it cannot accept. If a counter can only show starvation, add the one that shows
  overflow before trusting either.

### Build an exact instrument when the complaint is subjective

"It sounds rough" cannot be graded against real music, whose spectrum moves constantly — a
correlation score says only that _something_ differs. `tools/hil/make_tone_ladder_sid.py` emits a
307-byte PSID playing a known C3→C4→C3 ladder that also steps the screen color in unison with the
notes, and `tools/hil/analyse_tone_ladder.py` reports per-note pitch error in cents and per-note
duration. That turns "rough" into "notes are 0.965 s instead of 0.500 s", which points at a rate
problem in one reading. Prefer building that instrument early over another round of reasoning about
the code.

#### Calibrate the instrument before you trust it

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
handful of opcodes involved proves color and note writes land on the same frame) _before_ pointing
the instrument at hardware. Grade against published standards — ITU-R BT.1359-1 for A/V sync,
BS.1770/EBU R128 for level — so the verdict means something outside this repo, and report median
with IQR rather than a bare mean so one dropout cannot move the headline.

## Dependencies, release identity, and the manual

### Dependency and lockfile changes — validate with `npm ci`, never just `npm install`

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
Note that `./build` runs `npm install` when the lockfile looks stale, so a local
full build can introduce exactly this pruning.

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
- Regenerate the notices with `npm run notices:generate` and confirm
  `npm run notices:check` is clean — dependency changes alter `THIRD_PARTY_NOTICES.md`,
  and CI fails on drift.
- Prefer within-major bumps; hold framework-defining majors (React, Tailwind,
  Vite, Vitest, TypeScript, Zod, react-router) for a dedicated, separately
  validated change so a break is isolated and diagnosable.

### Release tag APKs

- CI builds a debug APK for all runs.
- Android Play upload is already operational, but it happens outside CI: no workflow in
  `.github/workflows/` publishes to Google Play.
- Tag builds still rely on signing secrets (`ANDROID_KEYSTORE_BASE64`,
  `KEYSTORE_STORE_PASSWORD`, `KEYSTORE_KEY_PASSWORD`) when a signed release artifact must
  be produced in CI.
- Release tags **drive the build version**: a tag may be created directly from the GitHub Releases UI (no `package.json` bump needed). `scripts/resolve-build-version.mjs` resolves the build identity from the tag (`GITHUB_REF_TYPE=tag`/`GITHUB_REF_NAME`), so the artifact is versioned as the tag regardless of `package.json`.
- `package.json` is the in-tree dev baseline. It does **not** need to equal the latest tag; it only needs to stay internally consistent with `package-lock.json` (enforced by `tests/unit/scripts/releaseVersionMetadata.test.ts`). Do not re-add a test that requires `package.json` to equal the Git tag — that breaks UI-created tag builds.

### Golden trace stewardship

When modifying Playwright tests, REST routing, or tracing logic:

1. Detect changes that affect trace semantics (order, payloads, endpoints, or normalization).
2. If trace semantics change, re-run golden trace recording locally.
3. Commit updated golden traces under `playwright/fixtures/traces/golden`.
4. Never weaken trace assertions to make tests pass; fix the root cause instead.

`npm run validate:traces` (`scripts/compare-traces.mjs`) compares a run against the golden set.

### Manual authoring — the two-manual split and device terminology

The user manual is **generated** into `docs/manual/<variant>/…` (the `.md` is tracked; the `.last-build` and any PDF are git-ignored). `scripts/build-manuals.mjs` (`npm run manuals:build`) renders the prose to Markdown; `scripts/build-manuals-latex.mjs` typesets that Markdown with LuaLaTeX into `docs/manual/latex/<variant>/` (git-ignored). `./build --manual` installs the toolchain if needed and runs both; see `scripts/latex/README.md`. It is emitted once **per variant**, and the two editions have deliberately different scope — write for the right one via the naming helpers, never hard-coded device names.

- **C64 Commander** (`c64commander` variant, `variant.id !== "c64u-remote"`) — the **broad** edition. The controlled machine is **the Ultimate-family device** and covers the **Commodore 64 Ultimate**, the **Ultimate 64 / Elite / Elite II**, and the **Ultimate-II+(L)** — the last being a cartridge that lacks streaming, joystick relay, and other Ultimate-only features, so never assert those unconditionally here. The app runs on a **phone, tablet, or self-hosted web** build (iOS/Android/web).
- **C64U Remote** (`c64u-remote` variant) — the **specific** edition for a **Commodore 64 Ultimate** driven by a compact keypad **phone**. No phone model is named anywhere in it: the guide simply says "your phone", so the manual survives new supported handsets.

**Device terminology — one machine, named consistently:**

- The controlled machine is **one device**. The C64 Ultimate (and its siblings) **is** the C64 — never write "the Ultimate" and "the C64" as if they were two separate things (e.g. _"the Ultimate can send what your C64 is doing"_ is wrong).
- Refer to the running machine as **"your C64"** for what it does (memory, screen, sound, drives, streams, printer emulation), and as **`targetDeviceShortName(variant)`** ("the connected Ultimate-family device" / "the Commodore 64 Ultimate") only where the **hardware/model or connection** genuinely matters (compatibility, firmware, password, network setup).
- Use **`appDeviceName(variant)`** ("phone or tablet" / "phone") for the device running the app, and precise **model names** (Commodore 64 Ultimate, Ultimate 64 Elite II, Ultimate-II+(L)) only in firmware/compatibility passages.
- New manual prose must go through these helpers (defined in `scripts/build-manuals.mjs`), not literal device names. `tests/unit/scripts/buildManuals.test.ts` enforces some of this (e.g. the broad edition must not name the specific phone).

**Live View** is a first-class chapter of the manual's *In Depth* part — it sits between "SID Radio" and "Streams", ahead of "Remote Input" — not a Content-Explorer sub-section. Keep the immersive keypad keystroke table (pan/zoom/fit/mode) accurate to the mapping in `src/hooks/useRemoteInputPhysicalKeys.ts`, which `src/components/remoteInput/RemoteInputSheet.tsx` wires to its `onKeyDown`.

## What to optimize for

- responsive UI and clear feedback
- stable network interactions with the C64U
- test reliability and clean error reporting
- minimal, accurately scoped changes
- disciplined screenshot maintenance
