# 04 — Live Mirror: Audio (D) & Video (E)

**Capabilities D and E** of the [Content Explorer](./overview.md) initiative.
**Feature flags:** `audio_mirror_enabled`, `video_mirror_enabled`
**Status:** Audio Mirror implemented behind `audio_mirror_enabled` (experimental, off by default); Video Mirror behind `video_mirror_enabled` (developer-only, off by default).

> **As-built (shipped).** The receive-and-play stack landed as planned:
> `src/lib/streams/vicDecode.ts` (4bpp→RGBA palette LUT), `vicStream.ts` / `audioStream.ts`
> (de-packetize), `audioPlayer.ts` (WebAudio scheduling), `streamReceiver.ts` (platform
> receiver seam), and `audioMirrorController.ts` / `videoMirrorController.ts`, with the
> `useAudioMirror` / `useVideoMirror` hooks and the `AudioMirrorPanel` / `VideoMirrorPanel`
> components (Listen/Stop, Off/Connecting/Live/Error state, dropped-packet and fps
> readouts). `audio_mirror_enabled` is user-visible; `video_mirror_enabled` stays
> developer-only pending the native UDP receiver plugin.
>
> **Surface.** Both mirror panels are mounted on **Home**, below the existing streams
> section, each behind its own flag and `deviceCapabilities.supportsStreaming`: `AudioMirrorPanel`
> (Listen/Stop, Off/Connecting/Live state, dropped-packet health) under `audio_mirror_enabled`,
> and `VideoMirrorPanel` (native-res canvas, frame-throttle, fps) under `video_mirror_enabled`.
> Because Video Mirror is developer-only it is intentionally absent from the generated user
> manual (matching the `lighting_studio` convention); the manual documents Audio Mirror only.
> The web path consumes a UDP→WebSocket bridge (`streamReceiver.web` seam); the native UDP
> receiver plugin is the remaining follow-up (`UnsupportedStreamReceiver` fallback until then).
>
> **Reconciled with c64stream (the authoritative native reference).** After reviewing
> `github.com/chrisgleissner/c64stream` (`src/network/c64-protocol.h`, `src/video/c64-video.c`),
> the wire-format details were corrected against it:
> - **Palette** now uses the device-accurate "C64 Ultimate Default Palette"
>   (`c64stream data/palettes/default.vpl`), not the plan's §4 generic VIC-II table, so in-app
>   video matches the machine / OBS. White is `#F7F7F7`, red `#8D2F34`, etc.
> - **PAL/NTSC** are both handled: frame height is derived from the last packet
>   (`line + lines_per_packet`) and clamped to `[240, 272]`; the canvas re-sizes to 272 (PAL) or
>   240 (NTSC). Exact audio rates are PAL `47982.8869 Hz` / NTSC `47940.3408 Hz` (was a rounded
>   47983). Audio-only mode assumes PAL (no video packets to detect from).
> - **Packet validation** matches c64stream: width 384, **4 lines/packet, 4 bpp** (was
>   `linesPerPacket != 0`).
> - **Ports** stay the real defaults **11000 (video) / 11001 (audio)** and are now
>   **configurable** in Settings (`c64u_stream_video_port` / `_audio_port`) — c64stream's
>   21000/21001 are test-only.
> Deliberately NOT ported from c64stream (kept simple for an in-app monitor, not an OBS-grade
> pipeline): the network jitter buffer, audio concealment/gap-fill, GPU CRT effects, and
> file recording (the plan's optional §5 recording remains a follow-up).

> Goal: hear and (optionally) see the running machine inside the app. The device
> exposes **two independent streams** — audio and video — so we mirror them
> independently. **Audio is the cheap, first-class case.** **Video is the
> expensive, optional case**, budgeted for the low-power Callback 8020 target.

---

## 1. Why the split is first-class, not cosmetic

Today the Home "streams" section (`src/lib/config/homeStreams.ts`,
`streamStatus.ts`) only tells the *device* where to send VIC/audio; the app
renders neither. This initiative adds the receive-and-play side.

Audio and video are separate firmware streams with separate start/stop:

```
PUT /v1/streams/audio:start?ip=<host:port>     PUT /v1/streams/audio:stop
PUT /v1/streams/video:start?ip=<host:port>     PUT /v1/streams/video:stop
```

So **audio can run while video is never started** — no wasted CPU decoding frames
a constrained device can't afford. Two flags, two controls, two independent
lifecycles. Default on a constrained target: audio available, video off.

Rough cost: audio is ≈192 KB/s of PCM to schedule; video is **≈5.2 M pixels/s**
(384×272×50) to decode and blit. That asymmetry is the whole reason for the split.

---

## 2. Platform architecture (native/web split)

Receiving UDP needs a real socket, so follow the established
`foo.ts` (native) / `foo.web.ts` (web) pattern under `src/lib/native/`:

```
src/lib/native/streamSocket.ts       native UDP receiver (Capacitor plugin surface)
src/lib/native/streamSocket.web.ts    web: connects to the app server's UDP→WS bridge
src/lib/streams/audioStream.ts        de-packetize audio → PCM frames (platform-agnostic)
src/lib/streams/vicStream.ts          de-packetize video → assembled 4bpp frame (platform-agnostic)
src/lib/streams/vicDecode.ts          4bpp → RGBA palette LUT (platform-agnostic)
web/server, proxy/server.mjs          UDP→WebSocket bridge for the web/Docker build
```

- **Web/Docker:** the app server binds the two UDP ports and bridges datagrams to
  the client over WebSocket; the client de-packetizes and plays/renders. No
  server-side transcoding.
- **Native:** a small platform plugin receives UDP and hands datagrams (or
  assembled frames/PCM) to the same de-packetizers. Gate native behind a
  capability check; ship the web path first.

**Stream destination.** On start, set the device's stream target to this
receiver's `host:port`. On web the host is the server; on native it's the device's
own view of the app host (the app already resolves a local-IP-toward-device style
address for other features). Start via `PUT /v1/streams/{name}:start?ip=…`; on
older firmware fall back to the port-64 command socket (`STREAM_ON 0xFF20+id`,
payload `u16 duration=0` + dest ASCII). Multicast is possible (join a group
instead of a unicast target) but is an optional later refinement.

---

## 3. Audio Mirror (D) — the wire format and player

### Packet format (`/v1/streams/audio`, default UDP 11001)

```
u16 seq (LE) │ interleaved stereo S16LE samples …
```

192 stereo frames per packet → 768 bytes of PCM (≈770-byte packets). **Sample
rate 47983 Hz.** Track `seq` gaps for a dropped-packet count / health badge.

### De-packetize + play

`audioStream.ts` strips the 2-byte seq, appends PCM to a batch, and hands a batch
to the player about every ~32 ms (≈8 packets) to bound latency without
per-packet overhead.

Player (WebAudio), the proven scheduling:

```ts
const ctx = new AudioContext();       // 47983 Hz source; ctx resamples to its own rate
let nextT = 0;
function playChunk(pcm: ArrayBuffer) {
  const i16 = new Int16Array(pcm);
  const frames = i16.length >> 1;               // stereo interleaved
  if (!frames) return;
  const buf = ctx.createBuffer(2, frames, 47983);
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  for (let k = 0; k < frames; k++) { L[k] = i16[2*k] / 32768; R[k] = i16[2*k+1] / 32768; }
  const src = ctx.createBufferSource();
  src.buffer = buf; src.connect(ctx.destination);
  const t = Math.max(ctx.currentTime + 0.08, nextT);   // ~80 ms lead-in for gapless playback
  src.start(t); nextT = t + frames / 47983;
}
```

- **Latency vs smoothness** is the `+0.08` lead-in; expose a "low latency / smooth"
  choice if needed, but 80 ms is a good default.
- **Connection state** — off / connecting / live (+ chunk rate) / reconnecting /
  error, from `seq` continuity and socket state; mirror the existing stream-status
  vocabulary.
- On native, an alternative is to play PCM through a native audio sink instead of
  WebAudio; the de-packetizer is shared either way.

### Cost

This is cheap: one `createBuffer` + a de-interleave loop per ~32 ms. Suitable for
the Callback 8020. **Audio Mirror has no CPU gate.**

---

## 4. Video Mirror (E) — the wire format, decode, and budget

### Packet format (`/v1/streams/video`, default UDP 11000)

12-byte header then payload:

```
u16 seq │ u16 frame │ u16 lineRaw │ u16 width │ u8 linesPerPacket │ u8 bpp │ u16 enc │ payload…
```

- `line = lineRaw & 0x7FFF`; **last-line-of-frame** flag = `lineRaw & 0x8000`.
- Full frame = **384×272 @ 4 bpp = 52224 bytes**.
- Payload for a line group is written at byte offset `line * (384/2) = line * 192`.
- A frame is complete when the last-line flag is seen (~68 packets/frame).
- Guard: ignore packets whose `width != 384` or `linesPerPacket == 0`; bound the
  write to the 52224-byte frame buffer.

`vicStream.ts` assembles datagrams into a frame buffer and emits a full 52224-byte
frame on the last-line flag.

### 4 bpp → RGBA decode (`vicDecode.ts`)

Each frame byte is **two pixels**: low nibble = left pixel, high nibble = right.
16-entry VIC palette (RGB):

```
000000 FFFFFF 68372B 70A4B2 6F3D86 588D43 352879 B8C76F
6F4F25 433900 9A6759 444444 6C6C6C 9AD284 6C5EB5 959595
```

Build a `Uint32Array(16)` LUT once (respect the platform's byte order — on
little-endian the ImageData word is `0xAABBGGRR`), then the per-frame inner loop
is branch-free:

```ts
const px = new Uint32Array(imageData.data.buffer);   // 384*272
for (let i = 0, p = 0; i < frame.length; i++) {
  const b = frame[i];
  px[p++] = LUT[b & 15];    // left pixel
  px[p++] = LUT[b >> 4];    // right pixel
}
ctx2d.putImageData(imageData, 0, 0);
```

Optional nicety: sample a VIC **border** pixel (offset `(4*384 + 4)`) and tint the
surrounding UI to match the running program's border.

### Callback 8020 / low-power budget (the point of the separate flag)

Video is the expensive capability. Degrade in this order:

1. **Don't start it.** With `video_mirror_enabled` off (default on constrained
   targets), the video stream is never requested — zero cost. Audio still works.
