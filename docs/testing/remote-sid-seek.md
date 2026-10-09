# Remote SID seek

Fast forward, rewind and progress-bar jumps for a SID tune that the C64 plays itself. The app uses
the Ultimate SID player's own fast forward and raises the CPU speed to make it faster. This page
records how the feature works on the device, the numbers it is built on, and how to measure them
again.

## How it works

The Ultimate SID player fast forwards while the left-arrow key is held. Its interrupt handler then
calls the tune's play routine back to back instead of once per frame. The CPU limits that loop, so
on a machine with a `CPU Speed` setting a higher speed makes it faster. The app holds the key
through `POST /v1/machine:input` and changes `U64 Specific Settings / CPU Speed` with
single-item `PUT` requests.

The player draws an `mm:ss` clock at the start of screen row 23. The app reads it with
`GET /v1/machine:readmem` to know where the tune is. The screen moves from tune to tune
(`$0400`, `$0800` and `$8C00` were all seen), so the app finds it from `$DD00` and `$D018`.

The gestures are the ones the on-device engine already uses, so the page shows no new control:

- **Hold Next.** The key is held at the machine's own CPU speed. Each further second held raises
  the speed one step: 2, 4, 8, 16 and 32 MHz, then the machine's maximum (64 MHz on a C64
  Ultimate, 48 MHz on an Ultimate 64).
- **Hold Previous.** While Previous is held, the target moves back 10, 20, 40 and then 80 seconds
  per second held. On release, the app restarts the sub tune with the player's own `-` and `+` keys
  and fast forwards to the target.
- **Progress bar.** A tap or drag jumps when the finger comes to rest. A jump forward fast
  forwards from the current position. A jump backward restarts the tune first.

A jump measures the tune's fast forward rate at the machine's own speed, then uses the maximum
speed, 4 MHz and the machine's own speed in that order. It leaves each speed while it can still
stop in time. The key is released before every `CPU Speed` change. A config write can wait up to
1.2 s behind the device-safety interval, and with the key up the tune plays at normal speed
instead of passing the target. Within the last read period the key is released on a timer.

### Device state is always given back

A seek changes two things that do not undo themselves. The firmware keeps a key held through REST
until it is released. It keeps a `CPU Speed` until that setting is written again or the machine is
power cycled. The app protects both as follows:

- Before the first change, the original `CPU Speed` (and `Turbo Control`, when the seek has to
  switch it from `Off` to `Manual`) is written to a journal in `localStorage` under the device's
  identity.
- Every end of a seek releases the key, writes the original values back and reads them back. This
  includes release, the end of the tune, stop, pause, another tune, the page hiding and a
  120-second hold limit. Failed attempts are retried four times, and the journal is cleared only
  after a successful read-back.
- A journal that is left behind is replayed the next time the app reaches that device. This covers
  a killed app, a lost connection or a phone that went to sleep. A different device is never
  written to.
- Every write is marked transient, so **Keep device settings after a restart** never saves a
  seek's CPU speed to flash.

### What it does not support

- **RSID tunes**, and PSID tunes with play address `$0000`, install their own interrupt. The
  player cannot speed them up, so Previous and Next stay track controls.
- **The Ultimate-II+(L)** rejects `machine:input` with HTTP 501.
- **Rewinding and backward jumps** need `CPU Speed`. Without it, only Next fast forwards.

## Measurements

The measurements were taken on a C64 Ultimate running firmware 1.2.1RC2 on 2026-10-09, with
`tools/hil/remote_sid_seek_poc.py`. The full output is in `artifacts/remote-sid-seek-poc.json`
when the tool is run with `--json`.

### Fast forward rate by CPU speed

The figures are tune seconds per wall second, measured over 1.5 s at each speed:

| Tune | 1 MHz | 2 MHz | 4 MHz | 8 MHz | 16 MHz | 32 MHz | 64 MHz |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C_mon | 10.0 | 11.6 | 39.3 | 71.8 | 125.2 | 206.0 | 294.3 |
| Commando | 15.7 | 17.3 | 55.8 | 106.6 | 188.2 | 306.0 | 427.1 |
| Cybernoid | 8.4 | 11.2 | 37.8 | 69.5 | 130.4 | 208.7 | 297.3 |
| Last Ninja | 11.1 | 8.4 | 33.4 | 63.5 | 100.8 | 176.2 | 235.6 |
| Wizball (song 4) | 20.1 | 18.7 | 65.6 | 129.3 | 214.8 | 384.8 | 572.4 |
| Tone test tune | 64.7 | 67.4 | 254.5 | 498.2 | 964.7 | 1835.2 | 3055.5 |

