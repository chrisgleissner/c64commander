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

The player draws its running clock (`mm:ss` at the start of screen row 23 today) and the app reads
it with `GET /v1/machine:readmem` to know where the tune is. Nothing about where or how the clock is
drawn is assumed. After a tune starts, the app reads the screen the VIC shows (found from `$DD00`
and `$D018`; `$0400`, `$0800` and `$8C00` were all seen) twice, 1.2 s apart, and takes the time
field that moved forward as the clock. A paused tune's clock stands still, so a tune paused before
or during this check is checked again when it resumes. The song length the player also draws stays put and a
countdown would run backwards, so neither is taken. `m:ss`, `mm:ss` and `h:mm:ss` are all read,
and the clock is read back as the time field on its row that overlaps its cells, so a clock that
grows from `9:59` to `10:00` keeps being read. A screen under `$D000`-`$DFFF` is never read,
because `readmem` follows the CPU banking and would read the CIAs there.

The player writes its digits ones first, so a read can catch it mid-update with the minutes a
minute behind (`01:59`, `01:00`, `02:00`). A read that steps back is read again, and only a second
read that agrees is taken as the clock rolling over at 99:59.

The gestures are the ones the on-device engine already uses, so the page shows no new control:

- **Hold Next.** The key is held at the machine's own CPU speed. Each further second held raises
  the speed one step: 4, 8, 16 and 32 MHz, then always the machine's maximum (64 MHz on a C64
  Ultimate, 48 MHz on an Ultimate 64). 2 MHz is skipped because it fast forwards no faster than
  1 MHz; see the rate tables below.
- **Hold Previous.** While Previous is held, the target moves back 10, 20, 40 and then 80 seconds
  per second held. On release, the app restarts the sub tune with the player's own `-` and `+` keys
  and fast forwards to the target.
- **Progress bar.** A tap or drag jumps when the finger comes to rest. A jump forward fast
  forwards from the current position. A jump backward restarts the tune first, unless the clock
  still shows 0:00: the tune is then already at the start, and a restart could not be seen.

A jump measures the tune's fast forward rate at the machine's own speed, then uses the maximum
speed, 4 MHz and the slowest speed in that order. When the machine's own speed could pass the target
before its first read, the rate is measured at the slowest speed instead; before that change, a
machine already at 64 MHz approached every jump under about 45 minutes in key pulses at 1 MHz, and a
600 s jump took 77 s instead of 5 s. It leaves each speed while it can still stop in
time. The key is released before every `CPU Speed` change. A config write can wait up to 1.2 s
behind the device-safety interval, and with the key up the tune plays at normal speed instead of
passing the target. Within the last read period the key is released on a timer.

Until the rate is measured, one read period of fast forward can pass a near target by several
seconds: a light tune covers about 4 clock seconds per 60 ms read at 1 MHz. A target within 4 s is
therefore played into at normal speed. A target that one read period could pass at the fastest
rate the player can reach (200 clock seconds a second per MHz) is approached at the slowest speed
in timed key pulses. Each pulse aims at 80% of what is left, at the rate the previous pulse showed.
A pulse carries a fixed overhead of request latency and the keyboard scan that notices the release,
so a remainder smaller than the smallest gain a pulse has shown is played into.

A jump has no fixed time limit. It stops when the tune has not moved for 10 s, when the key has
been held for 5 s without moving the player's clock 1.5 seconds a second (key pulses count as held
from press to release), or after 10 minutes. A
jump an hour into a tune on a machine without CPU Speed can take minutes and still lands.

### On the Ultimate-II+(L)

The cartridge answers `machine:input` with 501 and has no `CPU Speed`, but its SID player is the
same. The player fast forwards while a flag in its interrupt handler is set. Its keyboard routine
clears that flag on every frame without a key, by ending in `ldy #0 / jmp store`, where `store` is
`sty flag / rts`. Without key input, the app finds that routine in memory by its code: the keyboard
row scan (`sty $dc00 / lda $dc01 / cmp #$ff / bne`), the `ldy #0 / jmp` after it, a store of Y into
an `lda #flag / beq` that is followed by the handler's `inc $d020`. It uses the routine only when
exactly one such chain links up, and records the routine's bytes as it found them. Holding fast
forward writes 1 into that `ldy #0`, and releasing writes 0 back; each write first checks that every
recorded byte is still as found, apart from that operand reading 0 or 1. Memory is read in 2 KB
pieces, never under `$D000`-`$DFFF`.

