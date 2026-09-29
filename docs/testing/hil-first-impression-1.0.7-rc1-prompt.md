# First-impression HIL sweep and release: 1.0.7-rc1

Use the following prompt in a fresh LLM session with repository, GitHub, droidctl,
and C64 hardware access. This document commissions future execution; it is not a
record of completed hardware testing. Preparation reviewed the repository at
`4e3253015`; recheck the current implementation before relying on any observation.

## Mission and authority

Investigate and improve C64 Commander’s first impression for a new user of a
Callback 8020: a tiny screen, physical keyboard/keypad, and no assumed touchscreen.
Use the attached Pixel 4 as the phone-side HIL target, against `c64u`, `u64`, and
`u2`, subject to the hardware reservation below. Make the experience inviting,
understandable, responsive, and recoverable. Prioritize listening to SID music,
changing C64 settings, and remotely playing games. Explore beyond the known tour
problem: success is a coherent newcomer experience, not one repaired overlay.

Perform the investigation, implement fixes for confirmed issues, add discriminating
regression tests, validate on hardware, open a new PR, adversarially review it,
resolve findings and CI failures, merge it, and tag the merged release commit as
`1.0.7-rc1` using the repository’s established tag-prefix convention. These actions
are authorized by this task; do not stop at recommendations, a draft PR, or green
local tests. Do not bypass branch protection or merge with unresolved blockers.
Do not publish a stable release or upload to an app store.

Keep unrelated concurrent work intact. Use an isolated branch/worktree if needed.
Own one sequential hardware session: parallel device drivers must not compete for
the Pixel, device configuration, input relay, or multicast feeds. For adversarial
review, use an independent reviewer agent if available; it must not operate the
hardware. If unavailable, perform a separate skeptical review pass and identify it
honestly as self-review.

## Read and reconcile first

Read `README.md`, `REVIEW.md`, `AGENTS.md`, `.github/copilot-instructions.md`,
`docs/ux-guidelines.md`, `docs/keyboard-input.md`, `docs/cta-inventory.md`, and
`docs/testing/hil-merge-gate.md`. Read the base branch’s `REVIEW.md` for review.
Load the available `droidctl` and `hil-attach` skills before device work, and the
`pr-converge` skill plus `.github/prompts/pr-converge.prompt.md` at convergence.
Discover their actual locations; do not assume a skill or MCP is installed.
Read `docs/testing/maestro.md` before changing Maestro flows, and
`docs/c64/c64u-telnet.yaml` before Telnet work.

Classify implementation as `UI_CHANGE` or `DOC_PLUS_CODE`, and map affected source,
tests, docs, screenshots, variants, and platforms before editing. Stabilize the
real Pixel experience first. Focused regression tests accompany fixes; broad
coverage is a finalization gate after HIL deliverables are complete or explicitly
blocked, never a substitute for the device work.

Resolve these known constraints explicitly:

- **U64 reservation:** current `AGENTS.md` reserves `u64` for Software IEC and
  prohibits driving it. The three-device request does not establish that this
  reservation has ended. Check current allocation; if still reserved, ask only
  whether the owner/user releases it for this sweep. Continue independent work
  on `c64u` and `u2`. Until released, do not probe, reset, configure, or stop its
  streams, including via a harness’s default host list. Record U64 as blocked,
  not passed or equivalent to C64U. Do not declare the full sweep complete or tag
  the release with that required row unresolved unless the user explicitly narrows
  the release scope.
- **There is no physical Callback 8020 on the rig.** The Pixel 4 is the stand-in.
  Test the screen geometry and key semantics there; report that distinction.
  Do not create a future testing task that waits for the unreleased handset.
  Pixel timings do not prove the eventual handset’s CPU, battery, physical key
  matrix, or display readability. Satisfy low-cost rendering by construction and
  report the measurement limit without downgrading audio quality speculatively.
