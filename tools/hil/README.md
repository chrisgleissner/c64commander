# Hardware-in-the-loop (HIL) harnesses

`tools/hil/` holds the device-driving HIL harnesses. Each drives the **shipped app** on a
physically-connected Pixel over the WebView CDP socket, clicking real `data-testid` elements and
reading on-screen stat blobs — no raw ADB product input. They are **manual/local** (they need the
physical rig), while the host-deterministic budget checks run in CI.

- **`sid_radio_hil.py`** — SID Radio (§9): starts a station, soaks auto-advances, asserts the
  pinned §9.2 budgets (`ci/perf/sid-radio-perf-thresholds.json`). See **SID Radio** below.
- **`av_sync_hil.py`** — Live View A/V sync + input latency. See **A/V sync** below.
- **`seek_latency_hil.py`** — what a backward seek costs the listener, measured at the speaker.
  See **Seek latency** below.
- **`joystick_rotation_hil.mjs`** — physical keys → joystick, asserted on the C64's own screen at
  three handset orientations. See **Physical keys and rotation** below. This one is the exception to
  "no raw ADB product input": the thing under test IS Android's key pipeline, so the keys have to
  enter the app the way a handset's keypad enters it.
- **`hvsc_search_soak.mjs`** — "Find a tune" latency over many consecutive queries. See **HVSC
  search** below.
- **`demo_mode_hil.ts`** — Demo Mode end to end with no Ultimate involved at all. See **Demo Mode**
  below.

## THE trap: a hidden WebView

**Read this before diagnosing any hang.** Chromium suspends timers in a hidden page, and Capacitor
delivers plugin results by evaluating JavaScript in the WebView — so a phone that has locked itself
produces, all at once:

- debounces that never fire, so a search box sits on "Searching…" for ever;
- `Filesystem.readFile` promises that never settle, which reads exactly like a bridge that cannot
  carry a large file;
- an in-app log that never reaches storage, so the diagnostics say the code never ran.

`Runtime.evaluate` keeps working throughout, so the page looks responsive and every symptom points
at the app. This cost the best part of a day and produced a confidently wrong root cause: a
`Filesystem.readFile` measured as "never returns" was, with the page visible, 1,084 ms.

```bash
adb shell wm dismiss-keyguard     # the one that matters
adb shell svc power stayon usb    # keeps the screen lit — does NOT dismiss the keyguard
adb shell dumpsys window | grep -m1 isKeyguardShowing
node scripts/bughunt-cdp.mjs eval '(()=>JSON.stringify({hidden:document.hidden}))()'
```

`hvsc_search_soak.mjs` refuses to report a hang without checking `document.hidden` first, and any
new harness should do the same.

## HVSC search

`hvsc_search_soak.mjs` measures what the listener waits for: the time from a query landing in the
box to rows being on screen, over many consecutive queries with a spread of result counts.

```bash
node tools/hil/hvsc_search_soak.mjs --iterations 100
```

Timed from the host on purpose — a page-side stopwatch stops ticking during exactly the stalls worth
measuring, so it cannot include the fault. The CDP round trip is counted against the budget rather
than excused from it.

### Measured on the Pixel 4, 2026-08-04 — 100/100 against a real HVSC (61,157 songs, 13.2 MB index)

From a cold app launch: **first query 497 ms**, then n=99 warm min 304 / p50 388 / p95 466 /
max 495 ms. Budgets: 3,000 ms for the first query, 1,000 ms for every one after it.

## Physical keys and rotation

`joystick_rotation_hil.mjs` answers a question no unit test can: did the key the player pressed
reach the machine as the direction they expected, after the handset was turned?

`joystickKeyBindings.test.ts` proves the app computes the right joystick line for a key at a
rotation. Everything past that pure function — the held-set merge, the relay's coalescing,
`machine:input`, and the CIA — is out of its reach, and each of those has broken this feature
before. So the assertion is made where the player would make it: on the screen.

