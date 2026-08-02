# Game Mode — one action from "I want to play" to playing

**Refines:** Remote Input (`remote_input_enabled`) and Live View
([`06-av-mirror-ux.md`](../content-explorer/06-av-mirror-ux.md)).
**Feature flags:** `remote_input_enabled`, `live_view_enabled`, `audio_mirror_enabled`,
`video_mirror_enabled`. No new flag.
**Variant defaults:** the physical-key layout and the hidden-controls setting default
differently in `c64u-remote` and `c64commander` (§7).
**Status:** Draft — not implemented.

> Goal: a user who wants to play a game reaches the playing state with **one action** —
> one keystroke on a keypad handset — from wherever that intent occurs, and can then hold
> the handset in any orientation with the physical keys still steering the right way.

---

## 1. What is wrong today

**Entering game mode takes four steps across two surfaces.** To reach the state a player
actually wants — the C64 picture large, sound coming out of the phone, physical keys
driving the joystick — the user must today:

1. On **Home**, turn on Live View **Watch** (and **Listen** separately) in `LiveViewCard`.
2. Open **Quick Actions → Remote Input** (`RemoteInputSheet`).
3. Confirm the **Joystick** tab is selected.
4. Press **Game mode** (`remote-input-immersive-toggle`), then optionally **Hide controls**
   (`remote-input-collapse-chrome`).

Every one of those steps is discoverable only if the user already knows the end state.
Step 1 is on a different surface from steps 2–4, and nothing in the Remote Input sheet
says that the picture comes from a control on the page behind it.

**Play does not lead there at all.** Play is where a game is started, but its transport
row offers only **Remote Input** (`play-open-controller`), and only while an item is
playing. After launching a game the user has to leave Play, go to Home, and start again
at step 1.

**The physical keys assume the app's portrait frame.** `T9_JOYSTICK_MAP`
(`src/lib/remoteInput/joystickDigitalMapping.ts`) binds `2/4/6/8` to up/left/right/down,
`1/3/7/9` to the diagonals and `5`/`0` to fire. The bindings are constants: they cannot be
changed for a handset whose keys sit somewhere else, and they do not move when the handset
is turned. Turning the phone to hold it like a gamepad makes every direction wrong.

**The picture does not turn with the handset.** The app locks itself to portrait at
startup (`applyScreenOrientationFromSettings`, default `portrait`), so turning the handset
turns the C64 image with the layout. The image is then sideways to the player.

**The picture does not use the space it is given.** `AvMirrorImmersive` is rendered with
`className="mx-4"` and a fixed `aspectRatio: 384 / 272` box, and `VirtualJoystick` reserves
a fixed action-zone height below it even when nobody is using the on-screen controls.

---

## 2. Scope

**In scope**

- A single **Game Mode** action on Home (Quick Actions) and on Play, which performs the
  whole sequence above and leaves the user in the playing state.
- The same action on a **global `0` key** and in the **Quick Menu**, and optionally
  **automatically when a game is launched**, so a keypad-only user needs no ring
  navigation and no knowledge of where features live (§3.5).
- **Orientation-following** physical-key mapping, and counter-rotation of the mirror only.
- **Configurable** joystick key bindings with per-variant defaults, including the
  8-centred layout in §6.3 as the `c64u-remote` default.
- The **on-screen joystick and keyboard shown or hidden by observed input modality**, so a
  keypad handset and a tablet each get the right control surface with no configuration —
  with a three-state setting for the cases observation cannot cover (§5).
- The mirror using the **full width and remaining height** of the sheet.
- Game mode remaining fully usable **with the picture off**, for a C64U wired to a
  television, with the choice remembered.

**Out of scope (with reasons)**

- **Rotating the rest of the app.** The acceptance criteria require the app to stay in
  portrait; `screenOrientationMode` already offers Auto and Landscape for users who want
  the whole UI to turn.
- **Rotating the on-screen joystick and keyboard.** A rotated on-screen stick has nowhere
  to live inside a portrait sheet, and the handset this is for hides those controls
  anyway (§7). Touch users who want to play in landscape set Settings → Orientation to
  Auto or Landscape, which rotates layout and picture together.
- **Changing the transport, the coalescing window, or the capability tier.** Game Mode
  composes existing pieces; it does not alter how input reaches the machine.
- **Diagonals on the 8-centred default.** See §6.4 — the default binds four cardinals and
  fire, and diagonals remain available in a custom layout.

---

## 3. The single action

### 3.0 What "Game Mode" means, and why nothing is renamed

The term is already used inside the Remote Input sheet for the stripped joystick layout
(`remote-input-immersive-toggle`). Giving the new action the same name would overload it —
unless the two are genuinely the same thing. They are made the same thing here:

> **Game Mode is the app set up for playing:** the control surface that suits how you are
> driving the app, the rest of the app out of the way, and the C64's picture and sound
> **as you last left them**.

That definition deliberately does **not** say "Live View on". Driving a C64U that is wired
to a television is a first-class case: the picture is already on the television, and
streaming it to the phone as well costs battery and bandwidth for nothing. So Live View is
a **component of game mode that the user controls and the app remembers**, not part of what
the words mean (§3.4).

It also does not say "physical keys" or "on-screen controls". Both are game mode; which one
is on screen is decided by observation, not by configuration (§5). The mode has to cover
five shapes without asking the user which one they are in:

| # | Situation | Picture | Steering | Sound |
| --- | --- | --- | --- | --- |
| A | Keypad handset, C64 across the room | phone | physical keys | phone |
| B | Keypad handset, C64 on a television | television | physical keys | television |
| C | Large phone or tablet, C64 across the room | phone | on-screen controls | phone |
| D | Tablet as a second-screen gamepad, C64 on a television | television | on-screen controls | television |
| E | Typing into BASIC rather than playing | either | on-screen keyboard | either |

A–D are game mode. **E is not**, and must stay one action away: the ordinary Remote Input
sheet keeps its own entry point on both pages, unchanged. Rows A/B and C/D differ only in
the control surface (§5); rows A/C and B/D differ only in the remembered Live View state
(§3.4). Neither difference needs a mode of its own, which is why there is one mode and not
four.

With that definition there is one concept and **three doors into it**, all calling the same
`startGameMode()`:

| Door | Control |
| --- | --- |
| Home | Quick Action tile **Game Mode** |
| Play | Button **Game Mode** |
| Remote Input sheet | The existing **Game mode** toggle |
| Anywhere, keypad | The `0` key, and a **Game Mode** entry in the Quick Menu (§3.5a) |
| Launching a game | Automatically, where the variant defaults it on (§3.5c) |

The in-sheet toggle stops being a separate feature and becomes the third entry point. It
gains the stream handling the other two have, which is what a user pressing a button
called "Game mode" already expects. **Exit game mode** keeps its name and its behaviour;
**Hide controls** goes away entirely, because §5.1 produces that state without being asked.
Nothing is renamed, no user has to learn a second term, and the app ends up with one CTA
fewer than it has today.

**Alternative, if the two are ever pulled apart again.** Rename the in-sheet toggle to
**Big controls** (paired with the Size stepper next to it, and with no clash against
Settings → Display, which already owns "full screen"), and reserve **Game Mode** for the
composite action. This spec does not take that route, because after §3.4 there is nothing
left for the second term to mean.

### 3.1 What "Game Mode" does

One action, in this order:

1. **Guard.** The control is disabled when the app is not connected, using the same rule
   as the existing Remote Input tile (`!isActive`). It is not rendered at all when
   `remote_input_enabled` is off.
2. **Start the picture and the sound the user last asked for.** Call
   `avMirrorSession.startVideo()` when `video_mirror_enabled` is on **and** the remembered
   Watch preference is on, and `avMirrorSession.startAudio()` when `audio_mirror_enabled`
   is on **and** the remembered Listen preference is on (§3.4). Both calls are idempotent,
   so a stream already running is left as it is. Record which of the two this action
   actually started (§3.3).
3. **Open the Remote Input sheet in the end state**, by passing a launch request (§8.2):
   output mode `joystick` and game mode on. The control surface is not part of the request:
   it is resolved continuously from the input modality (§5.1).