- **Android automation uses droidctl.** Install/uninstall, launch, shell, key
  injection, screenshots, logs, and display changes all go through it. CDP
  evaluation follows `hil-attach`; it does not permit raw adb for other work.
  Inspect harnesses before running them. At preparation time,
  `tools/hil/release_sweep_hil.mjs` and `tools/hil/hil_cdp.mjs` contain direct adb
  execution, and the sweep defaults to `c64u,u64,u2`. Migrate the necessary device
  operations to the supported interface or reproduce the stage through droidctl
  with equivalent evidence; do not silently run a legacy wrapper. If necessary
  tools are unavailable, record that concrete blocker and preserve the handoff.
- **Coverage rules disagree:** current `REVIEW.md` requires at least 91% global
  and changed-line branch coverage; `AGENTS.md` describes merged gates of 93%
  lines/85% branches; `codecov.yml` specifies 87% project and 94% patch targets.
  Re-read all three at execution time. Report each applicable gate separately,
  including the stricter review requirement; do not treat one green aggregate
  as satisfying them all or lower thresholds to complete the release.

## Code-informed investigation map

Read these implementations and their consumers, then follow concrete evidence
into other subsystems. Existing comments and historical reports are hypotheses,
not proof of present behavior.

| Area | Starting points | What the review suggests testing |
| --- | --- | --- |
| Startup and tour offer | `src/components/StartupLaunchSequence.tsx`, `src/components/DeviceDiscoveryInterstitial.tsx`, `src/components/tour/TourHost.tsx`, `src/lib/tour/tourState.ts` | Discovery/tour ordering, fresh install versus upgrade, skip/completion persistence, reconnect and restart |
| Tour rendering | `src/components/tour/TourDriver.tsx`, `src/lib/tour/{steps,spotlight,captionReveal}.ts` | Actual anchor visibility, overlay geometry, idle collapse, keyboard ownership, accessibility isolation |
| Layout and editions | `src/lib/displayProfiles.ts`, `playwright/displayProfileViewports.ts`, `variants/variants.yaml`, `variants/feature-flags/c64u-remote.yaml`, `src/index.css` | Physical pixels versus CSS pixels, automatic profile, bars/insets, enlarged text, real edition defaults |
| Navigation and discovery | `src/lib/input/`, `src/hooks/useFocusNavigation.tsx`, `src/lib/navigation/`, `src/components/search/`, `src/lib/search/`, `src/pages/home/components/HomeSearchField.tsx` | Focus scrolling, D-pad/T9 input, global shortcut collisions, search-to-control navigation, Back recovery |
| Music | `src/pages/playFiles/components/{SidRadioLauncherSheet,PlaybackControlsCard,PlaybackEngineToggle}.tsx`, `src/pages/playFiles/hooks/`, `src/lib/sidRadio/`, `src/lib/sid/`, `src/lib/hvsc/`, `src/lib/playback/` | Missing collection, first song, local versus remote output, loading/seek feedback, transport and queue continuity |
| Configuration | `src/pages/ConfigBrowserPage.tsx`, `src/pages/config/useConfigLeafWrite.ts`, `src/hooks/useC64Connection.ts`, `src/lib/c64api.ts` | Discoverability, authoritative readback, failure rollback, reconnect/device-switch identity, safe write cadence |
| Playing remotely | `src/components/remoteInput/RemoteInputSheet.tsx`, `src/hooks/useRemoteInputPhysicalKeys.ts`, `src/hooks/useRemoteInputGameMode.ts`, `src/lib/remoteInput/gameModeLaunch.ts`, `src/lib/deviceCapabilities/`, `src/lib/streams/` | Diamond8/classicT9 mappings, key release, input/view mode, no-picture recovery, U2 capability gates, stream ownership |

Specific starting observations to verify:

- The tour currently has 13 steps. `captionReveal.ts` hides only the body after
  six idle seconds when the measured caption occupies at least half the viewport.
  The progress, title, buttons, padding, and safe-area inset remain. Input restores
  the body. That is not evidence that a person actively navigating can see the app.
- `captionPlacement()` chooses top/bottom using space around the anchor without
  accepting caption height. Some steps highlight a tab rather than the feature
  being described. Measure occlusion and whether the spotlight teaches anything.
