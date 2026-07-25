# SID Radio — handover to production-ready

**Written 2026-07-25.** Read this end to end before touching anything. It is self-contained.

You are finishing **SID Radio** (spec `docs/plans/sid-station/spec.md`) and its **Track B on-device
SID engine**. The work is **not done until SID Radio is entirely production-ready and well tested** —
that means every gate below green with evidence, not just the audio loop.

Two working trees matter, side by side:

| repo | role |
| --- | --- |
| `/home/chris/dev/c64/c64commander-sid-radio` | the app. Branch `feat/sid-radio`, PR **#320**, tip `a96ccc7e` (pushed). |
| `/home/chris/dev/c64/sidflow` | builds `@sidflow/libsidplayfp-wasm`, vendored into the app at `public/wasm/libsidplayfp/`. Branch `fix/libsidplayfp-wasm-pin-and-residfp-audit` (pushed). |

---

## PART 0 — What is already established (do not re-derive)

Full method and per-tune data: **`docs/plans/sid-station/AUDIO-FIDELITY-TEST.md`**. Summary:

On-device playback **does not sound like the C64**. Measured on a Pixel 4 against a live C64 Ultimate
over 11 comparable HVSC tunes: a **+0.17 full-scale DC offset** the hardware never has, **~8 dB
quieter**, and **no envelope correlation** (0.03–0.09).

A three-way comparison isolates the fault to **our WASM build**, not the app and not libsidplayfp:

| engine (same tune, same file) | DC offset | peak | envelope corr. vs real C64 |
| --- | --- | --- | --- |
| native `sidplayfp` (reSIDfp, installed at `/usr/bin/sidplayfp`) | +0.0017 | 0.379 | **0.483** |
| **vendored sidflow WASM** | **+0.1742** | **0.715** | **0.066** |
| real C64 Ultimate | −0.0002 | 0.396 | reference |

The WASM does not track native `sidplayfp` either (**0.065**). Ruled out already — do not redo:
chunked vs single-call rendering (byte-identical), the app's scheduler, missing C64 ROMs (supplying
real KERNAL/BASIC dumped from the Ultimate did not restore correlation), and clock/tempo mismatch (a
0.83–1.20 rate sweep never exceeded 0.15).

**Method control:** two independent C64 captures of the same tune correlate **0.979 at lag 0**. The
capture and alignment are trustworthy; a low correlation is real signal.

### Three app-side defects already fixed (on `feat/sid-radio`)

1. **Worker render race** — `localSid.worker.ts` used an `async` `onmessage`, so N in-flight renders
   became N concurrent `renderSeconds()` calls on one stateful engine, replaying the same span
   (audible as a few seconds looping with crackle). Now serialised through one promise chain.
2. **Underruns** — schedule kept 1.5 s ahead while the main thread stalls up to **1.9 s** (28 % of
   wall time in GC on the HVSC-loaded Play page). Raised to 4 s → **0 underruns over 110 s**.
3. **Pause did nothing for a local tune** — `handlePauseResume` only drove the C64. Now
   suspends/resumes the engine's AudioContext.

---

## PART 1 — THE PRIMARY TASK: make the two sound imperceptibly identical

**libsidplayfp is exceptionally accurate. Assume any discrepancy is ours** — our wrapper, our build,
or our usage. Do not "tune" toward the C64 with EQ or fudge factors. Find and remove the defect.

### 1.1 Prime suspect — confirmed by code inspection, not yet fixed

`sidflow/packages/libsidplayfp-wasm/src/bindings/bindings.cpp` adds `TracingSidEmu`, a
sidflow-specific `libsidplayfp::sidemu` subclass that wraps a real emulation (`inner`) to capture SID
register writes. It mirrors state with:

```cpp
void syncBufferState() {
    m_buffer = inner->buffer();
    bufferpos(inner->bufferpos());
    m_error = inner->error();
}
```

**This is broken.** In upstream `src/sidemu.h`, `bufferpos()` is **non-virtual**:

```cpp
int  bufferpos() const { return m_bufferpos; }
void bufferpos(int pos) { m_bufferpos = pos; }
```

and `src/player.cpp` drives the consume cycle through it — `sampleCount = s->bufferpos();` then
`s->bufferpos(0);` (lines 265/267, also 150 and 180). Because the setter is non-virtual, those calls
land on the **outer** `TracingSidEmu`, while samples are actually produced into `inner`'s buffer
(`src/builders/sidlite-builder/sidlite-emu.cpp:84`,
`src/builders/residfp-builder/residfp-emu.cpp:102`):

```cpp
m_bufferpos += m_sid.clock(cycles, m_buffer + m_bufferpos);
```

So `inner->m_bufferpos` is **never reset**: it grows monotonically, `m_buffer + m_bufferpos` walks
off the end of inner's buffer, and every `syncBufferState()` hands the mixer an ever-growing stale
sample count. That is a complete explanation for garbled, decorrelated output — and plausibly for the
DC offset too.

**Fix direction.** Do not paper over it. Either:

- **(preferred) delete the wrapper from the audio path.** Get SID write traces another way — e.g. a
  `sidbuilder` that hands out the real emulation and taps writes without subclassing `sidemu`, or
  compile the trace hook directly into a vendored builder — so the audio path is byte-for-byte
  upstream. The tracing feature must never be able to affect audio; and
- if a wrapper is truly required, it must **own** the buffer contract: forward every `bufferpos()`
  mutation to `inner`, or (better) stop delegating and let the outer object be the only `sidemu`,
  with tracing done at the `write()` boundary only.

**Verify the wrapper is implicated before designing the fix:** build one WASM artifact with
`TracingSidEmu` bypassed entirely (builder returns `inner` directly) and re-run §1.4. If correlation
jumps toward native `sidplayfp`, this was it.

### 1.2 Second known defect — the build uses SIDLite, not reSIDfp

`strings dist/libsidplayfp.wasm` → `WasmSIDLite`, `SIDLiteEmu V3.0.0a2`. `bindings.cpp` selects
`ReSIDfpBuilder` only under `#ifdef HAVE_RESIDFP` and otherwise falls back to `SIDLiteBuilder`.
Since libsidplayfp v3.x, reSIDfp is an **external** dependency —
`configure.ac`: `PKG_CHECK_MODULES([RESIDFP], [libresidfp >= 0.9.2])` — which the WASM build never
provides, so the macro could never be defined and **every published artifact has silently been
SIDLite**, a fast approximation.

`-DHAVE_RESIDFP` alone is **not** a fix — verified: it compiles and then fails to link
(`undefined symbol: ReSIDfpBuilder::~ReSIDfpBuilder`). The real fix:

1. Clone and cross-compile **`libsidplayfp/libresidfp`** with emscripten (`emconfigure`/`emmake`,
   static, `-O3`), pinned like the parent.
2. Install it into the emscripten sysroot so `pkg-config` finds `libresidfp.pc` during
   `emconfigure ./configure` — then upstream defines `HAVE_RESIDFP` itself.
3. Add `-DHAVE_RESIDFP` and link `-lresidfp` on the `em++` line in `docker/entrypoint.sh`.
4. Assert it stuck: `strings dist/libsidplayfp.wasm | grep -q WasmReSIDfp` should pass and
   `WasmSIDLite` should be absent. **Add this as a build-time check** so it can never silently
   regress again.

Note native `sidplayfp` (the 0.483 reference) uses reSIDfp **with ROMs**. Match that configuration
before concluding anything about residual differences.

### 1.3 Already fixed in sidflow (keep it)

Upstream was **unpinned** — `git clone` + `reset --hard origin/master` every run — so artifacts
drifted silently, and by now upstream master has dropped `SidConfig::playback`, `SidConfig::MONO/STEREO`
and `SidInfo::channels`: the bindings **no longer compile against master at all** (7 errors). Pinned
to **`v3.0.0a2`** (override via `LIBSIDPLAYFP_REF`); build is green and reproducible again. Keep the
pin. If you move it, move it deliberately and update `bindings.cpp` for the new API.