4. **Degrade explicitly.** If the capability tier resolves to no joystick relay
   (firmware older than 1.2.0, or a password is required), the existing tier logic puts
   the sheet in **Keys** mode and shows `REMOTE_INPUT_JOYSTICK_UNAVAILABLE_HINT` or
   `REMOTE_INPUT_AUTH_REQUIRED_HINT`. The picture, the sound and the full-space layout
   still apply. Game Mode never silently opens a sheet that cannot do anything.
5. **A missing picture is a normal state, not an error.** When the picture is off — because
   the flag is off, or because the user turned Watch off (§3.4) — the sheet opens without
   one, the space goes to the controls, and the Watch button sits where it always does. No
   new error state and no prompt.

On the C64U with default flags, default Watch/Listen preferences and firmware 1.2.0 or
newer, the end state after one action is: the C64 picture filling the sheet, audio playing
out of the phone, physical keys relaying as a joystick, and no on-screen controls on
`c64u-remote`. For a user who has turned Watch off, the same action gives the controls and
the sound with no picture (§3.4).

### 3.2 Where the action lives

| Surface | Control | Condition | Placement |
| --- | --- | --- | --- |
| **Home** | Quick Action tile **Game Mode**, `Gamepad2` icon | `remote_input_enabled`; disabled while disconnected | **First tile in the grid**, on every variant — see §3.2.1 |
| **Play** | Button **Game Mode** | `remote_input_enabled && isPlaying` | In the existing actions row; **first** in the row when `currentItem.category` is not a song category (`prg`, `crt`, `disk`), after **Remote Input** when it is (`sid`, `mod`) |

Both entries call the same function. Remote Input stays where it is on both surfaces: a
user who wants only the keyboard for a BASIC program still has a direct route that does
not start streams.

The Play ordering rule uses the existing `isSongCategory` helper
(`src/pages/playFiles/playFilesUtils.ts`). A running program, cartridge or disk image is
overwhelmingly likely to be a game, so Game Mode leads the row; a running tune is not, so
it does not.

**Label casing.** The Quick Action tile and the Play button are labelled **"Game Mode"**,
matching the Title Case of the tiles beside them ("Remote Input", "Power Cycle"). The
in-sheet toggle keeps its existing sentence case ("Game mode" / "Exit game mode").

#### 3.2.1 Quick Actions tile order

Adding a tile forces the question of where it goes, and the current order does not survive
the question.

**How the order is actually decided.** `FocusController.sort()` uses `domIndex` as the
**primary** key and treats the explicit `order` only as a tiebreaker
(`src/lib/input/focusController.ts`), and discovery sorts by bounding-rect top-then-left
(`compareFocusables`, `src/lib/input/discovery.ts`). The ring therefore follows **visual
reading order**: reordering means reordering the JSX, and the `focusOrder={100…190}` props
on these tiles imply a control they do not have.

**What is wrong today.** `MachineControls.tsx` renders **Reset** and **Reboot** first, so
the two most destructive actions occupy the whole first row at `compactColumns={2}` — where
a thumb lands and where the keypad ring starts. The destructive tiles are also **scattered**
(positions 1, 2, 7, 9, 11), interleaved with safe ones, so their red tint never reads as a
group. The Disks page already does this correctly: per drive it renders Status, Mount, Bus
ID, Drive Type and path first, then **Reset** and **Power** last. The convention exists in
the app; Home does not follow it.

**The rule.** Frequent and safe first; destructive last, in increasing severity; pairs kept
adjacent; and **one focus group, not two** — splitting the grid would cost a keypad user a
ring level to descend into, which is a worse trade than the visual tidiness it buys.

| # | Tile | Reason |
| --- | --- | --- |
| 1 | **Game Mode** | The only action that starts play; everything else is maintenance |
| 2 | **Menu** | The most-used non-destructive action — how you drive the Ultimate itself |
| 3 | **Pause / Resume** | Used mid-session |
| 4 | **Remote Input** | The keyboard-only route, beside its game-mode sibling |
| 5–6 | **Save RAM / Load RAM** | A pair; meaningless apart |
| 7 | **Save REU memory** | Same family, rarer |
| 8 | **Reset** | Destructive block begins — interrupts the session only |
| 9 | **Reboot** | Restarts the machine |
| 10 | **Reboot (Clr Mem)** | …and clears memory |
| 11 | **Power Cycle** | Cuts power, recovers by itself |
| 12 | **Power Off** | Leaves the machine off; recovery can need physical access |

First row today versus proposed: **Reset + Reboot** becomes **Game Mode + Menu** at two
columns, and an entirely safe **Game Mode, Menu, Pause, Remote Input** at four. The order is
the same on both variants — it follows from safety and frequency, not from the handset, so
it is not a variant entry.

Two clean-ups belong with the reorder: **renumber or drop the `focusOrder` props**, so a
stale number cannot contradict the DOM order the ring actually uses; and note that
**Power Off confirms through its own dialog** (`powerOffDialogOpen` in `useHomeActions`)
while the other four go through `openDestructiveConfirmation` →
`MachineActionConfirmationDialog`. Both confirm today, so this is not a hole, but one class
of action with two mechanisms is where a missing confirmation eventually hides. Unifying
them is a good follow-up and is **not** part of this change.

### 3.3 Leaving, and what happens to the streams

- **Exit game mode** (existing toggle, or the Back key) returns to the ordinary Remote
  Input sheet. Streams keep running: the user asked for them and is still on the surface
  that shows them.
- **Closing the sheet** releases every held input (existing behaviour) and **stops only
  the streams this Game Mode launch started**. A stream that was already running before
  the launch is left running.

The launch records which streams it started, so the rule is exact rather than a guess: a
user who already had **Listen** on and then used Game Mode keeps listening after closing
the sheet, while a user who started from nothing is not left with the radio and video
draining the battery behind a closed sheet. This is consistent with the shared-session
principle in `06-av-mirror-ux.md` §1.3 (any surface can stop the session) because the
stop is scoped to what this action itself started.

### 3.4 Live View inside game mode — the television case

A user whose C64U is wired to a television wants the controls and not the picture. The
picture must therefore be **one tap away in both directions from inside game mode**, and
the answer must be **remembered**, so that user turns it off once rather than at every
launch.

**Remembered per feed, written by the control the user actually pressed.** Audio already
works this way: `AvMirrorControls` calls `saveMirrorC64Audio(!audioLive)` whenever Listen
is toggled, on any surface. Add the same for video — `saveMirrorC64Video`, default on —
written by the same control. Game Mode then starts each feed only if its remembered
preference is on (§3.1 step 2). Turning Watch off in game mode is what makes the next
launch open without a picture. There is no separate "start Live View with Game Mode"
setting, which is one less thing to keep in step with the toggles.

**Reachable in game mode, with and without a touchscreen:**

| Situation | Route to Watch / Listen |
| --- | --- |
| Chrome shown | The existing `AvMirrorControls` row (`remote-input-mirror-controls`), already there |
| Chrome hidden, touch | The floating **Controls** handle restores the chrome |
| Chrome hidden, keypad only | `#` shows the overlay row (§5), which carries **Watch** and **Listen** beside the quick keys |

**Degenerate state, prevented.** With the picture off, hiding the on-screen controls would
leave an empty sheet. The hiding rule (§5.1) therefore applies **only while the video
mirror is live**. With no picture the on-screen joystick and keyboard are shown whatever
the modality and the setting say — harmless on a keypad handset, and the only sensible thing on a
touchscreen. A status card in their place was considered and rejected for this revision: it
is a new component that does nothing the existing controls do not.

**Layout with no picture.** The mirror is not rendered at all rather than rendered empty,
so the controls take the full body height. The existing `showMirrorScreen` condition
(`videoMirrorEnabled && mirror.video.state !== "off"`) already gives this.

### 3.5 The keypad-only path: launch a game, then play it

This is the path that matters on a handset with no touchscreen. Keystrokes are counted with
one ring move (Up/Down) as one keystroke; the exact number of ring moves depends on how many
controls are enabled in the current state, so ranges are given.

**Today**, starting on Home, connected, nothing playing:

| # | Keys | What the user must already know |
| --- | --- | --- |
| 1 | `2` → Play | Digits jump to pages |
| 2 | ~3–6 × Down, OK → **Add items to playlist** | — |
| 3 | 1–2 × Down, OK → source **C64U** | — |
| 4 | ~10–40 keys, or the filter field with T9 | How to browse or filter |
| 5 | OK to select, ~2 × Down, OK → **Add** | Selection is separate from adding |
| 6 | ~3–8 keys → transport **Play** | Adding does not launch |
| 7 | `1` → Home | **That Live View lives on Home, not in the controller** |
| 8 | ~6–12 keys → OK into Live View, **Watch**, then **Listen** | That these two switches exist and are separate |
| 9 | ~4–8 keys → Quick Actions, **Remote Input** | Where the controller is |
| 10 | ~3–6 keys → **Game mode** | That game mode is inside the sheet |
| 11 | 1–2 keys → **Hide controls** | That there is a second step |

Roughly **40–80 keystrokes across two pages**, and — the real problem — **four separate
pieces of knowledge** (steps 7, 8, 9, 10). A user who does not already know that Live View
is a Home control cannot find it from inside the controller, because nothing there says so.

**With §3.1–§3.2 alone**, steps 7–11 collapse into one ring move and one OK on the Play
page: **Game Mode**. That removes about 15–25 keystrokes, one page switch, and all four
pieces of knowledge. Steps 2–6 are the cost of choosing a file and are not addressed by
this feature.

Three further measures take the remaining path close to nothing. All three are in scope
here.

**(a) A global Game Mode key: `0`.** Digits `1`–`6` already jump to the six tabs
(`useFocusNavigation`, `TAB_ROUTES`), and `*` and `#` are taken; **`7`, `8`, `9` and `0`
are unbound at app level**. Bind `0` to `startGameMode()` on the same always-reachable
shortcut path, with the same exclusions the digits already have (not in a text field, not
inside an open overlay — so it never collides with the joystick bindings inside the sheet,
where `0` is a direction).

> From anywhere in the app, with a game already running on the C64: **`0`. One keystroke.**

`0` only enters. Leaving stays on **Back**, per the app's existing "OK goes in, Back comes
out" rule; a key that both entered and exited would be ambiguous the moment the sheet has
focus. The Quick Menu (Menu key) gains a **Game Mode** entry so the shortcut is
discoverable without reading the manual, in the same place page jumps and Diagnostics
already are.

**(b) First in Quick Actions.** Render the tile first in the grid (§3.2.1), so Home's ring
starts on it. Two benefits: the action a play-focused handset uses most is the first stop,
and the destructive Reset tile stops being the first thing under the thumb and under the
ring.

**(c) Enter Game Mode automatically when a game is launched.** Setting **"Enter Game Mode
when a game starts"**, default **on** in `c64u-remote` and **off** in `c64commander`.
With it on, step 6 above ends in game mode and the user presses nothing else at all:

> `2` → choose the file → launch → **playing, with picture, sound and steering.**

It fires only when all of these hold, which keeps it from becoming a surprise:

- the launched item is **not** a song category (`prg`, `crt`, `disk` — never `sid`/`mod`);
- the launch was **user-initiated**, never playlist auto-advance (otherwise a queue of
  programs would re-open the sheet at every track);
- the launch **succeeded**;
- the Remote Input sheet is not already open.

**(d) The picker's confirm button says what it will do.** Steps 2–6 remain the file-choosing
cost, but one of them is avoidable. `ItemSelectionDialog` already takes `confirmLabel` as a
caller-supplied string, and Play passes the constant `"Add to playlist"`. Make Play compute
it: when the selection is **exactly one non-song item**, the button reads **"Play"** and the
confirm launches it instead of only queueing it. Any other selection keeps
"Add to playlist". That removes step 6 (returning to the page and finding the transport)
for the single most common case, which is choosing one game.

This is a change to a shared picker's caller, not to the picker, and it is the last
keystroke that can honestly be removed: what remains is the user telling the app which file
they want.

**Discoverability of `0`.** A shortcut nobody knows about saves nobody anything. Three
places carry it, all existing surfaces: the **Quick Menu** entry (§3.5a), the **guidance
bar** — the keypad-modality strip above the tab bar that already names the soft keys — which
gains a "0 Game Mode" hint on Home and Play while a device is connected, and the manual's
Number Keys table (§11). The guidance bar is the one that matters: it is on screen exactly
when the user is driving by keys, which is exactly when the shortcut applies.

**Resulting paths on `c64u-remote`:**

| Situation | Keystrokes |
| --- | --- |
| A game is already running on the C64 | **1** (`0`), or `1` + OK from Home |
| Launching a game from Play | `2`, the file-choosing keys, OK to select, OK on **Play** — then game mode enters itself |
| Turning the picture off for a television session | `#`, ring to **Watch**, OK — once, then remembered (§3.4) |
| Leaving | **Back** (exits game mode), **Back** again (closes the sheet) |

---

## 4. Orientation

### 4.1 Two different rotations

Two quantities are needed, and they are not the same number.

| Quantity | Meaning | Source |
| --- | --- | --- |
| `deviceRotation` | How far the **chassis** is turned clockwise away from upright, against gravity | Native detector (§4.2) |
| `windowRotation` | How far the **app's rendered frame** is turned relative to the chassis | `screen.orientation.angle`; **0** whenever the app is portrait-locked, which is the default |

From those:

- `frameRotation = (deviceRotation - windowRotation + 360) % 360` — how far the app's frame
  appears turned away from upright to the player.
- **The mirror is counter-rotated by `-frameRotation`**, so C64 north matches world north.
- **The keys are permuted by `deviceRotation`** (§6.2), because the keys are fixed to the
  chassis and the player reaches for whichever key is physically nearest the top.

In the shipping configuration (portrait lock) `windowRotation` is 0 and the two are equal.
They diverge only when the user has set Settings → Orientation to Auto or Landscape: there
the layout turns by itself, so the picture needs no counter-rotation while the keys still
need permuting.

> **Implementation trap.** The sign convention of `screen.orientation.angle` differs
> between implementations. Do not infer it; calibrate it once with a test that pairs
> recorded sensor values against recorded `angle` values, and keep `windowRotation` at a
> hard 0 whenever `loadScreenOrientationMode() === "portrait"` rather than reading the
> property at all in that case.

### 4.2 Detecting `deviceRotation`

A portrait-locked activity does not receive configuration changes when the handset is
turned, so neither `orientationchange` nor `Display.getRotation()` reports the movement.
The detector is therefore a **native Android `OrientationEventListener`**, which reports
the chassis angle regardless of the activity's orientation lock.

```
DeviceRotationPlugin.kt
  OrientationEventListener(context, SENSOR_DELAY_UI)
    onOrientationChanged(degrees: Int)
      degrees == ORIENTATION_UNKNOWN (-1)  → device is flat; emit nothing, hold last value
      else                                 → quantise (§4.3) → notifyListeners("deviceRotation", { rotation })
  start() / stop()   — registered only while a consumer is subscribed
```

The plugin is registered and unregistered by the subscription, so the sensor is off
whenever no surface is watching it. The web build and any platform without the plugin
report a constant 0 and fall back to the manual override.

### 4.3 Quantising, and not flapping

Pure function, unit-tested in isolation:

```
quantiseRotation(degrees, previous):
  0/90/180/270 sectors, each ±45°, with a 20° hysteresis band:
  a change is accepted only when `degrees` is more than 20° past the boundary
  into the new sector; otherwise `previous` is kept.
```

A **250 ms dwell** is then applied in the hook: a new quantised value must hold for that
long before it is published. Together these stop a handset being turned slowly, or held
near 45°, from alternating the key mapping.

`ORIENTATION_UNKNOWN` (flat on a table) never changes the published value.

### 4.4 Manual override

Game mode carries a small orientation control in its chrome:

```
Orientation  [ Auto | 0° | 90° | 270° ]     data-testid="remote-input-rotation-override"
```

**Auto** is the default and uses the detector. Choosing an explicit angle pins both the
picture rotation and the key permutation and ignores the sensor until Auto is chosen
again. The pin is per session, not persisted: an orientation pinned for one game should
not silently apply to the next launch weeks later.

The override exists because three situations are not solvable by a sensor: a handset lying
flat, a handset whose AppSupport does not deliver sensor callbacks, and a player lying
down. It is also what makes the whole feature testable without turning a phone.

