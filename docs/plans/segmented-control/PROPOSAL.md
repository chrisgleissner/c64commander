# Segmented control for "Listen on" and "Show on"

A decision document. It explores one option — replacing two three-button rows with a true
single-select segmented control built on `src/components/ui/toggle-group.tsx` — and gives the
measurements, the knock-on consistency question, the arguments against, and a recommendation.

Nothing in `src/` was changed. Every number below was measured with a throwaway prototype that was
mounted into the two real components, measured at 320x427, and then removed; the harness is
reproduced in Appendix B.

---

## 1. What this is about

Two places in the app ask the same three-way question: **where should this go — this device, the
C64, or both?**

- **"Listen on"** (`src/pages/playFiles/components/PlaybackEngineToggle.tsx`) decides which speakers
  a SID tune comes out of. *Local* renders the tune on the phone. *Remote* sends it to the C64 and
  you hear it from the television. *Both* plays it on the C64 and streams the C64's audio back to
  the phone at the same time. *Both* is hidden, not disabled, when the C64's audio cannot reach the
  phone, so this control has **two options as often as three**.
- **"Show on"** (`src/components/palette/ScreenColorsSheet.tsx`) decides where a chosen VIC colour
  palette lands. *Local* repaints Live View on the phone only. *Remote* writes the palette to the
  C64 so the television changes. *Both* does each. This one always has three options and carries a
  one-line hint underneath that spells out what the current choice means.

The two were deliberately built to match. The comments say so and reference each other — "the same
question about a different sense", and *Local, Remote, Both* ordered as "a progression from this
device outwards". Both render as a `<div role="group">` with a `<Label>` above and a
`<div className="flex flex-wrap gap-2">` holding three `<Button>`s.

**The problem is the compact display profile.** That is the Callback 8020: a 480x640 panel at a
device pixel ratio of 1.5, so the page gets **320x427 CSS pixels**. Type does not shrink there — the
profile deliberately scales it *up*, so `text-xs` renders at 16px and `text-sm` at 18px — and touch
targets stay at 44px. The result is that three buttons at 18px type need 305px of width and the
container gives them 262px. The row wraps, "Both" drops onto a second line, and the control costs
96px of height instead of 44px on a screen whose scrollable area is under half that of any other
profile.

The option explored here is to stop letting the row wrap and instead divide the available width
into equal segments — a segmented control, the iOS/Material pattern — using the Radix
`ToggleGroup` primitive that already sits unused in `src/components/ui/toggle-group.tsx`.

---

## 2. Current versus proposed, drawn at 320 CSS px

Horizontal scale below is **1 character = 8 CSS pixels**, so the 262px column inside the Screen
colours sheet is 33 characters wide and the 278px column inside the Play page's playback card is 35.
Vertical is schematic; the measured height of each block is printed to its right.

### 2a. "Show on" — three options, with the hint line (Screen colours sheet, 262px column)

**Current — wraps to two lines**

```
|<--------------- 262 px = 33 chars --------------->|

 Show on                                              label      19.6 px
 ┌─────────┐ ┌────────────┐                           ┐
 │ ▣ Local │ │ ▣ Remote   │                           │  row      96.0 px
 └─────────┘ └────────────┘                           │  (2 lines,
 ┌─────────┐                                          │   8 px apart)
 │ ▣ Both  │                                          ┘
 └─────────┘
 Changes the picture in Live View on this              hint      63.4 px
 device only. The C64 is not touched.
                                                       GROUP    196.8 px
```

Widths are measured, not drawn to taste: Local 90.4px, Remote 111.4px, Both 87.7px, two 8px gaps.
That is 305.4px of content in a 262px box, so the third button wraps.

**Proposed — one line, labels only**

```
|<--------------- 262 px = 33 chars --------------->|

 Show on                                              label      19.6 px
 ╔══════════╤═════════╤══════════╗                    row        50.0 px
 ║  Local   │ Remote  │   Both   ║                    (44 px segments
 ╚══════════╧═════════╧══════════╝                     + 6 px track)
 Changes the picture in Live View on this              hint      63.4 px
 device only. The C64 is not touched.
                                                       GROUP    150.8 px
```

Each segment is 84.0px wide. The widest label, "Remote", needs 73.4px including its padding, so
there is 10.6px to spare. The selected segment is filled (`data-[state=on]` → primary background),
the other two are transparent on the track.

**Proposed with the icons kept — does not fit**

```
 ╔══════════╤═════════╤══════════╗
 ║ ▣ Local  │▣ Remote │  ▣ Both  ║   "Remote" needs 93.4 px of content in an
 ╚══════════╧═════════╧══════════╝   84.0 px segment. 9.4 px spills across the
                                     divider. Measured, not predicted.
```

