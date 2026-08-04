# Game Mode — implementation plan

**Implements:** [`game-mode.md`](./game-mode.md) in full — GM-1 … GM-21.
**Intended for:** one working session, start to green, **with no further input from the
user**. Every design decision is already made in the spec; where this plan reaches a fork it
states the choice and the reason rather than asking.
**Deliverables:** code, unit + component + E2E tests, regenerated screenshots, regenerated
manuals, an updated CTA inventory, and all pre-push gates green.

---

## 0. How to use this plan

Work the phases in order. **Each phase ends green** — its own tests pass and `npm run typecheck`
is clean — so an interruption never leaves the tree in a state the next phase has to guess at.

Three traps are encoded in the phases where they bite; they have each cost a red CI run here
before, so do not shortcut them:

1. **`npm run typecheck`, never bare `tsc --noEmit`** — CI typechecks two projects
   (`tsconfig.app.json` and `tsconfig.node.json`). The root config accepts things the app
   project rejects.
2. **`npm run screenshots` rewrites the whole corpus** with machine render drift, and the
   prune step does not revert it. Phase 9 gives the recipe for keeping only the intended
   files.
3. **Never `git add -A`.** A local build rewrites `THIRD_PARTY_NOTICES.md`,
   `package-lock.json` and `c64scope/package-lock.json`.

Coverage matters: the patch gate is **91%** on merged unit + E2E coverage. Every phase that
adds a pure module also adds its unit test in the same phase, which is what keeps the gate
reachable without a scramble at the end.

---

## Phase 0 — Preflight

```bash
git checkout -b feat/game-mode
npm run typecheck                 # must already be clean
npx vitest run --silent 2>&1 | tail -20
```

A red baseline is not this change's problem, but it must be known before anything is
attributed to it. If the baseline is red, note which tests and continue; do not fix
unrelated failures in this branch.

Hardware is **not** needed until Phase 11 and is not a gate for the code phases.

---

## Phase 1 — The pure core (no UI)

Three modules, all pure, all fully unit-tested before anything renders them. This is the
whole of the risky logic, isolated from React.

### 1.1 `src/lib/remoteInput/joystickKeyBindings.ts`

Replaces `joystickDigitalMapping.ts` as the resolver (spec §6).

```ts
export type JoystickSlot = "up" | "upRight" | "right" | "downRight"
                         | "down" | "downLeft" | "left" | "upLeft" | "fire";
export type JoystickKeyBinding = Partial<Record<JoystickSlot, SemanticAction>>;
export type JoystickLayoutId = "diamond8" | "classicT9" | "custom";
export type DeviceRotation = 0 | 90 | 180 | 270;

export const DIAMOND8_BINDING: JoystickKeyBinding;   // up:digit5 left:digit7 right:digit9 down:digit0 fire:digit8
export const CLASSIC_T9_BINDING: JoystickKeyBinding; // today's T9_JOYSTICK_MAP, slot-shaped
export const RESERVED_ACTIONS: ReadonlySet<SemanticAction>; // star, openMenu, hash, back

export const rotateSlot: (slot: JoystickSlot, rotation: DeviceRotation) => JoystickSlot;
export const resolveJoystickInputs: (
  action: SemanticAction, binding: JoystickKeyBinding, rotation: DeviceRotation,
) => JoystickInputName[];
export const loadJoystickLayout / saveJoystickLayout / loadCustomBinding / saveCustomBinding;
export const bindingForLayout: (id: JoystickLayoutId, custom: JoystickKeyBinding) => JoystickKeyBinding;
```

`resolveJoystickInputs` keeps the D-pad map as an always-on addition (spec §6.5) and rotates
it under the same permutation. Keep `joystickDigitalMapping.ts` exporting
`t9KeyToJoystickInputs` / `dpadActionToJoystickInputs` as thin wrappers **only if** other
callers exist (`grep -rn "joystickDigitalMapping" src tests`); if the sheet is the sole
caller, delete the module and fold
`tests/unit/lib/remoteInput/joystickDigitalMapping.test.ts` into the new binding test rather
than leaving a shim nobody uses. Check for a second suite before deleting — `diskMount.ts`
is covered by two files in different directories, and only one of them was found the first
time it mattered.

