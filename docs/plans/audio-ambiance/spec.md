# Sound card: audio processing on the Play page, a graphic tone curve and ambiance presets

Status: specification (product owner decisions taken 2026-10-24). Applies to every variant. IDs `AMB-*`.

## Problem

The audio processing settings (normalize volume, bass/mid/treble, stereo width, reverb) are among the most useful
features of the app, yet they sit under Settings. A listener cannot hear the effect while adjusting it, cannot compare
with and without, and cannot shape the whole tonal curve. This spec puts them where the music is, adds a graphic tone
curve, and adds one-tap ambiance presets.

## Decisions

| ID | Decision | Rationale |
| --- | --- | --- |
| D-A1 | A **Sound** card on the Play page, next to the Spectrum card, in every variant that has the Play page. | The effect is audible and visible (spectrum) in one place. |
| D-A2 | Two preset layers: **Ambiance** presets (the whole sound: curve, stereo width, reverb, levelling) and **Tone** presets (curve only). One tap applies; the card shows the active name, or "Custom" after a manual change. | Ambiance is the fast path, tone is the fine path. |
| D-A3 | The tone curve is a 10-band graphic equalizer (31, 62, 125, 250, 500 Hz, 1, 2, 4, 8, 16 kHz), plus or minus 12 dB, shown as one smooth curve with draggable points. | The existing three bands cannot express a curve; ten bands match what listeners know. |
| D-A4 | A visible **On/Off** switch on the card compares processed and original sound instantly, keeping all settings. | The listener must be able to judge the effect. |
| D-A5 | The processing stays in the native audio path (Kotlin DSP, already in front of the output). The 3-band equalizer becomes the 10-band one; stored bass/mid/treble values migrate. | One implementation, no web duplicate, no extra latency path. |
| D-A6 | The Settings page does not keep a second copy of the controls: its section shows the same shared component or links to the card. | No duplicated UX. |
| D-A7 | The card is shown only where processing can act (Android with the native pipeline, as the Spectrum card). When the C64 itself plays the sound, the card says so and is disabled. | No dead controls. |
| D-A8 | Up to five user presets can be saved, renamed and deleted; the built-in presets cannot be edited, only copied. | Safe defaults, personal taste. |

## Rows

### AMB-01 The Sound card

- Requirement: A fully collapsible card titled **Sound** on the Play page. **Collapsed it is one row of at most 56 px**:
  a small accent dot or icon, the label "Sound" and the active ambiance name at a glance (for example "Sound  Warm", or
  "Sound  Custom"; when processing is off, "Sound  Off"), the On/Off switch, and the open/close chevron. Nothing else is
  visible when collapsed: no chip row, no peek, no hints. Tapping the row or the chevron opens it; the card starts
  collapsed on first use and remembers its state. Expanded: the tone curve editor, Tone presets, a **Normalize volume** switch, and one **notched slider** each for **Stereo
  width** (notches Off, Subtle, Wide) and **Reverb** (notches Off, Room, Hall). There is no separate "Fine tune" fold and no segmented duplicate: the slider is the only control. The thumb moves continuously and snaps magnetically to a notch within a small distance; each notch is labeled under the track and tapping a label or tick jumps straight to it; the value is read out ("Subtle, 35"). Keypad: Left and Right jump to the previous or next notch, holding repeats in steps of 5. The expanded
  state persists. The card works by touch and by keypad (focus ring, scroll into view) and fits 320 px without
  horizontal scroll or text under 14 px.
- Verification: unit; Playwright on compact, medium and expanded profiles; keypad-only walk; handset and Pixel.

### AMB-02 Ambiance presets

- Requirement: Built-in ambiances, each a complete parameter set: **Original** (everything off, the default),
  **Late night** (normalize on, soft treble, light bass, no reverb), **Headphones** (subtle width, small room),
  **Phone speaker** (bass and treble lift tuned for a small speaker, normalize on), **Warm** (low-mid and bass lift,
  treble roll-off), **Bright arcade** (presence and treble lift, narrow stereo), **Hall** (wide, hall reverb) and
  **Studio** (flat curve, subtle width). Names are final copy to be reviewed. Switching is click-free (parameter ramps)
  and takes effect within 100 ms. Two quick controls: swipe or Next/Previous arrows over the chip row, and a "Back to
  previous sound" action that toggles between the last two ambiances.