The C64 runs `tools/c64/joystick-probe.asm`, written for this and nothing else. A filled PETSCII
circle moves one cell per joystick press; fire advances its colour and sounds a short blip on SID
voice 1. State is published in plain RAM at `$C000` (position, colour, per-direction event counts,
fire count, a magic marker, a frame counter, the repeat counters and the repeat cadence), so a run
reads it over `GET /v1/machine:readmem` without parsing the display — and then checks the display
anyway, because that is what the player sees and the two must agree.

**A held direction repeats.** One cell lands on the press; if the direction is still held
`REPEAT_DELAY_F` frames later the next lands, and one more every `REPEAT_RATE_F` frames after that.
Both constants are published in the telemetry block, so a harness computes the cells a hold earned
from `HOLD_FRAMES` rather than from its own copy of the cadence or from the duration it asked for —
neither of which survives a busy phone. Fire is still one event per press.

`tests/unit/tools/joystickProbe.test.ts` runs this same committed binary in a 6502 interpreter, so
the machine end is covered in CI. What needs hardware is everything between a finger and `$DC00`.

```bash
# The probe is committed pre-assembled; rebuild it with 64tass after editing the source:
64tass --cbm-prg -o tools/c64/joystick-probe.prg tools/c64/joystick-probe.asm

# App foregrounded on the phone, CDP forwarded (see the hil-attach skill):
node tools/hil/joystick_rotation_hil.mjs --layouts diamond8,classicT9 --rotations 0,90,270

# Holding, rather than pressing: a real drag on the on-screen stick that stays down,
# plus the two ways Game Mode is allowed to maximise the picture.
node tools/hil/joystick_hold_hil.mjs --hold-ms 2000
```

Both shipped defaults are run, because they are different products' defaults and a change to one
is not a change to the other: `c64u-remote` ships **Diamond (8-centred)** — the four keys around
`8`, with `8` as fire — and `c64commander` ships **Classic T9**. The layout is chosen through
Settings → Play and Disk → Joystick keys each time, not by writing storage, because the claim
under test is that the assignment is configurable and the section is collapsed by default.

The diamond is also the layout that puts a direction on `0`, which is the app's global Game Mode
shortcut. That shortcut is supposed to go inert inside an open overlay so the key can steer
instead — a rule that means nothing until something checks it against the machine.

**The screen is the trap to watch** — see **THE trap: a hidden WebView** above.

## Follow-focus (Live View "lock on")

`follow-lock-demo.asm` is a fake game written to be watched rather than played. Eight hardware
sprites move over a dotted backdrop; sprite 0 is "the player", and the programme it runs is the
list of things that break object trackers, one every three seconds:

| Phase   | 150 frames each                                                             | What it is for          |
| ------- | --------------------------------------------------------------------------- | ----------------------- |
| 1 IDLE  | drifts one pixel a frame, steady colour                                     | lock on here            |
| 2 WALK  | two pixels a frame, vertical wander                                         | ordinary play           |
| 3 FLASH | colour changes every four frames, then keeps a new one                      | damage, then a power-up |
| 4 FAST  | eight pixels a frame, off one side and back on the other                    | screen wrap             |
| 5 CROSS | the player and sprite 1 — same shape, same colour — pass through each other | identity swap           |
| 6 HIDE  | the player is switched off for 40 frames while it keeps moving              | occlusion               |

Sprite 1 is a deliberate look-alike: the player's own shape in the player's own colour. **If the
view comes out of phase 5 following sprite 1, that is the defect the phase exists to find.**

Joystick port 2: **fire** freezes all motion, so the picture can be pressed and held calmly;
**up** skips to the next phase. State is published in plain RAM at `$C000` (magic, frame and
phase counters, the player's X/Y/colour/animation/visibility, and counts of crossings, recolours
and wraps), so a run reads it over `GET /v1/machine:readmem` instead of parsing the display.

`tests/unit/tools/followLockDemo.test.ts` runs the same committed binary in a 6502 interpreter,
so the machine end is covered in CI. What needs hardware is the picture.