### 2b. "Listen on" — three options, no hint (Play page playback card, 278px column)

```
CURRENT                                       PROPOSED

|<-------- 278 px = 35 chars -------->|       |<-------- 278 px = 35 chars -------->|

 Listen on                     19.6 px         Listen on                     19.6 px
 ┌─────────┐ ┌────────────┐                    ╔═══════════╤══════════╤══════════╗
 │ ▣ Local │ │ ▣ Remote   │            96.0    ║   Local   │  Remote  │   Both   ║  50.0
 └─────────┘ └────────────┘            px      ╚═══════════╧══════════╧══════════╝  px
 ┌─────────┐
 │ ▣ Both  │                                   GROUP                        80.0 px
 └─────────┘
 GROUP                       126.0 px
```

### 2c. The two-option case — "Both" hidden because `canStreamBack` is false

This is the case that decides how much the change is worth, because it already fits.

```
CURRENT — already one line, 44 px          PROPOSED — one line, 50 px

 Listen on                                  Listen on
 ┌─────────┐ ┌────────────┐                 ╔════════════════╤════════════════╗
 │ ▣ Local │ │ ▣ Remote   │                 ║     Local      │     Remote     ║
 └─────────┘ └────────────┘                 ╚════════════════╧════════════════╝

 row 44.0 px   GROUP 74.0 px                row 50.0 px   GROUP 80.0 px
```

Local (90.4px) plus a gap plus Remote (111.4px) is 209.8px, comfortably inside 278px. **In the
two-option case the segmented control saves nothing and costs 6px**, because the outer track adds a
1px border and 2px of padding on each side.

---

## 3. Measurements

Taken in Chromium through the repo's own Playwright harness, at the `compact` entry of
`playwright/displayProfileViewports.ts` (320x426 CSS px, `c64u_display_profile_override=compact`),
against the real components on their real surfaces. Full method in Appendix B.

### 3a. Does it fit at 320px?

**Yes for three labels. No for three labels with icons.** This was the single most important thing
to find out, and it is decisive.

| Variant | Segment width available | Widest segment needs | Verdict |
| --- | --- | --- | --- |
| 3 labels, no icon — sheet (262px) | 84.0 px | 73.4 px ("Remote") | fits, 10.6 px spare |
| 3 labels, no icon — Play (278px) | 89.3 px | 73.4 px | fits, 16.0 px spare |
| 3 labels **with icon** — sheet | 84.0 px | 93.4 px | **overflows by 9.4 px** |
| 3 labels **with icon** — Play | 89.3 px | 93.4 px | **overflows by 4.0 px** |
| 2 labels, no icon — Play | 135.0 px | 73.4 px | fits, 61.6 px spare |

"Needs" is the element's intrinsic width, measured by cloning each segment into a hidden
`width: max-content` box, so it is the width at which the content stops being cut, not an estimate.

The overflow is not a truncation with an ellipsis. `src/index.css` sets
`overflow-wrap: anywhere` on `button` and `span`, and the segment sets `whitespace-nowrap`, so the
label simply spills past the segment's edges and collides with the divider. There is no
`text-overflow` on this path.

Two further notes on the icon:

- `buttonVariants` forces `[&_svg]:size-4` and `[&_svg]:shrink-0` on its base. `toggleVariants`
  does neither, so an icon inside a `ToggleGroupItem` renders at the `h-3.5 w-3.5` the call site
  asks for (14px, not 16px) and, unless the icon component sets `shrink-0` itself, is free to
  collapse under flex pressure. `FileOriginIcon` does set `shrink-0`; a bare lucide glyph does not.
- At the `medium` profile (393x727, 328px column) the icon variant does fit: the widest segment
  needs 96.9px and gets 105.7px. So the icons only fail on compact.

### 3b. Heights and pixels saved

| Surface / variant | Row height | Whole group | Saved vs current |
| --- | --- | --- | --- |
| **Screen colours sheet, 262px column** | | | |
| current, 3 options (wraps) | 96.0 px | 196.8 px | — |
| Radix segmented, bordered track | 50.0 px | 150.8 px | **46.0 px** |
| segmented with no outer track | 44.0 px | 144.8 px | **52.0 px** |
| **Play page playback card, 278px column** | | | |
| current, 3 options (wraps) | 96.0 px | 126.0 px | — |
| Radix segmented, bordered track | 50.0 px | 80.0 px | **46.0 px** |
| segmented with no outer track | 44.0 px | 74.0 px | **52.0 px** |
| **Two-option case (Play)** | | | |
| current, 2 options (one line) | 44.0 px | 74.0 px | — |
| Radix segmented, bordered track | 50.0 px | 80.0 px | **−6.0 px** |

