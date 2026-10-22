# Team-based HIL soak and bug bash (reusable execution prompt)

Use this prompt to run a whole-app hardware-in-the-loop (HIL) bug bash with several agents working
concurrently on separate handsets. It is a template: fill in the parameters in section 1, then follow
sections 2 to 9. `AGENTS.md` and `REVIEW.md` take precedence over this file. The single-agent
predecessors are `hil-bug-bash.prompt.md` and `hil-bug-bash-2.prompt.md`; their rules on evidence,
snapshot and restore, and repair standard still apply.

## 1. Parameters (fill in before starting)

| Parameter | Meaning | Example |
| --- | --- | --- |
| `DATE` | Session date, used in branch and folder names | `2026-10-22` |
| `RIG_A` | Handset A, its app edition, and the Ultimate it drives | constrained keypad handset, compact-keypad edition, `c64u` |
| `RIG_B` | Handset B, its app edition, and the Ultimate it drives | Pixel 4, default edition, `u64` |
| `CAP_DEVICE` | Ultimate used for capability-gating passes | `u2` (assign to one rig only) |
| `STOP_CONDITION` | What ends the run | Default: none. The run is open-ended (section 2a) |
| `PRIORITIES` | Focus areas for this run | usability, long soaks, logged warnings and errors, anything that could disrupt a user |

Before starting, confirm the rig with `droid_target.list_targets`, probe each Ultimate over REST
(`/v1/info`), re-read `/etc/hosts` (addresses change with DHCP), and check that no other session holds
the bench: look for a running soak sampler or microphone recording on either handset, and for
device locks in `~/.cache/1541ultimate-coord`. If the user has released a normally reserved device for
this run, record that in the brief.

## 2. Team and roles

| Role | Model tier | Count | Responsibility |
| --- | --- | --- | --- |
| Project manager (PM) | the main session | 1 | Owns the integration branch, builds the baseline APKs, assigns work, relays architect answers, merges fix branches, opens the pull request, drives CI, tags the release candidate. |
| Implementor | mid-tier (Sonnet class) | 2, one per rig | Drives one handset against one Ultimate. Soaks, sweeps, finds defects, fixes them with revert-checked tests, commits on its own branch. |
| Architect | top-tier (Opus class) | 1, on demand | Consulted through the PM for root-cause or design problems the implementors cannot settle. Read-only unless the PM asks for a design note. |
| Reviewer | top-tier (Opus class) | 2 | Adversarial, read-only review of the fix commits. Briefed to assume the author is overconfident. |

Rules for the team:

- Run at most one agent per handset and per Ultimate. Two handsets never drive the same Ultimate.
- Implementors do not message each other. They report to the PM; the PM relays.
- An implementor that needs a design decision sends the PM the evidence and the exact question, keeps
  working on other leads, and does not guess.
- The PM verifies every claim an agent makes about evidence (counts, timings, measurements) against the
  stored artifacts before it goes into the pull request. Agents have fabricated measurements before.

## 2a. The run does not end on its own

The bug bash is open-ended. There is no time budget and no bug quota, and finishing a soak, a sweep or
a review round is never a reason to stop. The run ends only when:

1. the user asks for a wrap-up, or
2. less than 10% of the weekly usage allowance is left (check it before each new milestone; if it cannot
   be read, treat repeated rate-limit warnings as the signal), or
3. a hard blocker needs the user (for example hardware that only they can restore).

Until then:

- Implementors loop: soak (maximum 30 minutes per run), sweep, hunt, fix, verify, report, repeat. When a
  list of leads runs out, start a different lens (other display profile or text size, other device, other
  lifecycle path, static review against the async-guard rules, newly merged code). Do not idle and do not
  end a turn while work remains. Use background jobs and monitors so a notification wakes the session.
- The PM keeps one pull request open from the first milestone onward (draft until the first reviewed
  batch is merged into it). After every major milestone the PM updates the pull request description to the
  current state and pushes the branch. A milestone is: a reviewed fix batch merged into the integration
  branch, a completed soak with analysed results, a CI result, or a change of the open-defect list. The
  description always opens with a current summary and keeps the sections in section 8 step 2.
