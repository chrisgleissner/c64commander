# On-device SID playback — audio fidelity test

**Date:** 2026-07-25 · **Branch:** `feat/sid-radio` (PR #320) · **Rig:** Pixel 4 (`flame`) + C64 Ultimate (`c64u`, fw 1.1.0)

Track B ships an on-device SID engine (`@sidflow/libsidplayfp-wasm`, vendored to
`public/wasm/libsidplayfp/`) as an alternative to playing on the C64. This test asks the only
question that matters for it: **does a tune played on the phone sound like the same tune played on
the C64?**

Answer: **no — not before this work, and not fully afterwards.** Four defects were found. Three are
fixed in this PR; the fourth is a defect in the upstream WASM build and is fixed in `sidflow`.

---

## 1. Method

Both sides are captured **digitally**, so nothing depends on room noise or mic placement.

| side | how it was captured |
| --- | --- |
| **C64 (reference)** | The Ultimate plays the tune (`POST /v1/runners:sidplay`); its own audio is captured off the **multicast audio mirror** (`239.0.1.65:11001`, `u16 seq + interleaved S16LE`, 47982.887 Hz PAL) directly on the workstation. |
| **On-device** | The app's *own* vendored WASM engine is driven inside the app's WebView over CDP, in a Worker, with the same options `localSid.worker.ts` uses (48 kHz, stereo), rendered in the same 0.5 s chunks. Offline — never routed to the speaker. |
| **Native control** | `sidplayfp` CLI (same library, native build, reSIDfp) rendering the same file on the workstation. |

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

| dimension | tune | magic | model | clock | chips | songs | multi-speed |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2-SID (stereo) | Mythig_2SID | PSID | 6581 | PAL | 2 | 3 | yes |
| 2-SID (stereo) | Giovanni_2SID | PSID | 8580 | NTSC | 2 | 1 | no |
| NTSC clock | Cave_of_the_Word_Wizard_Set_6 | RSID | 6581 | NTSC | 1 | 52 | no |
| NTSC clock | Alice_in_Videoland | PSID | 6581 | NTSC | 1 | 7 | no |
| RSID (ROM-dependent) | Der_Blonde_Hans_Albers | RSID | 6581 | PAL | 1 | 1 | no |
| multi-speed 8580 | Just_Rel | PSID | 8580 | PAL | 1 | 1 | yes |
| multi-speed 6581 | Zap | PSID | 6581 | PAL | 1 | 4 | yes |
| 8580 PAL | RaggaPopcorn | PSID | 8580 | PAL | 1 | 1 | no |
| 8580 PAL | On_the_Way | PSID | 8580 | PAL | 1 | 1 | no |
| 6581 PAL | Drummachine | PSID | 6581 | PAL | 1 | 1 | no |
| 6581 PAL | Hardrestart | PSID | 6581 | PAL | 1 | 1 | no |
| unspecified model | Lifeless | PSID | unknown | PAL | 1 | 1 | yes |
| tiny tune (1990 B) | Mamba_issue_15 | PSID | 6581 | PAL | 1 | 1 | no |
| many subsongs | Massacre_on_Stage | PSID | 6581 | PAL | 1 | 12 | no |

Three were silent on the C64 side and are excluded from the comparison: both 2-SID tunes (the
Ultimate has no second SID mapped at their address) and `Cave_of_the_Word_Wizard_Set_6`. **11 tunes
compared.**

> The Ultimate's `Audio Mixer → Vol Master` was `OFF`; it was set to its default ` 0 dB` for this
> test, otherwise the mirror carries silence.

---

## 2. Results

### 2.1 Per-tune (on-device vs C64, after AC coupling)

`lvlΔdB` = on-device level relative to C64. `envCorr` = energy-envelope correlation (control: 0.979).

| tune | DC on-device | DC C64 | lvlΔdB | LTAS rms dB | centroid ratio | envCorr |
| --- | --- | --- | --- | --- | --- | --- |
| Alice_in_Videoland | +0.1747 | −0.0000 | −8.42 | 14.01 | 1.656 | 0.065 |
| Der_Blonde_Hans_Albers | +0.1725 | −0.0000 | −9.89 | 3.16 | 0.762 | 0.048 |
| Just_Rel | +0.1733 | −0.0000 | −5.82 | 4.72 | 3.220 | 0.062 |
| Zap | +0.1736 | −0.0000 | −6.85 | 6.25 | 0.403 | 0.057 |
| RaggaPopcorn | +0.1757 | +0.0001 | −7.51 | 4.56 | 1.583 | 0.061 |
| On_the_Way | +0.1740 | −0.0000 | −7.98 | 4.83 | 0.731 | 0.086 |
| Drummachine | +0.1742 | −0.0002 | −11.47 | 7.67 | 2.492 | 0.066 |
| Hardrestart | +0.1762 | −0.0001 | −7.09 | 16.65 | 2.612 | 0.058 |
| Lifeless | +0.1708 | −0.0000 | −10.45 | 17.24 | 0.811 | 0.054 |
| Mamba_issue_15 | +0.1662 | −0.0001 | −7.31 | 4.65 | 1.156 | 0.060 |
| Massacre_on_Stage | +0.1732 | +0.0000 | −11.37 | 4.20 | 1.755 | 0.032 |
| **median** | **+0.1736** | **−0.0000** | **−7.98** | **4.83** | **1.583** | **0.060** |

Every tune, without exception: a large positive DC offset that the C64 does not have, roughly 8 dB
less level, and **no envelope correlation at all** (0.032–0.086 against a 0.979 control).

### 2.2 Three-way isolation — the defect is in the WASM build

Same tune (`Drummachine`), same file, three engines:

| engine | DC offset | peak | AC RMS | envCorr vs real C64 |
| --- | --- | --- | --- | --- |
| native `sidplayfp` (reSIDfp) | +0.0017 | 0.379 | 0.0761 | **0.483** |
| **sidflow WASM (on device)** | **+0.1742** | **0.715** | 0.0782 | **0.066** |
| real C64 Ultimate | −0.0002 | 0.396 | 0.0844 | — (reference) |

The native build of the *same library* tracks the real machine (0.483 — imperfect only because the
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

**Why it can't be fixed with a one-line flag.** As of libsidplayfp v3.x reSIDfp is an *external*
dependency — `configure.ac` has `PKG_CHECK_MODULES([RESIDFP], [libresidfp >= 0.9.2])` and defines
`HAVE_RESIDFP` only when pkg-config finds it. The WASM build never provides `libresidfp`, so the
macro could never be set. Adding `-DHAVE_RESIDFP` compiles but fails to link
(`undefined symbol: ReSIDfpBuilder::~ReSIDfpBuilder`) — verified. A real fix must cross-compile
`libsidplayfp/libresidfp` with emscripten, install it where pkg-config can see it, and link
`-lresidfp`.

**A second, independent defect in the same build:** upstream was **unpinned**. `docker/entrypoint.sh`
cloned `libsidplayfp` master and ran `git reset --hard origin/master` on every build, so the artifact
changed silently with upstream. By now upstream master has dropped `SidConfig::playback`,
`SidConfig::MONO/STEREO` and `SidInfo::channels`, and the bindings **no longer compile against it at
all** (7 errors). This is fixed by pinning to `v3.0.0a2` — the revision the bindings target, which
matches the `SIDLiteEmu V3.0.0a2` string found in the previously published artifact — overridable via
`LIBSIDPLAYFP_REF`.

---

## 3. Defects and status

| # | defect | impact | status |
| --- | --- | --- | --- |
| 1 | **Worker render race.** `localSid.worker.ts` used an `async` `onmessage`, so every `await` yielded to the next queued message. With N renders in flight, N `renderSeconds()` calls ran concurrently against one stateful WASM engine, interleaving and replaying the same span. | A short passage looping over and over with crackle at the seams — user-reported as "very repetitive and crackly… the same ~5 s loop". Latent at the old cap of 2; constant once the cap was raised to 4. | **Fixed** — all worker messages serialised through one promise chain. Regression test asserts peak concurrency is exactly 1 and fails on the old code. |
| 2 | **Audio underruns.** The Web Audio schedule was kept only 1.5 s ahead, but every chunk still crosses the main thread — which stalls up to **1.9 s** on the HVSC-loaded Play page (28 % of wall time in GC, measured with a long-task observer + CPU profile). | Audible gaps; `audioUnderruns` climbing ~6/min against a pinned budget of 0 (§12.6). | **Fixed** — buffer raised to 4 s, in-flight renders 2→4. Measured on device: **0 underruns over 110 s** (was 6/min). No added start latency. |
| 3 | **Pause did not stop on-device playback.** `handlePauseResume` only ever drove the C64 (`machinePause`/`machineResume`), so pausing a locally-playing tune sent a pointless call to the Ultimate while the audio kept playing. | Playback could not be stopped from the UI. | **Fixed** — local playback now suspends/resumes the engine's AudioContext, which freezes the schedule in place and resumes exactly where it stopped. |
| 4 | **WASM built with SIDLite, not reSIDfp.** See §2.2. | Wrong timbre, large DC offset (~0.17 full-scale, eating headroom — peaks to 0.93 where the C64 peaks at 0.40), ~8 dB level deficit, and output that does not track the real machine. | **Open.** Needs `libresidfp` cross-compiled for wasm and linked (§2.2) — not a one-line change, and not completed here. |
| 5 | **Upstream libsidplayfp was unpinned** in the WASM build (`reset --hard origin/master` per run), so artifacts drifted silently and the bindings no longer compile against current master (7 API errors). | Non-reproducible artifacts; the package could not be rebuilt at all. | **Fixed in `sidflow`** — pinned to `v3.0.0a2` (`LIBSIDPLAYFP_REF` to override), which restores a working build. |

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
