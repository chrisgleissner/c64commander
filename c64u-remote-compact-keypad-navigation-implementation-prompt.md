# Prompt: Implement C64U Remote compact keypad navigation

## Objective

Fully implement the product interaction specification in
`c64u-remote-compact-keypad-navigation.md` for the C64U Remote variant of C64 Commander.
Treat that document as the target user-facing contract. Deliver the complete code,
tests, documentation, generated artifacts, and focused device validation needed to
make the specified keypad model real without weakening touchscreen operation.

Work in the current repository on a new dedicated branch. Do not implement directly
on the repository's default branch, rewrite history, or modify the target
specification unless the user explicitly asks. Preserve unrelated and concurrent
worktree changes.

The target compact keypad handset is not available for testing. Do not invent Android,
DOM, compatibility-layer, operating-system, or handset-specific event identities,
and do not leave a task blocked waiting for that unreleased handset. Build the specified semantic
behavior by construction, retain every tested-key fallback from the specification,
validate phone-side behavior on the attached Pixel 4, and report the remaining
Callback-only event-identity uncertainty accurately.

## Read before changing anything

Read these files completely, in this order:

1. `REVIEW.md`
2. `.github/copilot-instructions.md`
3. `AGENTS.md`
4. `README.md`
5. `docs/ux-guidelines.md`
6. `c64u-remote-compact-keypad-navigation.md`
7. `docs/keyboard-input.md`
8. `docs/cta-inventory.md`
9. `docs/manual/c64u-remote/c64u-remote-manual.md`

If the C64U Remote manual has moved, locate the unique file whose heading is
`# C64U Remote Manual`. Stop and report the problem if it cannot be identified
uniquely.

Inspect the current worktree before editing. Then trace the existing input path end
to end, including at least:

- `src/lib/input/` and all input profiles
- keyboard focus navigation and focus-group behavior
- T9 and text-field handlers
- global search, playback, page, Back, Menu, and Quick menu handlers
- `KeypadGuidanceBar`, `QuickMenu`, `RemoteInputSheet`, and related overlays
- Remote Input session state and physical-key relay
- joystick bindings, held-input cleanup, orientation, Live View, and View mode
- modal/interstitial stacking and Radix event handling
- `src/main.tsx`, `src/App.tsx`, relevant page components, and Android
  `MainActivity.kt`
- unit, component, Playwright, Maestro, and Android tests that exercise these paths

Search broadly for both `keydown` and `keyup`, `KeyboardEvent.key` and `.code`,
Android `KeyEvent`, repeat, long press, blur, visibility changes, lifecycle changes,
Back, Escape, Menu, soft keys, call keys, F1/F2/F3, Commodore, T9, Remote Input,
Game Mode, View mode, orientation, focus, and release-all behavior. Establish the
current event ownership and propagation rules before changing them.

## Branch and pull request

Before implementation, inspect the current branch, the configured remote and default
branch, and the worktree. Create a dedicated feature branch from the intended PR base
without discarding the existing untracked target specification or this prompt. Use
`feat/c64u-remote-compact-keypad-navigation` if that name is available; otherwise use a
clear unique suffix. Never make implementation commits on the default branch.

The final branch and pull request must contain the target specification, this
implementation prompt, all implementation changes, regression tests, documentation,
and required generated artifacts. Make coherent commits with concise messages, push
the branch to the repository's normal remote, and open a pull request against the
default branch with `gh` or the repository's established GitHub workflow. Do not
force-push and do not merge the pull request.

The pull-request description must include:

- a concise user-visible summary;
- the input-routing and held-key safety approach;
- tests, builds, coverage, screenshots, Pixel 4 deployment, and focused HIL evidence;
- the hardware targets actually used;
- the precise target-handset event identities that remain unverified and their
  tested-key fallbacks.

After opening the pull request, inspect its checks and review state. Address failures
caused by this branch and leave the PR green and reviewable when the available CI has
finished. Do not hide failures, dismiss review feedback without evidence, or claim
checks passed before they completed.

## Required implementation

