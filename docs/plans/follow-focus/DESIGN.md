# Live View follow-focus: locking the view on to one object

Status: implemented, unit- and scenario-tested, **not yet run on hardware**.

## 1. What this is, and what it is called

Live View already has a follow behaviour: with the ◎ toggle on, the app diffs consecutive frames
and eases the viewport toward wherever the picture changed. That is useful for watching a cursor
while typing, and useless while playing a game — everything moves, so the view drifts toward the
centre of mass of all the motion rather than toward the player.

This adds a second behaviour **on top of** the first: the user presses and holds a point on the
picture, the app works out which object is under it, and the view then stays with that object
while everything else moves independently.

### Naming

The two behaviours are layered, not alternatives, so the naming has to say that.

| Layer           | User-facing name  | What it does                                                  |
| --------------- | ----------------- | ------------------------------------------------------------- |
| Base (existing) | **Follow motion** | The view drifts toward whatever changed on screen.            |
| On top (new)    | **Lock on**       | Press and hold something; the view stays with that one thing. |

The toggle stays a single control labelled for the base behaviour. Locking on is not a mode the
user selects — it is something they do to a particular object, and the app falls back to
follow-motion by itself when the object is gone. There is therefore no mode switch to design, and
no setting deciding which of the two is in effect.

"Lock on" is arcade language, which is the right register for this audience; "reticle",
"tracker" and "acquisition" are not, and appear only in code and in this document.

Code names follow the same split: `motionTracker.ts` (unchanged) and `subjectTracker.ts` (new),
with the thing being followed called the **subject**.

## 2. Constraints

- Frames are 384×272, packed 4bpp (two pixels per byte), 16 fixed palette indices, 50 fps PAL.
- The tracker shares the JS thread with video decode and a UI, on a Pixel 4 and on a keypad
  handset with a 320×427 CSS viewport. The native audio pipeline must not underrun.
- The subject flashes, is recoloured permanently, animates, is briefly hidden, wraps round the
  screen, is crossed by things that look exactly like it, and — on a respawn or a room change —
  is somewhere completely different in the very next frame with no motion in between.
- Most of the time it does none of that and simply walks a few pixels per frame.

That last pair is the tension the whole design turns on: the common case wants a calm, smoothed,
narrowly-gated tracker, and the uncommon case wants an instant jump. Neither can be traded away.

## 3. What was considered, and why it was rejected

| Approach                               | Canonical reference                                                                                                                                             | Why not                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mean-shift / CAMShift colour histogram | Comaniciu, Ramesh & Meer, _Real-Time Tracking of Non-Rigid Objects Using Mean Shift_, CVPR 2000; Bradski, _Computer Vision Face Tracking…_, Intel Tech. J. 1998 | The histogram **is** the model, so a sprite that changes colour is lost by construction — and changing colour is an explicit requirement here. It is also a local hill-climb whose search window must overlap the target between frames, which a 40 px/frame sprite does not. On a 16-colour palette the back-projection is coarse and bimodal, so it locks on to any same-coloured region. |
| Template matching, NCC or SAD          | Lewis, _Fast Normalized Cross-Correlation_, VI 1995; drift analysed in Matthews, Ishikawa & Baker, PAMI 2004                                                    | Cost: a 24×21 template over a ±48 px window is ~4.7M multiply-accumulates per tick, an order of magnitude over budget. It also assumes near-rigid appearance, which an animating sprite violates, and correlating palette **indices** arithmetically is meaningless — index 7 and index 8 are yellow and orange, not neighbouring intensities.                                              |
| Sparse optical flow, Lucas–Kanade      | Lucas & Kanade, IJCAI 1981; Bouguet, pyramidal LK, Intel 2000                                                                                                   | Assumes brightness constancy and a well-conditioned spatial gradient. A 4bpp palette-index image has no meaningful intensity gradient, and hard-edged sprite art has no texture to solve for. Fast motion needs a 3–4 level pyramid on top. Wrong tool for this imagery.                                                                                                                    |
| Correlation filters (MOSSE, KCF)       | Bolme et al., CVPR 2010; Henriques et al., PAMI 2015                                                                                                            | The best accuracy-per-cycle in general, but it needs several FFTs and complex-valued buffers per tick, estimates no scale, and its cyclic-shift assumption misbehaves at frame edges — which is exactly where screen-wrap happens. Its real contribution, a scalar failure detector (peak-to-sidelobe ratio), is adopted below in a cheaper form.                                           |
| Blob centroid tracking alone           | Rosenfeld & Pfaltz, JACM 1966                                                                                                                                   | Correct primitive, insufficient policy: on its own it has no answer for a merge with a distractor, an occlusion, or a teleport.                                                                                                                                                                                                                                                             |
| Kalman filter                          | Kalman 1960                                                                                                                                                     | The motion model is right, the machinery is not needed. For a constant-velocity model the α-β filter _is_ the steady-state Kalman filter (Benedict & Bordner, IRE 1962) — two scalar equations instead of 4×4 matrices and a covariance propagation. What is lost is the covariance a validation gate would size itself from, so the gate is widened on an explicit schedule instead.       |