### 1.2 `src/lib/remoteInput/deviceRotation.ts`

```ts
export const quantiseRotation: (degrees: number, previous: DeviceRotation) => DeviceRotation;
export const frameRotation: (device: DeviceRotation, window: DeviceRotation) => DeviceRotation;
export const unrotateDelta: (dx: number, dy: number, theta: DeviceRotation) => { x: number; y: number };
export const unrotatePoint: (
  clientX: number, clientY: number, centre: { x: number; y: number }, theta: DeviceRotation,
) => { x: number; y: number };
```

`quantiseRotation` uses 90° sectors with the **20° hysteresis band** and returns `previous`
inside the band. `ORIENTATION_UNKNOWN` (-1) returns `previous`. `unrotateDelta` /
`unrotatePoint` implement `R(θ)` exactly as spec §4.5 writes it — CSS convention, `+y` down.

### 1.3 `src/lib/remoteInput/gameModeJoystick.ts`

```ts
export type JoystickVisibility = "visible" | "hidden";
export type GameModeJoystickSetting = "auto" | JoystickVisibility;
export const resolveJoystickVisibility: (input: {
  setting: GameModeJoystickSetting;
  keyDriven: boolean; // a physical key has steered the game this session
  requested: JoystickVisibility | null; // what the toolbar was asked for, or null
  videoLive: boolean;
}) => JoystickVisibility;
```

The never-blank guard comes first: `videoLive === false` ⇒ `"visible"`, whatever else says
(GM-6). Then the toolbar answer, then an explicit setting, then `keyDriven`.

### 1.4 Tests — `tests/unit/lib/remoteInput/`

| File | Covers |
| --- | --- |
| `joystickKeyBindings.test.ts` | The §6.3 table asserted **cell by cell** for 0/90/180/270 (GM-5/GM-8); Classic T9 at rotation 0 resolving identically to the old `T9_JOYSTICK_MAP` (regression guard); diagonal rotation; fire invariance; reserved-action rejection; persistence round-trip; malformed stored binding rejected |
| `deviceRotation.test.ts` | Sector boundaries; 10° past a boundary does **not** switch and 25° past does; `ORIENTATION_UNKNOWN`; `frameRotation` including the portrait-lock short-circuit; `unrotateDelta`/`unrotatePoint` against hand-computed values at all four angles |
| `gameModeJoystick.test.ts` | The full truth table of setting × `keyDriven` × `requested` × `videoLive`, never-blank guard first; a preference stored under the old `always`/`never` value names |

**Gate:** `npx vitest run tests/unit/lib/remoteInput && npm run typecheck`

---

## Phase 2 — Native rotation detector

### 2.1 `android/app/src/main/java/uk/gleissner/c64commander/DeviceRotationPlugin.kt`

Capacitor plugin, modelled on `DeviceDiscoveryPlugin.kt` for registration shape:

- `addListener("deviceRotation")` registers an `OrientationEventListener(context, SENSOR_DELAY_UI)`;
  the listener is created on the first subscriber and `disable()`d on the last removal.
- `onOrientationChanged(degrees)`: `ORIENTATION_UNKNOWN` → emit nothing; otherwise quantise
  (mirror the JS sectors + hysteresis) and `notifyListeners("deviceRotation", { rotation })`
  **only on change**.
- Register in `MainActivity.kt` alongside the other plugins.

Keep the quantiser `internal` so it is unit-testable.

### 2.2 `android/app/src/test/java/uk/gleissner/c64commander/DeviceRotationPluginTest.kt`

Robolectric, matching `BackgroundExecutionPluginTest.kt`'s style: sector mapping, hysteresis,
`ORIENTATION_UNKNOWN` held, and no duplicate emission for an unchanged value.

### 2.3 `src/hooks/useDeviceRotation.ts`

- Subscribes through `Capacitor.isPluginAvailable("DeviceRotation")` — **not** merely
  `isNativePlatform()`. `StreamUdp` shipped an unconditional call that rejected
  "not implemented" on every iOS launch; do not repeat it.