The brief's estimate of "roughly 52px" is right for the row itself (96 → 44) but **only if the
segmented control carries no outer track**. The conventional segmented look — one rounded outline
around all three segments, with the selected one filled — costs 6px of border and padding, so the
real saving for that design is **46px per control**.

The two controls are never on screen together: "Show on" lives in a modal sheet opened from Home,
"Listen on" lives on the Play page. So the honest figure is **46px (or 52px) on whichever of the
two surfaces the user is looking at**, not 92px of combined saving. On a 427px-tall viewport whose
scrollable area is roughly 300px after the app bar and tab bar, 46px is about 15% of a screenful.

### 3c. Touch targets and type

Every variant clears both floors.

| | Segment height | Label size |
| --- | --- | --- |
| current buttons | 44.0 px | 18 px (`text-sm` on compact) |
| segmented, `min-h-11` | 44.0 px | 18 px |
| group label | — | 16 px (`text-xs` on compact) |
| hint line | — | 16 px |

Two traps that would break this if the control were written naively:

1. `toggleVariants` sizes are `h-10` / `h-9` / `h-11` (40 / 36 / 44px) and, unlike `buttonVariants`,
   it has **no `min-h-11` on the base**. A `ToggleGroupItem` written without an explicit `min-h-11`
   lands at 40px and fails `MIN_TARGET_PX = 44` in `playwright/smallScreenErgonomics.spec.ts`.
2. The compact type scale in `src/index.css` keys off the **class token**
   (`:root[data-display-profile="compact"] :where([class~="text-sm"])`), not the computed size. A
   `ToggleGroupItem` that inherits `text-sm` from `toggleVariants` without repeating the class in
   its own `className` gets no compact compensation and renders at Tailwind's base 14px — under the
   16px body floor. The class has to be written out at the call site.

`npm run lint:font-size-floors` is not the gate here: `scripts/check-font-size-floors.mjs` only
scans for arbitrary sizes of the form `text-[Npx]` below 11px and has no opinion on named steps.
The real gates are `MIN_BODY_TEXT_PX = 16` and `MIN_TARGET_PX = 44` in `smallScreenErgonomics.spec.ts`.

### 3d. Alternative measured: keep the buttons, change the layout

Because the wrapping is caused by the *layout*, not by the button component, the prototype also
measured the current `<Button>`s in an equal-width grid — `grid grid-cols-3 gap-2` instead of
`flex flex-wrap gap-2` — with no Radix involved at all.

| Variant (sheet, 262px column → 82.0px per column) | Widest needs | Verdict | Row height |
| --- | --- | --- | --- |
| current buttons, icons, `size="sm"` (`px-3`) | 111.4 px | all three overflow | 44.0 px |
| current buttons, labels only, `px-3` | 91.4 px | "Remote" overflows by 9.4 px | 44.0 px |
| current buttons, labels only, `px-1` | 75.4 px | **fits, 6.6 px spare** | 44.0 px |
| current buttons, icons, `px-1` | 95.4 px | "Remote" overflows by 13.4 px | 44.0 px |

So a plain grid of the existing buttons, with the icons dropped and the horizontal padding reduced,
fits at 320px, is 44px tall, and saves the **full 52px**. This matters for the recommendation.

---

## 4. How a user would work the control — every scenario

This is where the two designs genuinely differ, and the differences were measured on a live page
with the keypad flag on, not reasoned about. `data-key-selected="true"` is the app's focus-ring
highlight; DOM focus is `document.activeElement`.

### 4a. Touch — the common case

| Scenario | Current three buttons | Radix segmented |
| --- | --- | --- |
| Tap an unselected option | It becomes selected. Measured. | Same. Measured. |
| Tap the option that is **already** selected | Nothing changes. Measured. | **With a guard in `onValueChange`, nothing changes. Without one, the option deselects and the control shows nothing selected.** Both measured. |
| Tap it a third time | Nothing changes. | Unguarded: it comes back on. So an unguarded control flickers off and on under a double-tap. |

The deselect is not hypothetical. `@radix-ui/react-toggle-group@1.1.19` has no `required` prop; its
single-type root wires `onItemDeactivate: () => setValue("")`, and clicking the active item calls
it. The prototype confirmed it: with the guard removed, `aria-checked` went `false, false, false`
after a second tap on the selected segment. Every call site must write
`onValueChange={(next) => { if (next) setX(next); }}` — the shared wrapper in
`src/components/ui/toggle-group.tsx` does **not** do this for you.

### 4b. Keypad / D-pad — the Callback 8020, which has no touchscreen