The player must never be left damaged. After each seek on the cartridge, once the seek is given
back, the app checks that the routine's bytes are still as found and that the clock moves one to
three seconds over 1.2 s, as at normal speed. A check whose reads took over a second says nothing,
and a slow clock with intact code is checked once more. When the player is not working, the app
writes the recorded bytes back, and if that does not bring the clock back to normal speed, starts
the tune again with `runners:sidplay`, which loads the player afresh. A check is skipped after
Pause, Stop, another tune or a device switch, which change what the machine does on purpose.
Once the player had to be put back, seeking is turned off for that device and firmware version:
Previous and Next skip tracks, and a one-time notice says that fast forward and rewind were tried
with that firmware's SID player, which does not support them. A firmware update is tried afresh. A rewind starts the same bytes and sub tune
afresh with `runners:sidplay`, since there are no minus and plus keys to send. Fast forward runs at
the machine's own speed.

On the bench the U2+L sits in the c64u's expansion port. It starts the player only while the
c64u's `C64 and Cartridge Settings / Cartridge Preference` is `External`; in `Auto` the c64u hands
the bus to an external cartridge only if one is present when it configures the bus.

### Sound while seeking

The first key press of a seek turns the Audio Mixer's `Vol Master` off when Settings → Play and
Disk → **Mute C64 seeking** asks for it: **Rewind only** (the default) for a rewind or a jump back,
**Always** also for a held fast forward and a jump forward, **Never** for none. Measured on the C64
Ultimate, `Vol Master` `OFF` silences the audio stream the phone mirrors (from -23.9 dBFS to
digital silence) within 18 ms of the `PUT`. The original value is journaled with the rest and put
back right after the key is released, before the slower `CPU Speed` writes. A machine without
`Vol Master`, such as the Ultimate-II+(L), is left as it is. Playing on the phone, a seek is silent
whatever the setting: a rewind flushes the queued audio and waits for the new position.

### Device state is always given back

A seek changes things that do not undo themselves. The firmware keeps a key held through REST
until it is released, and keeps a `CPU Speed` and a `Vol Master` until they are written again or
the machine is power cycled; on the cartridge, the patched byte stays until it is written back or
another tune starts. The app protects all of them as follows:

- Before the first change, the original `CPU Speed` (and `Turbo Control`, when the seek has to
  switch it from `Off` to `Manual`), `Vol Master` and the patched address are written to a journal
  in `localStorage` under the device's identity. When the journal cannot be stored, for example
  with storage full, the seek stops before it changes anything.
- Every end of a seek releases the key or the patch, writes the original values back and reads
  them back. This includes release, the end of the tune, stop, pause, another tune, the page
  hiding, a switch to another device and a 120-second hold limit. A device switch waits up to 5 s
  for the restore before it resets the old machine. A restore is tried up to four times, and the
  journal is cleared only after a successful read-back.
- A restore that fails while the app stays connected is tried again after 30 s, 1, 2 and 5 minutes.
- A journal that is left behind is replayed the next time the app reaches that device. This covers
  a killed app, a lost connection or a phone that went to sleep. A different device is never
  written to. A journal older than 24 hours is dropped instead: settings written over REST do not
  survive a power cycle, and replaying it could overwrite settings chosen since.
- Every write is marked transient, so **Keep device settings after a restart** never saves a
  seek's CPU speed or volume to flash. Only the last write of a restore lets a held flash save go,
  because after an earlier one the others still hold the seek's values.

### Keys only ever reach the SID player

Outside the SID player, the left-arrow, `-` and `+` keys type into whatever runs, BASIC included,
and a key held through REST repeats. Five independent checks stand between a seek and a key press:

1. Before every press, and before every write of the cartridge's patched byte, the seek reads
   `$DD00` and `$D018` and the clock's row. The VIC must still show the screen the clock was found
   on, and the row must still read as a time. One blank read is retried once; two in a row stop
   the seek. Pause, Stop, another tune and a device switch also drop a tap on the bar that is still
   settling, so no jump starts after them.