- When a milestone batch is green and reviewed, it may be merged and released as the next release
  candidate without waiting for the end of the run, because there is no end of the run. Later batches
  start a new pull request from the updated `main`.
- Save progress so a fresh session can resume: keep a handover note in the integration worktree
  (`artifacts/handover.md`: build identities, open leads, branches, device state) and update it at each
  milestone.
- If an agent hits a usage limit, schedule a resume (about 30 minutes later) and continue it with
  SendMessage once it is back.

## 2b. GitHub issues are the work tracker

Every defect or improvement that is not fixed immediately becomes a GitHub issue. Implementors file
what they discover and pick up issues from the queue between lenses, so work is never lost when a
session ends.

- **Filing.** Use the labels `bug` or `enhancement`, one `area: ...` label, one `priority: ...` label,
  `status: ready` and `source: hil bug bash`. Add `kind: ...` or `scope: keypad phone` where they apply.
  The body has: summary, steps to reproduce, expected result, actual result, evidence (build identity,
  timestamps, a short excerpt, file paths of stored artifacts), suspected cause with `file:line`, and a
  proposed regression test. One root cause per issue. Search open issues first to avoid duplicates.
- **Picking up.** Replace `status: ready` with `status: in progress`, comment with the branch name, and
  reference the issue in the fix commit (`Fixes #N`) once the fix is on the integration branch.
- **Triage.** The PM reviews new issues at each milestone, corrects labels, closes duplicates, and
  closes fixed issues with the evidence from section 8 (commit SHAs, tests, revert check, device
  evidence, CI link).
- **Withheld names never leave the machine.** Issue titles, bodies, comments, labels, attached files
  and screenshots are public. They must not contain the names of unannounced hardware, operating
  systems, vendors or product editions. Describe the device as "a compact keypad phone" and the
  edition as "the compact keypad edition", and describe capabilities rather than origins. Never paste
  raw logs, process lists or window dumps; excerpt only what is needed and read it first, because
  system logs often name the host platform. Run the withheld-name scan on the title and body before every
  `gh issue create`, `gh issue comment` and `gh pr` call, and on the commit range before every push.
  Worktrees do not run the machine-local pre-push hook, so the scan is the only protection there.
- Reference the tracker in the pull request description, and keep the list of open issues in
  `artifacts/handover.md`.

## 3. Setup by the PM

1. Create the integration worktree and branch `hil/<DATE>-team-bug-bash` from up-to-date `origin/main`.
   Run `npm ci` in it. Do not symlink `node_modules` from another checkout.
2. Build both app editions once and store the APKs, for example
   `node scripts/build-android-apks.mjs --variant all --verify-metadata`, with `JAVA_HOME` set to JDK 21.
   Follow a variant-scoped generate with a plain `npm run variant:generate`, and restore build churn by
   name (`package-lock.json`, `THIRD_PARTY_NOTICES.md`, the three iOS splash PNGs, `docs/img`).
3. Write the team brief to `artifacts/team-brief.md` in the integration worktree, containing section 4
   (hard rules) and section 5 (method) with the parameters filled in. Every agent is told to read it
   first.
4. Spawn the two implementors in the background, each with its rig, its worktree and branch
   (`hil/<DATE>-rig-a`, `hil/<DATE>-rig-b`, both from the integration branch), and where the APKs will
   appear. Spawn the architect and reviewers only when needed.

## 4. Hard rules for every agent

- Read `AGENTS.md` and `REVIEW.md` first. Load the `droidctl` skill. All Android device work goes
  through the droidctl tools, never raw `adb`. Load the handset-specific skills named in `AGENTS.md`.
- **Pixel 4 media volume never above 10 of 25.** Use 3 to 5 for audible tests, verify the level with
  `cmd audio`, play calm music (Chill, Ambient or Melodic), and play only while measuring. Use the lowest
  volume that still gives enough signal-to-noise ratio (band-limited to 300-6000 Hz). Between
  measurements, stop playback on every phone instead of only lowering the volume.