The app's focus ring is a DOM walk, not a tab-order walk. `src/lib/input/discovery.ts` lists
`"button"` by tag name and `[role='radio']` in `INTERACTIVE_SELECTOR`, and nothing filters on
`tabIndex`. **So the two segments Radix marks `tabindex="-1"` stay reachable.** That was the first
thing worth checking and it is fine.

Three things are not fine, and all three were observed on a live page:

| Scenario | Current three buttons | Radix segmented |
| --- | --- | --- |
| Walking down onto the control with the D-pad | The ring stops on Local, then Remote, then Both. **3 stops.** | The ring stops on the **group itself**, then Local, then Remote, then Both. **4 stops.** |
| What the extra stop does | — | Landing on it puts the highlight around all three segments while DOM focus is already on the first one — two rings on screen. Pressing OK there runs the ring's default activation, `element.click()` on the group `<div>`, which does nothing. It is a dead stop. |
| Pressing Right on an option | Highlight and DOM focus both step to the next option; past the last one they carry on to the next control on the card. | **The highlight stays on "Local" while DOM focus moves invisibly to "Remote", then "Both".** Selection does not change. The user sees the ring on one option and the next OK press acts on another. |
| Pressing OK on an option | It becomes selected. | It becomes selected. |
| Pressing OK twice on the same option | Nothing changes. | Guarded: nothing changes. **Unguarded: nothing is selected any more.** |

The extra stop appears because Radix's roving-focus root renders `tabindex="0"` on the
`role="radiogroup"` div, which matches `[tabindex]:not([tabindex='-1'])` in `INTERACTIVE_SELECTOR`.
`role="radiogroup"` is *not* in `GROUP_CONTAINER_SELECTOR`, so the ring treats it as a leaf rather
than as a container. Adding `data-focus-group` to the root fixes it.

The Right-arrow desync happens because the two systems each half-handle the key.
`src/hooks/useFocusNavigation.tsx` bails out of Left/Right when the target is inside a
`role="radiogroup"` (`HORIZONTAL_OWNER_SELECTOR` in `discovery.ts`), deliberately handing the key to
the widget. Radix then moves DOM focus. But the bail-out path neither dispatches nor re-syncs the
ring, and `adoptActiveElement()` only runs in pointer modality, so the highlight is left behind.

There is also a semantic mismatch with what the app promises. `docs/cta-inventory.md` states that on
a value control — "slider/tabs/segmented" — Left and Right mean **decrement / increment**. Radix's
roving focus moves focus *without* selecting, so Right would traverse and the user would still have
to press OK. The current three buttons do not promise anything different from what they do: Right is
just "next control".

### 4bb. The option set changing underneath the user

"Listen on" can lose its third option while someone is looking at it: a failed `startAudio()` latches
`streamingFailed`, `canStreamBack` goes false, and "Both" is removed from the DOM.

| Scenario | Current three buttons | Radix segmented |
| --- | --- | --- |
| "Both" disappears while the ring is on Local or Remote | The row re-lays out from three buttons to two on one line; the ring keeps its position because it re-walks the DOM. | The grid goes from three columns to two, each segment growing from 89.3px to 135.0px. The ring keeps its position for the same reason. |
| "Both" disappears while the ring is on "Both" | The ring's element is gone; the next D-pad press re-walks the DOM and lands on a sibling. | Same for the ring, but Radix's roving group is additionally holding `currentTabStopId` for a node that no longer exists, so the first Left/Right afterwards has no defined starting point. |
| Tapping "Both" and having it fail | The button vanishes under the finger and the selection falls back to *Remote*. | Identical, plus the group re-renders from three columns to two, so the two remaining segments jump in width at the moment of the tap. |

Neither design handles the third row gracefully; the segmented version adds a visible width jump
because equal columns must re-divide when a column is removed.

### 4c. Screen reader

| | Current | Radix segmented |
| --- | --- | --- |
| Container | `role="group"` with `aria-label="Show on"` | `role="radiogroup"` |
| Option | plain `<button>` with `aria-pressed` | `<button role="radio">` with `aria-checked`, `aria-pressed` explicitly removed |
| Announced as | "Show on, group. Local, button, pressed." | "Show on, radio group. Local, radio button, selected, 1 of 3." |

The radiogroup announcement is genuinely better — it says how many options there are and which one
of them this is, which the button version cannot. This is the strongest argument *for* the change.

The cost is that `aria-pressed` disappears. `ToggleGroupItemImpl` hard-sets
`{ role: "radio", "aria-checked": pressed, "aria-pressed": undefined }` for `type="single"`. Eleven
assertions across `tests/unit/playback/PlaybackEngineToggle.test.tsx` and
`tests/unit/components/palette/ScreenColorsSheet.test.tsx` read `aria-pressed` and would all have
to move to `aria-checked`.