- Verification: unit (each preset's parameters), DSP tests, Playwright; a mic-graded check on the Pixel.

### AMB-03 The tone curve editor

- Requirement: A graph of the whole curve (frequency on a log axis, gain in dB) with ten draggable points and one smooth
  line through the centre of every point (a monotone cubic, so it cannot overshoot between points). Each point sits at
  the value the true magnitude response of the ten filters reaches at its band (`toneResponse.ts`). The graph has a dB
  scale, the Spectrum card's colors, and a numeric readout of the selected band and the gain that was set
  ("1 kHz, +3 dB", within plus or minus 12 dB). A tap selects a band and changes nothing; only dragging
  changes the gain; band frequencies are fixed. A double tap resets the tapped band; "Reset" returns the whole
  curve to flat. A key hint shows only while keys are in use. Keypad: left and right move
  the selected band, up and down change gain by 1 dB, long press by 3 dB, with the selected band and value announced
  and visible. Tone presets: Flat, Bass boost, Treble boost, Vocal presence, Loudness, Warm, Bright. The editor must be
  usable at 320 px (a minimum 160 px plot height, 44 px point hit areas).
- Verification: unit (curve math, interpolation, clamp), component tests, Playwright pointer and keypad paths, screenshot.

### AMB-04 The native equalizer

- Requirement: Replace the 3-band equalizer in `dsp/AudioFx.kt` with ten peaking biquad bands (Q 1.4 so adjacent
  bands overlap smoothly; the web response and the Kotlin filter are checked against one shared fixture within 0.1 dB, and the
  settings store the points the user placed while the bridge sends gains solved so the response passes through them), coefficients recomputed on parameter change and ramped over about 20 ms to avoid clicks.
  Idle bands cost nothing. The JS bridge carries ten gains. A legacy bridge call with bass/mid/treble remains accepted and
  mapped (bass to 62/125 Hz, mid to 500/1000/2000 Hz, treble to 4/8/16 kHz) until the next release. CPU budget: the
  complete chain costs at most 3% of one core on the Pixel 4 and is measured on the handset too.
- Verification: JVM tests (frequency response of each band against the formula within 0.5 dB, no discontinuity when a
  gain changes mid-stream, idle detection), a recorded CPU measurement.

### AMB-05 State, persistence and migration

- Requirement: One settings record `audio_processing` (version 2) holds the ten gains, levelling, width, reverb, the
  active preset id and the user presets. Existing keys (`c64u_audio_*`) are read once and migrated. The record is part
  of the settings export and import. A change from any control updates all views (card, Settings section, native bridge)
  through the existing settings event.
- Verification: unit (migration, round trip, export, invalid data falls back to flat and logs once at warn).

### AMB-06 Where it applies

- Requirement: The Sound card affects sound played on this device: local tunes, the SID Radio, and the Live View audio
  mirror. When the C64 or a connected Ultimate produces the sound, the card shows a one-line explanation and its
  controls are disabled; nothing is hidden. The Spectrum card and the Sound card share the same visibility rule.
- Verification: unit; Playwright with a simulated device.

### AMB-07 Variants and modes

- Requirement: Present in the Full App, the compact keypad edition, and the SIDflow edition (and in SID Player mode)
  through the existing feature registry; no variant-specific copy of the card. Sentence-case text, American English.
  `docs/cta-inventory.md` lists every new control.
- Verification: unit per variant flags; Playwright smoke per variant; lint:reference-docs.

### AMB-08 Quality gates for this feature

- Requirement: Each row has regression tests that fail without the change (revert-checked). Audio evidence: a
  band-limited, microphone-graded sweep on the Pixel 4 at volume 5 of 25 shows the measured tilt follows the curve
  within 3 dB for three presets; on the handset, a muted run shows CPU within budget and no glitch counters.
  The manual gets a new short chapter (sentence case, short paragraphs, screenshots) and the existing audio-processing
  paragraphs are replaced, not duplicated.
- Verification: unit, JVM, Playwright, HIL.