2. `withSeekKeyPermits` (`src/lib/playback/remoteSeek/seekKeyPermit.ts`) wraps the REST call that
   sends keys. A press of a seek key needs a permit for that key on that device, which only the
   check in (1) grants, and which expires after 500 ms. Releases always pass.
3. A held fast forward ends after two clock reads in a row that find no clock, when the VIC shows
   another screen (checked once a second, since the old screen stays in RAM and still reads as a
   clock), or when the clock has not moved for 10 reads and 5 s. A jump releases the key at the
   first read that finds no clock.
4. A restart is refused when the clock cannot be read just before the `-` and `+` keys.
5. On the cartridge, the whole routine is verified before every write, including the restore of a
   recovered journal: the `ldy`, its `jmp` to `sty flag / rts`, and the handler's `lda #flag / beq /
   inc $d020`. `ldy #1` alone is common code. A link into `$D000`-`$DFFF` is never followed, because
   reading `$DC0D` acknowledges a running program's interrupts.

### The phone shows the C64's own second

On the C64 route the elapsed time follows the player's clock. After the probe, after every landing,
when the page comes back into view, on resume and every 30 s, the app reads the clock back to back
until it turns, and places that turn between the two reads that saw it. The Play page's timer then
turns each second at that moment.

A render of the Play page takes about 60 ms on a Pixel 4. `useSecondAlignedTicks` renders each tick
synchronously, measures how long that takes, and starts the next tick that much before its second
turns. Measured with the parity scenario "shows the C64's own second", each second turned on the
phone this long after it turned on the C64:

| Machine | Playing | After fast forward | After a jump | After a rewind |
| --- | --- | --- | --- | --- |
| c64u | 45 to 89 ms | -16 to 27 ms | 9 to 42 ms | 8 to 55 ms |
| u64 | -24 to 0 ms | 7 to 43 ms | -25 to 18 ms | 59 to 127 ms |
| u2 | 77 to 108 ms | 58 to 117 ms | -8 to 65 ms | 62 to 127 ms |

Before the render was compensated, the phone was 95 to 200 ms behind on the c64u. The clock reads
themselves are not biased: reading through the WebView's HTTP plugin placed the turn within
-47 to +46 ms of the host's own reads.

A seek starts from the clock, not from the page: for a tune whose clock is its position, the
reading nearest to the page's figure. A page that fell behind, for example after the app was hidden
during a hold, therefore cannot make a seek count from the wrong place.

### Timing in every System Mode

The rate a tune is called at, and so how far a clock second of fast forward moves the tune, depends
on the machine's timing:

- Each System Mode runs its own CPU clock. The clocks follow the PLL constants in the firmware's
  `software/u64/color_timings.cc`: PAL 985248 Hz, NTSC 1022727 Hz, NTSC-50 985891 Hz,
  NTSC-50/L 986921 Hz, PAL-60 1023144 Hz and PAL-60/L 1023750 Hz.
- An Ultimate 64 (firmware 3.15) switches the machine to the tune's video standard while its SID
  player runs: a PAL tune in NTSC mode ran 312-line frames, an NTSC tune in PAL mode 263-line
  frames. The C64 Ultimate (firmware 1.2.1) keeps its System Mode. The probe therefore reads the
  raster line ($D011 bit 7 and $D012) up to 60 times at uneven intervals, and uses the standard it
  finds, with the mode's own clock when the standard matches the mode.
- A CIA-timed tune is called at the machine's CIA clock divided by its latch plus one. The latch is
  estimated from the highest of 100 timer samples and snapped to the latches tunes set: a PAL or
  NTSC frame, 50 or 60 Hz on the machine's own CIA clock, or the player's own latch for a tune of
  the other standard (16388 and 20514 cycles), each divided by 1 to 8. Without the 60 Hz latch, a
  PAL machine timed a tune's own 60 Hz timer at an NTSC frame's 57.6 Hz, 4% slow. Latches 0.3%
  apart, such as an NTSC frame over four and 60 Hz over four, cannot be told apart this way. The same PAL tune's twice-a-frame latch plays 104.06 times a second on an NTSC machine,
  not 100.
- The player's own clock counts 50 or 60 frames a second, corrected for the standard PAL or NTSC
  rate. In NTSC-50, PAL-60 and the /L modes the frames run slightly faster, so the displayed time
  itself gains up to 0.1% on real time. The app follows the displayed time.

