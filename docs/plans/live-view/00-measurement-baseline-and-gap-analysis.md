# Live View streaming — measurement baseline, pipeline map & gap analysis

**Status:** investigation / design-decision record (DDR). Not a completion claim.
**Date:** 2026-07-24 · **Branch:** `feat/content-explorer`
**Scope of this document:** the mandated "measure the existing implementation first" phase
(spec §4, §19 steps 1–4, §21) for the Ultimate 64 audio/video Live View streaming pipeline.
The full task specification is in [`live-stream-performance-optimization.md`](./live-stream-performance-optimization.md).

This DDR records **what actually exists today, measured**, maps the complete pipeline, states an
explicit latency budget, and gives an evidence-backed gap analysis against the specification —
including one **decisive physical finding** that changes the shape of the whole task. It exists so
that no subsequent structural change is made on assumption, and so that the honest completion state
(which requirements are met, which are red, which are externally blocked) is legible.

---

## 0. Decisive finding first (read this before anything else)

**The spec's headline gate — `audio_e2e_latency_p99 < 30 ms` and `video_e2e_latency_p99 < 30 ms`,
proven source-to-presentation on real Pixel 4 → Ultimate 64 hardware (§1.3, §16.1) — is not
achievable with the current firmware + transport + WebView architecture, and for video it is not
achievable in principle by any app-side change.** This is already measured and documented by the
project's own HIL harness; it is not a new regression.

Evidence (`tools/hil/README.md`, committed 2026-07-23, Pixel 4 → C64U fw 1.2.0, PAL, Wi-Fi):

| Metric                     | Measured on hardware                                     |
| -------------------------- | -------------------------------------------------------- |
| A/V offset (signed P99)    | within ±30 ms (video wire-lags audio ~36 ms, consistent) |
| Interactive press→see P99  | **~200 ms**                                              |
| Interactive press→hear P99 | ~110 ms                                                  |

The `<30 ms` targets are **perfect-network** figures, asserted deterministically only by the
mocked-C64 E2E — **not** on hardware. The real source→display floor is set by components the app
cannot remove:

- **C64U video capture buffering ~1–2 frames** (≈20–40 ms PAL) — inside the firmware, before a
  single UDP packet leaves the device.
- **VIC frame reassembly** — one frame is ~68 UDP datagrams; the frame is not presentable until the
  last-line packet arrives.
- **Multicast Wi-Fi transit + jitter** on a consumer phone radio.
- **WebView decode + canvas blit + display compositor** on the presentation end.
- **Audio player path batches ~32 ms in WebAudio by design** (`AudioBatcher`), plus the 5 ms jitter
  buffer and WebAudio scheduling — the _player_ audio path alone already exceeds a 30 ms budget
  (the _analyzer_ path is per-packet and does not).

**Consequence for the task:** a literal §16.1 gate cannot be turned green on hardware without (a) a
native low-latency audio path (Oboe/AudioTrack, tiny buffers) _and_ (b) a native GPU render path (no
base64/bridge/canvas) — and even then video stays floored by the firmware's own capture buffering,
which is a **firmware/hardware floor, not an app defect** (cf. the documented pattern where a c64u
symptom was wrongly attributed to the app and a "fix" reverted). The honest target the app _can_
own and prove is: **bounded, non-growing local-pipeline latency + continuous A/V + correct
concealment**, with e2e reported and labelled accurately (spec §12.1 explicitly allows a truthful
"Local pipeline latency" label when true source→display is unavailable). Any claim that the 30 ms
source→display gate is "met" on this hardware would be false. See §6 and §8 below.

---

## 1. Measured baseline (2026-07-24)

