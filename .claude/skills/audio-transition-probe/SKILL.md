---
name: audio-transition-probe
description: >-
  Grade the join between one tune and the next — seamless, gapped, hard cut or ragged — from a
  microphone in front of the device, using two generated tunes that hold steady tones. Use for any
  claim about crossfade, a pause between tunes, or whether a track change is smooth; a moving piece
  of music cannot settle those and neither can listening once. Complements audio-quality-probe,
  which grades a single tune's own quality rather than the transition between two.
---

# Measure what comes out of the speaker

Claims about audio are settled by measurement or not at all. This is the rig for doing that, and
the traps that have produced confident wrong answers with it.

## Why a microphone, and why steady tones

Real music cannot settle a transition question. Both tunes are moving, so an overlap and a hard cut
look alike in a spectrum and sound alike to a tired ear after the twentieth listen.

Two tunes holding **steady, well-separated tones** turn it into arithmetic. At every instant either
both tones are present (a crossfade), exactly one is (a hard cut), or neither is (a gap). Generate
them with the SID generator in this repository — the tunes themselves are not checked in because
they take an instant to rebuild:

```bash
node scripts/generate-test-sid.mjs --hz 550  --name "XF Low"  --out /tmp/xf-low.sid
node scripts/generate-test-sid.mjs --hz 1850 --name "XF High" --out /tmp/xf-high.sid
```

**Choose pitches your speaker actually reproduces, and never an octave apart.** A phone speaker
barely produces 130 Hz, so a low note reads as silence. An octave shares harmonics, so one tone can
be mistaken for the other. 550 Hz and 1850 Hz work; they were chosen after C3/C4 and C5/C6 both
failed for these two reasons.

## Recording

Find the microphone once and keep the identifier in your own environment, not in a committed file:

```bash
arecord -l                       # list capture devices; note the card and device numbers
MIC=plughw:<card>,<device>
arecord -D "$MIC" -f S16_LE -r 44100 -c 1 -d 8 /tmp/xf.wav
```

Put the phone a hand's width from the microphone, in a quiet room, and do not move either between
runs — the two tones do not reach the microphone equally and the comparison is per-tone anyway, but
a moved phone changes both.

## Grading

```bash
python3 tools/hil/crossfade_probe.py /tmp/xf.wav              # one verdict line
python3 tools/hil/crossfade_probe.py /tmp/*.wav --json        # for a matrix
python3 tools/hil/crossfade_probe.py /tmp/xf.wav --verbose    # every analysis window
```

Verdicts: `SEAMLESS CROSSFADE` is the only pass. `GAP` means the listener hears silence between the
tunes. `HARD CUT` means no instant had both. `RAGGED` means they overlap but do not cleanly trade
places. `INCONCLUSIVE` means a tone never rose above the noise — fix that before reading anything
else into the run.

The probe exits non-zero unless every recording passes, so it can gate a loop.

## Running the app hands-free

Attach over CDP (see the `hil-attach` skill) and drive it from there. Both the crossfade length and
the SID engine are read fresh for **every tune**, so they can be changed between runs without
restarting the app:

```bash
./campaign/js.sh '(()=>{localStorage.setItem("c64u_playback_crossfade_ms","1500");
                        localStorage.setItem("c64u_sid_emulation_engine","residfp");return "set";})()'
```

`c64u_sid_emulation_engine` is `residfp` or `sidlite`. **Measure both.** They are different
renderers and a transition proved on one is not proved on the other.

Then: put the two tones next to each other in a playlist and nothing else, start the first, wait for
it to reach a steady state, begin recording, and press Next a second or two in.

## Traps that have produced wrong answers here

**A playlist with anything else in it.** Next goes to whatever is actually next. A run that
"transitioned into an unrelated tune" was a playlist still holding thirty other tracks.

**Reading a verdict off the noise floor.** A threshold set as a fraction of the loudest thing in the
recording will happily grade a silent recording. The probe refuses to give a verdict when neither
tone stands clear of the noise; do not work around that.

**Measuring with the device muted.** Check the volume from the host before every session
(`adb shell cmd media_session volume --stream 3 --get`) — `adb shell media volume` does not exist on
all builds and fails silently, so a "quiet" result can simply be a command that did nothing.

**Spectral leakage read as a defect.** A window holding a non-integer number of cycles makes the
level alternate high-low between successive windows — about 8% at these pitches, which is more than
one step of a slow fade. That made a perfectly smooth ramp read as `RAGGED`. The probe tapers each
window to prevent it; if you write your own analysis, do the same.

**Demanding perfection from a room.** One window in twenty can wobble against the trend on a
transition that is genuinely smooth. Judge the trend as well as the steps.

**A probe that does the work itself.** An early attempt mixed the two tones in the analysis script
and reported a beautiful crossfade — of its own arithmetic. Whatever you measure must have come out
of the speaker.

**A cold start in the first measurement.** The renderer is slow on its first tune after launch. Play
one transition and discard it before measuring.

## When a measurement disagrees with the code

Believe the measurement, then instrument. `globalThis.__localSidTrace()` returns a timestamped trace
of the last few track changes — when the outgoing tune was told to stop, how much audio it had to
hand over, when the next tune's bytes arrived, whether its opening was already rendered, and when
its first sample reached the track. `globalThis.__localEngineDebug()` returns the engine's counters.
Between them they have located every transition defect found so far.

## Do not commit anything that identifies the rig

Microphone identifiers, device serials, host names, IP addresses and absolute home directories stay
out of the repository. Keep them in your shell environment or an ignored scratch directory. Scripts
that live here take the device as an argument or read it from the environment, and default to
nothing.
