# 06 — A/V Mirror UX refinement (cross-app Live View)

**Refines capabilities D and E** of the [Content Explorer](./overview.md) initiative.
**Feature flags:** `audio_mirror_enabled`, `video_mirror_enabled`
**Status:** Draft → implementing.

> Goal: make hearing and seeing the running machine a **small, cohesive, non-invasive**
> feature that is available _where it matters_ (Home, Remote Input, Play, Disks) —
> never duplicated, never overpowering, always with the user in control of start/stop.

---

## 1. Principles

1. **One session, many surfaces.** There is a single, app-wide A/V mirror session
   (one audio stream, one video stream). Every surface observes and controls that
   same session — starting Audio on Home and opening Remote Input shows the _same_
   live audio, not a second stream. No surface owns the stream; the session does.
2. **Small by default.** The feature must feel like a minor convenience, not a media
   player. Audio-only consumes **no** screen real estate beyond a compact toggle and
   a subtle "live" indicator. Video defaults to a small **check** preview.
3. **User is always in control.** Every surface that shows the mirror can start and
   stop it. Stopping anywhere stops the shared session everywhere.
4. **Degrade gracefully.** Audio has no CPU gate. Video is frame-throttleable and
   size-independent (native 384×272 decode, GPU-scaled), so even the Callback 8020
   can show a check preview; immersive is possible there but heavily throttled.
5. **Design language.** Reuse existing primitives (cards, `AppSheet`, `Button`,
   `Badge`, icons already in the app). No new visual paradigm.

---

## 2. Modes

| Mode                  | What it is                                                                                      | Where                                                      | Real estate |
| --------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------- |
| **Audio only**        | Hear the machine. A toggle + a subtle "live" indicator.                                         | Everywhere the control appears                             | ~none       |
| **Video — check**     | A small, high-level image of the screen (native-res decode, CSS-scaled small). Expand/collapse. | Home (under quick actions), Remote Input (collapsed), Play | small       |
| **Video — immersive** | A large, integer-scaled image for playing games / driving apps by keyboard/joystick.            | Remote Input **game mode**; expand-from-check              | large       |

Audio and Video toggle **independently** (audio can run with video off — the common,
cheap case). "Check" vs "immersive" is only a _display size_ choice — the same single
video stream drives both; switching size never restarts the stream.

---

## 3. Surfaces

- **Home** — a compact **Live View** control directly **beneath the quick actions**:
  an Audio toggle and a Video toggle, plus a collapsible **check** preview. Expanding
  enlarges the preview inline; it is the primary place to discover the feature. Behind
  `audio_mirror_enabled` / `video_mirror_enabled` and `deviceCapabilities.supportsStreaming`.
- **Remote Input sheet** — the mirror pairs naturally with driving the machine. A
  collapsible video preview sits **above** the joystick/keyboard; the input controls
  are always present (they are the sheet's purpose). In **game mode** (the existing
  immersive joystick toggle) the video fills the immersive area behind/above the
  edge-anchored controls. An Audio toggle lives in the sheet header.
- **Play** — "hear what's playing" is high value: an Audio toggle in the page header,
  plus an optional check preview.
- **Disks** — lower priority; the same compact Audio toggle is available in the drive
  area so a user can hear a just-mounted disk boot. (Optional; ships if it fits without
  clutter.)

**No duplication rule.** Each surface renders the _shared control_, not its own stream.
A single reusable control (`AvMirrorControls`) and a single reusable preview
(`AvMirrorPreview`, size = check | immersive) are composed per surface.

---

## 4. Indicators (avoid ambiguity)

Audio-only leaves no visible panel, so ambiguity ("is it on?") is a real risk. Two
lightweight, non-invasive signals:

- **In-control state.** Wherever `AvMirrorControls` renders, the Audio/Video buttons
  show a lit/active state with a small "live" dot when their stream is live.
- **Global live pip.** A tiny indicator (speaker / eye glyph) appears in the app bar
  **only while a stream is live**, so a user who navigates away still knows the mirror
  is running and can tap it to jump back / stop. It is invisible when nothing streams.

---

## 5. Architecture