```bash
# Committed pre-assembled; rebuild it with 64tass after editing the source:
64tass --cbm-prg -o tools/c64/follow-lock-demo.prg tools/c64/follow-lock-demo.asm

# Then, on the phone: Live View → Game Mode, zoom to about 3x, turn Follow on,
# and press and hold the player sprite during phase 1.
```

Rotation is set through the sheet's manual override rather than by turning the phone, because a
test rig cannot turn a phone. The override is not a test seam — it is the shipped control for a
player lying down or a handset whose sensor cannot answer — and it sets the same `deviceRotation`
the sensor path sets. The sensor path's own quantiser is covered by `DeviceRotationPluginTest.kt`
and `deviceRotation.test.ts`.

### Verified on the Pixel 4, 2026-08-04 — 60/60 against the C64U (fw 1.2.0, core 1.4D)

Both layouts × three orientations × ten keys. The first run found one defect: **the D-pad centre
key fired nothing**. Android delivers `KEYCODE_DPAD_CENTER` to the WebView as `key: "Enter"`,
`code: ""`, `keyCode: 13` — a DOM `KeyboardEvent` carries the DOM key code, never the Android one —
so the `keypad` profile's `{ code: "DpadCenter" }` and `{ keyCode: 23 }` bindings could not match
and the press resolved to `enter`, which the `fire` slot was not bound to. Fixed by binding the
D-pad's fire slot to both actions; the classicT9 run went 27/30 → 30/30 on the same hardware, and
diamond8 passed 30/30.

### Two traps this rig has already paid for

- **`run_prg` types RUN into the keyboard matrix.** A key press shorts a matrix COLUMN to a row,
  and the columns are `$DC00` — the same register the joystick is read from. `N` sits on column 4,
  which is the fire bit, so every start produced one phantom fire. The probe discards its first
  second and seeds its baseline from the mask left at the end of it.
- **`jsr` clobbers the accumulator.** Shifting the edge mask along in `A` across the direction
  handlers made one press arrive as up, down, left, right and fire together — a fault that looks
  exactly like the app relaying garbage. Each bit is re-read from memory instead.

## Audio overlap + transport

`audio_overlap_hil.py` proves the app never plays two sounds at once and that the transport acts on
whatever is playing. Run it against either machine, or across a switch between them:

```bash
python3 tools/hil/audio_overlap_hil.py --serial <ADB_SERIAL> --device debug-c64u
python3 tools/hil/audio_overlap_hil.py --serial <ADB_SERIAL> --switch-devices
```

### Verified on the Pixel 4, 2026-07-27 — 13/13 against the C64U

| Check                                              | Result                                                        |
| -------------------------------------------------- | ------------------------------------------------------------- |
| A local tune plays                                 | 1 app audio stream, −30.2 dBFS (11.8 dB over the room floor)  |
| Live View audio started **on top of** a local tune | 1 stream — the tune is stopped, never layered                 |
| A local tune started **on top of** the mirror      | 1 stream — the mirror is stopped                              |
| After a WebView reload                             | 0 streams (the native AudioTrack no longer outlives the page) |
| Pause on a Play page mounted mid-tune              | enabled, and it stops the audio                               |
| Play/Stop, Previous, Next                          | usable, labelled for the running tune                         |
| Progress bar seekable                              | yes on the local route, absent on the C64 route               |

Audio **quality** was checked separately, because "no overlap" is not "sounds right": a 14 s capture
of `Use_My_Fire.sid` scored **melSim 0.716** against a `sidplayfp` render of the same file pulled off
the phone — the rig's calibrated "correct tune" score is 0.725 (wrong tune −0.049). See
`sid_audio_match.py`.

### Counting audio streams honestly

`dumpsys audio | grep -c 'state:started'` counts **every app on the phone**, which is how a stray
"2 concurrent streams" was once blamed on this app when the second player belonged to something else.
This harness filters started players to the app's own pid.

### Reading a failure