### 4d. Mouse and physical keyboard on the web build

Tab reaches the control once (roving tabindex) rather than three times, then Left/Right traverse and
Space/Enter select — standard radiogroup behaviour, and better than three tab stops. Note that
Radix's roving focus has `loop = true` by default, so Right on the last segment wraps to the first
instead of leaving the control.

---

## 5. The consistency map

`flex flex-wrap gap-2` holding `<Button>`s is the house pattern. `grep -rn "flex flex-wrap gap-2" src/`
returns **19 hits**. `flex flex-wrap` in any form appears 73 times in `src/`; of those, about 32 are
rows of `<Button>`s and the rest are chip, checkbox or plain layout rows. Changing two of the 19
creates a new inconsistency, so the question is: what else must change, and what must not.

### 5a. Category (a) — genuinely the same control, and would have to follow

Single-select, a small fixed set of mutually exclusive choices, a label or heading above, no action
semantics. These are the ones a "segmented control" convention would have to cover to be a
convention rather than an exception.

| Site | Choice | Options | Compact-visible | Fits as one row of segments at 320px? |
| --- | --- | --- | --- | --- |
| `ScreenColorsSheet.tsx:64` | Show on | 3 | in a dialog | yes, labels only |
| `PlaybackEngineToggle.tsx:138` | Listen on | 2 or 3 | yes | yes, labels only |
| `settings/SidRadioSettingsSection.tsx:190` | SID emulation engine | 2 | developer mode only | yes |
| `settings/SidRadioSettingsSection.tsx:240` | SID chip fallback (6581/8580) | 2 | yes | yes |
| `settings/SidRadioSettingsSection.tsx:282` | Crossfade length | 5 | yes | **no** |
| `playFiles/components/SleepTimerControl.tsx:93` | Sleep timer | 6 | yes | **no** |
| `components/streams/StreamStatsPanel.tsx:168` | Frame-rate mode | 4 | while streaming | marginal |
| `components/streams/StreamStatsPanel.tsx:218` | History window | 4 | while streaming | marginal |
| `components/itemSelection/ItemSelectionDialog.tsx:624` | Search scope | 2 | in a dialog | yes |
| `components/remoteInput/VirtualJoystick.tsx:355` | Movement style | 3 | yes | probably |
| `components/diagnostics/HeatMapPopup.tsx:81` | Count / Latency | 2 | in a dialog | yes |
| `SettingsPage.tsx:1185` | Theme | 3 | yes | already a `grid grid-cols-3` |
| `SettingsPage.tsx:1220` | Text size | 4 | yes | already a `grid grid-cols-2` |
| `SettingsPage.tsx:1265` | Display profile | 4 | yes | already a `grid grid-cols-2` |
| `SettingsPage.tsx:1295` | Screen orientation | 3 | yes | already an auto-fit grid |

**The two rows that hurt most on compact cannot become segmented controls.** Crossfade has five
options and Sleep timer has six. Derived from the measured 18px label widths (a six-character label
is 65px of glyphs), five "Longest"-class segments need roughly 390px and six sleep-timer segments —
one of which is "This tune" — need well over 500px, against a 262-278px column. They must keep
wrapping, or become a `Select`, or use a two-row grid. That is the crux of the consistency
argument: a segmented control is not a general answer to "this row wraps"; it is only available at
two or three short options.

The four Settings appearance selectors are worth calling out separately: they are **already**
equal-width grids that do not wrap, and they carry no `aria-pressed` at all today. They have no
problem to solve, and converting them would mean re-verifying four controls on the app's most
keypad-walked page for zero pixels.

### 5b. Category (b) — superficially similar, must NOT change

These share the `flex flex-wrap gap-2` markup and nothing else.

- **Action rows.** Nothing is "selected"; each button does a thing. `SettingsPage.tsx:1697`
  (Cancel / Use device), `:1861` (SAF diagnostics), `:1904` (Export / Import settings),
  `HomePage.tsx:1693` (lighting actions), `DiskContentsDialog.tsx:109` (Run / Load / Mount per
  entry), `PlayFilesPage.tsx:2545` (the seven-button sheet launcher row),
  `PlaylistPanel.tsx:138`, `PlaybackConfigSheet.tsx:186`, `PlaybackConfigOverrideEditor.tsx:240`,
  `ManageConfigDialog.tsx:72` (Rename / Delete per config), `HvscControls.tsx:242`,
  `HvscPreparationSheet.tsx:133`, `DeviceDiscoveryInterstitial.tsx:554`, `ItemSelectionView.tsx:58`,
  `ArchiveSelectionView.tsx:208`, `HealthHistoryPopup.tsx:157`, `DiagnosticsDialog.tsx:765`,
  `AvSyncPanel.tsx:144/200/261`, `LightingStudioDialog.tsx:1204` (preset appliers).