2. **Frame-throttle.** Render every Nth assembled frame (e.g. 25 or 12.5 fps).
   Keep receiving so the buffer stays current, but blit less often. Expose a
   frame-rate cap.
3. **Fixed-cost decode.** The inner loop above is one LUT write per pixel and one
   `putImageData` per rendered frame — no per-pixel branching, no allocation. Keep
   it that way.
4. **Native-res canvas + GPU scale.** Always decode to a 384×272 canvas and let
   CSS/`image-rendering: pixelated` integer-scale it. CPU cost is independent of
   display size; the GPU does the zoom.
5. **Default heuristics.** Choose the default enabled-state and throttle from
   platform + `navigator.hardwareConcurrency`; a 2-core phone defaults to video
   off / heavy throttle, a desktop to full rate.

### Not-connected state

Before the first frame, after Stop, or on socket drop, paint a clear
"not connected" panel rather than freezing the last frame; note whether audio is
still connected (the two are independent).

---

## 5. Recording (tiered by cost)

Use the browser `MediaRecorder` (web) with format fallback. Three modes:

- **Audio only** — cheap, always offered when Audio Mirror is live. Formats:
  `audio/webm;codecs=opus`, fallback `audio/mp4;codecs=mp4a.40.2`.
- **Video only / Combined** — offered only when Video Mirror is viable. Formats:
  `video/webm;codecs=vp9|vp8(,opus)`, or `video/mp4;codecs=avc1.42E01E(,mp4a.40.2)`
  where supported. Capture the canvas stream (+ the audio node for combined).