Play / Previous / Next are gated on `canTransport = hasPlaylist && !isPlaylistLoading`, and the
playlist is **per device**. Running against a machine that has never had one disables them
correctly — the harness reports that as "this device has an EMPTY playlist" rather than as a
transport failure.

## Seek latency

`seek_latency_hil.py` answers one question with the microphone: **tap the progress bar to seek
backwards — how long until the music comes back?** libsidplayfp cannot rewind, so a backward seek
used to re-render the tune from the start at ~150 ms of CPU per second of audio. The pre-render
cache (`localSidEngine.seekTo`) turns that into a buffer offset.

```bash
pip install websocket-client numpy
python3 tools/hil/seek_latency_hil.py --serial <ADB_SERIAL>
python3 tools/hil/seek_latency_hil.py --serial <ADB_SERIAL> --min-position-seconds 25 --seek-back-seconds 20
```

### Measured on the Pixel 4, 2026-07-27 (mic at the speaker, media volume 16/25)

Eight clean readings — every one a real backward seek, on an audible phone, with no track change:

```
0.33  0.43  0.52  0.67  1.20  2.38  2.62  3.65   (seconds, tap → sound returns)
```

|                                | tap → sound returns               |
| ------------------------------ | --------------------------------- |
| **After the pre-render cache** | **0.33 – 3.65 s, median ≈ 0.9 s** |
| _Before it existed_            | _9.96 s_                          |

So the worst reading beats the old figure by ~2.7× and the typical one by ~10×.

**The spread is not explained by the cache being warm or cold.** That was the expectation, and the
readings do not support it: two seeks taken 176 s and 85 s into the _same_ 245 s tune — both long
past the ~37 s its pre-render needs — returned 2.38 s and 1.20 s, while a seek 3 s into a fresh tune
returned 0.43 s. Something other than the cache dominates what is left, and it has not been
identified. Do not quote a cold/warm split from this data.

The station advances tracks underneath the harness, so the two readings in a run are often different
tunes — they are two samples along the same axis, not a controlled pair.

### What it refuses to report

Every one of these was a wrong number this harness produced before the guard existed:

- **The mic must actually hear the phone.** A pre-flight capture (retried, so a track boundary does
  not condemn a healthy rig) requires the speaker to be ≥ 4 dB over the room floor. A silent phone
  otherwise yields a confident "15.96 s".
- **The seek must run backwards.** The target is computed from the position and duration clocks, not
  from a fixed fraction of the bar: 2% of a twenty-minute tune is 24 s in, which lands _ahead_ of a
  playhead at 0:27 and quietly measures a forward seek.
- **The track must not change mid-capture**, or the "gap" may be the gap between tunes.
- **The first silence after the tap**, never the longest in the capture — the longest was once a
  quiet passage 13 s after a tap at 4 s.

Drive the bar with `adb shell input tap`, not CDP mouse events: synthesised events drove the control
into a scrub it never left (the elapsed label kept its `⏵`) and playback stopped. And keep the screen
awake — a sleeping screen stops playback mid-capture.

## SID Radio

`sid_radio_hil.py` is the authoritative Pixel-4 → C64U product proof for SID Radio (spec §9). It
starts a station via real `data-testid` elements, soaks through auto-advances, and asserts the
MEASURED-then-PINNED §9.2 budgets in
[`ci/perf/sid-radio-perf-thresholds.json`](../../ci/perf/sid-radio-perf-thresholds.json), exiting
`1` on any regression. Manual/local (spec §9.5); the host-deterministic budget check runs in CI via
[`scripts/assert-sid-radio-perf.mjs`](../../scripts/assert-sid-radio-perf.mjs).

```bash
pip install websocket-client
python3 tools/hil/sid_radio_hil.py --serial <ADB_SERIAL> --station song  --soak-tracks 30 --skips 5
python3 tools/hil/sid_radio_hil.py --serial <ADB_SERIAL> --station style --style fast_paced --soak-tracks 30
python3 tools/hil/sid_radio_hil.py --serial <ADB_SERIAL> --shuffle-replay   # G11: controls disabled during a station
python3 tools/hil/sid_radio_hil.py --serial <ADB_SERIAL> --hvsc-update      # G12: continuity while md5PathIndex rebuilds
python3 tools/hil/sid_radio_hil.py --serial <ADB_SERIAL> --engine local --station song --soak-tracks 20
```