- The driver captures navigation keys and hides `#root` from assistive technology
  while describing the real app. Check the intended interaction model, real pointer
  hit-testing, focus visibility, and restoration; do not assume a spotlight hole
  makes its underlying control operable.
- Current tour body/title character-budget tests do not prove pixel visibility.
  `playwright/tour.spec.ts` starts at 393x727 and often advances by clicking Next.
  Add compact, real-key, transition, occlusion, and timing evidence where missing.
- “No network needed” in the music tour must be reconciled with a genuinely fresh
  installation: `SidRadioLauncherSheet` explicitly disables stations when HVSC
  is missing. Verify bundled/demo versus installed content and acquisition needs;
  do not start the newcomer test with a silently prepared music library.
- C64U Remote currently uses automatic display-profile selection, T9, diamond8,
  hidden game joystick, and automatic Game Mode on user game launch. Commander
  differs. The historical `docs/testing/hil-game-mode-8020-soak.md` describes older
  defaults and hardware allocations; reproduce its concerns without inheriting
  its obsolete allocation or treating its findings as still open.
- `startGameMode()` already gates streams using identified capabilities and tracks
  feeds started by the launch. Exercise races, unavailable capabilities, and device
  switching rather than adding a duplicate guard because an old report says so.

## Rig preparation and evidence

1. Record branch/base/commit, APK hash/version/package, variant, Pixel serial
   (prefer `9B0…`), Android/WebView versions, screen metrics, profile, text size,
   input mode, system insets, and device firmware/capabilities. Identify actual
   `c64u`/`u2` topology and any shared host computer; do not reset the host blindly
   when exercising its cartridge. Do not reuse old IP addresses as facts.
2. Preserve current playlists, settings, saved devices, relevant config values,
   and rig state using supported export/backup mechanisms. Use a recoverable test
   installation/profile for genuine first launch. Do not erase irreplaceable user
   data to get a clean screenshot. Replaying the tour from Docs is a separate test
   and does not replace first-install startup.
3. Test both packages: Commander `uk.gleissner.c64commander` across all released
   device allocations; C64U Remote `uk.gleissner.c64uremote` primarily on `c64u`,
   with cross-device capability/fallback checks when selectable. Respect its
   narrower product scope; do not advertise new supported hardware by inference.
4. Establish and record **320x426 CSS pixels** in portrait and the corresponding
   short landscape geometry. A 480x640 physical panel near DPR 1.5 is not a
   480x640 CSS viewport. Verify `innerWidth`, `innerHeight`, DPR, visual viewport,
   computed profile, and native insets. A rounded native height of 427 must be
   reported; keep the exact 426 test in browser regression coverage. Also check
   normal Pixel geometry, default/enlarged text, light/dark, and reduced motion.
5. Inject Android key down/up/repeat events through droidctl for HIL acceptance.
   Use DOM/CDP for measurement and diagnosis; DOM clicks, route injection, forced
   focus, or editing storage do not count as a newcomer successfully navigating.
   Record actual key/code/semantic mapping with Key Explorer. Cover D-pad/OK/Back,
   digits, `*`, `#`, and available function keys. Keep touch as a separate parity
   pass; never rescue a failed keypad journey with a click and mark it passed.
6. Keep evidence under a unique `artifacts/hil-first-impression-1.0.7-rc1/<run>/`
   directory and durable findings under `docs/testing/investigations/first-impression-1.0.7-rc1/`.
   For each case record state, steps/keys, device/edition/geometry, expected and
   observed result, timestamp, screenshot/short recording, app logs/request trace,
   and result: PASS, FAIL, BLOCKED, or capability-based N/A with explanation.
   Never commit secrets or large raw recordings. Link retained evidence from the PR.

## Sweep by newcomer journey

Run the primary journeys from first launch without explaining hidden shortcuts to
the imaginary user. Record elapsed time, action count, confusing decisions, visible
feedback, and recovery. Establish baseline measurements, then compare the fixes.
Do not invent passing usability measurements from code inspection.

