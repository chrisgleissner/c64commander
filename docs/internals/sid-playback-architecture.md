# On-device SID playback architecture

## Summary

C64 Commander can render SID tunes on the phone or in the browser instead of on the C64. Three
renderers are available, and the listener picks one in Settings:

| Setting label   | Renderer                         | Runs as                                | Platforms         | Default on   |
| --------------- | -------------------------------- | -------------------------------------- | ----------------- | ------------ |
| Fast & accurate | libSidplayEZ (reSIDfp-based)     | native library, own thread per player  | Android           | Android      |
| Accurate        | libsidplayfp reSIDfp (WASM)      | Web Worker                             | Android, iOS, web | iOS, web     |
| Light           | libsidplayfp SIDLite (WASM)      | Web Worker                             | Android, iOS, web | —            |

All three sit behind one TypeScript contract, `SidRendererCore`
(`src/lib/playback/sidRenderer/sidRendererContract.ts`), and one orchestrator, `LocalSidEngine`,
which owns chunked rendering, seeking, the whole-tune pre-render, lead-in warming, crossfades,
audio ownership and stall recovery for all of them. Renderer choice is independent of where the
sound goes (this device or the C64), which is `PlaybackEngine`.

On Android every renderer plays through the same native component, `LocalAudioFeed`
(`android/.../sidaudio/LocalAudioFeed.kt`), into the same `AudioPipeline` and `AudioTrack` the A/V
mirror uses. JavaScript does no per-sample work on Android: libSidplayEZ's PCM never leaves native
memory, and WASM PCM crosses once, as a binary message. On web and iOS the WASM renderers play
through Web Audio as before.