### What was chosen

**Tracking-by-detection with a motion gate, a multi-cue association score, and an explicit
state machine** — in the same family as SORT (Bewley et al., ICIP 2016) reduced to one target.

The reason it is the right choice _here_ rather than in general: on a 16-colour, sprite-based,
hard-edged picture, **segmentation is nearly free and nearly reliable**. That is the property
that makes the expensive appearance models unnecessary. Concretely, per tick:

1. **Sample** a region around the predicted position into a coarse grid (indices wrapped, so a
   region straddling an edge samples the far side).
2. **Estimate the background** as the colours dominating that region — a local, per-tick census
   rather than a stored model, so it follows a scrolling or changing backdrop by itself.
3. **Mask, dilate by one cell, and flood-fill** into connected components. The dilation is for
   connectivity only: a C64 sprite is usually several colours with background showing between
   them, and without it the arms and the body label separately.
4. **Score** each component against the subject model on five cues and take the best.
5. **Update** an α-β filter with the accepted measurement, or coast on the prediction.

The subject model is not one appearance but a small bank of them, so a sprite with several forms
is followed through all of them; see "The subject changes state" below.

Crucially, **detection never uses the subject's colour**. A blob is whatever is not locally
dominant. Colour enters only when scoring the match, which is what makes a recolour survivable.

### The association score

Weights sum to 1 and are searched, not asserted (§6); the search left the design values
unchanged.

| Cue      | Weight | What it is                                                                                         |
| -------- | ------ | -------------------------------------------------------------------------------------------------- |
| position | 0.34   | `1 − distance/gate` from the α-β prediction, distance measured the short way round a wrapping axis |
| colour   | 0.22   | 16-bin palette histogram intersection with the subject model                                       |
| area     | 0.18   | ratio of pixel areas                                                                               |
| shape    | 0.10   | ratio of aspect ratios                                                                             |
| velocity | 0.16   | how far the implied step departs from the filtered velocity                                        |

A candidate is accepted when the weighted total clears `acceptScore` **and** an appearance-only
sub-score (colour, area, shape) clears `minAppearance`. The second bar is what stops position
alone from accepting something; the first is what lets a recoloured subject through.

## 4. The hard cases

**Colour change.** Two mechanisms, and the first is the one that matters. Detection is
colour-agnostic, so a flashing or recoloured sprite is still _found_; colour is only 0.22 of the
score, so a sprite that changes colour completely still scores 0.78 on the other cues — well
above `acceptScore`. Second, the histogram is adapted by an EMA on accepted ticks only, at
0.1 per tick — about 0.4 s at the locked rate: a one-frame flash is averaged away, a sustained
recolour is learned.
The model is never adapted on a tick that was not cleanly accepted, which is the standard rule
(Bolme et al. 2010) and the reason an occluder cannot be learned as the subject.

_Test:_ `keeps the subject through a colour flash and a permanent recolour` drives eight frames
of unrelated palette entries and then a new colour for good, asserting the state stays `locked`
throughout and the position stays on the subject. `accepts a subject that changed colour
entirely` states the score property directly.