- One microphone may hear several phones. Only one phone makes sound during a microphone-graded stage.
- The keypad handset is unique. Never reboot or flash it, never restart its Android container or
  the host service that runs it (this once rebooted the whole phone), never change its OS or package
  repositories. Take a backup before any state change outside the app.
- Soaks never run longer than 30 minutes. Never install or launch on a handset while a soak is running
  on it. Do not inject DOM events during a physical key capture.
- Never use or switch the outlet named in the user's power-control instruction. Never power-cycle,
  write flash, or run "Reset to default" on any Ultimate. Wrap Ultimate traffic in
  `~/.cache/1541ultimate-coord/with-device-locks <device> -- <command>` where practical.
- Never wedge the device. Single-item config writes use `PUT /v1/configs/{cat}/{item}?value=`, never the
  batch `POST`. If a device becomes flaky, suspect the app's request pattern first and preserve the
  request diagnostics before blaming hardware.
- Never catch an exception silently. Rethrow with context, or log at WARN or ERROR with the stack.
- Every fix ships a regression test that calls the production symbol and fails when the fix is reverted.
  Revert the fix, watch the test fail, restore the fix.
- UI text: sentence case, American English. Touch targets at least 44x44 CSS px. Text at least 14 px
  (16 px for body text). Every control must be reachable and operable with the focus ring alone and
  scrolled into view. Update `docs/cta-inventory.md` in the same change as any control change.
- Keep comments rare; none longer than five lines.
- Other sessions share the git tree and the bench. Leave unexpected changes alone. Never run
  `git checkout` on a directory, never `git stash`, never `prettier --write .`. Work only in your own
  worktree and commit with explicit paths.
- Commit messages, code, docs and pull request text must not name unannounced hardware or product
  editions. Describe the capability generically ("compact keypad screen", "constrained display"). The
  pre-push hook checks the content of what is pushed, not only the message.
- Reply in English. Report only what was done and measured. Never claim the app is bug-free.

## 5. Method for each implementor

1. **Baseline.** Install the APK for the rig, launch it, forward the WebView (`hil-attach`), confirm
   Ultimate health, record the installed build identity, and clear logcat.
2. **Soak (maximum 30 minutes per run).**
   - Real playback from the Ultimate and from the handset, plus the other long-running features that apply
     to the rig (SID Radio, crossfade, Live View, background execution).
   - Include a screen-off variant where the platform allows it.
   - Sample process memory, load and playback state about every 30 s with the sampler, and analyse with
     `tools/hil/soak_report.py` and `tools/hil/soak_reference_diff.py`.
   - Capture the in-app log and logcat for the whole run.
   - Treat every WARN, ERROR, uncaught exception and `console.error` as a lead. Find the cause. Do not
     dismiss a message as noise without showing why.
3. **Usability sweep.** Every page and dialog, using the input method the rig is built for (touch, or
   keypad only). Check focus-ring visibility and scrolling, target sizes, text floors and clipping,
   Back-key behavior, ignored presses, toasts covering controls, error messages that name the real cause,
   long lists, and data integrity (playlists, likes, saved devices, imported sources) across restarts and
   cancelled operations.
4. **Lifecycle.** Background and foreground, screen off and on, force-stop and relaunch, network loss
   and recovery, Ultimate unreachable then back, device switch in the middle of an operation.
5. **Capability pass.** The rig that owns `CAP_DEVICE` repeats the relevant surfaces against it, because
   cartridge-class devices lack features such as streams and input relay.
6. **Count a finding only when** it was reproduced on the device, or its mechanism was shown in code and
   a test fails on the unrepaired code. One root cause is one bug. Suspicions are leads, not findings.
7. **Keep `artifacts/<rig>/bugs.md`** with one row per bug: ID, surface, severity (`REVIEW.md`), symptom,
   root cause (`file:line`), test name, revert-check result, device verification (build and time).