Known limitations are listed in [Limitations](#limitations).

## Contents

1. [Components](#components)
2. [The renderer contract](#the-renderer-contract)
3. [PCM on Android: transports and copies](#pcm-on-android-transports-and-copies)
4. [The native audio feed](#the-native-audio-feed)
5. [libSidplayEZ: build, wrapper and semantics](#libsidplayez-build-wrapper-and-semantics)
6. [Renderer selection and fallback](#renderer-selection-and-fallback)
7. [Songs that need the C64 ROMs](#songs-that-need-the-c64-roms)
8. [Platform support](#platform-support)
9. [Equivalence of the renderers](#equivalence-of-the-renderers)
10. [Performance](#performance)
11. [Testing](#testing)
12. [Limitations](#limitations)
13. [Troubleshooting](#troubleshooting)

## Components

```
                         LocalSidEngine (one orchestrator for every renderer)
     open/render/seek/prerender/close ─┐                ┌─ chunks: Int16Array | NativePcmRef
                                        ▼                │
      ┌───────────────── worker protocol (localSidWorkerProtocol.ts) ──────────────────┐
      │ createRendererDispatcher(core): ordering, superseding, error mapping            │
      ├────────────────────────────────────┬────────────────────────────────────────────┤
      │ Web Worker                          │ NativeRendererChannel (main thread)        │
      │   WasmSidRendererCore               │   SidplayEzRendererCore ── SidAudio plugin │
      │   libsidplayfp-wasm: reSIDfp|SIDLite│        └─ SidplayEzRenderer (thread) ──JNI─┤
      └────────────────────────────────────┴───────────────── libc64sidplayez.so ──────┘
                                        │                                  │ renders into
                                        ▼                                  ▼
                  LocalSidChunkScheduler ── sink.createPcmSource()     PcmStore (native buffers)
                                        │                                  │
              ┌─────────────────────────┴───────────┐                      │
   web / iOS  │ Web Audio sink (localSidAudioSink.ts)│                      │
              └──────────────────────────────────────┘                      │
   Android    NativeLocalSidSink (controller, no sample work)               │
                 │ NativePcmRef ── SidAudio.enqueueBuffer ─────────────────┤
                 │ Int16Array  ── window.c64SidAudioPort (binary) ──┐       │
                 │              └ SidAudio.enqueuePcm (base64, fallback)│   │
                 ▼                                                  ▼   ▼   ▼
              control (Capacitor)           LocalAudioFeed (one feeder thread, lock-free inbox)
                                              ordered segments · crossfade · fade · silence · watchdog
                                                                    │
                                                    AudioPipeline (StreamUdp) ── AudioTrack
```

| File                                                     | Role                                                                                     |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `src/lib/playback/localSidEngine.ts`                     | The orchestrator. Chooses the renderer per tune and gives each runtime its own channel.  |
| `src/lib/playback/sidRenderer/sidRendererContract.ts`    | `SidRendererCore` and the shared message dispatcher.                                     |
| `src/lib/playback/sidRenderer/wasmRendererCore.ts`       | reSIDfp and SIDLite through `libsidplayfp-wasm`; runs in `localSid.worker.ts`.            |
| `src/lib/playback/sidRenderer/sidplayEzRendererCore.ts`  | libSidplayEZ through the `SidAudio` plugin.                                              |
| `src/lib/playback/sidRenderer/nativeRendererChannel.ts`  | Presents a core to the engine as a worker.                                               |
| `src/lib/playback/sidRenderer/pcmPayload.ts`             | `PcmPayload` (JS samples or a native reference) and `NativePcmBuffer`.                   |
| `src/lib/playback/localSidNativeSink.ts`                 | Android sink: numbers and hands over chunks, keeps the clock from the feed's playhead.   |
| `src/lib/playback/localSidAudioSink.ts`                  | The sink interface and the Web Audio sink.                                               |
| `android/.../sidaudio/LocalAudioFeed.kt`                 | Everything done to the samples on Android.                                               |
| `android/.../sidaudio/PcmStore.kt`                       | Native PCM buffers addressed by id.                                                      |
| `android/.../sidaudio/SidplayEzRenderer.kt`              | One libSidplayEZ player and its thread.                                                  |
| `android/.../sidaudio/SidAudioPlugin.kt`                 | The Capacitor plugin and the binary WebMessage port.                                     |
| `android/app/src/main/cpp/sidplayez/`                    | JNI wrapper on `libsidplayfp::Player`, and the C++ tests.                                 |
| `android/scripts/build-libsidplayez.sh`                  | Pinned, checksum-verified build for every ABI and for the host.                          |

## The renderer contract

`SidRendererCore` has seven operations: `load`, `open`, `render`, `seek`, `prerender`, `close` and
`dispose`. A core is one stateful player and is never re-entered.

`createRendererDispatcher(core, post)` turns a core into a handler for the engine's messages
(`load`, `open`, `render`, `seek`, `prerender`, `close`) and produces its replies (`ready`, `opened`,
`chunk`, `end`, `seeked`, `prerender-chunk`, `prerender-progress`, `prerendered`, `error`). It
serialises messages, skips renders and seeks queued for a tune that has since been replaced (a
skipped seek is still answered), lets a running pre-render see that a newer one is waiting, and maps
failures to typed error codes (`load`, `open`, `render`, `prerender`). Both the worker and the native
channel use it, so these rules exist once.

The pre-render runs on a second player so the playing one is not disturbed. A whole-tune
pre-render, a lead-in warm and playback each get their own channel, so for libSidplayEZ three
native players run on three threads at once (playback at default priority, the other two in the
background).

PCM in the contract is a `PcmPayload`: interleaved stereo S16 as an `Int16Array`, or a
`NativePcmRef` (buffer id, start frame, frame count). The scheduler, the render cache and the
pre-render accumulation treat both alike; `NativePcmBuffer` gives a cached native tune the `length`,
`slice` and `subarray` the cache cursor uses, returning frame ranges of the same buffer. Every
native buffer the engine drops (a stale chunk, an abandoned pre-render, a cache eviction) is
released, unless the buffer playback is reading from or a render still growing it is the same one.

## PCM on Android: transports and copies

| Path                                   | JS work per chunk                         | Crosses into native                  | Native copies                    |
| -------------------------------------- | ----------------------------------------- | ------------------------------------ | -------------------------------- |
| libSidplayEZ                           | none (a reference)                        | `enqueueBuffer`: ~100 bytes of JSON  | scratch → store, store → slice, slice → ring |
| WASM, binary port                      | 24-byte header write; `postMessage`       | one ArrayBuffer (one copy)           | slice → ring                     |
| WASM, fallback                         | base64 encode                             | JSON string, 4/3 of the PCM          | base64 decode, slice → ring      |
| Previous release (all WASM)            | S16 → planar float → S16 with gain, base64 | JSON string, 4/3 of the PCM          | base64 decode, → ring            |

Copies that remain, and why:

- **WASM heap → `Int16Array`.** `libsidplayfp-wasm` returns rendered PCM as its own array. The
  worker allocates the chunk with 24 bytes of headroom in front (`pcmHeadroomSamples`) and the
  transfer to the main thread is zero-copy.
- **Main thread → native.** A WebView cannot share memory with the app process, so a `postMessage`
  copies the ArrayBuffer once. The header is written into the reserved headroom, so the main thread
  does not copy the samples itself. `window.c64SidAudioPort` is installed with
  `WebViewCompat.addWebMessageListener`, needs the `WEB_MESSAGE_ARRAY_BUFFER` feature, and is used
  only after a probe message has been seen arriving natively; otherwise PCM goes as base64 through
  `SidAudio.enqueuePcm`. The port is bound to the page, not to workers, so the worker cannot post to
  it directly. `SharedArrayBuffer` and cross-origin isolation are not required anywhere.
- **Native buffer → feed slice → ring.** The feed builds each 50 ms slice in a scratch array,
  applying the fade and mixing the crossfade tail in the same pass, then `AudioPipeline.offer`
  copies it into the ring. The audio thread then resamples out of the ring into the track buffer.
  At 192 KB/s these are memcpys of a few kilobytes and cost microseconds.
- **libSidplayEZ render.** `PcmStore` blocks are direct `ByteBuffer`s, so the JNI wrapper renders
  into them in place (`nativeRenderDirect`), with no scratch buffer and no copy. The byte-array
  entry point (`nativeRender`) renders into a scratch buffer and copies it out with one
  `SetByteArrayRegion`, rather than holding a `GetPrimitiveArrayCritical` section for the tens of
  milliseconds a render takes, which would stall the collector.

Data and control can travel on different channels (the binary port and Capacitor). Every segment,
and every command that acts on queued audio (flush, fade, fade-in, transition, tail hand-over and
release), carries its session's sequence number. The feed applies them in sequence order, so a
command can neither overtake nor fall behind the audio it was issued after.
A sequence number that never arrives is skipped after two seconds and logged.

## The native audio feed

`LocalAudioFeed` does what `localSidNativeSink.ts` did to the samples in the previous release,
ported behaviour for behaviour, so that libSidplayEZ's PCM can be handled without entering
JavaScript and the WASM renderers get the same handling:

- **Sessions.** The web layer makes one per tune. The newest session that has audio takes the
  track; older sessions go quiet and cannot flush or close it. A session whose sample rate differs
  re-opens the track, one with the same settings inherits it.
- **Backpressure.** Writes stop at 12 s queued (250 ms during a track change), below the depth at
  which the pipeline trims its backlog.
- **Crossfade.** `beginTransition` recovers what the outgoing session had queued in the track but
  not played (from a 14 s history of what was written, trimmed to the exact playhead), flushes the
  track with the next write and keeps it 250 ms deep. `takeTail`/`adoptTail` hand that audio to the
  incoming session, which mixes it under its own audio with a falling ramp while its own fade-in
  rises; the ramp advances only on the incoming tune's own frames, so the two never meet in a gap.
- **Level.** The listener's gain is the pipeline's master gain, kept by the feed so a re-opened
  track keeps it. Fades are per session and per frame.
- **Clock.** The pipeline runs with `correctDrift = false` for local playback. The A/V mirror
  resamples to follow the Ultimate's clock; a local renderer has no remote clock to follow, and
  drift correction would only bend the pitch.
- **Depth.** The watchdog and the crossfade recovery judge what the feed's own ring holds
  (`FeedOutput.ringMs()`), not the track's buffer, which the platform sizes and drains on its own.
- **Silence.** A session counts consecutive flat seconds (peak-to-peak below 64) of what it wrote;
  it is a fault once that, less what is still queued in the track, reaches 12 s.
- **Stall watchdog.** A track that holds audio, is not paused, has not been written to for a second
  and has not drained for four is re-opened; the web layer then announces the chunk completions that
  went with it.
- **Threading.** One feeder thread at audio priority owns all state. Commands from the Capacitor
  thread and the WebView's message thread go into a lock-free inbox and never wait; stats are
  published as immutable snapshots. Nothing slow runs under the pipeline's lock, and the
  `AudioTrack` writer thread never waits on the feed.

`PcmStore` holds native buffers in one-second blocks, so a growing pre-render never reallocates.
Live render chunks leave the store when the feed takes them; pre-render buffers stay until the
web layer's cache releases them. Both are bounded natively as well (ephemeral buffers expire after
120 s, retained ones beyond 192 MB are dropped oldest first), so a leaked id costs a log line, not
the process. `SidAudio.attach` frees everything a previous page lifetime left behind.

## libSidplayEZ: build, wrapper and semantics

**Source.** Upstream [Toddler-Boy/libSidplayEZ](https://github.com/Toddler-Boy/libSidplayEZ) at
commit `4c8664c80df8d363049e1a3eadf59cd9e52afd1f`, fetched as a GitHub archive and checked against
its SHA-256 before use. The revision, URL and checksum are defined once, in
`android/app/build.gradle`, and the third-party notices read them from there.

**Build.** `android/scripts/build-libsidplayez.sh android …` compiles every file under `src/` except
`src/EZ/*.cpp` (the ultraSID application layer: chip profiles chosen by file path, sidid, digi
selection) together with the wrapper, with the NDK r27 clang for `arm64-v8a`, `armeabi-v7a`, `x86`
and `x86_64` (API 24), `-std=c++2b -O3`, hidden visibility, section GC, a statically linked libc++,
`-Wl,-z,max-page-size=16384` and `llvm-strip --strip-unneeded`. File prefix maps and a sorted link
order make the output bit-identical between work directories. The Gradle task
`buildLibSidplayEz<Variant>AndroidLibraries` runs it before each variant's build for the same ABIs
as the 7-Zip library (release: `armeabi-v7a`, `arm64-v8a`, or what the variant names).

One patch is applied to the verified archive before compiling,
`android/app/src/main/cpp/sidplayez/patches/0001-match-residfp-output.patch`. It adds three
`libsidplayfp::Player` entry points: the 8580's EXT IN level (`set8580ExternalInput`, the input
libsidplayfp's `digiBoost` drives), a switch for the start-up declick (`setStartupDeclick`, on by
default as upstream), and a hook that configures each chip as `sidCreate` makes it
(`setChipSetup`), so the analogue profile is in place before the power-on warm-up and the first
sample. It changes one behaviour: a PSID whose init routine has not returned after about 9.4
emulated seconds plays on from there instead of failing to load after about 935 (see D3 below). Each modified file carries a dated notice naming the change, as GPL
section 5(a) requires. The extracted tree is keyed by the archive's checksum and the patches, so a
changed patch re-extracts. The third-party notices name every patch, and a unit test fails when
one is not named. Upstream's licence, author and credit files are kept in the repository under
`android/app/src/main/nativeLicenses/public/licenses/libsidplayez/` and packaged into the app with the notices.

```bash
android/scripts/build-libsidplayez.sh android "$ANDROID_NDK_HOME" /tmp/ez-work /tmp/ez-out \
  https://github.com/Toddler-Boy/libSidplayEZ/archive/<rev>.tar.gz <sha256> <rev> 24 arm64-v8a
android/scripts/build-libsidplayez.sh host /tmp/ez-work /tmp/ez-host <url> <sha256> <rev> "$JAVA_HOME"
```

| ABI          | Engine flags | Stripped size | Notes                                                                       |
| ------------ | ------------ | ------------- | --------------------------------------------------------------------------- |
| arm64-v8a    | `-O3`        | 545 KiB       | NEON resampler kernel                                                       |
| armeabi-v7a  | `-O3 -mfpu=neon` | 414 KiB   | scalar resampler kernel (upstream's NEON kernel is AArch64-only)            |
| x86_64       | `-O3 -msse4.2` | 549 KiB     | the Android x86_64 ABI guarantees SSE4.2; AVX2 is chosen at run time        |
| x86          | `-O3 -msse4.1` | 553 KiB     | the 32-bit x86 ABI guarantees only SSSE3, so the JNI layer refuses to create a session on a CPU without SSE4.1 (`cpu_check.cpp`, compiled at baseline) |

**Wrapper.** `EzSession` drives `libsidplayfp::Player` and `SidTune` directly rather than the
`libsidplayEZ::Player` facade. The facade forces a 6581 for tunes that do not name a chip and picks
analogue settings from the tune's file path under `/MUSICIANS/`, so its output depends on host CSV
data. The wrapper instead takes the fallback chip from the app's setting (never forced over a
model the header declares, per chip) and sets the analogue model from `AnalogueProfile`
(`ez_session.h`), whose defaults make the output match reSIDfp's, the app's "Accurate" renderer:
6581 filter curve 0.5, filter gain 1.0, waveform DC offset 1.5, a 10 kΩ external load (reSIDfp's
1.6 Hz DC blocker; libSidplayEZ defaults to 1 kΩ, 15.9 Hz), the 8580 EXT IN level that gives
reSIDfp's digi-boost loudness, and no start-up declick. How they were chosen is in
[Equivalence](#equivalence-of-the-renderers).
Songs are zero-based and clamped to the tune's count. Output is the engine's float, converted with
its own 1/32768 scale and saturation. The default C64 is PAL, used only when the tune does not say.

Stereo placement follows reSIDfp, unless the tune assigns each chip a side itself. libSidplayEZ
pans a second chip hard right and puts a third in the centre; reSIDfp gives each side its own chip
and half of the other for two chips, and places three left, centre and right with half of each
outer chip on the far side. For two chips the wrapper remixes libSidplayEZ's left and right into
reSIDfp's layout exactly (`blendTwoChipStereo`). Three chips cannot be remixed that way, because
libSidplayEZ has already summed the third chip into both sides, so they are rendered as libSidplayEZ's
mono mix at half gain on both sides (`centreThreeChipMix`); reSIDfp's two sides correlate at about
0.97, so the difference is small. Four or more chips, which only libSidplayEZ can play, keep its
placement.

JNI sessions are opaque ids in a registry of shared pointers with a mutex each: a destroyed id is an
`IllegalStateException`, a destroy that races a render waits for it, and two threads can never drive
one player. In Kotlin each renderer instance owns one single-thread executor, so all calls on a
session happen on one thread. Long work (seek, pre-render) checks a generation counter between
4800- and 12000-frame blocks and stops when the renderer is disposed or a newer request arrives.

**Semantics that differ from libsidplayfp-wasm**, measured in [Equivalence](#equivalence-of-the-renderers):

- Start-up: libSidplayEZ discards the audio produced while the tune's init routine runs and lets
  its volume pokes settle before the first sample, so most tunes start 10–50 ms earlier than in the
  WASM build (a few start at the same time or 10 ms later). Song lengths are unaffected.
- 6581 analogue model: libSidplayEZ's author tuned it by ear (filter gain, leakage, DC model, a 1 kΩ
  external filter). The notes, timing and spectral balance match reSIDfp closely; the timbre of
  filter-heavy 6581 tunes differs most.
- Formats: PSID and RSID v1-v4 and v4E. Compute!'s Sidplayer MUS data is rejected with an error,
  and PRG/P00 files cannot be loaded from bytes (upstream only detects them by file name); neither
  is offered by the app's local playback.
- Upstream defects documented in the
  [fork review](https://github.com/chrisgleissner/libSidplayEZ/blob/benchmark-tooling/docs/performance-and-upstream-comparison.md)
  are not patched, except D3: upstream waits about 935 emulated seconds for a PSID's init routine
  to return and then fails the load, which kept a core busy for 118 s on a desktop CPU and longer
  on a phone. The patch waits about 9.4 emulated seconds and then lets the tune play on from that
  point, with the handshake left so that the play routine starts if init returns later.
  libsidplayfp does not wait at all, so it also plays those first 9.4 seconds, and its clock is
  that much ahead. No PSID in HVSC is affected: loading all 56,178 of them (first song) found
  none whose init takes longer than the budget.

## Renderer selection and fallback

`loadSidEmulationEngine()` returns the stored preference (`c64u_sid_renderer`: `sidplayez`,
`residfp` or `sidlite`), defaulting to the variant's `default_sid_emulation_engine` (`sidplayez`
for every variant). The previous release stored a two-way fidelity choice under
`c64u_sid_emulation_engine`; it is read by meaning: `sidlite` stays Light, `residfp` (which meant
"accurate") becomes the default.

`playbackSidEmulation()` decides what actually plays, per tune:

1. The preference, if this device has it. libSidplayEZ is available only when the `SidAudio`
   plugin reports that its library loaded and this CPU can run it (`probeSidRenderers`, bounded to
   3 s, answered at once off Android). Otherwise reSIDfp.
2. SIDLite instead of an accurate renderer measured unable to keep up on this device (render ratio
   below 1.15 over at least five chunks). Never from libSidplayEZ to reSIDfp, which is slower.

Render throughput is learned per renderer (`renderThroughput.ts`), so the start-up buffer and the
slow-device fallback are judged on the renderer that is playing. The choice is made when a tune
opens and never changes during it; a change in Settings applies from the next tune. Pre-renders
and lead-ins record the renderer that made them, and a tune plays cached audio only from its own
renderer: a cache key built before the native probe answered names reSIDfp even where the tune then
opens on libSidplayEZ. `preload()` waits for the probe, so the renderer it loads is the one the
first tune uses. A stored
preference for an unavailable renderer is kept, and Settings shows what will play here.

Settings (`SidRadioSettingsSection.tsx`) offers Fast & accurate only where libSidplayEZ runs.

## Songs that need the C64 ROMs

An embedded list grades, from 0 to 255, how faithfully the HVSC songs that suffer without the C64's
ROMs still play on a phone (255 bit-exact, 254 same music re-timed, 1-253 degraded, 0 no playback),
one grade per engine and ROM configuration. The format is `sidromdep-1`, specified in
[`doc/rom-dependency-list.md`](https://github.com/chrisgleissner/sidflow/blob/main/doc/rom-dependency-list.md)
in the sidflow repository; `src/lib/romDependency/romDependencyList.ts` ports its reference decoder
(the reading half only; section numbers in its comments are the specification's). The list is
allow-by-default: a song that is not listed plays. Nothing here proves that an unlisted song is fine.

**Which measurement applies** (`resolveActiveRomLane`, `romDependencyPolicy.ts`). The list carries
one grade per (engine, ROM configuration); a song is passed over when the grade of the configuration
in use is **below the list's own `recommended_min_grade`** (a grade equal to it plays). Only songs with a
grade at or below the list's `listing_ceiling` (191 in the release) are listed, and the threshold is
at most ceiling+1, so an unlisted song is never skipped. Commander offers no other number, only the
on/off switch below.

| Engine in use | KERNAL + BASIC stored, authentic, no character ROM | Any stored image not authentic (for example JiffyDOS) | Otherwise (none, or only one image) |
| ------------- | -------------------------------------------------- | ----------------------------------------------------- | ----------------------------------- |
| SIDLite       | SIDLite with KERNAL + BASIC                        | lowest of the four lanes, approximate                 | SIDLite with no ROMs                |
| reSIDfp       | reSIDfp with KERNAL + BASIC                        | lowest of the four lanes, approximate                 | reSIDfp with no ROMs                |
| libSidplayEZ  | read as reSIDfp, approximate                       | lowest of the four lanes, approximate                 | read as reSIDfp, approximate        |

"Authentic" means the SHA-256 of the image equals the reference hash in the pinned manifest. A ROM set
that matches neither the reference nor a measured configuration (KERNAL or BASIC not authentic, or a
character ROM that is not) has no applicable measurement, so the lowest grade of the four lanes is
used: the conservative hint the specification allows (§10.1). libSidplayEZ is not one of the measured
engine builds either; reading it as reSIDfp, the engine it is built on, is a judgement, not a
measurement. Either way the verdict is marked `approximate` in the log line. The character
ROM is stored only after **Read from C64** in Settings has copied it, by briefly running a short
routine on the C64 (`characterRomReader.ts`; the background read takes KERNAL and BASIC only). With
all three images authentic this is the reference configuration, where the list restricts nothing.
Real C64 Ultimate playback never consults the list.

**What happens** (`usePlaybackController.playItem`, `romDependencyGate.ts`). The check runs once the
tune's bytes are read and the route is known, so it costs one MD5 of the file as played.

- A C64 can play it (connected, not Demo Mode, in reach): the existing ROM fallback sends it there
  (`romFallbackDecision`, notice `rom-on-c64` or `rom-list-on-c64`) and, if the ROMs are missing,
  reads them from it in the background. A connection still being discovered counts as usable, because
  the C64 route discovers on demand (`isC64UsableForSid`).
- No usable C64, **Settings → Play and disk → Skip songs that need the C64 ROMs** on (the default):
  a playlist, station, auto-advance, Next or Previous skips the song (`RomDependentSongSkipped`, one
  notice per session; `playPassingOver` moves on to the next song that can play, skipping tracks only
  a C64 can play as well). So does the first song of a station, or of Play pressed with no song
  chosen. Only a song the listener picked asks first (`RomDependencyDialog`, Play anyway or Cancel).
  A tune whose header declares BASIC, with no BASIC ROM stored, cannot be opened by the local engine
  whatever the list grades; the listener who picks it gets a notice with one OK button instead
  (`decideRomListedPlayback` outcome `blocked`, `RomDependencyDialog` kind `needs-basic`), and a playlist
  moving on passes over it even with skipping switched off.
  The question comes before anything playing is stopped: Cancel leaves the current tune playing with
  its auto-advance armed, and a Stop, skip or other launch while the question is open wins over a late
  Play anyway.
- The song already playing, started again (Repeat one, a move between engines, carrying a C64 tune on
  here when the C64 goes), was accepted once and plays on without a question or a skip.
- Setting off: the song plays, with a one-time notice.
- A song that plays here although it needs the ROMs (setting off, Play anyway, or the song already
  accepted and started again) shows **May sound wrong** beside its title on the Now Playing card
  (`MaySoundWrongChip`) for as long as that launch plays. `resolveLocalRoute` reports it as
  `maySoundWrong`, and `resolveLaunchRoute` records it in `maySoundWrongStore` on every launch that is
  not cancelled, so the next launch (a song the list does not name, or one the C64 plays) clears it.
  The chip is plain text and takes no focus stop. It is not a second setting: the existing switch
  already decides whether such a song is skipped or played, and the chip says what playing it means.
- Both renderers enforce that BASIC requirement themselves: WASM and libSidplayEZ answer `romRequired`
  on open and reject the pre-render of an RSID tune that declares BASIC when no complete BASIC image is
  supplied (`missingDeclaredBasic` in `sidRendererContract.ts`). The skip notice for such a tune is
  `romUnplayableSkippedNotice`, since turning off the setting would not help.
- Should a renderer refuse a song after the route let it through, `playItem` does not show it as playing
  (`rejectRefusedLaunch`): the refusal is logged at WARN, a playlist moving on passes the song over, and
  a chosen song gets the same OK-only dialog and is then refused as an already reported error, which
  `startPlaylist`, Next and auto-advance treat as the end of the playing state.
- A song that is unlisted, or graded at or above the threshold, plays without comment. The format has
  no "unknown" grade: a lane that was not measured cannot be encoded.
- The opening of the next and previous tracks is warmed past songs the playlist would skip
  (`wouldPassOver`). The prefetch of a tune's bytes from the Ultimate needs a ready C64, which plays
  such a song itself, so it needs no such check.

**The embedded files** live in `src/lib/romDependency/data/`. They are the HVSC #85 release list
from the sidflow-data release `rom-audit-hvsc85-20261030`: 19,228 bytes listing 672 files and 1,516
subtunes, of which 1,468 grade below the threshold of 128 in at least one lane (nearly all BASIC
tunes, about 1% of RSIDs and 28 PSIDs without ROMs). To ship a newer list, copy the release's
`hvsc<N>-sidromdep-1.bin` and `.manifest.json` over `hvsc85-sidromdep-1.bin` and
`hvsc85-sidromdep-1.manifest.json` (or change the two import names in `embeddedRomDependencyList.ts`)
and set `PINNED_MANIFEST_SHA256` to the manifest SHA-256 printed by the sidflow
`scripts/rom-dependency-list/verify.ts`. At load the manifest is checked against that pin, the binary
against the manifest, and the binary against every rule of the specification (§13.1); a list that
fails, or was made from an incomplete audit, is logged as an error and ignored. Tests use a synthetic
list encoded by the reference encoder (`tests/fixtures/romDependency/`).

## Platform support

| Target                        | Renderers                     | Audio output        | Verified by                                                     |
| ----------------------------- | ----------------------------- | ------------------- | --------------------------------------------------------------- |
| Android arm64-v8a             | libSidplayEZ, reSIDfp, SIDLite | native feed         | runtime on the Pixel 4, debug and release builds                |
| Android armeabi-v7a           | libSidplayEZ, reSIDfp, SIDLite | native feed         | runtime on the Pixel 4 in a 32-bit process (armeabi-v7a-only APK) |
| Android x86_64                | libSidplayEZ, reSIDfp, SIDLite | native feed         | build; runtime on an API 34 emulator                            |
| Android x86                   | libSidplayEZ (SSE4.1 CPUs), reSIDfp, SIDLite | native feed | build only: no 32-bit x86 system image here, and release ships ARM only |
| iOS                           | reSIDfp, SIDLite              | Web Audio           | CI build only                                                   |
| Desktop and mobile browsers   | reSIDfp, SIDLite              | Web Audio           | Playwright (Chromium); the WASM core against the real module under Node |
| Docker web deployment         | reSIDfp, SIDLite              | Web Audio           | CI image smoke tests                                            |

## Equivalence of the renderers

`tools/sid-engines/run_matrix.py` renders the same tunes through all three renderers (libSidplayEZ
through the same `EzSession` the app uses, the WASM ones through the same calls the worker makes) and
compares each with reSIDfp: start offset, level, envelope correlation, chroma similarity (which
notes are sounding), third-octave balance and stereo layout. On the tone ladder libSidplayEZ and
reSIDfp produce the same pitch for every note (median −0.8 cents, identical per note) and the same
note lengths.

### How libSidplayEZ was made to match reSIDfp

The renderers share an emulator ancestry but not their analogue tuning, so libSidplayEZ was first
measured as it ships and then configured to match reSIDfp, which is the "Accurate" renderer and
the reference here:

- **Analogue model.** A coordinate-descent sweep over every 6581 parameter libSidplayEZ exposes,
  scored against reSIDfp renders of the 6581 probe tunes, the eight demo tunes and eight HVSC tunes
  (cost: band error + 4 × (1 − envelope r) + 4 × (1 − chroma) + 0.5 × |level|, averaged). The
  facade's neutral profile scored 0.981; filter curve 0.5, filter gain 1.0 and waveform DC offset
  1.5 score 0.553, and no other parameter moved the score by more than 0.002, so those keep their
  neutral values. The 6581 filter probe's band error, over the sweep's 20 s renders, fell from 1.58 dB to
  0.05 dB (0.09 dB over the 30 s renders below).
- **External filter.** reSIDfp's DC blocker is 10 kΩ into 10 µF (1.6 Hz); libSidplayEZ defaults to
  1 kΩ (15.9 Hz). The session uses 10 kΩ.
- **8580 volume-register samples.** libsidplayfp-wasm enables `digiBoost`, which drives the 8580's
  EXT IN pin; libSidplayEZ has no such setting and played these samples 9 dB quieter. The patch
  adds one, and the level that gives reSIDfp's loudness (−16700; libSidplayEZ scales the input
  differently from reSIDfp's −32768) puts the 8580 digi probe at +0.06 dB.
- **Start-up declick.** Until a tune's first note, libSidplayEZ re-seated the DC blocker on every
  volume or filter write, so volume steps before the first note were silent for up to 15 s. reSIDfp
  and the C64 play them; the patch makes the declick switchable and the session turns it off.
- **Stereo placement** of two and three chips, as described under the wrapper above.

Each of these was found by a probe tune and is held by the CI check below.

### Reading the measures

The reference renders reSIDfp from libsidplayfp-wasm's power-on state (8191 cycles). The
"reSIDfp, other power-on" rows render reSIDfp again from 5002 cycles, the delay libSidplayEZ
uses: they show how far each measure moves when nothing changes but the start-up phase. The
envelope correlation in particular depends on oscillator phase in some tunes: on Commando reSIDfp
against itself scores between 0.60 and 0.90 across power-on delays, so libSidplayEZ's 0.61 there
is within reSIDfp's own spread, while chroma (0.99) and band error (0.10 dB) show the same notes
and timbre.

Differences that remain, and why:

- libSidplayEZ discards the audio of a tune's init routine, so most tunes start 10–50 ms earlier;
  of the 36 rows below, three start at the same time and two 10 ms later.
- Three chips play as a centred mix (stereo r 1.00 against reSIDfp's 0.88–0.97).
- Notes retriggered faster than their envelope completes differ in their first samples (the
  envelope probe's chroma is 0.86 against reSIDfp's self-variation of 0.98).

### CI check

`tools/sid-engines/run_matrix.py --tunes fixtures --check tools/sid-engines/tolerances.json`
renders the tone ladder, the demo tunes and the 14 probe tunes from
`tools/sid-engines/make_probe_sids.py` through all three renderers in about three minutes and
fails on any measure outside `tools/sid-engines/tolerances.json`. Renders are deterministic, so a
value moves only when an engine or its configuration changes. Every override in that file states
its reason. The Android CI job runs it as `:app:checkSidRendererEquivalence`, and the same file
holds the HVSC set when the check is run locally with `--tunes default`.

### Measurements

30 s of each tune at 48 kHz, PSIDs with the 8580 as fallback model, the KERNAL and BASIC ROMs
supplied for the BASIC tune. Offset is positive when the render starts later than reSIDfp.

| Tune | Covers | Renderer | Offset (ms) | Level (dB) | Envelope r | Chroma | Band error (dB) | Stereo r (reSIDfp) |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| tone-ladder | tone ladder (PSID, undeclared model) | reSIDfp, other power-on | -10 | +0.00 | 0.984 | 0.999 | 0.00 | 1.00 (1.00) |
| tone-ladder |  | libSidplayEZ | -20 | +0.03 | 0.964 | 0.974 | 0.02 | 1.00 (1.00) |
| tone-ladder |  | SIDLite | +20 | +1.68 | 0.940 | 0.969 | 1.33 | 1.00 (1.00) |
| demo: Blue Screen Waltz | demo tune (PSID 6581) | reSIDfp, other power-on | -10 | +0.01 | 0.983 | 0.998 | 0.03 | 1.00 (1.00) |
| demo: Blue Screen Waltz |  | libSidplayEZ | -10 | -0.07 | 0.978 | 0.997 | 0.16 | 1.00 (1.00) |
| demo: Blue Screen Waltz |  | SIDLite | +0 | -0.52 | 0.975 | 0.987 | 0.91 | 1.00 (1.00) |
| demo: Commander March | demo tune (PSID 6581) | reSIDfp, other power-on | -10 | -0.01 | 0.973 | 0.998 | 0.01 | 1.00 (1.00) |
| demo: Commander March |  | libSidplayEZ | -30 | -0.03 | 0.923 | 0.993 | 0.02 | 1.00 (1.00) |
| demo: Commander March |  | SIDLite | +10 | -0.33 | 0.944 | 0.984 | 0.20 | 1.00 (1.00) |
| demo: Datasette Dreams | demo tune (PSID 6581) | reSIDfp, other power-on | -10 | -0.00 | 0.990 | 0.998 | 0.02 | 1.00 (1.00) |
| demo: Datasette Dreams |  | libSidplayEZ | -10 | -0.09 | 0.989 | 0.998 | 0.23 | 1.00 (1.00) |
| demo: Datasette Dreams |  | SIDLite | +0 | -0.65 | 0.984 | 0.989 | 1.07 | 1.00 (1.00) |
| demo: Kernal Panic | demo tune (PSID 6581) | reSIDfp, other power-on | -10 | -0.01 | 0.849 | 0.997 | 0.03 | 1.00 (1.00) |
| demo: Kernal Panic |  | libSidplayEZ | -10 | -0.06 | 0.838 | 0.995 | 0.15 | 1.00 (1.00) |
| demo: Kernal Panic |  | SIDLite | +10 | -0.37 | 0.795 | 0.980 | 0.75 | 1.00 (1.00) |
| demo: Loading Screen | demo tune (PSID 6581) | reSIDfp, other power-on | -10 | -0.00 | 0.979 | 0.997 | 0.08 | 1.00 (1.00) |
| demo: Loading Screen |  | libSidplayEZ | -20 | +0.05 | 0.944 | 0.994 | 0.10 | 1.00 (1.00) |
| demo: Loading Screen |  | SIDLite | +10 | -0.33 | 0.912 | 0.988 | 0.58 | 1.00 (1.00) |
| demo: Raster Bar Rag | demo tune (PSID 6581) | reSIDfp, other power-on | -10 | +0.00 | 0.967 | 0.999 | 0.03 | 1.00 (1.00) |
| demo: Raster Bar Rag |  | libSidplayEZ | -10 | -0.08 | 0.955 | 0.997 | 0.13 | 1.00 (1.00) |
| demo: Raster Bar Rag |  | SIDLite | +10 | -0.61 | 0.898 | 0.981 | 1.19 | 1.00 (1.00) |
| demo: Ready Prompt | demo tune (PSID 6581) | reSIDfp, other power-on | -10 | +0.00 | 0.982 | 0.998 | 0.02 | 1.00 (1.00) |
| demo: Ready Prompt |  | libSidplayEZ | -10 | -0.07 | 0.978 | 0.997 | 0.16 | 1.00 (1.00) |
| demo: Ready Prompt |  | SIDLite | +0 | -0.50 | 0.979 | 0.980 | 1.72 | 1.00 (1.00) |
| demo: Sprite Collision | demo tune (PSID 6581) | reSIDfp, other power-on | -10 | +0.00 | 0.961 | 0.999 | 0.05 | 1.00 (1.00) |
| demo: Sprite Collision |  | libSidplayEZ | -10 | -0.02 | 0.952 | 0.998 | 0.04 | 1.00 (1.00) |
| demo: Sprite Collision |  | SIDLite | +0 | -0.55 | 0.895 | 0.971 | 1.00 | 1.00 (1.00) |
| digi-6581 | probedigi-6581 | reSIDfp, other power-on | +0 | -0.01 | 0.983 | 0.958 | 0.04 | 1.00 (1.00) |
| digi-6581 |  | libSidplayEZ | -20 | +0.49 | 0.955 | 0.990 | 0.04 | 1.00 (1.00) |
| digi-6581 |  | SIDLite | +10 | -1.73 | 0.763 | 0.996 | 0.51 | 1.00 (1.00) |
| digi-8580 | probedigi-8580 | reSIDfp, other power-on | +0 | -0.01 | 0.984 | 0.958 | 0.03 | 1.00 (1.00) |
| digi-8580 |  | libSidplayEZ | -20 | +0.06 | 0.959 | 0.990 | 0.03 | 1.00 (1.00) |
| digi-8580 |  | SIDLite | +20 | +4.49 | 0.767 | 0.996 | 0.43 | 1.00 (1.00) |
| envelopes | probeenvelopes | reSIDfp, other power-on | -10 | -0.00 | 0.963 | 0.978 | 0.03 | 1.00 (1.00) |
| envelopes |  | libSidplayEZ | -20 | +0.01 | 0.954 | 0.861 | 0.02 | 1.00 (1.00) |
| envelopes |  | SIDLite | +20 | +1.85 | 0.923 | 0.864 | 0.42 | 1.00 (1.00) |
| filter-6581 | probefilter-6581 | reSIDfp, other power-on | -10 | -0.00 | 0.984 | 1.000 | 0.00 | 1.00 (1.00) |
| filter-6581 |  | libSidplayEZ | -10 | +0.53 | 0.953 | 0.978 | 0.09 | 1.00 (1.00) |
| filter-6581 |  | SIDLite | +20 | +1.96 | 0.585 | 0.822 | 1.51 | 1.00 (1.00) |
| filter-8580 | probefilter-8580 | reSIDfp, other power-on | -10 | +0.00 | 0.993 | 1.000 | 0.00 | 1.00 (1.00) |
| filter-8580 |  | libSidplayEZ | -20 | -0.29 | 0.972 | 0.939 | 0.08 | 1.00 (1.00) |
| filter-8580 |  | SIDLite | +10 | +1.58 | 0.931 | 0.968 | 0.90 | 1.00 (1.00) |
| multispeed | probemultispeed | reSIDfp, other power-on | +0 | -0.00 | 0.999 | 0.999 | 0.01 | 1.00 (1.00) |
| multispeed |  | libSidplayEZ | -20 | +0.03 | 0.997 | 0.981 | 0.00 | 1.00 (1.00) |
| multispeed |  | SIDLite | +20 | +1.84 | 0.996 | 0.979 | 0.17 | 1.00 (1.00) |
| ntsc | probentsc | reSIDfp, other power-on | -10 | -0.01 | 0.966 | 0.999 | 0.00 | 1.00 (1.00) |
| ntsc |  | libSidplayEZ | -10 | +0.01 | 0.973 | 0.997 | 0.00 | 1.00 (1.00) |
| ntsc |  | SIDLite | +40 | +1.89 | 0.839 | 0.974 | 0.24 | 1.00 (1.00) |
| rsid-irq | probersid-irq | reSIDfp, other power-on | +0 | -0.02 | 0.967 | 0.998 | 0.03 | 1.00 (1.00) |
| rsid-irq |  | libSidplayEZ | +0 | +0.00 | 0.966 | 0.995 | 0.03 | 1.00 (1.00) |
| rsid-irq |  | SIDLite | +20 | +1.88 | 0.916 | 0.987 | 0.23 | 1.00 (1.00) |
| three-sid | probethree-sid | reSIDfp, other power-on | -10 | +0.00 | 0.990 | 1.000 | 0.00 | 0.97 (0.97) |
| three-sid |  | libSidplayEZ | -20 | -0.89 | 0.961 | 0.992 | 0.42 | 1.00 (0.97) |
| three-sid |  | SIDLite | +20 | +1.76 | 0.944 | 0.977 | 0.87 | 0.94 (0.97) |
| two-sid | probetwo-sid | reSIDfp, other power-on | -10 | +0.00 | 0.988 | 1.000 | 0.00 | 0.85 (0.85) |
| two-sid |  | libSidplayEZ | -20 | -0.23 | 0.964 | 0.994 | 0.18 | 0.85 (0.85) |
| two-sid |  | SIDLite | +20 | +1.58 | 0.920 | 0.982 | 0.80 | 0.83 (0.85) |
| volume-steps-6581 | probevolume-steps-6581 | reSIDfp, other power-on | -10 | +0.00 | 0.942 | 1.000 | 0.00 | 1.00 (1.00) |
| volume-steps-6581 |  | libSidplayEZ | -10 | +0.48 | 0.826 | 0.999 | 0.00 | 1.00 (1.00) |
| volume-steps-6581 |  | SIDLite | +30 | -1.78 | 0.665 | 0.993 | 0.40 | 1.00 (1.00) |
| volume-steps-8580 | probevolume-steps-8580 | reSIDfp, other power-on | -10 | +0.00 | 0.940 | 1.000 | 0.00 | 1.00 (1.00) |
| volume-steps-8580 |  | libSidplayEZ | -10 | +0.06 | 0.821 | 0.999 | 0.00 | 1.00 (1.00) |
| volume-steps-8580 |  | SIDLite | +30 | +4.46 | 0.657 | 0.993 | 0.40 | 1.00 (1.00) |
| waveforms-6581 | probewaveforms-6581 | reSIDfp, other power-on | -10 | +0.01 | 0.995 | 1.000 | 0.00 | 1.00 (1.00) |
| waveforms-6581 |  | libSidplayEZ | -10 | -0.01 | 0.989 | 0.995 | 0.04 | 1.00 (1.00) |
| waveforms-6581 |  | SIDLite | +20 | -0.48 | 0.867 | 0.930 | 0.24 | 1.00 (1.00) |
| waveforms-8580 | probewaveforms-8580 | reSIDfp, other power-on | -10 | +0.01 | 0.979 | 1.000 | 0.00 | 1.00 (1.00) |
| waveforms-8580 |  | libSidplayEZ | -20 | +0.02 | 0.966 | 0.994 | 0.00 | 1.00 (1.00) |
| waveforms-8580 |  | SIDLite | +20 | +1.88 | 0.918 | 0.985 | 0.27 | 1.00 (1.00) |
| Commando | PSID 6581, single speed | reSIDfp, other power-on | -10 | +0.01 | 0.906 | 0.999 | 0.03 | 1.00 (1.00) |
| Commando |  | libSidplayEZ | -10 | -0.12 | 0.609 | 0.989 | 0.10 | 1.00 (1.00) |
| Commando |  | SIDLite | +10 | -0.63 | 0.475 | 0.980 | 0.61 | 1.00 (1.00) |
| Cybernoid_II | PSID 6581, filter-heavy | reSIDfp, other power-on | -10 | +0.00 | 0.904 | 1.000 | 0.01 | 1.00 (1.00) |
| Cybernoid_II |  | libSidplayEZ | -10 | -0.15 | 0.812 | 0.996 | 0.23 | 1.00 (1.00) |
| Cybernoid_II |  | SIDLite | +10 | +2.15 | 0.583 | 0.974 | 1.42 | 1.00 (1.00) |
| A_Trace_of_Space | PSID 6581, modern player | reSIDfp, other power-on | -10 | -0.00 | 0.968 | 1.000 | 0.00 | 1.00 (1.00) |
| A_Trace_of_Space |  | libSidplayEZ | -20 | -0.04 | 0.885 | 0.999 | 0.05 | 1.00 (1.00) |
| A_Trace_of_Space |  | SIDLite | +20 | +0.39 | 0.784 | 0.995 | 0.23 | 1.00 (1.00) |
| Ad_Astra | PSID 8580 | reSIDfp, other power-on | -10 | +0.00 | 0.964 | 1.000 | 0.00 | 1.00 (1.00) |
| Ad_Astra |  | libSidplayEZ | -10 | -0.13 | 0.931 | 0.999 | 0.08 | 1.00 (1.00) |
| Ad_Astra |  | SIDLite | +20 | +1.77 | 0.854 | 0.995 | 0.35 | 1.00 (1.00) |
| Wizball#4 | PSID, CIA multispeed, subsong 4 | reSIDfp, other power-on | +0 | -0.01 | 0.932 | 1.000 | 0.04 | 1.00 (1.00) |
| Wizball#4 |  | libSidplayEZ | -20 | -0.09 | 0.937 | 0.997 | 0.15 | 1.00 (1.00) |
| Wizball#4 |  | SIDLite | +0 | +3.08 | 0.730 | 0.965 | 1.67 | 1.00 (1.00) |
| Master_of_the_Lamps | RSID NTSC | reSIDfp, other power-on | +0 | +0.17 | 0.922 | 0.993 | 0.26 | 1.00 (1.00) |
| Master_of_the_Lamps |  | libSidplayEZ | +0 | -0.12 | 0.905 | 0.993 | 0.23 | 1.00 (1.00) |
| Master_of_the_Lamps |  | SIDLite | +0 | +1.90 | 0.693 | 0.909 | 1.22 | 1.00 (1.00) |
| Arkanoid | RSID, sample playback | reSIDfp, other power-on | -10 | +0.00 | 0.963 | 1.000 | 0.00 | 1.00 (1.00) |
| Arkanoid |  | libSidplayEZ | +10 | +0.02 | 0.946 | 0.999 | 0.07 | 1.00 (1.00) |
| Arkanoid |  | SIDLite | +0 | -1.25 | 0.966 | 0.976 | 1.18 | 1.00 (1.00) |
| Storebror | RSID, 8-bit digi | reSIDfp, other power-on | +10 | -0.00 | 0.982 | 1.000 | 0.00 | 1.00 (1.00) |
| Storebror |  | libSidplayEZ | +10 | -0.28 | 0.952 | 0.998 | 0.12 | 1.00 (1.00) |
| Storebror |  | SIDLite | +10 | +3.99 | 0.926 | 0.974 | 0.52 | 1.00 (1.00) |
| Phat_Frog_2SID | 2SID 8580 | reSIDfp, other power-on | -10 | +0.00 | 0.959 | 0.999 | 0.03 | 0.82 (0.82) |
| Phat_Frog_2SID |  | libSidplayEZ | -10 | -0.16 | 0.852 | 0.997 | 0.11 | 0.82 (0.82) |
| Phat_Frog_2SID |  | SIDLite | +20 | +1.93 | 0.718 | 0.977 | 0.71 | 0.84 (0.82) |
| A_Walk_in_the_Countryside_3SID | 3SID 8580 | reSIDfp, other power-on | -10 | +0.00 | 0.987 | 0.999 | 0.00 | 0.88 (0.88) |
| A_Walk_in_the_Countryside_3SID |  | libSidplayEZ | -10 | +1.01 | 0.969 | 0.998 | 0.65 | 1.00 (0.88) |
| A_Walk_in_the_Countryside_3SID |  | SIDLite | +10 | +2.59 | 0.958 | 0.995 | 0.67 | 0.88 (0.88) |
| Air | PSID NTSC | reSIDfp, other power-on | +0 | -0.00 | 1.000 | 1.000 | 0.01 | 1.00 (1.00) |
| Air |  | libSidplayEZ | -40 | -0.11 | 0.987 | 0.996 | 0.16 | 1.00 (1.00) |
| Air |  | SIDLite | +0 | +0.09 | 0.988 | 0.930 | 0.23 | 1.00 (1.00) |
| Polonaise_BASIC | RSID BASIC (needs BASIC ROM) | reSIDfp, other power-on | +0 | -0.06 | 0.958 | 0.985 | 0.15 | 1.00 (1.00) |
| Polonaise_BASIC |  | libSidplayEZ | +0 | +0.01 | 0.956 | 0.974 | 0.11 | 1.00 (1.00) |
| Polonaise_BASIC |  | SIDLite | +30 | -0.77 | 0.915 | 0.915 | 0.96 | 1.00 (1.00) |
| Tusari#10 | PSID, 14 subsongs, subsong 10 | reSIDfp, other power-on | +0 | +0.03 | 0.818 | 0.960 | 0.11 | 1.00 (1.00) |
| Tusari#10 |  | libSidplayEZ | -50 | +0.06 | 0.762 | 0.959 | 0.09 | 1.00 (1.00) |
| Tusari#10 |  | SIDLite | +10 | +1.67 | 0.628 | 0.928 | 0.32 | 1.00 (1.00) |

## Performance

All figures were measured on a Pixel 4 (Snapdragon 855, Android 16, WebView 150) with
`tools/sid-engines/android-playback.mjs`, which plays Rob Hubbard's Commando through a real
`LocalSidEngine` at volume 0 (`window.__localSidProbe`). "Before" is `main` at 81f9db756 with the
same probe added; "after" is this branch. Each run plays 30 s, during which the engine also fills
its 20 s look-ahead, so every run renders the same 50 s of audio. CPU is the user and system time
of the app process plus the WebView renderer process, read from `/proc`; the idle app costs about
1.2 s per 30 s. Event-loop lag is how late a 50 ms timer fires on the page's thread.

Release-configured builds (R8-minified, not debuggable; WebView debugging switched on for the
measurement only):

| Build  | Renderer     | CPU for the run | Open   | First position | Event-loop lag mean / p95 / max |
| ------ | ------------ | --------------: | -----: | -------------: | ------------------------------- |
| before | reSIDfp      | 27.7 s          | 1710 ms | 2748 ms       | 1.6 / 12.1 / 77 ms              |
| before | SIDLite      | 13.6 s          | 156 ms | 659 ms         | 2.5 / 18.8 / 78 ms              |
| after  | libSidplayEZ | 10.8 s          | 490 ms | 991 ms         | 0.4 / 0.3 / 63 ms               |
| after  | reSIDfp      | 23.3 s          | 1485 ms | 1988 ms       | 0.5 / 0.6 / 92 ms               |
| after  | SIDLite      | 9.3 s           | 177 ms | 677 ms         | 0.6 / 0.6 / 110 ms              |

The new default costs 61% less CPU than the previous default (reSIDfp in the previous release),
reaches the speaker 1.8 s sooner, and leaves the page's thread free: the p95 lag fell from 12 ms to
0.3 ms because no PCM is handled in JavaScript any more. The WASM renderers also got cheaper (16%
and 32%) because their PCM now crosses once as a binary message, instead of being converted to float and
back with the gain applied and then base64-encoded on the page's thread.

Steady state, once the look-ahead is full and libSidplayEZ renders in real time (release, per
thread over 15 s): the libSidplayEZ render thread uses 12.5% of one core, the `AudioTrack` writer
2.9%, the page's thread 2.0% and the feed 0.9%. The emulation is about 80% of the app's CPU.

Seeking to 60 s from 30 s in, with no pre-render running (release): libSidplayEZ landed after
7.0 s, SIDLite after 4.5 s, and reSIDfp had not landed 20 s later, in both builds. A seek renders
every cycle up to the target, as libsidplayfp-wasm's own seek does; on the Play page the engine
answers seeks from the whole-tune pre-render as soon as that has passed the target, and
libSidplayEZ renders at about nine times real time on this phone.

Debuggable builds, same workload: before reSIDfp 31.4 s, SIDLite 17.8 s; after libSidplayEZ
16.1 s, reSIDfp 26.7 s, SIDLite 12.4 s. CheckJNI and the restricted JIT of a debuggable app make
the Kotlin and JNI parts look about 1.5 times dearer than they are.

On the host (x86_64, one core): libSidplayEZ renders 56 ms per second of audio, reSIDfp in WASM
about 150 ms, SIDLite about 30 ms. A tune open costs about 190 ms (310 ms for 2SID), almost all
of it the power-on warm-up that libSidplayEZ emulates before the tune starts; the filter tables
are built once per process (97 ms for the first player, 1.3 ms after).

What was tried, measured and kept or rejected:

- **Kept:** native rendering and output without JavaScript in the sample path; one binary message
  per WASM chunk; registering the binary port during plugin load (the earlier posted registration
  crashed WebView 150 on every launch); a plain copy in `AudioPipeline` when the ratio is exactly 1,
  which it always is for on-device playback at the output rate because drift correction is off there; stopping
  the feed's silence scan once a slice is known not to be silent.
- **Rejected, no measurable gain:** `-O3` against `-O2` (1%), ThinLTO (2%), profile-guided
  optimisation (between −8% and +4% across runs, output bit-identical), `--icf=all` (2% smaller).
  The emulation's hot loop is the SID's per-cycle clock, which these do not change.
- **Rejected, accuracy:** rendering without the resampler or the analogue filters while seeking,
  and a shorter resampler kernel. Both would change the output reSIDfp produces.

APK size (release, both ARM ABIs): 7,957,720 bytes before, 8,367,175 after (+409 KB). Each ABI's
`libc64sidplayez.so` is about 190 KB compressed, so a per-ABI download from an app bundle grows by
about 200 KB. One library contains both chip models.

## Testing

| Layer                    | Where                                                                                     | What it covers                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| libSidplayEZ engine      | `android/app/src/main/cpp/sidplayez/tests/engine_test.cpp` (plain, ASan/UBSan)             | PSID/RSID parsing and rejection, song selection, 6510 arithmetic and addressing, VIC/CIA play rates, pitch on PAL and NTSC at four output rates, envelope, filter, test bit, chip models, mixer placement for 2 and 3 SIDs, jam detection, determinism, save/restore, HVSC MD5s |
| JNI session wrapper      | `…/tests/ez_session_test.cpp` (plain, ASan/UBSan, TSan)                                   | invalid input, determinism, seek by skip, fallback model not forced, 2SID and 3SID stereo placement, RSID, concurrent sessions, repeated create/destroy |
| JNI from the JVM         | `SidplayEzNativeTest.kt`                                                                  | the real library through every entry point, destroyed ids, bounds, concurrency |
| Native renderer          | `SidplayEzRendererTest.kt`                                                                | chunk continuity, seek equivalence, pre-render slices, cancellation, disposal |
| Native feed              | `LocalAudioFeedTest.kt`, `LocalAudioFeedTranscriptTest.kt`, `PcmStoreTest.kt`, `SidAudioPortTest.kt` | ordering, backpressure, flush, pause, supersession, gain, fades, crossfade mixing and tail recovery, silence, stall watchdog; replayed engine transcripts with gap and overlap checks |
| Contract                 | `tests/unit/playback/sidRenderer/*.test.ts`                                               | the dispatcher's rules; the WASM core against the real `libsidplayfp-wasm`; the libSidplayEZ core and channel; availability; payloads, cache and release |
| Engine and sink          | `localSidEngineRenderers.test.ts`, `localSidNativeSink.test.ts`, `localSidTransitionContinuity.test.ts` and the existing engine suites | renderer choice and channels, native payloads through scheduler and cache, buffer release, the sink controller, the crossfade handshake recorded for the native replay |
| Equivalence              | `tools/sid-engines/run_matrix.py --check tools/sid-engines/tolerances.json` (CI: `checkSidRendererEquivalence`) | the three renderers compared on the repository's tunes in CI, and on HVSC tunes locally, against recorded tolerances |
| Probe tunes and tools    | `tools/sid-engines/tests/` (pytest; CI)                                                   | each probe tune's register writes under a small 6502 interpreter, the committed copies against the generator, the comparison measures on signals with known answers, the tolerance check |
| Hardware                 | `tools/hil/merge_gate.mjs` (`sid-local`, `crossfade`, …), `tools/sid-engines/android-bench.mjs` | playback on the Pixel 4; the crossfade graded from the pipeline's own capture |
| Hardware, per renderer   | `tools/hil/renderer_feature_matrix.mjs`                                                    | the gate's local playback stages, the playback parity scenarios and the release sweep's Wi-Fi-off and screen-off stages, once per renderer, failing on any tune opened on another renderer |
| Hardware, accuracy       | `tools/hil/renderer_accuracy_hil.mjs`, graded by `tools/hil/renderer_accuracy.py` (pytest)  | each renderer's PCM on the phone against a host render by the same renderer, and its microphone take against the C64's and against reSIDfp's on the same speaker |

Run the native suites with `cd android && ./gradlew testLibSidplayEzNative`; the JVM tests build and
load the host library automatically (`buildLibSidplayEzHost`). `npm run test:sid-engines` runs the
native suites, the equivalence check and the tool tests together; the equivalence check needs
`node_modules` and NumPy.

## Limitations

- libSidplayEZ is Android only. iOS would need the same library built for iOS and an audio feed
  of its own.
- A WebView without ArrayBuffer `postMessage` support falls back to base64 for WASM PCM.
- WASM PCM still crosses the main thread once per chunk, because the binary port is bound to the
  page and not to workers.
- libSidplayEZ upstream defects are documented and, except D3, not patched (see above).
- The keypad handset the `c64u-remote` variant targets is not available; the Pixel 4 stands in.

## Troubleshooting

- **Fast & accurate is missing from Settings on Android.** Read the log line "SID renderers probed":
  it names why (the library did not load, or an x86 CPU without SSE4.1).
- **WASM playback costs more JS time than expected.** Check `__localSinkDebug()` in the WebView for
  `binaryPort: 1`; 0 means the port was not confirmed and base64 is in use.
- **A tune plays silence.** `SidAudio.stats({serial})` reports `silentFault`, `reopens`,
  `missingSegments` and `queuedFrames`; a growing `missingSegments` means chunks referenced native
  buffers that had already been released.