Implement the definitive mapping and behavior in
`c64u-remote-compact-keypad-navigation.md`, including all deliberate unassigned and
OS-reserved decisions. The following requirements are acceptance constraints, not
optional suggestions.

### Central event ownership

Create one coherent semantic input-routing model with this precedence:

1. OS lifecycle and safety cleanup
2. the owner of an already-held key
3. topmost dialog, sheet, item menu, Quick menu, or Controls overlay
4. focused text entry
5. View adjustment
6. Remote Input or Game Mode C64 relay
7. normal-context global shortcuts
8. normal focus navigation

One physical event must be handled by at most one layer. Once claimed, prevent
lower-priority app handlers and browser defaults where appropriate. A `keyup` must
return to the owner recorded for its matching `keydown`, even if focus, orientation,
or mode changed while the key was held. Components should consume semantic actions,
not duplicate raw platform-key knowledge.

Define repeat policy centrally:

- ignore repeat for activation, Back, Menu, global shortcuts, playback commands,
  mode changes, reset, and other one-shot actions;
- allow repeat only for D-pad movement, list/slider adjustment, View panning or
  zooming, and text deletion where the specification permits it;
- never turn keyboard repeat into repeated C64 press/release pairs.

### Normal navigation and global keys

Implement the specified behavior for every D-pad direction, D-pad Centre/OK, both
soft keys, Send/Call, End Call, F1, Commodore C=, F3, digits `0`-`9`, Star, and
Pound. In particular:

- Left Soft Key is the semantic Back action and Right Soft Key is the semantic Menu
  action when their emitted events can be mapped safely.
- D-pad Centre/OK and Send/Call share the semantic OK action; D-pad Centre/OK remains
  the tested fallback.
- End Call has no application binding. Lifecycle/background handling must still
  release held C64 inputs.
- normal-context shortcuts include `1`-`7`, `0`, Star, and Pound as documented in
  the specification, plus `8` for C64 pause/resume and `9` for a confirmation dialog
  before reset. A single press must never execute a destructive device action.
- F1 and F3 are playback controls only where Playback is allowed by the context
  stack. Commodore C= is Search only after its actual event identity is known; `7`
  remains the unconditional Search fallback. Do not guess a raw binding.

Focus must enter, move within, and leave groups predictably. If lateral movement
cannot continue inside a group, it moves to the adjacent group; Up and Down move
between groups. Newly focused controls must scroll fully into view. All focusable and
touchable targets must satisfy the repository's compact-screen size and text floors.

### Dialogs, sheets, menus, and overlays

The topmost surface exclusively owns input. Back closes only that surface. OK
activates its focused primary control. Menu performs only a surface-specific action
explicitly shown in the guidance bar; otherwise it does nothing. Digits must not run
page or device shortcuts while a surface is open.

Right Soft Key/Menu opens an item menu when the focused item has one, otherwise the
Quick menu. In Remote Input, Game Mode, and View adjustment it opens the Controls
overlay instead of the page Quick menu. Ensure each overlay can be opened, fully
operated, and closed without touch.

### Text entry

Preserve text-entry integrity:

- digits, Star, and Pound belong exclusively to T9 while a text field is focused;
- D-pad Left/Right move the caret and Up/Down change field or suggestion as defined
  by the field;
- D-pad Centre/OK and Send/Call commit the current T9 candidate and submit only when
  that field exposes an explicit submit action;
- Right Soft Key deletes one character and may repeat; Left Soft Key commits the
  candidate and leaves the field;
- F1, Commodore C=, and F3 do nothing in text entry;
- leaving the field must not leak the same press into navigation or a global
  shortcut.

Keep touch editing fully functional.

### Playback

F1 toggles play/pause and F3 advances only in the normal app context, including the
Playback page. Suppress both in text entry, any modal surface, Remote Input, Game
Mode, and View adjustment. Playback controls in the UI remain focusable and
touchable.

### Remote Input and Game Mode