| Journey | Required cases and observable outcome |
| --- | --- |
| First minute | Fresh launch with reachable device, no device, offline, failed hostname, wrong password, canceled discovery, and several saved devices. An understandable next action remains visible and key-reachable; no competing interstitials, stale spinner, surprise tour on upgrade, or false connected state. |
| Tour and exploration | Complete, skip early/late, go backward, pause to read, reveal the app, restore help, restart from Docs/Settings, rotate, enlarge text, connect/disconnect mid-step, and encounter missing/late anchors. The actual subject is recognizable; guide controls remain recoverable. |
| First SID song | Start with no imported music and no likes. Find Radio or import, understand HVSC/download/storage needs, cancel/retry acquisition, then play a calm station or known tune. Verify audible output and elapsed time, clear output destination, and honest offline availability. Separate prepared-library speed from installation/download time. |
| Enjoy music | Pause/resume/next/previous, subsongs, likes/dislikes, Recent/Last, local/remote handover where supported, seek before/after rendering, leave Play, search, lock/unlock, background/foreground, relaunch, and Wi-Fi loss/recovery. No stuck transport, overlapping players, lost queue, hidden wait, or unintended silence. |
| Change a setting | Find a setting through Config and search, read its meaning/value, edit a reversible low-risk item, read back the device value, navigate away/back, and restore it. Exercise select/slider/stepper, long labels/options, nested menus, failed write rollback, reconnect, and mid-load device switch. UI and device must agree. |
| Play remotely | Find/import a known safe game or probe, launch it through the UI, enter Game Mode, see a useful picture, steer/fire with both edition mappings, release held keys, use view controls, exit and return Home. Verify actual C64 response, not only an HTTP success or animated phone joystick. |
| Recover from mistakes | Wrong keys, long/repeated keys, Back through nested sheets, cancel dialogs, interrupted loads, missing content, offline action, no video, unsupported feature, rotation during overlay, and quick device changes. Focus remains visible and there is a clear way out without restarting. |
| Explore the rest | Walk all six main pages, Docs/help, disks/imports, settings/appearance, connection switcher, health/diagnostics, search, quick menu, and first-use empty/error states. Audit the CTA inventory against actual key reachability; follow additional problems found in these surfaces. |

Perform shared journeys on each allocated device, plus transitions
`c64u → u2 → c64u` and transitions involving `u64` once released. On U2, verify
supported music/config/disk paths and honest explanations for unavailable streaming,
input relay, and poweroff. Capture request evidence that unsupported actions do not
call `/v1/streams` or `machine:input` and do not poison a healthy device’s badge.
Capability N/A applies to unsupported operations, not to the fallback UX test.

## Tour redesign: show the app, guide the user

Treat the reported obscuration as a priority reproduction. Capture every step at
entry, after settling, after the current six-second delay, during repeated keypad
navigation, and after restoring text. Measure caption bounds, safe content area,
anchor bounds, overlap, and visible subject area; inspect the screenshots too.

Design and implement the smallest coherent improvement supported by those results.
Consider concise contextual coachmarks, a compact guidance strip, a user-controlled
“show me” state, progressive disclosure, or a gentle fade/collapse that gives the
space back. Choose by usability evidence. Merely shortening prose, waiting longer,
or making text translucent over other text is insufficient.

Acceptance criteria:

- Every anchored step offers a clear view of the actual subject and its purpose.
  In the normal compact presentation, target at least half of the usable app area
  remaining unobscured. Record the geometry per step; when a larger explanation
  needs more room, provide an explicit, key-reachable reveal mode that fully
  exposes the relevant control or representative part of a large section. A
  tiny highlighted tab alone does not demonstrate an entire feature.
- Establish usable area after native insets and persistent chrome, without
  double-subtracting insets. Measure actual occlusion by captions/scrims/chrome,
  not simply whether a DOM rectangle exists or a character budget passes.
- Text remains fully readable: at least 14 CSS px incidental, 16 px body; targets
  remain at least 44x44. Reflow or simplify instead of shrinking either.