**Shape change.** Connected components care about connectivity, not silhouette, so an animating
sprite is one blob in every pose. Area and aspect are ratios with generous tolerance and are
EMA-adapted. The residual centroid wobble is removed by the camera, not the tracker.

_Test:_ `keeps the subject while its silhouette animates` alternates two hand-written masks with
different outlines (arms down/legs together versus arms up/legs apart) for 30 frames.

**Fast motion and screen wrap.** The gate is centred on the α-β _prediction_, not the last
position, and widens with speed. All distance arithmetic is toroidal, and the sampled region
wraps with it, so a sprite leaving one edge is looked for at the other with no special case.

_Test:_ `catches up with a subject moving 40px a frame, including across the screen wrap` runs
six full laps of the frame. Measured: 60 of 60 frames locked, worst in-frame error 27 px.

**Occlusion.** No accepted measurement means coast: keep predicting, damp the velocity, decay
confidence on a wall-clock time constant, and freeze the appearance model. The gate opens as
the coast lengthens.

_Test:_ `coasts through a five-frame occlusion and re-locks where the subject reappears` asserts
the state is `coasting`, that the coasted position _advanced_ (a coast is not standing still),
and that the lock resumes within 6 px and settles within 3 px.

**A look-alike crossing the path.** This is the case appearance cannot solve, because the
distractor looks the same. Three defences, none of which is appearance:

1. The gate. The distractor must be inside it to be considered at all.
2. The best candidate wins, not the first over threshold — and the subject, being at the
   prediction and moving the right way, outscores a distractor that is neither.
3. **Merge detection.** When two sprites overlap they become one component of roughly twice the
   area, whose centroid sits between them. Following that centroid is exactly how a tracker
   changes identity without noticing. So a blob more than `mergeAreaRatio` times the model's
   area is treated as _ambiguous_: the position is not taken, the appearance model is not
   updated, the tracker coasts through on the pre-crossing velocity, and confidence is capped at
   0.35 to say so. This is the cheap approximation of the standard deferred-decision treatments
   (JPDA, Bar-Shalom & Tse 1975; MHT, Reid 1979) and of merge/split handling in blob trackers
   (McKenna et al., CVIU 2000; Senior et al., IVC 2006).

_Test:_ `keeps the right object when an identical decoy crosses it, and says it is unsure`. Two
identical boxes converge, merge and separate. Measured: confidence falls to 0.30 on the merged
frames, the tracked position never leaves the subject by more than about 3 px, and the tracker
comes out the far side on the subject with the decoy more than 60 px away.

**The subject changes state — grows, powers up, transforms.** Mario doubles in height; a ship
gets a shield; a sprite has a walking form and a crouching one. A single blended appearance model
handles none of these: it either refuses the new look or is dragged away from the old one.

So the subject holds a small **bank** of remembered looks — up to four — and a candidate is
scored against the best-matching one. This is the cheap form of the multiple-expert idea (Zhang,
Ma & Sclaroff, _MEEM_, ECCV 2014). Slot 0 is what the user originally picked and is never
evicted, which bounds drift (Matthews, Ishikawa & Baker, PAMI 2004): however far the later slots
wander, the original is always still there to match against.

Learning a new look is also exactly how a tracker poisons itself permanently with whatever
happened to be overlapping the subject, so admission needs four conditions at once:

1. The blob is where the motion model says the subject is, **and moving as it was**. Identity has
   to come from motion precisely because appearance is what disagrees.
2. Nothing else in the region came close to explaining it. An ambiguous frame teaches nothing.
3. It really is a different look, not the current one drifting.
4. It has held for several consecutive ticks — and **longer when the blob is big enough to be a
   merge**. This is what separates the two things that both look like "suddenly bigger": two
   sprites overlapping separate again within a few frames and never earn a slot, while a sprite
   that actually doubled in size stays doubled and does. A merge is provisional; only persistence
   promotes it to a state.