It sets `localStorage` `c64u_sid_radio_enabled` / `c64u_sid_ranking_enabled` (plus
`c64u_local_engine_enabled` / `c64u_playback_engine` for `--engine local`), reloads, and reads the
hidden `data-testid="sid-radio-stats"` JSON blob (§9.4) each tick. On-device measurements already
recorded (M0/M2): cold bundle load + reverse index **≈145 ms** (« 1500 ms), `engineThreadIsMain=false`,
hot memory **5.0 MB**. Continuity (≥30 auto-advances) and skip latency need a live C64U (or the Local
engine). Never auto-rewrite a pinned baseline to hide a regression (spec §9.2).

`--engine local` is the only mode that asserts the `localEngine` (§12.6) block — it aborts if the app
did not take the engine selection, so a run can never pass by quietly falling back to the C64. A metric
the app never reported is printed as `NOT REPORTED` and a section that reported nothing at all fails the
run, so an unmeasured budget is never mistaken for a green one.

`--hvsc-update` (G12) clears `lastUpdateCheckUtcMs` so the app's update check runs during the station,
then asserts continuity. It prints the installed/update versions before and after and says so loudly
when upstream had no update — continuity across a rebuild that never happened proves nothing.

# A/V sync — Hardware-in-the-loop (HIL) test

`av_sync_hil.py` drives the **shipped app on a physically-connected Pixel** and measures the real
phone → C64 Ultimate → phone A/V pipeline over Wi-Fi. It reads the on-screen A/V sync and
tap-latency stats straight out of the running WebView via the Chrome DevTools (CDP) socket, and
drives the UI by clicking real `data-testid` elements (no raw ADB product input).

## What it covers

1. **Automatic A/V sync soak** — runs the bundled `av-sync-auto` program (periodic, frame-aligned
   white-flash + tone), lets it soak, and asserts matched pops accrue. Reports the audio↔video
   offset percentiles.
2. **Interactive space-triggered latency** — loads `av-sync-key`, sends SPACE over Remote Input
   (machine:input) repeatedly, and reports **press→see**, **press→hear** and the pop's **A/V
   offset** P99.

## Run

```bash
pip install websocket-client
python3 tools/hil/av_sync_hil.py --serial <ADB_SERIAL> --soak-seconds 45 --taps 12
```

## Thresholds — ambitious-but-achievable, ASSERTED on hardware

The original spec's `<30 ms` **source→display** target is a physical floor (the C64U's own ~1–2 frame
capture buffer + multicast Wi-Fi + WebView render), so it was reframed to **end-to-end budgets
measured on this hardware and now asserted** — see `ci/perf/stream-perf-thresholds.json` → `endToEnd`.
`av_sync_hil.py` reads those thresholds and **fails (exit 1)** if the pipeline regresses past them:

| Gate (p99)                      | Committed budget | Measured (2026-07-24) |
| ------------------------------- | ---------------- | --------------------- |
| press→see (video input→display) | < 250 ms         | ~96–176 ms            |
| press→hear (audio input→hear)   | < 150 ms         | ~90–144 ms            |
| A/V sync offset                 | < 20 ms          | ~2–5 ms               |
| audio player buffer (native)    | < 100 ms         | ~13–56 ms (watching)  |

press→see/hear are input→display/hear, so they include the machine:input HTTP round trip and the
device's once-per-frame keyboard poll — not a pure render latency. They are **noisy run-to-run**
(±~80 ms; the see metric alone swings 96→176 ms across identical-video-path runs), so they gate gross
regressions, not fine latency — the native-audio win is the separate buffer row. The A/V sync offset
(~2–5 ms) is excellent; it improved from an earlier ~36 ms after the wire-timestamp + governor +
throttle work.

