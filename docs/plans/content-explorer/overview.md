# Content Explorer — Master Plan

**Status:** Draft / planning
**Scope:** A coherent, feature-flagged initiative that adds six additive capabilities.
**Owner:** TBD

> This revision is grounded in the concrete device-firmware behaviour each
> capability depends on (endpoints, wire formats, byte layouts, timings), so the
> build can go straight to implementation without re-deriving the protocol. The
> firmware details live in §7 (Firmware surface reference) and the per-capability
> deep-dives; the capability sections below stay at the design-decision level.

---

## 1. Motivation

C64 Commander is strong at *operating* a device. Three shaped gaps remain:

1. **A disk image is opaque.** We mount a `.d64`, rotate multi-disk groups, and
   DMA-autostart the *first* program (`src/lib/playback/diskFirstPrg.ts`). A
   compilation disk with 40 programs, or a demo disk whose payload is the third
   file, is a dead end without mounting and hand-driving the C64.

2. **Search stops at the disk boundary.** `src/lib/media-index/mediaIndex.ts`
   stores one opaque entry per disk. A program that only exists *inside* a `.d64`
   is unfindable.

3. **We can point the device's streams somewhere but never watch or hear them.**
   The Home "streams" section (`src/lib/config/homeStreams.ts`,
   `streamStatus.ts`) only configures *where* the device streams VIC/audio; the
   app renders neither. Separately, a direct-memory launch on a machine with a
   freezer cartridge configured can hard-reset into the cartridge menu, which
   reads as a bug.

---

## 2. The six capabilities

| # | Capability | Feature flag | Extends |
|---|-----------|--------------|---------|
| A | **Disk Explorer** — list a disk's directory; Run / Load / Mount & Load any single file | `disk_explorer_enabled` | `diskFirstPrg.ts`, `playbackRouter.ts`, `HomeDiskManager.tsx` |
| B | **Launch Safety** — park the `Cartridge` config item around direct launches (+ optional boot-menu answer for Mount & Load) | `launch_safety_enabled` | `playbackRouter.ts`, config query, `kernalFallbackInjector.ts` |
| C | **In-Image Search** — index & search files *inside* disk images | `in_image_search_enabled` | `mediaIndex.ts`, source browse |
| D | **Audio Mirror** — receive and play the device audio stream in-app (+ optional audio recording) | `audio_mirror_enabled` | `homeStreams.ts`, `src/lib/native/*`, web server |
| E | **Video Mirror** — render the VIC stream to a canvas (+ optional video/combined recording), CPU-budgeted | `video_mirror_enabled` | as D + a decode/render path |
| F | **New Disk** — create a formatted blank image on the device | `new_disk_enabled` | `c64api.ts`, `HomeDiskManager.tsx` |

**Deliberately split D and E.** The device exposes video and audio as **two
independent firmware streams** (`/v1/streams/video`, `/v1/streams/audio`), so we
mirror them independently. **Audio is the cheap, high-value case** and gets its
own flag, on-by-default-eligible even on low-power targets. **Video is the
expensive case** (≈5.2 M pixels/s to decode and blit at 50 fps) and gets a
separate flag, default-off on constrained hardware. See §5 for the
Callback 8020 performance budget.

**Reset-key automation is not a standalone capability.** Auto-pressing a key
after a reset only helps one narrow situation: a machine configured with a
cartridge that shows a boot menu on reset (e.g. a freezer cart), where Mount &
Load's typed `LOAD` would otherwise be swallowed by that menu. It is therefore
an **optional, off-by-default sub-behaviour of B**, surfaced only next to Launch
Safety, not a headline feature. Users who don't run such cartridges never see it.

---

## 3. Design principles

1. **Additive, never destructive.** No existing play/mount/autostart path changes
   behaviour when a flag is off. B is the only capability that wraps an existing
   flow, and it is an exact no-op when disabled or when there is no cartridge to
   park.