- **Multi-select and independent toggles.** A segmented control is single-select by definition.
  `components/streams/AvMirrorControls.tsx:72` is two *independent* on/off toggles that happen to sit
  in one row. `PlaylistPanel.tsx:85` is a checkbox filter row. `DiagnosticsDialog.tsx`'s
  `FilterToggleChip` rows are the same.
- **Variable option counts.** `LightingStudioDialog.tsx:1529` (city search results, however many the
  query returns), `HomeDiskManager.tsx:2608` (existing disk groups), `LightingStudioDialog.tsx:486`
  (one or two surfaces depending on the hardware). Equal-width segments do not survive an unbounded
  or unknown count.
- **`PlayFilesPage.tsx:2545` deserves its own line** because it is the biggest wrapping row on the
  compact profile and the temptation to "fix" it the same way will be real. It is seven buttons that
  each open something. It is a menu, not a choice.

### 5c. Category (c) — out of scope

Developer-mode-only and lab surfaces, which the 8020 user never sees:
`DeviceSwitchLabPage.tsx:397` (route `/__device-switch__`, test-probe builds only), the three
`LightingStudioDialog` rows and `HomePage.tsx:1693` (feature flag `lighting_studio_enabled` is
`developer_only`), and `SidRadioSettingsSection.tsx:190` (SID emulation engine, gated on developer
mode). They can follow the convention later or not at all; they do not gate this decision.

### 5d. So what does "if we do this, what else must change" come to?

- **Minimum honest scope for a segmented control convention: 8 sites.** The two target-pickers,
  the SID chip fallback, the two StreamStatsPanel rows, the item-selection search scope, the
  joystick movement style, and the heat-map metric. All are 2-4 short options.
- **3 sites in category (a) cannot follow** (Crossfade at 5, Sleep timer at 6, and Text size /
  Display profile at 4 with long labels like "Standard display"), so the app would end up with two
  visual languages for the same kind of question anyway.
- **4 Settings grids** would be a judgement call; they already solve the problem a different way.
- **17+ sites must be left alone** and would then look like the odd ones out for the wrong reason —
  they are rows of *actions*, and the fact that they look like the choice rows today is arguably the
  existing bug.

---

## 6. Trade-offs, stated against the option

**Against.**

1. **The saving is 46px, not 52px**, for the segmented control as normally drawn. The 6px difference
   is the outer track. Dropping the track to recover it gives up the thing that makes a segmented
   control read as one control.
2. **It buys nothing in the two-option case and costs 6px.** "Listen on" is two options whenever the
   C64's audio cannot reach the phone, which is not a rare state — it is what happens whenever Live
   View or the audio mirror is off, or after one stream-back failure latches `streamingFailed`.
3. **Radix `type="single"` deselects.** No `required` prop exists in 1.1.19. Every call site must
   guard `onValueChange`, and the shared wrapper does not. A future call site that forgets gets a
   control that can show nothing selected.
4. **It adds a dead focus-ring stop** (3 → 4) and needs `data-focus-group` on the root to remove it.
5. **It desyncs the focus ring from DOM focus on Left/Right**, which is a regression specifically on
   the keypad-only device this change exists to help. Fixing it means touching
   `useFocusNavigation.tsx`'s horizontal bail-out to re-sync the ring — a change to shared input
   plumbing, for two controls.
6. **Left/Right would traverse without selecting**, contradicting `docs/cta-inventory.md`'s stated
   contract that Left/Right on a segmented control decrement and increment.
7. **`aria-pressed` becomes `aria-checked`**, breaking 11 existing unit assertions across two test
   files, plus `deviceNamingConsistency.test.tsx` which reaches inside each button for its icon.
8. **The icons cannot survive at segment width on compact** — measured, 9.4px of overflow. The
   icons are not decoration: `FileOriginIcon` is the app's shared local/C64U vocabulary, used by the
   source chooser, the playlist rows and the disks list, and the comment in `PlaybackEngineToggle`
   records that inventing a different glyph here was a bug that got fixed.
9. **`toggleVariants` has none of the safety rails `buttonVariants` has** — no `min-h-11`, no
   `whitespace-nowrap`, no `[&_svg]:shrink-0`, no `[&_svg]:size-4`. Each has to be re-added by hand
   at the call site, and the next call site has to remember.
10. **One golden screenshot changes** (`docs/img/app/play/sid-radio/03-listen-on.png`), and
    regenerating it has to be pruned carefully — `npm run screenshots` rewrites around 200 PNGs with
    machine render drift.

**For.**