### 4.5 Rotating the picture only

`AvMirrorImmersive` gains a `rotation` prop (0/90/180/270, defaulting to 0) and
`data-rotation` on its root for tests.

- The **stage element** carries `transform: rotate(-frameRotation deg)`. The canvas keeps
  its existing zoom/pan transform, so the viewport maths in `mirrorViewport.ts` and
  `useMirrorViewport` are unchanged.
- **Pointer input must be un-rotated before it reaches the viewport maths.** Both the pan
  deltas and the focal points in `handlePointerDown` / `handlePointerMove` are computed
  from client coordinates against `stageRef.getBoundingClientRect()`. With the stage
  rotated, a drag along the player's x axis is a drag along the picture's y axis. Convert
  every client delta and point into the stage's own unrotated frame first:

  ```
  θ = frameRotation                       (the stage's CSS transform is rotate(-θ))
  R(θ)·(x, y) = (x·cos θ − y·sin θ,  x·sin θ + y·cos θ)     CSS convention: +y is down

  localDelta = R(θ) · clientDelta
  localPoint = R(θ) · (clientPoint − stageCentre)
  u = 0.5 + localPoint.x / stageWidthUnrotated
  v = 0.5 + localPoint.y / stageHeightUnrotated
  ```

  The divisors are the **unrotated** stage width and height, not the rotated bounding box;
  at 90° and 270° those are the two that swap. Worked check at θ = 90: `R(90)` maps
  `(dx, dy)` to `(−dy, dx)`, so a downward drag moves the picture along its own −x axis,
  which is the axis that points down the screen once the stage has been turned a quarter
  turn anticlockwise.

  Without this, pinch-to-zoom keeps the wrong focal point and one-finger drag pans
  sideways — a defect that only appears when the handset is turned, which is exactly the
  case no test would catch by accident.
- The on-screen zoom cluster, the minimap and the mode chip stay **unrotated**, anchored
  to the app frame. They are app chrome, not part of the C64 picture, and a player using
  them is looking at the phone, not at the game.

### 4.6 Sizing the picture

Replace the fixed aspect-ratio box with a measured fit, so the picture uses the whole
sheet body.

- The sheet is `fixed inset-x-0 bottom-0` with a computed top just under the app bar, so
  in fully-collapsed game mode the body is nearly the full screen height.
- Drop the `mx-4` margin in game mode; the stage spans the full body width.
- Measure the body with a `ResizeObserver`. For a container `W × H` and frame aspect
  `a = 384 / 272` (**swapped to `272 / 384` when `frameRotation` is 90 or 270**), the drawn
  size is `min(W, H · a) × min(H, W / a)`, centred in both axes.
- When the on-screen controls are hidden (§5.1), `VirtualJoystick` is not rendered and its
  action-zone height is not reserved, so the whole body belongs to the picture.

---

## 5. The control surface, and reaching everything without it

### 5.1 The rule: the control surface follows how you are driving

The original criterion asked for a setting, defaulted on for `c64u-remote`. A setting is
the wrong primary mechanism here, for the reason that prompted this whole feature: the user
this is for cannot be expected to find Settings and know which switch to press. The app
already knows the answer without asking.

`src/lib/input/inputModality.ts` is an app-wide singleton that records whether the user
most recently acted with a **recognised navigation key** or with a **pointer**. It is set
from the existing handlers (`useFocusNavigation` sets `key-navigation` on a shortcut or ring
key and `pointer` on a pointer event) and already has a subscriber API used through
`useSyncExternalStore`. So:

> **In game mode, the on-screen joystick and keyboard are shown while the modality is
> `pointer`, and hidden while it is `key-navigation`.**

The consequences fall out without any per-variant configuration:

| Device | What happens | Why |
| --- | --- | --- |
| Keypad handset (rows A/B) | Controls never appear | The user reached game mode with `0` or the ring, so the modality is already `key-navigation` at entry |
| Tablet or large phone (rows C/D) | Controls appear | The user tapped the tile, so the modality is `pointer` |
| Either, mid-game | It corrects itself | The first physical direction key hides them; the first touch brings them back |

Two details make this pleasant rather than twitchy:

- The Remote Input sheet must call `setInputModality("key-navigation")` when a physical key
  relays to the joystick. It currently intercepts those keys before the global handler
  reaches them, so without this the modality would never update inside the sheet.