Cost is the reason it is a bank of four and not a general model: the look that matched last is
tried first and the others are skipped when it clears the bar, so on the overwhelming majority
of ticks this costs exactly one histogram intersection, as before.

_Tests:_ `learns a new look when the subject changes state, and follows it afterwards` doubles
the size and changes the colour in one frame, then changes back and asserts the original look is
still recognised. `does not learn a sprite that merely brushes past it` is the negative case.
`follows a subject that doubles in size and shrinks back` is the Mario case directly, and the
`grow` scenario covers it across whole games.

**Teleports — respawn, screen exit, room change.** These are the case the user cannot afford to
have smoothed. Three mechanisms:

1. **Empty-gate escalation.** A subject hidden behind scenery leaves a neighbourhood that still
   contains candidates; one that respawned leaves an empty one. When nothing at all is inside
   the gate for `emptyGateMs`, the search widens to the whole frame at once rather than waiting
   out the full coast.
2. **Scene-cut detection.** A coarse census of the whole frame's palette is compared with the
   previous tick's by histogram intersection. Scrolling, animation and moving sprites leave the
   census nearly unchanged; a new room or a level load does not. On a cut the velocity is
   discarded and the tracker goes straight to a whole-frame search, because the prediction, the
   velocity and the local background estimate are all invalid at once.
3. **Track initiation, not filtering, on re-acquisition.** A whole-frame re-acquisition is
   scored on appearance alone against a higher bar (position carries no information once the
   prediction is a guess), and the accepted measurement _replaces_ the state rather than being
   filtered into it. Feeding a residual the subject never travelled to the velocity gain would
   fling the next prediction off the far side of the screen.

## 5. When the subject is genuinely gone

The state machine is `idle → locked ⇄ coasting → searching → lost`. `lost` is reached only after
the whole-frame search has failed for `searchMs`, and it does something specific: the tracker
drops the subject, the hook hands the viewport back to **follow motion**, and the status chip
says "Lost it" for two seconds before disappearing. The view is never left parked on the empty
background where the subject used to be.

While `searching`, the camera **holds** rather than chasing: the prediction has already been
declared meaningless, so moving the view on it would be moving it at random.

## 6. Tuning: how the numbers were chosen

Hand-picked constants in a tracker are guesses. These were fitted.

`tests/helpers/gameScenarios.ts` generates nine seeded synthetic games with per-frame ground
truth — `platformer`, `shooter` (fast, wrapping), `respawn`, `roomflip`, `powerup` (flashing then
recoloured), `swarm` (five identical look-alikes), `scroller` (moving backdrop), `maze`
(occluding foreground scenery) and `grow` (the sprite doubles in size and back).
`tests/helpers/followFocusEval.ts` scores a run:

```
score = on-target-rate − 1.5 × confidently-wrong-rate − 0.05 × (ticks per second / 50)
```

The asymmetry is deliberate. A tracker that gives up is bad; one that silently follows the wrong
sprite is worse, because the user has no way to tell. The third term prices CPU, so the search
cannot buy quality with an unlimited tick rate. The evaluator honours the rate the tracker asks
for, so what is scored is the tracker **as deployed**.

`scripts/tune-follow-focus.ts` runs coordinate descent over the options and the association
weights. Two seed sets are used and never mixed: the search only ever sees TRAIN, and VALIDATION
is scored once per pass to choose where to stop. It earns its keep — an early run gained 0.07 on
train while _losing_ on validation, which is what over-fitting to particular scenes looks like.

### What it produced

Nine scenario kinds at three seeds each, scored on the held-out seeds:

|                                           | hand-picked start | fitted    |
| ----------------------------------------- | ----------------- | --------- |
| score                                     | 0.31              | **0.51**  |
| on-target                                 | 0.52              | **0.67**  |
| confidently wrong                         | 0.125             | **0.086** |
| median frames to re-lock after a teleport | 20                | **1**     |
| tracker ticks per second                  | 17                | 34        |

Two of those numbers came from changes to the algorithm rather than to the constants, and they
are the two that moved most. Scene-cut detection is what took re-lock from 20 frames to 1. The
speed-adaptive tick rate is what fixed the fast-scrolling cases; the search chose 25 Hz while
locked and 50 Hz while recovering, against a cost term that was free to prefer something slower.