- Applies the **250 ms dwell** (spec §4.3) before publishing.
- Exposes `{ deviceRotation, frameRotation, source: "auto" | "pinned", pin, clearPin }`.
  `frameRotation` reads `screen.orientation.angle` **only** when
  `loadScreenOrientationMode() !== "portrait"`; under portrait lock it is a hard 0.
- Where the plugin is unavailable, `deviceRotation` is a constant 0 and `pin` still works.

**Gate:** `npx vitest run tests/unit/hooks/useDeviceRotation.test.ts && cd android && ./gradlew :app:testDebugUnitTest`

---

## Phase 3 — Launch plumbing

### 3.1 `src/lib/remoteInput/gameModeLaunch.ts`

```ts
export interface RemoteInputLaunchRequest { epoch: number; mode: "joystick"; immersive: true }
export interface GameModeStartResult { startedVideo: boolean; startedAudio: boolean }
export const startGameMode: (opts?: { session?: AvMirrorSession }) => Promise<GameModeStartResult>;
export const subscribeGameModeRequest / requestGameMode;   // window-event bus
```

`startGameMode` starts video when `video_mirror_enabled` **and** `loadMirrorC64Video()`, audio
when `audio_mirror_enabled` **and** `loadMirrorC64Audio()`, records what it started, and emits
the launch request. Use the existing window-event bus pattern from `keypadCommands.ts` — Home
and Play each own their own sheet instance, and a module-level requester is how the `0`
shortcut reaches whichever page is mounted.

### 3.2 `appSettings.ts` + `AvMirrorControls.tsx`

Add `DEFAULT_MIRROR_C64_VIDEO = true`, `loadMirrorC64Video`, `saveMirrorC64Video`
(key `c64u_mirror_c64_video`), and have the Watch button write it exactly as Listen writes
`saveMirrorC64Audio` today.

### 3.3 Tests

`tests/unit/lib/remoteInput/gameModeLaunch.test.ts` — flags off, preference off, both on,
already-running streams (idempotent, `startedX` false), and the returned result driving the
stop rule.

**Gate:** `npx vitest run tests/unit/lib/remoteInput tests/unit/lib/config`

---

## Phase 4 — Remote Input sheet

`RemoteInputSheet.tsx` is 594 lines before this change and the guardrail is ~600. **Extract
first, then add**, or the file ends the phase at 800.

### 4.1 Extract (no behaviour change, run the existing tests after)

| New hook | Moves out of the sheet |
| --- | --- |
| `src/hooks/useRemoteInputPhysicalKeys.ts` | `handlePhysicalKeyDown` / `handlePhysicalKeyUp`, the held refs, `recomputePhysicalHeldSet`, the four cleanup effects |
| `src/hooks/useRemoteInputGameMode.ts` | `immersive` / launch-request handling, the stream-stop-on-close rule |

Run `npx vitest run tests/unit/components/remoteInput` — it must be green before 4.2 starts.

### 4.2 Add

- Resolve physical keys through `resolveJoystickInputs(action, binding, deviceRotation)`.
- Report a relay to the sheet via `onJoystickKeyRelayed` (GM-6a), and still set the
  app-wide `setInputModality("key-navigation")` for the focus ring on the next screen.
- Re-run `recomputePhysicalHeldSet` on **every** `deviceRotation` change (GM-9).
- Render `VirtualJoystick` / `TypeKeyboard` per `resolveJoystickVisibility`; hiding is
  delayed by `CONTROLS_HIDE_MS` unless it was explicitly asked for, showing is immediate.
- **Delete** the `remote-input-collapse-chrome` button and the `chromeCollapsed` toggle path;
  game mode always collapses the chrome. Keep `remote-input-restore-chrome`.
- `#` toggles an overlay row = `QuickKeysBar` + `AvMirrorControls`
  (`remote-input-quick-keys-toggle`), auto-hiding on the same idle timer.
- Host the rotation override (`remote-input-rotation-override`, Auto/0/90/270, per-session).