The rate depends on how much work the tune's play routine does, so it cannot be tabulated. The
light tone tune ran six times faster than real music. The ratios hold better: 64 MHz was 21 to 47
times the 1 MHz rate across these tunes, and 56 times for the generated play-call counter tune. A
jump therefore measures the rate at the machine's own speed and bounds every faster speed by the
CPU clock ratio.

The 2 MHz step adds little over 1 MHz, and for Last Ninja and Wizball it was slower. It stays in
the ramp because it is the requested first step and costs nothing measurable. From 4 MHz on, each
step roughly doubles the rate.

### The clock while fast forwarding

At normal speed the clock counts frames and matches the tune exactly. While fast forwarding it
counts play calls as frames. For any tune not called once per frame, the clock therefore runs
ahead of the music. The figures below compare the clock with a play-call counter in a generated
PSID:

| Tune | Clock while fast forwarding | Music | Clock per tune second |
| --- | --- | --- | --- |
| PAL, once per frame | 14.3x | 14.3x | 1.0 |
| NTSC on a PAL machine | 14.3x | 11.9x | 1.2 |
| PAL, CIA timer at 2x | 14.3x | 7.1x | 2.0 |
| PAL, CIA timer at 4x | 14.2x | 3.6x | 4.0 |

The app takes the play-call rate from the header for a tune timed by the vertical blank: 50 Hz for
PAL, 60 Hz for NTSC, and the machine's frame rate when the header names both or neither. For a
CIA-timed sub tune, the app samples CIA 1 timer A 40 times and snaps the result to a multiple of
50 or 60 Hz. The largest sample approximates the latch.

### Jump accuracy

Jumps measured against the play-call counter used a 500 ms delay before each `CPU Speed` write.
This is the app's config write interval in the Balanced device-safety mode:

| Tune | Error after landing | Time per jump |
| --- | --- | --- |
| PAL, once per frame | -0.04 to +0.90 s | 2.6 to 5.1 s |
| NTSC on a PAL machine | +0.15 to +0.77 s | 2.7 to 3.9 s |
| PAL, CIA timer at 4x | +1.1 to +1.7 s | 4.2 to 6.6 s |

For real tunes, the clock after landing showed the target second in every jump, or one second
less. Restarting a sub tune took 0.26 to 0.28 s.

### Other findings

- `CPU Speed` writes took 11 to 29 ms. `readmem` answered in 10 to 32 ms right after every write,
  including `Turbo Control` `Off` → `Manual` → `Off`, repeated three times. On this firmware
  nothing like the network drop recorded as BUG-010 was seen.
- The first `CPU Speed` change after a tune starts can take up to about a second to apply. Later
  changes apply at once. A rate measured during that second is far too low, so a measurement never
  lowers a speed's bound.
- A REST-held key is released by `machine:reset` and by starting another tune.
- Two `tap` events in one `machine:input` batch lost the second key. The restart uses separate
  press and release requests, 60 ms apart.
- The clock wraps after 99:59.

### In the app on a Pixel 4

The following was checked with the APK built from this branch against the same C64 Ultimate:

- Holding Next on Galaforce 2 went from 0:09 to 1:27 in a 3.5 s hold. The app's elapsed time then
  stayed within 1 to 2 s of the device clock.
- Holding Previous for 2.2 s moved the target back 30 s. The jump from 1:34 to 1:04 took 3.7 s
  including the restart.
- A tap at 75 % of the progress bar jumped from 1:16 to 2:31 in 3.8 s.
- After each gesture the device reported `CPU Speed` ` 1` and no held key.
- The app was force-stopped while it held the key, and in a second test with CPU speed raised. On
  the next launch the app released the key and restored `CPU Speed` within about 4 s.

## Running the measurement

```bash
python3 tools/hil/remote_sid_seek_poc.py --host c64u --tune path/to/tune.sid --json out.json
python3 tools/hil/remote_sid_seek_poc.py --host c64u --only seek --write-interval-ms 500
python3 tools/hil/remote_sid_seek_poc.py --host c64u --turbo-off-check
```

The tool uses only REST and does not need the app. Each run ends by releasing the keys, restoring
`Turbo Control` and `CPU Speed`, reading them back and resetting the C64. The exit code is 1 if a
stage failed or the restore did not match. The generated counter tune is silent. Tunes passed with
`--tune` play aloud on the C64.