The search then converged: a further pass gained 0.25 on train and **nothing** on validation
(0.5101 against 0.5100), and its parameter set was materially worse on the hardest identity
case. That is over-fitting, not improvement, so the committed defaults are the earlier ones.

### What it does not do well

Honest limits, all on the held-out seeds:

- **Five identical look-alikes crossing constantly** (`swarm`) is the worst case, at 0.36-0.74
  on-target with up to 0.49 confidently wrong on one seed. With five sprites of the same colour,
  the same size and the same animation repeatedly overlapping the subject, motion is the only
  cue left, and it is not always enough.
- **A room change that also repaints the palette** (`roomflip`) still loses one seed badly
  (0.03 on-target). The scene cut is detected; what follows it is a whole-frame search in a room
  where the subject's remembered look no longer matches anything.
- **Repeated deaths** (`respawn`) score 0.10-0.57. The tracker recovers, but a second and third
  death inside a few seconds can leave it searching.

These are the cases to watch on hardware, and the ones a later change should target.

The association weights were included in the search and came back unchanged, which is worth
recording: the split in §3 was reasoned from the requirements rather than fitted, and the fit
agreed with it.

`tests/unit/streams/followFocusScenarios.test.ts` re-runs the validation seeds and fails if the
score regresses, so the tuning is a committed result rather than a note about one afternoon.

## 7. Cost

Measured on the host (Node 24, x86), `npx vitest bench tests/benchmarks/followFocus.bench.ts
--project unit-node --run`:

|                                            | mean        | p99        |
| ------------------------------------------ | ----------- | ---------- |
| tracker tick, locked (region scan)         | **0.10 ms** | 0.18 ms    |
| tracker tick, searching (whole-frame scan) | 0.13 ms     | 0.21 ms    |
| tracker tick, a real synthetic scene       | 0.031 ms    | 0.051 ms   |
| acquire (one long press)                   | 0.124 ms    | 0.221 ms   |
| camera advance                             | 0.0002 ms   | 0.0005 ms  |
| _motion tracker tick, for comparison_      | _0.060 ms_  | _0.096 ms_ |

The comparison line is the point: **a follow-focus tick costs about as much as one tick of the
follow-motion it extends**, and that already ships. Across the scenario suite the tracker asked
for 34 ticks per second on average, so 34 × 0.10 ms ≈ **3.5 ms per second of video, 0.35% of one
core** on the host. (Measured with another agent's test suite running on the same machine; the
fastest observed tick was 0.077 ms, so treat the mean as an upper bound.) A Pixel 4 running this in a WebView is roughly four to six times slower on
typed-array work, which puts it near 1.5%, and a low-end keypad handset near 3-4%. **These are
host figures; the on-device number is one of the things the hardware session is for.**

Why it is that cheap:

- Only a region around the prediction is scanned, not the frame — and only at a step coarse
  enough to keep the sampled grid under a fixed cell budget, so cost does not grow with the
  subject's size or the zoom level.
- The whole-frame search is the expensive case and it is transient, entered only when the
  subject is already missing.
- Every working buffer is allocated once in the constructor and reused, so a steady-state tick
  allocates only the handful of small candidate objects it scores. That matters more than the
  arithmetic on a device where a GC pause is an audio underrun.
- Remembering several looks of the subject costs nothing in the common case: the look that
  matched last is tried first and the rest are skipped when it clears the bar.
- The tracker never runs at the frame rate. At 25 Hz it sees every other PAL frame, which is
  more than the camera's own time constant can use.

## 8. The camera

A viewport that copies each measured centroid shakes, because a walking sprite's centroid moves a
pixel or two every frame. A viewport that merely eases toward it lags, and the subject sits behind
the centre whenever it moves. `followCamera.ts` is first-order exponential smoothing with four
parts:

- **Velocity feed-forward.** The camera aims at where the subject _will_ be. With `lookaheadMs`
  equal to `tauMs` the steady-state lag at constant velocity is exactly zero; the default is
  slightly under, so a sudden stop settles rather than overshoots.