### 4.3 Tests — `tests/unit/components/remoteInput/RemoteInputSheet.test.tsx`

GM-6, GM-6a, GM-6b, GM-9, GM-11, GM-14, plus: a launch request opens joystick + immersive;
controls hidden with the picture live and **shown with the picture off**; the `#` overlay
carrying Watch/Listen; tier downgrade still drops out of immersive.

> The GM-9 test is the load-bearing one: hold a key, change rotation, assert **one** held-set
> update that releases the old input and asserts the new one. Verify it fails without the
> fix (`prove-load-bearing`).

**Gate:** `npx vitest run tests/unit/components/remoteInput && npm run typecheck`

---

## Phase 5 — Mirror rotation and full-space sizing

`AvMirrorImmersive.tsx`:

- New `rotation` prop + `data-rotation` on the root.
- Stage carries `transform: rotate(-frameRotation deg)`; the canvas transform is untouched.
- Every pointer handler routes client deltas and points through `unrotateDelta` /
  `unrotatePoint` **before** the viewport maths. Divide by the **unrotated** stage size.
- Measured fit via `ResizeObserver` replacing the fixed `aspectRatio` box; aspect swaps at
  90/270.
- Zoom cluster, minimap and mode chip stay unrotated.
- `RemoteInputSheet` drops `className="mx-4"` in game mode; `VirtualJoystick` stops reserving
  its action zone when the controls are hidden.

**Tests:** `tests/unit/components/streams/AvMirrorImmersive.test.tsx` — `data-rotation`
reflects the prop; a drag at 90° pans the axis the player sees (assert the `panBy` argument,
not a pixel); the fit calculation at both aspects. jsdom has no layout, so drive the
`ResizeObserver` through a mock and assert the computed size from the pure helper.

**Gate:** `npx vitest run tests/unit/components/streams && npm run typecheck`

---

## Phase 6 — Entry points

1. **Home tile + reorder** (`MachineControls.tsx`, spec §3.2.1). Reorder the **JSX** — the
   ring follows the DOM, not `focusOrder`. Move safe extra actions ahead of the destructive
   block and destructive extras into it. Renumber `focusOrder` to match the new DOM order.
2. **Play button** (`PlayFilesPage.tsx`) — `play-open-game-mode`, first in the row when
   `!isSongCategory(currentItem.category)`.
3. **`0` shortcut** (`useFocusNavigation.tsx`) — beside the tab digits, inheriting the
   text-field and open-overlay exclusions; calls `requestGameMode()`.
4. **Quick Menu entry** (`KeypadQuickMenu.tsx`).
5. **Guidance-bar hint** (`guidance.ts` + `KeypadGuidanceBar.tsx`) — label policy stays in the
   pure `resolveGuidanceLabels`.
6. **Auto-enter on launch** (`usePlaybackController.ts`) — the four conditions of GM-18.
7. **Picker confirm** (`PlayFilesPage.tsx`) — compute `confirmLabel`/action from the selection
   (GM-20). `ItemSelectionDialog` itself is untouched.

**Tests:** `tests/unit/pages/` for the Home tile order (assert rendered order, not props), the
Play button and its ordering rule, the `0` shortcut and its exclusions, and one test per
GM-18 condition asserting the sheet does **not** open.

**Gate:** `npx vitest run tests/unit/pages tests/unit/hooks && npm run typecheck`

---

## Phase 7 — Settings and variant defaults

1. `variants/variants.yaml`: `default_joystick_key_layout: diamond8` and
   `default_game_mode_on_launch: true` under `c64u-remote.runtime`.
2. `scripts/generate-variant.mjs`: validate both (allowlist / `requireBoolean`), emit
   `defaultJoystickKeyLayout` and `defaultGameModeOnLaunch`.
3. `npm run variant:generate` — commit the regenerated `src/generated/variant.ts` and
   `variant.json`.
4. `SettingsPage.tsx`: the four controls of spec §7 with the copy given there, testids
   `settings-joystick-key-layout`, `settings-joystick-bind-<slot>`,
   `settings-game-mode-joystick`, `settings-game-mode-on-launch`. Press-to-bind captures the
   next physical key into the focused slot and rejects reserved actions with the message
   naming their existing role.