8. **Fix.** Small commits on the rig branch. Run targeted tests, `npm run typecheck` and lint on touched
   files. Rebuild the rig's APK from the worktree and verify the fix on the device.
9. **Report in batches** to the PM: commit SHAs, tests, revert-check results, device evidence, and what
   is still open. Then continue with the next lens. Stop only on the conditions in section 2a.

## 6. Architect protocol

The PM sends the architect the evidence (logs, traces, code paths, measurements) and one precise
question. The architect answers with the root cause or design, the alternatives it rejected and why, and
the narrowest test that can tell them apart. The PM relays the answer to the implementor. The architect
does not edit code unless asked for a design note.

## 7. Review protocol

1. When an implementor reports a batch, or when the merged diff is ready, start two reviewers on
   different slices of the diff, with no access to the implementor's conclusions. Give them the diff and
   the repository, not the author's explanation.
2. Brief them to look for: defects in the repair, tests that pass without the fix, tests that reimplement
   the logic under test, silent catches, async guard violations (the rules in `AGENTS.md`), React
   effect loops, missing CTA inventory or manual updates, user-visible text that breaks the casing or
   spelling rules, and coverage gaps on changed lines.
3. The PM verifies each finding against the code before acting. Confirmed findings go back to an
   implementor with a request for a test and a revert check. Rejected findings are recorded with the reason.
4. After the repairs, run a second review of the repair commits only. Repeat until a review finds
   nothing of substance.

## 8. Shipping (PM), repeated at every milestone

1. Merge the rig branches into the integration branch one at a time, resolving conflicts without
   dropping either side's tests. Run the full gate set from `AGENTS.md`: `npm run lint`,
   `npm run typecheck`, `npm run test`, `./gradlew testDebugUnitTest`, Playwright, the hardware merge gate
   (`node tools/hil/merge_gate.mjs`), and `npm run coverage:gate`. Check changed-line coverage against the
   patch target in `codecov.yml`.
2. Open one pull request. Its description opens with a summary and follows the style rules in the
   user's `CLAUDE.md`: previous behavior, the defect, the change, how it was verified, and rejected
   alternatives, as separate statements. State exactly what was reverted to show each test can fail.
3. Wait for every CI job. Read the log of any failure before acting. Treat patch coverage failures as
   blockers. Check for unresolved review threads.
4. Merge with a merge commit when every required job is green. Tag the next release candidate with an
   annotated tag on the merge commit, push it, and follow the tag workflows until the prerelease exists
   with its assets.
5. Restore the rig to the state recorded in section 3 step 1. Leave the Ultimates running and quiet,
   release every device lock, and remove the worktrees.

## 8a. Rig knowledge for a fast start

Read these before the first device action. They cost hours to rediscover.

**Where things live**

- Harnesses and graders: `tools/hil/` (merge gate, soak sampler and report, tone ladder, mic graders,
  keypad reachability, launch and tab-switch profiles), documented in `docs/testing/hil-merge-gate.md`.
- WebView observation over CDP: `scripts/bughunt-cdp.mjs` and the attach skill. Re-forward the WebView
  after every install, force-stop or crash, and re-check the installed `versionName` first.
- Skills under `.claude/skills/` (droidctl, attach, UI driving, handset operations, audio triage,
  revert-check helper, ship gates). Load them rather than rederiving their content.
- Earlier reports: `docs/hil/*.md` and the handset workspace under
  `~/dev/c64/c64commander-workspace/` (setup steps, error log, findings per round, helper scripts). Read the
  latest round before hunting so known defects are not rediscovered, and re-verify old findings against
  the current build before counting them.
- The agent memory index at `~/.claude/projects/-home-chris-dev-c64-c64commander/memory/MEMORY.md`
  holds the traps below in full. Read the entries that match the area you touch.

**Handsets**

- The keypad handset reports keys differently from the Pixel: soft keys arrive as `MENU` and `BACK`, OK as
  `ENTER`, F1 and F3 as codes `F21` and `F23`, and the C= key is consumed by the system. The system input
  method garbles multi-tap in WebView text fields. Measure on the handset, never infer from the Pixel.