### What it does not support

- **RSID tunes**, and PSID tunes with play address `$0000`, install their own interrupt. The
  player cannot speed them up, so Previous and Next stay track controls.
- **A player whose clock does not tick on the VIC's screen**, or a cartridge whose player has no
  keyboard routine of the shape above, gets plain track controls too. Two cases were found:
  - A player screen under the BASIC or KERNAL ROM. `readmem` follows the CPU's banking and returns
    the ROM there. The SID player put its screen at `$BC00` for Games Winter Edition (sub tune 47)
    and Super Mario Bros 64 2SID (sub tune 5).
  - A tune that moves the screen itself. Maritime Loader rewrites `$D018`, and the player's clock
    never shows.

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

The 2 MHz step adds nothing over 1 MHz: 0.76 to 1.33 times its rate, and slower for Last Ninja
and Wizball. The ramp therefore skips it and goes from the machine's own speed to 4 MHz. From
4 MHz on, each step roughly doubles the rate.

The same measurement on an Ultimate 64 Elite (firmware 3.15), with `tools/hil/remote_sid_seek_poc.py
--only rates`:

| Tune | 1 MHz | 2 MHz | 4 MHz | 8 MHz | 16 MHz | 32 MHz | 48 MHz |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Commando | 14.8 | 16.4 | 86.8 | 179.6 | 329.4 | 582.2 | 611.1 |
| Last Ninja | 10.6 | 9.0 | 54.2 | 114.2 | 210.2 | 373.5 | 391.3 |
| Wizball | 18.7 | 19.4 | 96.6 | 199.5 | 351.8 | 610.3 | 637.7 |

On that machine 48 MHz is only 1.04 to 1.05 times the 32 MHz rate, against 1.34 to 1.49 times for
64 MHz on a C64 Ultimate. The ramp still ends at the machine's maximum.

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
CIA-timed sub tune, the app samples CIA 1 timer A 100 times, in the background as soon as the tune
is probed, and snaps the result to a latch as described under Timing in every System Mode. The
largest sample approximates the latch. Forty samples all fell below 85% of a 2x tune's latch once on the Ultimate 64, which read it
as 120 Hz instead of 100 Hz and overshot a jump by 20%.

The clock counts 50.1245 play calls per clock second on a PAL machine, not 50: `clock.asm` delays a
frame every eighth second to track the PAL frame rate of 985248 / 19656 Hz. The player times an
NTSC tune on a PAL machine at 16388 cycles (60.12 Hz). References built on nominal 50 and 60 Hz
drift 0.25% from the clock, 15 s an hour into a tune.

### Jump accuracy

Jumps measured against the play-call counter used a 500 ms delay before each `CPU Speed` write.
This is the app's config write interval in the Balanced device-safety mode:

| Tune | Error after landing | Time per jump |
| --- | --- | --- |
| PAL, once per frame | +0.16 to +0.60 s | 2.6 to 5.1 s |
| NTSC on a PAL machine | +0.15 to +0.48 s | 2.7 to 4.8 s |
| PAL, CIA timer at 4x | +1.1 to +1.7 s | 4.2 to 6.6 s |

For real tunes, the clock after landing showed the target second in every jump, or one second
less. Restarting a sub tune took 0.26 to 0.28 s.

These errors were measured while every landing added half a second for the clock's rounding. That
half second belongs only to a position counted from a restart, which holds whole clock seconds. A
forward jump counts from the page's position, which already holds its fraction, so it now reports
its landing without it. A held fast forward keeps it.

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
- `POST machine:input`, `readmem` and config writes occasionally hang for 8 s on the C64 Ultimate
  and the Ultimate 64 while other requests answer in 10 ms. A seek survives a release that times
  out: it restores first and only then reads where the tune is, and it counts a held stretch that
  the fast forward rate seen just before cannot explain as normal play.

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

## Running the tests

The same suites run in CI against the mock server and on the bench against real machines.

