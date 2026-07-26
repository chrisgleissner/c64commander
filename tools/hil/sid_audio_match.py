#!/usr/bin/env python3
"""Precise, room-resilient match of captured audio against a libsidplayfp render.

A microphone in a room adds delay, reverb, speaker colouring and noise, so a
sample-level comparison of waveforms is meaningless. What survives all of that
is the TIME-FREQUENCY SHAPE of the music: which pitches sound, how strongly, and
when. This compares log-mel spectrograms frame by frame after aligning them,
which tolerates level, EQ and reverb while still separating one SID tune from
another.

Pipeline
  1. render the expected tune with `sidplayfp` (the reference implementation);
  2. log-mel spectrogram of both, per-frame mean-removed so gain and speaker EQ
     drop out;
  3. slide the capture over the whole reference (playback position is arbitrary)
     and take the best mean per-frame cosine similarity.

`melSim` is the score. Calibrated on this rig; the band and the decision threshold are set just below,
with the measurements that produced them.
"""
from __future__ import annotations
import math, os, subprocess, sys, tempfile, wave
import numpy as np

# Calibrated on this rig (Pixel 4 speaker -> USB mic, 12 s capture):
#
#   band 800-3000 Hz   correct tune 0.722 | wrong tune -0.047 | paused -0.041
#   band 150-6000 Hz   correct tune -0.124 | wrong tune -0.342 | paused  0.015
#
# The band is the whole game. A phone speaker reproduces almost nothing below
# ~700 Hz, so wider mel bands are filled with room noise that swamps the music
# and the score collapses -- at 150-6000 Hz the correct tune scored NEGATIVE.
# Restricted to where the speaker actually works, a real capture separates from
# an unrelated tune by ~0.77, which is what makes this usable as a gate.
MEL_FMIN, MEL_FMAX = 800.0, 3000.0
MATCH_THRESHOLD = 0.40

# Playback volume for HIL runs. Measured on this rig: at Android media volume
# 14/25 a correct tune scores 0.560 -- comfortably clear of the 0.40 threshold --
# so there is no reason to run louder, and these tests share a room with people.
# Below that the margin was not established: a single 10-second sample cannot
# rank volumes, because melSim varies more between TUNES than between volumes
# (a sweep that let the station auto-advance scored 0.100 at volume 16 and 0.583
# at volume 6, measuring the tune rather than the level). Ranking lower volumes
# honestly needs several samples of the SAME tune per step.
RECOMMENDED_ANDROID_MEDIA_VOLUME = 14
SAMPLE_RATE = 44100

def read_wav(path: str):
    w = wave.open(path, "rb")
    ch, sw, rate, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
    raw = w.readframes(n); w.close()
    if sw != 2: raise SystemExit(f"{path}: expected 16-bit PCM")
    x = np.frombuffer(raw, dtype="<i2").astype(np.float64)
    if ch == 2: x = x.reshape(-1, 2).mean(axis=1)
    return x, rate

def render_reference(sid_path: str, seconds: int, songnr: int | None = None) -> str:
    out = tempfile.mktemp(suffix=".wav")
    cmd = ["sidplayfp", f"-w{out}", f"-t{int(seconds)}", f"-f{SAMPLE_RATE}"]
    if songnr: cmd.append(f"-o{songnr}")
    cmd.append(sid_path)
    r = subprocess.run(cmd, capture_output=True, text=True)
    if not os.path.exists(out):
        raise SystemExit(f"sidplayfp produced nothing for {sid_path}: {r.stderr[:300]}")
    return out

def _mel_filterbank(n_fft: int, rate: int, n_mels: int = 40, fmin: float = MEL_FMIN, fmax: float = MEL_FMAX):
    hz2mel = lambda f: 2595.0 * np.log10(1.0 + f / 700.0)
    mel2hz = lambda m: 700.0 * (10 ** (m / 2595.0) - 1.0)
    pts = mel2hz(np.linspace(hz2mel(fmin), hz2mel(fmax), n_mels + 2))
    bins = np.floor((n_fft + 1) * pts / rate).astype(int)
    fb = np.zeros((n_mels, n_fft // 2 + 1))
    for i in range(n_mels):
        l, c, r = bins[i], bins[i+1], bins[i+2]
        if c == l: c = l + 1
        if r == c: r = c + 1
        if r >= fb.shape[1]: break
        fb[i, l:c] = np.linspace(0, 1, c - l, endpoint=False)
        fb[i, c:r] = np.linspace(1, 0, r - c, endpoint=False)
    return fb

def logmel(x: np.ndarray, rate: int, hop_ms: float = 20.0, win_ms: float = 46.0) -> np.ndarray:
    n_fft = 1 << int(math.ceil(math.log2(rate * win_ms / 1000)))
    hop = max(1, int(rate * hop_ms / 1000))
    fb = _mel_filterbank(n_fft, rate)
    win = np.hanning(n_fft)
    frames = []
    for i in range(0, len(x) - n_fft, hop):
        spec = np.abs(np.fft.rfft(x[i:i+n_fft] * win)) ** 2
        frames.append(np.log(fb @ spec + 1e-8))
    if not frames: return np.zeros((0, fb.shape[0]))
    M = np.array(frames)
    M -= M.mean(axis=1, keepdims=True)      # per-frame: kills level and broad EQ
    norm = np.linalg.norm(M, axis=1, keepdims=True); norm[norm == 0] = 1
    return M / norm

def match(capture_wav: str, sid_path: str, songnr: int | None = None, reference_seconds: int = 240) -> dict:
    cap, crate = read_wav(capture_wav)
    ref_wav = render_reference(sid_path, reference_seconds, songnr)
    ref, rrate = read_wav(ref_wav)
    C, R = logmel(cap, crate), logmel(ref, rrate)
    if len(C) < 10 or len(R) < len(C):
        return {"melSim": 0.0, "note": "capture too short or reference shorter than capture"}
    # Per-frame cosine similarity == dot product of L2-normalised frames; the
    # mean over a window is a valid-mode correlation of the flattened matrices.
    sims = np.array([float((C * R[o:o+len(C)]).sum() / len(C)) for o in range(len(R) - len(C) + 1)])
    best = int(np.argmax(sims))
    return {"melSim": round(float(sims[best]), 3), "matchAtSec": round(best * 0.020, 1),
            "seconds": round(len(cap)/crate, 1), "tune": os.path.basename(sid_path),
            "match": bool(sims[best] >= MATCH_THRESHOLD)}

if __name__ == "__main__":
    import json
    print(json.dumps(match(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else None)))