- **A deadzone** of 8% of the visible half-extent, scaled with zoom. Inside it the camera does
  not move at all, which is what removes centroid jitter entirely when the subject is standing
  still. The aim is pulled back to the deadzone edge rather than dropped, so the camera settles
  on the edge instead of hunting across it.
- **A speed cap**, so a re-acquisition on the far side of the screen glides rather than tears.
- **A snap.** The cap is bypassed when the subject is further away than the visible region — a
  respawn or a room change, where a glide would mean seconds of watching empty scenery.

A second-order critically-damped spring was considered and rejected: it overshoots on direction
reversal, and sprites reverse constantly. The feed-forward term buys the anti-lag property
without the overshoot.

Clamping stays in `mirrorViewport.setCenter`, so the camera never has to know about frame edges.

## 9. Interface decisions

The audience is C64 enthusiasts, many in their fifties and sixties, on screens as small as
320 CSS px, including a keypad handset with no touchscreen.

- **A hidden long press is the real risk**, not the visual style of the marker. While Follow is
  on with nothing locked, the status row says **"Hold on your character"**. It disappears the
  moment there is a lock to report instead.
- **The keypad handset needs a route with no touch, and it must be the whole feature.** Nothing
  here may require a touchscreen. In view-lock Adjust mode the D-pad already pans the picture, so
  a crosshair fixed at the centre of the view turns panning into aiming: line the character up
  and press **OK**. The same key releases the lock, and it turns following on by itself, so the
  user has one key to know about rather than two. `0`/`5` keep Fit, which is the other way out.
  `toggleLock()` on the immersive handle is the seam; `useRemoteInputPhysicalKeys` binds it.
- **The chip that reports the lock is also the way out of it.** Tapping "Locked on" releases it.
  A user looks first at the thing telling them the state; a second, separate control is one more
  thing to find. Asking for Fit releases it too — asking for the whole picture is asking to stop
  following one thing.
- **The word does not change when the certainty does.** `coasting` reads "Locked on", the same as
  `locked`; only the colour changes. A word that flickers every time a sprite passes behind a
  wall pulls the eye off the game.
- **The marker is four corner brackets, sized to the subject's own bounding box**, with a
  minimum size — a C64 sprite on a 320 px-wide handset is a few pixels across, and a marker that
  honestly reports that size is one nobody over forty can see. It carries a dark drop shadow,
  because every colour it could use is also a colour the game can paint behind it.
- **Settings → Remote Input → Game Mode: "Mark what the view is following"**, on by default,
  plain wording, no jargon.

The long press cancels on a drag of more than 12 px and on a second finger, so drag-to-pan and
pinch-to-zoom are untouched; each of those is a test.

## 10. The weak cue, and what is still open

### Using the player's own joystick and key presses — built, and deliberately weak

When the player steers with the app's own joystick, the app knows what it asserted, and
correlating that with each candidate's displacement is a _causal_ cue no image analysis can
provide. It is the same idea as motion-correlation selection (Vidal et al., _Pursuits_, UbiComp
2013): identify the object whose trajectory matches a known control signal.

It can only ever be a weak prior, for more reasons than are obvious:

- The player may be driving the machine from a real joystick or keyboard plugged into the C64,
  in which case there is no signal at all. This is the common case, not the exception.
- Sprites keep moving without input — momentum, knockback, auto-scroll, cutscenes, demo mode.
- Input reaches the machine through a network relay and then through the game's own logic, so
  the lag is tens to hundreds of milliseconds and varies.
- "Right" often does not mean "move right". It rotates in _Asteroids_, accelerates in a racer,
  and does nothing at all in a menu.
- **In a side-scroller it anti-correlates.** Pressing right frequently holds the player at the
  centre of the screen and scrolls the world leftwards instead, so a naive correlation points
  straight at the background.

So `inputAffinity.ts` keeps a short ring buffer of asserted directions and a running estimate of
whether _this_ game answers them positionally, and three rules keep it safe:

1. **It only ranks; it never accepts.** The cue is a bonus on the ordering of candidates that
   have already cleared the fitted thresholds. It cannot let through anything the scorer
   rejected, which is what keeps the fitted defaults valid without re-fitting them.
2. **It learns only from accepted measurements**, so what it estimates is the game's response
   rather than the tracker's own guesswork.
3. **It gates itself.** A game that answers the stick with a rotation, a menu or a scrolling
   world produces no agreement, and the bonus goes to zero on its own. Nothing asserted, no cue.

Measured on the held-out seeds, cue off against cue on: score 0.5100 → 0.5110, on-target 0.673 →
0.675. Exactly one scenario moved by more than 0.02, and it was a `swarm` seed — the five
identical look-alikes — which went from 0.891 to 0.950 on-target. **That is the whole result,
and it is the right shape**: inert almost everywhere, a small gain precisely where it was aimed.
A large aggregate move would have meant it had stopped being a tie-break and started overriding
the scorer.

Two caveats worth keeping in view. The synthetic input model asserts a clean sign-of-motion with
a fixed lag, which is kinder than a real relay. And the scenarios model only three policies —
responsive, none (`shooter`), and inverted (`scroller`). Whether the self-gating works against a
real game is a hardware question.

### Identifying the player without being told

The keypad route above still asks the user to aim. "It should just work" means the app proposing
a subject on its own, and the cue that would make that reliable is the one in the section above:
on a keypad handset the user has no other way to play, so the app knows every direction it
asserted, and the object whose motion follows those assertions is the player. That is the same
weak-prior machinery, in the one setting where the prior is strongest. It is deliberately not
guessed at from the picture alone — a wrong automatic lock is worse than no lock, because the
user did not ask for it and has to work out what happened.

### Whether Follow should simply be on

Follow is off by default and the user turns it on. If locking on proves good enough on hardware,
the honest simplification is to stop asking: turn Follow on by default and let the long press be
the only decision the user makes. That is a call to make with a rig and a real game, not from a
unit test.

### What hardware has to answer

Everything above was measured on synthetic frames on a desktop. Three things cannot be:

1. **The on-device cost.** 0.091 ms a tick on this host says nothing definite about a Pixel 4 in
   a WebView, and nothing at all about a keypad handset. What matters is whether the audio
   pipeline still never underruns with a lock held.
2. **Whether a real game's picture segments the way a synthetic one does.** Multicolour sprites,
   sprite-to-background priority, raster effects and a scrolling character backdrop are all
   things the scenarios only approximate.
3. **Whether the gesture is discoverable.** Whether someone who has not read this finds the long
   press, and whether they understand what the marker is telling them.

## 11. Files

```
src/lib/streams/subjectTracker.ts    NEW  the tracker: segmentation, association, state machine.
src/lib/streams/followCamera.ts      NEW  camera smoothing: feed-forward, deadzone, cap, snap.
src/lib/streams/followReticle.ts     NEW  the "mark what the view is following" setting.
src/lib/streams/inputAffinity.ts     NEW  the player's own joystick as a self-gating tie-break cue.
src/hooks/useMirrorViewport.ts       MOD  lockOn/releaseLock, the tick loop, the fallback to follow-motion.
src/components/streams/AvMirrorImmersive.tsx  MOD  long press, marker, status chip, hint, lockCentre.
src/pages/settings/GameModeSettingsSection.tsx  MOD  the marker setting.
tools/c64/follow-lock-demo.asm       NEW  the C64 program the hardware session runs.
tools/c64/follow-lock-demo.prg       NEW  assembled with 64tass; the tests run these bytes.
tests/helpers/vicFrames.ts           NEW  synthetic packed-4bpp frames.
tests/helpers/gameScenarios.ts       NEW  eight seeded synthetic games with ground truth.
tests/helpers/followFocusEval.ts     NEW  the objective the tuning is against.
scripts/tune-follow-focus.ts         NEW  coordinate descent with a held-out seed set.
tests/benchmarks/followFocus.bench.ts  NEW  per-tick cost.
```
