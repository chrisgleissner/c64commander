# On-device SID playback — audio fidelity test

**Date:** 2026-07-25 · **Branch:** `feat/sid-radio` (PR #320) · **Rig:** Pixel 4 (`flame`) + C64 Ultimate (`c64u`, fw 1.1.0)

> **Status update — iterations 2 and 3 (later on 2026-07-25).** Every defect below is fixed in
> `sidflow` (`d2f734c`, `c08fde2`). The wasm engine is now **numerically identical to a native build
> of the same library** (`waveCorr 1.0000`), and against the real C64 **all five median exit criteria
> pass**, with envelope correlation (0.625) **exceeding native `sidplayfp`'s own 0.483** on the same
> machine. One prerequisite changed: correct playback **requires C64 ROMs** (§6.2). Full iteration
> history in **§6**.

Track B ships an on-device SID engine (`@sidflow/libsidplayfp-wasm`, vendored to
`public/wasm/libsidplayfp/`) as an alternative to playing on the C64. This test asks the only
question that matters for it: **does a tune played on the phone sound like the same tune played on
the C64?**

Answer, as first measured (**iteration 1**, §1–§5 below): **no.** Six defects were found — three in
the app, three in the WASM build. **Iteration 2** (§6) fixes the build ones and **iteration 3**
(§6.3) finds and fixes the last, a heap-use-after-free, after which the answer is **yes on every
median criterion**. §1–§5 are kept unedited as the baseline the later numbers are measured against.

---

## 1. Method

Both sides are captured **digitally**, so nothing depends on room noise or mic placement.

| side                | how it was captured                                                                                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **C64 (reference)** | The Ultimate plays the tune (`POST /v1/runners:sidplay`); its own audio is captured off the **multicast audio mirror** (`239.0.1.65:11001`, `u16 seq + interleaved S16LE`, 47982.887 Hz PAL) directly on the workstation.                  |
| **On-device**       | The app's _own_ vendored WASM engine is driven inside the app's WebView over CDP, in a Worker, with the same options `localSid.worker.ts` uses (48 kHz, stereo), rendered in the same 0.5 s chunks. Offline — never routed to the speaker. |
| **Native control**  | `sidplayfp` CLI (same library, native build, reSIDfp) rendering the same file on the workstation.                                                                                                                                          |

Analysis (`scipy`): both sides AC-coupled with a 30 Hz high-pass — the coupling any real speaker path
applies — then the C64 side resampled onto the 48 kHz clock. Metrics: DC offset, peak, AC RMS,
long-term average spectrum (LTAS), spectral centroid, and cross-correlation of the energy envelope
after a ±20 s lag search.

**Control for the method.** Two independent C64 captures of the same tune correlate at **0.979 at lag
0**. The capture and alignment are therefore reliable, and a low local-vs-C64 correlation is a real
signal, not measurement noise.

### Corpus — 14 tunes chosen to span dimensions

Selected by parsing SID headers over a 200-tune random sample of the on-device HVSC (56 568 tunes),
then picking to span model, clock, chip count, speed and size:

| dimension            | tune                          | magic | model   | clock | chips | songs | multi-speed |
| -------------------- | ----------------------------- | ----- | ------- | ----- | ----- | ----- | ----------- |
| 2-SID (stereo)       | Mythig_2SID                   | PSID  | 6581    | PAL   | 2     | 3     | yes         |
| 2-SID (stereo)       | Giovanni_2SID                 | PSID  | 8580    | NTSC  | 2     | 1     | no          |
| NTSC clock           | Cave_of_the_Word_Wizard_Set_6 | RSID  | 6581    | NTSC  | 1     | 52    | no          |
| NTSC clock           | Alice_in_Videoland            | PSID  | 6581    | NTSC  | 1     | 7     | no          |
| RSID (ROM-dependent) | Der_Blonde_Hans_Albers        | RSID  | 6581    | PAL   | 1     | 1     | no          |
| multi-speed 8580     | Just_Rel                      | PSID  | 8580    | PAL   | 1     | 1     | yes         |
| multi-speed 6581     | Zap                           | PSID  | 6581    | PAL   | 1     | 4     | yes         |
| 8580 PAL             | RaggaPopcorn                  | PSID  | 8580    | PAL   | 1     | 1     | no          |
| 8580 PAL             | On_the_Way                    | PSID  | 8580    | PAL   | 1     | 1     | no          |
| 6581 PAL             | Drummachine                   | PSID  | 6581    | PAL   | 1     | 1     | no          |
| 6581 PAL             | Hardrestart                   | PSID  | 6581    | PAL   | 1     | 1     | no          |
| unspecified model    | Lifeless                      | PSID  | unknown | PAL   | 1     | 1     | yes         |
| tiny tune (1990 B)   | Mamba_issue_15                | PSID  | 6581    | PAL   | 1     | 1     | no          |
| many subsongs        | Massacre_on_Stage             | PSID  | 6581    | PAL   | 1     | 12    | no          |

Three were silent on the C64 side and are excluded from the comparison: both 2-SID tunes (the
Ultimate has no second SID mapped at their address) and `Cave_of_the_Word_Wizard_Set_6`. **11 tunes
compared.**

> The Ultimate's `Audio Mixer → Vol Master` was `OFF`; it was set to its default ` 0 dB` for this
> test, otherwise the mirror carries silence.

---

## 2. Results

### 2.1 Per-tune (on-device vs C64, after AC coupling)

`lvlΔdB` = on-device level relative to C64. `envCorr` = energy-envelope correlation (control: 0.979).

| tune                   | DC on-device | DC C64      | lvlΔdB    | LTAS rms dB | centroid ratio | envCorr   |
| ---------------------- | ------------ | ----------- | --------- | ----------- | -------------- | --------- |
| Alice_in_Videoland     | +0.1747      | −0.0000     | −8.42     | 14.01       | 1.656          | 0.065     |
| Der_Blonde_Hans_Albers | +0.1725      | −0.0000     | −9.89     | 3.16        | 0.762          | 0.048     |
| Just_Rel               | +0.1733      | −0.0000     | −5.82     | 4.72        | 3.220          | 0.062     |
| Zap                    | +0.1736      | −0.0000     | −6.85     | 6.25        | 0.403          | 0.057     |
| RaggaPopcorn           | +0.1757      | +0.0001     | −7.51     | 4.56        | 1.583          | 0.061     |
| On_the_Way             | +0.1740      | −0.0000     | −7.98     | 4.83        | 0.731          | 0.086     |
| Drummachine            | +0.1742      | −0.0002     | −11.47    | 7.67        | 2.492          | 0.066     |
| Hardrestart            | +0.1762      | −0.0001     | −7.09     | 16.65       | 2.612          | 0.058     |
| Lifeless               | +0.1708      | −0.0000     | −10.45    | 17.24       | 0.811          | 0.054     |
| Mamba_issue_15         | +0.1662      | −0.0001     | −7.31     | 4.65        | 1.156          | 0.060     |
| Massacre_on_Stage      | +0.1732      | +0.0000     | −11.37    | 4.20        | 1.755          | 0.032     |
| **median**             | **+0.1736**  | **−0.0000** | **−7.98** | **4.83**    | **1.583**      | **0.060** |

Every tune, without exception: a large positive DC offset that the C64 does not have, roughly 8 dB
less level, and **no envelope correlation at all** (0.032–0.086 against a 0.979 control).

### 2.2 Three-way isolation — the defect is in the WASM build

Same tune (`Drummachine`), same file, three engines:

| engine                       | DC offset   | peak      | AC RMS | envCorr vs real C64 |
| ---------------------------- | ----------- | --------- | ------ | ------------------- |
| native `sidplayfp` (reSIDfp) | +0.0017     | 0.379     | 0.0761 | **0.483**           |
| **sidflow WASM (on device)** | **+0.1742** | **0.715** | 0.0782 | **0.066**           |
| real C64 Ultimate            | −0.0002     | 0.396     | 0.0844 | — (reference)       |

The native build of the _same library_ tracks the real machine (0.483 — imperfect only because the
Ultimate's SID model, filter and mixer differ). The WASM build does not track the C64 (0.066) **and
does not track native `sidplayfp` either (0.065)**. So this is not a device problem, not the app's
chunking, and not the missing C64 ROMs — supplying real KERNAL/BASIC ROMs dumped from the Ultimate
did not restore correlation (0.046).

**Root cause, confirmed in the shipped binary:**

```
$ strings dist/libsidplayfp.wasm | grep -i 'residfp\|sidlite'
WasmSIDLite
SIDLiteEmu V3.0.0a2 Engine:
14SIDLiteBuilder
```

`bindings.cpp` selects `ReSIDfpBuilder` only under `#ifdef HAVE_RESIDFP` and otherwise falls back to
`SIDLiteBuilder`. The build passed `-I./src/builders/residfp-builder` — so reSIDfp was clearly the
intent — but **never defined `HAVE_RESIDFP`**, so every published artifact silently used SIDLite, a
fast approximation, instead of the accurate reSIDfp emulation the C64 and native player use.

**Why it can't be fixed with a one-line flag.** As of libsidplayfp v3.x reSIDfp is an _external_
dependency — `configure.ac` has `PKG_CHECK_MODULES([RESIDFP], [libresidfp >= 0.9.2])` and defines
`HAVE_RESIDFP` only when pkg-config finds it. The WASM build never provides `libresidfp`, so the
macro could never be set. Adding `-DHAVE_RESIDFP` compiles but fails to link
(`undefined symbol: ReSIDfpBuilder::~ReSIDfpBuilder`) — verified. A real fix must cross-compile
`libsidplayfp/libresidfp` with emscripten, install it where pkg-config can see it, and link
`-lresidfp`.

### 2.3 A second defect — sidflow's `TracingSidEmu` corrupts the mixer's buffer contract

SIDLite alone does **not** explain a 0.066 envelope correlation: a cruder SID emulation should still
play the right notes at the right time. Code inspection of `bindings.cpp` found a concrete defect
that does explain it.

`TracingSidEmu` is a sidflow-specific `libsidplayfp::sidemu` subclass that wraps a real emulation
(`inner`) to capture SID register writes, mirroring state with:

```cpp
void syncBufferState() {
    m_buffer = inner->buffer();
    bufferpos(inner->bufferpos());
    m_error  = inner->error();
}
```

Upstream `src/sidemu.h` declares `bufferpos()` **non-virtual**:

```cpp
int  bufferpos() const   { return m_bufferpos; }
void bufferpos(int pos)  { m_bufferpos = pos; }
```

and `src/player.cpp` drives the consume cycle through it — `sampleCount = s->bufferpos();` then
`s->bufferpos(0);` (lines 265/267, also 150/180). Because the setter is non-virtual those calls land
on the **outer** wrapper, while samples are produced into `inner`'s buffer
(`sidlite-emu.cpp:84` / `residfp-emu.cpp:102`: `m_bufferpos += m_sid.clock(cycles, m_buffer + m_bufferpos)`).

`inner->m_bufferpos` is therefore **never reset**: it grows monotonically, `m_buffer + m_bufferpos`
walks off the end of inner's buffer, and every `syncBufferState()` feeds the mixer an ever-growing
stale sample count. This is the leading explanation for the decorrelated output, and plausibly for
the DC offset. Not yet fixed — see the handover for the fix direction (get tracing out of the audio
path entirely, or make the wrapper own the buffer contract).

**A third, independent defect in the same build:** upstream was **unpinned**. `docker/entrypoint.sh`
cloned `libsidplayfp` master and ran `git reset --hard origin/master` on every build, so the artifact
changed silently with upstream. By now upstream master has dropped `SidConfig::playback`,
`SidConfig::MONO/STEREO` and `SidInfo::channels`, and the bindings **no longer compile against it at
all** (7 errors). This is fixed by pinning to `v3.0.0a2` — the revision the bindings target, which
matches the `SIDLiteEmu V3.0.0a2` string found in the previously published artifact — overridable via
`LIBSIDPLAYFP_REF`.

---

## 3. Defects and status

| #   | defect                                                                                                                                                                                                                                                                          | impact                                                                                                                                                                                                   | status                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Worker render race.** `localSid.worker.ts` used an `async` `onmessage`, so every `await` yielded to the next queued message. With N renders in flight, N `renderSeconds()` calls ran concurrently against one stateful WASM engine, interleaving and replaying the same span. | A short passage looping over and over with crackle at the seams — user-reported as "very repetitive and crackly… the same ~5 s loop". Latent at the old cap of 2; constant once the cap was raised to 4. | **Fixed** — all worker messages serialised through one promise chain. Regression test asserts peak concurrency is exactly 1 and fails on the old code. |
| 2   | **Audio underruns.** The Web Audio schedule was kept only 1.5 s ahead, but every chunk still crosses the main thread — which stalls up to **1.9 s** on the HVSC-loaded Play page (28 % of wall time in GC, measured with a long-task observer + CPU profile).                   | Audible gaps; `audioUnderruns` climbing ~6/min against a pinned budget of 0 (§12.6).                                                                                                                     | **Fixed** — buffer raised to 4 s, in-flight renders 2→4. Measured on device: **0 underruns over 110 s** (was 6/min). No added start latency.           |
| 3   | **Pause did not stop on-device playback.** `handlePauseResume` only ever drove the C64 (`machinePause`/`machineResume`), so pausing a locally-playing tune sent a pointless call to the Ultimate while the audio kept playing.                                                  | Playback could not be stopped from the UI.                                                                                                                                                               | **Fixed** — local playback now suspends/resumes the engine's AudioContext, which freezes the schedule in place and resumes exactly where it stopped.   |
| 4   | **WASM built with SIDLite, not reSIDfp.** See §2.2.                                                                                                                                                                                                                             | Wrong timbre, large DC offset (~0.17 full-scale, eating headroom — peaks to 0.93 where the C64 peaks at 0.40), ~8 dB level deficit, and output that does not track the real machine.                     | **Open.** Needs `libresidfp` cross-compiled for wasm and linked (§2.2) — not a one-line change, and not completed here.                                |
| 5   | **`TracingSidEmu` breaks the mixer's buffer contract** (§2.3) — `bufferpos()` is non-virtual, so `player.cpp`'s `bufferpos(0)` reset never reaches the inner emulation, whose position grows unbounded and walks past its buffer.                                               | Leading explanation for the decorrelated output; likely also the DC offset.                                                                                                                              | **Open.** Fix by removing tracing from the audio path (or making the wrapper own the buffer contract).                                                 |
| 6   | **Upstream libsidplayfp was unpinned** in the WASM build (`reset --hard origin/master` per run), so artifacts drifted silently and the bindings no longer compile against current master (7 API errors).                                                                        | Non-reproducible artifacts; the package could not be rebuilt at all.                                                                                                                                     | **Fixed in `sidflow`** — pinned to `v3.0.0a2` (`LIBSIDPLAYFP_REF` to override), which restores a working build.                                        |

Defect 4 means **on-device playback is not yet sonically faithful and should not be presented to
users as equivalent to the C64** until the reSIDfp rebuild is vendored and this test re-run.

The DC offset alone is worth calling out independently of the emulation choice: no C64 audio path
emits DC (the real machine is AC-coupled), and 0.17 full-scale of DC both wastes headroom and causes
clicks on start/stop. A DC blocker in the engine's output stage is cheap insurance even after the
reSIDfp fix.

---

## 4. Reproducing

```bash
# corpus selection (parses SID headers from the on-device HVSC)
python3 pullsids.py

# reference: the real C64, captured off the multicast audio mirror
python3 capture_c64.py 12

# on-device: the app's own WASM engine, in a Worker, over CDP (silent)
python3 render_local.py 22

# native control
sidplayfp -f48000 -s -t12 -wnative corpus/Drummachine.sid

# comparison
python3 compare.py
```

Harness scripts live with this report's working data; they depend only on `numpy`, `scipy`,
`websocket-client`, `adb` and `curl`.

## 5. Follow-ups

- **Cross-compile `libresidfp` for wasm**, link it (`-lresidfp`) so `HAVE_RESIDFP` is defined, re-vendor
  into `public/wasm/libsidplayfp/`, then re-run §2. Target: on-device should reach at least native
  `sidplayfp`'s 0.483 envelope correlation against the C64, with `|DC| < 0.005`.
- Add a DC blocker (or verify reSIDfp removes the offset) and assert `|DC| < 0.005` per tune.
- Add the 2-SID address mapping to the Ultimate so stereo tunes can be compared too.
- Consider promoting a small version of this A/B (a handful of tunes, DC + correlation thresholds)
  into the HIL suite so engine regressions are caught automatically.

---

## 6. Iteration 2 — the rebuilt engine (2026-07-25, later)

`sidflow` commit `d2f734c` fixes defects 4, 5 and 6 above, plus a fourth found while fixing them.
Same corpus, same C64 captures (re-taken, `gaps=0` on all 14), same analysis.

### 6.1 Result against the real C64

11 tunes compared (the same 3 are silent on the C64 side — two 2-SID, one that does not start).

| metric (median)         | iteration 1 | iteration 2 | **iteration 3** | exit criterion (§1.5) |     |
| ----------------------- | ----------- | ----------- | --------------- | --------------------- | --- |
| DC offset               | +0.1736     | +0.0038     | **+0.0016**     | \|DC\| < 0.005        | ✅  |
| level Δ vs C64          | −7.98 dB    | −0.34 dB    | **−0.76 dB**    | median \|Δ\| < 1.5 dB | ✅  |
| LTAS rms difference     | 4.83 dB     | 9.14 dB     | **1.97 dB**     | < 3 dB                | ✅  |
| spectral centroid ratio | 1.583       | 2.494       | **1.069**       | 0.85–1.18             | ✅  |
| envelope correlation    | 0.060       | 0.498       | **0.625**       | ≥ 0.45                | ✅  |

Envelope correlation against real hardware now **exceeds native `sidplayfp`'s own 0.483** on the same
machine. (Iteration 2's LTAS/centroid figures looked worse than iteration 1's only because iteration
1's output was not music at all — a drone scores deceptively well on a spectral-shape metric.)

Per tune, iteration 3:

| tune                   | DC device   | DC C64      | lvlΔdB    | LTAS rms dB | centroid ratio | envCorr   |
| ---------------------- | ----------- | ----------- | --------- | ----------- | -------------- | --------- |
| Alice_in_Videoland     | +0.0038     | −0.0000     | +0.68     | 14.45       | 1.158          | 0.307     |
| Der_Blonde_Hans_Albers | −0.0014     | −0.0000     | −1.40     | 0.50        | 0.999          | 0.419     |
| Just_Rel               | +0.0024     | +0.0001     | −0.76     | 2.76        | 1.206          | 0.647     |
| Zap                    | +0.0016     | −0.0000     | +2.26     | 1.55        | 0.902          | 0.676     |
| RaggaPopcorn           | +0.0022     | +0.0001     | −0.90     | 0.91        | 1.069          | 0.443     |
| On_the_Way             | +0.0016     | −0.0000     | −1.27     | 1.59        | 0.942          | 0.643     |
| Drummachine            | −0.0002     | −0.0001     | −1.73     | 4.92        | 1.451          | 0.625     |
| Hardrestart            | −0.0013     | −0.0002     | −0.39     | 11.55       | 1.725          | 0.661     |
| Lifeless               | +0.0036     | −0.0000     | −1.75     | 1.97        | 1.029          | 0.718     |
| Mamba_issue_15         | −0.0015     | −0.0001     | −0.63     | 5.08        | 1.646          | 0.575     |
| Massacre_on_Stage      | +0.0024     | −0.0000     | +1.73     | 0.76        | 1.004          | 0.610     |
| **median**             | **+0.0016** | **−0.0000** | **−0.76** | **1.97**    | **1.069**      | **0.625** |

**Still open per tune.** §1.5 asks for LTAS < 3 dB and centroid 0.85–1.18 on _every_ tune; four
(`Alice_in_Videoland`, `Hardrestart`, `Mamba_issue_15`, `Drummachine`) still exceed that against
hardware. Since the engine is now bit-identical to native `sidplayfp` (§6.3), these are
emulation-vs-hardware differences — the Ultimate's SID model, filter tolerance and mixer — not build
defects, and the same tunes would fail for native `sidplayfp` too. The per-tune spectral bounds
should be re-derived against a native-`sidplayfp`-vs-hardware baseline rather than assumed
achievable; that is tracked as a follow-up.

### 6.1a The strict control: device vs the same library, natively

This is the honest test of "is our build correct", and it is now exact:

| Drummachine, 12 s          | DC           | peak       | AC RMS       | envCorr    | waveCorr   |
| -------------------------- | ------------ | ---------- | ------------ | ---------- | ---------- |
| wasm before this iteration | +0.00240     | 0.4229     | +0.84 dB     | 0.7770     | 0.7502     |
| **wasm after**             | **−0.00015** | **0.4229** | **+0.00 dB** | **1.0000** | **1.0000** |

Criterion §1.5 asked for ≥ 0.90 here. It is 1.0000 — the wasm build is numerically identical to a
native build of the same library.

### 6.2 New finding — C64 ROMs are a **prerequisite**, not an accuracy improvement

Without ROMs the engine initialises a tune and then never advances it. Per-second RMS is flat to four
decimal places — a drone, not music:

```
no ROMs   0.0623 0.0623 0.0622 0.0623 0.0623 0.0623 0.0623 0.0623 0.0623 0.0623 0.0623
with ROMs 0.0902 0.0789 0.0737 0.0923 0.0974 0.0759 0.0987 0.0752 0.0888 0.0773 0.0793
real C64  0.0830 0.0747 0.0762 0.0873 0.0897 0.0755 0.0964 0.0731 0.0885 0.0731 0.0885
```

Supplying the KERNAL/BASIC images dumped from the Ultimate takes envelope correlation against native
`sidplayfp` from **0.008 → 0.734**, and against the real C64 to **0.498**.

This reframes §1.7 of the handover: ROM acquisition is not an optional accuracy upgrade that also
unlocks RSID tunes — **the on-device engine does not play anything correctly without it**. The Local
engine must not be offered as a playback destination until validated ROMs are present.

(Iteration 1 reported that adding ROMs made things _worse_. That measurement was taken through the
`TracingSidEmu` buffer corruption and is superseded.)

### 6.3 Root cause of the brightness — a heap-use-after-free (FIXED, `c08fde2`)

Against a **matched native build** — libsidplayfp v3.0.2 + libresidfp v1.1.2 compiled on this
workstation, driven by a renderer replicating `bindings.cpp`'s exact `SidConfig` — the wasm artifact
is uniformly hotter above 3 kHz:

| band (Hz)     | wasm − native (dB) |
| ------------- | ------------------ |
| 30–100        | −1.01              |
| 100–300       | +1.12              |
| 300–1 000     | +2.06              |
| 1 000–3 000   | +6.61              |
| 3 000–6 000   | +9.25              |
| 6 000–10 000  | **+10.81**         |
| 10 000–16 000 | +2.52              |

Characterisation so far:

- **Not a timing or clock error.** Per-second windows align at a _constant_ 156-sample offset with no
  drift, and per-window waveform correlation is a stable 0.79–0.86 across the whole render.
- **Not floating-point chaos.** A systematic offset with no decay over time.
- **Not the compiler.** A clang-built native stack and a gcc-built native stack are **bit-identical**
  (`waveCorr 1.0000`).
- **Not the emscripten thread guard.** Applying the same inline-`sidThread` patch to a _native_ build
  also produces **bit-identical** output (`waveCorr 1.0000`), so `apply-thread-guards.py` is exonerated.
- **Not a libsidplayfp version difference.** The distro's `/usr/bin/sidplayfp` is libsidplayfp
  **2.6.0**; the matched v3.0.2 control above removes that variable and the excess persists.

- **Not fast-math.** A build with `-fno-fast-math -ffp-contract=off` produced _exactly_ the same
  numbers (`envCorr 0.7770`, `waveCorr 0.7502`, `+0.84 dB`).
- **Deterministic** — two runs byte-identical — but **chunk-size dependent**: wasm at 20 000 vs
  10 000 cycles per `render()` correlated only 0.78 **with itself**, and the gap to native widened
  with more calls (0.750 → 0.672 → 0.546 at 20 000 / 15 000 / 10 000). Native was invariant
  (`1.0000`) at every chunk size.

Deterministic, platform-specific and allocation-sensitive is the signature of an out-of-bounds or
freed read, so the build was instrumented with **AddressSanitizer** (`SIDFLOW_EXTRA_FLAGS=-fsanitize=address`),
which named it immediately:

```
ERROR: AddressSanitizer: heap-use-after-free
READ of size 2 at 0x18303880
0x18303880 is located 0 bytes inside of 1920-byte region
  #2 SidPlayerContext.render
```

1920 bytes is exactly `new short[960]` — the 20 ms buffer `reSIDfpEmu::sampling()` allocates for
48 kHz.

**The mechanism.** `sidplayfp::initMixer()` caches each chip's raw `short*`
(`player.cpp`: `buffers[i] = m_chips[i]->buffer()`). `player.load()` re-runs `config()` — _"Must
re-configure on fly for stereo support!"_ — which reaches `reSIDfpEmu::sampling()` and does
`delete[] m_buffer; m_buffer = new short[...]`. `SidPlayerContext::selectSong()` called `load()`
**without re-initialising the mixer**, so from that point every `mix()` read freed memory. The app
calls `loadSidBuffer()` then `selectSong()`, so it hit this on every tune.

That explains every symptom: the freed region's contents depend on allocator activity, so more
`render()` calls meant more divergence (chunk dependence), and the injected garbage was broadband —
heard as excess high frequency. Native survived it only because glibc happened to leave the region
undisturbed; wasm's allocator reused it.

**Fix** (`c08fde2`): all four call sites now go through a `refreshMixer()` helper that documents the
ordering requirement, with `selectSong()`'s call immediately after `load()`/`reset()`. The wasm build
is now numerically identical to native (§6.1a).

Note also an upstream latent bug spotted while reading `SincResampler.cpp`:

```cpp
int32_t out = std::inner_product(a, a+bLength, b, out);   // `out` initialises itself
```

`out` is read uninitialised. It is inside the `RUNTIME_DISPATCH` SIMD path, which the wasm build does
not take (`checking for SIMD instructions... none`), so it does not explain this result — but it is
worth reporting upstream.

### 6.4 Engine strategy — WASM vs a bundled native libsidplayfp

Raised during this iteration: the app already ships **upstream 7-Zip both ways** — a native per-ABI
binary built from source (`android/scripts/build-upstream-7zip.sh` → `jniLibs/upstream7zip/<abi>/lib7zz.so`,
invoked via `ProcessBuilder`) _and_ a WASM build (`7zz-*.wasm`) for web/iOS. So a native libsidplayfp
is not speculative: there is a proven in-repo pattern for it, with a pinned source URL + SHA-256, an
NDK cross-compile per ABI, a build-config stamp, release-only ABI narrowing, and a packaging contract
test (`tests/unit/scripts/androidUpstream7zipPackaging.test.ts`).

It is also newly attractive because **the native build is provably correct and the wasm build is
not** (§6.3, §6.5): native is bit-identical across gcc and clang and perfectly chunk-size invariant.

**Decision: fix the WASM; keep native as a costed escape hatch. Do not build both yet.**

Reasoning:

- **A native path does not remove the WASM problem, it adds a second path.** iOS cannot exec a
  bundled binary or dlopen non-embedded code, and the web build has no native option at all. Those
  platforms need the WASM regardless, so "go native" really means "maintain two engines" — double the
  build, test and licence surface for one product feature.
- **The portable path is not fundamentally broken.** The identical source compiles to a
  provably-correct native library, so the defect is in our wasm build or its usage, not in the
  concept. §6.5 narrows it to a deterministic, chunk-size-dependent divergence — the signature of an
  out-of-bounds or uninitialised read, which is a bug to find, not a wall.
- **Performance is not currently the constraint.** `renderMsPerSec` measured 69 against a pinned
  budget of 250 on a Pixel 4 — roughly 3.5× headroom. Native would be faster, but nothing is asking
  for it yet.
- **Real-time audio via `ProcessBuilder` is a poor fit.** The 7-Zip precedent execs a batch tool and
  waits; SID playback needs a streamed, seekable, pausable sample source. Reusing that pattern
  literally would mean piping PCM over stdout and rebuilding the scheduler around a subprocess; doing
  it properly would mean JNI, which is _not_ the established pattern and is new surface either way.

**What would flip this decision**, in priority order:

1. **Gate L1 on the Callback 8020 (SailfishOS).** That device is the primary rollout target and the
   perf floor, and WASM has never been run on it. If the engine cannot hold real time there, native
   becomes necessary — and since SailfishOS is Linux/ARM, the same cross-compile approach extends to
   it, which is what makes the idea strong rather than Android-only.
2. **§6.5 turning out to be unfixable** in the wasm target specifically.

If it flips, the shape is: native on Android + SailfishOS via the 7-Zip pattern, WASM retained for
web/iOS, both behind the existing `LocalSidPlaybackController` interface so the app contract does not
change (handover §1.8 item 2).

### 6.5 Harness

Rebuilt and validated this iteration; the scripts live with the working data.

| script                            | what it does                                                                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `render_node.mjs`                 | drives a given wasm build on the workstation with the app's exact options (48 kHz, stereo, 100 000-cycle chunks); `SIDFLOW_ROMS=<dir>` supplies KERNAL/BASIC/CHARGEN |
| `native_render.cpp`               | matched native control — same library versions, same `SidConfig`, same render loop                                                                                   |
| `compare_pair.py`                 | strict two-render comparison: coarse envelope alignment, then FFT refinement to **sample accuracy**, with all metrics computed on the aligned overlap                |
| `capture_c64.py`                  | C64 reference off the multicast audio mirror, asserting `gaps == 0`                                                                                                  |
| `render_corpus.sh` + `compare.py` | whole-corpus device-vs-C64 table                                                                                                                                     |

Controls that must keep passing, and did:

- native vs itself → `1.0000`
- gcc-native vs clang-native → `1.0000`
- threaded-native vs inline-native → `1.0000`
- two independent C64 captures of one tune → `0.979` (iteration 1)
- the harness reproduces iteration 1's published numbers on the old artifact (DC +0.158, envCorr
  0.048, peak 0.949) before any change — so improvements are real, not a moved goalpost.