Probe support with `MediaRecorder.isTypeSupported` and pick the first available
mime for the chosen mode; disable formats the browser can't do. Recording is
local; no server transcoding. On the Callback 8020, expect audio-only to be the
practical recording mode.

---

## 6. Controls & settings

- **Audio Mirror control** (Home / Screen surface): Start/Stop audio, connection
  state + chunk rate, Record (audio). Independent of video.
- **Video Mirror control:** Start/Stop video, connection state + fps, frame-rate
  cap, display scale, Record (video/combined). Behind `video_mirror_enabled`,
  default-off on constrained targets.
- **Transport (advanced):** unicast (default) vs multicast group; per-stream, in
  Settings.
- Pairs naturally with the existing **Remote Input** so a user can watch/hear and
  drive the machine together.

---

## 7. Test plan

- **Unit** — audio de-packetize (seq strip, batch boundary) and de-interleave to
  L/R; video frame assembly (line offset math, last-line completion, width guard);
  `vicDecode` against a known 52224-byte frame → known RGBA (incl. endianness).
- **Web integration (Playwright)** — a synthetic UDP source (or the bridge fed
  fixtures) drives the audio player (assert scheduled buffers) and the canvas
  (assert a decoded pixel); "not connected" state on stop.
- **Perf smoke** — video decode loop stays within a frame budget on a throttled
  CPU profile; frame-throttle reduces blits as configured.
- **Mock** — synthetic VIC/audio packet generators in `src/lib/mock`.

---

## 8. Phasing within Live Mirror

1. **Stream infra + Audio Mirror (D)** — de-risks receive/bridge; ships value on
   every device including the Callback 8020.
2. **Video Mirror web (E)** — decode/render/record on the web build.
3. **Video Mirror native (E)** — native UDP receiver plugin, capability-gated and
   CPU-budgeted.