Implement the specified Controls overlay and Game quick overlay, including visible,
focusable Watch, Listen, View, Keys, release-inputs, Close, and Exit actions where
applicable. Pound is the tested fallback for opening the overlay. Right Soft Key/Menu
is the preferred action only when its event is available. The overlays, the on-screen
key surface, and every recovery path must remain usable with D-pad and OK alone.

In Remote Input keys-surface mode, D-pad navigates the on-screen keys and OK or
Send/Call activates the focused key. Back returns to Controls; Menu returns to
Controls when it does not expose an item action. App navigation and global shortcuts
must not leak into C64 input.

For Game Mode:

- implement the built-in Diamond 8 layout and preserve Classic T9 and Custom layouts;
- assert joystick directions/fire on non-repeat `keydown` and release the same input
  on matching `keyup`;
- support simultaneous directions where the configured layout and device allow it;
- consume mapped game digits so they cannot navigate the app;
- on orientation change, release all held inputs before applying the rotated mapping;
- on overlay open, mode change, blur, visibility loss, pause/background, session
  error, disconnect, and unmount, synchronously clear local held state and send or
  queue release-all as safely as the current transport permits;
- never leave the user trapped when Live View is hidden, unavailable, or unsupported.

### View adjustment

Star is the only keypad toggle between C64 control and View adjustment. Remove any
ambiguous dependency on a generic Menu event for that transition. In View adjustment,
implement the specified numeric pan/zoom/fit mapping, OK/Send tracking lock, Back to
C64 control, Menu to Controls, and Pound fallback to Controls. `Watch: Off` must
return immediately to C64 control. If Watch is unavailable, attempting to enter View
adjustment must open Controls with Watch focused instead of entering a dead mode.

### Guidance and touch parity

Make the compact guidance bar accurately describe the current Back, OK, and Menu
semantics using the physical names `Left Soft Key`, `D-pad Centre/OK`, and
`Right Soft Key` where space permits, with an accessible compact presentation where
it does not. Update it immediately when focus, mode, or topmost surface changes.

Touch must continue to perform every existing task and should remain a convenient
alternative, but every frequent action and every action needed to recover or leave a
mode must be possible with physical-key semantics alone.

## Architecture and safety constraints

- Prefer the smallest coherent change compatible with the existing input-profile and
  focus-navigation architecture. Do not preserve distributed handlers that allow the
  same event to fire twice.
- Keep platform-event aliases centralized and evidence-based. Tests may synthesize
  documented semantic actions but must not be presented as proof of a target handset
  event identity.
- Preserve browser/web keyboard operation and Android behavior unless the target
  specification intentionally changes them.
- Integrate with modal libraries at the correct capture/bubble phase so default
  activations and app handlers cannot both execute.
- Do not silently catch exceptions. Log with context and a full stack or rethrow with
  context.
- Do not alter device configuration write semantics or broaden network traffic.
- Never bind an easy unconfirmed press directly to reset, power, or another destructive
  command.
- Do not use long presses or multi-key chords unless existing runtime behavior already
  proves them reliable; none are required by the target specification.

## Tests and documentation

Add focused regression coverage at the narrowest useful layers. Every fixed defect
must have a test that fails without the fix. Cover at least:

- raw-event normalization into semantic actions;
- context precedence and single-consumer behavior;
- repeat suppression and allowed repeat cases;
- keydown-owner/key-up-owner pairing across focus, mode, and orientation changes;
- normal shortcuts, reset confirmation, and suppression in higher contexts;
- dialogs, sheets, item menus, Quick menu, and Controls overlay ownership;
- T9 digits, Star, Pound, deletion, commit, submit, exit, and global suppression;
- F1/F3 playback behavior and suppression in every forbidden context;
- Remote Input keys-surface navigation and recovery;
- Game Mode simultaneous holds, rotation, overlay transitions, session failure, and
  release-all boundaries;
- View adjustment entry, mapping, exit, Watch-off auto-return, and unavailable-Watch
  recovery;
- End Call remaining unbound and lifecycle cleanup still occurring;
- Commodore C= remaining unbound until verified while `7` continues to open Search;
- no event being processed both as app navigation and as C64 input.