- **Deterministic unit tests:** `tests/unit/streams/**` + stream hooks/components — **184 tests,
  19 files, all green**, 7.84 s (`npx vitest run tests/unit/streams/ …`). Includes:
  - `avSyncLoss.test.ts` — A/V offset P99 < 30 ms under **15 % UDP loss** on both streams.
  - `vicTestPattern.test.ts` — every frame of a long PAL and an NTSC stream delivered byte-exact,
    zero frame loss.
  - `audioTimeline.test.ts` — PLC play/drop/conceal/resync, wraparound, DC-safe/step-free fills.
  - `videoMirrorController.test.ts` — zero frame loss clean, exact count when frames dropped.
- **Hardware present and reachable right now:** Pixel 4 (`9B081FFAZ001WX`, model `flame`) over ADB;
  C64U at `192.168.1.148`, 1 ms RTT. So a live HIL run is _possible_ this session (it is not yet a
  CI build gate — see §7).
- **Existing HIL harness:** `tools/hil/av_sync_hil.py` (CDP-driven, real phone), representative
  fw 1.2.0 numbers above. `scripts/measure-live-view-fps.sh` captures the plugin's per-second
  `progression` logcat line into a CSV for before/after fps A/B.

---

## 2. Complete pipeline map (spec §4)

```
Ultimate 64 (firmware)
  VIC frame gen + capture buffer (~1–2 frames)  ─┐
  SID audio gen                                  ├─ source clock = C64U
  UDP multicast emission (video 239.0.1.64:11000, audio 239.0.1.65:11001)
        │  ~68 datagrams/frame video (~3400 pkt/s PAL) · ~250 pkt/s audio
        ▼
  Wi-Fi / LAN  (loss, jitter, reorder, dup)
        ▼
┌──────────────────────── NATIVE (Android, Kotlin) — StreamUdpPlugin.kt ───────────────────────┐
│ MulticastSocket per stream (video/audio), reuseAddr, joinGroup on site-local NIC,             │
│ WifiManager.MulticastLock (non-refcounted).                                                   │
│ Thread: one per socket from Executors.newCachedThreadPool() — DEFAULT priority (see gap G1).  │
│ Recv loop: DatagramPacket(2048) alloc per iteration; wire-arrival stamp = System.nanoTime()   │
│   captured immediately after socket.receive() (before any encode/bridge).                     │
│ Two modes:                                                                                     │
│  • per-packet ('datagram'): Base64.encodeToString per packet → notifyListeners (bridge).      │
│    Used for AUDIO always, and video when native assembly off.                                 │
│  • native assembly ('videoframe', bind assemble:true): reassembles ~68 line-datagrams into    │
│    one 52224-byte 4bpp frame on the receive thread (thread-confined, no lock), then           │
│    Base64.encodeToString(whole frame) → ONE bridge hop per FRAME (~50/s).                      │
│ Sequence accounting: 16-bit seq gap → dropped; frame-number gap → lost. Per-sec 'progression' │
│   Log.i (fps/pkts/dropped/lost). NO native queue (forwards inline), NO recv-buf sizing,       │
│   NO age bound, NO backpressure. (gaps G1–G4)                                                  │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
        │  Capacitor bridge: base64 string per event  (audio ~250/s · video ~50/s frame OR ~3400/s pkt)
        ▼
┌──────────────────────── TypeScript (WebView) ────────────────────────────────────────────────┐
│ streamReceiver.ts: Native/WebSocket/Unsupported. base64→Uint8Array per event.                 │
│                                                                                                │
│ VIDEO  videoMirrorController.ts                                                                │
│   onFrame (native) OR onDatagram→VicStreamAssembler (JS). frameStartByNum map keyed by frame  │
│   number (reorder-safe), bounded FRAME_START_CAP=12. frameThrottle = STATIC decimation (Nth    │
│   frame). Rolling 1 s fps. renderFrame sink → canvas (WebView). No governor. (gap G5)          │
│                                                                                                │
│ AUDIO  audioMirrorController.ts                                                                │
│   onDatagram → parseAudioPacket → AudioPlaybackBuffer (jitter buffer: bounded queue,          │
│   wrap-aware reorder, delayMs default 5, wire-clock drain, drainAll on stop, maxQueue cap)    │
│   → AudioTimeline (PLC: play/drop/conceal/resync, hold-last-sample fade+ramp, exact counts,   │
│   concealed≠received) → AudioBatcher (~32 ms) → AudioMirrorPlayer (WebAudio                    │
│   AudioBufferSourceNode scheduling). Separate RAW per-packet feed → AvSyncAnalyzer +          │
│   AvLatencyTracker (measurement integrity — analyzer never sees concealed fill).              │
│                                                                                                │
│ MEASURE  avSync.ts (wire-clock audio↔video pop offset) · avLatency.ts (press→see/hear +       │
│   wire offset, JS observe clock). Clocks: native = nanoTime ms; web = performance.now().       │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Per-stage ownership / bounds (the §4 table, condensed to what is verified in code)

| Stage                    | Thread                             | Queue                 | Bounded by size  | Bounded by age | Alloc/copy                                | Stale-session clear               |
| ------------------------ | ---------------------------------- | --------------------- | ---------------- | -------------- | ----------------------------------------- | --------------------------------- |
| Native recv (per stream) | 1 cached-pool thread, DEFAULT prio | none (inline forward) | n/a              | **no**         | DatagramPacket/iter + Base64 String/event | socket close on `close()`/destroy |
| Native VIC assembly      | same recv thread                   | 1 reused frame buffer | yes (1)          | **no**         | 1 Base64 String/frame; arraycopy/line     | frame state reset per frame       |
| Bridge                   | Capacitor                          | Capacitor internal    | Capacitor        | no             | base64 string marshalling                 | —                                 |
| TS video assembler       | JS main                            | `frameStartByNum` map | yes (cap 12)     | **no**         | Uint8Array/event                          | `reset()` on start/stop           |
| TS audio jitter buf      | JS main                            | `queue`               | yes (`maxQueue`) | ~delayMs (5)   | conceal alloc only                        | `reset()`/`drainAll()`            |
| TS audio PLC             | JS main                            | none (state machine)  | n/a              | n/a            | conceal fill packet                       | `reset()`                         |
| Audio batcher            | JS main                            | ~32 ms accumulator    | yes              | ~32 ms         | 1 Int16Array/batch                        | `reset()`                         |
| WebAudio player          | browser audio thread               | AudioContext graph    | browser          | browser        | AudioBuffer/chunk                         | `stop()` releases                 |

---

## 3. What already satisfies the spec (with evidence — do NOT rebuild)

- **Deterministic audio PLC (§8):** `audioTimeline.ts` is a faithful c64stream port — bounded state,
  produces exact output sample count, hold-last-sample fade→silence + 128-sample ramp into the next
  real packet (DC-safe, step-free, tested below the click threshold), distinguishes concealed from
  received (`stats.concealed`/`packetsLost`). Covered by `audioTimeline.test.ts` (13 cases). Meets
  most of §8/§8.1 **except**: it runs in JS on the WebAudio player thread, not a native RT callback,
  and click magnitude is asserted structurally, not via a committed spectral fixture.
- **Bounded audio jitter buffer + stale-session reset (§7.1/§7.8/§7.10 partial):** wrap-aware
  reorder within a bounded queue, wire-clock drain, `maxQueue` valve, `reset()`/`drainAll()`.
- **Sequence accounting distinguishes categories (§2):** audio → play/drop(dup/late)/conceal/resync;
  video → dropped packets vs lost frames (separate counters), not one generic "dropped".
- **Native frame assembly (§10.2 partial):** collapses ~68 bridge hops/frame into 1; hardware-proven
  ~50 fps PAL (memory: _live-view-fps-native-assembly_).
- **Measurement-integrity A/V offset (§5 partial):** wire-arrival stamp at earliest possible point,
  same clock both streams, analyzer fed the RAW stream so concealment can't be mistaken for a pop.
- **Frame-slot decimation exists (§11.1 partial):** `frameThrottle` (static N).
- **Real HIL driver exists (§14.5 partial):** `av_sync_hil.py` proves the pipeline end-to-end on a
  physical Pixel and prints real numbers.

---

## 4. Latency budget (spec §6) — target allocation + measured reality

Target p99 for the **local pipeline** (device-socket-receive → presentation), which is the portion
the app owns and can bound and prove deterministically:

| Segment                           | Target p99 | Owned by app? | Current status                                              |
| --------------------------------- | ---------: | ------------- | ----------------------------------------------------------- |
| socket receive + wire stamp       |      <1 ms | yes           | met (inline)                                                |
| reorder window (audio)            |      ≤5 ms | yes           | met (delayMs=5, bounded)                                    |
| frame assembly (video)            |      <2 ms | yes           | met (native, thread-confined)                               |
| concealment decision              |    <0.5 ms | yes           | met (state machine)                                         |
| A/V queue residence               |    bounded | yes           | audio bounded; **video render queue has no age bound (G4)** |
| conversion (base64↔bytes, decode) |      <5 ms | yes           | works; **not measured on weakest device (G3)**              |
| audio player buffering            |     ~32 ms | yes           | **WebAudio batch — exceeds a 30 ms budget by design (G6)**  |
| renderer/display present          |   ~1 frame | partly        | canvas blit; no present-time fence (G7)                     |

**Not owned by the app (the source→display floor):** C64U capture buffer (~20–40 ms) + multicast
Wi-Fi transit/jitter. These make a _literal_ 30 ms **source→display** gate unreachable regardless of
app changes (see §0).

Every queue must have a documented max-count, max-age-ms, overflow policy, and residence telemetry
(§6). **Today only max-count is enforced; max-age and residence telemetry are missing → gaps G4/G8.**

---

## 5. Gap analysis (mapped to spec)

| #   | Gap                                                                                                                                                                                                             | Spec                            | Provable without hardware?           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------ |
| G1  | Native recv threads run at DEFAULT priority; no `THREAD_PRIORITY_URGENT_AUDIO`/`_DISPLAY`; no socket `receiveBufferSize` → OS-buffer loss under pressure uncounted                                              | §10.3, §12.1(recv-buf pressure) | partial (Robolectric asserts config) |
| G2  | Full video frames still cross Capacitor as **Base64** — native assembly cut hop _count_, not the base64/bridge copy; §10.1 permits this **only with weakest-device CPU/latency evidence**, which does not exist | §10.1, §10.2, §22               | **no — needs Pixel-4 profiling**     |
| G3  | No CPU/allocation/copy profiling on the weakest device; no committed CPU ceilings                                                                                                                               | §1.4, §16.4, §14.3              | host: yes; device: **no**            |
| G4  | Video render path has **no queue-age bound** and **no "drop late, present newest"** rule; a renderer backlog can accumulate lag                                                                                 | §6, §7.6, §16.3                 | **yes**                              |
| G5  | No adaptive **governor** — only static `frameThrottle`. No Auto mode, no audio-driven demotion, no hysteresis, no requested-vs-effective exposure                                                               | §11 (all)                       | **yes** (logic + tests)              |
| G6  | Audio plays via **WebAudio (~32 ms batch)**, not native Oboe/AudioTrack; app does not own a real-time callback; `audio_callback_underruns` is a browser property, not measured                                  | §10.3, §16.2                    | **no — native path + device**        |
| G7  | No presentation-time fence (video) / playback-head timestamp (audio); latency uses enqueue/observe times, not §5.2/§5.3 hardware-present times                                                                  | §5.2, §5.3                      | **no — platform APIs on device**     |
| G8  | Telemetry is per-controller snapshots; no aggregated 2–5 Hz native telemetry, **no queue-residence percentiles**, no A/V-skew/drift-rate series                                                                 | §6, §13                         | **yes**                              |
| G9  | **No user-visible "Stats" screen**, no historical (1 s bucket / session) view, no charts, no diagnostic JSON export                                                                                             | §12 (all)                       | **yes** (UI + tests)                 |
| G10 | No **committed machine-readable perf thresholds** (latency/CPU/memory) with runner/warm-up/reps metadata                                                                                                        | §16, §21                        | **yes** (config + asserter)          |
| G11 | Deterministic source is the **A/V-pop** program (`av-sync-auto`); no **monotonic frame-ID + spatial pattern + audio-marker** source for source-to-display latency & frame-order detection                       | §15.1                           | needs a small C64 asm prg            |
| G12 | Replay tests are **generator-based**, not **versioned captures** with committed expected frame-slot/sample/concealment fixtures for each impairment profile                                                     | §14.2                           | **yes**                              |
| G13 | No **soak** test computing rolling p50/p95/p99 + latency-drift **slope** with a committed tolerance                                                                                                             | §7, §14.6                       | **yes** (deterministic soak)         |
| G14 | HIL is **manual**, not a **CI build gate** with hardware locking, precondition quarantine, infra-only retry, and machine-readable pass/fail                                                                     | §14.5, §17                      | **no — self-hosted runner**          |
| G15 | No reproducible **network-impairment** injector (seeded loss/burst/jitter/dup/reorder/delay) for HIL                                                                                                            | §15.2                           | tooling: yes; HIL wiring: no         |

---

## 6. Which completion-gate items (spec §23) are RED, and why

| §23 item                                                 | State                                                                                 | Blocker                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------- |
| 1–4 audio continuity / concealment / slot accounting     | **mostly green in unit tests**; not proven on hardware end-to-end                     | needs HIL wiring (G14) |
| 5 audio+video p99 e2e < 30 ms on hardware                | **RED / not physically achievable** for source→display video; audio needs native path | §0 floor + G6/G7       |
| 6 no progressive latency growth (soak)                   | **RED** — no soak/drift test                                                          | G13                    |
| 7 all queues bounded by size AND age                     | **partial** — size yes, age no (video)                                                | G4                     |
| 8–9 CPU below committed absolute & relative ceilings     | **RED** — no ceilings, no device profiling                                            | G3, G10                |
| 10–12 UI responsive / governor protects audio / recovery | **RED** — no governor                                                                 | G5                     |
| 13–14 Stats live+historical, low-overhead                | **RED** — no Stats screen                                                             | G9                     |
| 15–17 deterministic/replay/perf tests every build        | **partial** — deterministic yes; versioned replay + reproducible perf runner no       | G10, G12               |
| 18 Pixel-4↔U64 HIL every eligible build                  | **RED** — manual only                                                                 | G14                    |
| 19 build fails on regression                             | **RED** — no committed gates                                                          | G10                    |
| 20–22 committed / pushed / merge-ready PR                | pending real work                                                                     | —                      |

**This task cannot be honestly reported complete in one session.** It is a multi-phase program with
two hard external dependencies — a **self-hosted HIL CI runner** (§14.5/§17) and the **firmware
capture-buffer latency floor** (§0) — plus large net-new subsystems (native audio+render, governor,
Stats) that the spec itself forbids claiming "done" until HIL-proven.

---

## 7. Recommended phased plan (evidence-ordered, honest about what each phase can prove)

Ordered by the spec's own priority (§3: audio → bounded latency → responsiveness → video cadence),
and by _provability_ — do the things that can be proven on every build first.

**Phase 1 — Provable now, no hardware (turns several red gates green deterministically):**

1. Video **queue-age bound + "drop-late/present-newest"** rule and its no-drift invariant test (G4, §7.6).
2. **Governor** state machine (Auto/100/50/25, audio-fill-driven demotion, hysteresis, requested-vs-effective,
   anti-oscillation) as a pure, unit-tested class feeding `frameThrottle` (G5, §11) — deterministic
   tests satisfy §23.10–12 at the logic layer (hardware confirmation later).
3. **Aggregated telemetry + queue-residence percentiles + drift/skew series** as a bounded accumulator
   (G8, §13) and a **Stats** screen (compact+detail, 1 s/session history, lightweight charts, JSON export)
   (G9, §12) — component/unit tested; assert "Stats open" adds no per-frame work.
4. **Committed machine-readable thresholds** + host-runner asserter (G10, §16) and a **deterministic
   soak** computing rolling percentiles + drift slope with a committed tolerance (G13, §7/§14.6).
5. **Versioned replay fixtures** with expected slot/sample/concealment outputs per impairment profile (G12).

**Phase 2 — Needs the live hardware already attached (measure, don't assume — §10.1/§16.4):** 6. Profile the **base64-frame-over-bridge** path CPU/alloc/latency on the Pixel 4 (G2/G3) to decide,
_with evidence_, whether a native GPU render path (SurfaceView/GL) is justified — and only then build it. 7. Establish the honest **local-pipeline latency** measurement (labelled per §12.1) + document the
source→display floor (§0) with a quantified uncertainty (§5.1).

**Phase 3 — Needs standing infrastructure (genuine external blockers):** 8. Native low-latency **audio (Oboe)** + presentation/playback-head timestamps (G6/G7) — large, and its
value is gated on §0 (audio only, video stays floored). 9. **Self-hosted HIL CI runner** with hardware locking, precondition quarantine, seeded impairment
injector, infra-only retry, artifact archival, machine-readable gate (G11/G14/G15, §14.5/§15/§17).

Phase 1 is the correct first body of work: it is fully provable on every build, closes the largest
number of red gates, and follows the spec's audio-first / bounded-latency-first priority without
betting on unmeasured architecture changes.

---

## 8. Phase 1 — DELIVERED (2026-07-24)

The user accepted the honest reframe (§0) and selected the Phase-1 provable-now bundle **plus** the
Stats screen. The following shipped on this branch, each covered by deterministic tests that run on
every build (no hardware required). This closes the logic-layer of gaps G4, G5, G8, G9 and the audio
underrun/buffer signalling that G6/G7 telemetry needs.

| Module                                        | What it does                                                                                                                                                                                                                     | Gap              | Tests                                     |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------- |
| `src/lib/streams/streamGovernor.ts`           | Pure governor: Auto/100/50/25 → effective divisor; demote-fast on underrun / low buffer / latency / queue-age / frame-proc; promote-slow with stable-window + cooldown; requested-vs-effective + reason + bounded transition log | G5, §11          | `streamGovernor.test.ts` (18)             |
| `src/lib/streams/videoMirrorController.ts`    | Coalescing depth-1 present queue: presents the **newest** ready frame, drops superseded ones as **backlog replacements** (distinct from decimation and wire-loss); residence telemetry; runtime `setFrameThrottle`               | G4, §7.6/§9.1    | `videoMirrorController.test.ts` (+5 = 20) |
| `src/lib/streams/audioPlayer.ts`              | Exposes `bufferedMs` (headroom ahead of the audio clock) + `underrunCount` (player ran dry)                                                                                                                                      | G6/G7 signals    | `audioPlayerSignals.test.ts` (3)          |
| `src/lib/streams/streamTelemetry.ts`          | Bounded accumulator: 1-second rate buckets (ring, ~15 min), residence p50/p95/p99 reservoir, session summary, windowed views, JSON export                                                                                        | G8, §6/§12.2/§13 | `streamTelemetry.test.ts` (8)             |
| `src/lib/streams/avMirrorSession.ts`          | Owns governor + telemetry; timer-free `tick()`; separate Stats channel; `setFrameRateMode`; `exportDiagnostics`; clears stale state on fresh session (§7.10)                                                                     | wiring           | `avMirrorSessionStats.test.ts` (5)        |
| `src/hooks/useStreamStats.ts`                 | Drives `tick()` ~4 Hz while live; subscribes; persists mode                                                                                                                                                                      | G9               | `useStreamStats.test.tsx` (3)             |
| `src/components/streams/StreamStatsPanel.tsx` | User-visible **Stats** (compact + detail, mode selector, SVG sparklines, JSON export); mounted in `LiveViewCard` while live                                                                                                      | G9, §12          | `StreamStatsPanel.test.tsx` (6)           |
| `appSettings.ts`                              | Persisted `StreamVideoFrameRateMode` (auto/100/50/25)                                                                                                                                                                            | §11.1            | via panel/hook tests                      |

### Metric definitions (§13) — single source of truth

| Metric                                                           | Unit    | Kind          | Clock                  | Aggregation                       | Reset         |
| ---------------------------------------------------------------- | ------- | ------------- | ---------------------- | --------------------------------- | ------------- |
| `audioBufferMs`                                                  | ms      | instantaneous | AudioContext           | last read                         | player start  |
| `audioUnderruns`                                                 | count   | cumulative    | —                      | sum                               | player start  |
| `renderResidenceMs`                                              | ms      | instantaneous | presentation monotonic | last present                      | session start |
| `maxResidenceMs`                                                 | ms      | session-max   | presentation monotonic | max                               | session start |
| `presented` / `decimated` / `backlogReplacements` / `framesLost` | count   | cumulative    | —                      | sum                               | session start |
| bucket `*PerSec`                                                 | count/s | rolling (1 s) | presentation monotonic | delta over the second             | rolling ring  |
| `residence.p50/p95/p99`                                          | ms      | session       | presentation monotonic | percentile over bounded reservoir | session start |
| `effectiveDivisor`                                               | 1/2/4   | instantaneous | —                      | last                              | —             |

### Governor state machine (§11, §21)

- **Levels** = frame divisor ∈ {1,2,4}. `effectiveDivisor = max(ceilingDivisor(requestedMode), governorLevel)`.
- **Demote (fast, 1 level/tick)** on: `audioUnderruns>0` · `audioBufferMs ≤ 25` · `localLatencyP99 ≥ 0.8×budget` ·
  `videoQueueAgeMs ≥ 0.8×max` · `frameProcessingP95 ≥ budget`. Breaks the headroom streak.
- **Promote (slow, 1 level)** only after `audioBufferMs ≥ 90` and no underruns held continuously for
  `promoteStableMs (3 s)` AND `promoteCooldownMs (2 s)` since the last promotion. Fresh window required per step.
- Thresholds are documented constants in `DEFAULT_GOVERNOR_CONFIG` and are all test-pinned.

### Queue / buffer bounds (§6, §7, §21)

| Queue                 | Max count                      | Max age                          | Overflow policy            |
| --------------------- | ------------------------------ | -------------------------------- | -------------------------- |
| Audio jitter buffer   | `maxQueue = ceil(delayMs/4)+8` | ~`delayMs` (wire-clock drain)    | release oldest             |
| Video present queue   | 1 (coalescing)                 | superseded → backlog replacement | present newest, drop stale |
| Video frame-start map | `FRAME_START_CAP = 12`         | evict oldest                     | drop oldest straggler      |
| Telemetry buckets     | `MAX_BUCKETS = 900` (~15 min)  | ring                             | drop oldest                |
| Residence reservoir   | `RESIDENCE_RESERVOIR = 4096`   | ring                             | overwrite oldest           |
| Governor transitions  | `maxTransitions = 64`          | ring                             | drop oldest                |

### Still open after Phase 1 (unchanged from §6)

G2/G3 (weakest-device profiling, base64-bridge decision), G6/G7 (native audio + hardware present
timestamps), G10/G12/G13 (committed thresholds, versioned replay, soak — the user deferred these),
G11/G14/G15 (deterministic frame-ID source, self-hosted HIL CI gate). Completion gate items §23.5
(video source→display <30 ms) remain **physically red** per §0; §23.18/19 remain **RED** (no HIL CI
gate). This branch does **not** claim the full §23 completion — it delivers the provable Phase-1 slice.