- Hiding is **delayed** (reuse `AvMirrorImmersive`'s existing `CONTROLS_HIDE_MS`), showing
  is immediate. Controls that vanish mid-tap would be worse than controls that linger.

**The setting still exists**, and satisfies the original criterion, but as three states:
**Auto** (the rule above, default on every variant), **Always show**, **Never show**. Auto
means `c64u-remote` hides them by default, which is what the criterion asked for, and it
means a large-screen device gets the right answer without a variant entry. The two explicit
states are for the cases observation cannot cover: a tablet user who wants a clean picture
while playing with a Bluetooth controller, and a keypad handset whose user does have touch
enabled and wants the on-screen stick.

### 5.2 What this removes

The current **Hide controls** button (`remote-input-collapse-chrome`) and the separate
"fully immersive" state disappear. They existed to let a user reach, by hand, the state the
rule now produces on its own. Game mode always minimises the sheet chrome; the control
surface is decided by §5.1; and the floating **Controls** handle
(`remote-input-restore-chrome`) remains as the way back to the chrome and everything in it.

This is the answer to "should the maximised remote view get a different name": under this
rule it is not a separate thing to name. One mode, one toggle, one fewer CTA.

### 5.3 What remains reachable when the controls are hidden

Hiding the joystick and the keyboard removes the only route to RETURN, SPACE and RUN/STOP,
and many games ask for one of them on their title screen. On a handset with the
touchscreen disabled there would then be no way to start the game the mode exists to play.
Two keys inside the sheet close that gap. Both are free: while focus is inside the sheet
the app's global keypad handler bows out (`isWithinOpenOverlay` in `useFocusNavigation`),
so neither key reaches its usual app-level function.

| Key | Semantic action | Role inside game mode |
| --- | --- | --- |
| `*` / Menu | `star`, `openMenu` | **Unchanged** — flips Driving C64 ↔ Adjusting view (`06-av-mirror-ux.md` §7.1) |
| `#` | `hash` | **New** — shows or hides an overlay row carrying the quick keys and the **Watch** / **Listen** toggles |

The row is the existing `QuickKeysBar` plus `AvMirrorControls`, overlaid on the bottom of
the picture rather than stacked above the controls, and it hides itself again after the
same idle timeout the mirror controls use. Putting Live View on the same key as the quick
keys costs no second binding and is what makes §3.4 reachable on a handset with no
touchscreen. The floating **Controls** handle (`remote-input-restore-chrome`) stays as the
touch route back to the full chrome, including **Release All**, and the Back key still
exits.

> This is an addition beyond the original acceptance criteria. It is here because the
> criteria as written produce a mode a keypad-only handset cannot start a game from.

---

## 6. Key bindings

### 6.1 Model

A binding is a map from **joystick slot** to **semantic action** — never to a raw key code.
Physical keys already normalise to `SemanticAction` through the `keypad` profile
(`docs/plans/callback8020/keymap.md`), so bindings stay device-independent and a handset
that reports different key codes is handled in the profile, as today.

```ts
type JoystickSlot = "up" | "upRight" | "right" | "downRight"
                  | "down" | "downLeft" | "left" | "upLeft" | "fire";

type JoystickKeyBinding = Partial<Record<JoystickSlot, SemanticAction>>;
```

Only the **portrait** binding is ever stored or configured. Every other orientation is
derived (§6.2). Reserved actions may not be bound: `star` and `openMenu` (view lock),
`hash` (quick keys, §5) and `back` (exit). The binding editor rejects them with an inline
message naming what the key already does.

### 6.2 Rotation is a permutation, not a second table

The eight direction slots sit on a circle. Rotating the chassis clockwise by `r` means the
slot that now points at world-north is the one that pointed `r` degrees anticlockwise from
north before:

```
resolve(slot, r) = binding[rotateCCW(slot, r)]      // r ∈ {0, 90, 180, 270}
resolve("fire", r) = binding["fire"]                 // orientation-invariant
```

This is the whole of the orientation logic. It is one pure function over any binding,
including a custom one, and it reproduces the required table exactly — the table is a
consequence of the rule rather than data that has to be kept in step with it.

### 6.3 The `c64u-remote` default: the 8-centred diamond

Portrait binding: `up = 5`, `left = 7`, `right = 9`, `down = 0`, `fire = 8` — the four keys
physically surrounding `8` on a standard keypad grid, with fire in the middle.

Derived through §6.2:

| Orientation (chassis, clockwise from upright) | Up | Left | Right | Down | Fire |
| --- | --- | --- | --- | --- | --- |
| Portrait (0°) | 5 | 7 | 9 | 0 | 8 |
| 90° clockwise | 7 | 0 | 5 | 9 | 8 |
| 270° clockwise | 9 | 5 | 0 | 7 | 8 |
| 180° (derived, not in the criteria) | 0 | 9 | 7 | 5 | 8 |

Rows 1–3 are the required acceptance-criteria table. Row 4 costs nothing and is included
because upside-down is a state the detector can report.

### 6.4 Diagonals

The 8-centred default binds four cardinals and fire, and **no diagonals**. Two reasons:

- The keys that would complete the diamond around `8` are `4`, `6`, `*` and `#`, and both
  `*` and `#` are reserved (§5).
- Whether the target handset's keypad supports two keys held at once is not known and
  cannot be measured. Where rollover does work, holding `7` and `5` together already
  produces left+up through the existing held-set union, with no diagonal binding needed.

A custom layout may bind the four diagonal slots; they rotate under the same permutation.

### 6.5 The other preset, and custom bindings

| Preset | Binding | Default for |
| --- | --- | --- |
| **Diamond (8-centred)** | §6.3 | `c64u-remote` |
| **Classic T9** | `2/4/6/8` cardinals, `1/3/7/9` diagonals, `5` fire | `c64commander` — today's `T9_JOYSTICK_MAP`, unchanged |
| **Custom** | User-assigned | — |

Custom bindings are assigned by **pressing the key**: the user focuses a slot, the row
enters capture, the next physical key press is captured as that slot's semantic action.
Press-to-bind is the only route that works on a handset with no touchscreen, and it is the
only route that is correct when the app cannot predict what a key reports. A slot can be
cleared, and the preset can be restored in one action.

The hardware D-pad map (`DPAD_JOYSTICK_MAP`: `dpadUp/Down/Left/Right`, `center` = fire) is
kept as an always-on addition to whatever binding is active, and it rotates under the same
permutation. A device with both a D-pad and a keypad keeps both working.

### 6.6 Held keys across a rotation change

When `deviceRotation` changes, the set of physical keys held does not change but their
meaning does. `RemoteInputSheet.recomputePhysicalHeldSet` already removes exactly the
inputs it last contributed and adds the ones it contributes now, so the requirement is to
**re-run that recompute on every rotation change**, in one transport update.

Without it, a player holding `7` (left) who turns the handset 90° clockwise keeps `left`
asserted forever while `up` is added — the machine sees a diagonal that the player never
pressed, and `left` never releases because the key-up will map to a different input.

### 6.7 Where the mapping applies

The orientation-derived mapping applies **whenever physical keys are relaying as a
joystick**, in game mode or in the ordinary Remote Input sheet. One rule, no
mode-dependent surprise: a player who turns the handset with the plain joystick sheet open
would otherwise steer the wrong way.

---

## 7. Settings and variant defaults

Four preferences, all in **Settings → Remote Input**, beside the existing autofire
controls, and all following the existing `localStorage` + variant-default pattern of
`remoteInputControlSettings.ts`.

| Setting | Storage key | `c64commander` | `c64u-remote` |
| --- | --- | --- | --- |
| **Joystick key layout** (Diamond / Classic T9 / Custom) | `c64u_remote_input_joystick_layout` | `classicT9` | `diamond8` |
| **Custom bindings** | `c64u_remote_input_joystick_binding` | — | — |
| **On-screen controls in Game mode** (Auto / Always show / Never show) | `c64u_game_mode_controls_visibility` | `auto` | `auto` |
| **Enter Game Mode when a game starts** | `c64u_game_mode_on_launch` | off | **on** |

One further preference is added but has **no Settings control**: the remembered Watch
answer (`c64u_mirror_c64_video`, default on), written by the Watch button itself exactly as
`c64u_mirror_c64_audio` is written by Listen today (§3.4). It is a record of what the user
last pressed, not a setting to be found and configured.

Variant defaults are plumbed the same way as `default_t9_input_enabled` and
`default_hide_status_bar`:

```
variants/variants.yaml            runtime.default_joystick_key_layout: diamond8
                                  runtime.default_game_mode_on_launch: true
scripts/generate-variant.mjs      validate (allowlist / requireBoolean) → emit
src/generated/variant.ts          runtime.defaultJoystickKeyLayout, defaultGameModeOnLaunch
src/lib/remoteInput/…             DEFAULT_… constants read from `variant.runtime`
```

Only **two** variant entries, not three: the control-surface question answers itself from
observed modality (§5.1), so it needs no per-variant default. Every variant entry is a
divergence that has to be reasoned about again at every later change, so one that can be
derived instead is worth deriving.

Settings copy:

> **On-screen controls in Game mode** — Auto / Always show / Never show
> **Auto** shows the on-screen joystick and keyboard while you are using the touchscreen
> and hides them while you are using the physical keys, so the picture gets the whole
> screen when you do not need them. Press `#` for RETURN, SPACE, the other quick keys and
> the Live View switches, `*` to adjust the view, and Back to leave. With the picture
> switched off the controls stay on screen, so Game mode is never blank.

> **Enter Game Mode when a game starts**
> Launching a program, cartridge or disk image goes straight into Game Mode. Tunes are
> unaffected, and so is a playlist moving on by itself — only a game you started.

> **Joystick keys**
> Which physical keys steer the joystick. **Diamond** uses the four keys around 8, with 8
> as fire. **Classic T9** uses 2, 4, 6 and 8 with 5 as fire. Choose **Custom** to press
> the key you want for each direction. The mapping turns with your device, so you only
> ever set it up for portrait.

Entering game mode always collapses the sheet chrome (the existing `chromeCollapsed`
state). Whether `VirtualJoystick` / `TypeKeyboard` render on top of that is §5.1's
decision, re-evaluated as the modality changes. Today `chromeCollapsed` hides only the
header, the toolbar and the mirror controls; the joystick still renders and still reserves
its action zone, which is the part that changes.

---

## 8. Architecture

### 8.1 New files

| File | Contents |
| --- | --- |
| `src/lib/remoteInput/joystickKeyBindings.ts` | Pure. Slot/binding types, the two presets, `rotateSlot`, `resolveJoystickInputs(action, binding, rotation)`, load/save/validate, reserved-action rejection. Replaces `joystickDigitalMapping.ts` as the resolver; that module's two tables become the `classicT9` preset and the D-pad addition. |
| `src/lib/remoteInput/deviceRotation.ts` | Pure. `quantiseRotation(degrees, previous)` with the hysteresis band, the dwell filter, and `frameRotation(deviceRotation, windowRotation)`. |
| `src/hooks/useDeviceRotation.ts` | Subscribes to the plugin (or a constant 0 where unavailable), applies the dwell, exposes `{ rotation, source: "auto" \| "pinned", pin, clearPin }`. |
| `src/lib/remoteInput/gameModeLaunch.ts` | `RemoteInputLaunchRequest` type (`{ epoch, mode, immersive }`) and `startGameMode()`, which performs §3.1 steps 2–3 against the remembered Watch/Listen preferences and returns what it started for §3.3. |
| `src/lib/remoteInput/gameModeControlSurface.ts` | Pure. `resolveControlSurface({ setting, modality, videoLive })` → `"shown" \| "hidden"`, the whole of §5.1 as one testable function. |
| `android/…/DeviceRotationPlugin.kt` | `OrientationEventListener` registration, quantisation on the native side, `deviceRotation` events, start/stop with subscriber count. |

### 8.2 Changed files

| File | Change |
| --- | --- |
| `RemoteInputSheet.tsx` | Accept `launch?: RemoteInputLaunchRequest` and apply it on a new `epoch`; resolve physical keys through `resolveJoystickInputs` with the live rotation; re-run `recomputePhysicalHeldSet` on rotation change (§6.6); render the input controls per `resolveControlSurface` and call `setInputModality("key-navigation")` when a physical key relays (§5.1); drop the **Hide controls** button (§5.2); host the rotation override (§4.4) and the `#` overlay (§5.3). It is already 594 lines — extract the launch/exit handling and the physical-key routing into hooks rather than growing the component (`AGENTS.md` modularization guardrails). |
| `AvMirrorImmersive.tsx` | `rotation` prop, `data-rotation`, un-rotated pointer maths (§4.5), measured fit sizing (§4.6). |
| `VirtualJoystick.tsx` | Do not reserve the immersive action zone when the controls are hidden. |
| `HomePage.tsx` / `MachineControls.tsx` | The `openGameMode` action, and the tile reorder in §3.2.1 (a JSX reorder — the ring follows the DOM, not `focusOrder`). The extra-actions block currently renders between Power Cycle and Power Off, which is what scatters the destructive tiles; safe extras move ahead of the block and destructive ones into it. |
| `PlayFilesPage.tsx` | The Game Mode button and its ordering rule (§3.2). |
| `AvMirrorControls.tsx`, `appSettings.ts` | `saveMirrorC64Video` / `loadMirrorC64Video`, written by the Watch button exactly as Listen writes `saveMirrorC64Audio` today (§3.4). |
| `useFocusNavigation.tsx` | The `0` shortcut, on the existing always-reachable path beside the tab digits, with the same text-field and open-overlay exclusions (§3.5a). |
| `KeypadQuickMenu.tsx` | A **Game Mode** entry, so the shortcut is discoverable without the manual. |
| `KeypadGuidanceBar.tsx` / `guidance.ts` | The "0 Game Mode" hint on Home and Play while connected (§3.5d). The label policy stays in the pure `resolveGuidanceLabels`, not in the component. |
| `PlayFilesPage.tsx` (picker caller) | Compute `confirmLabel` and the confirm action from the current selection (§3.5d). |
| `usePlaybackController.ts` (or the Play page's launch result handler) | The auto-enter call under the four conditions in §3.5c. |
| `SettingsPage.tsx` | The four controls in §7. |
| `variants/variants.yaml`, `scripts/generate-variant.mjs` | The two new runtime defaults. |
| `scripts/build-manuals.mjs` | Manual prose (§10). |

### 8.3 Data flow

```
OrientationEventListener ─▶ DeviceRotationPlugin ─▶ useDeviceRotation ─┬─▶ frameRotation ─▶ AvMirrorImmersive (picture)
                                                                       └─▶ deviceRotation ─▶ resolveJoystickInputs ─▶ session held set

Game Mode (tile / button / `0` / Quick Menu / launch)
        └─▶ startGameMode() ─┬─▶ avMirrorSession.startVideo/startAudio  (remembered prefs)
                             └─▶ RemoteInputLaunchRequest ─▶ RemoteInputSheet

inputModality ──┬─▶ resolveControlSurface(setting, modality, videoLive) ─▶ on-screen controls
physical relay ─┘   (the sheet feeds the modality as well as reading it)
```

---

## 9. Behaviour requirements

| # | Requirement |
| --- | --- |
| GM-1 | One action on Home and one on Play reach the end state in §3.1, with no intermediate step on another surface. |
| GM-2 | Game Mode starts video and audio only where the corresponding flag **and** the remembered Watch/Listen preference are on, is idempotent against already-running streams, and records what it started. |
| GM-3 | Closing the sheet stops only the streams that launch started; exiting game mode without closing stops nothing. |
| GM-4 | Turning Watch off inside game mode is remembered: the next Game Mode launch opens without a picture, with no Settings visit and no prompt. |
| GM-5 | Watch and Listen are reachable from inside game mode in every configuration, including chrome hidden with no touchscreen (`#`). |
| GM-6 | Game mode is never blank: with the video mirror off, the on-screen controls are shown whatever the modality and the setting say. |
| GM-6a | With the setting on **Auto**, the on-screen controls are hidden while the modality is `key-navigation` and shown while it is `pointer`; **Always show** and **Never show** override both. |
| GM-6b | A physical key relayed to the joystick sets the modality to `key-navigation`, so the controls hide during play on a keypad handset without the user asking. |
| GM-7 | Physical keys resolve through the active binding permuted by `deviceRotation`, in game mode and in the ordinary joystick sheet. |
| GM-8 | The `c64u-remote` default binding produces exactly the table in §6.3 for 0°, 90° and 270°. |
| GM-9 | A rotation change re-derives the held set in one transport update; no input stays asserted under the old mapping. |
| GM-10 | Rotation changes are published only after the hysteresis and dwell filters; a flat device never changes the mapping. |
| GM-11 | The mirror is counter-rotated by `-frameRotation`; no other part of the app rotates. |
| GM-12 | Pointer gestures on a rotated mirror pan and zoom along the axes the player sees. |
| GM-13 | In game mode the mirror uses the full width of the sheet body and all height not used by visible controls. |
| GM-14 | With on-screen controls hidden, `#` reaches the quick keys and the Live View switches, `*` flips the view lock, the floating handle restores the chrome, and Back exits. |
| GM-15 | Bindings are configurable by pressing a key; reserved actions are rejected with a message naming their existing role. |
| GM-16 | Every state is reachable without a touchscreen, and every new control appears in `docs/cta-inventory.md`. |
| GM-17 | `0` enters game mode from any page, is inert inside a text field and inside any open overlay, and never reaches the joystick relay; the Quick Menu carries the same entry. |
| GM-18 | With auto-enter on, a user-initiated launch of a `prg`, `crt` or `disk` item that succeeds enters game mode; a `sid`/`mod` item, a playlist auto-advance, a failed launch, and an already-open sheet do not. |
| GM-19 | The Home ring's first stop in Quick Actions is Game Mode, and no destructive tile appears before the last safe one, on every variant (§3.2.1). |
| GM-20 | With one non-song item selected, the picker's confirm reads **Play** and launches it; any other selection keeps **Add to playlist** and queues. |
| GM-21 | A keypad user reaches, plays and leaves game mode — including turning the picture off for a television session — **without ever opening Settings**. |

---

## 10. Verification

### 10.1 Unit (vitest)

- `joystickKeyBindings`: the §6.3 table for 0/90/180/270 asserted **cell by cell** against
  the acceptance criteria; the Classic T9 preset resolving identically to today's
  `T9_JOYSTICK_MAP` at rotation 0 (a regression guard on existing behaviour); diagonal
  rotation; fire invariance; reserved-action rejection; persistence round-trip and
  rejection of malformed stored bindings.
- `deviceRotation`: sector boundaries, the hysteresis band (a value 10° past a boundary
  does **not** switch, 25° past does), the dwell filter, `ORIENTATION_UNKNOWN` handling,
  and `frameRotation` including the portrait-lock short-circuit.
- Pointer un-rotation: the delta and point tables in §4.5 as pure functions.
- Fit sizing: aspect swap at 90/270, letterboxing in both axes.

### 10.2 Component (vitest + RTL)

- A launch request opens the sheet in joystick + immersive, with the chrome collapsed when
  the setting is on and not collapsed when it is off.
- `resolveControlSurface` as a pure function: the truth table of setting × modality ×
  `videoLive`, including the never-blank guard (GM-6).
- Entering game mode from a key press hides the controls; a subsequent pointer event shows
  them again; **Always show** / **Never show** ignore both (GM-6a).
- A relayed physical key sets the modality (GM-6b) — the test that fails if
  `RemoteInputSheet` intercepts the key without reporting it.
- With controls hidden **and the picture live**, `VirtualJoystick` is absent and
  `av-mirror-immersive` is present; the restore handle brings the chrome back.
- With controls hidden **and the video mirror off**, `VirtualJoystick` is present (GM-6) —
  the guard against a blank sheet, and the test that fails if the hide rule is written
  without the "while the picture is live" condition.
- Turning Watch off in game mode writes the preference, and a subsequent launch does not
  call `startVideo` (GM-4).
- Rotation change while a key is held emits one held-set update, releasing the old input
  and asserting the new one (GM-9) — the load-bearing test for the most likely defect.
- Tier downgrade during game mode drops out of immersive, as it does today.
- The `0` shortcut: enters from a page, does nothing while a text field holds the ring,
  does nothing while an overlay is open, and does not reach the joystick relay (GM-17).
- Auto-enter: one test per condition in GM-18, each asserting the sheet does **not** open
  — a rule of four conditions is where a later change silently drops one.

### 10.3 End-to-end (Playwright)

- The Home tile and the Play button both open the sheet in game mode; the Play button
  leads the row for a `prg` item and follows Remote Input for a `sid` item.
- Extend `remoteInputKeypadReachability.spec.ts`: `0` enters game mode from Home, Play and
  Settings; the Quick Menu carries the entry; the Home ring's first Quick Action stop is
  Game Mode rather than Reset; and every destructive tile ring-visits **after** every safe
  one (GM-19). Assert the ring order, not the `focusOrder` props — the ring follows the
  DOM, so a test reading the props would pass while the grid was wrong.
- Rotation is driven through the manual override (§4.4), which is why the override is not
  only a fallback — it makes the whole feature testable without a sensor.
- Screenshots for the manual: game mode portrait, game mode rotated 90°, and the Settings
  key-binding block. Follow the minimal screenshot rule in `AGENTS.md`.

### 10.4 Hardware (Pixel 4 + c64u)

Per `AGENTS.md`, no item here is gated on the 8020.

- Attach with the `hil-attach` skill after every `./build --install-apk`.
- Drive keys through CDP `Input.dispatchKeyEvent` with a **hold** between `rawKeyDown` and
  `keyUp`. Do not use single `adb shell input keyevent` taps: the machine polls the
  keyboard matrix once per frame and a sub-frame tap is missed
  ([[machine-input-drives-cia-matrix]]).
- Prove the direction that actually reached the machine by reading **`$DC00`** through
  c64bridge (port 2, active low) rather than trusting the app's own state
  ([[c64bridge-register-hil-verification]]). Assert the 8-centred table at 0°, 90° and
  270° with the override pinned, then repeat one orientation with the override on Auto and
  the phone physically turned — the app is portrait-locked, so the layout will not follow
  and the sensor path is what is under test.
- Confirm audio is actually sounding, and use `tools/hil/audio_e2e_probe.py` rather than
  listening, if the sound is in question at all (`audio-quality-probe` skill).

### 10.5 What cannot be verified until the handset ships

State these plainly in the as-built section rather than carrying them as open work:

- The `KeyboardEvent` codes the 8020's keypad emits through Sailfish AppSupport. Mitigated
  by construction: the `keypad` profile binds several plausible aliases per key, and
  press-to-bind (§6.5) lets a user fix any key the profile misses.
- Whether AppSupport delivers `OrientationEventListener` callbacks. Mitigated by the
  manual override, which makes the feature usable with no sensor at all.
- Whether the keypad supports two keys held at once (diagonals). Mitigated by defaulting
  to cardinals only.

---

## 11. Documentation upkeep (same change)

- **`docs/cta-inventory.md` — mandatory.** §4.1's Home hierarchy is listed in ring order, so
  the reorder in §3.2.1 changes it even where no CTA is added or removed. New controls with
  their testids:
  `home-machine-inline-openGameMode`, `play-open-game-mode`,
  `remote-input-rotation-override`, `remote-input-quick-keys-toggle`,
  `settings-joystick-key-layout`, `settings-joystick-bind-<slot>`,
  `settings-hide-game-mode-controls`, `settings-game-mode-on-launch`, and the Quick Menu's
  Game Mode entry; plus the keypad reachability of each. §1's keypad device model and §2's
  navigation summary also gain the `0` shortcut, which is a change to the documented
  global key map, not only to a page's control list.
- **The manual is generated.** Edit `scripts/build-manuals.mjs`, never
  `docs/manual/**/*.md` ([[manual-md-is-generated]]). The **C64U Remote** edition documents
  the 8-centred default, the orientation table and the hidden-controls default; the
  **C64 Commander** edition documents Game Mode, the presets and the setting, without
  naming the handset. Both use the naming helpers. The keypad keystroke table in the Live
  View chapter must stay accurate to `handlePhysicalKeyDown`, which this change touches.
  Both editions state the television case in the Remote Input chapter, in one sentence
  next to Game Mode — for example: *"Playing on a television? Turn Watch off once and Game
  Mode will keep opening without the picture."* Without that line, the definition in §3.0
  exists only in this document. The **Number Keys** table in the appendix gains
  `0` → Game Mode, and the Quick Menu paragraph gains its entry.
- **`docs/features-by-page.md`** — Game Mode on Home and Play.

---

## 12. Requirements traceability

| Original acceptance criterion | Where it is specified |
| --- | --- |
| Map physical keys per the orientation table | §6.2, §6.3 — derived from one permutation rule |
| Detect orientation changes automatically and update immediately | §4.2, §4.3, §6.6 |
| Rotate only the C64U live view; rest of the app stays portrait | §4.1, §4.5, §2 (non-goals) |
| Live view uses all available space including full width | §4.6 |
| Setting to hide all on-screen controls in game mode | §5.1 — kept as a three-state setting, with **Auto** deciding from observed modality |
| That setting enabled by default in `c64u-remote` | §5.1 — satisfied by construction: a keypad user is never in `pointer` modality, so Auto hides them. No variant entry, and the same rule gives a tablet the opposite, also correct, answer |
| Streamed games playable in all three orientations | §10.1, §10.3, §10.4 |
| *(added)* One action to enter game mode, from Home and from Play | §3.1, §3.2 |
| *(added)* "Game Mode" keeps one meaning across the three entry points | §3.0 |
| *(added)* Game mode usable with the picture off, for a C64U wired to a television | §3.4 |
| *(added)* A keypad-only user reaches game mode without learning where features live | §3.5 — one `0` keystroke, a Quick Menu and guidance-bar hint, the first Quick Action, auto-enter on launch, and a picker confirm that launches |
| *(added)* Larger touch devices get on-screen controls without configuring anything | §3.0 rows C/D, §5.1 |
| *(added)* No Settings visit is ever required on a keypad handset | GM-21 |
| *(added)* Quick Actions ordered by frequency and severity, so no destructive tile leads | §3.2.1, GM-19 |

---

## 13. Risks

| Risk | Handling |
| --- | --- |
| A rotated stage breaks pinch/pan in a way only visible when the handset is turned | §4.5 pointer un-rotation, unit-tested as pure functions (§10.1) |
| A held key stranded across a rotation change asserts a direction forever | §6.6, with a dedicated component test (§10.2) |
| Sensor flapping near 45° makes the controls unpredictable | §4.3 hysteresis + dwell; §4.4 override |
| `screen.orientation.angle` sign convention differs by implementation | §4.1 — hard 0 under portrait lock, calibrated otherwise |
| `RemoteInputSheet` grows past the modularization guardrail | §8.2 — extract launch handling and physical-key routing into hooks in the same change |
| Game Mode leaves streams running behind a closed sheet | §3.3 — stop exactly what the launch started |
| "Game Mode" is read as "streaming mode", so a television user avoids it | §3.0 defines the term without Live View in it; §3.4 makes the picture a remembered, one-tap component; the manual states the television case explicitly (§11) |
| The in-sheet toggle now starts streams, which it did not before | Intended (§3.0), and reversible in one tap from the same sheet; the exit rule in §3.3 stops what it started |
| Auto-enter opens a sheet the user did not ask for | Off by default outside `c64u-remote`; four conditions in GM-18, one test each; Back leaves in one keystroke |
| `0` fires while the user means to type a digit | It sits on the existing shortcut path, which already excludes text fields and open overlays — the same exclusions that make `1`–`6` safe today (GM-17) |
| Controls flicker in and out as modality changes mid-game | Hiding is delayed by the existing `CONTROLS_HIDE_MS`, showing is immediate, and only a real pointer event shows them; **Always show** is the escape hatch if a device proves noisy |
| A touch device whose user starts game mode by key (e.g. a Bluetooth keyboard) loses its on-screen controls | One touch brings them back, and **Always show** makes it permanent |
| The picker's confirm changing from "Add to playlist" to "Play" surprises someone | The label states the action before it happens, and it changes only for a single non-song selection; multi-select and tunes are untouched |
| `#` conflicts with an app-level function | §5 — the global handler already bows out inside overlays; assert it in the reachability spec |

---

## 14. As-built

Shipped on `feat/game-mode`. GM-1 … GM-21 are implemented; this section records what was
built as designed, what deviated and why, and what the hardware run proved.

### 14.1 Requirement coverage

| # | Where it is tested |
| --- | --- |
| GM-1 | `gameMode.spec.ts` "the Home tile opens the sheet already in game mode"; `PlayFilesPage.featureFlagContracts.test.ts` for the Play button and its ordering rule; HIL "GM-1 Home tile opens the sheet" |
| GM-2 | `gameModeLaunch.test.ts` — flags, remembered preferences, idempotence, and what each launch reports |
| GM-3 | `RemoteInputSheet.gameMode.test.tsx` "stops only the streams the launch started"; HIL "closing the sheet stopped the feeds Game Mode started" (0 packets on the wire afterwards) |
| GM-4 | HIL "the next launch opens without a picture"; `AvMirrorControls.test.tsx` records the Watch answer |
| GM-5 | `RemoteInputSheet.gameMode.test.tsx` GM-14 group; HIL "`#` shows the quick keys + Live View row" |
| GM-6 | `gameModeControlSurface.test.ts` never-blank guard; HIL "GM-6 picture off + driving by key" |
| GM-6a | `gameModeControlSurface.test.ts` truth table; `RemoteInputSheet.gameMode.test.tsx` Auto/Always/Never |
| GM-6b | `RemoteInputSheet.gameMode.test.tsx` "hides the controls during play"; verified load-bearing; HIL "GM-6b driving by key hides the on-screen controls" |
| GM-7 | `joystickKeyBindings.test.ts`; HIL keys 2/8/4/6/5 read at `$DC00` |
| GM-8 | `joystickKeyBindings.test.ts` §6.3 table cell by cell; HIL asserts the same table at 0°, 90° and 270° on the machine |
| GM-9 | `RemoteInputSheet.gameMode.test.tsx` (verified load-bearing), `gameMode.spec.ts`, HIL "left before the turn, up after it, nothing stranded" |
| GM-10 | `deviceRotation.test.ts` hysteresis and flat-device cases; `useDeviceRotation.test.ts` dwell; `DeviceRotationPluginTest.kt` for the native quantiser |
| GM-11 | `AvMirrorImmersive.test.tsx`; `gameMode.spec.ts` "the picture turns with the handset while the app stays portrait" |
| GM-12 | `AvMirrorImmersive.test.tsx` pan and pinch at 90° and 270°, asserting the `panBy`/`zoomBy` argument |
| GM-13 | `AvMirrorImmersive.test.tsx` fill/aspect tests; `deviceRotation.test.ts` `fitStageSize` |
| GM-14 | `RemoteInputSheet.gameMode.test.tsx`; HIL `#` on and off |
| GM-15 | `GameModeSettingsSection.test.tsx` press-to-bind, reserved-action rejection, slot moves and clears |
| GM-16 | `docs/cta-inventory.md` updated; `remoteInputKeypadReachability.spec.ts` and `gameMode.spec.ts` |
| GM-17 | `useFocusNavigation.test.tsx` (`0`, text field, open overlay, no handler); `gameMode.spec.ts` from Home, Play and Settings |
| GM-18 | `gameModeEntryPoints.test.ts`, one test per condition |
| GM-19 | `MachineControls.test.tsx` "leads with Game Mode and keeps every destructive tile after every safe one"; `gameMode.spec.ts` asserts the rendered order |
| GM-20 | `gameModeEntryPoints.test.ts` `resolvePickerConfirm` |
| GM-21 | The keypad path is `0` → play → `#` for Watch/Listen → Back, each covered above; no Settings visit appears in it |

### 14.2 Deviations from this document

| Decision | What shipped | Why |
| --- | --- | --- |
| §6.5 Classic T9 preset | `0` is no longer a second fire key | A binding maps one action per slot (§6.1), and §6.5 lists the preset as `5` fire. `0` is the Diamond's `down`; a key that fired in one preset and steered in another was the ambiguity the slot model removes. |
| §4.4 override placement | The orientation control renders only in Game Mode's chrome | That is what §4.4 asks for. Rendering it in the ordinary sheet as well cost a row that pushed the mirror into the joystick on a compact display. |
| §5.1 never-blank guard | The guard applies to **Auto** only; **Always show** and **Never show** are honoured exactly | The guard exists because Auto *guesses*. Overriding an explicit answer made "Never show" read as broken — reported from the device: the setting was on and the joystick was still there. The sheet is still not empty without the controls: the floating **Controls** handle is always present and `#` brings up the quick keys and the Live View switches. |
| §8.1 `RemoteInputLaunchRequest` | Not shipped as a type | The epoch it carried lives in the request bus, which claims each request exactly once. An exported interface nobody constructs is dead code. |
| §3.2.1 tile order | Save REU sits before the RAM pair rather than after it | The component places *safe extras* as one group; splitting them to put one extra between Load RAM and Reset would key the layout off a specific action id. |
| Icons | Remote Input now uses a keyboard icon, Game Mode the gamepad | The reorder puts them in the same row, and two controls with the same icon and different labels is a hesitation the reorder would otherwise have introduced. |

### 14.3 What the hardware run proved

Pixel 4 + C64U (firmware 1.2.0, core 1.4D), Boulder Dash II from `Boulder Dash 2.d64`.
Every input claim was read back from the machine's own `$DC00` (port 2, active low), never
from the app's own state.

- **26/26** on the Game Mode matrix: the §6.3 table asserted on the machine at 0°, 90° and
  270°; GM-9's held-key re-derivation (left → up, nothing stranded); `#`; and closing the
  sheet leaving nothing held.
- **Gameplay**: FIRE from the phone started the game and the picture came alive on the wire
  (mean 198 changed bytes per frame, against a still title screen); each direction held and
  released cleanly; two keys held gave a real diagonal and released one at a time.
- **Both input routes**: physical keys through the binding resolver, and the on-screen stick
  and FIRE through pointer handling, both reached `$DC00` and both released on lift.
- **Edge cases**: backgrounding the app with a direction held released it; closing the sheet
  released it; a turn while two keys were held produced the turned diagonal with nothing left
  over; repeated enter and exit left one coherent sheet and nothing held; Watch off was
  remembered across a close and reopen, and the sheet was never blank.
- **Audio**: the Ultimate's own stream is clean on the wire — 0 % sequence loss, 4.00 ms mean
  inter-arrival, and the tone ladder graded 34/34 notes in tune with a -90 dBFS silence floor
  and an A/V offset of -15.1 ms (undetectable per ITU-R BT.1359-1). On the phone, 0 underruns
  over sustained windows with the picture both on and off, buffer 110–167 ms at 50 fps. A
  cumulative 1289 underruns had accumulated earlier in the session, during repeated stream
  restarts, app backgrounding and device reloads — not during steady play.

Two defects were found by this run and fixed:

1. The sheet stripped its chrome on the state that had been **requested** rather than the one
   in **effect**. With the capability probe unresolved, it showed the "Game mode" header with
   neither the mode toggle nor an Exit button on it — no way out but the Android Back key.
   Every stripped-UI decision now keys off `gameMode`, and the regression test fails without it.
2. The summoned toolbar put itself away after 2.6 s of elapsed time, so reaching across it for
   **Watch** lost it mid-reach. It now waits on *idle* and is re-armed by any interaction.

### 14.4 What cannot be verified until the handset ships

Stated plainly rather than carried as open work:

- The `KeyboardEvent` codes the Callback 8020's keypad emits through Sailfish AppSupport.
  Mitigated by construction: the `keypad` profile binds several plausible aliases per key, and
  press-to-bind (§6.5) lets a user fix any key the profile misses.
- Whether AppSupport delivers `OrientationEventListener` callbacks. Mitigated by the manual
  override, which makes the feature usable with no sensor at all — and which is what the
  hardware run used to assert the orientation table.
- Whether that keypad reports two keys held at once. The Pixel 4 does (the diagonal was read
  at `$DC00`), and the default binds cardinals only, so a keypad without rollover loses nothing.