```
src/lib/streams/avMirrorSession.ts     NEW  app-wide singleton: owns the single
                                            AudioMirrorController + VideoMirrorController,
                                            broadcasts snapshot + video frames, exposes
                                            toggle/start/stop for audio & video.
src/hooks/useAvMirror.ts               NEW  React binding (subscribe to the session).
src/components/streams/AvMirrorPreview.tsx   NEW  canvas subscribing to session frames,
                                                 size = "check" | "immersive".
src/components/streams/AvMirrorControls.tsx  NEW  compact Audio + Video toggles + live dots.
src/components/streams/LiveViewCard.tsx      NEW  Home composite (controls + collapsible check).
src/components/streams/AvMirrorLivePip.tsx   NEW  app-bar live indicator.
```

The session reuses the existing `AudioMirrorController` / `VideoMirrorController` (D/E)
unchanged as the engine; it just makes them shared and broadcasts frames so multiple
canvases (Home check + Remote Input) can render the same stream. The old single-purpose
`AudioMirrorPanel` / `VideoMirrorPanel` are superseded by these cohesive pieces.

---

## 7. Immersive Screen Control (zoom / pan / follow) — Remote Input game mode

Some devices (e.g. the Callback 8020) are driven entirely by a physical keypad, so the
video mirror must become a first-class, controllable screen — not just a picture. This
lives in the Remote Input sheet's existing **game mode**: when video is on and game mode
is entered, the mirror maximises to the **full width** of the sheet (height proportional,
native 384×272 aspect), and becomes zoomable, pannable, and optionally activity-following.

### 7.1 The one hard rule — input never ambiguous

The single biggest risk is a user not knowing whether a physical key drives the C64 or
moves the view. Resolved with an **explicit, impossible-to-miss view-lock mode**:

- **Two modes, colour-coded, always shown:** **Driving C64** (calm/primary border + a
  small "◀ relaying" chip) vs **Adjusting view** (amber border + a "🔍 view" chip). The
  border colour of the mirror is the persistent, glanceable signal.
- **One flip control, three ways to reach it:** an on-screen toggle (`⟳ Adjust` / `✓ Done`),
  a **dedicated physical key** (the menu/`*` key), and it auto-exits Adjust back to Drive
  after a short idle so a user can't get stranded. A short **haptic** fires on every switch.
- **Who owns what input:**
  - Touch **on the mirror** → always view (pinch = zoom, drag = pan, double-tap = zoom-to-point). Natural — you're touching the picture.
  - On-screen **joystick / keyboard** controls → always relay to the C64.
  - On-screen **zoom controls** (＋ − ⤢ ◎) → always view.
  - **Physical keys / D-pad / keypad** → **mode-dependent**: Drive = relay; Adjust = D-pad pans, ＋/− (or T9 `2/8/4/6` pan, `1/3` zoom) zoom, `0`/`5` reset-to-fit.

Only the genuinely ambiguous surface (physical keys) is mode-switched; everything else has
a fixed, obvious role.

### 7.2 Zoom & pan

- Native 384×272 decode, **GPU-scaled** (CSS transform) — CPU cost is fixed regardless of
  zoom, so even the Callback 8020 can zoom in smoothly.
- Continuous scale 1×–8×; pan is clamped so the view can't leave the frame.
- **Gestures:** pinch-zoom (keeps the pinch focal point fixed), one-finger drag to pan,
  double-tap to zoom toward a point, two-finger double-tap / a `⤢` button to reset-to-fit.
- **On-screen controls:** ＋ / − / ⤢ (fit) / ◎ (follow) — a compact, auto-hiding cluster.
- **Physical (Adjust mode):** D-pad/arrows pan, ＋/− zoom, reset key.
- **Quick to change what's shown:** motion is eased (short lerp), zoom snaps are instant,
  and a single tap on the minimap (§7.4) jumps the view anywhere.

### 7.3 Follow activity (smart)

A toggle (◎, off by default). When on, the app diffs consecutive frames, finds the centroid
of what changed, and **eases the viewport toward it** (debounced + lerped so it glides, not
jitters). Perfect for zooming into the cursor and having the view follow as you type. Any
manual pan/zoom pauses follow briefly so the user always wins. Cheap: subsampled diff on the
already-decoded frame, throttled.

### 7.4 Side-by-side minimap