### 1.4 The self-improvement loop (this is the core of the task)

Run this loop until the exit criteria in §1.5 are met. **Every iteration must be driven by
measurement, never by ear alone and never by guesswork.**

```
┌─ 1. CAPTURE  the real C64 (ground truth) and the device, digitally, for the same tunes
├─ 2. MEASURE  DC, level, spectrum, and time-aligned correlation
├─ 3. DIAGNOSE the largest single discrepancy; form ONE falsifiable hypothesis
├─ 4. CHANGE   one thing (sidflow wrapper/build, or app usage)
├─ 5. REBUILD  the WASM, re-vendor into public/wasm/libsidplayfp/, rebuild the APK
├─ 6. RE-MEASURE the SAME corpus; record the numbers in a table, iteration by iteration
└─ 7. If better, keep and repeat. If not, revert and try the next hypothesis. Never keep an
      unexplained improvement — understand WHY before moving on.
```

**Rig.** Pixel 4 (`flame`, serial `9B081FFAZ001WX`) attached by USB; C64 Ultimate on the LAN.
**Re-read `/etc/hosts` every session — the IPs are DHCP-volatile** (`c64u` was `192.168.1.148`;
password `pwd` via `X-Password`). **`u64` is off limits.** The Ultimate's
`Audio Mixer → Vol Master` must not be `OFF` or the mirror carries silence (set to ` 0 dB` via
`PUT /v1/configs/Audio%20Mixer/Vol%20Master?value=%200%20dB` — single-item writes use **PUT**, never
POST, which crashes the device).

**Ground truth — capture the C64 digitally, on the workstation.** Do not use a microphone as the
primary signal. The Ultimate streams its own audio as multicast; join it directly:

- start: `PUT /v1/streams/audio:start?ip=239.0.1.65%3A11001`, stop: `PUT /v1/streams/audio:stop`
- wire format (`src/lib/streams/audioStream.ts`): `u16 seq` LE + interleaved stereo **S16LE**,
  192 stereo frames/packet, sample rate **47982.8869 Hz** (PAL)
- play a tune: `POST /v1/runners:sidplay` (multipart `file=@tune.sid`, optional `?songnr=N`)
- assert `gaps == 0` from the seq counter on every capture, or discard it

