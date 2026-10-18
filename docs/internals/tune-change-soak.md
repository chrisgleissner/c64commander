# Tune change soak (issue #529)

`tools/hil/tone_change_soak_hil.mjs` plays an Ultimate-hosted playlist with the on-device engine and records what
happens at tune changes. With a microphone it records the speaker and `tools/hil/tone_gaps.py` finds every gap in the
300 to 6000 Hz band to the 20 ms frame. Without one (`--no-mic`) it samples `readAudioStats` every few seconds.
`--natural` leaves the changes to the playlist instead of pressing Next.

## Keypad phone, natural tune ends, 30 minutes

Eight Ultimate-hosted tunes of 21 s to 2 min 11 s, repeat on, local engine, app in the foreground.

| Quantity                                            | Value        |
| --------------------------------------------------- | ------------ |
| `readAudioStats` samples (every 5 s)                | 360          |
| Underruns                                           | 0            |
| Concealed time                                      | 0 ms         |
| Lowest buffered audio while a track was open        | 1830 ms      |
| "Next tune prefetched" log entries in the window    | 14, of at least 16 tune changes; the 500-entry log ring may have dropped older entries, and a tune whose bytes the phone already held is not prefetched |

The phone has no microphone at its speaker, so this is pipeline evidence, not a recording.

## Keypad phone, Next every 25 s, 25 minutes

The same playlist with Next pressed every 25 s (60 changes): 0 underruns, 0 ms concealed, lowest buffered audio 10.9 s.
The Pixel dropouts below did not reproduce on the keypad phone with short tunes.

## Pixel 4 with microphone, Next every 25 s on two 20 minute tones, 30 minutes

The first 15 minutes (36 changes) had no gap of 60 ms or more. From 925 s on, the recording shows silences of 6 to 44 s
away from any change, and `readAudioStats` read 45 underruns with 2 ms buffered at 930 s, an empty ring at 980 s, and a
refilled ring of 12 s at 955 s and 1005 s. The Java heap was 110 MB of 256 MB afterwards and the screen stayed on. The
cause was not found: the log ring had already dropped the entries of that period. A second 22 minute run had a noisier
room (levels rose by 15 dB at its end), so its recording cannot be graded. The drive was Next, not a natural tune end, and
the tunes were 20 minutes long, which no real tune is, so this is a measurement of a stress pattern. Issue #534 tracks it.