Extend keypad-only Playwright coverage without using `click()` or `tap()` for the
keypad acceptance path. Exercise the compact 320x426 profile, visible focus,
scroll-into-view, target sizes, and opening/operating/leaving every major mode. Add or
update separate touch coverage to prove parity. If native Android mapping changes,
add focused Android JVM tests.

Update the source-of-truth user documentation so it matches the implemented behavior:

- the C64U Remote manual;
- `docs/keyboard-input.md`;
- `docs/cta-inventory.md`, including hierarchical keypad reachability;
- any generated manual source rather than an output-only copy, if applicable.

Remove the contradictory F2/Menu and unbound-Commodore wording. Never use the vague
phrase “menu key” without naming the physical key and its fallback. Keep the manual's
hardware-verification caveat honest. Regenerate only screenshots whose visible
surfaces actually changed, using the repository's established screenshot workflow.

## Validation workflow

Classify this as a UI plus code and documentation change. Follow the repository's
real-target-first workflow:

1. Run the smallest relevant baseline tests before editing when practical.
2. Implement in small, reviewable increments and run focused tests after each input
   layer changes.
3. Validate the keypad-only flows at the compact viewport and the relevant touch
   flows.
4. For Android device work, load and follow the repository's `droidctl` skill. Use
   droidctl only, never raw `adb`. If droidctl is unavailable, report that concrete
   blocker and do not substitute raw adb.
5. Use the attached Pixel 4 as the phone-side validation target. Never set its media
   volume above 10/25; audible testing is not expected for this work.
6. The U64 is reserved and must not be driven. If C64 input or stream capability needs
   device evidence, use `c64u` and verify capability-gated behavior on `u2`; do not
   assume U2 has Streams or machine input.
7. After the behavior is stable, run the repository-required validation appropriate
   to the touched files, including:

   ```bash
   npm run lint
   npm run test
   npm run test:e2e
   npm run build
   npm run cap:build
   npm run coverage:gate
   ```

   Also run `cd android && ./gradlew test` if Android code changes. Investigate every
   error, warning, assertion failure, flaky result, and generated-artifact drift; do
   not suppress or skip failures.

8. Deploy the newest APK to the attached Pixel 4 through droidctl, launch it, and
   repeat the affected keypad and touch flows. Confirm lifecycle/background cleanup
   releases held C64 input. Record which C64 target, if any, was used.

Use focused hardware evidence proportional to the input and Live View changes,
including the relevant `preflight`, `input`, and `wire` hardware-gate stages when the
rig is available. Run the complete hardware merge gate if the pull request is also
being made merge-ready, converged, shipped, or released. Follow its volume and target
rules exactly, save the JSON artifact in the repository's normal artifact location,
and report every stage rather than reducing failures to a single pass/fail claim.

## Completion criteria

Do not declare completion until all of these are true:

- every physical key in the target specification has the specified decision in every
  relevant context;
- each event has exactly one owner and no press can trigger both app and C64 behavior;
- held C64 inputs are released on every ownership, mode, orientation, lifecycle,
  failure, and teardown boundary;
- normal navigation, dialogs, text entry, Remote Input, Game Mode, View adjustment,
  Controls, and exit/recovery paths work without touch;
- touchscreen behavior remains supported;
- destructive device actions require confirmation;
- compact focus visibility, target size, and text-size requirements pass;
- manual, keyboard reference, CTA inventory, hints, code, and tests agree;
- only genuinely unknowable target-handset event identities or OS interception remain
  listed as unverified, each paired with its tested-key fallback;
- the latest APK is installed and the affected behavior is validated on the Pixel 4,
  or a concrete droidctl/device blocker is reported without claiming completion;
- no unrelated files were changed;
- the complete work is committed on the dedicated branch, pushed, and represented by
  an open pull request against the correct base branch.

In the final report, state only what was actually done: user-visible behavior,
important architecture changes, tests/builds and their results, regenerated
screenshots, APK deployment and Pixel 4 result, C64/U2 evidence if used, and the exact
target-handset-only uncertainties that remain. Include the branch name and pull-request
URL. Do not claim testing on the unavailable target handset.
