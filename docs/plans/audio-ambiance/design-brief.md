# Sound card: visual design brief

Owner: product owner. Goal: a top-of-the-line, premium, world-class look and feel for the tone curve and the whole Sound
card. The first implementation was judged as "a junior engineer spent 10 minutes on it": imprecise, bland, monochrome,
not inviting. This brief replaces the visuals. The data and math layer (true filter response, compensated gains,
`ToneCurvePlot` props) stays as built; the rendering is redone.

## Principles

1. **Precise.** The drawn curve is the true response of the filters, handles sit exactly on it (see AMB-03 acceptance),
   and nothing wobbles. No overshoot, no end kinks, no stray bumps.
2. **Alive and colorful, with taste.** Color carries meaning, never decoration: pitch, ambiance and gain each map to color.
3. **Inviting.** The curve is the hero. It looks like an instrument you want to touch, with a clear touch affordance.
4. **Calm hierarchy.** One focal element, quiet labels, no nested card chrome, generous spacing.
5. **Same family as the app.** Use the app tokens for surfaces, text and radii; color accents come from a small defined palette.

## Color system

- **Pitch hue along the curve.** The stroke is a horizontal gradient from bass to treble: warm coral/orange (31 Hz), amber,
  yellow-green (500 Hz), teal (2 kHz), azure, violet (16 kHz). Handles take the hue of their frequency. This reads as a
  spectrum and is colorful by construction.
- **Gain polarity.** The area between the 0 dB line and the curve is filled with the local pitch hue at low opacity,
  stronger for boosts (luminous) and desaturated and cooler for cuts. The fill fades to transparent toward the 0 dB line.
- **Ambiance accent.** Each ambiance has its own accent and background wash (a very soft radial or linear tint of the
  card, 6 to 10% in light, 12 to 18% in dark) so switching an ambiance visibly changes the mood of the card:
  Original (neutral steel), Late night (deep indigo and violet), Headphones (teal), Phone speaker (green), Warm (amber),
  Bright arcade (magenta and cyan), Hall (violet and rose), Studio (cool white and slate). The active chip is filled with
  its accent; inactive chips have a colored dot.
- **Light and dark.** Dark mode lets color glow (luminous stroke, soft bloom). Light mode uses deeper, more saturated
  hues so strokes keep contrast of at least 3:1 against the card surface and text 4.5:1. Verify both.
- Never rely on color alone: values are also shown as numbers, and the selected handle has a shape change.

## Layout and elements

- **Collapsed card:** one row of at most 56 px: accent dot, "Sound", the active ambiance name (accent color, truncating with
  an ellipsis only if needed at 320 px), the On/Off switch and a chevron. Hit areas 44 px. The ambiance accent tints the
  dot and a thin left edge only. This is the default state and must look intentional and calm next to the Spectrum card.
- Expanded card order: header (title "Sound", On/Off switch with a clear label), ambiance chip row, the curve plot,
  readout, tone preset chips, a Normalize volume switch, then two notched sliders (Stereo width, Reverb); no collapsed fine-tune fold. No card inside a card.
- **Plot.** Edge to edge within the card padding, minimum 200 px high at 320 px width (taller on larger profiles, about
  16:9), corner radius from tokens. Horizontal guide lines at +12, +6, 0, -6, -12 dB: the 0 dB line is a clear thin
  line, the others faint and dotted. Vertical guides only at the labeled frequencies. dB labels on the left inside the
  plot, frequency labels along the bottom at the true band positions (31, 125, 500, 2k, 8k, 16k), minimum 14 px,
  tabular numerals, muted color, never overlapping at 320 px.
- **Curve.** 2.5 px stroke, round caps, the pitch gradient, a soft glow (blurred duplicate at about 30% opacity), drawn from the
  sampled true response with a smooth path.
- **Handles.** Ten solid dots, 14 px visual, white ring of 2 px, soft shadow, in the pitch hue, exactly on the curve.
  Selected handle: 22 px with a halo and a value bubble above it ("1 kHz  +3.0 dB", pill with the hue). Hit area 44 px.
  While dragging, a vertical guide line from the handle to the axis.
- **Spectrum backdrop.** The live spectrum as a very faint area (8 to 12% opacity) behind the curve. Stops when hidden.
- **Header readout.** Title left, readout of the selected band (tabular numerals) and an icon-style Reset (rotate-left
  glyph, 44 px hit area, tooltip text) right.
- **Chips.** Pills with 44 px height, horizontal scroll with fade edges, snap, active chip filled with its accent and
  elevated slightly. Keypad focus ring clearly visible against the accent.
- **Motion.** Preset change: the curve morphs by a spring in at most 200 ms and the card wash cross-fades; dragging follows
  the finger 1:1 with no lag. Reduced motion: instant.

## Process and acceptance

- The designer works in a **screenshot critique loop**: render with Playwright (compact 320 and medium, light and dark),
  open each PNG, write a short critique against this brief, fix, repeat. At least six rounds. Keep the before and after
  images of rounds 1, 3 and the last in `artifacts/ambiance-design/`.
- Final checklist, each item answered yes with the evidence image: handles on the curve; no kinks; no label collisions at
  320 px; contrast met in light and dark; colors differ per ambiance and per pitch; the card looks balanced when
  collapsed, expanded and in the disabled state; looks good at arm's length; nothing looks like a default form control.
- Behavior and tests from `spec.md` are unchanged and must stay green.

## Notched sliders (Stereo width and Reverb)

- One slider per effect, full width, 44 px touch height, a track with a filled portion in the effect's accent, a large
  thumb with a soft shadow, and visible **notches** (small ticks with a label beneath each: Off, Subtle, Wide; Off, Room, Hall).
- Dragging is continuous; the thumb snaps magnetically to a notch when released or when within about 6% of the track
  to it, with a subtle scale pulse on snap. Tapping a notch label or tick jumps there (spring, at most 200 ms).
- A live readout above the thumb ("Subtle, 35"). The active notch label is bold and in the accent color. Under reduced
  motion: no pulse, instant jump.
- Accessibility: role slider, `aria-valuetext` with the notch name, Left/Right jump between notches, hold repeats in
  steps of 5, focus ring visible against the accent. Targets 44 px, label text at least 14 px, fits 320 px with three
  labels without collisions.
- The same slider component is used for both effects (shared component, props: notches, accent, value).