- Its screen is 480x640 px at DPR 1.5, which is 320x427 CSS px. After an OS update or reboot the container's
  debug bridge reads as disabled and must be re-enabled through the documented, user-approved procedure.
- Android can report an activity as resumed while the host shows another window. Verify the host
  foreground window as described in the handset skill. A locked or dark screen means a soak may be running.
- A sleeping Pixel or a hidden WebView freezes timers and promises. This looks like a hung native plugin.
  Check that the phone is awake and the app is in front before drawing conclusions about async behavior.
- Tap by `data-testid` with a hit test (`elementFromPoint`) because the sticky app bar, toast viewport
  and system overlays (clipboard, notification prompts) swallow taps. A permission prompt swallows keys.
- Set the Pixel volume with `cmd audio`; `media_session` volume changes are a no-op. A leftover
  `wm size` override fails the gate's geometry preconditions.

**Ultimates**

- The two handsets must not drive the same Ultimate. The app auto-switches to a saved fallback device when
  the selected one drops, so check which device each app instance is actually pointed at before and after
  any outage. A handset silently driving the other rig's Ultimate invalidates both rigs' results.
- The cartridge-class device has no `/v1/streams`, no `core_version`, no input relay and no poweroff.
  Gate such surfaces on runtime capabilities and test them there.
- The A/V mirror multicast groups (`239.0.1.64:11000`, `239.0.1.65:11001`) are shared by every Ultimate on
  the LAN. Two senders in one group look like packet loss or flicker. A device keeps streaming until asked
  to stop, so suspect an orphaned stream first.
- The telnet menu allows four sessions and leaks a slot on a half-open connection. A cartridge held by
  `run_crt` survives reset. Reset does not unpause. REST config writes do not persist to flash.
- Network degradation that only a power cycle clears is a firmware fault; do not power-cycle to test it.
  Report the evidence instead.

**Measurement**

- Measure the wire before reading code (packet rate, sequence deltas). Calibrate any new instrument
  against a known-good signal before trusting its verdict, and report the median with the interquartile
  range, not a mean.
- Counters are necessary, not sufficient: zero underruns does not mean healthy audio. Use the barcode and
  tone-ladder instruments, and confirm by ear when a listener is available.
- Search latency grows over a long session; compare p95 at the start and the end of every soak.
- A merge gate failure is not automatically your change. Baseline the base commit with `--only <stage>`
  and retry a stage once before concluding. The gate grades the installed APK, so check `versionName`.

**Build and CI**

- JDK 21 from sdkman is needed for Gradle tests. `./build --skip-tests --install-apk` is the fast path;
  the plain form runs every gate and rewrites the screenshot corpus.
- `npm run lint` is run by no CI workflow, so run it before pushing. CI gates: 93% lines and 85% branches
  on merged coverage, 94% patch coverage, an index chunk of at most 250 KB gzip, and file-size ceilings
  that never rise.
- Local builds rewrite `package-lock.json`, `THIRD_PARTY_NOTICES.md` and the iOS splash PNGs. Restore them
  by name before staging. Do not run two coverage-enabled Vitest runs at once, and do not run `./build`
  while the end-to-end phase serves `dist/`.
- Kill orphaned `vite preview` servers and Vitest workers between runs. A Vitest worker pinned at 100% CPU is
  a synchronous render loop, not an open handle.

## 9. Report

Write `docs/hil/<DATE>-team-bug-bash.md`. It opens with a summary of the whole document and covers:

- the parameters and the build identities tested;
- the counted bugs by surface, matching each `bugs.md`;
- soak results per rig: duration, memory slope, latency, every WARN and ERROR with its disposition;
- instrument and harness faults, listed separately and not counted;
- what could not be run, and why;
- review rounds and their outcomes;
- validation results, including every merge gate run;
- the state the rig was left in;
- start time, end time, elapsed time, and which stop condition in section 2a was met.

Write the report incrementally during the run and finalize it at wrap-up.

The report is measured evidence. It does not certify that the app is free of defects.