### Native low-latency audio (the audio-latency reduction)

The largest **app-reducible** slice of the audio latency is the **player buffer**. The native
`AudioTrack` (Settings → "Low-latency audio (native)", default on) is fed **directly from the plugin's
`URGENT_AUDIO` receive thread**, never from JS — so there is no per-packet bridge traffic to stall the
JS loop, and the JS-thread video paint can't starve the audio feed, which lets a small buffer hold
glitch-free. The WebAudio player feeds from JS and has no cap: its buffer **balloons under concurrent
video** because its scheduler queues chunks ahead through every JS jank. A/B measured on this rig
**watching** (audio+video — the primary Live View mode), steady state, both stable 50 fps, 0 underruns:

| Audio player buffer | Setting off (WebAudio) | Setting on (native)      |
| ------------------- | ---------------------- | ------------------------ |
| depth (live Stats)  | **179–192 ms**         | **13–56 ms** (~4× lower) |

That buffer is the native audio latency; the HIL reads it from the live Stats
(`stream-stats-audio-buffer`) and gates it (`ci/perf/stream-perf-thresholds.json` →
`audioPlaybackLatency`). It is the **reproducible** native-audio win — press→hear (which measures the
JS analyzer callback, a path the native playback does not use) is too run-to-run-noisy to show it. All
the audio smarts (the A/V-sync analyzer, health stats) stay in TypeScript, fed from the same datagrams;
only the final speaker sink is native. The **full** press→hear round trip keeps a firmware/Wi-Fi floor
(machine:input round trip ~19–33 ms + capture + the once-per-frame keyboard poll) that no app change
can beat, so the factor-2 goal (met ~4× here) is on this app-controlled buffer, not that physical floor.

## Local gate, not shared CI

This HIL needs the physical rig (Pixel 4 on USB + C64U on the LAN), so it runs on the **local build**,
not in shared CI. Run the whole gate — streaming + latency — with:

```bash
npm run test:streams:hil        # or: ./build --install-apk --stream-hil
```

That runs `hil_stream_fixture.py` (fps / CPU / jank / slot accounting) and this `av_sync_hil.py`
(the latency budgets above), with a machine-readable exit (0 pass, 1 product fail, 2 infra). Shared
CI runs only the deterministic host gates (`scripts/ci/stream-gates.mjs`).

## machine:input drives the C64 keyboard matrix (verified)

Remote Input (`POST /v1/machine:input`, `{kind:"keyboard",inputs:["space"],transition:...}`) **does**
drive the CPU-visible CIA keyboard matrix on the C64U — a program that polls `$DC00`/`$DC01`
(like `av-sync-key`) sees it. Verified with `1541ultimate/tools/api/input_tool.py` and directly:
holding SPACE via machine:input clears `$DC01` bit 4 with row 7 selected, and `av-sync-key` sets
its `space_was_down` flag.

Two practical notes the app depends on:

- **Hold, don't tap.** `av-sync-key` polls the matrix once per frame, so a sub-frame `tap` can fall
  between two polls and be missed. `pressSpace` sends **press → hold ~3 frames → release** so the
  poll reliably catches the rising edge. Note the poll is not free: the pop fires when the
  end-of-frame IRQ next observes the key, i.e. up to one frame (~20 ms PAL) after the machine:input
  request arrives — that per-frame poll latency is part of the reported press→pop numbers (holding
  prevents a MISSED poll, it does not remove the poll delay itself).
- **Don't hammer the device while streaming.** Heavy concurrent REST (e.g. bulk `readmem` polling)
  degrades the video stream (observed ~47 → ~23 fps) and drops the 1-frame flashes. Read state
  sparingly during a soak.

## Demo Mode

```bash
npx vite-node --script tools/hil/demo_mode_hil.ts -- --serial <adb serial> \
  --json artifacts/demo-mode-hil/summary.json
npx vite-node --script tools/hil/demo_mode_hil.ts -- --serial <adb serial> --only av-stream
```