**Tests:** `tests/unit/scripts/generateVariant.test.ts` for the two new keys (invalid value
rejected); a Settings test for press-to-bind and reserved-action rejection.

**Gate:** `npm run variant:check && npx vitest run tests/unit/scripts tests/unit/pages/SettingsPage*`

---

## Phase 8 — End-to-end

`playwright/`:

- **New** `gameMode.spec.ts` — Home tile and Play button both open the sheet in game mode;
  the Play ordering rule for a `prg` versus a `sid` item; rotation driven through
  `remote-input-rotation-override` (this is why the override is not only a fallback — it makes
  the feature testable with no sensor).
- **Extend** `remoteInputKeypadReachability.spec.ts` — `0` from Home, Play and Settings; the
  Quick Menu entry; the Home ring's first Quick Action stop is Game Mode; **every destructive
  tile ring-visits after every safe one** (GM-19). Assert the **ring order**, not the
  `focusOrder` props — a test reading the props would pass while the grid was wrong.

**Gate:** `npm run test:e2e -- --grep "game mode|keypad reachability"`

---

## Phase 9 — Screenshots

Update `playwright/screenshots.spec.ts` first: the `remote-input-collapse-chrome` click is
gone, and three captures are added.

| File | State |
| --- | --- |
| `home/remote-input/02-game-mode.png` | **Changes** — no Hide controls button |
| `home/remote-input/07-game-mode-keys.png` | **New** — controls hidden after a key steered the game |
| `home/remote-input/08-game-mode-rotated.png` | **New** — rotation pinned to 90° |
| `home/00-overview-light.png`, `home/01-overview-dark.png` | **Change** — the tile reorder |

Then:

```bash
npm run screenshots
git status --porcelain docs/img | awk '{print $2}' \
  | grep -vE 'home/remote-input/(02-game-mode|07-game-mode-keys|08-game-mode-rotated)\.png|home/0[01]-overview' \
  | xargs -r git checkout --
git status --short docs/img          # exactly the five intended files
```

**This revert step is mandatory.** A full screenshot run rewrites roughly 200 PNGs with this
machine's render drift (84% on launch fades, 0.05% on untouched Config pages) and the prune
step does not revert them. `AGENTS.md`'s minimal screenshot rule is the standing instruction;
this command is how it is obeyed.

---

## Phase 10 — Documentation

1. **`scripts/build-manuals.mjs`** — never `docs/manual/**/*.md`, which is generated and would
   be silently overwritten.
   - **Remote Input chapter** (~line 1383): the two entry-point bullets gain Game Mode; the
     "For distraction-free play, tap **Game mode**" paragraph (~1407) is rewritten for the new
     meaning — one action, the control surface following how you drive, **Hide controls**
     gone. The numbered "To steer a game you have just launched" list (~1419) becomes the
     one-action flow. Add the television sentence: *"Playing on a television? Turn Watch off
     once and Game Mode will keep opening without the picture."*
   - **Live View chapter** (~line 1293): the keypad keystroke table stays accurate to the new
     `handlePhysicalKeyDown`; add `#` for the quick keys and the Live View switches.
   - **Number Keys appendix** (~line 722): add `0` → Game Mode.
   - **C64U Remote edition only**: the 8-centred default and the orientation table.
   - Use `targetDeviceShortName` / `appDeviceName`; never literal device names. The broad
     edition must not name the handset — a `buildManuals` unit test enforces it.
   - Wire the two new images through the existing `image(...)` helper.
2. `npm run manuals:build`, then commit only `docs/manual/**/*.md` (the PDFs and
   `.last-build` are git-ignored).
3. **`docs/cta-inventory.md` — mandatory, same change.** §4.1's Home hierarchy is listed in
   ring order, so the reorder changes it even where nothing is added. Add the new testids;
   **remove** `remote-input-collapse-chrome`; add `0` to §1's device model and §2's navigation
   summary.
