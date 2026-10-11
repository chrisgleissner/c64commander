#!/usr/bin/env python3
"""Grade a renderer-accuracy HIL run: each renderer on the phone against the C64 and against the host.

    python3 tools/hil/renderer_accuracy.py <run dir> [--ez-render <ez_render>] [--roms <dir>]

`renderer_accuracy_hil.mjs` writes the run directory: for each tune, a microphone take of the C64
playing it (`<stem>.c64.wav`) and, per renderer, a microphone take of the phone playing it
(`<stem>.<renderer>.mic.wav`) and the PCM the app handed the AudioTrack meanwhile
(`<stem>.<renderer>.pcm.wav`). Three questions are answered per tune and renderer:

  digital   Is what the phone played the renderer's own output? The captured PCM is located in a
            host render of the same tune by the same renderer, and scored as the residual after the
            best gain: a renderer that runs the same code on both sides leaves only rounding.
  acoustic  Does it sound like the C64? The phone's microphone take against the C64's, on the
            notes (chroma) and the dynamics (envelope), band-limited to 300-6000 Hz, which both
            speakers reproduce. Timbre is not compared: the two speakers differ far more than the
            renderers do.
  relative  Does it sound like reSIDfp on the same speaker? The take against the reSIDfp take,
            where the speaker and room are identical, so the third-octave balance is comparable.

Writes `accuracy.json` and `accuracy.md` into the run directory.
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "sid-engines"))
import compare_engines  # noqa: E402
import run_matrix  # noqa: E402

RATE = 48000
FRAME_SECONDS = 0.01
ACOUSTIC_BAND_HZ = (300.0, 6000.0)
RENDERERS = ("sidplayez", "residfp", "sidlite")
# Two microphone takes start within this of each other: each is started a fixed time after its tune.
MAX_TAKE_OFFSET_SECONDS = 6.0


def read_wav(path: Path) -> tuple[np.ndarray, int]:
    """Samples as float in [-1, 1], shaped (frames, channels)."""
    with wave.open(str(path), "rb") as handle:
        if handle.getsampwidth() != 2:
            raise ValueError(f"{path}: expected 16-bit PCM, got {8 * handle.getsampwidth()}-bit")
        channels, rate = handle.getnchannels(), handle.getframerate()
        data = np.frombuffer(handle.readframes(handle.getnframes()), dtype="<i2").astype(np.float64) / 32768.0
    return data.reshape(-1, channels), rate


def read_raw_stereo(path: Path) -> np.ndarray:
    return np.fromfile(path, dtype="<i2").astype(np.float64).reshape(-1, 2) / 32768.0


def band_limit(mono: np.ndarray, rate: int, band: tuple[float, float] = ACOUSTIC_BAND_HZ) -> np.ndarray:
    spectrum = np.fft.rfft(mono)
    freqs = np.fft.rfftfreq(len(mono), 1.0 / rate)
    spectrum[(freqs < band[0]) | (freqs > band[1])] = 0
    return np.fft.irfft(spectrum, len(mono))


def envelope(mono: np.ndarray, rate: int) -> np.ndarray:
    hop = int(rate * FRAME_SECONDS)
    n = len(mono) // hop
    frames = mono[: n * hop].reshape(n, hop)
    return 20 * np.log10(np.sqrt(np.mean(frames * frames, axis=1)) + 1e-9)


def locate(reference: np.ndarray, excerpt: np.ndarray, rate: int) -> int:
    """Where `excerpt` starts inside `reference`, in samples: the peak of their cross-correlation.

    On the waveform, not the envelope: music repeats its dynamics often enough for an envelope match
    to land a bar or two away, while two renders agree sample for sample only where they really align.
    """
    if len(excerpt) > len(reference):
        raise ValueError("the excerpt is longer than the reference")
    size = 1 << int(math.ceil(math.log2(len(reference) + len(excerpt))))
    product = np.fft.rfft(reference, size) * np.conj(np.fft.rfft(excerpt, size))
    correlation = np.fft.irfft(product, size)[: len(reference) - len(excerpt) + 1]
    energy = np.concatenate([[0.0], np.cumsum(reference * reference)])
    window = energy[len(excerpt) :] - energy[: len(energy) - len(excerpt)]
    return int(np.argmax(correlation / np.sqrt(np.maximum(window[: len(correlation)], 1e-20))))


def envelope_lag(reference: np.ndarray, take: np.ndarray, rate: int, max_seconds: float) -> int:
    """How many envelope frames `take` lags `reference` by, searched over +-max_seconds."""
    a = np.maximum(envelope(reference, rate), -70.0)
    b = np.maximum(envelope(take, rate), -70.0)
    limit = int(max_seconds / FRAME_SECONDS)
    best, best_score = 0, -np.inf
    for lag in sorted(range(-limit, limit + 1), key=abs):
        x, y = (a[: len(a) - lag], b[lag:]) if lag >= 0 else (a[-lag:], b[: len(b) + lag])
        n = min(len(x), len(y))
        if n < min(len(a), len(b)) // 2:
            continue
        x, y = x[:n] - x[:n].mean(), y[:n] - y[:n].mean()
        denom = math.sqrt(float((x * x).sum() * (y * y).sum()))
        score = float((x * y).sum() / denom) if denom > 0 else -np.inf
        if score > best_score:
            best, best_score = lag, score
    return best


def residual_db(reference: np.ndarray, signal: np.ndarray) -> tuple[float, float]:
    """The best gain from reference to signal (dB) and what is left over, in dB below the signal."""
    gain = float((reference * signal).sum() / max(1e-20, float((reference * reference).sum())))
    error = signal - gain * reference
    level = float((signal * signal).sum())
    return 20 * math.log10(max(1e-12, abs(gain))), 10 * math.log10(max(1e-20, float((error * error).sum())) / max(
        1e-20, level))


def chroma_similarity(a: np.ndarray, b: np.ndarray, rate: int) -> float:
    ca, cb = compare_engines.chroma(a, rate), compare_engines.chroma(b, rate)
    k = min(len(ca), len(cb))
    if not k:
        return 1.0
    dots = (ca[:k] * cb[:k]).sum(axis=1)
    norms = np.linalg.norm(ca[:k], axis=1) * np.linalg.norm(cb[:k], axis=1)
    loud = norms > norms.max() * 1e-3
    return float(np.mean(dots[loud] / norms[loud])) if loud.any() else 1.0


def envelope_correlation(a: np.ndarray, b: np.ndarray, rate: int) -> float:
    ea, eb = np.maximum(envelope(a, rate), -70.0), np.maximum(envelope(b, rate), -70.0)
    n = min(len(ea), len(eb))
    ea, eb = ea[:n], eb[:n]
    return float(np.corrcoef(ea, eb)[0, 1]) if ea.std() > 0 and eb.std() > 0 else 1.0


def aligned_pair(reference: np.ndarray, take: np.ndarray, rate: int) -> tuple[np.ndarray, np.ndarray]:
    """The overlap of two takes of the same music once `take` is shifted onto `reference`."""
    shift = envelope_lag(reference, take, rate, MAX_TAKE_OFFSET_SECONDS) * int(rate * FRAME_SECONDS)
    a, b = (reference[: len(reference) - shift], take[shift:]) if shift >= 0 else (reference[-shift:], take[:shift])
    n = min(len(a), len(b))
    return a[:n], b[:n]


def acoustic(reference_take: np.ndarray, take: np.ndarray, rate: int) -> dict:
    a, b = aligned_pair(band_limit(reference_take, rate), band_limit(take, rate), rate)
    bands_a, bands_b = compare_engines.band_levels_db(a, rate), compare_engines.band_levels_db(b, rate)
    offset = np.median(bands_b - bands_a)
    audible = bands_a > bands_a.max() - 40
    return {
        "chroma_sim": chroma_similarity(a, b, rate),
        "envelope_corr": envelope_correlation(a, b, rate),
        "band_db_mae": float(np.mean(np.abs(bands_b - bands_a - offset)[audible])) if audible.any() else 0.0,
        "seconds": len(a) / rate,
    }


def against_stream(stream: np.ndarray, capture: np.ndarray, rate: int) -> dict:
    """The phone's PCM against the Ultimate's own output: both digital, so timbre is comparable too."""
    a, b = aligned_pair(stream.mean(axis=1), capture.mean(axis=1), rate)
    bands_a, bands_b = compare_engines.band_levels_db(a, rate), compare_engines.band_levels_db(b, rate)
    offset = np.median(bands_b - bands_a)
    audible = bands_a > bands_a.max() - 60
    return {
        "chroma_sim": chroma_similarity(a, b, rate),
        "envelope_corr": envelope_correlation(a, b, rate),
        "band_db_mae": float(np.mean(np.abs(bands_b - bands_a - offset)[audible])) if audible.any() else 0.0,
        "seconds": len(a) / rate,
    }


def digital(host_render: np.ndarray, capture: np.ndarray, rate: int) -> dict:
    """The capture against the host render of the same renderer: where it sits, and what differs."""
    ref_mono, cap_mono = host_render.mean(axis=1), capture.mean(axis=1)
    start = locate(ref_mono, cap_mono, rate)
    n = min(len(cap_mono), len(ref_mono) - start)
    gain_db, residual = residual_db(host_render[start : start + n].ravel(), capture[:n].ravel())
    return {"start_seconds": start / rate, "gain_db": gain_db, "residual_db": residual, "seconds": n / rate}


def to_rate(samples: np.ndarray, rate: int) -> np.ndarray:
    if rate == RATE:
        return samples
    positions = np.arange(int(len(samples) * RATE / rate)) * rate / RATE
    return np.stack([np.interp(positions, np.arange(len(samples)), samples[:, c]) for c in range(samples.shape[1])],
                    axis=1)


def host_render(renderer: str, tune: Path, song: int, seconds: float, out: Path, ez_render: Path | None,
                roms: Path | None, model: str) -> np.ndarray:
    """The tune rendered on the host as the phone rendered it: same renderer, fallback chip and ROMs."""
    rom_args = [str(roms / "kernal.901227-03.bin"), str(roms / "basic.901226-01.bin")] if roms else []
    if renderer == "sidplayez":
        if ez_render is None:
            raise ValueError("--ez-render is needed to grade libSidplayEZ captures")
        cmd = [str(ez_render), str(tune), str(song), str(seconds), str(RATE), model, str(out)]
        if roms:
            cmd += rom_args + [str(roms / "characters.901225-01.bin")]
    else:
        cmd = ["node", str(run_matrix.REPO / "tools/sid-engines/render-wasm.mjs"), renderer, str(tune), str(song),
               str(seconds), str(RATE), model, str(out), *rom_args]
    subprocess.run(cmd, check=True, capture_output=True, text=True, cwd=run_matrix.REPO)
    return read_raw_stereo(out)


def grade(run_dir: Path, ez_render: Path | None, roms: Path | None) -> dict:
    manifest = json.loads((run_dir / "manifest.json").read_text())
    results = []
    for tune in manifest["tunes"]:
        stem, song = tune["stem"], tune["song"]
        row = {"tune": stem, "song": song, "renderers": {}}
        c64_path = run_dir / f"{stem}.c64.wav"
        c64 = to_rate(*read_wav(c64_path)).mean(axis=1) if c64_path.exists() else None
        stream_path = run_dir / f"{stem}.c64stream.wav"
        stream = to_rate(*read_wav(stream_path)) if stream_path.exists() else None
        residfp_path = run_dir / f"{stem}.residfp.mic.wav"
        residfp_mic = to_rate(*read_wav(residfp_path)).mean(axis=1) if residfp_path.exists() else None
        for renderer in RENDERERS:
            mic_path, pcm_path = run_dir / f"{stem}.{renderer}.mic.wav", run_dir / f"{stem}.{renderer}.pcm.wav"
            if not mic_path.exists():
                continue
            mic = to_rate(*read_wav(mic_path)).mean(axis=1)
            entry: dict = {}
            if c64 is not None:
                entry["vs_c64"] = acoustic(c64, mic, RATE)
            if residfp_mic is not None and renderer != "residfp":
                entry["vs_residfp_mic"] = acoustic(residfp_mic, mic, RATE)
            if pcm_path.exists():
                capture = to_rate(*read_wav(pcm_path))
                if stream is not None:
                    entry["vs_c64_stream"] = against_stream(stream, capture, RATE)
                model = manifest.get("phone", {}).get(f"{stem}.{renderer}", {}).get("fallbackSidModel") or "8580"
                reference = host_render(renderer, Path(tune["path"]), song, tune["render_seconds"],
                                        run_dir / f"{stem}.{renderer}.host.raw", ez_render, roms, model)
                entry["digital"] = digital(reference, capture, RATE)
            row["renderers"][renderer] = entry
        results.append(row)
    return {"run": manifest.get("run"), "tunes": results}


def markdown(report: dict) -> str:
    lines = [
        "| Tune | Renderer | Digital residual (dB) | vs C64 stream chroma | vs C64 stream envelope r | vs C64 stream band error (dB) | vs C64 mic chroma | vs C64 mic envelope r | vs reSIDfp mic chroma | vs reSIDfp mic envelope r | vs reSIDfp mic band error (dB) |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    fmt = lambda value, spec: format(value, spec) if value is not None else "—"  # noqa: E731
    for row in report["tunes"]:
        for renderer, entry in row["renderers"].items():
            c64, rel, dig = entry.get("vs_c64", {}), entry.get("vs_residfp_mic", {}), entry.get("digital", {})
            wire = entry.get("vs_c64_stream", {})
            lines.append(
                f"| {row['tune']} | {renderer} | {fmt(dig.get('residual_db'), '.1f')} | "
                f"{fmt(wire.get('chroma_sim'), '.3f')} | {fmt(wire.get('envelope_corr'), '.3f')} | "
                f"{fmt(wire.get('band_db_mae'), '.2f')} | "
                f"{fmt(c64.get('chroma_sim'), '.3f')} | {fmt(c64.get('envelope_corr'), '.3f')} | "
                f"{fmt(rel.get('chroma_sim'), '.3f')} | {fmt(rel.get('envelope_corr'), '.3f')} | "
                f"{fmt(rel.get('band_db_mae'), '.2f')} |"
            )
    return "\n".join(lines) + "\n"


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("run_dir", type=Path)
    parser.add_argument("--ez-render", type=Path, default=None)
    parser.add_argument("--roms", type=Path, default=None)
    args = parser.parse_args(argv)
    report = grade(args.run_dir, args.ez_render, args.roms)
    (args.run_dir / "accuracy.json").write_text(json.dumps(report, indent=2))
    table = markdown(report)
    (args.run_dir / "accuracy.md").write_text(table)
    print(table)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