2. **Feature-flagged rollout.** Each capability gets one flag in
   `src/lib/config/feature-flags.yaml`, compiled by
   `scripts/compile-feature-flags.mjs`. Ship `developer_only` → `experimental` →
   `stable`, exactly as `commoserve_enabled` / `ram_snapshots_enabled` were staged.

3. **Reuse before adding.** The disk geometry, directory-sector walk, sector-chain
   reader, DMA loader, and autostart injector already exist in `diskFirstPrg.ts`.
   The mount write-back model, FTP client, config query layer, the keyboard-buffer
   injector, `ItemSelectionDialog`, `SelectableActionList`, and Device Safety
   throttle all already exist. New modules orchestrate existing pieces.

4. **Platform abstraction where the platform differs.** Anything needing a raw
   socket (Audio/Video Mirror) follows the established `foo.ts` (native) /
   `foo.web.ts` (web) split under `src/lib/native/`, matching `deviceDiscovery.ts`
   / `.web.ts` and `backgroundExecution.ts` / `.web.ts`.

5. **Respect Device Safety.** New device traffic (in-image scanning, stream
   start/stop) goes through the existing throttle/serialization in
   `deviceSafetySettings.ts` and the FTP concurrency limiter.

6. **Bounded work on mobile.** Scanning/searching is always scoped (from a chosen
   folder down) and time-budgeted with a Stop control. Video decoding is
   frame-throttleable and can be turned off entirely, independent of audio.

---

## 4. Capability specs

Each subsection is a summary; the per-capability doc carries the concrete
algorithm, byte layout, endpoint, and edge cases.

### A. Disk Explorer → [`01-disk-explorer.md`](./01-disk-explorer.md)

Open any `.d64` / `.d71` / `.d81` and act on an individual program:

- **Run** — extract the program's sector chain and DMA-run it (`POST
  /v1/runners:run_prg`, wrapped by Launch Safety), with the existing BASIC-vs-ML
  autostart logic.
- **Load** — DMA-load only, no autostart, via `POST /v1/runners:load_prg` (a
  firmware endpoint we don't call yet). For monitors / dev work.
- **Mount & Load** — mount the whole image, `PUT /v1/machine:reset`, wait for
  BASIC (~2.8 s), then inject `LOAD"<name>",<bus>,1` + `RUN` through the existing
  keyboard-buffer injector, for multi-load titles.

The anchor change is generalizing `diskFirstPrg.ts`'s "find the first PRG" walk
into a full directory lister that reads **all eight entries per sector** (the
current code's `2 + i*32` slice silently drops the 8th entry — see the deep-dive).
Disk bytes are parsed locally from the blob we already fetch to mount, so listing
and extracting cost **zero** new device round-trips.

**Footprint:** 1 new parser module (refactored from `diskFirstPrg.ts`), 1
launcher module, 1 play-plan variant, disk-contents UI. **Effort: Medium.**

### B. Launch Safety → [`02-launch-safety.md`](./02-launch-safety.md)

A one-function wrapper that reads the current `C64 and Cartridge Settings /
Cartridge` value, sets it to empty for the duration of a direct-memory launch,
and restores it in a `finally`. Config changes apply only at the next reset and
flash is never written, so the launched program runs with the cartridge parked
and a power-cycle undoes any worst case. Wrap the `sid`/`mod`/`prg`/disk-DMA
cases in `executePlayPlan`; **exempt `crt`**. Category/item strings already exist
in `menuMapping/c64u-1.1.0.generated.ts`.

Includes the optional Mount & Load **boot-menu answer** (the folded-in reset-key
behaviour): off by default; when enabled, a configurable key (F1–F8/RETURN/SPACE)
is injected a short delay after reset and before the `LOAD` keystrokes.

**Footprint:** 1 tiny wrapper + call-site wrapping + 1–2 settings. **Effort: Low.
Highest value-to-effort item.**

### C. In-Image Search → [`03-in-image-search.md`](./03-in-image-search.md)

Extend the media index so a disk carries child entries for the programs inside
it, keyed by **disk path + size + mtime** so a rewritten disk supersedes its old
children automatically. A "search inside disk images" toggle matches child names;
hits render as `DISKNAME → PROGRAM` and are actionable through A's Run/Load.
Scanning is scoped, time-budgeted, and paced by Device Safety.

**Footprint:** media-index schema bump (v1→v2) + scan extension + search toggle.
**Effort: Medium (depends on A's parser).**

### D. Audio Mirror → [`04-live-mirror.md`](./04-live-mirror.md) (§ Audio)

Receive the device audio stream (`/v1/streams/audio`, UDP, 16-bit stereo,
47983 Hz) and play it via WebAudio, with a clear connection state and an optional
**audio-only** recording. Cheap enough for constrained hardware; this is the
first-class half of mirroring.

**Footprint:** stream receiver (platform-split) + a small audio player + Home
control. **Effort: Low–Medium.**

### E. Video Mirror → [`04-live-mirror.md`](./04-live-mirror.md) (§ Video)

Receive the VIC stream (`/v1/streams/video`, UDP, 384×272 @ 4 bpp, 50 fps),
decode 4 bpp → RGBA via a 16-entry palette LUT, and blit to a canvas, with a
"not connected" state and optional video/combined recording. **Independent flag,
default-off on low-power devices**, frame-throttleable, integer-scaled by the
GPU. Web build first; native receiver behind a capability check.

**Footprint:** as D + a decode/render module + Screen UI. **Effort: Medium (web)
/ High (native).**

### F. New Disk → [`05-new-disk.md`](./05-new-disk.md)

Create a formatted blank image on the device via `PUT
/v1/files/<folder>/<name>:create_d64` (and `create_d71` / `create_d81` /
`create_dnp`), with a 16-char disk label; D64 accepts 35–41 tracks, DNP requires a
track count. A "New disk" dialog in Disks, then mount the result. (Endpoint now
confirmed against the device API; no longer a TODO.)

**Footprint:** 1 api method + 1 dialog. **Effort: Low.**

---

## 5. Callback 8020 / low-power performance budget

The Callback 8020 target (see `docs/plans/callback8020`) is CPU-constrained.
Mirroring must degrade gracefully:

- **Audio and video are separately switchable** at the source: we start/stop
  `/v1/streams/audio` and `/v1/streams/video` independently, so audio can run
  with video never started. Default on constrained devices: audio available,
  video off.
- **Video cost is the decode+blit**, ≈384×272×50 ≈ 5.2 M px/s. Mitigations, in
  order: (a) don't start the video stream at all (audio-only); (b) frame-throttle
  — render every Nth received frame; (c) keep the decode to a single
  `Uint32Array` palette-LUT write per pixel (no per-pixel branching) and a single
  `putImageData`; (d) decode at native 384×272 and let CSS/GPU integer-scale, so
  CPU cost is fixed regardless of display size.
- **Recording tiers:** audio-only recording is cheap and always offered; video /
  combined recording is offered only where video decoding is viable.
- **Capability gating:** default `video_mirror_enabled` off on constrained
  targets; use platform + `navigator.hardwareConcurrency` as a hint to choose the
  default and the throttle factor. Audio Mirror has no such gate.

---

## 6. Cross-cutting architecture

### New/changed modules

```
src/lib/disks/diskImage.ts            NEW  geometry + readSector + readChain + listDirectory
src/lib/playback/diskLaunch.ts        NEW  loadDiskEntryViaDma / mountAndLoad (Run/Load/Mount&Load any file)
src/lib/playback/launchSafety.ts      NEW  withCartridgeParked (+ optional boot-menu answer)
src/lib/streams/audioStream.ts        NEW  UDP audio de-packetize + WebAudio player (D)
src/lib/streams/vicStream.ts          NEW  UDP VIC de-packetize + 4bpp→RGBA palette decode (E)
src/lib/native/streamSocket.ts/.web.ts NEW platform UDP receiver (D/E)
src/lib/playback/diskFirstPrg.ts      EDIT delegate primitives to diskImage.ts (behaviour unchanged)
src/lib/playback/playbackRouter.ts    EDIT wrap DMA cases in withCartridgeParked; handle disk-file plan
src/lib/media-index/mediaIndex.ts     EDIT snapshot v2 + child entries + in-image scan (C)
src/lib/c64api.ts                     EDIT add loadPrgUpload(), createDisk()
src/lib/config/feature-flags.yaml     EDIT add 6 flags (+ regenerate)
web/server, proxy/server.mjs          EDIT UDP→WS bridge (D/E web path)
```

### Feature flags (add to `feature-flags.yaml`, then regenerate)

`disk_explorer_enabled`, `in_image_search_enabled`, `launch_safety_enabled`,
`audio_mirror_enabled`, `video_mirror_enabled`, `new_disk_enabled` — each starting
`developer_only: true` in `experimental`, promoted per §8. `video_mirror_enabled`
additionally defaults **off** on constrained targets even once `stable`.

### Settings surface

- **Device Safety → Compatibility** (new subsection): Launch Safety toggle;
  optional boot-menu answer (key + delay) for Mount & Load.
- **Disks page:** disk-contents view (A); New Disk action (F).
- **Browse / media search:** "inside disk images" toggle (C).
- **Home / new Screen surface:** Audio Mirror control (D); Video Mirror control (E).

---

## 7. Firmware surface reference

The endpoints and wire formats every capability relies on. All are the device's
own `/v1` REST API, the port-64 command socket, and the UDP stream formats.

### REST

| Purpose | Call |
|---------|------|
| DMA run + autostart | `POST /v1/runners:run_prg` (multipart `file`) |
| DMA load, no run | `POST /v1/runners:load_prg` (multipart `file`) — **not yet used by the app** |
| Run cartridge | `POST /v1/runners:run_crt` (multipart) |
| Mount (upload) | `POST /v1/drives/{a\|b}:mount` (multipart) `?mode=readonly\|readwrite\|unlinked[&type=]` |
| Mount (device path) | `PUT /v1/drives/{a\|b}:mount?image=<path>&mode=…` |
| Reset / reboot | `PUT /v1/machine:reset` \| `:reboot` |
| Read/write a config item | `GET`/`PUT /v1/configs/{category}/{item}?value=…` |
| Cartridge item | category `C64 and Cartridge Settings`, item `Cartridge` |
| Start/stop a stream | `PUT /v1/streams/{video\|audio}:start?ip=<host:port>` \| `:stop` |
| Create blank disk | `PUT /v1/files/<folder>/<name>:create_d64?diskname=<≤16>&tracks=<35-41>` (also `create_d71` / `create_d81` / `create_dnp?tracks=1-255`) |

Notes: the firmware wants `%20` (not `+`) in query strings; quote the whole path.
The top-level `/` is a virtual device list and cannot hold files — require a real
folder (e.g. `USB0`) for create. The load-address for autostart decisions is the
first two bytes of the PRG (little-endian); `$0801` implies BASIC.

### Port-64 command socket (low-latency fallback)

Frame = `<u16 opcode><u16 payloadLen>` + payload (little-endian). Opcodes:
`KEYB 0xFF03` (payload = PETSCII bytes), `RESET 0xFF04`, `STREAM_ON 0xFF20 + id`,
`STREAM_OFF 0xFF30 + id` (id: video 0, audio 1; STREAM_ON payload = `u16 duration`
(0 = forever) + dest ASCII). The app already injects keys via the KERNAL buffer
over REST (`kernalFallbackInjector`); the socket path is only needed as a
start-stream fallback on older firmware.

### UDP stream formats

**Video** (default port 11000): 12-byte header
`<u16 seq><u16 frame><u16 lineRaw><u16 width><u8 linesPerPacket><u8 bpp><u16 enc>`
then payload. `line = lineRaw & 0x7FFF`; last-line-of-frame flag = `lineRaw &
0x8000`. Full frame = 384×272 @ 4 bpp = **52224 bytes**; payload for a line group
is written at byte offset `line * (384/2) = line * 192`. A frame is complete when
the last-line flag is seen (~68 packets/frame, ~780 bytes each).

**Audio** (default port 11001): `u16 seq` then interleaved stereo **S16LE**, 192
stereo frames per packet (768 bytes; ~770-byte packets). Sample rate **47983 Hz**.
Batch ~8 packets (~32 ms) before handing to the player.

**4 bpp decode:** each frame byte is two pixels — low nibble is the left pixel,
high nibble the right. 16-entry VIC palette (RGB):

```
000000 FFFFFF 68372B 70A4B2 6F3D86 588D43 352879 B8C76F
6F4F25 433900 9A6759 444444 6C6C6C 9AD284 6C5EB5 959595
```

Build a `Uint32Array(16)` LUT once (byte order per platform endianness), then the
per-frame inner loop is two LUT writes per byte plus one `putImageData`. The VIC
border colour can be sampled from a border pixel to tint the surrounding UI.

---

## 8. Phasing

| Phase | Ships | Flag state | Rationale |
|-------|-------|-----------|-----------|
| 1 | **B Launch Safety** | experimental → stable | Smallest; pure correctness; no new UI surface |
| 2 | **A Disk Explorer** | experimental | Anchor capability; unlocks C |
| 3 | **C In-Image Search** | experimental | Reuses A's parser |
| 4 | **D Audio Mirror** | experimental | Cheap, high value, de-risks the stream infra for E |
| 5 | **F New Disk** | experimental → stable | Small, independent |
| 6 | **E Video Mirror (web)** → **(native)** | experimental → developer_only | Largest; web first; native gated + CPU-budgeted |

Each phase is independently revertible by its flag.

---

## 9. Testing strategy

Follow the established layers (`docs/plans/tests`, existing specs):

- **Unit** — the directory lister (all-eight-entries, type decode, block count,
  circular-chain + short-sector guards); arbitrary sector-chain extraction incl.
  the last-sector byte-count rule; `withCartridgeParked` park/restore incl.
  restore-on-throw; media-index v1→v2 migration + supersede-on-mtime-change;
  4 bpp→RGBA decode against a known frame; audio de-interleave.
- **Playwright** — `diskManagement.spec.ts` (disk contents + Run/Load),
  `playback.spec.ts` (launch-safety wrapping on a mock device), a new in-image
  search spec, and Audio/Video Mirror web specs against a synthetic stream.
- **Mock (`src/lib/mock`)** — a multi-file `.d64`, a device reporting a configured
  `Cartridge` value, and synthetic VIC/audio UDP fixtures.
- **Maestro** — smoke flows: "open disk → run the third file"; "hear audio";
  "record a short audio clip".

---

## 10. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Refactoring `diskFirstPrg.ts` regresses first-PRG autostart | Keep its public function; delegate to `diskImage.ts`; existing tests stay green unchanged |
| Cartridge park/restore leaves the device parked if the app dies mid-run | `finally` restore; config-only (no flash write) so a power-cycle restores; documented |
| Video decode overwhelms a weak CPU | Separate flag, default-off on constrained targets; audio-only mode; frame throttle; fixed-cost native-res decode + GPU scale |
| In-image scan overwhelms a weak device over FTP | Device Safety throttle; scoped + time-budgeted with Stop; mtime cache avoids re-reads |
| Native UDP receiver balloons | Ship web mirror first; native behind a capability flag, audio path before video |
| Feature-flag sprawl | Six flags, staged and documented here; promote and eventually retire |

---

## 11. Companion documents

See the table in [`README.md`](./README.md). The deep-dives —
[`01-disk-explorer.md`](./01-disk-explorer.md),
[`02-launch-safety.md`](./02-launch-safety.md),
[`03-in-image-search.md`](./03-in-image-search.md),
[`04-live-mirror.md`](./04-live-mirror.md),
[`05-new-disk.md`](./05-new-disk.md) — carry the concrete algorithms and byte
layouts summarized here.