**Device side — capture the app's own engine.** Drive the vendored module inside the app's WebView
over CDP, **in a Worker** (running the WASM on the page's main thread wedges it), with exactly the
options `localSid.worker.ts` uses (48 kHz, stereo, 0.5 s chunks). Rendering offline this way makes
**no sound**, which matters — see §1.6. Forward the devtools socket from
`/proc/net/unix` (`webview_devtools_remote_<pid>`) and **pass `suppress_origin=True`**: the WebView
rejects a websocket handshake carrying an `Origin` header (403).

**Third reference — native `sidplayfp`** (`/usr/bin/sidplayfp`, reSIDfp, with ROMs):
`sidplayfp -f48000 -s -t12 -wout corpus/Tune.sid`. This is the "what libsidplayfp should sound like"
control that separates *our* bugs from real hardware-vs-emulation differences.

**Analysis.** AC-couple both sides (2nd-order high-pass at 30 Hz — the coupling every real speaker
path applies; without it sub-audible drift dominates every metric), resample the C64 side onto
48 kHz, then compute per tune:

| metric | what it catches |
| --- | --- |
| DC offset | output-stage / centring bugs |
| AC RMS, peak | level and headroom |
| envelope cross-correlation after a ±20 s lag search | **whether it is the same music at the same time** — the metric that is currently 0.066 |
| LTAS rms dB difference, spectral centroid ratio | timbre / filter character |
| onset rate, dominant-pitch track | tempo and pitch errors |

**Sanity controls you must keep running** — a loop that lies to you is worse than none:

- C64 captured twice for the same tune must correlate **> 0.95** (it was 0.979). If not, fix the
  harness before trusting any other number.
- native `sidplayfp` vs C64 must stay around **0.48**. That is your realistic ceiling for
  emulation-vs-hardware; it is the target the device must approach.
- a tune must correlate better with *itself* than with a different tune (build the full cross-matrix
  occasionally; LTAS alone is **not** discriminative — all SID music has a similar broad spectrum).

**Corpus.** Reuse the 14 header-selected tunes in `AUDIO-FIDELITY-TEST.md` §1 and keep them fixed so
iterations are comparable; they span 6581/8580/unspecified, PAL/NTSC, 1- and 2-SID, single- and
multi-speed, RSID/PSID, 2 KB–57 KB, 1–52 subsongs. Select them by parsing SID headers (magic,
version, `songs`, `startSong`, speed bits, flags → clock/model, 2nd/3rd SID address) over a random
sample of the on-device HVSC (56 568 tunes under
`run-as uk.gleissner.c64commander files/hvsc/library`; bulk-pull with `tar` through `adb exec-out`).
Match the **same subsong** on both sides — the vendored `patchStartSong` is 0-based
(`songIndex + 1` → header `startSong`), so pass the same number to `sidplay?songnr=` and to
`loadSidBuffer`. Prefer `songs == 1` tunes for the core metric to remove that variable.

Expand the corpus to **≥ 30 tunes** for the final sign-off run.

### 1.5 Exit criteria — "imperceptibly identical"

Per tune, on the final ≥ 30-tune corpus, device vs real C64:

- **DC offset:** `|DC| < 0.005` full-scale (hardware measures ~0.0000). Non-negotiable — no C64 audio
  path emits DC, and 0.17 both wastes headroom and clicks on start/stop.
- **Envelope correlation ≥ 0.45**, i.e. statistically indistinguishable from native `sidplayfp`'s
  0.483 against the same hardware. **Additionally, device vs native `sidplayfp` ≥ 0.90** — this is
  the strict one: same library, same tune, same settings should be nearly the same waveform, and it
  is the honest test of "is our build correct".
- **Level:** median |ΔdB| < 1.5 dB, no tune beyond 3 dB.
- **Spectrum:** LTAS rms difference < 3 dB; spectral centroid ratio within 0.85–1.18 on every tune.
- **Peak:** no tune above 0.95 full-scale (no clipping); peak ratio vs C64 within 0.7–1.4.
- **Zero underruns** and no chunk-boundary discontinuities across a 3-minute tune.

Then, and only then, confirm by ear: play the same tune on the C64 and on the device back-to-back and
listen for pitch, tempo, timbre, filter sweeps, vibrato and digi samples. Optionally corroborate
acoustically by recording the Pixel's speaker with this workstation's USB mic (`arecord`, card 2
`SF-558`) — treat that as **supporting evidence only**; the digital captures are the measurement.

Record the final table in `AUDIO-FIDELITY-TEST.md`, replacing the current failing numbers, and keep
the iteration history so the path is auditable.

### 1.6 Rules of engagement on the rig (the user sits next to it)

- **Bounded tests only: ≤ 30 s of audible playback, then stop.** Never leave a tune looping.
- Offline/CDP rendering is silent — prefer it for measurement sweeps.
- Always clean up: stop playback, `PUT /v1/streams/audio:stop`, and confirm the phone is silent
  (`adb shell dumpsys audio | grep -c "AAudio.*state:started"` → `0`). Force-stop the app if needed.
- Physical power-cycling of the C64 is a rare, ask-first exception.
- The Ultimate has **no second SID mapped**, so 2-SID tunes are silent on the C64 side. Either map it
  (`SID Addressing` / `SID Sockets Configuration`) or keep excluding them — state which.

### 1.7 Fetch the C64 ROMs from the user's own Ultimate over DMA (design + implement)

libsidplayfp is materially more accurate **with** real KERNAL/BASIC ROMs — native `sidplayfp`, the
0.483 reference, runs with them. Today the app ships none (they cannot legally be bundled), which is
why RSID tunes are routed back to the C64 and why PSID accuracy is capped. **This is solvable: read
the ROMs from the user's own connected hardware.** The app never distributes ROMs; it reads them off
the machine the user owns.

**Already proven on the rig this session** — `GET /v1/machine:readmem` is documented as *"performs a
**DMA read** action on the cartridge bus"* (`u2plus-open-api-spec.yaml`), and the dumps verified
byte-perfect against the canonical images:

| ROM | request | size | MD5 | identification |
| --- | --- | --- | --- | --- |
| KERNAL | `machine:readmem?address=e000&length=8192` | 8 KiB | `39065497630802346bce17963f13c092` | ✅ genuine KERNAL rev 3 (`901227-03`) |
| BASIC | `machine:readmem?address=a000&length=8192` | 8 KiB | `57af4ae21d4b705c2991d98ed5c1f7b8` | ✅ genuine BASIC V2 (`901226-01`) |
| CHARGEN | `machine:readmem?address=d000&length=4096` | 4 KiB | `72c3ce07501ea0cac7d1f7e2834dad7c` | ❌ **not** chargen — `$D000` is I/O under default banking |

**Chargen** needs the character ROM banked in (`$01` bit 2 `CHAREN = 0`): read `$01` via `readmem`,
write it with CHAREN cleared via `machine:writemem`, DMA-read `$D000–$DFFF`, then **restore `$01`**.
Do this only in a known-idle machine state, and prefer to skip it entirely — chargen has **no effect
on audio**, and `setSystemROMs(kernal, basic, null)` is fine for playback. Only pursue it if a
verified-complete ROM set is wanted.

**Implementation requirements:**

- **Trigger:** an explicit, understandable user action (Settings → "Fetch C64 ROMs from your
  Ultimate"), not a silent background grab. Explain plainly that it improves on-device playback
  accuracy and enables ROM-dependent (RSID) tunes.
- **Validate before use, always.** Check length, then checksum against the known-good set above;
  reject all-zeros, all-`$FF`, or anything failing a sanity check. A DMA read reflects **current
  banking** — if a cartridge is active or a program has banked ROM out, the read returns RAM and will
  silently look like a ROM-shaped blob. Capture after a reset, in a known state, and **never accept a
  dump that fails checksum validation**.
- **Handle ROM variants.** KERNAL revisions differ (rev 1/2/3), and a U64/C128 may present different
  images. Accept any dump that passes structural validation, record which revision was captured, and
  surface it in Settings/Diagnostics.
- **Storage:** app-private storage only. **Never** bundle, export, sync, include in diagnostics
  bundles, or ship in the APK. Document this explicitly.
- **Wire it up:** pass the cached ROMs into `SidAudioEngine.setSystemROMs(kernal, basic, chargen)`
  before `loadSidBuffer`. Then revisit `playbackEngineRouting.ts`: with valid ROMs present, the
  `rom-on-c64` fallback for RSID tunes can be lifted, so RSID plays on-device too. Keep the fallback
  for the no-ROMs case.
- **Re-measure.** Adding ROMs changes the audio path — rerun the §1.4 loop with and without ROMs and
  record both. Note that in the current (broken) WASM, supplying real ROMs made output *worse*
  (AC RMS jumped from 0.07 to 0.51, correlation 0.046), so **only evaluate the ROM path after §1.1
  and §1.2 are fixed** — otherwise you will be measuring the wrapper bug.
- **Licence note:** update `THIRD_PARTY_NOTICES.md` / docs to state that ROMs are user-supplied from
  their own hardware at runtime and are never distributed with the app.

### 1.8 If it turns out to be a dead end

It very probably is not — native `sidplayfp` already proves the library reproduces the hardware well,
and §1.1 is a concrete confirmed defect in *our* wrapper. But if, after fixing §1.1 and §1.2, the
device still cannot reach the exit criteria, escalate in this order and **write up the evidence
before switching**:

1. Vendor upstream's own emscripten/WASM build if one exists, dropping sidflow's custom bindings
   entirely.
2. Replace the WASM engine with a **native Android SID engine** (JNI/NDK libsidplayfp) behind the
   same `LocalSidPlaybackController` interface — note this was originally rejected because
   SailfishOS/Callback 8020 is the primary target, so it must stay a per-platform implementation
   detail, not a change to the app's contract.
3. Failing both, **withdraw the on-device engine from the release**: keep `DEFAULT_PLAYBACK_ENGINE`
   as `"c64"`, hide the "Play on" control, and ship SID Radio on the C64 path alone. Shipping an
   engine that does not sound like a C64 is worse than not shipping it.

---

## PART 2 — Everything else needed for production-ready

The audio loop is necessary but **not sufficient**. All of the following must be green with evidence
in `WORKLOG.md`.

### 2.1 On-device HIL soaks (spec §9.5) — none of these have been run

Harness `tools/hil/sid_radio_hil.py` (fixed and ready; `pip install websocket-client`):

```bash
python3 tools/hil/sid_radio_hil.py --serial 9B081FFAZ001WX --station song  --soak-tracks 30 --skips 5
python3 tools/hil/sid_radio_hil.py --serial 9B081FFAZ001WX --station style --style fast_paced --soak-tracks 30
python3 tools/hil/sid_radio_hil.py --serial 9B081FFAZ001WX --shuffle-replay   # G11
python3 tools/hil/sid_radio_hil.py --serial 9B081FFAZ001WX --hvsc-update      # G12
python3 tools/hil/sid_radio_hil.py --serial 9B081FFAZ001WX --engine local --station song --soak-tracks 30
```

`--engine local` selects the on-device engine and **aborts if the app did not take it**; it is the
only mode that asserts the `localEngine` §12.6 budgets. A metric the app never reported prints as
`NOT REPORTED`, and a section that reported nothing fails the run — so an unmeasured budget can never
pass as green. `--hvsc-update` says so loudly when upstream had no update, because continuity across
a rebuild that never happened proves nothing.

### 2.2 Fill the remaining pinned budgets

`ci/perf/sid-radio-perf-thresholds.json` — **never rewrite a pinned baseline to hide a regression**
(spec §9.2); the host test `tests/unit/scripts/assertSidRadioPerf.test.ts` asserts every recorded
measurement satisfies its own budget.

| metric | budget | state |
| --- | --- | --- |
| `coldLoadMs` | < 1500 | ✅ 145 (M0) |
| `engineThreadIsMain` | false | ✅ (M0) |
| `memoryEstimateBytes` | < 8 MiB | ✅ 5.0 MB (M0) |
| `renderMsPerSec` (p99) | < 250 | ◑ 69 measured — **re-measure after the engine fix** |
| `audioUnderruns` | 0 | ✅ 0 over 110 s |
| `engineSwitchMs` (p99) | < 1500 | ❌ not measured on device |
| `firstCandidateMs` (p99) | < 300 | ❌ |
| `lastRefillMs` (p99) | < 150 | ❌ |
| `refillMainThreadMaxMs` | < 16 | ❌ |
| `skipToLaunchMs` (p99) | < 400 | ❌ |
| `tracksAutoAdvanced` | ≥ 30, zero gaps | ❌ |

Also record on-device **CPU % (p95)** and **battery** over the soak (§12.6).

### 2.3 Gates still open

- **G1** — real `.sidcorr` loads/parses on **iOS device** (web + host + Android already ✓).
- **L1** — WASM instantiate + render is proven on **Pixel 4**; still to prove on the **Callback 8020
  (SailfishOS)**, the primary rollout device and the perf floor. It was not attached during this
  session.
- **L3** — on-device battery/CPU gate; background-audio behaviour documented; native-sink escape
  hatch noted.
- **L4** — SID Radio end-to-end on the Local engine with **no C64 attached**.
- **G11/G12** — assert on hardware via `--shuffle-replay` / `--hvsc-update` (§2.1).
- Verify the **instant mid-track engine switch** (§12.5) on device — it is wired and unit-tested but
  never hardware-verified. The **wake lock needs no new code**: the existing background-execution
  lock is engine-agnostic and was confirmed engaged during local playback
  (`BackgroundExecutionService` holds audio focus; AAudio `state:started`).

### 2.4 Quality, CI and release gates

- `npm test` (currently **792 files / 9436 pass**), `npm run lint`, `format:check:ts`, `npm run build`,
  `npm run test:e2e` — all green.
- **`coverage:gate` ≥ 91 %** on the patch (Codecov patch gate); the check can be stale — trust the API
  number.
- PR **#320** checks green, review comments resolved, mergeable, **not merged**.
- `spec.md` / `PLANS.md` / `WORKLOG.md` mutually consistent, every gate carrying evidence.
- Android needs **JDK 21** (`./build` selects it). Fast local loop:
  `./build --skip-tests --install-apk`. Validate deps with `npm ci` — a single-arch `npm install`
  prunes `@emnapi` optional deps and breaks all CI.
- Watch for an automation that auto-commits and pushes this repo mid-session; check `git log` before
  assuming work was lost.

### 2.5 Docs and UX before release

- Manual: edit the **generator** `scripts/build-manuals.mjs` (SID Radio chapter, both variants) —
  never the generated `.md`; rebuild with `npm run manuals:build`.
- Screenshots: `docs/img/app/play/sid-radio/*`, `settings/sid-radio.png` — refresh if the UI moved.
- README SID Radio section current.
- **Decide the rollout position for the on-device engine.** Flags currently default **on**
  (`DEFAULT_SID_RADIO_ENABLED` / `DEFAULT_SID_RANKING_ENABLED` / `DEFAULT_LOCAL_ENGINE_ENABLED`) with
  `DEFAULT_PLAYBACK_ENGINE = "c64"`, so the engine is *offered* but the C64 is the default. **Until
  Part 1 passes, it must not be presented as equivalent to the C64** — either keep it clearly
  labelled as approximate, or gate it off.
- ROM story (§1.7): if ROM fetching ships, document that ROMs are read from the user's own Ultimate
  over DMA, cached app-privately and never distributed — and that RSID tunes play on-device once ROMs
  are present. Until then, keep the current caveat: RSID tunes need C64 ROMs that cannot be bundled
  and fall back to the C64 with a one-time notice.

### 2.6 Licence hygiene

`@sidflow/libsidplayfp-wasm` is GPL-2.0-or-later (LE0 audit passed, compatible with the app's
GPL-3.0-or-later). If you vendor **libresidfp** or any new component, re-run that audit, confirm no
GPL-2.0-**only** piece enters, and update `THIRD_PARTY_NOTICES.md` and
`public/wasm/libsidplayfp/VENDORING.md` (the package is not on npm — it is vendored as static
assets, and the pinned upstream ref must be recorded there).

---

## Definition of done

1. Part 1 exit criteria met on a ≥ 30-tune corpus, numbers recorded in `AUDIO-FIDELITY-TEST.md`, and
   the on-device engine confirmed by ear to be indistinguishable from the C64.
2. ROM acquisition from the user's Ultimate (§1.7) implemented, checksum-validated, wired into the
   engine, and its effect on fidelity measured and recorded.
3. Every budget in §2.2 measured on hardware and within its pinned bound.
4. Every gate in §2.3 green with WORKLOG evidence.
5. §2.4 CI/quality gates green; PR #320 mergeable and not merged.
6. Docs, screenshots, manual and licence notices updated.
7. The sidflow fix landed on `main` with a build-time assertion that the artifact really is reSIDfp
   and the tracing path cannot affect audio.

## Relevant memories

`[[sid-radio-and-local-engine-plan]]`, `[[av-mirror-multicast-not-unicast]]`,
`[[live-view-native-audio-off-js-thread]]`, `[[device-ips-current]]`, `[[c64u-flakiness]]`,
`[[cap8-jdk21-and-lockfile]]`, `[[led-slider-post-configs-crash]]`,
`[[hil-physical-power-cycle-minimize-user-involvement]]`, `[[codecov-patch-gate-kotlin-coverage]]`,
`[[test-change-litmus-test]]`, `[[concurrent-autocommit-on-hardening]]`.