- If guidance disappears automatically, the user can keep it visible, pause it,
  and bring it back deliberately through obvious keys and touch. No automatic
  step advance, required information lost to a timer, flickering expansion on
  every navigation key, or invisible control consuming input unexpectedly.
- Motion is gentle and cheap, respects reduced motion, and never creates a
  low-contrast mixture of caption and app text. Avoid perpetual animations,
  expensive blur, and needless timer/layout work on the low-power target.
- Define key ownership in guide and exploration modes. OK activates the visible
  selected action; Back has a predictable escape; repeat must not skip the tour
  accidentally. Hidden guidance cannot retain focus or steal game/input keys.
- TalkBack can read and operate the guide; focus is contained/restored correctly.
  If an exploration mode exposes app controls, its accessibility tree must agree.
  Recheck the existing root `aria-hidden` behavior on completion, skip, and error.
- Newcomers can leave the tour and immediately accomplish something worthwhile.
  Descriptions must reflect capabilities, variant defaults, and content readiness.
  Do not start playback or perform destructive machine actions just to demonstrate
  a step without an explicit user action.

## Hardware and audio discipline

Never raise Pixel media volume above **10/25**. Start measurements at the gate’s
low default (currently 3); use the lowest measurable level. Restore the original
level only if it is at most 10, otherwise leave it at or below 10 and report it.
Use Chill/Ambient or Melodic music, short measurements, and silence the selected
test machine between audible stages. Band-limit mic analysis to 300–6000 Hz and
verify the stimulus before grading. “Too quiet,” missing fixtures, and zero samples
are inconclusive, never success. Audible continuity needs audio evidence; a moving
elapsed timer alone is not enough.

Single config writes use PUT; coalesce rapid input. Keep Turbo Control and CPU speed
writes sequential. Do not stress clock/network/storage settings unnecessarily.
If a device drops off the network, stop app traffic, preserve diagnostics, and
investigate request patterns first. Physical power cycling remains ask-first.
Operate only on allocated devices and restore changed values after each scenario.

Avoid multicast contamination: only the selected test sender should feed the
measurement. Stop streams owned by this sweep before switching targets and verify
sender addresses/rates. If the reserved U64 is already transmitting, coordinate or
isolate the measurement; do not commandeer it to clean up the rig. Distinguish
Game Mode-owned feeds from listening explicitly started by the user.

## Fix, verify, and record

Maintain a finding ledger: ID, severity, reproducible journey, evidence, exact
source location/root cause, fix, failing-before/passing-after test, hardware retest,
and status. Fix confirmed issues within this mission, including non-crashing
usability failures. Separate unconfirmed observations and harness failures. Do not
hide unresolved findings under a generic “polish later” item.

For each fix, demonstrate the regression test failing without the production fix
in an isolated copy or reversible scoped change. Exercise production symbols,
not duplicated test logic. Test timer boundaries, repeated input, stale anchors,
orientation/text changes, and focus restoration deterministically where relevant.
Retest the corrected path on the Pixel and the affected device families.

Build and deploy the latest changed APK through droidctl during the device loop.
Check both variants’ actual generated metadata/defaults; forcing a CSS profile on
Commander does not constitute a C64U Remote build. Reattach CDP after relaunch and
keep the Pixel awake during foreground measurements. Restore display/density/CDP
overrides before coordinate-dependent standard merge-gate stages.

Update `docs/cta-inventory.md` whenever controls, labels, focus scopes/order, or
key operation change. Update affected user docs and manual generator sources;
keep the two manual editions distinct. Refresh only changed documented screenshots,
including compact and medium where affected, and inspect each retained image.

Once the HIL journeys are stable, run repository-required final validation:

- `npm run lint`, unit/contract tests, production build, and `npm run cap:build`;
  relevant Android JVM/native, c64scope, Python/HIL, or Maestro tests for changed
  layers. Read actual CI workflows before claiming their coverage.
- Targeted tour, keypad-only navigation, small-screen ergonomics/layout integrity,
  discovery/search, playback, device-switch, and capability regressions, followed
  by the full suites required for convergence.