| Suite | CI | Bench |
| --- | --- | --- |
| Unit tests (`tests/unit/playback/remoteSeek/`, `useRemoteSidSeek`) | `npm run test` | — |
| Playback parity, phone and C64 route (`playwright/parity/`) | `playwright/playbackParity.spec.ts` | `npx tsx tools/hil/playback_parity_hil.ts --hosts c64u,u2` (add `u64` when it is free) |
| Device soak (`tools/hil/remoteSidSeekSoak.hil.ts`) | `npm run test:remote-seek:mock` | `SOAK_HOST=c64u SOAK_MINUTES=30 npx vitest run --config tools/hil/vitest.hil.config.ts tools/hil/remoteSidSeekSoak.hil.ts` |
| Tune corpus (`tools/hil/remoteSidSeekCorpus.hil.ts`) | `npm run test:remote-seek:mock` | `SOAK_HOST=c64u SOAK_SYSTEM_MODE=NTSC npx vitest run --config tools/hil/vitest.hil.config.ts tools/hil/remoteSidSeekCorpus.hil.ts` |
| Playback chaos, both routes (`playwright/parity/chaosScenario.ts`) | `playwright/playbackChaos.spec.ts` | `npx tsx tools/hil/playback_parity_hil.ts --hosts c64u --chaos 20 --seed 4561` |

`SOAK_HOST` is a host name, or `mock` (an Ultimate 64-family machine) or `mock-u2` (a cartridge
without key input) for the mock server. The mock shows BASIC after a reset or another program, as a
real machine does, and records every seek key pressed while BASIC is on screen; the soak, the corpus
and the chaos run fail on any. A CI soak picks its seed from the time and prints it; `SOAK_SEED`
repeats a run. The soak and the corpus play generated tunes whose play
routine counts its calls at `$10F0`, or `$F0` into its own code when it loads elsewhere, or at
`$02F0` when it loads under a ROM. On a real machine the corpus measures each such tune's play rate
for 12 s and snaps it to an exact rate for the machine's timing, so every landing is checked against
where the tune really is. A tune whose clock is its position is checked against the clock instead,
which is what the page has to agree with. `SOAK_SYSTEM_MODE` runs the corpus in that System Mode
and puts the original back. `CORPUS_ONLY` runs only the tunes whose name contains it. On a real
machine the corpus also plays HVSC tunes picked for the extremes (from `../C64Music`, or
`CORPUS_HVSC`) at -42 dB. The parity run plays a steady 550 Hz tone at media volume 7 of 25 and
listens for it with the microphone at the phone's grille.

The chaos run plays a seeded random sequence of gestures for the given minutes: holds, jumps, a
second jump before the first lands, Pause or Stop during a hold or a jump, the app hidden or killed
during a hold or a jump, and switches between the routes. After every action, once the app is idle,
it checks that the machine has its settings back, no key is held, no seek journal is left, the
page shows where the tune is, the transport shows a state the action can lead to, and the app logged
no error. `CHAOS_MINUTES` sets the length in CI; `CHAOS_TRACE=1` logs every tap.

A HIL run that writes a machine's settings first records the original values in
`artifacts/hil-journal/<host>.json` and removes it once it has read every value back. After a run
that was killed, `npx tsx tools/hil/remoteSeekHil/machineJournal.ts <host>` releases the seek keys
and puts the recorded values back.

`tools/hil/remote_seek_rest_load.py --host c64u` measures REST latency under the request mix of a
seek: clock reads at 20 to 40 a second, fast forward key presses at 4 a second and `CPU Speed`
writes at 2 a second, alone and together. It presses keys only while it has seen the SID player's
clock within the last 300 ms. Measured in October 2026, with 60 s per phase on the Ultimate 64
and 120 s per phase on the C64 Ultimate, every request was answered, the slowest in 68 and 78 ms.

The proof of concept measures the device directly, without the app:

```bash
python3 tools/hil/remote_sid_seek_poc.py --host c64u --tune path/to/tune.sid --json out.json
python3 tools/hil/remote_sid_seek_poc.py --host c64u --only seek --write-interval-ms 500
python3 tools/hil/remote_sid_seek_poc.py --host c64u --turbo-off-check
```

It uses only REST. Each run ends by releasing the keys, restoring `Turbo Control` and `CPU Speed`,
reading them back and resetting the C64. The exit code is 1 if a stage failed or the restore did
not match. The generated counter tune is silent. Tunes passed with `--tune` play aloud on the C64.