An optional small **full-frame thumbnail** in a corner of the immersive view showing the
whole screen, with the current viewport drawn as a **rectangle**. The user can **drag the
rectangle** (or tap) on the minimap to reposition the pan instantly — a fast, spatial way to
say "show me that corner". The minimap is another canvas on the same shared stream.

### 7.5 Design tenets

Minimal and calm: controls **auto-hide** after a couple of seconds of no interaction (tap to
reveal), so in play the screen is almost all C64. Everything reuses the app's existing
buttons/typography/spacing. It must read as _"the mirror, but you can zoom"_ — not a new app.

### 7.6 Architecture (additions to §5)

```
src/lib/streams/mirrorViewport.ts    NEW  pure viewport math (scale/pan/clamp, rect, CSS transform).
src/lib/streams/motionTracker.ts     NEW  pure activity detection (frame-diff centroid/bbox) for follow.
src/hooks/useMirrorViewport.ts       NEW  viewport state + zoom/pan/fit ops + smart-follow (subscribes to frames).
src/components/streams/AvMirrorImmersive.tsx  NEW  the maximised zoom/pan surface: mode lock, gestures,
                                                   on-screen controls, minimap, physical-key routing.
src/components/streams/AvMirrorMinimap.tsx    NEW  full-frame thumbnail + draggable viewport rectangle.
```

Integrates into `RemoteInputSheet` game mode; physical-key events route to viewport ops when
in Adjust mode and to the existing relay when in Drive mode.

## 8. As-built

**Shipped as designed.** The shared session and cross-app Live View landed exactly as
§1–§7 describe:

- **Shared session (§1, §5).** `src/lib/streams/avMirrorSession.ts` — one app-wide
  `AvMirrorSession` (singleton `avMirrorSession`) owning the single `AudioMirrorController`
  - `VideoMirrorController`, broadcasting snapshot + decoded video frames. `useAvMirror` /
    `useAvMirrorCanvas` (`src/hooks/useAvMirror.ts`) are the React bindings; any number of
    canvases render the one stream. No surface owns the stream; stopping anywhere stops it
    everywhere.
- **Surfaces (§3).** **Home** shows `LiveViewCard` directly beneath the quick actions
  (`AvMirrorControls` + a collapsible `AvMirrorPreview` that grows check→immersive on
  expand). **Remote Input** pins `AvMirrorControls` (`remote-input-mirror-controls`) in
  the sheet chrome and mounts `AvMirrorImmersive` above the input controls. Play/Disks
  reuse the same `AvMirrorControls` where wired. Every surface renders the shared control,
  never its own stream (the no-duplication rule).
- **Indicators (§4).** In-control lit state + a pulsing `LiveDot`; a global app-bar
  `AvMirrorLivePip` (`av-mirror-live-pip`) that appears only while a stream is live and
  stops all mirroring on tap.
- **Immersive screen control (§7).** `mirrorViewport.ts` (pure scale/pan/clamp/rect/CSS
  transform) + `motionTracker.ts` (pure frame-diff centroid/bbox) + `useMirrorViewport`
  (viewport state, zoom/pan/fit, eased smart-follow). `AvMirrorImmersive` is the maximised
  GPU-scaled surface: pinch/drag/double-tap gestures, an auto-hiding ＋/−/⤢/◎ cluster, the
  colour-coded **view-lock mode** (blue "Driving C64" / amber "Adjusting view") reachable
  by on-screen toggle, the `*`/Menu physical key, and idle auto-revert, plus `AvMirrorMinimap`
  (draggable viewport rectangle). Physical keys route to viewport ops only in Adjust mode.

**Flags & defaults.** `audio_mirror_enabled` and `video_mirror_enabled` are both
user-visible and non-developer (any user can toggle), but ship **off by default**: the
phone app has no stream receiver (UDP transport) yet, so on-by-default would present a
non-functional control — the deliberate "fragile / known to break" exception. The web
path works through the `streamReceiver.web` UDP→WebSocket bridge seam; the native UDP
receiver plugin is the one remaining piece before either can be safely defaulted on.

**Deviation from §3.** The optional Disks audio toggle is deferred (the plan flagged it
as "ships if it fits without clutter"); Home + Remote Input are the shipped surfaces.