1. The row stops wrapping and the control gets 46px shorter on the screen with the least room.
2. `role="radiogroup"` + `aria-checked` is the correct ARIA for "pick exactly one", and a screen
   reader announces "1 of 3" instead of "pressed".
3. One tab stop instead of three on the web build.
4. The primitive already exists in the repo and is currently dead code.
5. Equal-width segments make the three options look equally weighted, which matches the semantics —
   today "Remote" is 24% wider than "Both" for no reason other than the length of the word.

---

## 7. Recommendation

**Fix the layout, not the primitive. Do not adopt Radix `ToggleGroup` for these two controls.**

Concretely, for `PlaybackEngineToggle` and `ScreenColorsSheet`'s `TargetToggle`:

1. Replace `className="flex flex-wrap gap-2"` with an equal-width grid whose column count follows
   the number of options actually rendered — three normally, two when `canStreamBack` is false.
2. Drop the icons from these two controls and reduce the buttons' horizontal padding to `px-1`.
   Measured: this fits at 320px with 6.6px to spare on the widest label, in the tighter of the two
   containers.
3. Keep everything else exactly as it is — `<Button>`, `aria-pressed`, `role="group"` on the
   wrapper, the three ring stops, the testids, the hint line, the ordering.

This gives the **full 52px** (row 96 → 44), keeps the two-option case at 44px instead of making it
6px worse, and requires **no** changes to the focus ring, `useFocusNavigation.tsx`, the ARIA
contract, or any existing unit or E2E assertion. The `docs/cta-inventory.md` edit shrinks to a note
that the row no longer wraps and that the icons are gone.

The icons are the real cost, and dropping them at every profile rather than only on compact is
deliberate: the two manuals are illustrated at different profiles (compact for the C64U Remote
edition, medium for C64 Commander), so a control whose content differs between profiles needs two
explanations and two screenshots.

**What I would not do:**

- I would not introduce `ToggleGroup` here. Its benefits are the ARIA announcement and the single
  tab stop; its costs are a dead ring stop, a focus-ring desync on the exact device this is for, a
  deselect hazard with no framework-level guard, and a rewrite of 11 test assertions. That is a bad
  trade for 46px when 52px is available for a one-line layout change.
- I would not touch the other 17 wrapping rows. Nearly all of them are action rows, and the fact
  that they resemble the choice rows is a pre-existing inconsistency this change should not inherit.
- I would not convert Crossfade (5 options) or Sleep timer (6 options) to segments. They do not fit,
  and they are the two compact-visible rows that wrap worst — they need their own decision, probably
  a two-row grid or a `Select`.
- I would not shrink any type to make anything fit. The compact profile scales type up on purpose.
- I would not make "Both" a disabled segment when `canStreamBack` is false. Hiding it and dropping
  the grid to two columns is right, and it is what the existing comment argues for.

**If the vote goes to `ToggleGroup` anyway**, the minimum set of mitigations is: `min-h-11`,
explicit `text-sm`, and `whitespace-nowrap` on every item; icons removed; a guard
`if (!next) return;` in every `onValueChange` (better: put it in the shared wrapper so it cannot be
forgotten); `data-focus-group` on the root to stop it becoming a ring stop; a fix in
`useFocusNavigation.tsx` so the horizontal bail-out re-syncs the ring highlight to
`document.activeElement`; and the `aria-pressed` → `aria-checked` migration in the two unit test
files.

---

## 8. What `docs/cta-inventory.md` would require

`AGENTS.md` (§ "CTA inventory upkeep") makes updating this file mandatory in the same change
whenever a control is added, removed, renamed, re-typed, or re-grouped. There is **no automated
validator** — `grep -rn "cta-inventory" scripts/ tests/ playwright/` returns nothing outside the
docs themselves — so the contract is enforced by review alone. This section says what would have to
be edited; it does not edit it.

**Under the recommended layout-only change:**

- Line 206 (Home → Video → Screen colors sheet) and lines 303-307 ("Listen on") stay accurate as to
  type and testids. Both notes should record that the row is now a fixed-width grid that does not
  wrap, and that the origin icons were removed.
- Line 304 is **already stale** regardless of this decision: it describes `playback-engine-c64` as
  "labelled with the device's own name, falling back to `C64U`", while the code renders the literal
  word "Remote" and `PlaybackEngineToggle.test.tsx` pins `["Local", "Remote", "Both"]`. Fix it in
  the same pass.
- The §3 per-page CTA counts do not move: still three buttons on Play, still three in the sheet.

**Under the `ToggleGroup` option, additionally:**

- The legend at line 152 lists the allowed type words (`button`, `link`, `tab`, `slider`, `select`,
  `checkbox`, `text`, …). A `role="radio"` segment is none of them, so a new type word would have to
  be added and both rows re-typed from `button ×3`.