- `npm run coverage:gate` for merged unit+E2E coverage and separate changed-line
  evidence against the PR base; verify the additional review/Codecov requirements
  identified above. Investigate all failures/warnings, never suppress gates.
- The mandatory nine-stage hardware merge gate on `c64u`, using a droidctl-compliant
  execution path: preflight, input, search-latency, wire, av-clarity, av-latency,
  sid-remote, sid-local, crossfade. Prepare known tone fixtures through supported
  import paths; do not overwrite indexed HVSC files. Preserve the canonical
  assertions and JSON result table. Intended runner interface after transport
  compliance is verified: `node tools/hil/merge_gate.mjs --host c64u --iface <LAN-IP> --json <run-dir>/hil-gate.json`.
  Baseline a failing stage against the base revision before attributing it to a fix.
- Per-device release sweeps: error census on **all six routes including Docs**,
  compact layout, at least six force-stop/relaunch cycles, three network recovery
  cycles, and at least 125 seconds screen-off with local playback. Inspect existing
  stage implementations: at preparation time the release sweep’s main-route list
  omits Docs. Extend or supplement coverage, and pass explicit permitted hosts.
  Do not run stream/input stages against U2 just to fill a matrix cell.

Report the full stage table and limitations. A blocked hardware requirement may
allow independent validation to continue, but it is not a successful release gate.
Do not substitute old artifacts for the final revision’s relevant verification.

## PR, adversarial review, merge, and release

1. Create a new focused PR with the problem and resulting behavior, representative
   before/after compact screenshots, journey/device/variant results, regression
   tests, coverage, and the hardware gate table. Keep raw artifacts separate and
   link their durable location. Include limitations and any user-approved scope
   change explicitly.
2. Have the independent reviewer attack the current diff against base-branch
   `REVIEW.md`, the original newcomer journeys, and this acceptance contract.
   Require file/line-anchored findings with severity and concrete corrections.
   Challenge timer-driven disappearance, readable-but-hidden controls, key
   swallowing/double activation, capability races, unsafe writes, false-positive
   tests, missing evidence, and release identity. A list of compliments is not a
   review. Fix findings and repeat affected tests/HIL until the review is clean.
3. Converge all GitHub feedback and CI using `gh` and the convergence workflow.
   Explain every review-thread resolution. Check required statuses on the current
   PR head, not an earlier commit. Reconcile merge-base changes and revalidate
   affected behavior; merge normally only after all release blockers are closed.
4. Fetch the merged state and identify the exact merged commit. Check local and
   remote tags/releases for `1.0.7-rc1` and the established optional `v` prefix.
   Create and push the new tag on that commit. Never move an existing tag or tag
   an unmerged PR head; a collision is a concrete blocker requiring direction.
5. Version identity comes from `scripts/resolve-build-version.mjs` and Git.
   Do not bump `package.json` merely to match a release tag. Observe all applicable
   tag-triggered workflows, including Android packaging, iOS CI-only validation,
   web/manual workflows where triggered, and prerelease asset publication. Confirm
   that GitHub marks the release as a prerelease and artifacts match the tagged
   source. `variants/variants.yaml` currently publishes Commander by default while
   CI builds both editions: verify the configured release selection rather than
   assuming a C64U Remote asset will be published or silently changing policy.
6. Install the final tagged build on the Pixel through droidctl and smoke-test
   first launch/tour, music, configuration, and remote play as applicable. Verify
   displayed version and commit identity. Prefer the latest APK in
   `android/app/build/outputs/apk/`; verify it actually belongs to the final source.
   If update installation is blocked, preserve needed app state before the
   repository’s uninstall/reinstall fallback. Leave the intended final package
   installed, restore rig settings, release keys/streams, and keep volume ≤10.

Finish with the PR URL, merged commit, exact tag and prerelease URL, artifact/build
identity, final Pixel deployment result, findings fixed, matrix and gate results,
tests/coverage, screenshot paths, and honest unverified hardware limits. If blocked,
leave a reproducible handoff with the exact blocker and remaining acceptance rows;
do not claim merge, tag, deployment, or verification that did not occur.