4. **`docs/features-by-page.md`** — Game Mode on Home and Play.
5. `docs/plans/game-mode/game-mode.md` — add an **As-built** section in the style of
   `06-av-mirror-ux.md` §8: what shipped as designed, and any deviation with its reason.

**Gate:** `npx vitest run tests/unit/scripts/buildManuals*`

---

## Phase 11 — Hardware verification (Pixel 4 + c64u)

Per `AGENTS.md`, nothing here is gated on the 8020.

```bash
./build --install-apk                 # then re-attach: a rebuild invalidates the CDP forward
```

1. `hil-attach` skill: confirm the phone and c64u are healthy **before** concluding anything.
   Re-read `/etc/hosts` — the IPs are DHCP-volatile and a stale IP mimics a dropout.
2. Drive keys through CDP `Input.dispatchKeyEvent` with a **hold** between `rawKeyDown` and
   `keyUp`. Single `adb shell input keyevent` taps are missed: the machine polls the matrix
   once per frame.
3. Read **`$DC00`** through c64bridge (port 2, active low) to prove which direction reached
   the machine — not the app's own state. Assert the §6.3 table at 0°, 90° and 270° with the
   override pinned, then repeat one orientation on **Auto** with the phone physically turned
   (the app is portrait-locked, so the layout will not follow and the sensor path is what is
   under test).
4. Confirm audio is sounding, and if it is in question at all use
   `tools/hil/audio_e2e_probe.py` rather than listening.
5. Record the results in the As-built section, and state plainly which three items remain
   unverifiable until the handset ships (spec §10.5) rather than carrying them as open work.

---

## Phase 12 — Gates and commit

```bash
npm run typecheck                                     # two projects — not bare tsc
npx eslint .
npx prettier --check "src/**/*.{ts,tsx}" "tests/**/*.{ts,tsx}"
npx vitest run                                        # background; ~5 min
cd android && ./gradlew :app:testDebugUnitTest        # background; ~3 min
npm run test:e2e
git checkout -- THIRD_PARTY_NOTICES.md package-lock.json c64scope/package-lock.json
git add <explicit paths>                              # never -A
git status --short
```

`prove-load-bearing` on the three regression tests that carry the most weight: GM-9 (held keys
across rotation), GM-6 (never blank) and GM-18 (auto-enter conditions). A regression test that
passes with its fix removed is not a test.

---

## Definition of done

- [ ] GM-1 … GM-21 each have at least one test, and the mapping is written into the As-built
      section so a reviewer can check coverage without reading every file.
- [ ] `npm run typecheck`, eslint, prettier, vitest, Gradle unit tests and `npm run test:e2e`
      all green.
- [ ] Exactly five screenshot files changed; every other PNG reverted.
- [ ] `docs/manual/**/*.md` regenerated from the script, not edited.
- [ ] `docs/cta-inventory.md` updated, including the removed `remote-input-collapse-chrome`.
- [ ] As-built section written, including what the hardware run proved and what it could not.
- [ ] Nothing staged beyond the explicit paths; the three build-churn files reverted.

---

## Decisions taken in advance (so the session never blocks)

| Fork | Decision | Reason |
| --- | --- | --- |
| Keep or delete `joystickDigitalMapping.ts` | Delete if the sheet is its only caller; otherwise leave thin wrappers | A shim nobody calls is dead code that the next reader has to disprove |
| `RemoteInputSheet` size | Extract two hooks **before** adding anything | The file starts at 594 lines against a ~600 guardrail |
| Rotation override persistence | Per session, not persisted | An orientation pinned for one game should not apply weeks later |
| Plugin missing (web, iOS) | Constant 0 + manual override, gated on `isPluginAvailable` | `StreamUdp` shipped an unconditional call that rejected on every iOS launch |
| Picker confirm change (GM-20) | Ship it, in Phase 6 | It is the last honestly removable keystroke; if it must be dropped for scope, drop **only** item 7 of Phase 6 — nothing else depends on it |
| Screenshot drift | Revert everything except the five intended files | The corpus rewrite is this machine's render drift, not a UI change |
| A red baseline at Phase 0 | Record and continue | Unrelated failures are not this branch's to fix |