- The §3 counts change on both pages if the radiogroup root is left as a ring stop, and the §4
  hierarchy has to record the group as a focus container rather than as three siblings.
- Line 41-42 and line 88 both promise that Left/Right on a segmented control decrement and
  increment. Radix moves focus without selecting, so either the doc changes or the implementation
  has to add selection-follows-focus.
- §7 says the inventory is verified by enumerating CTAs over CDP on the device. That enumeration
  would have to be re-run for Home and Play.

---

## Appendix A — measured numbers, raw

Compact profile, 320x426 CSS px, root font 16px, `text-xs` = 16px, `text-sm` = 18px.

Container widths: Screen colours sheet inner column **262.00px**; Play page playback card
**277.98px**. (Medium profile for comparison: 328.00px. Expanded: 729.75px.)

Current buttons, both surfaces: Local **90.38 x 44**, Remote **111.38 x 44**, Both **87.67 x 44**;
gap 8px; total 305.43px.

Segment intrinsic widths inside a `ToggleGroupItem` with `px-1`:

| | Local | Remote | Both |
| --- | --- | --- | --- |
| label only | 54.38 | **73.38** | 47.67 |
| label + 14px icon + 6px gap | 74.38 | **93.38** | 67.67 |
| label only, per-segment border (flat variant) | 56.38 | **75.38** | 49.67 |

Same measurement for the existing `<Button size="sm">` in a grid:

| | Local | Remote | Both |
| --- | --- | --- | --- |
| icons, `px-3` | 90.38 | **111.38** | 87.67 |
| labels only, `px-3` | 70.38 | **91.38** | 65.67 |
| labels only, `px-1` | 54.38 | **75.38** | 49.67 |
| icons, `px-1` | 74.38 | **95.38** | 71.67 |

Available per column at 3 columns: **84.00px** (sheet, segmented track) / **82.00px** (sheet,
`grid gap-2`) / **89.33px** (Play, segmented track) / **87.33px** (Play, `grid gap-2`).

Focus ring, measured live with `c64u_feature_flag:keypad_input_enabled` set:

```
current row      →  3 ring stops: local, remote, both
segmented row    →  4 ring stops: <div role="radiogroup" tabindex="0">, local, remote, both

Right on current:   ring local → remote → both, DOM focus follows, selection unchanged
Right on segmented: ring stays on local, DOM focus local → remote → both, selection unchanged

OK on an option:            selects it, in both designs
OK twice on the same one:   current unchanged; segmented unchanged only when onValueChange guards
                            an empty value, otherwise aria-checked = false,false,false
Tap twice on the selected:  current unchanged; unguarded segmented deselects, then reselects
```

DOM attributes:

```
current:    <div role="group"> ▸ <button aria-pressed="true|false">          (no tabindex)
segmented:  <div role="radiogroup" tabindex="0">
              ▸ <button role="radio" aria-checked="true|false" tabindex="-1" data-state="on|off">
```

## Appendix B — how the measurements were taken

A throwaway prototype rendered nine layout variants — the current wrapping row at three and two
options, four `ToggleGroup` variants (icons / labels only / borderless track / unguarded
`onValueChange`), and four grid-of-`<Button>` variants — **inside the two real components**, so they
inherited the real containers, the real compact type scale, and the real Tailwind build. A
throwaway spec at `playwright/segmentedStudy.spec.ts`:

1. set the viewport and profile with `applyDisplayProfileViewport(page, "compact")` from
   `playwright/displayProfileViewportUtils.ts`, the same helper the existing display-profile,
   ergonomics and screenshot specs use;
2. reached the Screen colours sheet through Home → Video → Screen colors, and the Play page with a
   seeded HVSC playlist so a SID is the current item and `PlaybackEngineToggle` renders;
3. waited out the dialog's zoom-in animation before measuring — measuring during it reports every
   box about 2% small, which is how the first pass produced 43.07px "44px" buttons;
4. read `getBoundingClientRect()` for each group, row and item, and measured each item's intrinsic
   width by cloning it into a hidden `width: max-content` box;
5. enumerated ring stops with the app's own `INTERACTIVE_SELECTOR` from `src/lib/input/discovery.ts`,
   then confirmed the count by walking the ring with real ArrowDown presses and reading
   `data-key-selected`;
6. drove ArrowRight, Enter, Space and pointer taps against both designs and recorded the ring
   position, `document.activeElement` and `aria-pressed` / `aria-checked` after each.

Run with `PLAYWRIGHT_PORT=4823` to avoid the shared default preview port. The prototype and the spec
were deleted afterwards; `git status` in this worktree shows only this document.