**The phone must be in flight mode with no routable interface, and the run refuses to start
otherwise.** That is not only what the first stage is about — it is what makes the whole run safe.
With no radio there is no path to a c64u, u64 or u2, so no stage can put a packet near one however
the app behaves. The "a network is up but nothing answers on it" stage injects the network status
rather than turning a radio on, for the same reason.

Eleven stages:

| Stage               | What it establishes                                                                                                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `offline-offer`     | A fresh launch with no network offers Demo Mode, with the explanation visible on screen and no hostname field; confirming reaches `DEMO_ACTIVE`. Records how long after the launch intent the offer appears.                                                                                     |
| `unreachable-offer` | With a network reported up and nothing answering, the app probes, fails, and offers Demo Mode naming the host it tried.                                                                                                                                                                          |
| `av-stream`         | Live View in Demo Mode: assembled frame rate, audio packets per second and loss, the sender being loopback only, all sixteen tone-ladder colours walked off the decoded canvas, and every note's pitch graded from PCM captured on the phone.                                                    |
| `library`           | The simulated device's own music, programs, cartridges and disks are listed by the app's own Add-items flow.                                                                                                                                                                                     |
| `music`             | A tune from the simulated device reaches the speaker — frames written to the mixer, counted from the kernel — and the device's screen names it. **Audible**, about fifteen seconds.                                                                                                              |
| `prg-stream`        | Starting a program changes what Live View shows. Keeps a decoded frame and a five-second screen recording.                                                                                                                                                                                       |
| `crt-stream`        | The same for a cartridge.                                                                                                                                                                                                                                                                        |
| `disks`             | A disk from the simulated device end to end: a three-image folder added through the app's own picker, `Disk 1.d64` mounted on Drive A, the Disk Explorer reading its directory off the image, and a program run from it changing what Live View shows.                                           |
| `ntsc-stream`       | The other raster standard end to end: `System Mode` is switched to NTSC on the Config page, and the stream becomes 240-line frames at 60 fps with nothing lost, dropped or decimated. Switched back to PAL before the stage ends. Keeps a decoded frame and a five-second recording.             |
| `performance`       | While video and audio both run: frame rate held over a twelve-second window, video and audio loss measured as a delta over ten seconds, processor use, and how long each tab takes to answer a press — measured again with the stream stopped, so what is asserted is the stream's contribution. |
| `cta-census`        | Every main route renders in Demo Mode with no error boundary, with enabled controls, and with every control reachable by a tap once scrolled into view.                                                                                                                                          |

The `av-stream` stage relaunches into a stock session first. `__c64uTestProbeEnabled`, which the
`unreachable-offer` stage needs in order to inject a network status, also tells the app not to start
its own mock server — a session carrying it enters Demo Mode routed at the stored real host and
streams nothing. The process restart is what clears it.

Audio discipline: the stage steps the music stream down to 6 of 25 before it plays anything, and the
ladder is a C-major octave at -14.7 dBFS. Total audible time is about 25 seconds.

Artefacts land in `artifacts/demo-mode-hil/`: the JSON named by `--json` with every measurement, the
frames decoded off the Live View canvas (`live-view-frame.png`, `prg-running.png`, `crt-running.png`,
`music-now-playing.png`, `ntsc-frame.png`), the `*-running.mp4` and `ntsc-stream.mp4` screen
recordings, and `mirror.wav` as captured by the audio pipeline.

Reference numbers from this rig (Pixel 4, debug build): offer on screen 2.4 s after the launch
intent; 50-51 fps PAL and 59-61 fps NTSC, each with 0 lost frames, 0 dropped packets and 0 decimated
over ten seconds; 250 audio
packets a second with 0 lost and 0 underruns; 48,288 frames a second reaching the speaker while a
tune plays; 13.4% of the device's processors; every tab answering a press in 34-254 ms except Home,
which takes about 410 ms while streaming against 30 ms with the mirror stopped, because returning to
it re-mounts the Live View card.
